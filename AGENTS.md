# 汉字笔顺练习纸生成器 — 开发与协作规范

本文件（`AGENTS.md`）是本仓库面向所有人类开发者与 AI 编程助手（Claude、Gemini、Codex、GitHub Copilot、Cursor 等）的**唯一权威规范真相源**。`CLAUDE.md`、`GEMINI.md`、`.github/copilot-instructions.md` 仅为各工具的轻量入口指针，维护规范时只修改本文件，禁止在入口文件中重复维护正文。

## 项目简介

家用小工具：输入生字，生成 A4 汉字笔顺练习纸（拼音、推荐例词、笔顺分解、田字格、描红），支持多音字读音勾选与自定义拼音、全汉字组词增删（本地持久化）、一键打印、导出 PDF 与导出 Markdown。

- 在线地址：`https://blackroy1810.github.io/hanzi/`（部署于 GitHub Pages，家人常用 iPhone Safari 打开）

## 设计理念与演进原则

本项目的核心准则是**大道至简**与**技术美学**，所有需求评估、方案设计与代码审阅须共同遵守：

- **聚焦不变的本质**：教材会改版、年级会过去，但“输入任意汉字 → 清晰练笔顺 → 有效复习验收”的本质不变。**不引入绑定特定教材版本或固定课表的重维护内容**，不给工具人为画边界。
- **极简克制，拒绝装饰性妥协**：只保留对学字真正必要的功能与控件，不做纯视觉皮肤、花哨主题、多字体切换等脱离学字本质的喜好型堆砌。
- **优先“看不见的功力”**：把精力集中在实用性、变通性、易用性与底层工程质量（离线单文件压缩、现代常用全字库、词库净化、自适应排版、清晰锐利的打印/导出、移动端零阻力交互）——能由底层自动做对的，不交给用户配置。

## 仓库结构

- `src/app.html`：页面与全部前端逻辑，唯一的运行时源码文件。内含字库占位符 `__DB__`，**严禁修改或删除**。
- `data/polyphones.json`：小学常见多音字例词表（组词最高优先级；表内字默认仅勾选有例词的常用读音，隐藏冷僻音）。
- `data/words.json`：常见普通汉字手写推荐组词表（次高优先级）。
- `scripts/build.js`：构建脚本。组装 GB2312 一级+二级全集与 `@pinyin-pro/data/modern.json` 现代补字（约 6988 字），对 `hanzi-writer-data` 笔画执行 SVG 相对路径压缩与轻量量化，结合 `pinyin-pro` 按三层优先级（`data/polyphones.json` > `data/words.json` > `@pinyin-pro/data` 自动兜底）合入推荐组词并执行例词校验，经 gzip + base64 压缩后替换 `__DB__`，输出单文件 `dist/index.html`（并在产物末尾内嵌版权与第三方开源许可全文，同时原封不动复制 `dist/ARPHICPL.TXT`）。
- `scripts/word-dict.js`：构建期自动词典提取模块。仅在构建时读取 `@pinyin-pro/data` 为手写词表外汉字补齐常用组词，内置少儿友好敏感词过滤（`BLOCKED_RE`）、单音字轻声归并及未收录多音字冷僻音词频收敛；不进入运行时代码。
- `scripts/check-polyphones.js`：构建期例词校验脚本（支持单独运行），使用 `pinyin-pro` 检查 `data/polyphones.json` 与 `data/words.json` 的缺字、重复定义及读音一致性（内置人工核验的 `pinyin-pro` 已知误判白名单）；异常仅输出警告，不阻断构建。
- `tests/smoke.test.js`：基于 `jsdom` 的冒烟测试，验证 `dist/index.html` 无脚本错误、扩容字库与相对路径校验、组词覆盖率（一级常用字 ≥ 98%、全库 ≥ 85%）与词条过滤、多音字勾选与冷僻音收敛、自定义拼音与全汉字组词增删、一键打印、Markdown 与 PDF 生成器及校验脚本。
- `.github/workflows/ci.yml`：PR 自动执行 `build` job（安装、构建、冒烟测试）；合并到 `main` 后自动发布 `dist` 至 GitHub Pages。
- `.github/ISSUE_TEMPLATE/task.md`：多 LLM 协作任务单模板。
- `.github/pull_request_template.md`：PR 审阅、门禁与实测清单模板。
- `AGENTS.md` / `CLAUDE.md` / `GEMINI.md` / `.github/copilot-instructions.md`：统一规范真相源及各 AI 工具轻量入口。
- `LICENSE` / `THIRD_PARTY_LICENSES.md` / `THIRD_PARTY_LICENSES/ARPHICPL.TXT`：本项目原创部分版权声明（All Rights Reserved，非商用）与第三方开源数据许可及修改声明。
- `CHANGELOG.md`：版本迭代记录（倒序排列）。

## 常用命令

```bash
npm install                                                      # 安装依赖（CI 与新 worktree 优先 npm ci）
npm run build                                                    # 构建生成 dist/index.html（自动跑例词校验与覆盖率统计）
npm test                                                         # 运行冒烟测试（依赖 dist/index.html，需先 build）
npm run build && npm test                                        # 标准本地门禁
node scripts/check-polyphones.js                                 # 单独校验 data/polyphones.json 与 data/words.json
python3 -m http.server 8080 --bind 0.0.0.0 --directory dist      # 局域网静态预览，供 iPhone Safari 真机实测
```

## 红线规则

1. **架构与离线自包含红线**
   - 产物 `dist/index.html` 必须完全离线自包含：不引用外部脚本、样式、字体或图片，不发起任何网络请求；必须能离线及直接通过 `file://` 打开。
   - 严禁修改或删除 `src/app.html` 中的 `__DB__` 占位符。
   - 新增词典或辅助数据依赖仅允许放在构建期（`devDependencies`），严禁将在线接口或外链引入运行时页面。

2. **构建产物与脏文件红线**
   - 不提交 `dist/`、`node_modules/`、`.worktrees/`、临时调试文件及任何 AI 工具本地私有目录（`.claude/`、`.gemini/`、`.codex/`、`.aider*`）。
   - 不手改 `dist/index.html`；所有页面或词库改动都在 `src/`、`data/`、`scripts/` 中完成并重新 `npm run build`。

3. **公开仓库与隐私红线**
   - 本仓库为公开仓库，严禁创建或提交 `.env`、`.env.*`，严禁在代码、注释、日志、测试、Issue 或 PR 中写入或打印任何 API 密钥、Token、个人及孩子的信息。

4. **CI 门禁与分支保护红线**
   - `main` 受 GitHub Ruleset 保护：禁止直推、禁止强推、禁止删除，必须通过 PR 且 `build` 检查通过后以 Squash 方式合并。
   - **严禁修改 `.github/workflows/ci.yml` 中的 `build` job 名称**（会导致分支保护检查死锁）。
   - **任何模型均严禁直推 `main`、严禁 `git push --force`、严禁擅自执行 `gh pr merge` 或通过工具自动合并 PR**（合并权仅归人工）。

5. **改动与提交规范**
   - **改动前先说明**：修改文件前，先向用户说明准备改动的文件、原因及涉及的状态/数据流变化，等用户同意后再改（若关联 Issue 已写明方案并获用户授权开工，遇待定项须先确认）。
   - **单一职责**：一个分支、一个 PR 只解决一个问题；分支名使用 `fix/...`、`feat/...`、`chore/...`、`docs/...`；提交说明用中文，一句话说清改了什么。
   - **本地门禁必跑**：改动完成后必须执行 `npm run build && npm test` 确认全部通过。

## 自动化测试盲区与人工验证

`jsdom` 没有真实浏览器渲染引擎与 `canvas`，无法覆盖 Canvas PDF 导出、`@media print` 打印排版、田字格物理尺寸与移动端屏幕缩放：

- 涉及导出、打印、排版、田字格尺寸的改动：须由人工在桌面浏览器中实测“一键打印”与“导出 PDF”，核对分页、清晰度与字号自适应。
- 涉及移动端交互或布局的改动：须在局域网启动静态服务后，使用 iPhone Safari 真机实测。

## 标准开发工作流

单模型开发必须严格按以下顺序执行：

1. **同步基准**：开工前先执行 `git status` 确认工作区干净；执行 `git switch main && git pull --ff-only` 同步最新基准后，再切新分支（`git switch -c <type>/<topic>`）。严禁直接在 `main` 上提交。
2. **修改与本地门禁**：完成改动后必须执行 `npm run build && npm test` 确认全部通过。
3. **人工审查点**：停止操作，向用户汇报改动文件与测试结果，等待用户审阅 `git diff`（并按需完成桌面浏览器 / iPhone Safari 实测）。
4. **精准提交与提 PR**：获得用户确认后，按具体文件路径执行 `git add <file1> <file2>`（**严禁使用 `git add -A` 或 `git add .`**），先检查 `git diff --cached` 确认无多余文件，再执行 `git commit` → `git push -u origin <branch>` → 创建 PR（按 `.github/pull_request_template.md` 填写并关联 `Closes #<issue>`）。
5. **等待与收尾**：可观察云端 CI 状态，但**严禁 AI 擅自合并 PR**。用户在 GitHub 完成 Squash merge 后，本地执行 `git switch main && git pull --ff-only && git branch -D <branch>` 清理旧分支。

## 多 LLM 协同规范

### 1. 并行对比模式（多模型同时实现，择优合入）

当需要多个模型针对同一任务产出不同方案进行对比时：

- **工作树隔离**：严禁多个模型在同一工作目录并发编辑或构建（会互相覆盖未提交改动、切乱分支及覆盖 `dist/index.html`）。统一使用 `git worktree` 隔离，目录固定位于 `.worktrees/<task>-<model>`（已被 `.gitignore` 忽略）：
  ```bash
  git fetch origin main
  git worktree add -b <type>/<topic>-<model> .worktrees/<task>-<model> origin/main
  cd .worktrees/<task>-<model> && npm ci
  ```
- **分支与 PR 命名**：
  - 分支采用 `<type>/<topic>-<model>`（例如 `feat/print-layout-opus`、`feat/print-layout-gemini-neon`、`fix/word-filter-codex`）。
  - PR 标题可标注 `[<Model>]`（例如 `feat: 优化分页边距 [Gemini Neon]`），并在 PR 正文“模型协作标注”栏位写清参与模型。
- **`CHANGELOG.md` 约定**：`CHANGELOG.md` 仅记录产品变更。并行对比的候选 PR 不要预先修改 `CHANGELOG.md` 或抢占版本号，避免互相冲突；待人工选定方案后，仅在最终合入的产品 PR 中更新。
- **清理工作树**：PR 合并或废弃后及时清理：
  ```bash
  git worktree remove .worktrees/<task>-<model>
  git branch -D <type>/<topic>-<model>
  ```

### 2. 串行接力模式（按阶段接力协作）

当多个模型按“方案 → 编码与首次校验 → 终审 → 人工合并”接力完成一个任务时：

- **Issue 为权威 Spec**：统一使用 `.github/ISSUE_TEMPLATE/task.md` 创建 GitHub Issue，明确背景、技术方案、验收标准与模型分工；禁止只靠单个会话的临时记忆口头交接。
- **四个标准交接停靠点**：
  1. **方案停靠点**：负责方案的模型调研代码并在 Issue 补齐技术方案、拟改动文件清单与待定项，停止并等待用户拍板。
  2. **编码与首次校验停靠点**：负责实现的模型基于最新 `main` 创建新分支（或独立 worktree）按 Spec 编码，运行 `npm run build && npm test` 全部通过后停止，等待人工审阅 `git diff`（及按需浏览器 / iPhone Safari 实测）；获确认后精准提交并开 PR（关联 `Closes #<issue>`）。
  3. **终审停靠点**：负责审阅的模型对照 Issue 验收标准、本文件红线与 PR diff 输出评审意见；若需追加修改，改完重跑 `npm run build && npm test` 并再次交由人工确认。
  4. **人工合并停靠点**：云端 `build` 检查通过且审查完成，**仅由人工在 GitHub 网页执行 Squash merge**，随后清理分支与 worktree。任何模型均不得直推 `main`、强推或擅自合并。

## 已知限制

- 多音字默认读音取 `pinyin-pro` 第一项；手写词表外多音字由构建期词频自动收敛冷僻音。个别字的默认读音或例词可能与教材不同，用户可在页面中勾选读音、添加自定义拼音或增删组词（保存在浏览器 `localStorage` 的 `hz_poly_v1`）。
- 笔顺数据来自开源项目 `hanzi-writer-data`，个别字与教材笔顺可能存在差异。
- 极少数生僻字在自动词典中仍无推荐组词，编辑区会提示“暂无推荐组词，可手动添加”。
- 页面依赖浏览器原生 `DecompressionStream`（需 Safari 16.4+ 或现代 Chrome / Edge / Firefox；系统文件预览或微信内置浏览器可能无法正常运行脚本）。
