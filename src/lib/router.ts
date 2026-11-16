import { useEffect, useState } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'edit'; id: string }
  | { name: 'promise'; code: string }
  | { name: 'verify' }
  | { name: 'settings' }
  | { name: 'group'; id: string };

export function parseHash(h: string): Route {
  const path = decodeURIComponent(h.replace(/^#/, '')).replace(/^\/?/, '/');
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'new') return { name: 'new' };
  if (seg[0] === 'edit' && seg[1]) return { name: 'edit', id: seg[1] };
  if (seg[0] === 'p' && seg[1]) return { name: 'promise', code: seg[1].toUpperCase() };
  if (seg[0] === 'verify') return { name: 'verify' };
  if (seg[0] === 'settings') return { name: 'settings' };
  if (seg[0] === 'group' && seg[1]) return { name: 'group', id: seg[1] };
  return { name: 'home' };
}

export function go(path: string) {
  const h = '#' + (path.startsWith('/') ? path : '/' + path);
  if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = h;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => { setRoute(parseHash(location.hash)); window.scrollTo(0, 0); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
