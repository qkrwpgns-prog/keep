// 이전 버전(legacy/)을 배포 결과의 /keep/legacy/ 로 복사 → 예전 사용자가 '백업 저장'을 할 수 있게 유지
import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/legacy', { recursive: true });
for (const f of ['index.html', 'qrcode.js']) cpSync(`legacy/${f}`, `dist/legacy/${f}`);
console.log('legacy → dist/legacy');
