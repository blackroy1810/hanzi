// 构建：从开源数据生成字库（GB2312 全集 + 现代常用补字），压缩笔画路径并合入手写与自动兜底例词，输出 dist/index.html
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { pinyin } = require('pinyin-pro');
const modernDict = require('@pinyin-pro/data/modern.json');
const { checkPolyphones, checkWords } = require('./check-polyphones');
const { buildAutoWords, stripTone, BLOCKED_RE } = require('./word-dict');

const root = path.join(__dirname, '..');
const dataDir = path.join(root, 'node_modules', 'hanzi-writer-data');
const polyFile = path.join(root, 'data', 'polyphones.json');
const wordsFile = path.join(root, 'data', 'words.json');
const QUANT_STEP = 4; // 1024 坐标网格按步长 4 量化，17 mm 格内最大偏移 ≤ 0.033 mm（小于 600 DPI 单墨点）

function decodeGb2312Range(hiStart, hiEnd) {
  const dec = new TextDecoder('gb2312');
  const out = [];
  for (let hi = hiStart; hi <= hiEnd; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const c = dec.decode(Uint8Array.from([hi, lo]));
      if (c.length === 1 && /[\u4e00-\u9fff]/.test(c)) out.push(c);
    }
  }
  return out;
}

// 目标字表：GB2312 一级字（3755）+ GB2312 二级字（3008）+ @pinyin-pro/data/modern.json 现代补字
function collectTargetChars() {
  const l1 = decodeGb2312Range(0xb0, 0xd7);
  const l2 = decodeGb2312Range(0xd8, 0xf7);
  const baseSet = new Set([...l1, ...l2]);

  const extraSet = new Set();
  for (const [word, val] of Object.entries(modernDict)) {
    if (!Array.isArray(val)) continue;
    for (const c of word) {
      if (baseSet.has(c) || extraSet.has(c)) continue;
      if (!/^[\u4e00-\u9fff]$/.test(c)) continue;
      if (BLOCKED_RE.test(c)) continue;
      if (fs.existsSync(path.join(dataDir, c + '.json'))) extraSet.add(c);
    }
  }
  const extra = [...extraSet].sort();
  return { l1, l2, extra, all: [...l1, ...l2, ...extra] };
}

function fmtNum(n, needSpaceIfNonNeg) {
  return (needSpaceIfNonNeg && n >= 0 ? ' ' : '') + n;
}

// 将绝对坐标 SVG 路径转换为量化后的标准相对路径（兼容 SVG 与 Canvas Path2D，无需运行时解码）
function compressStrokePath(d, step = QUANT_STEP) {
  const tokens = d.trim().split(/\s+/);
  const q = (v) => (step <= 1 ? Math.round(Number(v)) : Math.round(Number(v) / step) * step);
  const out = [];
  let i = 0, cx = 0, cy = 0, sx = 0, sy = 0, lastCmd = '';

  while (i < tokens.length) {
    const cmd = tokens[i++];
    if (cmd === 'M') {
      const x = q(tokens[i++]), y = q(tokens[i++]);
      out.push('M' + x + fmtNum(y, true));
      cx = x; cy = y; sx = x; sy = y; lastCmd = 'M';
    } else if (cmd === 'L') {
      const x = q(tokens[i++]), y = q(tokens[i++]);
      const dx = x - cx, dy = y - cy;
      if (dx !== 0 || dy !== 0) {
        out.push((lastCmd === 'l' ? fmtNum(dx, true) : 'l' + dx) + fmtNum(dy, true));
        cx = x; cy = y; lastCmd = 'l';
      }
    } else if (cmd === 'Q') {
      const x1 = q(tokens[i++]), y1 = q(tokens[i++]);
      const x = q(tokens[i++]), y = q(tokens[i++]);
      const dx1 = x1 - cx, dy1 = y1 - cy, dx = x - cx, dy = y - cy;
      if (dx1 !== 0 || dy1 !== 0 || dx !== 0 || dy !== 0) {
        out.push(
          (lastCmd === 'q' ? fmtNum(dx1, true) : 'q' + dx1) +
          fmtNum(dy1, true) + fmtNum(dx, true) + fmtNum(dy, true)
        );
        cx = x; cy = y; lastCmd = 'q';
      }
    } else if (cmd === 'C') {
      const x1 = q(tokens[i++]), y1 = q(tokens[i++]);
      const x2 = q(tokens[i++]), y2 = q(tokens[i++]);
      const x = q(tokens[i++]), y = q(tokens[i++]);
      const dx1 = x1 - cx, dy1 = y1 - cy;
      const dx2 = x2 - cx, dy2 = y2 - cy;
      const dx = x - cx, dy = y - cy;
      if (dx1 !== 0 || dy1 !== 0 || dx2 !== 0 || dy2 !== 0 || dx !== 0 || dy !== 0) {
        out.push(
          (lastCmd === 'c' ? fmtNum(dx1, true) : 'c' + dx1) +
          fmtNum(dy1, true) + fmtNum(dx2, true) + fmtNum(dy2, true) +
          fmtNum(dx, true) + fmtNum(dy, true)
        );
        cx = x; cy = y; lastCmd = 'c';
      }
    } else if (cmd === 'Z') {
      out.push('Z');
      cx = sx; cy = sy; lastCmd = 'Z';
    } else {
      throw new Error('未知 SVG 路径指令：' + cmd);
    }
  }
  return out.join('');
}

function loadJson(file) {
  if (!fs.existsSync(file)) return {};
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function buildDb(polyphones, wordsMap) {
  const { l1, l2, extra, all: targetChars } = collectTargetChars();
  const l1Set = new Set(l1);
  const db = {};
  const charInfos = new Map();
  let missing = 0;

  for (const c of targetChars) {
    const f = path.join(dataDir, c + '.json');
    if (!fs.existsSync(f)) { missing++; continue; }
    const rawStrokes = JSON.parse(fs.readFileSync(f, 'utf8')).strokes;
    const strokes = rawStrokes.map((s) => compressStrokePath(s, QUANT_STEP));
    const def = pinyin(c, { toneType: 'symbol' });
    const all = pinyin(c, { multiple: true, toneType: 'symbol', type: 'array' }).flat();
    const extraPy = polyphones[c] ? Object.keys(polyphones[c]) : [];
    const py = [def, ...new Set([...all, ...extraPy].filter((x) => x !== def))];
    db[c] = { p: py, s: strokes };
    charInfos.set(c, { def, all: new Set(py), defBase: stripTone(def) });
  }

  // 三层优先级：data/polyphones.json > data/words.json > @pinyin-pro/data 自动兜底
  const curatedSet = new Set([...Object.keys(polyphones), ...Object.keys(wordsMap)]);
  const autoWords = buildAutoWords(charInfos, curatedSet);

  let curatedCovered = 0;
  let autoCovered = 0;
  let l1Covered = 0;
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
      if (l1Set.has(c)) l1Covered++;
      for (const pyKey of Object.keys(entry.w)) {
        if (!entry.p.includes(pyKey)) entry.p.push(pyKey);
      }
    }
  }

  return {
    db, missing, curatedCovered, autoCovered,
    l1Count: l1.length, l2Count: l2.length, extraCount: extra.length, l1Covered,
  };
}

function main() {
  const polyphones = loadJson(polyFile);
  const wordsMap = loadJson(wordsFile);
  const {
    db, missing, curatedCovered, autoCovered,
    l1Count, l2Count, extraCount, l1Covered,
  } = buildDb(polyphones, wordsMap);
  const count = Object.keys(db).length;
  if (count < 6500) throw new Error('字库字数异常：' + count);

  const charSet = new Set(Object.keys(db));
  const check = checkPolyphones(polyphones, charSet);
  const ignoredTip = check.ignoredCount ? `，已忽略已知词典误判 ${check.ignoredCount} 条` : '';
  console.log(`多音字例词表 ${check.charCount} 字（${check.checkedWords} 词），校验警告 ${check.warnings.length} 条${ignoredTip}`);
  check.warnings.forEach((w) => console.warn('  ' + w));

  const wCheck = checkWords(wordsMap, charSet, polyphones);
  console.log(`普通字例词表 ${wCheck.charCount} 字（${wCheck.checkedWords} 词），校验警告 ${wCheck.warnings.length} 条`);
  wCheck.warnings.forEach((w) => console.warn('  ' + w));

  const totalCovered = curatedCovered + autoCovered;
  console.log(
    `全字库组词覆盖：${totalCovered}/${count}（${((totalCovered / count) * 100).toFixed(1)}%，手写 ${curatedCovered} 字 + 词典自动补齐 ${autoCovered} 字）；GB2312 一级字覆盖：${l1Covered}/${l1Count}（${((l1Covered / l1Count) * 100).toFixed(1)}%）`
  );

  const b64 = zlib.gzipSync(JSON.stringify(db), { level: 9 }).toString('base64');
  const tpl = fs.readFileSync(path.join(root, 'src', 'app.html'), 'utf8');
  if (!tpl.includes('__DB__')) throw new Error('src/app.html 缺少 __DB__ 占位符');

  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  const outFile = path.join(root, 'dist', 'index.html');
  fs.writeFileSync(outFile, tpl.replace('__DB__', () => b64));
  console.log(
    `字库 ${count} 字（一级 ${l1Count} + 二级 ${l2Count} + 现代补字 ${extraCount}，缺 ${missing}），dist/index.html ${(fs.statSync(outFile).size / 1048576).toFixed(2)} MB`
  );
}

if (require.main === module) main();

module.exports = { compressStrokePath, decodeGb2312Range, QUANT_STEP };
