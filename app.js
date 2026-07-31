/* 1001+ 浮世绘 — 交互逻辑（双语 / 高清灯箱 / 时间线索引） */
(function(){
  "use strict";
  const DATA = window.ART_DATA || [];
  const LANG = window.LANG || {ui:{zh:{},en:{}},dict:{}};
  const PER_PAGE = 48;
  let TOTAL = DATA.length;
  let ARTISTS = window.ART_ARTISTS || {};   // 艺术家小传 / 生卒 / 国籍（懒加载后重赋值）
  let CREDITS = window.ART_CREDITS || {};   // 逐图作者 / 许可署名（懒加载后重赋值）
  function lifespanStr(key){ const m=ARTISTS[key]; if(!m||(!m.born&&!m.died)) return ""; return (m.born||"?")+"–"+(m.died||(m.born?"":"?")); }
  function artistBio(key){ const m=ARTISTS[key]; if(!m) return null; return lang==="en" ? (m.bio_en||m.bio_zh) : (m.bio_zh||m.bio_en); }
  function artistCountry(key){ const m=ARTISTS[key]; if(!m) return ""; return lang==="en" ? (m.cty_en||m.cty_zh||"") : (m.cty_zh||m.cty_en||""); }
  function artistPortrait(key, w){ const m=ARTISTS[key]; return (m && m.p) ? imgURL(m.p, w) : null; }   // 艺术家肖像（懒加载后可用），w=目标 CSS 宽

  // —— 语言状态 ——
  let lang = "zh";
  try{ if(localStorage.getItem("art1001_lang") === "en") lang = "en"; }catch(e){}   // 隐私模式 localStorage 可能抛错，兜底防整页白屏
  const T = k => (LANG.ui[lang] && LANG.ui[lang][k]) || (LANG.ui.zh[k] || k);
  // 取条目的当前语言字段
  const F = (d, base) => (lang === "en" && d[base + "_en"]) ? d[base + "_en"] : d[base];
  // 计数单位：英文单数去复数尾（"works"→"work"）；中文用量词不变
  function plu(n, key){ const w = T(key); return (lang === "en" && n === 1) ? w.replace(/s$/, "") : w; }
  // 字段翻译（下拉/标签用：value 恒为中文，label 随语言）——映射从数据自身构建
  const TRMAP = { era:{}, medium:{}, country:{} };
  function buildTrMaps(){
    DATA.forEach(d => {
      if(d.era) TRMAP.era[d.era] = d.era_en || d.era;
      if(d.medium) TRMAP.medium[d.medium] = d.medium_en || d.medium;
      if(d.country) TRMAP.country[d.country] = d.country_en || d.country;
    });
  }
  function tr(kind, zh){ return (lang === "en" && TRMAP[kind] && TRMAP[kind][zh]) ? TRMAP[kind][zh] : zh; }

  // —— 时代 → 占位主题类（每条数据自带 th 主题后缀）——
  const eraTheme = d => "era-" + ((d && d.th) ? d.th : "default");

  // —— 图片：本地缓存优先；file 仅用于「查看原图」外链 ——
  const FP = "https://commons.wikimedia.org/wiki/Special:FilePath/";
  // 部分 file 字段本身已是百分号编码，直接再 encode 会双重编码指向不存在的页面 → 先按需解码
  function decodeFile(file){
    let f = file;
    try{ if(/%[0-9A-Fa-f]{2}/.test(file)) f = decodeURIComponent(file); }catch(e){}
    return f;
  }
  function originalURL(file){
    if(!file) return null;
    return FP + encodeURIComponent(decodeFile(file));
  }

  // —— 图片基址：腾讯云 COS 南京区（国内直连，比 jsDelivr 快数倍且不受墙影响；与 1001fish/1001birds 同桶）——
  // data.js 存相对路径 images/<id>.、images/t/<id>.、images/a/<qid>.；COS 上对应 art/<id>.、art/t/、art/a/，
  // 故拼接时去掉 images/ 前缀。本地开发把 IMG_BASE 置空即可回退同源 images/。
  const IMG_BASE = "https://pic-1302017848.cos.ap-nanjing.myqcloud.com/art/";
  // 浏览器支持 WebP 时，用腾讯云 COS 数据万象按需转码（不重传、缩略图省约 37%）。
  // canvas 能编码 WebP 即能解码；老浏览器检测失败则回退原 JPEG，绝不出现坏图。
  const _WEBP = (() => { try { const c = document.createElement("canvas"); c.width = c.height = 1; return c.toDataURL("image/webp").indexOf("data:image/webp") === 0; } catch(e){ return false; } })();
  // 像素密度量化为 1×/2×（而非透传 1.25/1.5 等分数 DPR），避免每种缩放比各生成一份 CI 变体、
  // 碎裂 CDN/SW/浏览器缓存并多计一次转码；≥1.5 视作 2×（宁可清晰不软）。
  const _DENS = (window.devicePixelRatio || 1) >= 1.5 ? 2 : 1;
  // w = 目标 CSS 宽度（可选）：×密度得实际像素，交给 COS 数据万象缩放（只缩不放，源 500/960px）。
  // 大图（弹窗/灯箱/预取）不传 w，保持同一 URL 命中缓存。
  // 关键：即使既无 w 又无 WebP，也强制走一次 CI（format/jpg）——裸 COS 对象无 CORS/Cache-Control，
  //   SW 的 cors 取回会失败而不缓存、浏览器也难缓存；CI 变体带 ACAO:* 与 30 天 max-age，字节几乎不变。
  function imgURL(p, w){
    if(!p || !IMG_BASE) return p;
    const ops = [];
    if(w) ops.push("thumbnail/" + (w * _DENS) + "x");
    ops.push(_WEBP ? "format/webp" : "format/jpg");
    return IMG_BASE + String(p).replace(/^images\//, "") + "?imageMogr2/" + ops.join("/");
  }

  // —— 时间线分期 ——
  function periodKey(sy){
    if(sy < 0) return "bce";
    if(sy <= 1400) return "ancient";
    return "c" + (Math.floor((sy - 1) / 100) + 1);
  }
  function periodOrder(key){ return key === "bce" ? -1 : key === "ancient" ? 0 : parseInt(key.slice(1), 10); }
  function ordinal(n){ const s=["th","st","nd","rd"], v=n%100; return n + (s[(v-20)%10] || s[v] || s[0]); }
  function periodLabel(key){
    if(key === "bce") return T("bce");
    if(key === "ancient") return T("ancient");
    const c = parseInt(key.slice(1), 10);
    return lang === "zh" ? (c + " 世纪") : (ordinal(c) + " c.");
  }

  // —— 状态 ——
  let filtered = DATA.slice();
  let page = 0;
  let listView = false;
  let timelineMode = false;
  let periodFilter = null;
  let favOnly = false;
  let artistFilter = null;     // 选中的艺术家 key（artist_en）
  let artistIndexOn = false;   // 是否正在显示艺术家索引
  let museumIndexOn = false;   // 是否正在显示馆藏博物馆索引
  let artistIdxFilter = "";    // 索引（艺术家/博物馆）内的筛选词（共用）
  let idxSort = "count";       // 索引排序：count（按数量）| name（按名称）
  let museumFilter = null;     // 选中的馆藏地（藏品展）

  // —— 收藏（localStorage 持久化）——
  const FAV_KEY = "art1001_favs";
  let favs = new Set();
  try{ favs = new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")); }catch(e){}
  const isFav = id => favs.has(id);
  function saveFavs(){ try{ localStorage.setItem(FAV_KEY, JSON.stringify([...favs])); }catch(e){} }
  function toggleFav(id){ favs.has(id) ? favs.delete(id) : favs.add(id); saveFavs(); return favs.has(id); }

  // —— DOM ——
  const $ = id => document.getElementById(id);
  const gallery = $("gallery"), searchInput = $("search");
  const eraFilter = $("era-filter"), mediumFilter = $("medium-filter"), countryFilter = $("country-filter");
  const eraTabs = $("era-tabs"), timelineBar = $("timeline-bar");
  const pagination = $("pagination"), noResults = $("no-results");
  const artistIndex = $("artist-index"), artistBar = $("artist-bar");

  // —— 下拉选项（value=中文，label 随语言）——
  function uniq(key){
    const s = new Set();
    DATA.forEach(d => { if(d[key]) s.add(d[key]); });
    return [...s].sort((a,b)=>a.localeCompare(b,"zh"));
  }
  let eraVals = [], mediumVals = [], countryVals = [];
  function buildSelect(sel, kind, vals, allKey){
    sel.innerHTML = "";
    const o0 = document.createElement("option");
    o0.value = ""; o0.textContent = T(allKey); sel.appendChild(o0);
    vals.forEach(v => {
      const o = document.createElement("option");
      o.value = v; o.textContent = tr(kind, v); sel.appendChild(o);
    });
  }
  function rebuildSelects(){
    const e=eraFilter.value, m=mediumFilter.value, c=countryFilter.value;
    buildSelect(eraFilter, "era", eraVals, "all_eras");
    buildSelect(mediumFilter, "medium", mediumVals, "all_media");
    buildSelect(countryFilter, "country", countryVals, "all_regions");
    eraFilter.value=e; mediumFilter.value=m; countryFilter.value=c;
  }

  // 统计（值在 computeDerived 后更新）
  function updateStats(){ $("era-count").textContent = eraVals.length; $("artist-count").textContent = uniq("artist").length; }

  // —— 时代快捷标签（计数在 computeDerived 中构建）——
  let eraCounts = {}, topEras = [];
  function buildTabs(){
    eraTabs.innerHTML = "";
    const all = document.createElement("button");
    all.className = "era-tab" + (eraFilter.value ? "" : " active");
    all.textContent = T("all");
    all.onclick = () => { eraFilter.value=""; applyFilters(); };
    eraTabs.appendChild(all);
    topEras.forEach(era => {
      const b = document.createElement("button");
      b.className = "era-tab" + (eraFilter.value===era ? " active" : "");
      b.textContent = `${tr("era",era)} (${eraCounts[era]})`;
      b.dataset.era = era;
      b.onclick = () => { eraFilter.value = era; applyFilters(); };
      eraTabs.appendChild(b);
    });
  }

  // —— 时间线索引条 ——
  let periodCounts = {}, periodKeys = [];
  function buildTimelineBar(){
    timelineBar.innerHTML = "";
    periodKeys.forEach(k => {
      const b = document.createElement("button");
      b.className = "tl-period" + (periodFilter===k ? " active" : "");
      b.innerHTML = `<span class="tl-era">${esc(periodLabel(k))}</span><span class="tl-cnt">${periodCounts[k]}</span>`;
      b.onclick = () => { periodFilter = (periodFilter===k ? null : k); buildTimelineBar(); applyFilters(); };
      timelineBar.appendChild(b);
    });
  }

  // —— 按艺术家聚合 ——
  let artistAgg = [], artistByKey = new Map(), eraByKey = new Map();   // eraByKey：时代 → 作品，供弹窗「同时代」相关条
  function buildArtistAgg(){
    const m = new Map();
    DATA.forEach(d => {
      const k = d.artist_en || d.artist;
      let a = m.get(k);
      if(!a){ a = {key:k, zh:d.artist, en:d.artist_en || d.artist, n:0, rep:null, works:[]}; m.set(k, a); }
      a.n++; a.works.push(d); if(!a.rep && d.img) a.rep = d;
    });
    artistAgg = [...m.values()].sort((x,y) => y.n - x.n || x.en.localeCompare(y.en));
    artistByKey = m;   // key → 聚合（含 works[]），供弹窗「相关作品」O(该艺术家) 查表
  }
  // 数据清洗已前移到构建期（tools/sanitize.mjs，由 _buildjs 在写 data.js 前执行），
  // 产物即为干净数据；tools/validate.mjs 复用同一套规则做闸门。前端因此不再运行时清洗，
  // 每位访客省去约 38ms 主线程（中端手机约 150ms）。
  // 重算所有 DATA 派生结构（首屏一次；其余数据流式合并后再调一次）
  function computeDerived(){
    buildTrMaps();
    eraVals = uniq("era"); mediumVals = uniq("medium"); countryVals = uniq("country");
    eraCounts = {}; DATA.forEach(d => eraCounts[d.era] = (eraCounts[d.era]||0)+1);
    topEras = Object.keys(eraCounts).sort((a,b)=>eraCounts[b]-eraCounts[a]).slice(0,14);
    periodCounts = {}; DATA.forEach(d => { const k=periodKey(d.sy); periodCounts[k]=(periodCounts[k]||0)+1; });
    periodKeys = Object.keys(periodCounts).sort((a,b)=>periodOrder(a)-periodOrder(b));
    buildArtistAgg();
    buildMuseumAgg();
    buildTagAgg();
    eraByKey = new Map();
    DATA.forEach(d => { if(!d.era) return; let l = eraByKey.get(d.era); if(!l){ l = []; eraByKey.set(d.era, l); } l.push(d); });
    TOTAL = DATA.length;
    updateStats();
  }
  let museumAgg = [];
  const MU_SKIP = { "未知收藏":1, "私人收藏":1, "Private collection":1 };   // 占位归组，非真实机构，不进索引
  function buildMuseumAgg(){
    const m = new Map();
    DATA.forEach(d => {
      if(!d.location || MU_SKIP[d.location]) return;
      let a = m.get(d.location);
      if(!a){ a = {name:d.location, en:d.location_en || d.location, n:0, rep:null}; m.set(d.location, a); }
      a.n++; if(!a.rep && d.img) a.rep = d;
    });
    museumAgg = [...m.values()].sort((x,y) => y.n - x.n || x.name.localeCompare(y.name,"zh"));
  }
  const artistName = a => (lang === "en" ? a.en : a.zh) || a.en;

  // —— 题材轴（标签来自大都会开放数据）——
  // 数据不足时整条轴隐藏：只有几个词的「题材」对读者是噪声，不如不显示。
  let tagAgg = [];
  const TAG_MIN = 3, TAG_AXIS_MIN = 40;   // 单个题材至少 3 件；整条轴至少 40 个题材才露出
  function buildTagAgg(){
    const m = new Map();
    for(const d of DATA){
      if(!d.tg?.length) continue;
      d.tg.forEach((t, i) => {
        let a = m.get(t);
        if(!a){ a = { zh: t, en: (d.tg_en && d.tg_en[i]) || t, n: 0 }; m.set(t, a); }
        a.n++;
      });
    }
    tagAgg = [...m.values()].filter(a => a.n >= TAG_MIN).sort((x, y) => y.n - x.n || x.zh.localeCompare(y.zh, "zh"));
    const btn = $("subject-btn");
    if(btn) btn.style.display = tagAgg.length >= TAG_AXIS_MIN ? "" : "none";
  }
  let subjectOpen = false;
  function toggleSubjectPanel(){
    const box = $("subject-panel"), btn = $("subject-btn");
    subjectOpen = !subjectOpen;
    btn.classList.toggle("active", subjectOpen);
    if(!subjectOpen){ box.style.display = "none"; box.innerHTML = ""; return; }
    box.innerHTML = tagAgg.map(a =>
      `<button class="sj-tag" type="button" data-t="${esc(a.zh)}" title="${esc(a.en)}">${esc(lang === "en" ? a.en : a.zh)}<span>${a.n}</span></button>`
    ).join("");
    box.style.display = "";
    box.querySelectorAll(".sj-tag").forEach(b => {
      b.onclick = () => {
        searchInput.value = b.dataset.t; page = 0;
        toggleSubjectPanel();
        applyFilters();
        window.scrollTo({ top: 0, behavior: "smooth" });
      };
    });
  }

  function renderArtistIndex(){
    const q = artistIdxFilter;
    let list = q ? artistAgg.filter(a => ((a.zh||"") + " " + (a.en||"") + " " + a.key).toLowerCase().includes(q)) : artistAgg;
    if(idxSort === "name") list = list.slice().sort((a,b) => artistName(a).localeCompare(artistName(b), "zh"));
    const frag = document.createDocumentFragment();
    list.forEach(a => {
      const card = document.createElement("div");
      card.className = "artist-card"; card.tabIndex = 0;
      card.setAttribute("role","button"); card.setAttribute("aria-label", artistName(a));
      const open = () => selectArtist(a.key);
      card.onclick = open;
      card.onkeydown = e => { if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } };
      const pImg = artistPortrait(a.key, 200);
      const thumb = pImg
        ? `<img class="artist-portrait" loading="lazy" decoding="async" src="${pImg}" alt="">`
        : (a.rep && a.rep.img)
          ? `<img loading="lazy" decoding="async" src="${imgURL(a.rep.img, 200)}" alt="">`
          : `<div class="artist-noimg">❖</div>`;
      const ls = lifespanStr(a.key);
      card.innerHTML = `<div class="artist-thumb">${thumb}</div>`+
        `<div class="artist-meta"><div class="artist-name">${esc(artistName(a))}</div>`+
        (ls ? `<div class="artist-life">${esc(ls)}</div>` : "")+
        `<div class="artist-count">${a.n} ${esc(plu(a.n, "works"))}</div></div>`;
      frag.appendChild(card);
    });
    artistIndex.innerHTML = ""; artistIndex.appendChild(frag);
    $("artist-filter-count").textContent = q ? `${list.length} / ${artistAgg.length}` : "";
    if(artistIndexOn){ $("shown-count").textContent = list.length; $("t-works").textContent = plu(list.length, "artists"); }  // 计的是艺术家数
  }
  function showArtistIndex(){
    clearMuseum();
    artistIndexOn = true; museumIndexOn = false; artistFilter = null;
    $("museum-btn").classList.remove("active");
    artistIdxFilter = ""; { const fi = $("artist-filter"); if(fi){ fi.value = ""; fi.placeholder = T("filter_artist"); } }
    $("artist-index-bar").style.display = "flex";
    renderArtistIndex();
    if(!_metaLoaded) loadMeta().then(() => { if(artistIndexOn) renderArtistIndex(); });  // artists.js 到达后补生卒年
    artistIndex.style.display = "grid";
    artistBar.style.display = "none"; $("artist-header").style.display = "none";
    gallery.style.display = "none"; pagination.innerHTML = ""; noResults.style.display = "none";
    eraTabs.style.display = "none"; timelineBar.classList.remove("show");
    $("artist-btn").classList.add("active");
    syncURL();
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function clearMuseum(){ museumFilter = null; $("museum-bar").style.display = "none"; $("museum-header").style.display = "none"; }
  function selectArtist(key){
    clearMuseum();
    artistFilter = key; artistIndexOn = false; museumIndexOn = false;
    $("museum-btn").classList.remove("active");
    if(!_metaLoaded) loadMeta().then(() => { if(artistFilter === key) selectArtist(key); });  // artists.js 到达后补小传
    artistIndex.style.display = "none"; $("artist-index-bar").style.display = "none"; gallery.style.display = ""; eraTabs.style.display = "none";
    timelineBar.classList.remove("show");   // 专辑视图不显示时间线条
    const a = artistAgg.find(x => x.key === key);
    artistBar.style.display = "flex"; artistBar.innerHTML = "";
    const back = document.createElement("button");
    back.className = "crumb"; back.innerHTML = "‹ " + esc(T("all_artists"));
    back.onclick = showArtistIndex;
    const cur = document.createElement("span");
    cur.className = "cur";
    cur.innerHTML = esc(a ? artistName(a) : key) + ` <small>${a ? a.n : 0} ${esc(plu(a ? a.n : 0, "artist_works"))}</small>`;
    artistBar.appendChild(back); artistBar.appendChild(cur);
    // 艺术家小传头图
    const hdr = $("artist-header");
    const bio = artistBio(key), ls = lifespanStr(key), cty = artistCountry(key);
    const sub = [ls, cty].filter(Boolean).join(" · ");
    const alt = a ? (lang === "en" ? a.zh : a.en) : "";
    const pCover = artistPortrait(key, 120);
    const cover = pCover
      ? `<img class="ah-cover artist-portrait" loading="lazy" decoding="async" src="${pCover}" alt="">`
      : (a && a.rep && a.rep.img)
        ? `<img class="ah-cover" loading="lazy" decoding="async" src="${imgURL(a.rep.img, 120)}" alt="">`
        : `<div class="ah-cover ah-noimg">❖</div>`;
    hdr.innerHTML = cover +
      `<div class="ah-info">`+
        `<div class="ah-name">${esc(a ? artistName(a) : key)}</div>`+
        (alt && alt !== (a ? artistName(a) : key) ? `<div class="ah-altname">${esc(alt)}</div>` : "")+
        (sub ? `<div class="ah-sub">${esc(sub)}</div>` : "")+
        (bio ? `<p class="ah-bio">${esc(bio)}</p>` : "")+
        `<div class="ah-count">${a ? a.n : 0} ${esc(plu(a ? a.n : 0, "artist_works"))}</div>`+
      `</div>`;
    hdr.style.display = "flex";
    $("artist-btn").classList.add("active");
    applyFilters();
  }
  function exitArtist(){
    artistIndexOn = false; museumIndexOn = false; artistFilter = null;
    artistIndex.style.display = "none"; $("artist-index-bar").style.display = "none"; artistBar.style.display = "none"; $("artist-header").style.display = "none";
    $("museum-btn").classList.remove("active");
    gallery.style.display = ""; eraTabs.style.display = "";
    timelineBar.classList.toggle("show", timelineMode);   // 回到画廊：时间线条与开关状态一致
    $("artist-btn").classList.remove("active");
    applyFilters();
  }

  // —— 馆藏地：某某美术馆藏品展 ——
  const muLabel = d => (lang === "en" ? (d.location_en || d.location) : d.location);
  function selectMuseum(name){
    if(!name || name === "未知收藏") return;
    exitArtist();                       // 退出艺术家视图（互斥）
    museumFilter = name;
    eraTabs.style.display = "none"; gallery.style.display = "";
    timelineBar.classList.remove("show");   // 藏品展视图不显示时间线条
    const works = DATA.filter(d => d.location === name);
    const rep = works.find(d => d.img);
    const enName = works[0] ? (works[0].location_en || "") : "";
    const dispName = lang === "en" ? (enName || name) : name;
    const alt = lang === "en" ? name : (enName && enName !== name ? enName : "");
    const bar = $("museum-bar"); bar.style.display = "flex"; bar.innerHTML = "";
    const back = document.createElement("button");
    back.className = "crumb"; back.textContent = T("back_all"); back.onclick = exitMuseum;
    bar.appendChild(back);
    const hdr = $("museum-header");
    const cover = (rep && rep.img)
      ? `<img class="ah-cover" loading="lazy" decoding="async" src="${imgURL(rep.img, 120)}" alt="">`
      : `<div class="ah-cover ah-noimg">❖</div>`;
    hdr.innerHTML = cover +
      `<div class="ah-info">`+
        `<div class="ah-name">${esc(dispName)}</div>`+
        (alt && alt !== dispName ? `<div class="ah-altname">${esc(alt)}</div>` : "")+
        `<div class="ah-sub">${esc(T("exhibit"))}</div>`+
        `<div class="ah-count">${works.length} ${esc(plu(works.length, "artist_works"))}</div>`+
      `</div>`;
    hdr.style.display = "flex";
    applyFilters();
  }
  function exitMuseum(){
    museumFilter = null;
    $("museum-bar").style.display = "none"; $("museum-header").style.display = "none";
    gallery.style.display = ""; eraTabs.style.display = "";
    timelineBar.classList.toggle("show", timelineMode);
    applyFilters();
  }
  // —— 按馆藏博物馆索引（复用艺术家索引网格）——
  function renderMuseumIndex(){
    const q = artistIdxFilter;
    // 默认只列 ≥2 件的真实馆藏（去长尾）；一旦筛选则搜全部（含单件馆，可被找到）
    let list = q ? museumAgg.filter(a => ((a.name||"") + " " + (a.en||"")).toLowerCase().includes(q)) : museumAgg.filter(a => a.n >= 2);
    if(idxSort === "name") list = list.slice().sort((a,b) => ((lang==="en"?a.en:a.name)||"").localeCompare((lang==="en"?b.en:b.name)||"", "zh"));
    const frag = document.createDocumentFragment();
    list.forEach(a => {
      const card = document.createElement("div");
      card.className = "artist-card"; card.tabIndex = 0;
      const nm = (lang === "en" ? a.en : a.name) || a.name;
      card.setAttribute("role","button"); card.setAttribute("aria-label", nm);
      const open = () => selectMuseum(a.name);
      card.onclick = open;
      card.onkeydown = e => { if(e.key==="Enter"||e.key===" "){ e.preventDefault(); open(); } };
      const thumb = (a.rep && a.rep.img)
        ? `<img loading="lazy" decoding="async" src="${imgURL(a.rep.img, 200)}" alt="">`
        : `<div class="artist-noimg">🏛</div>`;
      card.innerHTML = `<div class="artist-thumb">${thumb}</div>`+
        `<div class="artist-meta"><div class="artist-name">${esc(nm)}</div>`+
        `<div class="artist-count">${a.n} ${esc(plu(a.n, "works"))}</div></div>`;
      frag.appendChild(card);
    });
    artistIndex.innerHTML = ""; artistIndex.appendChild(frag);
    $("artist-filter-count").textContent = q ? `${list.length} / ${museumAgg.length}` : "";
    if(museumIndexOn){ $("shown-count").textContent = list.length; $("t-works").textContent = plu(list.length, "museums"); }  // 计的是博物馆数
  }
  function showMuseumIndex(){
    clearMuseum(); exitArtist();          // 与艺术家视图互斥（exitArtist 会走 applyFilters，随后覆盖）
    museumIndexOn = true; artistIndexOn = false; artistFilter = null;
    artistIdxFilter = ""; { const fi = $("artist-filter"); if(fi){ fi.value = ""; fi.placeholder = T("filter_museum"); } }
    $("artist-index-bar").style.display = "flex";
    renderMuseumIndex();
    artistIndex.style.display = "grid";
    artistBar.style.display = "none"; $("artist-header").style.display = "none";
    gallery.style.display = "none"; pagination.innerHTML = ""; noResults.style.display = "none";
    eraTabs.style.display = "none"; timelineBar.classList.remove("show");
    $("artist-btn").classList.remove("active"); $("museum-btn").classList.add("active");
    syncURL();
    window.scrollTo({top:0, behavior:"smooth"});
  }
  function exitMuseumIndex(){
    museumIndexOn = false;
    artistIndex.style.display = "none"; $("artist-index-bar").style.display = "none";
    $("museum-btn").classList.remove("active");
    const fi = $("artist-filter"); if(fi) fi.placeholder = T("filter_artist");
    gallery.style.display = ""; eraTabs.style.display = "";
    timelineBar.classList.toggle("show", timelineMode);
    applyFilters();
  }

  // —— 筛选 ——
  function applyFilters(){
    if(artistIndexOn || museumIndexOn) return;   // 索引视图有专用筛选框，主搜索/下拉不应改动隐藏的画廊或计数
    const q = searchInput.value.trim().toLowerCase();
    const fe = eraFilter.value, fm = mediumFilter.value, fc = countryFilter.value;
    filtered = DATA.filter(d => {
      if(artistFilter && (d.artist_en || d.artist) !== artistFilter) return false;
      if(museumFilter && d.location !== museumFilter) return false;
      if(favOnly && !favs.has(d.id)) return false;
      if(fe && d.era !== fe) return false;
      if(fm && d.medium !== fm) return false;
      if(fc && d.country !== fc) return false;
      if(periodFilter && periodKey(d.sy) !== periodFilter) return false;
      // 检索串惰性预拼一次并挂在记录上：此前每敲一个字符都要为 16000+ 条重新拼 14 段字符串
      // 并 toLowerCase（实测 47ms/次，中端手机约 200ms，打字明显滞后且不断触发 GC）。
      if(q){
        if(d._h === undefined) d._h = (d.title+" "+d.artist+" "+d.year+" "+d.era+" "+d.medium+" "+d.location+" "+(d.country||"")+" "+
          (d.tg?d.tg.join(" "):"")+" "+(d.tg_en?d.tg_en.join(" "):"")+" "+
          (d.title_en||"")+" "+(d.artist_en||"")+" "+(d.era_en||"")+" "+(d.location_en||"")+" "+(d.country_en||"")+" "+(d.medium_en||"")+" "+(d.py||"")).toLowerCase();
        if(!d._h.includes(q)) return false;
      }
      return true;
    });
    if(timelineMode){ filtered.sort((a,b)=>a.sy-b.sy); }
    else {
      const sf = $("sort-filter").value;
      if(sf==="year_asc" || (artistFilter && sf==="default")) filtered.sort((a,b)=>a.sy-b.sy);  // 艺术家专辑默认按创作年代
      else if(sf==="year_desc") filtered.sort((a,b)=>b.sy-a.sy);
      else if(sf==="title") filtered.sort((a,b)=>F(a,"title").localeCompare(F(b,"title"), lang==="en"?"en":"zh"));
    }
    page = 0;
    buildTabs();
    syncURL();
    render();
  }

  // —— 屏幕阅读器播报 ——
  function announce(msg){ const l=$("live"); if(l) l.textContent = msg; }

  // —— 渲染 ——
  function render(){
    $("shown-count").textContent = filtered.length;
    $("t-works").textContent = plu(filtered.length, "works");   // 画廊/专辑视图计的是作品数（索引视图各自改回）
    if(filtered.length === 0){
      gallery.innerHTML=""; pagination.innerHTML="";
      $("t-noresults").textContent = favOnly ? T("fav_empty") : T("no_results");
      noResults.style.display="block";
      announce(favOnly ? T("fav_empty") : T("no_results"));
      return;
    }
    announce(filtered.length + " " + plu(filtered.length, "works"));
    noResults.style.display = "none";
    const totalPages = Math.ceil(filtered.length / PER_PAGE);
    if(page >= totalPages) page = totalPages - 1;
    const slice = filtered.slice(page*PER_PAGE, page*PER_PAGE + PER_PAGE);
    gallery.className = "gallery" + (listView ? " list-view" : "");
    const frag = document.createDocumentFragment();
    slice.forEach((d, i) => { const c = makeCard(d, i); c.style.animationDelay = Math.min(i, 14) * 0.022 + "s"; frag.appendChild(c); });
    gallery.innerHTML = ""; gallery.appendChild(frag);
    renderPagination(totalPages);
    window.scrollTo({top:0, behavior:"smooth"});
  }

  function makeCard(d, i){
    // 卡片本身不再是 role=button（内含真实的收藏 <button>，属 ARIA 非法嵌套）。
    // 改由标题的原生 <button.card-open> 承担键盘可达性：其 Enter/Space 产生的 click 会冒泡到这里。
    const card = document.createElement("div");
    card.className = "art-card";
    // 标题现在是真链接（见下）。普通左键 → 拦下走弹窗；Ctrl/⌘/中键/Shift 点击 → 放行，
    // 让用户能在新标签页打开静态作品页。
    card.onclick = (e) => {
      if(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button === 1) return;
      e.preventDefault();
      openModal(d);
    };
    if(HOVER && d.img){ let pf; card.addEventListener("mouseenter", () => { pf = setTimeout(() => prefetchFull(d), 140); }); card.addEventListener("mouseleave", () => clearTimeout(pf)); }
    const imgWrap = document.createElement("div");
    imgWrap.className = "card-img-wrap";
    imgWrap.style.setProperty("--ar", d.ar ? Math.max(0.45, Math.min(2.4, d.ar)) : 1.33);  // 真实宽高比（极端长卷/竖轴做限幅，contain 不裁切）
    if(d.img){
      imgWrap.classList.add("loading");
      const img = document.createElement("img");
      const eager = i < 8;   // 首屏首行：eager + 高优先级，其余懒加载
      img.loading = eager ? "eager" : "lazy"; img.decoding="async"; img.alt=F(d,"title");
      if(eager) img.fetchPriority = "high";
      img.src=imgURL(d.img, 250);   // 网格卡约 248px，DPR 换算后 1× 取 250 / 2× 取 500
      img.onload = () => { img.classList.add("loaded"); imgWrap.classList.remove("loading"); imgWrap.classList.add("loaded"); };
      img.onerror = () => { imgWrap.classList.remove("loading"); imgWrap.innerHTML = placeholderHTML(d); };
      imgWrap.appendChild(img);
    } else {
      imgWrap.innerHTML = placeholderHTML(d);
    }
    const num = document.createElement("div");
    num.className="card-num"; num.textContent="#"+d.id; imgWrap.appendChild(num);
    const fav = document.createElement("button");
    fav.className = "card-fav" + (isFav(d.id) ? " on" : "");
    fav.innerHTML = isFav(d.id) ? "♥" : "♡";
    fav.setAttribute("aria-label", T("fav"));
    fav.onclick = (e) => {
      e.stopPropagation();
      const on = toggleFav(d.id);
      fav.classList.toggle("on", on); fav.innerHTML = on ? "♥" : "♡";
      if(favOnly) applyFilters();
    };
    imgWrap.appendChild(fav);
    const body = document.createElement("div");
    body.className="card-body";
    const q = searchInput.value.trim().toLowerCase();   // 命中词高亮（aria-label 仍用纯文本）
    body.innerHTML =
      `<div><div class="card-era">${esc(F(d,"era"))}</div>`+
      // 标题用真链接指向预渲染的作品页：① 给 16000+ 静态页真实内链（此前全站零内链，
      // 搜索引擎只能靠 sitemap 排队）② 无 JS 时仍可浏览 ③ 支持新标签页打开。
      // 普通左键点击由 onclick 拦下走弹窗，交互与原先完全一致（渐进增强）。
      `<a class="card-open" href="art/${d.id}.html" aria-label="${esc(F(d,"title") + " · " + F(d,"artist"))}"><span class="card-title">${hl(F(d,"title"), q)}</span></a>`+
      `<div class="card-artist">${hl(F(d,"artist"), q)}</div>`+
      `<div class="card-year">${esc(F(d,"year"))}</div></div>`;
    card.appendChild(imgWrap); card.appendChild(body);
    return card;
  }

  function placeholderHTML(d){
    return `<div class="card-placeholder ${eraTheme(d)}">`+
      `<div class="ph-inner"><span class="ph-glyph">❖</span>`+
      `<span class="ph-title">${esc(F(d,"title"))}</span>`+
      `<span class="ph-artist">${esc(F(d,"artist"))}</span></div></div>`+
      `<div class="card-num">#${d.id}</div>`;
  }
  function wikiURL(d){
    return "https://en.wikipedia.org/w/index.php?search=" + encodeURIComponent(d.title_en + " " + d.artist_en);
  }

  function renderPagination(totalPages){
    pagination.innerHTML = "";
    if(totalPages <= 1) return;
    const mk = (label, p, opts={}) => {
      const b = document.createElement("button");
      b.className = "page-btn" + (opts.active ? " active" : "");
      b.textContent = label;
      if(opts.disabled) b.disabled = true; else b.onclick = () => { page=p; render(); syncURL(); };
      return b;
    };
    pagination.appendChild(mk("‹", page-1, {disabled: page===0}));
    const win=[], add=p=>{ if(p>=0&&p<totalPages&&!win.includes(p)) win.push(p); };
    add(0);add(1);for(let p=page-1;p<=page+1;p++)add(p);add(totalPages-2);add(totalPages-1);
    win.sort((a,b)=>a-b);
    let last=-1;
    win.forEach(p=>{
      if(p-last>1){ const dots=document.createElement("span"); dots.textContent="…"; dots.style.cssText="color:var(--text3);padding:0 4px;align-self:center"; pagination.appendChild(dots); }
      pagination.appendChild(mk(String(p+1), p, {active:p===page})); last=p;
    });
    pagination.appendChild(mk("›", page+1, {disabled: page===totalPages-1}));
  }

  // —— URL 状态同步（筛选 → 查询串，详情 → #art-id，皆可分享）——
  const modalOpen = () => $("modal").classList.contains("open");
  function currentModalId(){ return (modalOpen() && modalEntry) ? modalEntry.id : null; }
  function syncURL(){
    const p = new URLSearchParams();
    if(searchInput.value.trim()) p.set("q", searchInput.value.trim());
    if(eraFilter.value) p.set("era", eraFilter.value);
    if(mediumFilter.value) p.set("medium", mediumFilter.value);
    if(countryFilter.value) p.set("region", countryFilter.value);
    if(periodFilter) p.set("period", periodFilter);
    if(timelineMode) p.set("timeline", "1");
    if(favOnly) p.set("fav", "1");
    if(artistFilter) p.set("artist", artistFilter);
    else if(artistIndexOn) p.set("view", "artists");
    else if(museumIndexOn) p.set("view", "museums");
    if(museumFilter) p.set("museum", museumFilter);
    const sf = $("sort-filter").value; if(sf && sf !== "default") p.set("sort", sf);
    if(listView) p.set("list", "1");
    if(page > 0) p.set("p", page + 1);
    const qs = p.toString();
    const mid = currentModalId();
    const url = location.pathname + (qs ? ("?" + qs) : "") + (mid ? ("#art-" + mid) : "");
    try{ history.replaceState(null, "", url); }catch(e){}
  }
  function restoreFromURL(){
    const p = new URLSearchParams(location.search);
    if(p.get("q")) searchInput.value = p.get("q");
    if(p.get("era")) eraFilter.value = p.get("era");
    if(p.get("medium")) mediumFilter.value = p.get("medium");
    if(p.get("region")) countryFilter.value = p.get("region");
    if(p.get("period")) periodFilter = p.get("period");
    if(p.get("timeline") === "1"){ timelineMode = true; timelineBar.classList.add("show"); $("timeline-btn").classList.add("active"); }
    if(p.get("fav") === "1"){ favOnly = true; $("fav-only-btn").classList.add("active"); }
    if(p.get("sort")) $("sort-filter").value = p.get("sort");
    if(p.get("list") === "1"){ listView = true; $("view-toggle").textContent = "☰"; }   // 列表视图（page 于 applyFilters 后单独恢复）
  }

  // —— 详情弹窗 ——
  let modalEntry = null, modalIndex = -1, lastFocus = null;
  let lbLastFocus = null, helpLastFocus = null, aboutLastFocus = null;   // 各对话框关闭后归还焦点
  let _nbrPreload = [], _nbrTimer = 0;
  function openModal(d){
    if(!modalOpen()) lastFocus = document.activeElement;   // 记住触发元素以便归还焦点
    modalEntry = d; modalIndex = filtered.indexOf(d);
    fillModal(d);
    $("modal").classList.add("open");
    document.body.style.overflow = "hidden";
    syncURL();
    setTimeout(() => { try{ $("modal-close").focus(); }catch(e){} }, 30);
  }
  // 让非原生按钮元素也能键盘操作（Enter/Space）；handler 为 null 时撤销交互与语义
  function setActivation(el, handler){
    if(handler){
      el.tabIndex = 0; el.setAttribute("role", "button"); el.onclick = handler;
      el.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); handler(); } };
    } else {
      el.removeAttribute("tabindex"); el.removeAttribute("role"); el.onclick = null; el.onkeydown = null;
    }
  }
  // 弹窗元数据（时代/媒材/国家）可点击 → 跳转到该维度的全部作品
  function metaClick(el, value, kind){
    const on = !!value;
    el.classList.toggle("meta-link", on);
    setActivation(el, on ? () => pivotFilter(kind, value) : null);
  }
  function pivotFilter(kind, value){
    closeModal();
    clearMuseum();
    artistFilter = null; artistIndexOn = false; museumIndexOn = false;
    artistIndex.style.display = "none"; $("artist-index-bar").style.display = "none";
    artistBar.style.display = "none"; $("artist-header").style.display = "none";
    $("artist-btn").classList.remove("active"); $("museum-btn").classList.remove("active");
    gallery.style.display = ""; eraTabs.style.display = "";
    searchInput.value = ""; eraFilter.value = ""; mediumFilter.value = ""; countryFilter.value = ""; periodFilter = null;
    favOnly = false; $("fav-only-btn").classList.remove("active");   // 「查看该维度全部作品」不应被收藏筛选约束
    (kind === "era" ? eraFilter : kind === "medium" ? mediumFilter : countryFilter).value = value;
    buildTimelineBar();
    applyFilters();
  }
  function fillModal(d){
    modalEntry = d;
    const img=$("modal-img"), ph=$("modal-placeholder"), badge=$("zoom-badge");
    const wrap=$("modal-img-wrap");
    if(d.img){
      img.style.display="block";
      img.style.backgroundImage = d.img ? `url("${imgURL(d.img, 250)}")` : "none";  // 缩略图秒显垫底(LQIP)，与网格同 URL 命中缓存
      img.fetchPriority = "high";                                                    // 优先拉当前大图
      img.src=imgURL(d.img); img.alt=F(d,"title");
      ph.classList.remove("show"); badge.style.display="flex"; wrap.style.cursor="zoom-in";
      img.onerror = () => { img.style.backgroundImage="none"; img.style.display="none"; badge.style.display="none"; wrap.style.cursor="default"; showModalPlaceholder(d); };
    } else {
      img.style.backgroundImage="none"; img.style.display="none"; badge.style.display="none"; wrap.style.cursor="default"; showModalPlaceholder(d);
    }
    const eraEl=$("modal-era"); eraEl.textContent=F(d,"era"); metaClick(eraEl, d.era, "era");
    $("modal-title").textContent=F(d,"title");
    // 东亚作品若无中文译名，标题位显示的是汉字原题（多为日文原题）。
    // 必须讲清楚这不是中译，并把英文题名一并列出，便于按英文检索文献。
    (function(){
      const el=$("modal-alt"); if(!el) return;
      const OT={ja:["日文原题","Japanese original title"],cma:["原文题名","Original-language title"]};
      const tag=d.ot&&OT[d.ot];
      const en=d.title_en&&d.title_en!==d.title?d.title_en:"";
      if(!tag&&!en){el.hidden=true;el.textContent="";return;}
      el.hidden=false; el.innerHTML="";
      if(tag){const s=document.createElement("span");s.className="ot-tag";s.textContent=lang==="en"?tag[1]:tag[0];el.appendChild(s);}
      if(en)el.appendChild(document.createTextNode((lang==="en"?"":"英文题名：")+en));
    })();
    $("modal-artist").textContent=F(d,"artist");
    $("modal-year").textContent=F(d,"year");
    const medEl=$("modal-medium"); medEl.textContent=F(d,"medium"); metaClick(medEl, d.medium, "medium");
    const locEl = $("modal-location");
    locEl.textContent = F(d,"location");
    const clickable = d.location && d.location !== "未知收藏" && museumFilter !== d.location;
    locEl.classList.toggle("loc-link", !!clickable);
    setActivation(locEl, clickable ? () => { closeModal(); selectMuseum(d.location); } : null);
    const ctyEl=$("modal-country"); ctyEl.textContent=F(d,"country"); metaClick(ctyEl, (d.country && d.country!=="未知") ? d.country : null, "country");
    fillDesc(d);
    fillTags(d);
    fillCredit(d);
    fillRelated(d);
    $("modal-num").textContent = lang==="zh" ? `第 ${d.id} / ${TOTAL} ${T("of_total")}` : `${d.id} / ${TOTAL}`;
    const mf = $("modal-fav");
    mf.classList.toggle("on", isFav(d.id));
    mf.innerHTML = (isFav(d.id) ? "♥ " : "♡ ") + T(isFav(d.id) ? "fav_on" : "fav");
    const al = $("modal-artist-link");
    const akey = d.artist_en || d.artist;
    if(artistFilter === akey){ al.style.display = "none"; }
    else { al.style.display = ""; al.textContent = T("more_by"); }
    fillArtistAvatar(d, akey);
    scheduleNeighborPreload();
  }
  // 弹窗艺术家小头像（肖像懒加载到达后填充；点击跳该艺术家）
  function fillArtistAvatar(d, akey){
    const av = $("modal-artist-avatar");
    const setP = () => {
      const p = artistPortrait(akey, 40);   // 弹窗小头像 38px
      if(p){ av.src = p; av.style.display = ""; av.title = F(d, "artist"); av.onclick = () => { closeModal(); selectArtist(akey); }; }
      else { av.style.display = "none"; av.removeAttribute("src"); av.onclick = null; }
    };
    setP();
    if(!_metaLoaded) loadMeta().then(() => { if(modalEntry === d) setP(); });
  }
  // 元数据（desc/credits/artists）不进首屏关键路径，首次开弹窗或进艺术家视图时懒加载并缓存
  let DESC = window.ART_DESC || null;
  let _metaLoaded = !!(window.ART_DESC && window.ART_CREDITS && window.ART_ARTISTS), _metaLoading = null;
  function _loadScript(src){ return new Promise(res => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = res; document.head.appendChild(s); }); }
  function loadMeta(){
    if(_metaLoaded) return Promise.resolve();
    if(_metaLoading) return _metaLoading;
    _metaLoading = Promise.all([
      window.ART_DESC ? null : _loadScript("desc.js"),
      window.ART_CREDITS ? null : _loadScript("credits.js"),
      window.ART_ARTISTS ? null : _loadScript("artists.js")
    ]).then(() => { DESC = window.ART_DESC || {}; CREDITS = window.ART_CREDITS || {}; ARTISTS = window.ART_ARTISTS || {}; _metaLoaded = true; });
    return _metaLoading;
  }
  // e[2] === "t" 表示这条描述是「艺术家+媒材+年代+馆藏」的事实模板 —— 它与弹窗上方的元数据行
  // 逐字节等价，当正文渲染只会让读者觉得被敷衍。故模板与空值一律显示「暂无详述」。
  // e[2] 是分语言的模板标志：含 z = 中文侧为事实模板，含 e = 英文侧为事实模板。
  // 模板与页面上方的元数据行逐字节等价，不作正文；但只要**另一侧**有真实文字就回退显示它，
  // 免得「中文模板 + 英文真实维基首段」的作品两边都空着（曾因此埋掉 3981 件真内容）。
  function pickDesc(d){
    const e = DESC && DESC[d.id];
    if(!e) return "";
    const f = e[2] || "";
    const zh = f.includes("z") ? "" : (e[0] || "");
    const en = f.includes("e") ? "" : (e[1] || "");
    return lang === "en" ? (en || zh) : (zh || en);
  }
  function setDesc(el, d){
    const t = pickDesc(d);
    el.textContent = t || T("no_desc");
    el.classList.toggle("is-empty", !t);
  }
  // 主题标签（大都会 API 的 tags）：点击即以该题材搜索全站——一条 Wikidata 给不了的浏览轴。
  function fillTags(d){
    const box = $("modal-tags");
    const list = (lang === "en" ? (d.tg_en || d.tg) : (d.tg || d.tg_en)) || [];
    if(!list.length){ box.style.display = "none"; box.innerHTML = ""; return; }
    box.innerHTML = list.map(t => `<button class="mt-tag" type="button" data-t="${esc(t)}">${esc(t)}</button>`).join("");
    box.style.display = "";
    box.querySelectorAll(".mt-tag").forEach(b => {
      b.onclick = () => { closeModal(); searchInput.value = b.dataset.t; page = 0; applyFilters(); window.scrollTo({top:0, behavior:"smooth"}); };
    });
  }
  function fillDesc(d){
    const el = $("modal-desc");
    if(_metaLoaded){ setDesc(el, d); return; }
    el.textContent = "";
    loadMeta().then(() => { if(modalEntry === d) setDesc(el, d); });
  }

  // 许可名归一（「public domain」→ 本地化标签），弹窗署名与灯箱题注共用，避免逻辑分叉
  function licLabel(l){ return l ? (/public domain/i.test(l) ? T("credit_pd") : l) : null; }
  function fillCredit(d){
    const mc = $("modal-credit");
    if(!_metaLoaded) loadMeta().then(() => { if(modalEntry === d) fillCredit(d); });  // credits.js 到达后补署名
    const cr = (d.img && (d.file || d.su)) ? CREDITS[d.id] : null;
    if(!cr){ mc.style.display = "none"; mc.innerHTML = ""; return; }
    // 溯源链接：馆藏 API 来源（大都会等）指向该馆藏品页；Commons 来源指向文件页。
    const isMuseumSrc = !!d.su;
    const src = isMuseumSrc ? d.su : ("https://commons.wikimedia.org/wiki/File:" + encodeURIComponent(decodeFile(d.file)));
    const parts = [];
    // CC 类许可的授权人是拍摄/上传者（cr.ph），不是几百年前的画家——按许可要求署真正的授权人。
    // PD/CC0 无授权人可署，cr.a（画家）作为「此图为某人作品的翻拍」信息保留。
    if(cr.ph) parts.push(esc(T("credit_photo")) + " " + esc(cr.ph));
    else if(cr.a) parts.push(esc(cr.a));
    if(cr.l){
      const licName = licLabel(cr.l);
      const safeLu = cr.lu && /^https?:/i.test(cr.lu);   // 仅 http(s) 才作链接，挡住 javascript:/data: 等注入
      parts.push(safeLu ? `<a href="${esc(cr.lu)}" target="_blank" rel="noopener">${esc(licName)}</a>` : esc(licName));
    }
    // 链接文案按来源域名决定——写死某一家会在别家来源上显示错误机构名（曾把克利夫兰标成大都会）
    const srcLabel = !isMuseumSrc ? "Wikimedia Commons ↗"
      : /metmuseum\./i.test(src) ? "Metropolitan Museum ↗"
      : /clevelandart\./i.test(src) ? "Cleveland Museum of Art ↗"
      : (cr.a ? esc(cr.a) + " ↗" : "查看馆藏页 ↗");
    parts.push(`<a href="${esc(src)}" target="_blank" rel="noopener">${srcLabel}</a>`);
    mc.innerHTML = `<span class="mc-label">${esc(T("credit_img"))}：</span>` + parts.join(" · ");
    mc.style.display = "";
  }
  // 弹窗底部：同一艺术家的其他作品缩略图条
  function relThumbs(list){
    return `<div class="mr-strip">` + list.map(x =>
      `<img class="mr-thumb" tabindex="0" role="button" loading="lazy" decoding="async" src="${imgURL(x.img, 90)}" alt="${esc(F(x,"title"))}" aria-label="${esc(F(x,"title"))}" title="${esc(F(x,"title") + " · " + F(x,"year"))}" data-id="${x.id}">`
    ).join("") + `</div>`;
  }
  // 在大池子里等距取样（而非取头 10 件——那样多是同一批相邻 id）；以 d.id 作起点，不同作品看到不同邻居
  function pickSpread(pool, n, seed){
    if(pool.length <= n) return pool.slice();
    const step = Math.max(1, Math.floor(pool.length / n)), out = [];
    let i = seed % pool.length;
    for(let k = 0; k < n; k++){ out.push(pool[i % pool.length]); i += step; }
    return out;
  }
  function fillRelated(d){
    const box = $("modal-related");
    const key = d.artist_en || d.artist;
    const agg = artistByKey.get(key);                                     // 查表，免每次全量 DATA 扫描
    const byArtist = (agg ? agg.works.filter(x => x.id !== d.id && x.img) : []).slice(0, 10);
    // 同时代（排除同一艺术家，避免与上一条重复）——让「孤本」艺术家的作品也有可去处
    const eraPool = (eraByKey.get(d.era) || []).filter(x => x.id !== d.id && x.img && (x.artist_en || x.artist) !== key);
    const byEra = pickSpread(eraPool, 10, d.id);
    let html = "";
    if(byArtist.length) html += `<div class="mr-label">${esc(T("related_by"))}</div>` + relThumbs(byArtist);
    if(byEra.length) html += `<div class="mr-label">${esc(T("related_era"))}${d.era ? esc((lang === "en" ? ": " : "：") + F(d,"era")) : ""}</div>` + relThumbs(byEra);
    if(!html){ box.style.display = "none"; box.innerHTML = ""; return; }
    box.style.display = "";
    box.innerHTML = html;
    box.querySelectorAll(".mr-thumb").forEach(im => {
      const open = () => { const w = DATA.find(y => y.id === +im.dataset.id); if(w) openModal(w); };
      im.onclick = open;
      im.onkeydown = e => { if(e.key === "Enter" || e.key === " "){ e.preventDefault(); open(); } };
    });
  }

  // 没有图时到底该说什么：仍在版权期的要讲明是法律原因、哪一年解禁，
  // 而不是含糊的「暂无」——《格尔尼卡》不是我们没采到，是 2044 年之前根本不会有自由图像。
  function noImgNote(d){
    if(d.pdy === undefined) return T("img_na");
    return d.pdy > 0 ? T("cr_note").replace("{y}", d.pdy) : T("cr_note_unk");
  }
  function showModalPlaceholder(d){
    const ph=$("modal-placeholder");
    ph.className="modal-img-placeholder show "+eraTheme(d);
    ph.innerHTML=
      `<span class="ph-glyph">❖</span>`+
      `<span class="mph-title">${esc(F(d,"title"))}</span>`+
      `<span class="mph-artist">${esc(F(d,"artist"))}</span>`+
      `<span class="mph-note">${esc(noImgNote(d))}</span>`+
      `<a class="mph-wiki" href="${esc(wikiURL(d))}" target="_blank" rel="noopener">${esc(T("view_wiki"))} ↗</a>`;
  }
  function closeModal(){ $("modal").classList.remove("open"); document.body.style.overflow=""; syncURL(); try{ lastFocus && lastFocus.focus(); }catch(e){} }
  // 焦点陷阱：Tab 在对话框内循环（弹窗/灯箱/帮助/关于共用）
  function trapTab(e, root){
    const f = [...root.querySelectorAll('button, a[href], input, select, [tabindex]:not([tabindex="-1"])')].filter(el => el.offsetParent !== null && !el.disabled);
    if(!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if(e.shiftKey && document.activeElement === first){ e.preventDefault(); last.focus(); }
    else if(!e.shiftKey && document.activeElement === last){ e.preventDefault(); first.focus(); }
  }
  function navModal(dir){
    if(filtered.length===0) return;
    if(modalIndex < 0){ const j = filtered.indexOf(modalEntry); modalIndex = j >= 0 ? j : (dir > 0 ? -1 : 0); }  // 相关作品可能不在当前筛选列表
    modalIndex=(modalIndex+dir+filtered.length)%filtered.length;
    modalEntry=filtered[modalIndex];
    fillModal(modalEntry);
    syncURL();
  }
  // 预加载相邻作品大图：连续翻页时秒开（延后 250ms 不与当前图抢带宽；
  // 保留 Image 引用防止被 GC 中断下载）
  function scheduleNeighborPreload(){ clearTimeout(_nbrTimer); _nbrTimer = setTimeout(preloadNeighbors, 250); }
  function preloadNeighbors(){
    if(modalIndex < 0 || !filtered.length) return;
    const imgs = [];
    for(const dir of [1, -1]){
      const n = filtered[(modalIndex + dir + filtered.length) % filtered.length];
      if(n && n.img){ const im = new Image(); im.decoding = "async"; im.src = imgURL(n.img); imgs.push(im); }
    }
    _nbrPreload = imgs;
  }
  // 桌面端 hover 预取大图：悬停 140ms 即后台拉取，点开秒显（去重 + 持有引用防 GC）
  const HOVER = !!(window.matchMedia && window.matchMedia("(hover: hover)").matches);
  const _pfDone = new Set(), _pfHold = [];
  function prefetchFull(d){
    if(!d || !d.img || _pfDone.has(d.id)) return;
    _pfDone.add(d.id);
    const im = new Image(); im.decoding = "async";
    im.onload = im.onerror = () => { const k = _pfHold.indexOf(im); if(k >= 0) _pfHold.splice(k, 1); };
    im.src = imgURL(d.img);
    _pfHold.push(im);
  }

  // —— 高清灯箱（缩放 / 平移）——
  const lb=$("lightbox"), lbImg=$("lb-img"), lbStage=$("lb-stage"), lbSpinner=$("lb-spinner");
  let scale=1, tx=0, ty=0, dragging=false, sx=0, sy=0, stx=0, sty=0, hintTimer;
  function lbApply(){ lbImg.style.transform=`translate(${tx}px,${ty}px) scale(${scale})`; lbStage.classList.toggle("zoomed", scale>1); }
  function lbReset(){ scale=1; tx=0; ty=0; lbApply(); }
  function lbZoom(factor, cx, cy){
    const rect=lbImg.getBoundingClientRect();
    const ox=(cx==null?rect.width/2:cx-rect.left), oy=(cy==null?rect.height/2:cy-rect.top);
    const ns=Math.min(Math.max(scale*factor,1),8);
    if(ns===scale) return;
    tx-=ox*(ns/scale-1); ty-=oy*(ns/scale-1); scale=ns;
    if(scale===1){ tx=0; ty=0; }
    lbApply();
  }
  function openLightbox(d){
    if(!d || !d.img) return;
    lbLastFocus = document.activeElement;
    lbReset();
    lbSpinner.classList.add("show");
    lbImg.onload=()=>lbSpinner.classList.remove("show");
    lbImg.onerror=()=>lbSpinner.classList.remove("show");
    lbImg.src=imgURL(d.img); lbImg.alt=F(d,"title");
    let cap = F(d,"title")+" · "+F(d,"artist");
    const cr = CREDITS[d.id];
    if(cr && (cr.a || cr.l)){
      const lic = licLabel(cr.l);
      cap += "　·　" + T("credit_img") + ": " + [cr.a, lic].filter(Boolean).join(" / ");
    }
    $("lb-caption").textContent = cap;
    const orig = originalURL(d.file);
    const ol = $("lb-original");
    if(orig){ ol.href = orig; ol.style.display=""; } else { ol.style.display="none"; }
    lb.classList.add("open");
    setTimeout(() => { try{ $("lb-close").focus(); }catch(e){} }, 30);   // 焦点移入灯箱
    const hint=$("lb-hint"); hint.classList.remove("fade");
    clearTimeout(hintTimer); hintTimer=setTimeout(()=>hint.classList.add("fade"), 2600);
  }
  function closeLightbox(){ lb.classList.remove("open"); lbReset(); try{ lbLastFocus && lbLastFocus.focus(); }catch(e){} }

  lbStage.addEventListener("wheel", e=>{ e.preventDefault(); lbZoom(e.deltaY<0?1.15:0.87, e.clientX, e.clientY); }, {passive:false});
  lbStage.addEventListener("dblclick", e=>{ lbZoom(scale>1?0.001:2.4, e.clientX, e.clientY); });
  // 指针：单指拖动平移，双指捏合缩放
  const pts = new Map();
  let lastPinch = 0;
  lbStage.addEventListener("pointerdown", e=>{
    pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    lbStage.setPointerCapture(e.pointerId);
    if(pts.size===1 && scale>1){ dragging=true; lbStage.classList.add("grabbing"); sx=e.clientX; sy=e.clientY; stx=tx; sty=ty; }
    else if(pts.size===2){ dragging=false; lastPinch=0; }
  });
  lbStage.addEventListener("pointermove", e=>{
    if(!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, {x:e.clientX, y:e.clientY});
    if(pts.size===2){
      const [a,b] = [...pts.values()];
      const dist = Math.hypot(a.x-b.x, a.y-b.y);
      if(lastPinch) lbZoom(dist/lastPinch, (a.x+b.x)/2, (a.y+b.y)/2);
      lastPinch = dist;
    } else if(dragging){ tx=stx+(e.clientX-sx); ty=sty+(e.clientY-sy); lbApply(); }
  });
  function lbPointerEnd(e){ pts.delete(e.pointerId); if(pts.size<2) lastPinch=0; if(pts.size===0){ dragging=false; lbStage.classList.remove("grabbing"); } }
  lbStage.addEventListener("pointerup", lbPointerEnd);
  lbStage.addEventListener("pointercancel", lbPointerEnd);
  $("lb-zoomin").onclick=()=>lbZoom(1.4); $("lb-zoomout").onclick=()=>lbZoom(0.7); $("lb-reset").onclick=lbReset; $("lb-close").onclick=closeLightbox;

  // —— 语言切换 ——
  // applyLangChrome：更新所有文案/占位/无障碍标签/下拉/时间线条（不渲染视图）
  function applyLangChrome(){
    document.documentElement.lang = (lang==="en") ? "en" : "zh-CN";
    $("lang-toggle").textContent = T("lang_btn");
    $("t-sub").textContent = T("title_sub");
    $("t-subtitle").textContent = T("subtitle");
    $("t-works").textContent = T("works");
    $("t-eras").textContent = T("eras");
    $("t-artists").textContent = T("artists");
    searchInput.placeholder = T("search_ph2");
    rebuildSelects();
    $("timeline-btn").textContent = timelineMode ? T("timeline_off") : T("timeline");
    $("fav-only-btn").innerHTML = "♥ " + T("fav_only");
    $("artist-btn").textContent = T("by_artist");
    $("museum-btn").textContent = T("by_museum");
    $("idx-sort").textContent = T(idxSort === "count" ? "sort_by_count" : "sort_by_name");
    { const fi = $("artist-filter"); if(fi) fi.placeholder = museumIndexOn ? T("filter_museum") : T("filter_artist"); }
    $("daily-btn").textContent = T("daily");
    const so = $("sort-filter").options;
    so[0].textContent = T("sort_default"); so[1].textContent = T("sort_year_asc");
    so[2].textContent = T("sort_year_desc"); so[3].textContent = T("sort_title");
    $("help-title").textContent = T("kbd");
    $("kbd-search").textContent = T("kbd_search"); $("kbd-random").textContent = T("kbd_random");
    $("kbd-artist").textContent = T("kbd_artist"); $("kbd-timeline").textContent = T("kbd_timeline");
    $("kbd-fav").textContent = T("kbd_fav"); $("kbd-nav").textContent = T("kbd_nav");
    $("kbd-close").textContent = T("kbd_close"); $("kbd-help").textContent = T("kbd_help");
    $("about-btn").textContent = T("about");
    $("about-title").textContent = T("about_title");
    $("about-intro").textContent = T("about_intro");
    $("about-sources").textContent = T("about_sources");
    $("about-tech").textContent = T("about_tech");
    $("about-credits").textContent = T("about_credits");
    $("about-github").textContent = T("about_github");
    if($("about-overlay").classList.contains("open")) updateAboutStats();   // 惰性：仅面板打开时才做两趟全量统计
    $("random-btn").textContent = T("random");
    $("l-date").textContent = T("m_date");
    $("l-medium").textContent = T("m_medium");
    $("l-location").textContent = T("m_location");
    $("l-country").textContent = T("m_country");
    $("prev-art").textContent = T("prev");
    $("next-art").textContent = T("next");
    $("modal-share").title = T("share");
    $("t-original").textContent = T("view_original");
    $("lb-hint").textContent = T("zoom_hint");
    $("t-noresults").textContent = T("no_results");
    $("reset-btn").textContent = T("reset");
    $("t-footer").textContent = T("footer");
    // 提示文字 / 无障碍标签随语言更新（此前恒为中文）
    $("clear-search").title = T("clear");
    $("view-toggle").title = T("view_grid");
    $("help-btn").title = T("kbd"); $("help-btn").setAttribute("aria-label", T("kbd"));
    $("zoom-badge").title = T("zoom_in");
    $("lb-zoomout").title = T("zoom_out"); $("lb-zoomin").title = T("zoom_in"); $("lb-reset").title = T("reset_zoom"); $("lb-close").title = T("close");
    $("to-top").title = T("to_top"); $("to-top").setAttribute("aria-label", T("to_top"));
    searchInput.setAttribute("aria-label", T("search_ph2"));
    $("era-filter").setAttribute("aria-label", T("all_eras"));
    $("medium-filter").setAttribute("aria-label", T("all_media"));
    $("country-filter").setAttribute("aria-label", T("all_regions"));
    $("sort-filter").setAttribute("aria-label", T("sort_label"));
    { const fi = $("artist-filter"); if(fi) fi.setAttribute("aria-label", museumIndexOn ? T("filter_museum") : T("filter_artist")); }
    $("modal").setAttribute("aria-label", T("dlg_art"));
    $("modal-close").setAttribute("aria-label", T("close"));
    $("lightbox").setAttribute("aria-label", T("dlg_lightbox"));
    $("help-overlay").setAttribute("aria-label", T("dlg_help"));
    $("about-overlay").setAttribute("aria-label", T("about_title"));
    buildTimelineBar();
  }
  // 依当前视图渲染（buildTabs + 视图分发）；仅纯画廊走 render()，避免隐藏容器空转与重复渲染
  function renderCurrentView(){
    buildTabs();
    if(artistIndexOn) renderArtistIndex();
    else if(museumIndexOn) renderMuseumIndex();
    else if(artistFilter) selectArtist(artistFilter);
    else if(museumFilter) selectMuseum(museumFilter);
    else render();
    if($("modal").classList.contains("open") && modalEntry) fillModal(modalEntry);
  }
  function applyLang(){ applyLangChrome(); renderCurrentView(); }
  $("lang-toggle").onclick = () => {
    lang = (lang==="en") ? "zh" : "en";
    try{ localStorage.setItem("art1001_lang", lang); }catch(e){}   // 写失败也要继续切换（Safari 隐私模式 setItem 抛错）
    applyLang();
  };

  // —— 事件 ——
  let searchTimer;
  searchInput.addEventListener("input", ()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(applyFilters,180); });
  $("clear-search").onclick=()=>{ searchInput.value=""; applyFilters(); searchInput.focus(); };
  $("artist-filter").addEventListener("input", ()=>{ artistIdxFilter = $("artist-filter").value.trim().toLowerCase(); if(museumIndexOn) renderMuseumIndex(); else renderArtistIndex(); });
  $("museum-btn").onclick=()=>{ if(museumIndexOn) exitMuseumIndex(); else showMuseumIndex(); };
  const _sjb = $("subject-btn"); if(_sjb) _sjb.onclick = toggleSubjectPanel;
  $("idx-sort").onclick=()=>{ idxSort = idxSort === "count" ? "name" : "count"; $("idx-sort").textContent = T(idxSort === "count" ? "sort_by_count" : "sort_by_name"); if(museumIndexOn) renderMuseumIndex(); else renderArtistIndex(); };
  eraFilter.onchange=applyFilters; mediumFilter.onchange=applyFilters; countryFilter.onchange=applyFilters;
  $("timeline-btn").onclick=(e)=>{
    timelineMode=!timelineMode;
    e.target.classList.toggle("active", timelineMode);
    e.target.textContent = timelineMode ? T("timeline_off") : T("timeline");
    timelineBar.classList.toggle("show", timelineMode);
    if(!timelineMode){ periodFilter=null; buildTimelineBar(); }
    applyFilters();
  };
  $("fav-only-btn").onclick=(e)=>{
    favOnly=!favOnly;
    e.currentTarget.classList.toggle("active", favOnly);
    applyFilters();
  };
  $("artist-btn").onclick=()=>{ if(artistIndexOn || artistFilter) exitArtist(); else showArtistIndex(); };
  $("modal-fav").onclick=()=>{
    if(!modalEntry) return;
    const on=toggleFav(modalEntry.id);
    const mf=$("modal-fav");
    mf.classList.toggle("on", on); mf.innerHTML=(on?"♥ ":"♡ ")+T(on?"fav_on":"fav");
    if(favOnly) applyFilters();
  };
  $("modal-artist-link").onclick=()=>{
    if(!modalEntry) return;
    const key = modalEntry.artist_en || modalEntry.artist;
    closeModal();
    selectArtist(key);
  };
  $("modal-share").onclick=async()=>{
    const url=location.href;
    try{ await navigator.clipboard.writeText(url); }
    catch(e){ announce(T("share")); try{ window.prompt(T("share"), url); }catch(_){} return; }   // 剪贴板不可用时回退可手动复制
    const b=$("modal-share"); const old=b.innerHTML; b.innerHTML="✓"; b.classList.add("done");
    announce(T("shared"));
    setTimeout(()=>{ b.innerHTML=old; b.classList.remove("done"); }, 1400);
  };
  $("random-btn").onclick=()=>{ if(filtered.length) openModal(filtered[Math.floor(Math.random()*filtered.length)]); else announce(favOnly ? T("fav_empty") : T("no_results")); };
  $("view-toggle").onclick=(e)=>{ listView=!listView; e.target.textContent=listView?"☰":"⊞"; render(); syncURL(); };
  $("sort-filter").onchange=applyFilters;
  // —— 每日一作（按日期确定，每天稳定）——
  function dailyArtwork(){
    const withImg = DATA.filter(d=>d.img);
    if(!withImg.length) return;
    const day = Math.floor(Date.now()/86400000);
    const idx = ((day*2654435761) % withImg.length + withImg.length) % withImg.length;
    openModal(withImg[idx]);
  }
  $("daily-btn").onclick=dailyArtwork;
  // —— 快捷键帮助 ——
  function openHelp(){ helpLastFocus=document.activeElement; $("help-overlay").classList.add("open"); setTimeout(()=>{ try{ $("help-close").focus(); }catch(e){} }, 30); }
  function closeHelp(){ $("help-overlay").classList.remove("open"); try{ helpLastFocus && helpLastFocus.focus(); }catch(e){} }
  $("help-btn").onclick=openHelp;
  $("help-close").onclick=closeHelp;
  $("help-overlay").addEventListener("click", e=>{ if(e.target===$("help-overlay")) closeHelp(); });
  // —— 关于本站 ——
  function updateAboutStats(){
    const nImg = DATA.filter(d=>d.img).length, nArt = uniq("artist").length;
    $("about-stats").innerHTML =
      `<span><strong>${TOTAL}</strong> ${esc(T("about_works"))}</span>`+
      `<span><strong>${nArt}</strong> ${esc(T("about_artists"))}</span>`+
      `<span><strong>${nImg}</strong> ${esc(T("about_images"))}</span>`;
  }
  function openAbout(){ updateAboutStats(); aboutLastFocus=document.activeElement; $("about-overlay").classList.add("open"); setTimeout(()=>{ try{ $("about-close").focus(); }catch(e){} }, 30); }
  function closeAbout(){ $("about-overlay").classList.remove("open"); try{ aboutLastFocus && aboutLastFocus.focus(); }catch(e){} }
  $("about-btn").onclick=openAbout;
  $("about-close").onclick=closeAbout;
  $("about-overlay").addEventListener("click", e=>{ if(e.target===$("about-overlay")) closeAbout(); });
  $("modal-close").onclick=closeModal;
  $("prev-art").onclick=()=>navModal(-1);
  $("next-art").onclick=()=>navModal(1);
  $("modal-img-wrap").onclick=()=>{ if(modalEntry && modalEntry.img) openLightbox(modalEntry); };
  $("modal").addEventListener("click", e=>{ if(e.target===$("modal")) closeModal(); });
  document.addEventListener("keydown", e=>{
    if(lb.classList.contains("open")){
      if(e.key==="Escape") closeLightbox();
      else if(e.key==="+"||e.key==="=") lbZoom(1.4);
      else if(e.key==="-") lbZoom(0.7);
      else if(e.key==="0") lbReset();
      else if(e.key==="Tab") trapTab(e, lb);
      return;
    }
    if(!$("modal").classList.contains("open")) return;
    if(e.key==="Escape") closeModal();
    else if(e.key==="ArrowLeft") navModal(-1);
    else if(e.key==="ArrowRight") navModal(1);
    else if(e.key==="Tab") trapTab(e, $("modal"));
  });
  // —— 全局快捷键 ——
  document.addEventListener("keydown", e=>{
    if($("about-overlay").classList.contains("open")){ if(e.key==="Escape") closeAbout(); else if(e.key==="Tab") trapTab(e, $("about-overlay")); return; }
    if($("help-overlay").classList.contains("open")){ if(e.key==="Escape"||e.key==="?") closeHelp(); else if(e.key==="Tab") trapTab(e, $("help-overlay")); return; }
    if(lb.classList.contains("open") || modalOpen()) return;   // 弹窗/灯箱有各自键盘处理
    if(e.key==="?"){ e.preventDefault(); openHelp(); return; }
    const tag=(e.target.tagName||"").toLowerCase();
    if(tag==="input"||tag==="select"||tag==="textarea"){ if(e.key==="Escape") e.target.blur(); return; }
    if(e.metaKey||e.ctrlKey||e.altKey) return;
    if(e.key==="/"){ e.preventDefault(); searchInput.focus(); }
    else if(e.key==="r"||e.key==="R"){ $("random-btn").click(); }
    else if(e.key==="a"||e.key==="A"){ $("artist-btn").click(); }
    else if(e.key==="t"||e.key==="T"){ $("timeline-btn").click(); }
    else if(e.key==="f"||e.key==="F"){ $("fav-only-btn").click(); }
  });

  $("reset-btn").onclick = () => window.resetFilters();
  window.resetFilters = function(){
    searchInput.value=""; eraFilter.value=""; mediumFilter.value=""; countryFilter.value=""; $("sort-filter").value="default";
    periodFilter=null; favOnly=false; $("fav-only-btn").classList.remove("active");
    if(timelineMode){ timelineMode=false; timelineBar.classList.remove("show"); const tb=$("timeline-btn"); tb.classList.remove("active"); tb.textContent=T("timeline"); }
    artistFilter=null; artistIndexOn=false; museumIndexOn=false; clearMuseum();
    artistIndex.style.display="none"; $("artist-index-bar").style.display="none"; artistBar.style.display="none";
    gallery.style.display=""; eraTabs.style.display=""; $("artist-btn").classList.remove("active"); $("museum-btn").classList.remove("active");
    buildTimelineBar(); applyFilters();
  };

  function esc(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
  // 搜索命中高亮：在原文上定位，再逐段转义（不在转义后的串上做索引，避免实体边界错位）
  function hl(text, q){
    const t = String(text == null ? "" : text);
    if(!q) return esc(t);
    const i = t.toLowerCase().indexOf(q);
    if(i < 0) return esc(t);
    return esc(t.slice(0, i)) + "<mark>" + esc(t.slice(i, i + q.length)) + "</mark>" + esc(t.slice(i + q.length));
  }

  // —— 回到顶部 ——
  const toTop = $("to-top");
  window.addEventListener("scroll", () => { toTop.classList.toggle("show", window.scrollY > 600); }, {passive:true});
  toTop.onclick = () => window.scrollTo({top:0, behavior:"smooth"});

  // —— 深链：按 URL #art-<id> 打开对应作品 ——
  function openFromHash(){
    const m = location.hash.match(/^#art-(\d+)$/);
    if(!m){ if($("modal").classList.contains("open")) closeModal(); return; }
    const id = +m[1];
    if(modalEntry && modalEntry.id === id && $("modal").classList.contains("open")) return;
    const d = DATA.find(x => x.id === id);
    if(d) openModal(d);
    else if(!_restLoaded){ _pendingWantId = id; loadRest(reinitAfterRest); }   // 深链指向尚未合并的其余分片 → 载入后再开
  }
  window.addEventListener("hashchange", openFromHash);

  // —— 按需分片：其余数据流式加载 ——
  let _restLoaded = false, _restLoading = null, _pendingWantId = null;
  function loadRest(cb){
    if(_restLoaded){ cb && cb(); return; }
    if(_restLoading){ if(cb) _restLoading.then(cb); return; }
    _restLoading = new Promise(res => {
      const merge = () => {
        if(window.ART_DATA_REST && window.ART_DATA_REST.length){ for(const d of window.ART_DATA_REST) DATA.push(d); window.ART_DATA_REST = null; }
        _restLoaded = true; res();
      };
      // 用 fetch + JSON.parse 而非 <script>：同一份 9.2MB 数据，JS 字面量要走完整解析器（实测约 365ms），
      // JSON 有 V8 专用快速路径（约 61ms）。传输体积一样（gz 1.25MB），省下的是主线程。
      fetch("data-rest.json")
        .then(r => r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status)))
        .then(arr => { if(Array.isArray(arr)) window.ART_DATA_REST = arr; merge(); })
        .catch(() => { _restLoaded = true; res(); });   // 失败也放行，核心集仍可用
    });
    if(cb) _restLoading.then(cb);
  }
  // 只认一次的启动闸：load 事件与 3s 兜底可能都触发，若不上闩会两次排队 reinitAfterRest（两轮全量重算+重渲染）
  let _restKicked = false;
  function startRest(){ if(_restKicked) return; _restKicked = true; loadRest(reinitAfterRest); }
  function reinitAfterRest(){
    computeDerived();      // 重算派生结构 + 头部统计
    applyLangChrome();     // 重建下拉/标签/时间线（不渲染视图，避免二次渲染）
    // 合并其余分片时用户可能已经在浏览：保住滚动位置与当前页码，别把人拽回页首第 1 页。
    const _y = window.scrollY, _page = page;
    if(artistIndexOn) renderArtistIndex();       // 索引视图各自以全量数据重渲染
    else if(museumIndexOn) renderMuseumIndex();
    else {
      applyFilters();   // 以全量数据重建 filtered 并渲染一次（分页/计数更新）
      if(_page > 0 && _page < Math.ceil(filtered.length / PER_PAGE)){ page = _page; render(); }   // page 为 0 基
      if(_y > 0) window.scrollTo({ top: _y });
    }
    if(modalEntry) modalIndex = filtered.indexOf(modalEntry);   // 合并后 filtered 重排，须重新定位当前项，否则上/下一件会乱跳
    if(_pendingWantId != null){ const d = DATA.find(x => x.id === _pendingWantId); _pendingWantId = null; if(d) openModal(d); }
  }

  // —— 启动 ——
  function initApp(){
    computeDerived();     // 构建全部 DATA 派生结构（TRMAP/下拉值/计数/artistAgg/TOTAL/统计）
    applyLang();          // 构建下拉/标签/时间线，首次渲染
    restoreFromURL();     // 从 URL 恢复筛选状态
    buildTimelineBar();   // 反映恢复后的 period 高亮
    const wantId = (location.hash.match(/^#art-(\d+)$/) || [])[1];  // 先抓取深链 id（applyFilters 的 syncURL 会清掉 hash）
    const _ap = new URLSearchParams(location.search);              // 必须在 applyFilters(→syncURL) 清掉查询串之前抓取
    applyFilters();       // 应用已恢复的筛选
    if(_ap.get("artist")) selectArtist(_ap.get("artist"));      // 恢复艺术家作品页
    else if(_ap.get("view") === "artists") showArtistIndex();   // 恢复艺术家索引
    else if(_ap.get("view") === "museums") showMuseumIndex();   // 恢复馆藏索引
    else if(_ap.get("museum")) selectMuseum(_ap.get("museum")); // 恢复馆藏展
    const _pg = parseInt(_ap.get("p"), 10);                     // 恢复分页（须在 applyFilters/选视图把 page 归零之后）
    if(_pg > 1 && !artistIndexOn && !museumIndexOn){ page = _pg - 1; render(); }
    if(wantId){ const d = DATA.find(x => x.id === +wantId); if(d) openModal(d); else { _pendingWantId = +wantId; startRest(); } }  // 深链作品不在核心集 → 立刻拉其余，不等空闲
  }
  // 带参 URL 需全量数据才正确（筛选值可能来自其余分片）→ 先加载再初始化。
  // 裸 #art-<id> 不再走这条：否则 5529 个预渲染页的「在画廊中查看」全都要先阻塞下载 3.1MB 才有画面；
  // 核心集里的作品即刻打开，其余分片的作品由 _pendingWantId 在合并后补开。
  const _needFull = location.search.length > 1;
  if(_needFull){ _restKicked = true; loadRest(initApp); }
  else {
    initApp();
    // 其余分片（~3MB）等首屏图片加载完（load）再于空闲时拉取，把带宽让给首屏。
    // 注意一：不能只用 requestIdleCallback——首屏图片由 JS 注入，浏览器在图片开始下载前就已「空闲」。
    // 注意二：load 会等 jsDelivr 上的首屏图；该 CDN 在部分地区常被阻断，届时 load 可能几十秒不触发，
    //        整站会「安静地」只剩 600 件（计数、搜索、分页全错却无任何提示）。故必须有独立于 load 的硬兜底。
    const _sched = () => { if(window.requestIdleCallback) requestIdleCallback(startRest, { timeout: 2000 }); else setTimeout(startRest, 300); };
    if(document.readyState === "complete") _sched();
    else { window.addEventListener("load", _sched, { once: true }); setTimeout(_sched, 3000); }
  }
})();
