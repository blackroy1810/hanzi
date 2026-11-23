# hanzi

汉字笔顺练习纸生成器。输入生字，生成 A4 练习纸（拼音、例词、笔顺分解、田字格、描红），支持一键打印及导出 PDF / Markdown。

在线使用：https://blackroy1810.github.io/hanzi/

## 设计理念

- **大道至简**：只保留学写汉字真正必要的能力，克制界面元素，不做纯视觉或喜好上的妥协。
- **不画外部边界**：不绑定特定教材版本或固定课表，避免引入长期维护成本；靠开放输入与变通性应对变化。
- **看不见的功力**：把精力集中在技术美学与底层质量（完全离线单文件、现代常用全字库、少儿友好词库、精准清晰的排版与打印），不堆开关，却在每一页纸上直接体现实用性与易用性。

## 本地开发
```bash
npm install
npm run build   # 生成单文件 dist/index.html（含例词校验与覆盖率统计）
npm test        # 冒烟测试（需先 build）
```
用浏览器直接打开 `dist/index.html` 即可离线预览。

## 局域网 iPhone Safari 预览
在项目根目录启动局域网静态服务（确保手机与电脑在同一 Wi-Fi）：
```bash
python3 -m http.server 8080 --bind 0.0.0.0 --directory dist
```
在 macOS 上可通过 `ipconfig getifaddr en0` 获取本机局域网 IP，然后在 iPhone Safari 中访问 `http://<本机局域网IP>:8080` 实测。

## 多模型并发开发（git worktree）
多个 LLM 并行开发或对比方案时，统一通过 `git worktree` 隔离工作区（目录放在 `.worktrees/`，已被 `.gitignore` 忽略）：
```bash
git fetch origin main
git worktree add -b feat/<topic>-<model> .worktrees/<task>-<model> origin/main
cd .worktrees/<task>-<model> && npm ci
```
PR 合并或废弃后清理工作树与本地分支：
```bash
git worktree remove .worktrees/<task>-<model>
git branch -D feat/<topic>-<model>
```

## 开发与协作规范
完整项目结构、安全红线、本地门禁及多 LLM 协作流程（并行对比 / 串行接力）详见 [AGENTS.md](./AGENTS.md)。

## 版权与第三方许可
- **原创部分（All Rights Reserved）**：本项目原创源码、排版与导出实现、文档及手写词表（`data/`）版权归作者 `blackroy1810` 所有，仅限个人及家庭非商业自用，未经书面许可禁止商业使用或二次封装为微信小程序、App、付费课程工具等，详见 [LICENSE](./LICENSE)。
- **第三方开源数据**：内置汉字笔画矢量数据衍生自 `hanzi-writer-data`（Make Me A Hanzi / 文鼎字库），遵循 **Arphic Public License**（原文见 [THIRD_PARTY_LICENSES/ARPHICPL.TXT](./THIRD_PARTY_LICENSES/ARPHICPL.TXT)）；拼音与自动兜底词典依赖 `pinyin-pro`（MIT）与 `@pinyin-pro/data`（ISC / MIT）。完整第三方许可与笔画修改说明见 [THIRD_PARTY_LICENSES.md](./THIRD_PARTY_LICENSES.md)。
