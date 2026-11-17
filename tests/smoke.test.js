// 冒烟测试：在 jsdom 里加载 dist/index.html，检查字库、预览、多音字、PDF 生成器
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const assert = require('assert');

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
    assert.strictEqual(d.querySelectorAll('.sheet').length, 2, '默认 10 个字、每页 5 个，应有 2 页');
    assert.ok(d.querySelectorAll('#poly .i').length >= 2, '应出现多音字下拉框（数、种等）');
    const heads = [...d.querySelectorAll('.py')].map((e) => e.textContent);
    assert.ok(heads.includes('shù') && heads.includes('zhǒng'), '默认读音不对：' + heads.join(' '));
    const pdf = w.makePdf([{ data: new Uint8Array([255, 216, 255]), w: 10, h: 10 }]);
    assert.ok(Buffer.from(pdf.p[0]).toString().startsWith('%PDF-1.4'), 'PDF 头不对');
    console.log('冒烟测试通过：2 页预览、多音字下拉、PDF 生成器正常');
    process.exit(0);
  } catch (e) {
    console.error('冒烟测试失败：' + e.message);
    process.exit(1);
  }
}, 6000);
