// 其余分片自 2026-07-28 起以 JSON 交付（data-rest.json）而非 JS 字面量。
// 原因：实测同一份数据，浏览器执行 9.2MB 的 JS 字面量约 365ms，而 fetch + JSON.parse 仅约 61ms
// （快 6 倍，移动端差距更大）——V8 对 JSON 有专用快速路径，而 JS 字面量要走完整解析器。
// 传输体积不变（gz 后 1.25MB，网络本来就不是瓶颈），省下的是主线程。
// 本模块供 Node 侧构建脚本共用，避免各处重复拼路径。
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export function loadRest(root = ".") {
  const j = join(root, "data-rest.json");
  if (existsSync(j)) return JSON.parse(readFileSync(j, "utf8"));
  // 兼容尚未重建的旧产物
  const legacy = join(root, "data-rest.js");
  if (existsSync(legacy)) {
    const g = {}; new Function("window", readFileSync(legacy, "utf8"))(g);
    return g.ART_DATA_REST || [];
  }
  return [];
}
