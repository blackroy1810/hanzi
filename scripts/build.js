// 构建：从开源数据生成字库，嵌入 src/app.html，输出 dist/index.html
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pinyin } = require('pinyin-pro');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'node_modules', 'hanzi-writer-data');

// 字表：GB2312 一级字（约 3755 个常用字），按区位码解码得到
function commonChars() {
  const dec = new TextDecoder('gb2312');
  const out = [];
  for (let hi = 0xb0; hi <= 0xd7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const c = dec.decode(Uint8Array.from([hi, lo]));
      if (c.length === 1 && /[\u4e00-\u9fff]/.test(c)) out.push(c);
    }
  }
  return out;
}

function buildDb() {
  const db = {};
  let missing = 0;
  for (const c of commonChars()) {
    const f = path.join(dataDir, c + '.json');
    if (!fs.existsSync(f)) { missing++; continue; }
    const strokes = JSON.parse(fs.readFileSync(f, 'utf8')).strokes;
    const def = pinyin(c, { toneType: 'symbol' });
    const all = pinyin(c, { multiple: true, toneType: 'symbol', type: 'array' }).flat();
    const py = [def, ...new Set(all.filter((x) => x !== def))];
    db[c] = { p: py, s: strokes };
  }
  return { db, missing };
}

const { db, missing } = buildDb();
const count = Object.keys(db).length;
if (count < 3500) throw new Error('字库字数异常：' + count);

const b64 = zlib.gzipSync(JSON.stringify(db), { level: 9 }).toString('base64');
const tpl = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
if (!tpl.includes('__DB__')) throw new Error('src/app.html 缺少 __DB__ 占位符');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outFile = path.join(root, 'dist', 'index.html');
fs.writeFileSync(outFile, tpl.replace('__DB__', () => b64));
console.log(`字库 ${count} 字（缺 ${missing}），dist/index.html ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
