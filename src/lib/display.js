// Display on this device: light or dark colours and the text size. Saved in this browser only, so the counter
// tablet can be dark with big text while the owner's phone stays as it is.
const KEY = 'pos-display';
export const THEMES = [['light', 'Light'], ['dark', 'Dark'], ['auto', 'Same as the tablet']];
export const SIZES = [[1, 'Normal'], [1.15, 'Large'], [1.3, 'Larger']];
const DEFAULT = { theme: 'light', size: 1 };

export function readDisplay() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      theme: THEMES.some(([k]) => k === v.theme) ? v.theme : DEFAULT.theme,
      size: SIZES.some(([k]) => k === v.size) ? v.size : DEFAULT.size,
    };
  } catch {
    return { ...DEFAULT };
  }
}

const darkQuery = () => (typeof window !== 'undefined' && window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null);
export const isDark = (d) => d.theme === 'dark' || (d.theme === 'auto' && !!(darkQuery() && darkQuery().matches));

const VIEWPORT = 'width=device-width, initial-scale=1, viewport-fit=cover';
const touch = () => typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
// The screen's width now (turned sideways or upright), before any zoom
function screenWidth() {
  const s = window.screen || {};
  const upright = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
  const a = Number(s.width) || window.innerWidth;
  const b = Number(s.height) || window.innerHeight;
  return upright ? Math.min(a, b) : Math.max(a, b);
}

export function applyDisplay(d = readDisplay()) {
  const root = document.documentElement;
  const dark = isDark(d);
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.size = String(d.size);
  // Bigger text: the whole app is drawn larger (buttons too), so everything stays in proportion.
  // Tablet and phone: the page is laid out narrower and the browser scales it up, like zooming in, so the layout
  // rearranges itself to fit. A computer ignores that, so it is zoomed with CSS (Ctrl and + works there too).
  const meta = document.querySelector('meta[name="viewport"]');
  if (touch() && meta) {
    root.style.zoom = '';
    meta.setAttribute('content', d.size === 1 ? VIEWPORT : `width=${Math.round(screenWidth() / d.size)}, viewport-fit=cover`);
  } else {
    if (meta) meta.setAttribute('content', VIEWPORT);
    root.style.zoom = d.size === 1 ? '' : String(d.size);
  }
  const bar = document.querySelector('meta[name="theme-color"]');
  if (bar) bar.setAttribute('content', dark ? '#1B1918' : '#8B1E25');
}

export function saveDisplay(d) {
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* still applied for now */ }
  applyDisplay(d);
}

// "Same as the tablet": follow the tablet's own dark mode when it changes
// and the bigger text when the tablet is turned
export function watchDisplay() {
  const q = darkQuery();
  const on = () => { if (readDisplay().theme === 'auto') applyDisplay(); };
  if (q && q.addEventListener) q.addEventListener('change', on);
  const turn = () => { if (readDisplay().size !== 1) setTimeout(() => applyDisplay(), 150); };
  window.addEventListener('orientationchange', turn);
  const o = window.matchMedia && window.matchMedia('(orientation: portrait)');
  if (o && o.addEventListener) o.addEventListener('change', turn);
  return () => {
    if (q && q.removeEventListener) q.removeEventListener('change', on);
    window.removeEventListener('orientationchange', turn);
    if (o && o.removeEventListener) o.removeEventListener('change', turn);
  };
}
