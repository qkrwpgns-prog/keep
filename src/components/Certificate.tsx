import { useEffect, useState } from 'react';
import { certHTML, type CertDoc } from '@domain/certificate.ts';
import { loadSignatures } from '../lib/api';
import { sigImg } from '../lib/sigimg';
import { qrSVG } from '../lib/qr';
import { shareUrl } from '../lib/supabase';

/** 증서 화면. id가 있고 서명이 있으면 서명 이미지를 서버에서 받아 그린다. */
export function Certificate({ doc, id, revealAccount }: { doc: CertDoc; id?: string; revealAccount?: boolean }) {
  const [imgs, setImgs] = useState<{ A?: string; B?: string }>({});
  const sigKey = (doc.sigA?.sha || '') + (doc.sigB?.sha || '');
  useEffect(() => {
    if (!id || !sigKey) return;
    let alive = true;
    loadSignatures(id, sigKey).then((s) => alive && setImgs({ A: sigImg(s.A), B: sigImg(s.B) })).catch(() => {});
    return () => { alive = false; };
  }, [id, sigKey]);
  const qr = doc.sigA && doc.sigB && doc.currentHash ? qrSVG(shareUrl(doc.code), 'M') : '';
  return <div dangerouslySetInnerHTML={{ __html: certHTML(doc, { sigImgA: imgs.A, sigImgB: imgs.B, qrSvg: qr, revealAccount }) }} />;
}
