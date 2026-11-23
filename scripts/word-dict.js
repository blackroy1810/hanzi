// 构建期自动词典提取：从 @pinyin-pro/data 为未收录在手写词表的字补充常用推荐组词
// 仅在构建时运行，不进入运行时代码，产物仍保持完全离线自包含
const modernDict = require('@pinyin-pro/data/modern.json');

// 少儿练习纸不宜出现的敏感/粗俗/成人向/阴暗丧葬词过滤
const BLOCKED_RE = /吗啡|海洛因|鸦片|大麻|冰毒|毒贩|吸毒|贩毒|毒品|毒枭|毒瘾|罂粟|可卡因|摇头丸|白粉|砒霜|雪茄|香烟|卷烟|烟草|酗酒|色情|情色|淫|嫖|娼|妓|强奸|轮奸|奸污|通奸|乱伦|性交|交媾|做爱|性爱|卖淫|卖春|卖身|援交|包养|情妇|情夫|妓院|窑子|老鸨|龟公|青楼|烟花巷|鸡巴|屄|屌|操你|妈的|傻逼|牛逼|装逼|撕逼|草泥马|他妈|去死|找死|该死|自杀|自残|自刎|自焚|自尽|割腕|跳楼|上吊|殉情|安乐死|遗书|杀人|谋杀|枪毙|枪决|毙命|击毙|毙伤|碎尸|分尸|尸体|腐尸|死尸|尸骨|尸骸|尸首|尸身|停尸|验尸|僵尸|殉葬|丧葬|殡葬|出殡|送殡|装殓|入殓|收殓|棺材|棺椁|棺木|灵柩|寿衣|花圈|纸钱|冥币|冥纸|骨灰|灵堂|坟墓|墓地|赌博|赌场|赌徒|赌债|赌钱|打赌|赌局|赌资|赌注|酒吧|夜总会|夜店|三陪|陪酒|手淫|自慰|阳痿|早泄|避孕|堕胎|流产|打胎|人流|艾滋|梅毒|淋病|性病|痔疮|肛门|阴茎|阴道|睾丸|精液|精虫|遗精|月经|经血|卵巢|宫颈|子宫|前列腺|阴囊|阴蒂|包皮|龟头|生殖器|性器官|性冷淡|性欲|阉割|太监|乳房|乳头|屁股|拉屎|撒尿|大便|小便|尿道|利尿|尿液|屎尿|眼屎|耳屎|狗吃屎|粪便|粪坑|大粪|放屁|狗屁|屁话|混蛋|王八蛋|滚蛋|蠢货|笨蛋|白痴|脑残|神经病|疯子|傻子|傻瓜|弱智|智障|残废|瘸子|瞎子|聋子|哑巴|丑八怪|变态|色狼|流氓|地痞|痞子|无赖|恶霸|恶棍|人渣|败类|贱人|下贱|卑贱|婊子|荡妇|骚货|发骚|风骚|骚扰|骚乱|调戏|非礼|咸猪手|偷窥|猥亵|猥琐|猥词|猥辞|亵渎|亵慢|绑架|勒索|诈骗|抢劫|偷盗|盗窃|走私|贿赂|贪污|腐败|洗钱|销赃|分赃|赃物|赃款|黑帮|黑社会|帮派|恐怖主义|白色恐怖|邪教|纳粹|法西斯|死刑|绞刑|凌迟|斩首|枭首|活埋|枪杀|毒杀|暗杀|屠杀|刺杀|残杀|虐杀|奸杀|灭门|灭口|虐待|强暴|家暴|霸凌|酷刑|拷打|鞭打|毒打|殴打|斗殴|暴打|群殴|惨案|血案|命案|凶案|凶手|杀手|血腥|性骚扰|性侵|裸体|赤裸|脱衣|艳照|黄片|三级片|毛片|春宫|春药|迷药|黑道|走狗|奴才|狗腿子|奴隶|汉奸|奸贼|奸臣|奸猾|奸佞|奸宄|奸诈|锄奸|狼狈为奸|叛徒|间谍|死囚|牢房|手铐|脚镣|杂种|孽种|私生子|荡子|浪荡|勾引|调情|偷情|出轨|外遇|包二奶|小三|凌辱|侮辱|羞辱|诅咒|咒骂|辱骂|恶毒|歹毒|狠毒|毒辣|耳光|鹰犬|畜生|禽兽|废物|病灶|回扣|垃圾邮件|洋垃圾|裙带|牌坊/;

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
    completeMap = collectFromDict(completeDict, charInfos, missingForComplete, false);
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
