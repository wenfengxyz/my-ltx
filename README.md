# Jasna-LTX 资源库 (1:1 独立复刻与自动同步版)

本工程是针对 `Jasna-LTX 资源库` 的 1:1 完整技术复刻，具备**零维护、全自动定时同步、纯前端极速响应、暗黑设计系统与下载器直接联动**的能力。

---

## 🌟 核心功能特性

1. **1:1 暗黑拟物视觉规范**：
   - 极深碳黑底色 (`#0c0c0e`)、高质感卡片 (`#141418`) 与品牌粉红强调色 (`#e83e8c`)。
   - 左侧女优分类抽屉实时统计，右侧自适应栅格卡片流。
2. **纯前端零延迟检索**：
   - 支持番号、女优、片商、日文/中文标题拼音模糊检索。
   - 多维度即时排序（评分、日期、入库时间、体积、番号、随机排序）。
   - 无限滚动触底平滑加载（`IntersectionObserver`）。
3. **下载中枢与集成设置**：
   - 一键复制 ed2k / 磁力链接，支持精简文件名。
   - 批量导出面板（一键复制全部链接、统计累计下载总容量）。
   - 直连 **Aria2 RPC**、**115 云下载**。
4. **全自动云端同步（无需手动干预）**：
   - 内置 `scripts/sync.js` 同步引擎，自动比对源头最新发布的 LTX 压制种子。
   - 内置 `.github/workflows/sync.yml`，在 GitHub Actions 云端**每 6 小时自动巡检一次**，发现新资源自动入库并触发 Cloudflare 自动部署。

---

## 🚀 目录结构

```
jasna-ltx/
├── index.html                  # 1:1 纯前端单页应用
├── css/
│   └── style.css               # 原版 CSS 变量、毛玻璃与暗黑样式
├── js/
│   └── app.js                  # 极速搜索、过滤、排序与下载联动引擎
├── data/
│   └── movies.json             # 核心数据库（包含资源详情、评分、字幕与时间戳）
├── scripts/
│   └── sync.js                 # 全自动数据更新同步引擎
├── .github/
│   └── workflows/
│       └── sync.yml            # GitHub Actions 云端定时作业（每 6 小时自动跑）
├── wrangler.toml               # Cloudflare Pages 配置文件
└── README.md
```

---

## 🛠️ 上线与自动同步配置步骤（大白话教程）

### 第一步：推送到你的 GitHub

1. 在 [GitHub](https://github.com/) 上新建一个空仓库（例如名为 `my-ltx-hub`）。
2. 在本地终端进入本目录，执行以下命令推送到 GitHub：
   ```bash
   git init
   git add .
   git commit -m "feat: init Jasna-LTX replica"
   git branch -M main
   git remote add origin https://github.com/你的用户名/my-ltx-hub.git
   git push -u origin main
   ```

### 第二步：在 Cloudflare Pages 绑定上线（终身免费）

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)。
2. 点击左侧导航栏的 **“Workers 和 Pages”** -> **“创建”** -> 切换到 **“Pages”** 标签页。
3. 选择 **“连接到 Git”**，选中你刚才新建的 `my-ltx-hub` 仓库。
4. 在构建配置中：
   - **框架预设**：选择 `None`（无）
   - **构建输出目录**：填写 `.`（直接留空或输入一个点）
5. 点击 **“保存并部署”**。
   - 约 10 秒后，Cloudflare 就会生成一个属于你的专属公网网址（例如 `https://my-ltx-hub.pages.dev`）。

### 第三步：享受全自动同步

- 从此之后，**你完全不需要任何手动操作**！
- 位于 `.github/workflows/sync.yml` 的 GitHub 定时机器人会在云端每 6 小时自动运行 `sync.js`。
- 一旦检测到有新片发布，机器人会自动更新数据并提交到你的 GitHub。
- Cloudflare 会在 10 秒内自动检测到 GitHub 变动，完成新资源的自动上线发布！
