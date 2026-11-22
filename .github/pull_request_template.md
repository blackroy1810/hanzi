## 关联 Issue
Closes #

## 模型协作标注
<!-- 单模型仅填写实现模型；串行接力写明各阶段模型；并行对比请在 PR 标题标注 [<Model>] -->
- 协作模式：单模型 / 串行接力 / 并行对比
- 方案：
- 实现：
- 终审：

## 变更摘要
<!-- 简述核心改动与涉及文件 -->
- 

## 本地门禁与红线检查
- [ ] 本地已执行 `npm run build && npm test` 并全部通过
- [ ] 未提交 `dist/`、`node_modules/`、`.worktrees/`、`.env*` 或 AI 本地私有目录
- [ ] 未修改 `.github/workflows/ci.yml` 中的 `build` job 名称（未改动 CI 时可勾选）
- [ ] 未包含任何密钥、个人或孩子隐私信息
- [ ] 遵守 `AGENTS.md` 规范，仅等待人工审阅并在 GitHub 网页 Squash merge

## 浏览器与 iPhone Safari 实测清单
<!-- jsdom 无法覆盖 Canvas PDF、打印排版与移动端缩放；纯文档/配置类 PR 可勾选“不适用” -->
- [ ] 桌面浏览器打开 `dist/index.html`（含 `file://`）加载与交互正常 / [ ] 不适用
- [ ] “一键打印”与“导出 PDF”实测 A4 排版、田字格尺寸与清晰度正常 / [ ] 不适用
- [ ] iPhone Safari（局域网预览）页面缩放、输入与功能操作正常 / [ ] 不适用
