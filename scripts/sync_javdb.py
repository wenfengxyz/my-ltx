#!/usr/bin/env python3
"""
Jasna-LTX 数据自动更新器
从 JavDB 首页「最新上架」抓新作品，按站点数据格式追加到 data/movies.json。

用法:
    python scripts/sync_javdb.py --dry-run
    python scripts/sync_javdb.py --max-add 20
"""
import argparse
import json
import os
import re
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data", "movies.json")
SUBCHK = os.path.join(ROOT, "data", "subtitle-checked.json")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36")
BASES = ["https://javdb.com", "https://javdb570.com"]


def log(*a):
    print("[sync]", *a, flush=True)


def curl(url, timeout=45):
    try:
        out = subprocess.run(
            ["curl", "-sL", "--max-time", str(timeout), "-A", UA,
             "-H", "Accept-Language: zh-CN,zh;q=0.9",
             "-H", "Accept: text/html,application/xhtml+xml,*/*;q=0.8", url],
            capture_output=True, timeout=timeout + 15)
        return out.stdout.decode("utf-8", "ignore")
    except Exception as e:
        log("   curl 失败:", str(e)[:60])
        return ""


def fetch(path, timeout=45):
    for b in BASES:
        html = curl(b + path, timeout=timeout)
        if html and len(html) > 20000:
            return html, b
    return "", None


def find_shot(code):
    """探测 javfree 长截图是否存在（先直连，失败走本地代理）"""
    if not code:
        return ""
    url = "https://cf.javfree.me/HLIC/%s-demosaic.jpeg" % code.upper()
    base = ["curl", "-sIL", "--max-time", "15", "-o", os.devnull, "-w", "%{http_code}", "-A", UA]
    attempts = [base + [url],
                base + ["-x", "http://127.0.0.1:7890", url]]
    for cmd in attempts:
        try:
            out = subprocess.run(cmd, capture_output=True, timeout=25)
            code_out = out.stdout.decode("utf-8", "ignore").strip()
            if code_out.endswith("200"):
                return url
        except Exception:
            continue
    return ""


def proxy_wrap(u, w=360, h=500):
    """把外链图片转成本站代理地址（避免浏览器 ORB 拦截）"""
    import urllib.parse
    if not u or "/api/img" in u:
        return u
    if "jdbstatic.com" not in u and "javfree.me" not in u:
        return u
    q = "/api/img?w=%d&u=" % w
    if h and w == 360:
        q = "/api/img?w=%d&h=%d&u=" % (w, h)
    return q + urllib.parse.quote(u, safe="")


def _norm(v):
    return re.sub(r"[^a-z0-9]", "", (v or "").lower())


def find_zh_subtitle(code, tries=4):
    """到 subtitlecat 查该番号有没有中文字幕（必须完整番号匹配），返回 srt 链接或空串"""
    import urllib.parse
    want = _norm(code)
    if not want:
        return ""
    try:
        html = curl("https://www.subtitlecat.com/index.php?search=" + urllib.parse.quote(code))
        if not html:
            return ""
        ups = []
        for m in re.findall(r'href="(subs/[^"]+)"', html):
            name = urllib.parse.unquote(m)
            base = name.split("/")[-1]
            if want not in _norm(base):          # 完整番号必须出现
                continue
            if base.lower().endswith(".srt"):
                if re.search(r"zh[-_]?cn|zh[-_]?tw|chs|sehuatang", base, re.I):
                    return ("https://www.subtitlecat.com/" + m) if not m.startswith("http") else m
                continue
            ups.append(m)
        for m in ups[:tries]:
            page = curl("https://www.subtitlecat.com/" + m)
            for srt in re.findall(r'href="([^"]+\.srt)"', page):
                fname = srt.split("/")[-1]
                if want not in _norm(fname):
                    continue
                if re.search(r"zh[-_]cn|zh[-_]tw|chs", fname, re.I):
                    return srt if srt.startswith("http") else ("https://www.subtitlecat.com" + srt)
            time.sleep(0.3)
    except Exception as e:
        log("   字幕查询失败:", str(e)[:50])
    return ""


def clean(s):
    s = re.sub(r"<[^>]+>", " ", s or "")
    for a, b in (("&nbsp;", " "), ("&amp;", "&"), ("&quot;", '"'),
                 ("&#39;", "'"), ("&lt;", "<"), ("&gt;", ">")):
        s = s.replace(a, b)
    return re.sub(r"\s+", " ", s).strip()


def field(html, label):
    """取 <strong>标签:</strong> ... </div> 里的值"""
    m = re.search(r"<strong>\s*" + label + r"[:：]?\s*</strong>(.*?)</div>", html, re.S)
    return clean(m.group(1)) if m else ""


def parse_detail(html, url):
    if not html or len(html) < 20000:
        return None

    code, title = "", ""
    m = re.search(r'<h2 class="title is-4">(.*?)</h2>', html, re.S)
    if m:
        block = m.group(1)
        cs = re.search(r"<strong>(.*?)</strong>", block, re.S)
        code = clean(cs.group(1)) if cs else ""
        title = clean(re.sub(r"<strong>.*?</strong>", "", block, flags=re.S))
    if not code:
        m2 = re.search(r'data-clipboard-text="([A-Z][A-Za-z0-9]{0,8}-\d{2,6})"', html)
        code = m2.group(1) if m2 else ""
    if not code:
        return None

    cover = ""
    m = re.search(r'<img[^>]+src="(https://c\d\.jdbstatic\.com/covers/[^"]+)"', html)
    if m:
        cover = m.group(1)

    date = field(html, "日期")
    maker = field(html, "片商") or field(html, "發行商")
    director = field(html, "導演")
    series = field(html, "系列")
    genres_raw = field(html, "類別")
    actors_raw = field(html, "演員")

    actors = []
    for a in re.split(r"[,、/]", actors_raw):
        a = a.strip()
        if a and not a.isdigit() and len(a) <= 24:
            actors.append(a)

    genres = [g.strip() for g in re.split(r"[,、]", genres_raw) if g.strip()][:8]

    score, votes = 0.0, 0
    m = re.search(r"([\d.]+)\s*分[,，]?\s*由\s*([\d,]+)\s*人評價", html)
    if m:
        try:
            score = float(m.group(1))
            votes = int(m.group(2).replace(",", ""))
        except Exception:
            pass
    else:
        m = re.search(r'<span class="score">([\d.]+)</span>', html)
        if m:
            try:
                score = float(m.group(1))
            except Exception:
                pass

    sub_url = find_zh_subtitle(code)
    shot_url = find_shot(code)

    return {
        "actors": actors,
        "added_at": int(time.time() * 1000),
        "code": code,
        "comments": 0,
        "cover": proxy_wrap(cover),
        "date": date,
        "director": director,
        "genres": genres,
        "likers": 0,
        "link": "",
        "linkPending": True,
        "linkType": "",
        "links": [],
        "lists": 0,
        "maker": maker,
        "missing": False,
        "pending": True,
        "pending_links": [],
        "people": 0,
        "rawScore": score,
        "score": score,
        "series": series,
        "shot": proxy_wrap(shot_url, w=900, h=None),
        "size": 0,
        "subtitle": sub_url,
        "title": title,
        "title_zh": title,
        "url": url,
        "votes": votes,
        "waiting": False,
    }


def candidate_ids():
    """首页最新上架 + 分类页"""
    ids = []
    seen = set()
    for path in ("/", "/video_codes/SIRO", "/video_codes/GANA"):
        html, _ = fetch(path)
        if not html:
            continue
        for vid in re.findall(r'href="/v/([A-Za-z0-9]{5,10})"', html):
            if vid not in seen:
                seen.add(vid)
                ids.append(vid)
    return ids


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--max-add", type=int, default=20)
    ap.add_argument("--backfill", type=int, default=15)
    args = ap.parse_args()

    if not os.path.exists(DATA):
        log("找不到", DATA)
        return 1

    data = json.load(open(DATA, encoding="utf-8"))
    items = data.get("items") or []
    known = {(it.get("code") or "").upper() for it in items}
    log("现有作品:", len(items))

    ids = candidate_ids()
    # 兜底 1：列表页拿不到，多半是瞬时 403/429 或 WAF 抽风，等一会儿再试两次
    for attempt in range(2):
        if ids:
            break
        wait = 30 if attempt == 0 else 90
        log("候选列表为空，%d 秒后重试（第 %d 次）" % (wait, attempt + 1))
        time.sleep(wait)
        ids = candidate_ids()
    log("候选视频:", len(ids))
    # 兜底 2：仍然为空 → 本轮视为受阻，不写数据，交给工作流做熔断
    if not ids:
        log("SYNC_STATUS=blocked candidates=0 reason=empty_listing")
        return 0
    # 兜底 3：候选数异常偏大 → 页面结构变了或抓到推荐/全站列表，这一轮不写入
    if len(ids) > 500:
        log("SYNC_STATUS=blocked candidates=%d reason=too_many" % len(ids))
        return 0

    added = []
    for vid in ids:
        if len(added) >= args.max_add:
            break
        html, base = fetch("/v/" + vid)
        it = parse_detail(html, (base or BASES[0]) + "/v/" + vid)
        if not it:
            continue
        if it["code"].upper() in known:
            continue
        known.add(it["code"].upper())
        added.append(it)
        log("  + %-12s %s  %s" % (it["code"], it["date"], it["title"][:34]))
        time.sleep(0.3)

    # 补录：给缺少字幕信息的记录查一次（记录已查过的，逐批覆盖）
    filled = 0
    checked = set()
    try:
        checked = set(json.load(open(SUBCHK, encoding="utf-8")).get("checked") or [])
    except Exception:
        checked = set()

    if args.backfill > 0:
        pool = [x for x in items
                if not (x.get("subtitle") or "").strip()
                and (x.get("code") or "").upper() not in checked]
        pool.sort(key=lambda x: x.get("added_at") or 0)   # 旧的先查
        log("待查字幕的存量记录:", len(pool), " 已查过:", len(checked))
        for x in pool[:args.backfill]:
            code = (x.get("code") or "").upper()
            if not code:
                continue
            u = find_zh_subtitle(code)
            checked.add(code)
            if u:
                x["subtitle"] = u
                filled += 1
                log("   补字幕 %-12s %s" % (code, u.split("/")[-1]))
            time.sleep(0.2)
        # 顺带给缺 shot 的记录补长截图
        shot_fixed = 0
        for x in items:
            if shot_fixed >= args.backfill:
                break
            if (x.get("shot") or "").strip():
                continue
            code2 = (x.get("code") or "").upper()
            if not code2:
                continue
            u2 = find_shot(code2)
            if u2:
                x["shot"] = u2
                shot_fixed += 1
                log("   补长截图 %-12s" % code2)
            time.sleep(0.1)
        log("补长截图:", shot_fixed)

        try:
            json.dump({"checked": sorted(checked)}, open(SUBCHK, "w", encoding="utf-8"),
                      ensure_ascii=False)
        except Exception as e:
            log("   写已查记录失败:", str(e)[:50])
        log("补录字幕:", filled, " 累计已查:", len(checked))

    log("本次新增:", len(added))
    if args.dry_run:
        if added:
            log("样例:", json.dumps(added[0], ensure_ascii=False)[:400])
        return 0
    if not added and filled == 0:
        log("SYNC_STATUS=ok candidates=%d added=0 filled=0" % len(ids))
        return 0

    data["items"] = added + items
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime())
    n = data.setdefault("nyaa", {})
    n["added"] = (n.get("added") or 0) + len(added)
    n["checked_at"] = int(time.time() * 1000)
    n["ok"] = True
    json.dump(data, open(DATA, "w", encoding="utf-8"),
              ensure_ascii=False, separators=(",", ":"))
    log("已写入，总条数:", len(data["items"]))
    log("SYNC_STATUS=ok candidates=%d added=%d filled=%d" % (len(ids), len(added), filled))
    return 0


if __name__ == "__main__":
    sys.exit(main())
