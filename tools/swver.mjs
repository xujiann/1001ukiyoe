// Service Worker 缓存版本自动化。
//
// 病灶：sw.js 里 SHELL = "uki1001-shell-v68" 一直靠人手改。改完 CSS/JS 忘了 bump，
// 回访读者就一直吃 SW 里的旧壳——本轮 page.css 加的 .ot-tag 在本地就这么被吃掉了，
// 磁盘上是新的、页面上是旧的，排查了半天。版本号跟内容走，才不会有这种事。
//
// 做法：对 SW 真正预缓存的那几个外壳文件取内容哈希，写回 sw.js 的 SHELL 常量。
// 内容没变→哈希不变→不写文件（避免每次构建都产生无谓 diff）。
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createHash } from 'crypto';

const ROOT = new URL('../', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const p = f => ROOT + f;

let sw = readFileSync(p('sw.js'), 'utf8');

// 直接从 sw.js 里读预缓存清单，免得两处清单各改各的又对不上
const listOf = name => {
  const m = new RegExp(`const ${name}\\s*=\\s*\\[([^\\]]*)\\]`).exec(sw);
  return m ? [...m[1].matchAll(/"\.\/([^"]*)"/g)].map(x => x[1]).filter(Boolean) : [];
};
const files = [...new Set([...listOf('CORE_ASSETS'), ...listOf('EXTRA_ASSETS'), 'page.css', 'sw.js'])];

const h = createHash('sha256');
let n = 0;
for (const f of files.sort()) {
  if (!existsSync(p(f))) continue;
  // sw.js 自身要先把旧版本号抹掉再入哈希，否则「改版本→哈希变→again」自激振荡
  const body = f === 'sw.js' ? readFileSync(p(f), 'utf8').replace(/uki1001-shell-[a-z0-9]+/g, '') : readFileSync(p(f));
  h.update(f).update(body); n++;
}
const ver = h.digest('hex').slice(0, 10);
const want = `uki1001-shell-${ver}`;
const cur = (/const SHELL = "([^"]+)"/.exec(sw) || [])[1];

if (cur === want) { console.log(`SW 版本未变（${cur}，参与哈希 ${n} 个文件）`); }
else {
  sw = sw.replace(/const SHELL = "[^"]+"/, `const SHELL = "${want}"`);
  writeFileSync(p('sw.js'), sw);
  console.log(`SW 版本 ${cur} → ${want}（参与哈希 ${n} 个文件）`);
}
