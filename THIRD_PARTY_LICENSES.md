# 第三方开源许可与修改声明（Third-Party Licenses）

本项目原创代码、文档与手写词表遵循根目录 [`LICENSE`](./LICENSE)（All Rights Reserved）。项目构建期使用及产物内嵌的第三方开源数据分别遵循各自原始开源协议，不受 `LICENSE` 专有条款限制，汇总如下。

---

## 1. `hanzi-writer-data`（汉字笔画矢量轮廓数据）

- **版本**：`2.0.1`
- **来源**：[chanind/hanzi-writer-data](https://github.com/chanind/hanzi-writer-data)（衍生自 [skishore/makemeahanzi](https://github.com/skishore/makemeahanzi)，底层字形提取自台湾文鼎科技 Arphic Technology Co., Ltd. 1999 年公开的开源字库 `AR PL KaitiM GB` 等）
- **许可证**：**Arphic Public License**
- **完整原文**：[`THIRD_PARTY_LICENSES/ARPHICPL.TXT`](./THIRD_PARTY_LICENSES/ARPHICPL.TXT)（原封不动保留；执行 `npm run build` 时亦原封不动输出至 `dist/ARPHICPL.TXT` 并完整内嵌于单文件产物 `dist/index.html` 末尾许可注释中）

### 修改与开放获取说明（依据 `ARPHICPL.TXT` 第 2 条）

- **修改日期**：2026-11-23（随 `scripts/build.js` 持续维护）
- **修改方式**（第 2(a) 条）：构建脚本 `scripts/build.js` 从 `hanzi-writer-data` 读取汉字笔画轮廓（`strokes`），筛选 GB2312 一/二级与现代常用补字子集（约 6,988 字），经 `compressStrokePath()` 将 SVG 绝对路径按步长 `4` 量化并转换为标准相对路径，再与拼音/词组数据合并为 JSON 经 gzip + base64 压缩打包进 `dist/index.html`。
- **自由获取**（第 2(b) 条）：上述经筛选、量化与格式转换后的汉字笔画矢量数据（即产物解压后字库数据中各汉字的 `s` 字段）继续完整遵循 `ARPHICPL.TXT` 开放获取与再分发；任何人均可直接从公开构建产物提取或通过本仓库 `scripts/build.js` 复现，并在遵守 `ARPHICPL.TXT` 的前提下自由使用、复制、修改与再分发。
- **独立作品边界**（第 2 条末段）：本项目中并非衍生自文鼎字库的独立部分（前端界面、排版与导出引擎、构建/测试脚本及人工编写词表）属于独立作品，不受 `ARPHICPL.TXT` 传染。

---

## 2. `pinyin-pro`

- **版本**：`3.29.5`
- **来源**：[zh-lx/pinyin-pro](https://github.com/zh-lx/pinyin-pro)
- **用途**：构建期查询汉字标准拼音与多音字读音，及 `scripts/check-polyphones.js` 例词读音一致性校验。
- **许可证**：**MIT License**

```text
MIT License

Copyright (c) 2022-present zh-lx

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 3. `@pinyin-pro/data`

- **版本**：`1.3.1`
- **来源**：[chinese-data/pinyin-pro-data](https://github.com/chinese-data/pinyin-pro-data)
- **用途**：仅在构建期由 `scripts/build.js` 与 `scripts/word-dict.js` 读取，用于补充现代常用字表及手写词表外汉字的常用推荐例词（经敏感词过滤与词频收敛）；原始词典文件不进入运行时代码。
- **许可证**：**ISC License**（npm 包 `package.json` 声明为 `ISC`；上游 GitHub 仓库标注 `MIT License`）

```text
ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
```

---

## 4. 仅开发测试依赖（不进入分发产物）

- **`jsdom`**（`31.0.1`，[jsdom/jsdom](https://github.com/jsdom/jsdom)）：**MIT License**，仅在开发与 CI 阶段用于运行 `tests/smoke.test.js` 冒烟测试，不打包或分发至 `dist/`。
