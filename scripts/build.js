// 构建：从开源数据生成字库，合入手写与自动兜底例词，嵌入 src/app.html，输出 dist/index.html
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pinyin } = require('pinyin-pro');
const { checkPolyphones, checkWords } = require('./check-polyphones');
const { buildAutoWords, stripTone } = require('./word-dict');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'node_modules', 'hanzi-writer-data');
const polyFile = path.join(root, 'data', 'polyphones.json');
const wordsFile = path.join(root, 'data', 'words.json');

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

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildDb(polyphones, wordsMap) {
  const db = {};
  const charInfos = new Map();
  let missing = 0;

  for (const c of commonChars()) {
    const f = path.join(dataDir, c + '.json');
    if (!fs.existsSync(f)) { missing++; continue; }
    const strokes = JSON.parse(fs.readFileSync(f, 'utf8')).strokes;
    const def = pinyin(c, { toneType: 'symbol' });
    const all = pinyin(c, { multiple: true, toneType: 'symbol', type: 'array' }).flat();
    const extra = polyphones[c] ? Object.keys(polyphones[c]) : [];
    const py = [def, ...new Set([...all, ...extra].filter((x) => x !== def))];
    db[c] = { p: py, s: strokes };
    charInfos.set(c, { def, all: new Set(py), defBase: stripTone(def) });
  }

  // 三层优先级：data/polyphones.json > data/words.json > @pinyin-pro/data 自动兜底
  const curatedSet = new Set([...Object.keys(polyphones), ...Object.keys(wordsMap)]);
  const autoWords = buildAutoWords(charInfos, curatedSet);

  let curatedCovered = 0;
  let autoCovered = 0;
  for (const [c, entry] of Object.entries(db)) {
    const def = charInfos.get(c).def;
    if (polyphones[c]) {
      entry.w = polyphones[c];
      curatedCovered++;
    } else if (wordsMap[c]) {
      entry.w = { [def]: wordsMap[c] };
      curatedCovered++;
    } else if (autoWords[c]) {
      entry.w = autoWords[c];
      autoCovered++;
    }
    if (entry.w) {
      for (const pyKey of Object.keys(entry.w)) {
        if (!entry.p.includes(pyKey)) entry.p.push(pyKey);
      }
    }
  }

  return { db, missing, curatedCovered, autoCovered };
}

const polyphones = loadJson(polyFile);
const wordsMap = loadJson(wordsFile);
const { db, missing, curatedCovered, autoCovered } = buildDb(polyphones, wordsMap);
const count = Object.keys(db).length;
if (count < 3500) throw new Error('字库字数异常：' + count);

const charSet = new Set(Object.keys(db));
const check = checkPolyphones(polyphones, charSet);
console.log(`多音字例词表 ${check.charCount} 字（${check.checkedWords} 词），校验警告 ${check.warnings.length} 条`);
check.warnings.forEach((w) => console.warn('  ' + w));

const wCheck = checkWords(wordsMap, charSet, polyphones);
console.log(`普通字例词表 ${wCheck.charCount} 字（${wCheck.checkedWords} 词），校验警告 ${wCheck.warnings.length} 条`);
wCheck.warnings.forEach((w) => console.warn('  ' + w));

const totalCovered = curatedCovered + autoCovered;
console.log(
  `全字库组词覆盖：${totalCovered}/${count}（${((totalCovered / count) * 100).toFixed(1)}%，手写 ${curatedCovered} 字 + 词典自动补齐 ${autoCovered} 字）`
);

const b64 = zlib.gzipSync(JSON.stringify(db), { level: 9 }).toString('base64');
const tpl = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
if (!tpl.includes('__DB__')) throw new Error('src/app.html 缺少 __DB__ 占位符');

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outFile = path.join(root, 'dist', 'index.html');
fs.writeFileSync(outFile, tpl.replace('__DB__', () => b64));
console.log(`字库 ${count} 字（缺 ${missing}），dist/index.html ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`);
