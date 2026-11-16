// 캡처 이미지를 줄여 base64로 (긴 변 1600px, JPEG 0.85) → 업로드·AI 판독 비용을 줄인다
export interface ImageData64 { mediaType: 'image/jpeg'; data: string; preview: string }

export async function shrinkImage(file: File, maxSide = 1600): Promise<ImageData64> {
  if (!/^image\//.test(file.type)) throw new Error('이미지 파일만 올릴 수 있어요.');
  const bmp = await createImageBitmap(file).catch(() => { throw new Error('이미지를 열 수 없어요.'); });
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.85);
  return { mediaType: 'image/jpeg', data: url.split(',')[1], preview: url };
}
