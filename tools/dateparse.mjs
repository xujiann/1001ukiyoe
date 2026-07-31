// 年代文本 → 排序年（sy）。三站共用，避免各写一份再漂移。
//
// 起因：原解析把「late 18th–early 19th century」当成「18th century」取中点 1767（实际约 1800），
// 「19th-early 20th century」算成 1800（实际约 1880）。三站共 1755 件受影响，
// 排序键系统性偏早 25–50 年，按年代浏览时整批作品站错位置。
// 病根是修饰词（early / mid / late / first half / second half、初 / 中 / 末）被整个忽略。
//
// 世纪换算以「19 世纪 = 1801–1900」为准：base = (N-1)*100
//   初/early      → base+15      中/mid        → base+50      末/late      → base+85
//   上半叶/1st half → base+25     下半叶/2nd half → base+75      不带修饰      → base+50
const QUAL = [
  [/\b(?:early|beginning of)\b|世纪初|世紀初|初期/i, 15],
  [/\bfirst half\b|上半叶|前半/i, 25],
  [/\b(?:mid|middle)\b|世纪中|世紀中|中期/i, 50],
  [/\bsecond half\b|下半叶|後半|后半/i, 75],
  [/\b(?:late|end of)\b|世纪末|世紀末|晚期|末期/i, 85],
];
const CENT = /(\d{1,2})\s*(?:st|nd|rd|th)?\s*(?:century|世纪|世紀)/gi;

// 把一段文本里的「修饰词 + 世纪」解析成年份；返回所有命中的年份
export function centuryYears(text) {
  const s = String(text || '');
  const out = [];
  let m;
  CENT.lastIndex = 0;
  while ((m = CENT.exec(s)) !== null) {
    const n = +m[1];
    if (!n || n > 21) continue;
    const base = (n - 1) * 100;
    // 修饰词就近取：优先看世纪数字**之前**那一小段（英文「late 18th century」），
    // 其次看**之后**那一小段（中文「18世纪末」）
    const before = s.slice(Math.max(0, m.index - 22), m.index);
    const after = s.slice(m.index, Math.min(s.length, m.index + m[0].length + 6));
    let off = 50;
    for (const [re, v] of QUAL) { if (re.test(before)) { off = v; break; } }
    if (off === 50) for (const [re, v] of QUAL) { if (re.test(after)) { off = v; break; } }
    let y = base + off;
    if (/\bB\.?C\.?E?\b|公元前/i.test(s)) y = -(base + (100 - off));
    out.push(y);
  }
  return out;
}

// 综合解析：优先明确年份/年份区间，其次世纪表达
export function sortYear(text, fallbackRange) {
  const s = String(text || '');
  // 明确的四位年份区间「1615–1868」
  let m = /(-?\d{3,4})\s*[–—-]\s*(-?\d{3,4})/.exec(s);
  if (m && !/century|世纪|世紀/i.test(s)) return Math.round((+m[1] + +m[2]) / 2);
  // 世纪表达（可能有多个，如「late 18th–early 19th century」→ 取两端中点）
  const cs = centuryYears(s);
  // 「19th-early 20th century」这种写法里，前一个世纪是**裸序数词**、后面不跟 century，
  // 只按 CENT 匹配会把它整个丢掉，结果只剩「early 20th」→ 1915（实际应约 1880）。
  // 补：世纪表达之前若有 `\d+(st|nd|rd|th)` + 连字符，把那个世纪也算进区间（按不带修饰处理）。
  if (cs.length) {
    for (const m of s.matchAll(/(\d{1,2})(?:st|nd|rd|th)\s*[-–—]\s*(?=(?:early|mid|middle|late|first|second|\d))/gi)) {
      const n = +m[1];
      if (!n || n > 21) continue;
      // 裸序数词也要认自己的修饰词：「late 18th–early 19th century」里的 late 属于 18th，
      // 不认就会把它当成不带修饰的 18 世纪（1750），整段中点偏早近 20 年
      const before = s.slice(Math.max(0, m.index - 22), m.index);
      let off = 50;
      for (const [re, v] of QUAL) { if (re.test(before)) { off = v; break; } }
      cs.push((n - 1) * 100 + off);
    }
    return Math.round((Math.min(...cs) + Math.max(...cs)) / 2);
  }
  // 单个四位年份
  m = /(-?\d{3,4})/.exec(s);
  if (m) return +m[1];
  if (Array.isArray(fallbackRange) && fallbackRange.length === 2) return Math.round((fallbackRange[0] + fallbackRange[1]) / 2);
  return null;
}
