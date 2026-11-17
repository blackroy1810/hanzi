# Changelog

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。版本号为内部迭代编号，按时间倒叙排列（最新版本在最上方）。

## [v1.0.1] - 2026-11-17
### 新增
- 仓库 `main` 分支开启 GitHub Ruleset 保护：禁止直推、禁止强推与删除，强制 PR 并通过 `build` 检查后以 Squash 方式合并。
- 新增 `CHANGELOG.md` 独立记录项目迭代历史。
### 变更
- 完善 `CLAUDE.md`（PR #2）：补充标准 Git 分支同步流程、CI 门禁保护规则、精准 `git add` 纪律与公开仓库防泄密红线。

## [v1.0] - 2026-11-15（仓库重构，PR #1 已合并上线）
### 新增
- `scripts/build.js`：从 `hanzi-writer-data` 和 `pinyin-pro` 生成字库，压缩后嵌入页面，输出 `dist/index.html`。
- `tests/smoke.test.js`：jsdom 冒烟测试（脚本无报错、字库加载、默认 2 页预览、多音字下拉、默认读音、PDF 容器）。
- `.github/workflows/ci.yml`：PR 自动构建和测试；合并到 `main` 后自动发布 GitHub Pages。
- `CLAUDE.md`、`README.md`、`package.json`、`package-lock.json`、`.gitignore`。
### 变更
- 页面源码移到 `src/app.html`，字库不再直接提交进仓库。
### 移除
- 根目录 `index.html`（改由构建产出，并切换 Pages 部署来源为 GitHub Actions）。

## [v0.5] - 2026-11-15
- 单文件 `index.html` 上线公开仓库并开启 GitHub Pages（`https://blackroy1810.github.io/hanzi/`）。

## [v0.4] - 2026-11-15
- 改进加载提示：若长期停留在“字库加载中”，超过 20 秒后提示用户改用 Safari 或 Chrome 打开。

## [v0.3] - 2026-11-15
- 去掉打印按钮，新增“导出 PDF”（canvas 逐页绘制 → JPEG → 手写 PDF 容器，A4）和“导出 Markdown”生字表。

## [v0.2] - 2026-11-15
- 完整网页版：内置 GB2312 一级字 3755 个、多音字下拉与自定义拼音、每页字数与描红格数配置、本地缓存及手机屏幕自适应缩放。

## [v0.1] - 2026-11-15
- 首个样张：内置 10 个常见字，2 页 A4，含拼音、笔顺分解与 11 个田字格（前 3 格描红）。
