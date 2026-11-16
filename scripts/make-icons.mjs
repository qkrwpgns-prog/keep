// 앱 아이콘·OG 이미지 생성 (한 번만 실행해 public/icons에 커밋)
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const FONTS = `<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@500;700&family=Nanum+Myeongjo:wght@700;800&display=block" rel="stylesheet">`;
const seal = (size, pad) => `<html><head>${FONTS}</head><body style="margin:0;background:${pad ? '#f5f1ea' : 'transparent'}"><div style="width:${size}px;height:${size}px;display:grid;place-items:center">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${pad ? size * 0.62 : size}" height="${pad ? size * 0.62 : size}"><rect x="6" y="6" width="52" height="52" rx="14" fill="#cf3d28" transform="rotate(-6 32 32)"/><text x="32" y="44" font-size="32" text-anchor="middle" fill="white" font-family="Nanum Myeongjo, serif" font-weight="800">約</text></svg></div></body></html>`;
const b = await chromium.launch();
const p = await b.newPage();
for (const [name, size, pad] of [['icon-192', 192, true], ['icon-512', 512, true], ['icon-maskable-512', 512, true]]) {
  await p.setViewportSize({ width: size, height: size });
  await p.setContent(seal(size, pad), { waitUntil: 'networkidle' }); await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `public/icons/${name}.png`, omitBackground: !pad });
}
await p.setViewportSize({ width: 1200, height: 630 });
await p.setContent(`<html><head>${FONTS}</head><body style="margin:0;width:1200px;height:630px;background:#f5f1ea;display:flex;align-items:center;gap:56px;padding:0 90px;box-sizing:border-box;font-family:'IBM Plex Sans KR',sans-serif;color:#1f1b2d">
${seal(220, false).replace(/<\/?html>|<head>.*<\/head>|<\/?body[^>]*>/gs, '')}<div><div style="font-size:72px;font-weight:800;letter-spacing:-2px">키프 Keep</div><div style="font-size:38px;margin-top:14px;font-family:'Nanum Myeongjo',serif;font-weight:700">친한 사이일수록, <span style="color:#cf3d28">약속은 기록</span>으로.</div><div style="font-size:26px;color:#575265;margin-top:18px">링크를 열어 약속증서를 확인하고 서명해 주세요</div></div></body></html>`, { waitUntil: 'networkidle' });
await p.evaluate(() => document.fonts.ready);
await p.screenshot({ path: 'public/icons/og.png' });
await b.close();
console.log('icons ok');
