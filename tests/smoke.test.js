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

// jsdom 没有 DecompressionStream / Blob.stream，这里用 Node 的 zlib 代替
const dom = new JSDOM(fs.readFileSync(file, 'utf8'), {
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  virtualConsole: vc,
  beforeParse(w) {
    w.Blob = class { constructor(p) { this.p = p; } stream() { return { pipeThrough: () => ({ gz: this.p[0] }) }; } };
    w.DecompressionStream = function () {};
    w.Response = function (x) { this.json = async () => JSON.parse(zlib.gunzipSync(Buffer.from(x.gz)).toString()); };
  },
});

setTimeout(() => {
  const w = dom.window, d = w.document;
  try {
    assert.deepStrictEqual(errors, [], '页面有脚本错误：' + errors.join(' | '));
    assert.strictEqual(d.getElementById('msg').textContent, '', '字库未加载成功');
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '默认 10 个字、每页 6 个，应有 2 页');
    assert.ok(d.querySelectorAll('#poly .pcard').length >= 2, '应出现多音字卡片（数、种等）');

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

    // 4. 取消勾选后，对应读音立即从预览消失
    const zhongCb = d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhòng"] input');
    assert.ok(zhongCb && zhongCb.checked, '「种」的 zhòng 初始应勾选');
    zhongCb.click();
    assert.ok(!headOf('种').includes('zhòng') && headOf('种').includes('zhǒng'), '取消勾选 zhòng 后应立即从预览消失：' + headOf('种'));

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

    // 6. 普通汉字组词示例与增删测试（动态读取词表，不硬编码具体词）
    const treePy = db['树'].p[0];
    const treeDefWords = db['树'].w[treePy];
    assert.ok(treeDefWords.length >= 2, '「树」应有至少 2 个推荐组词');
    assert.ok(headOf('树').includes(treePy) && headOf('树').includes(treeDefWords[0]), '普通字「树」标题行应显示拼音和组词示例：' + headOf('树'));
    assert.ok(d.querySelectorAll('#singles .srow').length >= 7, '普通汉字组词设置区应列出非多音字');
    w.addWords('树', treePy, '树干');
    assert.ok(headOf('树').includes('树干'), '普通字手动添加组词后应显示在标题行');
    w.delWord('树', treePy, treeDefWords[0]);
    assert.ok(!headOf('树').includes(treeDefWords[0]), '普通字手动删除组词后应从标题行消失');

    // 7. 自定义拼音及组词同步显示并导出 Markdown
    w.addCustomPy('种', 'zhòng2');
    w.addWords('种', 'zhòng2', '测试组词');
    assert.ok(headOf('种').includes('zhòng2') && headOf('种').includes('测试组词'), '自定义拼音及例词应显示在标题行');
    const md = w.buildMd();
    assert.ok(md.includes('| 序号 | 汉字 | 拼音 | 例词 | 笔画数 |'), 'Markdown 表头应包含例词列');
    assert.ok(md.includes('测试组词') && md.includes('zhǒng / zhòng2'), 'Markdown 应包含所有保留读音和例词');
    const expectedTreeMd = [...treeDefWords.slice(1), '树干'].join('、');
    assert.ok(md.includes(`| 1 | 树 | ${treePy} | ${expectedTreeMd} |`), 'Markdown 应导出普通字的组词例词：' + md);

    // 8. 换一批不在手写词表的生字：非多音字自动出词 + 未收录多音字收敛冷僻音
    const inp = d.getElementById('inp');
    const newOrdinary = ['蝉', '棉', '骑', '桂', '菊', '稻', '梁', '蚁', '莲', '舅', '饿', '渴', '缸', '碗', '盆', '锅'];
    inp.value = newOrdinary.join('') + '燕蚂姥少';
    inp.dispatchEvent(new w.Event('input'));
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
    inp.value = '蜻蜓蚯蚓蝌蚪喆垚捌';
    inp.dispatchEvent(new w.Event('input'));
    assert.strictEqual(d.getElementById('msg').textContent, '', '扩容字（蜻蜓蚯蚓蝌蚪喆垚）不应报暂无数据');
    assert.ok(d.querySelector('[data-char="蜻"] .head .wd').textContent.includes('蜻蜓'), '「蜻」应自动显示组词');
    const sboxDet = d.querySelector('#singles details');
    assert.ok(sboxDet && sboxDet.open, '输入无推荐组词的普通字时应自动展开普通汉字设置区');
    assert.ok(d.querySelector('#singles .wempty').textContent.includes('暂无推荐组词'), '无推荐组词时应显示提示文案');

    // 10. 一键打印按钮顺序、配色，以及 PDF 生成器与校验脚本测试
    const btns = [...d.querySelectorAll('.opts button')].map((b) => b.id);
    assert.deepStrictEqual(btns, ['bprint', 'bpdf', 'bmd'], '按钮顺序应为：一键打印、导出 PDF、导出 Markdown');
    assert.ok(!d.getElementById('bprint').classList.contains('alt'), '一键打印应使用主色（红色）');
    assert.ok(d.getElementById('bpdf').classList.contains('alt') && d.getElementById('bmd').classList.contains('alt'), '导出 PDF 和导出 Markdown 应使用中色调');
    assert.strictEqual(typeof w.doPrint, 'function', '应提供 doPrint 打印函数');

    const pdf = w.makePdf([{ data: new Uint8Array([255, 216, 255]), w: 10, h: 10 }]);
    assert.ok(Buffer.from(pdf.p[0]).toString().startsWith('%PDF-1.4'), 'PDF 头不对');

    const realPoly = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'polyphones.json'), 'utf8'));
    const realCheck = checkPolyphones(realPoly, new Set(allChars));
    assert.strictEqual(realCheck.warnings.length, 0, '内置多音字表校验应无未核验告警：' + realCheck.warnings.join(' | '));
    const badCheck = checkPolyphones({ 种: { zhòng: ['种子'] } });
    assert.ok(badCheck.warnings.length >= 1, '校验脚本应能报出故意写错读音的例词');

    console.log(`冒烟测试通过：全字库 ${allChars.length} 字（组词覆盖 ${withWords}/${allChars.length}，${(totalCoverage * 100).toFixed(1)}%；一级字 ${(l1Coverage * 100).toFixed(1)}%），扩容字渲染、敏感词过滤、冷僻音收敛、校验白名单、一键打印、Markdown 与 PDF 均正常`);
    process.exit(0);
  } catch (e) {
    console.error('冒烟测试失败：' + e.message);
    process.exit(1);
  }
}, 6000);
