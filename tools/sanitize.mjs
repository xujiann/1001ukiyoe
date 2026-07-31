// 数据清洗规则 —— 全流程唯一真源。
//
// 背景：这套规则原先在 app.js（运行时）和 _prerender.mjs（构建时）各抄了一份，
// 两份已经漂移：_prerender 漏掉了「标题是裸 QID」的分支，于是 568 个静态页
// 把「Q65146600」当成 <h1> 印了出去。现在统一到这里，由：
//   · _buildjs.mjs  —— 写 data.js / data-rest.js / desc.js 之前跑一遍（产物即已清洗）
//   · _prerender.mjs —— 读的就是已清洗的产物，无需再洗
//   · tools/validate.mjs —— 复用 BADVAL 做断言，脏值一律 error
// 前端因此不再需要运行时清洗（省去每位访客约 38ms 主线程）。
//
// 幂等：可重复执行，结果不变。

export const BADVAL = /^https?:|\.well-known\/genid\/|^Q\d+$/i;          // 整个字段就是脏值
export const BADVAL_IN = /https?:\/\/\S*(?:well-known\/genid|wikidata\.org)\S*|\bQ\d{4,}\b/gi;  // 字段内嵌脏串

export const QID_NAME = {   // 已知 QID → 正确名称（艺术家 + 高频博物馆）
  "Q41554": "Nicolas Poussin", "Q168659": "Franz Xaver Winterhalter",
  "Q214867": "National Gallery", "Q1117704": "Indianapolis Museum of Art",
  "Q2148186": "RISD Museum", "Q847508": "Worcester Art Museum",
};

// 同一机构的中文音译重名 → 归并到规范名（仅英文名一致且明确同馆的保守合并）
export const MU_MERGE = {
  "克勒勒-米勒博物馆": "库勒-穆勒博物馆", "艺术史博物馆": "维也纳艺术史博物馆", "旧国家画廊": "柏林旧国家画廊",
  "安特卫普皇家美术馆": "安特卫普皇家美术博物馆", "皇家安特卫普美术馆": "安特卫普皇家美术博物馆",
  "维也纳美景宫": "奥地利美景宫美术馆", "丹麦国家美术馆": "国立丹麦美术馆", "泰特在线": "泰特美术馆",
};

// location_en 常被 Wikidata 的「收藏史」(P195) 污染成藏家/中转站/部门串（非当前收藏机构）。
// 小写 collection 结尾是可靠的 provenance 信号，且不会误伤 Frick/Wallace 等大写 Collection 真馆。
const PROV_SET = new Set(["Degas Collection", "Matsukata Collection", "Potter Palmer Collection", "Johann Wilhelm von der Pfalz collection", "State Museum of Modern Western Art", "Keynes Collection", "Rose-Marie and Eijk van Otterloo Collection", "Mrs. Chester Beatty", "Gabriele and Werner Merzbacher Collection", "Collection of Max Emden", "The William L. Elkins Collection, 1924", "Borghese Collection", "Villa Flora", "White Fund", "Payne Gallery", "NEPIP", "Curationist", "Aberdeen Archives, Gallery and Museums collections", "Fondation Corboud", "Ernst von Siemens Kunststiftung", "C.M. van Gogh Gallery", "Sint-Augustinuskerk", "Davison Art Center", "Victoria and Albert museum prints, drawings, & paintings collection", "Vlaamse Kunstcollectie", "Museo del vino", "Musée du vin", "Stavros Niarchos Collection", "Six Collection", "Jean Walter-Paul Guillaume Collection", "Otto Krebs collection", "Fop Smit collection"]);
const PROV_LOWER = / collection$/;                                        // 大小写敏感：仅小写 c 才当 provenance
const PROV_RE = / in the National Gallery of Art$|Central Collecting Point|Nationaux Récupération|degenerate art|Kunsthandel|Sedelmeyer|Böhler|Plattner|Pérez Simón/i;
export const muIsProv = en => PROV_SET.has(en) || PROV_LOWER.test(en) || PROV_RE.test(en);

export const MU_EN = {   // 少数主导英文名仍不对/需消歧的馆 → 权威指定
  "普林斯顿大学艺术博物馆": "Princeton University Art Museum",
  "安特卫普皇家美术博物馆": "Royal Museum of Fine Arts Antwerp",
  "国家艺廊": "National Gallery",
};

/** 就地清洗整个作品数组。返回各类修改计数，便于构建日志与回归观察。 */
export function sanitizeAll(DATA) {
  const n = { artist: 0, title: 0, medium: 0, location: 0, desc: 0, locEn: 0 };

  // pass 1：逐条清洗 艺术家 / 标题 / 媒材 / 描述，并合并馆名、归一脏 location
  for (const d of DATA) {
    if (d.artist && BADVAL.test(d.artist)) { d.artist = "佚名"; n.artist++; }
    if (d.artist_en && BADVAL.test(d.artist_en)) {
      d.artist_en = QID_NAME[d.artist_en] || (d.id === 1651 ? "Jan van Eyck" : (d.artist && d.artist !== "佚名") ? d.artist : "Anonymous");
      n.artist++;
    }
    if (d.title) d.title = d.title.replace(/\s{2,}/g, " ").trim();
    if (d.title_en) {
      d.title_en = d.title_en.replace(/\s{2,}/g, " ").trim();
      if (d.artist_en === "Albrecht Dürer") d.title_en = d.title_en.replace("Great Passion", "Large Passion");
    }
    // 标题是裸 QID → 用另一语言字段替代；两边都脏时给可读占位，**绝不留空**
    // （留空会造成空卡片、搜索不到、静态页 <h1> 为空——这正是历史上出过的事故）
    if (d.title && BADVAL.test(d.title)) {
      d.title = (d.title_en && !BADVAL.test(d.title_en)) ? d.title_en : `无题（${d.artist || "佚名"}）`;
      n.title++;
    }
    if (d.title_en && BADVAL.test(d.title_en)) {
      d.title_en = (d.title && !BADVAL.test(d.title)) ? d.title : `Untitled (${d.artist_en || "unknown artist"})`;
      n.title++;
    }
    // Dürer 的《受难》《启示录》等版画组画被误标为「布面油画」→ 高置信修正为版画
    if (d.artist_en === "Albrecht Dürer" && /oil on canvas/i.test(d.medium_en || "") &&
        (/print/i.test((d.location || "") + (d.location_en || "")) || /Passion|Apocalypse/i.test(d.title_en || ""))) {
      d.medium = "版画"; d.medium_en = "Print"; n.medium++;
    }
    // 戈雅《狂想曲》系列（1799，私人收藏）为蚀刻版画，同样被误标为布面油画。
    if (d.artist_en === "Francisco Goya" && /oil on canvas/i.test(d.medium_en || "") &&
        /1799/.test(d.year_en || d.year || "") && /private collection|私人收藏/i.test((d.location || "") + (d.location_en || ""))) {
      d.medium = "蚀刻版画"; d.medium_en = "Etching"; n.medium++;
    }
    if (d.location) {
      if (MU_MERGE[d.location]) d.location = MU_MERGE[d.location];
      if (BADVAL.test(d.location)) { d.location = "未知收藏"; n.location++; }
    }
    // 描述内嵌的 genid URL / 裸 QID —— 此前无人清洗，直接显示给读者
    for (const k of ["desc", "desc_en"]) {
      if (!d[k]) continue;
      BADVAL_IN.lastIndex = 0;
      if (BADVAL_IN.test(d[k])) {
        BADVAL_IN.lastIndex = 0;
        d[k] = d[k].replace(BADVAL_IN, k === "desc" ? "未知收藏" : "an unknown collection");
        n.desc++;
      }
      BADVAL_IN.lastIndex = 0;
      // 馆藏 API 的策展文字常含 HTML（克利夫兰的 description 里有 <em>）。
      // 我们用 textContent 渲染，标签会原样显示成 "<em>"，故一律剥掉。
      if (/<[^>]+>|&(?:nbsp|amp|lt|gt|quot|#\d+);/.test(d[k])) {
        d[k] = d[k].replace(/<[^>]+>/g, " ")
          .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
          .replace(/\s+/g, " ").trim();
        n.desc++;
      }
    }
  }

  // pass 2：每馆的权威英文名 = 候选中出现最多者（剔除 provenance / 脏值 / 等于中文名者）
  const enCount = new Map();
  for (const d of DATA) {
    if (!d.location || d.location === "未知收藏") continue;
    let en = d.location_en; if (en && QID_NAME[en]) en = QID_NAME[en];
    if (!en || BADVAL.test(en) || en === d.location || muIsProv(en)) continue;
    let m = enCount.get(d.location); if (!m) { m = new Map(); enCount.set(d.location, m); }
    m.set(en, (m.get(en) || 0) + 1);
  }
  const domEn = new Map();
  for (const [loc, m] of enCount) { let best = "", bn = 0; for (const [en, c] of m) if (c > bn || (c === bn && en < best)) { best = en; bn = c; } domEn.set(loc, best); }

  // pass 3：统一每件作品的 location_en 为该馆权威英文名
  for (const d of DATA) {
    if (!d.location || d.location === "未知收藏") {
      if (d.location_en && BADVAL.test(d.location_en)) { d.location_en = "Unknown collection"; n.locEn++; }
      continue;
    }
    const canon = MU_EN[d.location] || domEn.get(d.location);
    if (canon) { if (d.location_en !== canon) n.locEn++; d.location_en = canon; }
    else if (d.location_en && (BADVAL.test(d.location_en) || QID_NAME[d.location_en] || muIsProv(d.location_en))) { d.location_en = ""; n.locEn++; }
  }
  return n;
}

/** 校验用：返回某条记录上所有仍然带脏值的字段名（空数组 = 干净）。 */
export function dirtyFields(d) {
  const out = [];
  for (const k of ["artist", "artist_en", "title", "title_en", "location", "location_en"]) {
    if (d[k] && BADVAL.test(d[k])) out.push(k);
  }
  for (const k of ["desc", "desc_en"]) {
    if (!d[k]) continue;
    BADVAL_IN.lastIndex = 0;
    if (BADVAL_IN.test(d[k])) out.push(k);
    BADVAL_IN.lastIndex = 0;
  }
  for (const k of ["title", "title_en"]) if (!String(d[k] || "").trim()) out.push(k + ":空");
  return out;
}
