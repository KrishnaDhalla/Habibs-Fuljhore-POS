// Money and date helpers. The salon runs on Indian time (IST, UTC+05:30, no daylight saving).
const TZ = 'Asia/Kolkata';

// Round to paise, half away from zero, on the decimal value (81.335 → 81.34, −99.825 → −99.83).
// toPrecision(15) removes binary noise such as 81.335 × 100 = 8133.499999999999.
export const round2 = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return v;
  const r = Math.round(Number((Math.abs(v) * 100).toPrecision(15))) / 100;
  return v < 0 && r ? -r : r;
};
// Rupees → whole paise (integer), and back
export const toPaise = (n) => {
  const v = Number(n) || 0;
  const r = Math.round(Number((Math.abs(v) * 100).toPrecision(15)));
  return v < 0 ? -r : r;
};
export const fromPaise = (p) => p / 100;

export function rupee(n, opts = {}) {
  const v = Number(n) || 0;
  const hasPaise = opts.paise ?? Math.abs(v % 1) > 0.001;
  return (v < 0 ? '−₹' : '₹') + Math.abs(v).toLocaleString('en-IN', {
    minimumFractionDigits: hasPaise ? 2 : 0,
    maximumFractionDigits: hasPaise ? 2 : 0,
  });
}

// "2026-10-01" for the IST calendar day of a Date
export function istDay(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
}

export function istMonth(d = new Date()) {
  return istDay(d).slice(0, 7);
}

// [startISO, endISO) for an IST day or day range, ready for created_at filters
export function dayRangeISO(fromDay, toDay = fromDay) {
  const start = new Date(fromDay + 'T00:00:00+05:30');
  const end = new Date(toDay + 'T00:00:00+05:30');
  end.setUTCDate(end.getUTCDate() + 1);
  return [start.toISOString(), end.toISOString()];
}

export function addDays(day, n) {
  const d = new Date(day + 'T12:00:00+05:30');
  d.setUTCDate(d.getUTCDate() + n);
  return istDay(d);
}

export function monthDays(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function monthRange(month) {
  return [month + '-01', month + '-' + String(monthDays(month)).padStart(2, '0')];
}

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

export function fmtDate(d, withYear = true) {
  if (!d) return '';
  const date = typeof d === 'string' && d.length === 10 ? new Date(d + 'T12:00:00+05:30') : new Date(d);
  return date.toLocaleDateString('en-IN', { timeZone: TZ, day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) });
}

export function fmtTime(d) {
  return new Date(d).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
}

export function fmtDateTime(d) {
  return fmtDate(d) + ', ' + fmtTime(d);
}

export function fmtMonth(month) {
  return new Date(month + '-15T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: TZ, month: 'long', year: 'numeric' });
}

export function weekdayShort(day) {
  return new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short' });
}

export function daysSince(d) {
  if (!d) return null;
  return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
}

export const cleanPhone = (s) => String(s || '').replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '').slice(0, 10);
export const validPhone = (s) => /^[6-9]\d{9}$/.test(s);
export const fmtPhone = (s) => (s && s.length === 10 ? s.slice(0, 5) + ' ' + s.slice(5) : s || '');

export function initials(name) {
  return String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
}

export function toCSV(rows, columns) {
  const esc = (v) => {
    let s = v == null ? '' : String(v);
    // Text starting with = + - @ would run as a formula in Excel / Sheets (e.g. a customer "name" =HYPERLINK(…)).
    // Numbers stay numbers; text gets a leading ' so it shows as typed.
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = "'" + s;
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const head = columns.map((c) => esc(c[1])).join(',');
  const body = rows.map((r) => columns.map((c) => esc(typeof c[0] === 'function' ? c[0](r) : r[c[0]])).join(',')).join('\n');
  return head + '\n' + body;
}

// Inside a preview frame (the online demo) the browser blocks downloads
export const canDownload = () => window.self === window.top;
export const NO_DOWNLOAD = 'Downloads work in the installed app. This preview blocks them.';

export function downloadFile(name, text, type = 'text/csv') {
  const blob = new Blob([text], { type: type + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const uid = () =>
  (globalThis.crypto && crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  }));
