# 汉字笔顺练习纸生成器

家用小工具：输入生字，生成 A4 练习纸（拼音、笔顺分解、田字格、描红），多音字可选读音，可导出 PDF 和 Markdown。部署在 GitHub Pages，家人用 iPhone Safari 打开。

## 结构
- `src/app.html`：页面和全部逻辑，唯一的源码文件。里面的 `__DB__` 是字库占位符，不要删。
- `scripts/build.js`：从 npm 的 `hanzi-writer-data`、`pinyin-pro` 生成字库（GB2312 一级字约 3755 个），压缩后嵌入页面，输出 `dist/index.html`。
- `tests/smoke.test.js`：jsdom 冒烟测试。
- `.github/workflows/ci.yml`：PR 自动构建和测试；合并到 `main` 后自动发布 Pages。

## 命令
- `npm install`：安装依赖
- `npm run build`：生成 `dist/index.html`
- `npm test`：跑冒烟测试（需先 build）

## 规则
- 页面必须自包含：不引用外部脚本、字体、图片，不发网络请求。要能离线、从 file:// 打开。
- 不提交 `dist/` 和 `node_modules/`；不手改 `dist/`，改 `src/` 后重新 build。
- 不提交任何密钥、个人信息、孩子的信息。仓库是公开的。
- 一个分支、一个 PR 只解决一个问题。分支名用 `fix/…`、`feat/…`、`chore/…`；提交说明用中文，一句话说清改了什么。
- 改动前先说明准备改哪些文件、为什么，等用户同意再改。
- 改完必须 `npm run build && npm test` 通过。

## 测试覆盖不到的，要人工验证
jsdom 里没有 canvas，PDF 导出和打印排版测不到。涉及导出、排版、田字格尺寸的改动，需要用户在浏览器里点一次“导出 PDF”并打印一页检查；涉及手机的改动，需要在 iPhone Safari 上验证。

## 已知限制
- 多音字默认读音取 pinyin-pro 的第一项，个别字可能与教材不同，用户可在页面里改。
- 笔顺数据来自开源项目，个别字与教材有出入。
- 页面依赖 `DecompressionStream`（Safari 16.4+、Chrome）。
