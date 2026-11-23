// 构建期校验脚本：用 pinyin-pro 检查 data/polyphones.json 和 data/words.json 的例词合法性与读音一致性
// 不一致仅输出警告并列出，不让构建失败（拼音库对词偶尔也会判错，需人工复查）
const fs = require('fs');
const path = require('path');
const { pinyin } = require('pinyin-pro');

// 经人工核验、确属 pinyin-pro 自身对短词/轻声/口语判读有误的已知例外（格式：字|标注拼音|例词）
const KNOWN_PINYIN_PRO_EXCEPTIONS = new Set([
  '数|shǔ|数数', '数|shǔ|数一数',
  '种|zhòng|种花',
  '发|fà|黑发', '发|fà|理发',
  '还|huán|还书', '还|huán|还给',
  '和|huó|和面', '和|huó|和泥',
  '着|zhuó|着装',
  '得|děi|得去', '得|de|跑得快', '得|de|写得好', '得|de|飞得高',
  '地|de|慢慢地', '地|de|轻轻地', '地|de|高兴地',
  '的|dí|的当',
  '都|dū|古都',
  '教|jiāo|教书', '教|jiāo|教课',
  '空|kòng|有空',
  '背|bēi|背书包',
  '相|xiàng|相片',
  '倒|dào|倒水', '倒|dào|倒车', '倒|dào|倒影',
  '转|zhuàn|打转',
  '落|là|落下',
  '朝|zhāo|朝阳',
  '盛|chéng|盛饭', '盛|chéng|盛水', '盛|chéng|盛满',
  '系|jì|系鞋带', '系|jì|系扣子',
  '降|xiáng|降服',
  '切|qiē|切菜', '切|qiē|切开',
  '圈|juàn|圈养',
  '吐|tù|呕吐', '吐|tù|吐血',
  '血|xiě|流血', '血|xiě|鸡血',
  '脏|zàng|心脏', '脏|zàng|内脏', '脏|zàng|肝脏',
  '扎|zā|扎辫子',
  '折|shé|折本', '折|shé|折了',
  '冲|chòng|冲着', '冲|chòng|冲床',
  '待|dāi|待会儿', '待|dāi|待着',
  '度|duó|测度',
  '喝|hè|大喝一声',
  '卷|juǎn|卷尺',
  '壳|qiào|地壳', '壳|qiào|甲壳', '壳|qiào|金蝉脱壳',
  '壳|ké|贝壳', '壳|ké|蛋壳', '壳|ké|外壳',
]);

function checkPolyphones(polyphones, availableChars) {
  const warnings = [];
  let charCount = 0;
  let checkedWords = 0;
  let ignoredCount = 0;

  for (const [char, readingMap] of Object.entries(polyphones)) {
    charCount++;
    if (availableChars && !availableChars.has(char)) {
      warnings.push(`[缺字] 「${char}」不在当前字库中`);
    }

    const allReadings = new Set(
      pinyin(char, { multiple: true, toneType: 'symbol', type: 'array' }).flat()
    );

    for (const [expectedPy, words] of Object.entries(readingMap)) {
      if (!allReadings.has(expectedPy)) {
        warnings.push(
          `[读音提示] 「${char}」标注读音「${expectedPy}」不在 pinyin-pro 全集（${[...allReadings].join('/')}）中`
        );
      }
      if (!Array.isArray(words)) {
        warnings.push(`[格式警告] 「${char}」读音「${expectedPy}」的例词不是数组`);
        continue;
      }

      for (const word of words) {
        checkedWords++;
        const chars = [...word];
        const indices = [];
        chars.forEach((ch, idx) => {
          if (ch === char) indices.push(idx);
        });
        if (!indices.length) {
          warnings.push(`[缺目标字] 「${char}」（${expectedPy}）的例词「${word}」不包含该字`);
          continue;
        }
        const wordPys = pinyin(word, { toneType: 'symbol', type: 'array' });
        const matched = indices.some((idx) => wordPys[idx] === expectedPy);
        if (!matched) {
          if (KNOWN_PINYIN_PRO_EXCEPTIONS.has(`${char}|${expectedPy}|${word}`)) {
            ignoredCount++;
            continue;
          }
          const detected = indices.map((idx) => wordPys[idx] || '?').join('/');
          warnings.push(
            `[读音不一致] 「${char}」标注「${expectedPy}」，例词「${word}」中 pinyin-pro 判读为「${detected}」`
          );
        }
      }
    }
  }

  return { charCount, checkedWords, warnings, ignoredCount };
}

function checkWords(wordsMap, availableChars, polyphones) {
  const warnings = [];
  let charCount = 0;
  let checkedWords = 0;

  for (const [char, words] of Object.entries(wordsMap)) {
    charCount++;
    if (availableChars && !availableChars.has(char)) {
      warnings.push(`[普通字缺字] 「${char}」不在当前字库中`);
    }
    if (polyphones && polyphones[char]) {
      warnings.push(`[重复定义] 「${char}」同时出现在 polyphones.json 和 words.json 中，将以 polyphones.json 为准`);
    }
    if (!Array.isArray(words)) {
      warnings.push(`[格式警告] 「${char}」的例词不是数组`);
      continue;
    }
    for (const word of words) {
      checkedWords++;
      if (!word.includes(char)) {
        warnings.push(`[普通字缺目标字] 「${char}」的例词「${word}」不包含该字`);
      }
    }
  }

  return { charCount, checkedWords, warnings };
}

if (require.main === module) {
  const file = process.argv[2] || path.join(__dirname, '..', 'data', 'polyphones.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  const res = checkPolyphones(data);
  const ignoredTip = res.ignoredCount ? `（已忽略已知词典误判 ${res.ignoredCount} 条）` : '';
  console.log(`多音字例词校验完成：共 ${res.charCount} 字、${res.checkedWords} 个例词，警告 ${res.warnings.length} 条${ignoredTip}`);
  res.warnings.forEach((w) => console.warn('  ' + w));

  const wordsFile = path.join(__dirname, '..', 'data', 'words.json');
  if (!process.argv[2] && fs.existsSync(wordsFile)) {
    const wData = JSON.parse(fs.readFileSync(wordsFile, 'utf8'));
    const wRes = checkWords(wData, null, data);
    console.log(`普通字例词校验完成：共 ${wRes.charCount} 字、${wRes.checkedWords} 个例词，警告 ${wRes.warnings.length} 条`);
    wRes.warnings.forEach((w) => console.warn('  ' + w));
  }
}

module.exports = { checkPolyphones, checkWords };
