export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { /* 복사 불가 */ }
    ta.remove();
    return ok;
  }
}

/** 카톡 등 공유 시트. 없으면 복사로 대체. 결과: 'shared' | 'copied' | 'failed' | 'cancelled' */
export async function shareText(text: string, url?: string): Promise<'shared' | 'copied' | 'failed' | 'cancelled'> {
  if (navigator.share) {
    try { await navigator.share(url ? { text, url } : { text }); return 'shared'; }
    catch (e) { if ((e as Error)?.name === 'AbortError') return 'cancelled'; }
  }
  return (await copyText(url && !text.includes(url) ? `${text} ${url}` : text)) ? 'copied' : 'failed';
}

export function saveFile(name: string, data: Blob | string, type = 'text/plain') {
  const blob = data instanceof Blob ? data : new Blob([data], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const safeName = (s: string) => String(s || '약속').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
export const isKakaoInApp = () => /KAKAOTALK/i.test(navigator.userAgent);
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent);
