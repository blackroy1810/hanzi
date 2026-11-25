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
  url: 'https://hanzi.local/',
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

    // 0. 日期年月日+星期、自动日期前置勾选框切换与下划线结构检查
    const dtAuto = d.getElementById('dtAuto');
    const dtInput = d.getElementById('dt');
    assert.ok(dtAuto && dtAuto.checked, '自动日期勾选框默认应勾选');
    assert.strictEqual(dtInput.style.display, '', '勾选自动日期时日期选择器应显示');
    const dtValEl = d.querySelector('.sheet .top-r .dt-val');
    assert.ok(dtValEl && /^\d{4}年\d{1,2}月\d{1,2}日（[日一二三四五六]）$/.test(dtValEl.textContent), '默认页眉应自动填写年月日及星期：' + (dtValEl && dtValEl.textContent));
    dtInput.value = '2026-11-24';
    dtInput.dispatchEvent(new w.Event('change'));
    assert.strictEqual(d.querySelector('.sheet .top-r .dt-val').textContent, '2026年11月24日（二）', '切换日期选择器应同步更新年月日与星期');
    dtAuto.checked = false;
    dtAuto.dispatchEvent(new w.Event('change'));
    assert.strictEqual(dtInput.style.display, 'none', '取消勾选自动日期应隐藏日期选择器');
    const topRText = d.querySelector('.sheet .top-r').textContent;
    assert.ok(topRText.includes('年') && topRText.includes('月') && topRText.includes('日（') && !d.querySelector('.sheet .top-r .dt-val'), '取消自动日期后应保留年月日及星期空白下划线格式：' + topRText);
    assert.strictEqual(d.querySelectorAll('.sheet:first-child .top-r .u').length, 5, '手填日期模式应包含姓名+年月日星期共 5 条对齐下划线');
    dtAuto.checked = true;
    dtAuto.dispatchEvent(new w.Event('change'));
    assert.strictEqual(dtInput.style.display, '', '重新勾选自动日期应恢复显示日期选择器');
    assert.strictEqual(d.querySelector('.sheet .top-r .dt-val').textContent, '2026年11月24日（二）', '重新勾选自动日期应保留已选日期');
    dtInput.value = '';
    dtInput.dispatchEvent(new w.Event('change'));
    assert.strictEqual(dtAuto.checked, false, '清空日期框应自动取消勾选自动日期');
    assert.strictEqual(dtInput.style.display, 'none', '清空日期框应隐藏日期选择器');
    dtAuto.checked = true;
    dtAuto.dispatchEvent(new w.Event('change'));
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(dtInput.value), '空值下重新勾选自动日期应恢复当天日期');

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
    const btns = [...d.querySelectorAll('.opts button:not(.mini)')].map((b) => b.id);
    assert.deepStrictEqual(btns, ['bprint', 'bpdf', 'bmd'], '主操作按钮顺序应为：一键打印、导出 PDF、导出 Markdown');
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

    // 11. 第二轮 #16：双面（笔顺+默写）/ 仅默写模式、1:1 配对防破页、乱序防连撞、搭档字描红/超纲兜底/切音与混合矢量 PDF
    // 恢复前面用例改动过的「种」「数」「树」默认状态
    w.resetWords('种', 'zhǒng');
    w.delCustomPy('种', 'zhòng2');
    if (!w.isOn('种', 'zhòng')) w.togglePy('种', 'zhòng', true);
    w.resetWords('数', 'shuò');
    if (w.isOn('数', 'shuò')) w.togglePy('数', 'shuò', false);
    w.resetWords('树', treePy);
    perSel.value = '6';
    perSel.dispatchEvent(new w.Event('change'));
    setInp('树桥数欢园种活极洗点');

    assert.ok(srcHtml.includes('.wpy.poly-py{cursor:default;background:transparent!important;text-decoration:none!important;border:0!important'), '@media print 下多音搭档字拼音不应残留任何边框、底色或虚线');

    const modeSel = d.getElementById('mode');
    const bshuf = d.getElementById('bshuf');
    const ghostWrap = d.getElementById('ghostWrap');
    const setMode = (m) => {
      modeSel.value = m;
      modeSel.dispatchEvent(new w.Event('change'));
    };

    // 11a. 控件显隐与三态页眉联动
    assert.strictEqual(modeSel.value, 'stroke', '默认模式应为笔顺（stroke）');
    assert.strictEqual(bshuf.style.display, 'none', '笔顺模式应隐藏乱序按钮');
    assert.strictEqual(ghostWrap.style.display, '', '笔顺模式应显示描红格');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '笔顺模式 10 字每页 6 字应为 2 页正面');

    setMode('duplex');
    assert.strictEqual(bshuf.style.display, '', '双面模式应显示乱序按钮');
    assert.strictEqual(ghostWrap.style.display, '', '双面模式应保留描红格');
    assert.strictEqual(w.localStorage.getItem('hz_mode_v1'), 'duplex', '模式应持久化到 localStorage');
    const duplexSheets = [...d.querySelectorAll('.sheet')];
    assert.strictEqual(duplexSheets.length, 4, '双面模式 2 组生字应严格按 1:1 输出 4 页（Front_0/Back_0/Front_1/Back_1）');
    assert.deepStrictEqual(
      duplexSheets.map((el) => el.dataset.sheet),
      ['front', 'back', 'front', 'back'],
      '双面模式应严格奇偶交替输出正面与反面'
    );
    assert.deepStrictEqual(
      duplexSheets.map((el) => el.querySelector('.top > span').textContent),
      ['汉字笔顺练习', '生字默写练习', '汉字笔顺练习', '生字默写练习'],
      '双面模式正反页眉标题应交替对应'
    );

    // 11b. 1:1 当页题源严格隔离（绝不跨页串字）+ 目标字空白 + 搭档字浅灰描红 + 叠词异音（数数）
    const p0Set = new Set([...'树桥数欢园种']);
    const p1Set = new Set([...'活极洗点']);
    const back0Groups = [...duplexSheets[1].querySelectorAll('.wgrp')];
    const back1Groups = [...duplexSheets[3].querySelectorAll('.wgrp')];
    assert.ok(back0Groups.length >= 6 && back1Groups.length >= 4, '反面默写应覆盖当页全部生字例词');
    const back0Targets = back0Groups.map((g) => g.dataset.target);
    const back1Targets = back1Groups.map((g) => g.dataset.target);
    assert.ok(back0Targets.every((t) => p0Set.has(t)), 'Back_0 严禁混入第 2 页生字：' + back0Targets.join(','));
    assert.ok(back1Targets.every((t) => p1Set.has(t)), 'Back_1 严禁混入第 1 页生字：' + back1Targets.join(','));
    p0Set.forEach((c) => assert.ok(back0Targets.includes(c), `Back_0 漏考当页生字「${c}」`));
    p1Set.forEach((c) => assert.ok(back1Targets.includes(c), `Back_1 漏考当页生字「${c}」`));

    // 目标字格必须为空白田字格，DB 内搭档字必须为 #d6d6d6 浅灰描红矢量笔画
    const targetCells = [...duplexSheets[1].querySelectorAll('.cell[data-role="target"]')];
    const partnerCells = [...duplexSheets[1].querySelectorAll('.cell[data-role="partner"][data-fallback="0"]')];
    assert.ok(targetCells.length > 0 && partnerCells.length > 0, '反面默写应同时包含目标空白格与搭档描红格');
    targetCells.forEach((el) => {
      assert.strictEqual(el.querySelectorAll('path,text').length, 0, '目标字格应为空白田字格，不含任何笔画或文字');
    });
    partnerCells.forEach((el) => {
      const paths = [...el.querySelectorAll('path')];
      assert.ok(paths.length > 0 && paths.every((p) => p.getAttribute('fill') === '#d6d6d6'), 'DB 内搭档字格应渲染 #d6d6d6 浅灰描红笔画');
    });
    // 校验「数数」末字异音 shǔ shù 与「数一数」双目标字 shǔ yī shǔ
    assert.strictEqual(w.resolveDictCellPy('数', 'shǔ', '数数', 0), 'shǔ', '「数数」首字应读 shǔ');
    assert.strictEqual(w.resolveDictCellPy('数', 'shǔ', '数数', 1), 'shù', '「数数」末字应智能识别为 shù');
    assert.strictEqual(w.resolveDictCellPy('数', 'shǔ', '数一数', 0), 'shǔ', '「数一数」首字应读 shǔ');
    assert.strictEqual(w.resolveDictCellPy('数', 'shǔ', '数一数', 2), 'shǔ', '「数一数」末字应读 shǔ');

    // 11c. 防相邻同字重排 + 乱序按钮四端同步一致
    for (let i = 1; i < back0Targets.length; i++) {
      assert.notStrictEqual(back0Targets[i], back0Targets[i - 1], `Back_0 相邻两题不应考同一个生字（位置 ${i - 1}/${i}：${back0Targets[i]}）`);
    }
    for (let i = 1; i < back1Targets.length; i++) {
      assert.notStrictEqual(back1Targets[i], back1Targets[i - 1], `Back_1 相邻两题不应考同一个生字（位置 ${i - 1}/${i}：${back1Targets[i]}）`);
    }
    // 边界防连撞压测（maxCount === ceil(N/2)，如 4A + 2B + 1C）
    const tightItems = [
      { target: '树', targetPy: 'shù', word: '大树' },
      { target: '树', targetPy: 'shù', word: '树叶' },
      { target: '树', targetPy: 'shù', word: '树林' },
      { target: '树', targetPy: 'shù', word: '树干' },
      { target: '桥', targetPy: 'qiáo', word: '大桥' },
      { target: '桥', targetPy: 'qiáo', word: '木桥' },
      { target: '欢', targetPy: 'huān', word: '欢乐' },
    ];
    const tightShuffled = w.shuffleDictItems(tightItems, 0);
    for (let i = 1; i < tightShuffled.length; i++) {
      assert.notStrictEqual(tightShuffled[i].target, tightShuffled[i - 1].target, '极限可行分布（maxCount=ceil(N/2)）仍应彻底消除相邻同字');
    }

    const beforeOrder = back0Groups.map((g) => g.dataset.target + ':' + g.dataset.word).join('|');
    const seedBefore = w.eval('shuffleSeed');
    bshuf.click();
    const seedAfter = w.eval('shuffleSeed');
    assert.notStrictEqual(seedAfter, seedBefore, '点击乱序应生成新随机种子');
    const afterBack0Groups = [...d.querySelectorAll('.sheet[data-sheet="back"]')[0].querySelectorAll('.wgrp')];
    const afterOrder = afterBack0Groups.map((g) => g.dataset.target + ':' + g.dataset.word).join('|');
    assert.notStrictEqual(afterOrder, beforeOrder, '点击乱序应改变反面默写词序');
    const plan0 = w.buildPagePlan(w.cur().ok, 6)[0];
    assert.strictEqual(
      plan0.dictItems.map((x) => x.target + ':' + x.word).join('|'),
      afterOrder,
      'PDF/布局计划与屏幕预览词序应 100% 一致'
    );
    const mdDuplex = w.buildMd();
    assert.ok(mdDuplex.includes('# 生字练习表') && mdDuplex.includes('## 反面默写练习') && mdDuplex.includes('### 第 1 页'), '双面模式 Markdown 应包含正面生字表与反面默写练习');
    const firstItemMd = w.formatDictItemMd(plan0.dictItems[0]);
    assert.ok(mdDuplex.includes('1. ' + firstItemMd), '双面模式 Markdown 反面默写顺序应与当前乱序严格同步：' + firstItemMd);

    // 11d. 仅默写模式控件与 Markdown
    setMode('dictation');
    assert.strictEqual(bshuf.style.display, '', '仅默写模式应显示乱序按钮');
    assert.strictEqual(ghostWrap.style.display, 'none', '仅默写模式应隐藏描红格');
    const dictOnlySheets = [...d.querySelectorAll('.sheet')];
    assert.strictEqual(dictOnlySheets.length, 2, '仅默写模式 10 字每页 6 字应只输出 2 页反面默写');
    assert.ok(dictOnlySheets.every((s) => s.dataset.sheet === 'back' && s.querySelector('.top > span').textContent === '生字默写练习'), '仅默写模式全部页面应为生字默写练习');
    const mdDictOnly = w.buildMd();
    assert.ok(mdDictOnly.startsWith('# 生字默写练习\n') && !mdDictOnly.includes('## 参考答案') && mdDictOnly.includes('（　）'), '仅默写模式 Markdown 应输出挖空题面且不含答案区');

    // 11e. 卡片增删组词实时联动、无词生字保底、超纲搭档字楷体兜底、多音搭档字语境定音与跨乱序切音保持
    setMode('duplex');
    setInp('琅捌大树');
    // 超纲搭档字「玕」（琅玕）楷体兜底
    const fbCell = d.querySelector('.sheet[data-sheet="back"] .cell[data-role="partner"][data-char="玕"][data-fallback="1"]');
    assert.ok(fbCell && fbCell.querySelector('text') && fbCell.querySelector('text').textContent === '玕' && fbCell.querySelector('text').getAttribute('fill') === '#d6d6d6', '超纲搭档字「玕」应回退渲染浅灰楷体 <text> 且不留白不报错');
    assert.strictEqual(w.resolveDictCellPy('琅', 'láng', '琅玕', 1), '', '超纲搭档字拼音应安全留空');
    // 无词生字「捌」保底单字默写项
    const baGrp = d.querySelector('.sheet[data-sheet="back"] .wgrp[data-target="捌"][data-word="捌"]');
    assert.ok(baGrp && baGrp.querySelectorAll('.cell[data-role="target"]').length === 1, '无例词生字「捌」应保底生成单字默写项');
    // 卡片增删组词实时同步反面默写 + 多音搭档字语境定音（大 -> 长大 中「长」应定音 zhǎng）
    const daPy = db['大'].p[0];
    w.addWords('大', daPy, '长大');
    const zhangDaPyEl = d.querySelector(`.sheet[data-sheet="back"] .wpy.poly-py[data-target="大"][data-word="长大"][data-ci="0"]`);
    assert.ok(zhangDaPyEl && zhangDaPyEl.textContent === 'zhǎng', '新增组词「长大」应实时同步反面默写且多音搭档字「长」自动定音 zhǎng');
    // 点击多音搭档字切换读音，并在点击「乱序」及重载后依然跟随该词保持！
    zhangDaPyEl.click();
    assert.strictEqual(
      d.querySelector('.sheet[data-sheet="back"] .wpy.poly-py[data-target="大"][data-word="长大"][data-ci="0"]').textContent,
      'cháng',
      '点击多音搭档字「长」应就地切换读音为 cháng'
    );
    const savedPartner = JSON.parse(w.localStorage.getItem('hz_partner_py_v1') || '{}');
    assert.strictEqual(savedPartner[`大:${daPy}:长大:0`], 'cháng', '搭档字切音应按 target:targetPy:word:ci 键持久化');
    bshuf.click();
    assert.strictEqual(
      d.querySelector('.sheet[data-sheet="back"] .wpy.poly-py[data-target="大"][data-word="长大"][data-ci="0"]').textContent,
      'cháng',
      '点击乱序重排后，手动切换的搭档字读音应依然稳固跟随该词'
    );
    w.eval('partnerPy={}');
    w.loadUiState();
    w.render();
    assert.strictEqual(
      d.querySelector('.sheet[data-sheet="back"] .wpy.poly-py[data-target="大"][data-word="长大"][data-ci="0"]').textContent,
      'cháng',
      '刷新重载后搭档字切音覆盖应从 localStorage 完整恢复'
    );
    // 清理：切回默认 + 删除临时词验证实时消失
    d.querySelector('.sheet[data-sheet="back"] .wpy.poly-py[data-target="大"][data-word="长大"][data-ci="0"]').click();
    w.delWord('大', daPy, '长大');
    assert.strictEqual(d.querySelector('.sheet[data-sheet="back"] .wgrp[data-target="大"][data-word="长大"]'), null, '删除卡片组词后反面默写应立即移除对应词条');
    w.resetWords('大', daPy);

    // 11f. 极端 50+ 词单页刚性防破页压测 + 超长自定义词安全切分
    const stressItems = [];
    for (let i = 0; i < 60; i++) {
      const c = ['树', '桥', '欢', '园', '活', '极'][i % 6];
      const wTxt = i % 3 === 0 ? c + '林' : (i % 3 === 1 ? '大' + c : c + '一' + c);
      stressItems.push({ target: c, targetPy: db[c].p[0], word: wTxt });
    }
    stressItems.push({ target: '树', targetPy: db['树'].p[0], word: '大树小树老树新树青树绿树高树矮树松树柏树' });
    const stressLay = w.layoutDictPage(stressItems);
    assert.ok(stressLay.rows.length > 0 && stressLay.cellMm < 17, `单页塞入 61 词应触发自适应压缩（cellMm=${stressLay.cellMm}）`);
    const lastStressRow = stressLay.rows[stressLay.rows.length - 1];
    assert.ok(lastStressRow.cellY + stressLay.cellMm <= 287.01, `61 词极端压测单页底边严禁溢出 287mm：${lastStressRow.cellY + stressLay.cellMm}`);
    stressLay.rows.forEach((r) => {
      const lastIt = r.items[r.items.length - 1];
      assert.ok(lastIt.x + lastIt.w <= 183.51, `极端压测含超长词行宽严禁溢出 183.5mm：${lastIt.x + lastIt.w}`);
    });

    // 11g. 双面/反面混合矢量 PDF 流（含超纲搭档字 /F0）、多页共享页眉（/Top + /TopBack）、xref 偏移与 FlateDecode 解压校验
    const langPlan = w.buildPagePlan([...'琅树桥欢'], 6)[0];
    const langDictLay = w.layoutDictPage(langPlan.dictItems);
    const backRaw = w.buildDictPageStream(
      langDictLay,
      strokeCache,
      langDictLay.rows.map((_, i) => 'P' + i),
      'TopBack',
      { 玕: 'F0' }
    );
    assert.ok(!/NaN|undefined|Infinity/.test(backRaw), '反面默写 PDF 矢量流不应出现非法数值');
    assert.ok(
      backRaw.includes('/TopBack Do') && backRaw.includes('/P0 Do') && backRaw.includes('/F0 Do') &&
      backRaw.includes('0.839 g') && backRaw.includes(' re S') && !backRaw.includes('0.133 g'),
      '反面默写 PDF 流应包含 /TopBack、/P0、超纲搭档字 /F0、浅灰搭档笔画 0.839 g 且不含深色全字笔画'
    );
    const backComp = await w.deflateBytes(enc.encode(backRaw));
    const backImgs = Object.fromEntries(langDictLay.rows.map((_, i) => ['P' + i, topImg]));
    backImgs.F0 = topImg;
    const duplexPdfBlob = w.makePdf(
      [
        { stream: compS1, images: makeImgs(layP1.blocks.length) },
        { stream: backComp, images: backImgs },
      ],
      { Top: topImg, TopBack: topImg }
    );
    const dPdfBuf = Buffer.concat(duplexPdfBlob.p.map((x) => (typeof x === 'string' ? Buffer.from(x) : Buffer.from(x))));
    const dPdfLat = dPdfBuf.toString('latin1');
    assert.ok(dPdfLat.includes('/Count 2') && dPdfLat.includes('/Top ') && dPdfLat.includes('/TopBack '), '双面 PDF 应包含 2 页并共享 /Top 与 /TopBack 页眉');
    const dSx = dPdfLat.match(/startxref\n(\d+)\n%%EOF/);
    assert.ok(dSx && dPdfLat.slice(Number(dSx[1])).startsWith('xref\n0 '), '双面 PDF startxref 应有效');
    const dXrefLines = dPdfLat.slice(Number(dSx[1])).split('\n').filter((l) => /^\d{10} \d{5} [nf] ?$/.test(l));
    for (let objNum = 1; objNum < dXrefLines.length; objNum++) {
      const off = Number(dXrefLines[objNum].slice(0, 10));
      assert.ok(dPdfLat.slice(off, off + 20).startsWith(`${objNum} 0 obj\n`), `双面 PDF xref 对象 ${objNum} 偏移无效`);
    }
    const dStreamRe = /<<([^>]+)>>\nstream\n/g;
    const dDecoded = [];
    let dm;
    while ((dm = dStreamRe.exec(dPdfLat))) {
      const lenM = dm[1].match(/\/Length (\d+)/);
      const sLen = Number(lenM[1]);
      const start = dm.index + dm[0].length;
      const inf = zlib.inflateSync(dPdfBuf.subarray(start, start + sLen));
      if (!dm[1].includes('/Subtype/Image')) dDecoded.push(inf.toString('utf8'));
      dStreamRe.lastIndex = start + sLen;
    }
    assert.deepStrictEqual(dDecoded, [rawS1, backRaw], '双面 PDF 正反两页矢量流解压后应与原始内容完全一致');

    // 11h. 仅默写模式专属反选去字/去音、紧凑合页、搭档字兜底、全反选空态拦截与跨模式守恒
    setInp('树桥数欢园种活极洗点');
    perSel.value = '6';
    perSel.dispatchEvent(new w.Event('change'));
    w.eval('singlesOpen=null');

    // stroke 与 duplex 下严禁取消多音字最后读音，且普通单音字无反选框
    for (const m of ['stroke', 'duplex']) {
      setMode(m);
      assert.strictEqual(d.querySelectorAll('#singles .s-cb').length, 0, `${m} 模式下普通单音字不应出现反选勾选框`);
      w.togglePy('数', 'shǔ', false);
      w.togglePy('数', 'shù', false);
      assert.strictEqual(w.activeEntries('数').length, 1, `${m} 模式下严禁取消多音字最后一个读音`);
      assert.ok(d.getElementById('msg').textContent.includes('至少保留一个读音'), `${m} 模式尝试清空多音字读音应提示`);
      w.togglePy('数', 'shǔ', true);
    }

    // 切换至 dictation（仅默写）：自动展开 #singles 且展示已选字数
    setMode('dictation');
    const dictSinglesDet = d.querySelector('#singles details');
    assert.ok(dictSinglesDet && dictSinglesDet.open, '仅默写模式下（未手动折叠时）应自动展开普通汉字设置面板');
    assert.ok(dictSinglesDet.querySelector('summary').textContent.includes('普通汉字默写与组词设置（已选 '), '仅默写模式 summary 应展示已选字数');
    assert.ok(d.querySelectorAll('#singles .s-cb').length >= 7, '仅默写模式普通单音字行应展示反选勾选框');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '10 字未反选时应有 2 页默写纸');

    // 允许取消多音字「数」的全部读音（0 读音），且彻底消失（不触发单字保底）
    d.querySelector('#poly .pcard[data-char="数"] .ptag[data-py="shù"] input').click();
    d.querySelector('#poly .pcard[data-char="数"] .ptag[data-py="shǔ"] input').click();
    const shuCardOff = d.querySelector('#poly .pcard[data-char="数"]');
    assert.ok(shuCardOff && shuCardOff.classList.contains('off') && !shuCardOff.querySelector('.pw-list'), '全反选多音字后卡片应呈现弱化态并隐藏词列表');
    assert.strictEqual(w.activeEntries('数').length, 0, '仅默写模式下多音字「数」应允许 0 读音');
    assert.strictEqual(d.querySelector('.sheet .wgrp[data-target="数"]'), null, '0 读音的「数」不应再出现在预览默写卷（不触发单字保底）');

    // 反选 5 个普通单音字（共跳过 6 字，剩余 4 字），10 字从 2 页自动紧凑合并为 1 页
    for (const ch of ['树', '桥', '欢', '园', '活']) {
      d.querySelector(`#singles .srow[data-char="${ch}"] .s-cb`).click();
      assert.ok(d.querySelector(`#singles .srow[data-char="${ch}"]`).classList.contains('off'), `反选普通字「${ch}」后该行应弱化显示`);
    }
    assert.strictEqual(d.querySelectorAll('.sheet').length, 1, '10 字反选 6 字后，剩余 4 字应紧凑合为 1 页默写纸');
    const compactPlans = w.buildPagePlan(w.cur().ok, 6);
    assert.strictEqual(compactPlans.length, 1, 'PDF/布局分页计划也应同步紧凑为 1 页');
    assert.ok(compactPlans[0].dictItems.every((it) => !['数', '树', '桥', '欢', '园', '活'].includes(it.target)), '反选字的词条不应进入 PDF 分页计划');
    const compactMd = w.buildMd();
    assert.ok(!compactMd.includes('### 第 2 页'), 'Markdown 紧凑合页后不应再出现第 2 页');
    assert.ok(!compactMd.includes('数学') && !compactMd.includes('大（　）') && compactMd.includes('（　）树'), 'Markdown 应彻底移除反选字「数」「树」的题目，同时保留「种树」的搭档字「树」：' + compactMd);
    assert.ok(!compactPlans[0].dictItems.some((it) => it.target === '数' || it.target === '树'), '反选目标字彻底从题源移除');
    // 验证被反选的「树」作为「种」的例词「种树」搭档字出现时，依然有浅灰描红与拼音 shù
    const zhongShuGrp = d.querySelector('.sheet .wgrp[data-target="种"][data-word="种树"]');
    assert.ok(zhongShuGrp, '未反选的「种」应保留例词「种树」');
    const shuPartnerCell = zhongShuGrp.querySelector('.cell[data-role="partner"][data-char="树"]');
    const shuPartnerPy = zhongShuGrp.querySelector('.wpy[data-char="树"]');
    assert.ok(shuPartnerCell && shuPartnerCell.querySelectorAll('path').length > 0, '被反选的「树」作为搭档字仍应有浅灰描红笔画');
    assert.strictEqual(shuPartnerPy && shuPartnerPy.textContent, 'shù', '被反选的「树」作为搭档字仍应显示拼音 shù');
    assert.strictEqual(w.findPartnerContextPy('数个', 0), 'shù', '被全反选的多音字「数」作为搭档字回退时仍应有默认拼音');

    // 验证普通单音字点击拼音文本仍可改音且不与勾选框冲突
    const jiPyEdit = d.querySelector('#singles .srow[data-char="极"] .pw-py.py-edit');
    jiPyEdit.click();
    assert.ok(d.querySelector('#singles .srow[data-char="极"] .py-inp'), '仅默写模式下点击单音字拼音文本仍应打开 inline 改音框');
    assert.strictEqual(w.isSingleOn('极'), true, '点击拼音改音不应误触发反选勾选框');
    w.setSinglePy('极', '');

    // 全反选 0 字时的空态提示与打印/PDF/Markdown 拦截
    d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhǒng"] input').click();
    d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhòng"] input').click();
    d.querySelector('#poly .pcard[data-char="洗"] .ptag[data-py="xǐ"] input').click();
    for (const ch of ['极', '点']) {
      d.querySelector(`#singles .srow[data-char="${ch}"] .s-cb`).click();
    }
    assert.strictEqual(d.querySelectorAll('.sheet').length, 0, '全反选后不应渲染空白 A4 页');
    assert.ok(d.getElementById('root').textContent.includes('已反选全部读音'), '全反选后预览区应显示清晰空态提示');
    w.doPrint();
    assert.ok(d.getElementById('msg').textContent.includes('请至少勾选一个需要默写的读音'), '全反选点击打印应拦截提示');
    d.getElementById('msg').textContent = '';
    await w.exportPdf();
    assert.ok(d.getElementById('msg').textContent.includes('请至少勾选一个需要默写的读音'), '全反选导出 PDF 应拦截提示');
    d.getElementById('msg').textContent = '';
    await w.exportMd();
    assert.ok(d.getElementById('msg').textContent.includes('请至少勾选一个需要默写的读音'), '全反选导出 Markdown 应拦截提示');

    // 跨模式守恒：从全反选的 dictation 切回 stroke / duplex 时自动恢复默认读音，未改动再切回 dictation 保留原反选状态
    setMode('stroke');
    assert.strictEqual(d.getElementById('msg').textContent, '', '切换模式应清空残留拦截提示');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '切回笔顺模式应自动恢复全部 10 字 2 页');
    assert.strictEqual(w.activeEntries('数').length, 2, '切回笔顺模式时全反选多音字「数」应自动恢复默认读音');
    assert.strictEqual(w.activeEntries('树').length, 1, '切回笔顺模式时反选单音字「树」应自动恢复激活');
    setMode('duplex');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 4, '切至双面模式应自动恢复完整 4 页 1:1 配对');
    setMode('dictation');
    assert.strictEqual(w.activeEntries('数').length, 0, '未在笔顺/双面改动时切回仅默写应保留原全反选状态');
    assert.strictEqual(w.activeEntries('树').length, 0, '未在笔顺/双面改动时切回仅默写应保留单音字反选状态');

    // 在笔顺模式下对曾全反选的「数」主动取消 1 个读音，应先具体化默认态再变更，绝不掉回 0 读音
    setMode('stroke');
    d.querySelector('#poly .pcard[data-char="数"] .ptag[data-py="shǔ"] input').click();
    assert.deepStrictEqual([...w.activeEntries('数').map((e) => e.p)], ['shù'], '笔顺下操作曾全反选的多音字应具体化默认勾选再应用变更，保留 shù');
    w.togglePy('数', 'shǔ', true);

    // 清理测试中写入的 dictation 反选状态并恢复默认笔顺模式
    setMode('dictation');
    w.togglePy('种', 'zhǒng', true);
    w.togglePy('种', 'zhòng', true);
    w.togglePy('洗', 'xǐ', true);
    for (const ch of ['树', '桥', '欢', '园', '活', '极', '点']) {
      w.toggleSingleOn(ch, true);
    }
    setMode('stroke');
    assert.strictEqual(errors.length, 0, '双面/默写模式测试过程不应产生任何脚本错误：' + errors.join(' | '));

    console.log(`冒烟测试通过：全字库 ${allChars.length} 字（${totalStrokesChecked} 条笔画矢量转换全通过；组词覆盖 ${withWords}/${allChars.length}，${(totalCoverage * 100).toFixed(1)}%；一级字 ${(l1Coverage * 100).toFixed(1)}%），混合矢量 PDF（首页流 ${(rawS1.length / 1024).toFixed(1)} KB → ${(compS1.length / 1024).toFixed(1)} KB）、双面正反 1:1 默写（乱序防连撞、61 词单页防破页、超纲楷体兜底、搭档字切音）、仅默写反选去字合页、自动日期、排版折行、空白巩固区、单音字改音、防空勾、局部保焦点、一键打印与 Markdown 均正常`);
    process.exit(0);
  } catch (e) {
    console.error('冒烟测试失败：' + e.message);
    process.exit(1);
  }
}
