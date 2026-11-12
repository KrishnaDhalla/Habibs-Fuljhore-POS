// Bookings and enquiries: the same rules as save_booking() and link_visit() in supabase/01_schema.sql.
// Used by the demo database; the screens use the helpers at the bottom.
import { istDay, round2 } from './format';

export const SOURCES = [['whatsapp', 'WhatsApp'], ['phone', 'Phone call'], ['walk_in', 'Walk-in'], ['instagram', 'Instagram'], ['website', 'Website'], ['other', 'Other']];
export const SOURCE_LABEL = Object.fromEntries(SOURCES);
export const STATUS_LABEL = { requested: 'Request', confirmed: 'Confirmed', came: 'Came', no_show: 'No-show', cancelled: 'Cancelled' };
export const ENQ_STATUS = { new: 'New', replied: 'Replied', follow_up: 'Follow up', booked: 'Booked', came: 'Came', closed: 'Closed' };
export const CLOSE_REASONS = ['Price', 'Too far', 'Just asking', 'Went elsewhere', 'No reply', 'Other'];

// ---- Call back: enquiries to phone (someone called and asked; call them later) ----
export const CALL_TIMES = ['Morning', 'Afternoon', 'Evening', 'Any time'];
const OPEN = ['new', 'replied', 'follow_up'];
// On the list: open enquiries with a day to call (follow_up_on), or a phone enquiry not answered yet.
//   due: to call today (or overdue), oldest day first; later: the days after.
export function callList(enqs, today = istDay()) {
  const on = (enqs || []).filter((e) => OPEN.includes(e.status) && (e.follow_up_on || (e.source === 'phone' && e.status === 'new')));
  const dayOf = (e) => e.follow_up_on || today;
  const by = (a, b) => (dayOf(a) < dayOf(b) ? -1 : dayOf(a) > dayOf(b) ? 1 : String(a.created_at) < String(b.created_at) ? -1 : 1);
  return { due: on.filter((e) => dayOf(e) <= today).sort(by), later: on.filter((e) => dayOf(e) > today).sort(by) };
}
// What a call changes on the enquiry. kind: 'no_answer' | 'again' (days: 1, 3, 7 …) | 'closed' (reason) | 'booked'
export function callOutcome(e, kind, { today = istDay(), days = 1, reason = 'Other', note = '', now = new Date() } = {}) {
  const base = { calls: (Number(e.calls) || 0) + 1, last_call_at: now.toISOString() };
  const day = (n) => { const d = new Date(today + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const said = String(note || '').trim().slice(0, 300);
  if (kind === 'no_answer') return { ...base, status: 'follow_up', follow_up_on: day(1), last_call_note: said || 'No answer' };
  if (kind === 'again') return { ...base, status: 'follow_up', follow_up_on: day(Math.max(0, Number(days) || 1)), last_call_note: said || 'Call again' };
  if (kind === 'closed') return { ...base, status: 'closed', close_reason: reason, last_call_note: said || reason };
  if (kind === 'booked') return { ...base, last_call_note: said || 'Booked' };
  throw new Error('Unknown call outcome');
}

export const cleanPhone = (v) => {
  const d = String(v || '').replace(/\D/g, '');
  return /^(91|0)?[6-9]\d{9}$/.test(d) ? d.slice(-10) : null;
};

// One booked service, priced from the menu: { service_id, name, option_label, price, price_from }
export function bookingItem(s, option, extra) {
  let opt = String(option || '').trim() || null;
  let price = Number(s.price);
  let from = !!s.open_price;
  if (Array.isArray(s.variants) && s.variants.length) {
    const v = opt ? s.variants.find((x) => x.label === opt) : null;
    if (v) price = Number(v.price);
    else { price = Number(s.price); from = true; opt = null; }
  }
  const ex = String(extra || '').trim();
  if (ex && s.extra_options && Array.isArray(s.extra_options.choices)) {
    const c = s.extra_options.choices.find((x) => x.label === ex);
    if (c) { price = round2(price + Number(c.price)); opt = [opt, c.label].filter(Boolean).join(' · '); }
  }
  return { service_id: s.id, name: s.name, option_label: opt, price, price_from: from };
}

// The minutes a booking takes: the services' times, 30 min each when not set
export const durationOf = (items, services) => Math.max(15, items.reduce((a, it) => a + (Number((services.find((s) => s.id === it.service_id) || {}).duration_min) || 30), 0));

// A bill was saved: the booking that day for that phone came (mirrors link_visit())
export function linkVisit(T, bill) {
  if (bill.status !== 'paid' || !bill.customer_phone) return;
  const day = istDay(new Date(bill.created_at));
  const b = T('bookings')
    .filter((x) => x.phone === bill.customer_phone && ['requested', 'confirmed'].includes(x.status) && !x.bill_id && x.want_date === day)
    .sort((a, b2) => (a.slot_at || '9999') .localeCompare(b2.slot_at || '9999') || a.created_at.localeCompare(b2.created_at))[0];
  if (b) Object.assign(b, { status: 'came', bill_id: bill.id, updated_at: new Date().toISOString() });
  const t = new Date(bill.created_at).getTime();
  for (const e of T('enquiries')) {
    const c = new Date(e.created_at).getTime();
    if (e.phone === bill.customer_phone && ['new', 'replied', 'follow_up', 'booked'].includes(e.status) && c <= t && c >= t - 30 * 86400000) e.status = 'came';
  }
}
export function unlinkVisit(T, bill) {
  for (const b of T('bookings').filter((x) => x.bill_id === bill.id)) Object.assign(b, { status: 'confirmed', bill_id: null });
}

// ---------------- for the screens ----------------
const TZ = 'Asia/Kolkata';
export const slotTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: 'numeric', minute: '2-digit' });
export const slotDay = (day) => new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: TZ, weekday: 'short', day: '2-digit', month: 'short' });
export const slotIso = (day, time) => `${day}T${time}:00+05:30`;
export const timeOf = (iso) => new Date(iso).toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });

// Other bookings for the same stylist that overlap this one
export function clashes(booking, all) {
  if (!booking.staff_id || !booking.slot_at) return [];
  const a = new Date(booking.slot_at).getTime();
  const b = a + (Number(booking.duration_min) || 60) * 60000;
  return all.filter((x) => x.id !== booking.id && x.staff_id === booking.staff_id && x.slot_at && ['requested', 'confirmed'].includes(x.status)
    && new Date(x.slot_at).getTime() < b && new Date(x.slot_at).getTime() + (Number(x.duration_min) || 60) * 60000 > a);
}

// "Keratin / Cysteine: ₹5,000 – ₹6,500 (by hair length, thick hair +₹500)"
export function priceLine(s, rupee) {
  if (Array.isArray(s.variants) && s.variants.length) {
    const ps = s.variants.map((v) => Number(v.price));
    const lo = Math.min(...ps);
    const hi = Math.max(...ps);
    const labels = s.variants.map((v) => v.label).filter(Boolean);
    const by = labels.length && labels.every((l) => ['S', 'M', 'L', 'XL', 'Fringe', 'Crown area'].includes(l)) ? 'by hair length' : labels.length ? labels.join(' / ') : 'by stylist';
    const ex = s.extra_options && s.extra_options.choices ? s.extra_options.choices.map((c) => `${c.label.toLowerCase()} hair +${rupee(c.price)}`).join(', ') : '';
    return `${s.name}: ${lo === hi ? rupee(lo) : `${rupee(lo)} – ${rupee(hi)}`} (${[by, ex].filter(Boolean).join(', ')})`;
  }
  return `${s.name}: ${s.open_price ? 'from ' : ''}${rupee(s.price)}`;
}

export const waLink = (phone, text) => `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;

// WhatsApp messages sent from the app (they open WhatsApp with the text typed; the counter taps Send)
export function bookingMessage(kind, b, items, settings, rupee) {
  const salon = (settings && settings.salon_name) || 'Habibs';
  const branch = settings && settings.branch ? ` ${String(settings.branch).split(',')[0]}` : '';
  const first = String(b.name || '').split(' ')[0] || 'there';
  const when = b.slot_at ? `${slotDay(b.want_date)}, ${slotTime(b.slot_at)}` : `${slotDay(b.want_date)}${b.want_time ? ', ' + b.want_time : ''}`;
  const list = items.map((i) => `• ${i.name}${i.option_label ? ` (${i.option_label})` : ''}${i.price != null ? `: ${i.price_from ? 'from ' : ''}${rupee(i.price)}` : ''}`).join('\n');
  const where = [settings && settings.address, settings && settings.maps_url].filter(Boolean).join('\n');
  const today = b.want_date === istDay();
  if (kind === 'confirm') return `Hi ${first}, your appointment at ${salon}${branch} is confirmed for ${when}.\n\n${list}\n\n${where ? where + '\n\n' : ''}Reply here if you need to change it. Ref ${b.ref}`;
  if (kind === 'remind') return `Hi ${first}, a reminder of your appointment at ${salon}${branch} ${today ? 'today' : 'tomorrow'} at ${b.slot_at ? slotTime(b.slot_at) : b.want_time || ''}.\n\n${list}\n\n${where ? where + '\n\n' : ''}See you soon! Reply here if you can't make it.`;
  if (kind === 'cancel') return `Hi ${first}, your appointment at ${salon}${branch} on ${when} is cancelled. Reply here when you'd like a new time.`;
  if (kind === 'no_show') return `Hi ${first}, we missed you today at ${salon}${branch}. Would you like a new time? Reply here.`;
  return `Hi ${first}, this is ${salon}${branch} about your booking on ${when}.`;
}

export function enquiryMessage(e, services, settings, rupee) {
  const salon = (settings && settings.salon_name) || 'Habibs';
  const branch = settings && settings.branch ? ` ${String(settings.branch).split(',')[0]}` : '';
  const first = String(e.name || '').split(' ')[0] || 'there';
  const asked = services.filter((s) => (e.service_ids || []).includes(s.id));
  const prices = asked.map((s) => '• ' + priceLine(s, rupee)).join('\n');
  return `Hi ${first}, thank you for asking ${salon}${branch}.${prices ? `\n\n${prices}` : ''}\n\nWould you like to book? Reply with a day and time that suits you.${settings && settings.opening_hours ? `\nWe are open ${settings.opening_hours}.` : ''}`;
}

// Fill the bill: the draft the billing screen loads (same shape it saves itself)
export function billDraft(b, lines, emptyCustomer) {
  return {
    section: 'Hair', phone: b.phone, skip: false, newCust: { ...emptyCustomer, name: b.name || '' }, curStaff: b.staff_id || '',
    lines, discType: 'pct', discVal: '', payMode: '', billId: undefined, fromBooking: b.id,
  };
}

// ---------------- a booking sent on WhatsApp ----------------
// The website's "Book on WhatsApp" message, or a customer's own words, pasted at the counter:
//   Booking request
//   Services: Keratin (L · Thick), Men's Haircut & Styling
//   Date: Thu 12 Nov 2026
//   Time: 11:30 AM
//   Name: Riya Sen
//   Mobile: 98300 12345
// or "Hi, I'd like to book Keratin (L). Day and time: Saturday 5pm".
// Returns { name, phone, date, time ("HH:MM"), note, items: [{ service_id, option, extra }], unknown: [what wasn't on the menu] }.
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const LENGTHS = { shoulder: 'S', 'below shoulder': 'M', waist: 'L', 'below waist': 'XL', short: 'S', medium: 'M', long: 'L', 'extra long': 'XL' };
// lower case, & = and, apostrophes dropped ("Men's", "Men’s" and "Mens" are the same), other marks as spaces
const norm = (v) => String(v || '').toLowerCase().replace(/[’‘`']/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9+ ]+/g, ' ').replace(/\s+/g, ' ').trim();
const addDaysIso = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const pad = (n) => String(n).padStart(2, '0');

export function parseWaDate(text, today = istDay()) {
  const t = norm(text);
  if (!t) return null;
  let m = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  if (/\btoday\b|\baaj\b/.test(t)) return today;
  if (/\btomorrow\b|\btmrw\b/.test(t)) return addDaysIso(today, 1);
  if (/\bday after tomorrow\b/.test(t)) return addDaysIso(today, 2);
  const year = Number(today.slice(0, 4));
  const fix = (y, mo, d) => {
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
    let iso = `${y || year}-${pad(mo)}-${pad(d)}`;
    if (new Date(iso + 'T12:00:00Z').getUTCDate() !== d) return null;
    if (!y && iso < addDaysIso(today, -7)) iso = `${year + 1}-${pad(mo)}-${pad(d)}`; // "5 Jan" in December: next year
    return iso;
  };
  // 12/11, 12-11-2026, 12.11.26
  m = /\b(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?\b/.exec(text);
  if (m) { const y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : 0; const r = fix(y, Number(m[2]), Number(m[1])); if (r) return r; }
  // 12 Nov 2026, 12th November, Nov 12
  m = /\b(\d{1,2})(?:st|nd|rd|th)? ?(?:of )?([a-z]{3,9})\b(?: (\d{4}))?/.exec(t);
  if (m && MONTHS.includes(m[2].slice(0, 3))) { const r = fix(Number(m[3]) || 0, MONTHS.indexOf(m[2].slice(0, 3)) + 1, Number(m[1])); if (r) return r; }
  m = /\b([a-z]{3,9}) (\d{1,2})(?:st|nd|rd|th)?\b(?: (\d{4}))?/.exec(t);
  if (m && MONTHS.includes(m[1].slice(0, 3))) { const r = fix(Number(m[3]) || 0, MONTHS.indexOf(m[1].slice(0, 3)) + 1, Number(m[2])); if (r) return r; }
  // a day of the week: the next one (today counts)
  m = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/.exec(t);
  if (m) {
    const want = WEEKDAYS.indexOf(m[1]);
    const now = new Date(today + 'T12:00:00Z').getUTCDay();
    return addDaysIso(today, (want - now + 7) % 7 + (/\bnext\b/.test(t) && (want - now + 7) % 7 === 0 ? 7 : 0));
  }
  return null;
}

// "11:30 AM", "5pm", "17:00", "5.30 pm" → "HH:MM" (salon hours: 1 to 8 without am/pm is afternoon)
export function parseWaTime(text) {
  const t = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const m = /\b(\d{1,2})(?:[:.](\d{2}))? ?(am|pm|a\.m\.|p\.m\.)?(?![\d/-])/.exec(t.replace(/\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b/g, ' ').replace(/\b\d{4}-\d{2}-\d{2}\b/g, ' ').replace(/\b\d{1,2}(st|nd|rd|th)? (of )?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, ' '));
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  const ap = m[3] ? m[3][0] : '';
  if (!m[2] && !ap) return null; // a lone number is not a time
  if (h > 23 || min > 59) return null;
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (!ap && h >= 1 && h <= 8) h += 12;
  return `${pad(h)}:${pad(min)}`;
}

// Find a service by the name the customer (or the website) wrote, with its option: "Keratin (L · Thick)"
export function matchService(raw, services, exact = false) {
  // a name with brackets of its own: "Kids' Haircut (Girls, under 10)"
  const whole = norm(raw);
  const named = services.filter((x) => x.active !== false && (norm(x.name) === whole || norm(x.web_name) === whole));
  if (named.length === 1) return { service_id: named[0].id, option: '', extra: '' };
  const m = /^(.*?)\s*\(([^)]*)\)\s*$/.exec(String(raw).trim());
  const base = norm(m ? m[1] : raw);
  const parts = m ? m[2].split(/[·,/|]| - /).map((x) => x.trim()).filter(Boolean) : [];
  if (!base) return null;
  const live = services.filter((s) => s.active !== false);
  const pick = (list) => (list.length === 1 ? list[0] : null);
  const s = pick(live.filter((x) => norm(x.name) === base))
    || pick(live.filter((x) => norm(x.web_name) === base))
    || (!exact && (pick(live.filter((x) => norm(x.name).includes(base) || base.includes(norm(x.name))))
    || pick(live.filter((x) => norm(x.web_name) && (norm(x.web_name).includes(base) || base.includes(norm(x.web_name)))))));
  if (!s) return null;
  let option = '';
  let extra = '';
  const labels = Array.isArray(s.variants) ? s.variants.map((v) => v.label).filter(Boolean) : [];
  const choices = s.extra_options && Array.isArray(s.extra_options.choices) ? s.extra_options.choices.map((c) => c.label) : [];
  for (const p of parts) {
    const n = norm(p);
    const lab = labels.find((l) => norm(l) === n) || (LENGTHS[n] && labels.includes(LENGTHS[n]) ? LENGTHS[n] : null);
    if (lab && !option) { option = lab; continue; }
    const ch = choices.find((c) => norm(c) === n || norm(c) === n.replace(/ hair$/, ''));
    if (ch && !extra) extra = ch;
  }
  return { service_id: s.id, option, extra };
}

export function parseWaBooking(text, services, today = istDay()) {
  const src = String(text || '').replace(/\r/g, '');
  const field = (...keys) => {
    for (const k of keys) {
      const m = new RegExp(`^\\s*[*_]*${k}[*_]*\\s*[:\\-–]\\s*(.+)$`, 'im').exec(src);
      if (m) return m[1].replace(/[*_]+/g, '').trim();
    }
    return '';
  };
  const out = { name: '', phone: '', date: null, time: null, note: '', items: [], unknown: [] };
  out.name = field('name', 'naam').slice(0, 80);
  const ph = field('mobile', 'phone', 'number', 'whatsapp');
  out.phone = cleanPhone(ph) || cleanPhone((/(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/.exec(src) || [''])[0]) || '';
  const when = field('date', 'day', 'day and time', 'when');
  out.date = parseWaDate(when, today) || parseWaDate(src.replace(/^.*(?:mobile|phone|number)\s*:.*$/gim, ''), today);
  out.time = parseWaTime(field('time')) || parseWaTime(when) || parseWaTime(src.replace(/^.*(?:mobile|phone|number)\s*:.*$/gim, ''));
  out.note = field('note', 'request', 'message').slice(0, 300);
  let svc = field('services', 'service');
  if (!svc) { const m = /\bbook(?:ing)?(?: for| a| an)? (.+?)(?:\.\s|\.$|\n|$)/i.exec(src); if (m) svc = m[1].replace(/\b(day and time|on|at|for)\b.*$/i, '').trim(); }
  // "Keratin (L · Thick), Men's Haircut" — commas inside brackets don't split; " + " splits, "O3+" doesn't
  const frags = [];   // { text, sep: the separator after it, as written }
  let depth = 0, cur = '';
  for (let k = 0; k < svc.length; k++) {
    const ch = svc[k];
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    const plus = ch === '+' && svc[k - 1] === ' ' && svc[k + 1] === ' ';
    if ((ch === ',' || ch === ';' || ch === '\n' || plus) && depth === 0) { frags.push({ text: cur, sep: ch === ',' ? ', ' : plus ? ' + ' : '; ' }); cur = ''; } else cur += ch;
  }
  frags.push({ text: cur, sep: '' });
  const list = frags.map((f) => ({ ...f, text: f.text.replace(/^\s*(and|&)\s+/i, '').trim() })).filter((f) => f.text);
  // a name with a comma or " + " in it ("Women's Global Colour, Ammonia-free (L)", "Bride Package A + B"): the longest exact name first
  for (let i = 0; i < list.length;) {
    let hit = null, used = 1;
    for (let j = Math.min(list.length, i + 3); j > i + 1 && !hit; j--) {
      const cand = list.slice(i, j).map((f, k, a) => f.text + (k < a.length - 1 ? f.sep : '')).join('');
      hit = matchService(cand, services, true);
      if (hit) used = j - i;
    }
    if (!hit) hit = matchService(list[i].text, services);
    if (hit && !out.items.some((x) => x.service_id === hit.service_id && x.option === hit.option)) out.items.push(hit);
    else if (!hit) out.unknown.push(list[i].text);
    i += used;
  }
  return out;
}

// The message the website's "Book on WhatsApp" sends (the same shape parseWaBooking() reads)
export function waBookingText({ items = [], date = '', time = '', name = '', phone = '', note = '' }, salon = 'Habibs') {
  return [
    `Booking request – ${salon}`,
    items.length ? `Services: ${items.join(', ')}` : 'Services: ',
    `Date: ${date}`,
    `Time: ${time}`,
    `Name: ${name}`,
    phone ? `Mobile: ${phone}` : '',
    note ? `Note: ${note}` : '',
  ].filter(Boolean).join('\n');
}
