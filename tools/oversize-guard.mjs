// 守卫：找出超过腾讯云数据万象 32MB 处理上限的源图。
//
// 为何需要：三站所有图都靠 `?imageMogr2/thumbnail/` 由数据万象按需缩放。
// 源图一旦超过 32MB，缩略图请求返回 `400 ImageTooLarge`，
// **读者看到的是坏图**——卡片和详情图都出不来，而不是「加载慢」。
// 2026-07-31 因此有 15 件作品在三站上长期显示为坏图，直到主动扫描才发现。
// 阈值实测精确：最小失败 32.1MB、最大成功 31.6MB。
//
// 每轮采进新图后跑一次：node tools/oversize-guard.mjs [images目录]
// 有超限的就用 _shrink_oversize.mjs 压到 30MB 以下（保 id 与 URL 不变）。
import { readdirSync, statSync } from 'fs';

const DIR = process.argv[2] || 'images';
const LIMIT = 32 * 1024 * 1024;
const WARN = 24 * 1024 * 1024;          // 接近上限的提前提醒

const files = readdirSync(DIR).filter(f => /\.(jpe?g|png|gif|webp)$/i.test(f));
const over = [], near = [];
for (const f of files) {
  const s = statSync(`${DIR}/${f}`).size;
  if (s >= LIMIT) over.push({ f, s });
  else if (s >= WARN) near.push({ f, s });
}
over.sort((a, b) => b.s - a.s);
const mb = n => (n / 1048576).toFixed(1);
console.log(`扫描 ${files.length} 张`);
if (over.length) {
  console.log(`\n✗ 超过 32MB（缩略图必失败，读者看到坏图）：${over.length} 张`);
  over.slice(0, 20).forEach(x => console.log(`   ${mb(x.s).padStart(6)}MB  ${x.f}`));
  if (over.length > 20) console.log(`   …另有 ${over.length - 20} 张`);
  console.log('\n  修法：node _shrink_oversize.mjs（先降质量保像素，不够再缩尺寸；原图备份到 _oversize_bak/）');
} else console.log('✓ 无超过 32MB 的源图');
if (near.length) console.log(`\n⚠ 24–32MB（逼近上限，再采同类图需留意）：${near.length} 张`);
process.exit(over.length ? 1 : 0);
