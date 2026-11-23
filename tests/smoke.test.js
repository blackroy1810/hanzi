// 冒烟测试：在 jsdom 里加载 dist/index.html，检查字库覆盖率、预览、多音字勾选与组词、一键打印、Markdown 与 PDF 生成器
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const { checkPolyphones } = require('../scripts/check-polyphones');
const { BLOCKED_RE } = require('../scripts/word-dict');
const { decodeGb2312Range } = require('../scripts/build');

const file = path.join(__dirname, '..', 'dist', 'index.html');
if (!fs.existsSync(file)) { console.error('请先运行 npm run build'); process.exit(1); }

const errors = [];
const vc = new VirtualConsole();
vc.on('jsdomError', (e) => errors.push(e.message));

const srcHtml = fs.readFileSync(file, 'utf8');
assert.ok(!srcHtml.includes('window.claude'), '产物不应包含遗留的 window.claude 死代码');
assert.ok(!srcHtml.includes('style.zoom'), '移动端预览缩放应使用 transform:scale 而非在 iOS Safari 下存在缺陷的 CSS zoom');
assert.ok(!srcHtml.includes('DCTDecode') && !srcHtml.includes('image/jpeg'), '导出引擎应升级为无损 FlateDecode 混合矢量 PDF，不应残留 JPEG 位图导出代码');

// 版权与第三方开源许可合规检查（All Rights Reserved + ARPHICPL 原封不动保留 + pinyin-pro 声明）
const rootDir = path.join(__dirname, '..');
const licenseTxt = fs.readFileSync(path.join(rootDir, 'LICENSE'), 'utf8');
assert.ok(licenseTxt.includes('All Rights Reserved') && licenseTxt.includes('THIRD_PARTY_LICENSES/ARPHICPL.TXT'), 'LICENSE 应声明保留全部权利并区分第三方开源数据');
const thirdPartyMd = fs.readFileSync(path.join(rootDir, 'THIRD_PARTY_LICENSES.md'), 'utf8');
assert.ok(thirdPartyMd.includes('hanzi-writer-data') && thirdPartyMd.includes('pinyin-pro') && thirdPartyMd.includes('@pinyin-pro/data'), 'THIRD_PARTY_LICENSES.md 应涵盖全部第三方数据依赖');
const upstreamArphic = fs.readFileSync(path.join(rootDir, 'node_modules', 'hanzi-writer-data', 'ARPHICPL.TXT'));
const repoArphic = fs.readFileSync(path.join(rootDir, 'THIRD_PARTY_LICENSES', 'ARPHICPL.TXT'));
const distArphic = fs.readFileSync(path.join(rootDir, 'dist', 'ARPHICPL.TXT'));
assert.ok(repoArphic.equals(upstreamArphic), 'THIRD_PARTY_LICENSES/ARPHICPL.TXT 必须与上游原文逐字节一致');
assert.ok(distArphic.equals(upstreamArphic), 'dist/ARPHICPL.TXT 必须与上游原文逐字节一致');
assert.ok(srcHtml.includes(upstreamArphic.toString('utf8')), 'dist/index.html 应内嵌原封不动的 ARPHICPL.TXT 全文');
assert.ok(srcHtml.includes('Modification Notice (APL Section 2a/2b') && srcHtml.includes('Copyright (c) 2022-present zh-lx'), 'dist/index.html 应内嵌笔画修改说明与 pinyin-pro 版权声明');

// jsdom 没有 DecompressionStream / CompressionStream / Blob.stream，这里用 Node 的 zlib 代替
const dom = new JSDOM(srcHtml, {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.Blob = class {
      constructor(p, opts) { this.p = p; this.type = (opts && opts.type) || ''; }
      stream() {
        const buf = Buffer.concat(this.p.map((x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x))));
        return { pipeThrough: (tr) => ({ op: tr.op, fmt: tr.fmt, buf }) };
      }
    };
    w.DecompressionStream = function (fmt) { this.op = 'decompress'; this.fmt = fmt; };
    w.CompressionStream = function (fmt) { this.op = 'compress'; this.fmt = fmt; };
    w.Response = function (x) {
      const run = () => {
        if (x.op === 'decompress' && x.fmt === 'gzip') return zlib.gunzipSync(x.buf);
        if (x.op === 'compress' && x.fmt === 'deflate') return zlib.deflateSync(x.buf);
        throw new Error(`不支持的测试流转换：${x.op}/${x.fmt}`);
      };
      this.json = async () => JSON.parse(run().toString());
      this.arrayBuffer = async () => {
        const out = run();
        return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
      };
    };
  },
});

// 轮询等待 DB 解压完成（去除固定 6 秒硬等待，超时上限 15 秒）
const deadline = Date.now() + 15000;
const poll = setInterval(() => {
  const w = dom.window;
  if (!w.eval('DB')) {
    if (Date.now() > deadline) {
      clearInterval(poll);
      console.error('冒烟测试失败：字库加载超时（>15s）');
      process.exit(1);
    }
    return;
  }
  clearInterval(poll);
  runTests(w, w.document);
}, 50);

async function runTests(w, d) {
  try {
    const setInp = (val) => {
      const inp = d.getElementById('inp');
      inp.value = val;
      inp.dispatchEvent(new w.Event('input'));
      w.flushInput();
    };
    assert.deepStrictEqual(errors, [], '页面有脚本错误：' + errors.join(' | '));
    assert.strictEqual(d.getElementById('msg').textContent, '', '字库未加载成功');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '默认 10 个字、每页 6 个，应有 2 页');
    assert.ok(d.querySelectorAll('#poly .pcard').length >= 2, '应出现多音字卡片（数、种等）');

    // 0. 日期年月日+星期、手填切换与下划线结构检查
    const dtValEl = d.querySelector('.sheet .top-r .dt-val');
    assert.ok(dtValEl && /^\d{4}年\d{1,2}月\d{1,2}日（[日一二三四五六]）$/.test(dtValEl.textContent), '默认页眉应自动填写年月日及星期：' + (dtValEl && dtValEl.textContent));
    const dtInput = d.getElementById('dt');
    dtInput.value = '2026-11-24';
    dtInput.dispatchEvent(new w.Event('change'));
    assert.strictEqual(d.querySelector('.sheet .top-r .dt-val').textContent, '2026年11月24日（二）', '切换日期选择器应同步更新年月日与星期');
    const dtBlank = d.getElementById('dtBlank');
    dtBlank.checked = true;
    dtBlank.dispatchEvent(new w.Event('change'));
    const topRText = d.querySelector('.sheet .top-r').textContent;
    assert.ok(topRText.includes('年') && topRText.includes('月') && topRText.includes('日（') && !d.querySelector('.sheet .top-r .dt-val'), '勾选手填后应保留年月日及星期空白下划线格式：' + topRText);
    assert.strictEqual(d.querySelectorAll('.sheet:first-child .top-r .u').length, 5, '手填模式应包含姓名+年月日星期共 5 条对齐下划线');
    dtBlank.checked = false;
    dtBlank.dispatchEvent(new w.Event('change'));

    // 0b. 空白田字格克制数量（6 - 当页字数，上限 5 行）与拼音书写间距检查
    const sheets = [...d.querySelectorAll('.sheet')];
    assert.strictEqual(sheets[0].querySelectorAll('.blank-row').length, 0, '满页 6 字不应追加空白田字格');
    assert.strictEqual(sheets[1].querySelectorAll('.blank-row').length, 2, '未满末页 4 字应追加 2 行空白田字格（6 - 4 = 2）');
    const p2BlankArea = sheets[1].querySelector('.blank-area');
    assert.ok(parseFloat(p2BlankArea.style.marginTop) >= 11, '空白区上方应保留足够拼音书写空间（≥11mm）');
    assert.ok(parseFloat(sheets[1].querySelector('.blank-row').style.marginBottom) >= 10, '空白行间距应保留足够拼音书写空间（≥10mm）');

    // 1. 扩容字库规模、相对路径压缩、组词覆盖率与少儿敏感词安全检查
    const db = w.eval('DB');
    const allChars = Object.keys(db);
    assert.ok(allChars.length >= 6900, `扩容后字库字数不足 6900：${allChars.length}`);
    const l1Set = new Set(decodeGb2312Range(0xb0, 0xd7));
    let withWords = 0;
    let l1WithWords = 0;
    const forbiddenSamples = new Set([
      '艾滋病', '梅毒', '痔疮', '上吊', '棺材', '花圈', '耳光', '雪茄', '鹰犬', '垃圾邮件', '回扣', '病灶',
    ]);
    for (const c of allChars) {
      assert.ok(Array.isArray(db[c].s) && db[c].s.length > 0, `字「${c}」缺少笔画数据`);
      for (const stroke of db[c].s) {
        assert.ok(/^M-?\d+/.test(stroke), `字「${c}」笔画路径格式异常：${stroke.slice(0, 20)}`);
      }
      const wm = db[c].w;
      if (wm) {
        const ws = Object.values(wm).flat();
        if (ws.length > 0) {
          withWords++;
          if (l1Set.has(c)) l1WithWords++;
        }
        for (const word of ws) {
          assert.ok(!BLOCKED_RE.test(word), `字「${c}」出现被过滤词条：「${word}」`);
          assert.ok(!forbiddenSamples.has(word), `字「${c}」出现已清理词条：「${word}」`);
        }
      }
    }
    const l1Coverage = l1WithWords / l1Set.size;
    const totalCoverage = withWords / allChars.length;
    assert.ok(l1Coverage >= 0.98, `GB2312 一级字组词覆盖率不足 98%：${l1WithWords}/${l1Set.size}`);
    assert.ok(totalCoverage >= 0.85, `全字库组词覆盖率不足 85%：${withWords}/${allChars.length}`);

    // 1b. 扩容字集验证：小学低年级高频字、日常用字与现代人名用字均已收录并可渲染
    const expandedChars = [...'蜻蜓蚯蚓蝌蚪螃鹦鹉鳄鲨莓橘桦榕筝毽粽喆垚啰梓萱睿皓宸沐潇'];
    for (const c of expandedChars) {
      assert.ok(db[c], `扩容字库应包含「${c}」`);
    }
    // 1c. 无词多音字默认仅勾选首音（避免冷僻读音全开）
    const noWordPoly = allChars.find((c) => db[c].p.length > 1 && !db[c].w);
    if (noWordPoly) {
      const defOnList = db[noWordPoly].p.filter((py) => w.isDefOn(noWordPoly, py));
      assert.deepStrictEqual(defOnList, [db[noWordPoly].p[0]], `无词多音字「${noWordPoly}」应默认仅勾选首音`);
    }

    // 2. 检查「长」的数据里同时有 cháng 和 zhǎng
    const changData = db['长'];
    assert.ok(changData && changData.p.includes('cháng') && changData.p.includes('zhǎng'), '「长」应同时包含 cháng 和 zhǎng');
    assert.ok(changData.w && changData.w['cháng'] && changData.w['zhǎng'], '「长」应包含 cháng 和 zhǎng 的默认例词');

    // 3. 检查多音字标题行显示全部勾选读音及例词，且冷僻读音默认不显示
    const headOf = (c) => d.querySelector(`[data-char="${c}"] .head .py-line`).textContent;
    assert.ok(headOf('种').includes('zhǒng') && headOf('种').includes('zhòng'), '「种」标题行应显示 zhǒng 和 zhòng：' + headOf('种'));
    assert.ok(headOf('种').includes(db['种'].w['zhǒng'][0]) && headOf('种').includes(db['种'].w['zhòng'][0]), '「种」标题行应包含例词：' + headOf('种'));
    assert.ok(!headOf('种').includes('chóng'), '「种」冷僻读音 chóng 默认不应显示');
    assert.ok(headOf('数').includes('shù') && headOf('数').includes('shǔ') && !headOf('数').includes('shuò'), '「数」应默认显示 shù/shǔ 且隐藏冷僻音 shuò：' + headOf('数'));

    // 4. 取消勾选后，对应读音立即从预览消失；但禁止取消最后一个读音，且局部更新不重建无关卡片
    const shuCardBefore = d.querySelector('#poly .pcard[data-char="数"]');
    const zhongCb = d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhòng"] input');
    assert.ok(zhongCb && zhongCb.checked, '「种」的 zhòng 初始应勾选');
    zhongCb.click();
    assert.ok(!headOf('种').includes('zhòng') && headOf('种').includes('zhǒng'), '取消勾选 zhòng 后应立即从预览消失：' + headOf('种'));
    assert.strictEqual(d.querySelector('#poly .pcard[data-char="数"]'), shuCardBefore, '局部更新「种」不应销毁重建无关的「数」卡片');
    const zhongLastCb = d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhǒng"] input');
    zhongLastCb.click();
    assert.ok(headOf('种').includes('zhǒng'), '不能取消多音字最后一个已勾选读音：' + headOf('种'));
    assert.ok(d.getElementById('msg').textContent.includes('至少保留一个读音'), '尝试取消最后一个读音应提示用户');

    // 5. 勾选冷僻读音后仅显示拼音，且支持手动添加/删除组词
    const shuoCb = d.querySelector('#poly .pcard[data-char="数"] .ptag[data-py="shuò"] input');
    assert.ok(shuoCb && !shuoCb.checked, '「数」的 shuò 初始应未勾选');
    shuoCb.click();
    assert.ok(headOf('数').includes('shuò'), '勾选 shuò 后标题行应显示 shuò：' + headOf('数'));
    w.addWords('数', 'shuò', '数见不鲜');
    assert.ok(headOf('数').includes('数见不鲜'), '手动为 shuò 添加组词后应显示在标题行');
    const firstZhongWord = db['种'].w['zhǒng'][0];
    w.delWord('种', 'zhǒng', firstZhongWord);
    assert.ok(!headOf('种').includes(firstZhongWord), '手动删除推荐组词后应从标题行消失');

    // 6. 普通汉字组词增删与单音字轻量改音测试（动态读取词表，不硬编码具体词）
    const treePy = db['树'].p[0];
    const treeDefWords = db['树'].w[treePy];
    assert.ok(treeDefWords.length >= 2, '「树」应有至少 2 个推荐组词');
    assert.ok(headOf('树').includes(treePy) && headOf('树').includes(treeDefWords[0]), '普通字「树」标题行应显示拼音和组词示例：' + headOf('树'));
    assert.ok(d.querySelectorAll('#singles .srow').length >= 7, '普通汉字组词设置区应列出非多音字');
    const bridgeRowBefore = d.querySelector('#singles .srow[data-char="桥"]');
    w.addWords('树', treePy, '树干');
    assert.ok(headOf('树').includes('树干'), '普通字手动添加组词后应显示在标题行');
    assert.strictEqual(d.querySelector('#singles .srow[data-char="桥"]'), bridgeRowBefore, '局部更新普通字「树」不应重建无关的「桥」行');
    w.setSinglePy('桥', 'qiáo2');
    assert.ok(headOf('桥').includes('qiáo2') && headOf('桥').includes(db['桥'].w[db['桥'].p[0]][0]), '单音字改音后应显示新拼音并保留原有组词：' + headOf('桥'));
    w.setSinglePy('桥', '');
    assert.ok(headOf('桥').includes('qiáo') && !headOf('桥').includes('qiáo2'), '单音字清空自定义拼音后应恢复默认读音');
    w.delWord('树', treePy, treeDefWords[0]);
    assert.ok(!headOf('树').includes(treeDefWords[0]), '普通字手动删除组词后应从标题行消失');

    // 7. 自定义拼音及组词同步显示并导出 Markdown
    w.addCustomPy('种', 'zhòng2');
    w.addWords('种', 'zhòng2', '测试组词');
    assert.ok(headOf('种').includes('zhòng2') && headOf('种').includes('测试组词'), '自定义拼音及例词应显示在标题行');
    const md = w.buildMd();
    assert.ok(md.includes('| 序号 | 汉字 | 拼音 | 例词 | 笔画数 |'), 'Markdown 表头应包含例词列');
    assert.ok(md.includes('测试组词') && md.includes('zhǒng / zhòng2'), 'Markdown 应包含所有保留读音和例词');
    assert.ok(/生成日期：\d{4}年\d{1,2}月\d{1,2}日（[日一二三四五六]）/.test(md), 'Markdown 应使用年月日+星期格式');
    const expectedTreeMd = [...treeDefWords.slice(1), '树干'].join('、');
    assert.ok(md.includes(`| 1 | 树 | ${treePy} | ${expectedTreeMd} |`), 'Markdown 应导出普通字的组词例词：' + md);

    // 8. 换一批不在手写词表的生字：非多音字自动出词 + 未收录多音字收敛冷僻音
    const newOrdinary = ['蝉', '棉', '骑', '桂', '菊', '稻', '梁', '蚁', '莲', '舅', '饿', '渴', '缸', '碗', '盆', '锅'];
    setInp(newOrdinary.join('') + '燕蚂姥少');
    for (const c of newOrdinary) {
      const wdEl = d.querySelector(`[data-char="${c}"] .head .wd`);
      assert.ok(wdEl && wdEl.textContent.trim().length > 0, `非手写词表的普通字「${c}」应自动生成推荐组词`);
    }
    assert.ok(headOf('燕').includes('yàn') && !headOf('燕').includes('yān'), '「燕」应默认隐藏冷僻音 yān：' + headOf('燕'));
    assert.ok(headOf('蚂').includes('mǎ') && headOf('蚂').includes('mà') && !headOf('蚂').includes('mā'), '「蚂」应保留常用音 mǎ/mà 并隐藏冷僻音 mā：' + headOf('蚂'));
    assert.ok(headOf('姥').includes('lǎo') && !headOf('姥').includes('mǔ'), '「姥」应默认隐藏冷僻音 mǔ：' + headOf('姥'));
    assert.ok(headOf('少').includes('shǎo') && headOf('少').includes('shào'), '「少」应默认保留 shǎo 和 shào 及例词：' + headOf('少'));
    const md2 = w.buildMd();
    assert.ok(md2.includes('| 1 | 蝉 | chán |') && !md2.includes('| 1 | 蝉 | chán |  |'), '新批次普通字 Markdown 应包含推荐例词');

    // 9. 扩容字渲染 + 极少数无推荐词的字：显示空提示并自动展开普通汉字设置区
    setInp('蜻蜓蚯蚓蝌蚪喆垚捌');
    assert.strictEqual(d.getElementById('msg').textContent, '', '扩容字（蜻蜓蚯蚓蝌蚪喆垚）不应报暂无数据');
    assert.ok(d.querySelector('[data-char="蜻"] .head .wd').textContent.includes('蜻蜓'), '「蜻」应自动显示组词');
    const sboxDet = d.querySelector('#singles details');
    assert.ok(sboxDet && sboxDet.open, '输入无推荐组词的普通字时应自动展开普通汉字设置区');
    assert.ok(d.querySelector('#singles .wempty').textContent.includes('暂无推荐组词'), '无推荐组词时应显示提示文案');

    // 9b. 高笔画字自动折行（≥15画）与 1 字/4 字空白田字格上限与不溢出检查
    setInp('露霸罐矗藏警');
    const highBlocks = [...d.querySelectorAll('[data-wrapped="1"]')];
    assert.strictEqual(highBlocks.length, 6, '6 个 ≥15 画字均应触发两行笔顺折行');
    assert.strictEqual(d.querySelectorAll('.steps-r2').length, 6, '每个折行字均应渲染第二行笔顺格');
    const lay6High = w.layoutSheet([...'露霸罐矗藏警'], 6);
    const lastHigh = lay6High.blocks[lay6High.blocks.length - 1];
    assert.ok(lastHigh.y + lastHigh.h <= 287.1, `6 个高笔画字总高度不应溢出 A4 内容底边：${lastHigh.y + lastHigh.h}`);
    assert.ok(lay6High.blocks.every((b) => b.w >= 8.5), '6 个高笔画字折行后笔顺格宽应 ≥ 8.5mm');
    setInp('树');
    assert.strictEqual(d.querySelectorAll('.sheet .blank-row').length, 5, '1 字页下方应填 5 行空白田字格（硬上限 5 行）');
    const perSel = d.getElementById('per');
    perSel.value = '4';
    perSel.dispatchEvent(new w.Event('change'));
    setInp('树桥欢园');
    assert.strictEqual(d.querySelectorAll('.sheet .blank-row').length, 2, '每页 4 字下方应填 2 行空白田字格');
    perSel.value = '5';
    perSel.dispatchEvent(new w.Event('change'));
    setInp('树桥欢园活');
    assert.strictEqual(d.querySelectorAll('.sheet .blank-row').length, 0, '每页 5 字满页不应追加空白田字格');

    // 10. 一键打印按钮顺序、配色，以及 PDF 生成器与校验脚本测试
    const btns = [...d.querySelectorAll('.opts button')].map((b) => b.id);
    assert.deepStrictEqual(btns, ['bprint', 'bpdf', 'bmd'], '按钮顺序应为：一键打印、导出 PDF、导出 Markdown');
    assert.ok(!d.getElementById('bprint').classList.contains('alt'), '一键打印应使用主色（红色）');
    assert.ok(d.getElementById('bpdf').classList.contains('alt') && d.getElementById('bmd').classList.contains('alt'), '导出 PDF 和导出 Markdown 应使用中色调');
    assert.strictEqual(typeof w.doPrint, 'function', '应提供 doPrint 打印函数');

    // 10b. 原生混合矢量 PDF 引擎校验：SVG 路径转换、全库笔画无损转换、FlateDecode 内容流与无损贴图、多页 xref 字节偏移
    assert.strictEqual(
      w.svgPathToPdf('M0 0Q30 60 90 0Z'),
      '0 0 m 20 40 50 40 90 0 c h',
      '二次贝塞尔升阶三次贝塞尔控制点应精确满足 C1=P0+2/3(P1-P0), C2=P2+2/3(P1-P2)'
    );
    assert.strictEqual(
      w.svgPathToPdf('M100-50l20 30-10 5H200v-15q30 60 90 0c1 2 3 4 5 6Z'),
      '100 -50 m 120 -20 l 110 -15 l 200 -15 l 200 -30 l 220 10 250 10 290 -30 c 291 -28 293 -26 295 -24 c h',
      '相对/绝对路径、无空格负号紧贴及连续坐标应精确转换为 PDF 指令'
    );
    let totalStrokesChecked = 0;
    for (const c of allChars) {
      for (const stroke of db[c].s) {
        const pdfStroke = w.svgPathToPdf(stroke);
        assert.ok(/^-?\d+(?:\.\d+)? -?\d+(?:\.\d+)? m /.test(pdfStroke), `字「${c}」矢量路径转换异常：${pdfStroke.slice(0, 30)}`);
        assert.ok(!/NaN|undefined|Infinity/.test(pdfStroke), `字「${c}」矢量路径出现非法数值：${pdfStroke.slice(0, 40)}`);
        totalStrokesChecked++;
      }
    }

    const enc = new TextEncoder();
    const strokeCache = new Map();
    const layP1 = w.layoutSheet([...'露霸树桥数欢'], 6);
    const layP2 = w.layoutSheet([...'园活'], 6);
    const rawS1 = w.buildPageStream(layP1, 3, strokeCache, layP1.blocks.map((_, i) => 'H' + i), 'Top');
    const rawS2 = w.buildPageStream(layP2, 2, strokeCache, layP2.blocks.map((_, i) => 'H' + i), 'Top');
    assert.ok(!/NaN|undefined|Infinity/.test(rawS1 + rawS2), 'PDF 页面矢量内容流不应出现非法数值');
    const compS1 = await w.deflateBytes(enc.encode(rawS1));
    const compS2 = await w.deflateBytes(enc.encode(rawS2));
    assert.ok(compS1.length < rawS1.length * 0.25, `高密度矢量内容流 FlateDecode 压缩比应显著有效（${compS1.length}/${rawS1.length}）`);

    const topGrayRaw = new Uint8Array(16 * 4).fill(255);
    const headRgbRaw = new Uint8Array(16 * 4 * 3).fill(240);
    const topImg = { w: 16, h: 4, gray: true, data: await w.deflateBytes(topGrayRaw) };
    const headImg = { w: 16, h: 4, gray: false, data: await w.deflateBytes(headRgbRaw) };
    const makeImgs = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => ['H' + i, headImg]));

    const pdfBlob = w.makePdf(
      [
        { stream: compS1, images: makeImgs(layP1.blocks.length) },
        { stream: compS2, images: makeImgs(layP2.blocks.length) },
      ],
      { Top: topImg }
    );
    assert.strictEqual(pdfBlob.type, 'application/pdf', '导出 Blob MIME 应为 application/pdf');
    const pdfBuf = Buffer.concat(pdfBlob.p.map((x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x))));
    const pdfLat = pdfBuf.toString('latin1');
    assert.ok(pdfLat.startsWith('%PDF-1.4\n'), 'PDF 头部应为 %PDF-1.4');
    assert.ok(pdfLat.trimEnd().endsWith('%%EOF'), 'PDF 结尾应为 %%EOF');
    assert.ok(pdfLat.includes('/Count 2') && pdfLat.includes('/MediaBox[0 0 595.28 841.89]'), 'PDF 应声明 2 页 A4 物理尺寸');
    assert.ok(pdfLat.includes('/ColorSpace/DeviceGray') && pdfLat.includes('/ColorSpace/DeviceRGB'), '页眉应使用 DeviceGray，标题行应使用 DeviceRGB');
    assert.ok(!pdfLat.includes('/DCTDecode'), '混合矢量 PDF 不应使用有损 JPEG（DCTDecode）');

    // 验证 xref 字节偏移表精确指向每个 PDF 对象
    const sxMatch = pdfLat.match(/startxref\n(\d+)\n%%EOF/);
    assert.ok(sxMatch, 'PDF 缺少合法 startxref');
    const xrefOff = Number(sxMatch[1]);
    assert.ok(pdfLat.slice(xrefOff).startsWith('xref\n0 '), 'startxref 偏移未指向 xref 表起始位置');
    const xrefLines = pdfLat.slice(xrefOff).split('\n').filter((l) => /^\d{10} \d{5} [nf] ?$/.test(l));
    assert.ok(xrefLines.length >= 13, `PDF 对象数量异常：${xrefLines.length}`);
    for (let objNum = 1; objNum < xrefLines.length; objNum++) {
      const off = Number(xrefLines[objNum].slice(0, 10));
      assert.ok(
        pdfLat.slice(off, off + 20).startsWith(`${objNum} 0 obj\n`),
        `xref 对象 ${objNum} 偏移 ${off} 未精确指向对象头：${JSON.stringify(pdfLat.slice(off, off + 20))}`
      );
    }

    // 解压校验所有 FlateDecode 流（页眉灰度图、标题 RGB 图及两页矢量内容流）
    const streamRe = /<<([^>]+)>>\nstream\n/g;
    let m;
    let imageStreams = 0;
    const decodedPages = [];
    while ((m = streamRe.exec(pdfLat))) {
      const dict = m[1];
      assert.ok(dict.includes('/Filter/FlateDecode'), `流对象应使用 FlateDecode：${dict}`);
      const lenM = dict.match(/\/Length (\d+)/);
      assert.ok(lenM, `流对象缺少 /Length：${dict}`);
      const sLen = Number(lenM[1]);
      const dataStart = m.index + m[0].length;
      const inflated = zlib.inflateSync(pdfBuf.subarray(dataStart, dataStart + sLen));
      if (dict.includes('/Subtype/Image')) {
        const expectedBytes = dict.includes('/DeviceGray') ? topGrayRaw.length : headRgbRaw.length;
        assert.strictEqual(inflated.length, expectedBytes, '无损贴图流解压长度应精确匹配像素字节数');
        imageStreams++;
      } else {
        decodedPages.push(inflated.toString('utf8'));
      }
      streamRe.lastIndex = dataStart + sLen;
    }
    assert.strictEqual(imageStreams, 1 + layP1.blocks.length + layP2.blocks.length, '应包含 1 份共享页眉图 + 全部汉字标题行贴图');
    assert.strictEqual(decodedPages.length, 2, '应包含 2 页压缩矢量内容流');
    assert.strictEqual(decodedPages[0], rawS1, '第 1 页矢量内容流解压后应与原始内容完全一致');
    assert.strictEqual(decodedPages[1], rawS2, '第 2 页矢量内容流解压后应与原始内容完全一致');
    assert.ok(
      decodedPages[0].includes('/Top Do') && decodedPages[0].includes('/H0 Do') &&
      decodedPages[0].includes('0.863 0.604 0.573 RG') && decodedPages[0].includes('0.133 g') &&
      decodedPages[0].includes('0.784 g') && decodedPages[0].includes('0 g') &&
      decodedPages[0].includes('0.839 g') && decodedPages[0].includes(' re S') &&
      decodedPages[0].includes(' c ') && decodedPages[0].includes(' f\n'),
      '页面内容流应完整包含页眉/标题贴图引用、田字格虚线与外框及矢量笔画填充指令'
    );

    const realPoly = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'polyphones.json'), 'utf8'));
    const realCheck = checkPolyphones(realPoly, new Set(allChars));
    assert.strictEqual(realCheck.warnings.length, 0, '内置多音字表校验应无未核验告警：' + realCheck.warnings.join(' | '));
    const badCheck = checkPolyphones({ 种: { zhòng: ['种子'] } });
    assert.ok(badCheck.warnings.length >= 1, '校验脚本应能报出故意写错读音的例词');

    console.log(`冒烟测试通过：全字库 ${allChars.length} 字（${totalStrokesChecked} 条笔画矢量转换全通过；组词覆盖 ${withWords}/${allChars.length}，${(totalCoverage * 100).toFixed(1)}%；一级字 ${(l1Coverage * 100).toFixed(1)}%），混合矢量 PDF（首页流 ${(rawS1.length / 1024).toFixed(1)} KB → ${(compS1.length / 1024).toFixed(1)} KB）、排版折行、空白巩固区、日期下划线/手填、单音字改音、防空勾、局部保焦点、一键打印与 Markdown 均正常`);
    process.exit(0);
  } catch (e) {
    console.error('冒烟测试失败：' + e.message);
    process.exit(1);
  }
}
