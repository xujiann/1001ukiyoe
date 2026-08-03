/* 1001件人类艺术瑰宝 — Service Worker
   - 外壳（HTML/CSS/JS）：stale-while-revalidate
   - 本地图片（images/）：cache-first，按需缓存，离线可回看已浏览作品
*/
const SHELL = "uki1001-shell-8791af6490";
const IMGS  = "uki1001-img-v12";
const IMG_CDN = "pic-1302017848.cos.ap-nanjing.myqcloud.com";   // 图片走腾讯云 COS（art/ 前缀）
const IMG_CAP = 1200;                 // 图片缓存上限，FIFO 淘汰，防 Cache Storage 无限增长触发整源清退
// 核心壳：小、离线首屏必需 → 原子缓存
const CORE_ASSETS = ["./", "./index.html", "./style.css", "./lang.js", "./data.js", "./app.js", "./manifest.webmanifest"];
// 大/可选资源（数据其余分片 + 懒加载元数据）：尽力缓存，单个失败不阻断安装
const EXTRA_ASSETS = ["./data-rest.json", "./desc.js", "./credits.js", "./artists.js"];

// 装机时必须绕开 HTTP 缓存取新文件。
// cache.addAll() 默认走浏览器 HTTP 缓存：换了新缓存名、却把浏览器手里的旧副本装了进去，
// 于是「版本号变了、内容没变」，看起来像发布成功、读者拿到的还是旧壳。
// 本轮 page.css 的 .ot-tag 就是这样：磁盘新、SW 缓存名新、缓存内容旧。
// 加 {cache:"reload"} 强制回源。
const fresh = u => new Request(u, { cache: "reload" });

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(SHELL).then(c =>
      c.addAll(CORE_ASSETS.map(fresh)).then(() => Promise.all(EXTRA_ASSETS.map(u => c.add(fresh(u)).catch(() => {}))))
    ).then(() => self.skipWaiting())
  );
});

// 图片缓存 FIFO 淘汰：超上限则删最早写入的若干条
async function trimCache(cacheName, max){
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if(keys.length <= max) return;
  for(let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL && k !== IMGS).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // 图片：本地 images/ 或 jsDelivr CDN → cache-first（离线可回看已浏览作品）。
  // 跨域图先于同源判断处理。jsDelivr 带 CORS 头，用 cors 请求取回“真实”响应缓存
  // （避免 opaque 响应在 Cache Storage 的 padding 配额膨胀）；失败再回退原始请求。
  const isImg = url.hostname === IMG_CDN ||
    (url.origin === location.origin && url.pathname.includes("/images/"));
  if (isImg) {
    e.respondWith(
      caches.open(IMGS).then(cache =>
        cache.match(req).then(hit => hit || fetch(url.href, { mode: "cors" }).then(res => {
          if (res && res.ok) cache.put(req, res.clone()).then(() => trimCache(IMGS, IMG_CAP));
          return res;
        }).catch(() => fetch(req)))
      )
    );
    return;
  }

  if (url.origin !== location.origin) return; // 其余仅处理同源

  // 页面与数据：network-first（在线总是最新，离线回退缓存）
  const p = url.pathname;
  // 预渲染详情页（art/artist/museum，共 6000+ 页）：直连网络，不进壳缓存也不回退首页
  if (/\/(art|artist|museum)\/[^/]+\.html$/.test(p)) return;
  const isDoc = req.mode === "navigate" || p.endsWith("/") || p.endsWith("/index.html") || p.endsWith("/data.js") || p.endsWith("/data-rest.json");
  if (isDoc) {
    e.respondWith(
      fetch(req).then(res => {
        if (res.ok) { const cl = res.clone(); caches.open(SHELL).then(c => c.put(req, cl)); }
        return res;
      }).catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // 外壳：stale-while-revalidate
  e.respondWith(
    caches.open(SHELL).then(cache =>
      cache.match(req).then(hit => {
        // 后台复验同样要绕开 HTTP 缓存，否则 max-age 没过期时这一步只是从浏览器缓存里
        // 把旧文件再抄一遍，SWR 的「revalidate」永远不会真的发生。
        // 用 no-cache（带条件请求，服务器没变就回 304）而非 reload，省流量。
        const rq = req.mode === "navigate" ? req : new Request(req, { cache: "no-cache" });
        const net = fetch(rq).then(res => { if (res.ok) cache.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      })
    )
  );
});
