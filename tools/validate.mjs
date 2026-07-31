/* 数据校验：确保 data.js 与 images/ 一致、字段齐全。
   用法：node tools/validate.mjs    （在项目根目录运行）
   退出码非 0 表示发现问题，可接入 CI。
*/
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { dirtyFields } from "./sanitize.mjs";   // 与构建期清洗共用同一套规则，杜绝两份漂移

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
globalThis.window = {};
await import("file://" + join(ROOT, "data.js").replace(/\\/g, "/"));
globalThis.window.ART_DATA_REST = (await import("./loadrest.mjs")).loadRest(ROOT);   // 其余分片已改 JSON 交付
const DATA = (globalThis.window.ART_DATA || []).concat(globalThis.window.ART_DATA_REST || []);

const REQ = ["id","sy","th","title","title_en","artist","artist_en","year","era","era_en","medium","country","location"];
const THEMES = new Set(["prehistoric","ancient","egypt","greece","rome","byzantine","medieval","gothic","renaissance","baroque","rococo","neoclassic","romantic","realism","impressionism","modern","contemporary","eastasia","default"]);

const errs = [];
const warns = [];

if (DATA.length < 1000) errs.push(`作品总数异常偏少：${DATA.length}`);

const ids = new Set();
let withImg = 0, placeholders = 0;
for (const d of DATA) {
  if (ids.has(d.id)) errs.push(`重复 id: ${d.id}`);
  ids.add(d.id);
  for (const k of REQ) if (d[k] === undefined || d[k] === null || d[k] === "") errs.push(`#${d.id} 缺字段 ${k}`);
  if (!THEMES.has(d.th)) warns.push(`#${d.id} 未知主题 th=${d.th}`);
  if (d.img) {
    withImg++;
    if (!existsSync(join(ROOT, d.img))) errs.push(`#${d.id} 大图缺失: ${d.img}`);
  } else {
    placeholders++;
  }
}

// 繁体检测：去掉「繁/畫/單/國/學/廣」等同时也是日文汉字或简体常用字的字，只留强信号，
// 免得「南都繁会图」「浮世繪」类正当标题被反复误报（历史上每轮都在报假阳性）。
// d.ot 的标题本来就是日文原题（《大日本名将鑑》《古今書画鑑》），那些字是原文，不是没转换干净——豁免。
const trad = DATA.filter(d => !d.ot && /[藝術館瑩寶劍鑑]/.test(`${d.title}${d.location}${d.artist}${d.era}`));
if (trad.length) warns.push(`疑似繁体残留 ${trad.length} 条：${trad.slice(0,5).map(d=>d.id).join(",")}…`);

// —— 脏值断言（error，非 warn）——
// 历史教训：这些规则原先只存在于 app.js 的运行时清洗里，校验器完全不看，
// 于是 568 个 QID 标题 / 1059 个 genid 馆名 / 928 条脏描述一路绿灯上线。
// 现在与构建期清洗共用 tools/sanitize.mjs，校验器是最后一道闸。
{
  const dirty = [];
  for (const d of DATA) { const f = dirtyFields(d); if (f.length) dirty.push(`#${d.id} ${f.join(",")}`); }
  if (dirty.length) errs.push(`${dirty.length} 条记录带脏值（裸QID/genid/URL/空标题）：${dirty.slice(0,6).join(" | ")}`);
}
// 同一 Commons 文件被多条「有图」记录引用 → 其中至少一条挂着别人的画（错图），按 error 处理。
// 仅占位卡共用 file 引用（如同一位受版权画家的多件作品）不算错，降为提示。
{
  const byFile = new Map();
  for (const d of DATA) {
    if (!d.file) continue;
    const k = decodeURIComponent(String(d.file)).replace(/_/g, " ").toLowerCase();
    let a = byFile.get(k); if (!a) { a = []; byFile.set(k, a); }
    a.push(d);
  }
  const misImg = [...byFile.values()].filter(v => v.filter(d => d.img).length > 1);
  const dupRef = [...byFile.values()].filter(v => v.length > 1 && v.filter(d => d.img).length <= 1);
  if (misImg.length) errs.push(`${misImg.length} 组作品共用同一张图（必有错图）：${misImg.slice(0,5).map(v=>v.map(d=>d.id).join("=")).join(" | ")}`);
  if (dupRef.length) warns.push(`${dupRef.length} 组占位卡共用同一 file 引用：${dupRef.slice(0,3).map(v=>v.map(d=>d.id).join("=")).join(" | ")}`);
}
// 排序年份 sy 必须落在作者生卒内（历史上出过把 1600 年的卡拉奇标成 2000 年，
// 错误年份还会被描述模板复制到 meta description，一错三处）
if (existsSync(join(ROOT, "artists.js"))) {
  await import("file://" + join(ROOT, "artists.js").replace(/\\/g, "/"));
  const A = globalThis.window.ART_ARTISTS || {};
  const out = [];
  for (const d of DATA) {
    const a = A[d.artist_en]; if (!a || d.sy == null) continue;
    const b = /^\d{3,4}$/.test(String(a.born)) ? +a.born : null;
    const x = /^\d{3,4}$/.test(String(a.died)) ? +a.died : null;
    if (b && x && (d.sy < b + 5 || d.sy > x + 5)) out.push(`#${d.id}(${d.artist_en} sy=${d.sy}/生${b}卒${x})`);
  }
  if (out.length) errs.push(`${out.length} 件作品年份落在作者生卒之外：${out.slice(0,6).join(" ")}`);
}

console.log(`作品 ${DATA.length} | 有本地图 ${withImg} | 占位 ${placeholders}`);
if (warns.length) { console.log("\n⚠ 警告:"); warns.slice(0,20).forEach(w => console.log("  " + w)); }
if (errs.length) { console.log("\n✗ 错误:"); errs.slice(0,40).forEach(e => console.log("  " + e)); console.log(`\n共 ${errs.length} 个错误`); process.exit(1); }
console.log("\n✓ 校验通过");
