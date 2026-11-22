// 冒烟测试：在 jsdom 里加载 dist/index.html，检查字库、预览、多音字勾选与组词、Markdown 与 PDF 生成器
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');
const { checkPolyphones } = require('../scripts/check-polyphones');

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

    // 1. 检查「长」的数据里同时有 cháng 和 zhǎng
    const changData = w.eval('DB["长"]');
    assert.ok(changData && changData.p.includes('cháng') && changData.p.includes('zhǎng'), '「长」应同时包含 cháng 和 zhǎng');
    assert.ok(changData.w && changData.w['cháng'] && changData.w['zhǎng'], '「长」应包含 cháng 和 zhǎng 的默认例词');

    // 2. 检查多音字标题行显示全部勾选读音及例词，且冷僻读音默认不显示
    const zhongHead = () => d.querySelector('[data-char="种"] .head .py-line').textContent;
    const shuHead = () => d.querySelector('[data-char="数"] .head .py-line').textContent;
    assert.ok(zhongHead().includes('zhǒng') && zhongHead().includes('zhòng'), '「种」标题行应显示 zhǒng 和 zhòng：' + zhongHead());
    assert.ok(zhongHead().includes('种子') && zhongHead().includes('种花'), '「种」标题行应包含例词：' + zhongHead());
    assert.ok(!zhongHead().includes('chóng'), '「种」冷僻读音 chóng 默认不应显示');
    assert.ok(shuHead().includes('shù') && shuHead().includes('shǔ') && !shuHead().includes('shuò'), '「数」应默认显示 shù/shǔ 且隐藏冷僻音 shuò：' + shuHead());

    // 3. 取消勾选后，对应读音立即从预览消失
    const zhongCb = d.querySelector('#poly .pcard[data-char="种"] .ptag[data-py="zhòng"] input');
    assert.ok(zhongCb && zhongCb.checked, '「种」的 zhòng 初始应勾选');
    zhongCb.click();
    assert.ok(!zhongHead().includes('zhòng') && zhongHead().includes('zhǒng'), '取消勾选 zhòng 后应立即从预览消失：' + zhongHead());

    // 4. 勾选冷僻读音后仅显示拼音，且支持手动添加/删除组词
    const shuoCb = d.querySelector('#poly .pcard[data-char="数"] .ptag[data-py="shuò"] input');
    assert.ok(shuoCb && !shuoCb.checked, '「数」的 shuò 初始应未勾选');
    shuoCb.click();
    assert.ok(shuHead().includes('shuò'), '勾选 shuò 后标题行应显示 shuò：' + shuHead());
    w.addWords('数', 'shuò', '数见不鲜');
    assert.ok(shuHead().includes('数见不鲜'), '手动为 shuò 添加组词后应显示在标题行');
    w.delWord('种', 'zhǒng', '种子');
    assert.ok(!zhongHead().includes('种子'), '手动删除推荐组词后应从标题行消失');

    // 5. 普通汉字组词示例与增删测试
    const treeHead = () => d.querySelector('[data-char="树"] .head .py-line').textContent;
    assert.ok(treeHead().includes('shù') && treeHead().includes('大树'), '普通字「树」标题行应显示拼音和组词示例：' + treeHead());
    assert.ok(d.querySelectorAll('#singles .srow').length >= 7, '普通汉字组词设置区应列出非多音字');
    w.addWords('树', 'shù', '树干');
    assert.ok(treeHead().includes('树干'), '普通字手动添加组词后应显示在标题行');
    w.delWord('树', 'shù', '大树');
    assert.ok(!treeHead().includes('大树'), '普通字手动删除组词后应从标题行消失');

    // 6. 自定义拼音及组词同步显示并导出 Markdown
    w.addCustomPy('种', 'zhòng2');
    w.addWords('种', 'zhòng2', '测试组词');
    assert.ok(zhongHead().includes('zhòng2') && zhongHead().includes('测试组词'), '自定义拼音及例词应显示在标题行');
    const md = w.buildMd();
    assert.ok(md.includes('| 序号 | 汉字 | 拼音 | 例词 | 笔画数 |'), 'Markdown 表头应包含例词列');
    assert.ok(md.includes('测试组词') && md.includes('zhǒng / zhòng2'), 'Markdown 应包含所有保留读音和例词');
    assert.ok(md.includes('| 1 | 树 | shù | 树木、树叶、树干 |'), 'Markdown 应导出普通字的组词例词：' + md);

    // 7. 保留一键打印按钮顺序、配色，以及 PDF 生成器与校验脚本测试
    const btns = [...d.querySelectorAll('.opts button')].map((b) => b.id);
    assert.deepStrictEqual(btns, ['bprint', 'bpdf', 'bmd'], '按钮顺序应为：一键打印、导出 PDF、导出 Markdown');
    assert.ok(!d.getElementById('bprint').classList.contains('alt'), '一键打印应使用主色（红色）');
    assert.ok(d.getElementById('bpdf').classList.contains('alt') && d.getElementById('bmd').classList.contains('alt'), '导出 PDF 和导出 Markdown 应使用中色调');
    assert.strictEqual(typeof w.doPrint, 'function', '应提供 doPrint 打印函数');

    const pdf = w.makePdf([{ data: new Uint8Array([255, 216, 255]), w: 10, h: 10 }]);
    assert.ok(Buffer.from(pdf.p[0]).toString().startsWith('%PDF-1.4'), 'PDF 头不对');

    const badCheck = checkPolyphones({ 种: { zhòng: ['种子'] } });
    assert.ok(badCheck.warnings.length >= 1, '校验脚本应能报出故意写错读音的例词');

    console.log('冒烟测试通过：2 页预览、一键打印、多音字勾选与例词增删、自定义拼音、Markdown、校验脚本及 PDF 生成器正常');
    process.exit(0);
  } catch (e) {
    console.error('冒烟测试失败：' + e.message);
    process.exit(1);
  }
}, 6000);
