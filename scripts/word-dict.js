// 构建期自动词典提取：从 @pinyin-pro/data 为未收录在手写词表的字补充常用推荐组词
// 仅在构建时运行，不进入运行时代码，产物仍保持完全离线自包含
const modernDict = require('@pinyin-pro/data/modern.json');

// 少儿练习纸不宜出现的敏感/粗俗/成人向词过滤
const BLOCKED_RE = /吗啡|海洛因|鸦片|大麻|冰毒|毒贩|吸毒|贩毒|毒品|色情|淫|嫖|娼|妓|强奸|轮奸|奸污|通奸|乱伦|性交|做爱|卖淫|情妇|妓院|鸡巴|屄|屌|操你|妈的|傻逼|牛逼|装逼|撕逼|草泥马|他妈|去死|自杀|杀人|谋杀|枪毙|碎尸|分尸|尸体|腐尸|死尸|尸骨|殉葬|赌博|赌场|赌徒|赌债|酒吧|夜总会|夜店|三陪|陪酒|手淫|自慰|阳痿|早泄|避孕|堕胎|流产|肛门|阴茎|阴道|睾丸|精液|乳房|乳头|屁股|拉屎|撒尿|大便|小便|屎尿|粪便|放屁|混蛋|王八蛋|滚蛋|蠢货|笨蛋|白痴|脑残|神经病|疯子|变态|色狼|流氓|恶棍|人渣|贱人|婊子|荡妇|骚货|发骚|风骚|调戏|猥亵|绑架|勒索|诈骗|抢劫|偷盗|盗窃|走私|贿赂|贪污|腐败|黑帮|黑社会|帮派|恐怖分子|邪教|纳粹|死刑|枪杀|毒杀|暗杀|屠杀|刺杀|虐待|性骚扰|性侵|情色|裸体|脱衣|嫖客|青楼|烟花巷|黑道|走狗|奴才|狗腿子|杂种|孽种|私生子|荡子|浪荡|勾引|调情|偷情|出轨|外遇|包二奶|小三/;

const CJK_ONLY_RE = /^[\u4e00-\u9fff]+$/;

function stripTone(py) {
  return py.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function collectFromDict(dict, charInfos, targetSet, onlyLen2) {
  const byChar = new Map();
  for (const [word, val] of Object.entries(dict)) {
    if (!Array.isArray(val)) continue;
    const [pyStr, freq] = val;
    if (onlyLen2 ? word.length !== 2 : (word.length < 2 || word.length > 4)) continue;
    if (!CJK_ONLY_RE.test(word)) continue;
    if (BLOCKED_RE.test(word)) continue;
    if (typeof pyStr !== 'string') continue;
    const pys = pyStr.trim().split(/\s+/);
    if (pys.length !== word.length) continue;

    for (let i = 0; i < word.length; i++) {
      const c = word[i];
      if (!targetSet.has(c)) continue;
      const info = charInfos.get(c);
      if (!info) continue;
      const p = pys[i];
      let targetPy = null;
      if (info.all.has(p)) {
        targetPy = p;
      } else if (info.all.size === 1 && stripTone(p) === info.defBase) {
        // 单音字在词中读轻声（如 耳朵 ěr duo）时归并到本音
        targetPy = info.def;
      }
      if (!targetPy) continue;

      let pyMap = byChar.get(c);
      if (!pyMap) {
        pyMap = new Map();
        byChar.set(c, pyMap);
      }
      let list = pyMap.get(targetPy);
      if (!list) {
        list = [];
        pyMap.set(targetPy, list);
      }
      list.push({ w: word, freq: freq || 0, len: word.length });
    }
  }
  return byChar;
}

function pickTopWords(list, max = 3) {
  const bestByWord = new Map();
  for (const item of list) {
    const prev = bestByWord.get(item.w);
    if (!prev || item.freq > prev.freq) bestByWord.set(item.w, item);
  }
  const sorted = [...bestByWord.values()].sort((a, b) => {
    const la = a.len === 2 ? 0 : 1;
    const lb = b.len === 2 ? 0 : 1;
    if (la !== lb) return la - lb;
    if (b.freq !== a.freq) return b.freq - a.freq;
    return a.w.localeCompare(b.w, 'zh-CN');
  });
  return sorted.slice(0, max).map((x) => x.w);
}

function buildAutoWords(charInfos, skipChars) {
  const targetAll = new Set();
  for (const c of charInfos.keys()) {
    if (!skipChars.has(c)) targetAll.add(c);
  }

  const modernMap = collectFromDict(modernDict, charInfos, targetAll, false);

  const missingForComplete = new Set();
  for (const c of targetAll) {
    if (!modernMap.has(c)) missingForComplete.add(c);
  }

  let completeMap = new Map();
  if (missingForComplete.size > 0) {
    const completeDict = require('@pinyin-pro/data/complete.json');
    completeMap = collectFromDict(completeDict, charInfos, missingForComplete, true);
  }

  const result = {};
  for (const c of targetAll) {
    const pyMap = modernMap.get(c) || completeMap.get(c);
    if (!pyMap || pyMap.size === 0) continue;

    const info = charInfos.get(c);
    if (info.all.size === 1) {
      const list = pyMap.get(info.def) || [...pyMap.values()].flat();
      const picked = pickTopWords(list, 3);
      if (picked.length) result[c] = { [info.def]: picked };
    } else {
      // 未收录在手写词表中的多音字：按词频占比保留高频常用读音，自然隐藏冷僻古音/姓氏音
      const stats = [...pyMap.entries()]
        .map(([p, list]) => {
          let topFreq = 0;
          let sumFreq = 0;
          for (const item of list) {
            if (item.freq > topFreq) topFreq = item.freq;
            sumFreq += item.freq;
          }
          return { p, list, topFreq, sumFreq };
        })
        .sort((a, b) => b.sumFreq - a.sumFreq || a.p.localeCompare(b.p));

      const maxSum = stats[0].sumFreq || 1;
      const kept = stats.filter(
        (r, idx) => idx === 0 || (r.sumFreq >= maxSum * 0.02 && r.topFreq >= 5e-11)
      );
      const entryW = {};
      for (const r of kept) {
        const picked = pickTopWords(r.list, 3);
        if (picked.length) entryW[r.p] = picked;
      }
      if (Object.keys(entryW).length) result[c] = entryW;
    }
  }

  return result;
}

module.exports = { buildAutoWords, stripTone, BLOCKED_RE };
