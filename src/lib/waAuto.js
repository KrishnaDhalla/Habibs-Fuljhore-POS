// Automatic WhatsApp messages: which are due now. Same rules as wa_due() in supabase/01_schema.sql.
//   feedback: a paid bill 2 to 48 hours old (Settings), not a staff or past bill; one request a customer in 30 days
//   reminder: a confirmed booking starting within 3 hours (Settings), booked at least an hour ago, not reminded yet
//   winback:  agreed to WhatsApp offers, last visit 45 to 365 days ago (Settings), no booking coming up, not staff;
//             once per lapse and at most once in 60 days; at most 20 a day (Settings)
// Nothing between 9 pm and 9 am, and nothing to a customer who replied STOP.
import { istDay } from './format';

const PHONE = /^[6-9][0-9]{9}$/;
const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const num = (settings, k, d, lo, hi) => { const v = settings && settings[k]; const n = Number(v); return Math.min(hi, Math.max(lo, v == null || v === '' || isNaN(n) ? d : n)); };
const flag = (settings, k) => !!settings && (settings[k] === true || settings[k] === 'true');
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export const waAutoOn = (settings) => flag(settings, 'wa_feedback_on') || flag(settings, 'wa_reminders_on') || flag(settings, 'wa_winback_on');

export function dueMessages({ bills = [], bookings = [], booking_items = [], customers = [], staff = [], wa_messages = [] }, settings = {}, now = new Date()) {
  const n = new Date(now).getTime();
  const hour = new Date(n + 5.5 * 3600000).getUTCHours();
  if (hour < 9 || hour >= 21) return [];
  const t = (v) => new Date(v).getTime();
  const today = istDay(new Date(n));
  const H = 3600000, D = 86400000;
  const byPhone = Object.fromEntries(customers.map((c) => [c.phone, c]));
  const stopped = (phone) => !!(byPhone[phone] && byPhone[phone].wa_stop);
  const out = [];

  if (flag(settings, 'wa_feedback_on')) {
    const after = num(settings, 'wa_feedback_after_hours', 2, 0, 47) * H;
    const asked = new Set(wa_messages.filter((m) => m.kind === 'feedback' && t(m.created_at) > n - 30 * D).map((m) => m.phone));
    const latest = {};
    for (const b of bills) {
      if (b.status !== 'paid' || !PHONE.test(b.customer_phone || '') || b.for_staff || /-P[0-9]+$/.test(b.bill_no || '')) continue;
      if (!(t(b.created_at) <= n - after && t(b.created_at) > n - 48 * H)) continue;
      if (stopped(b.customer_phone) || asked.has(b.customer_phone)) continue;
      const cur = latest[b.customer_phone];
      if (!cur || t(b.created_at) > t(cur.created_at) || (t(b.created_at) === t(cur.created_at) && b.id < cur.id)) latest[b.customer_phone] = b;
    }
    for (const b of Object.values(latest).sort((x, y) => cmp(x.customer_phone, y.customer_phone))) {
      out.push({ kind: 'feedback', dedupe: 'feedback:' + b.id, phone: b.customer_phone, name: b.customer_name || null, bill_id: b.id, customer_id: b.customer_id || null, bill_no: b.bill_no });
    }
  }

  if (flag(settings, 'wa_reminders_on')) {
    const within = num(settings, 'wa_remind_hours', 3, 1, 48) * H;
    const done = new Set(wa_messages.map((m) => m.dedupe).filter(Boolean));
    const rows = bookings.filter((k) => k.status === 'confirmed' && k.slot_at && t(k.slot_at) > n && t(k.slot_at) <= n + within && !k.reminded_at
      && t(k.created_at) <= n - H && PHONE.test(k.phone || '') && !stopped(k.phone))
      .map((k) => ({ k, dd: 'reminder:' + k.id + ':' + Math.round(t(k.slot_at) / 1000) }))
      .filter((x) => !done.has(x.dd))
      .sort((x, y) => t(x.k.slot_at) - t(y.k.slot_at) || cmp(x.k.id, y.k.id));
    for (const { k, dd } of rows) {
      const names = booking_items.filter((i) => i.booking_id === k.id).map((i) => i.name).sort(cmp);
      out.push({ kind: 'reminder', dedupe: dd, phone: k.phone, name: k.name || null, booking_id: k.id, customer_id: k.customer_id || null, slot_at: k.slot_at, services: names.length ? names.join(', ') : null });
    }
  }

  if (flag(settings, 'wa_winback_on')) {
    const days = Math.trunc(num(settings, 'wa_winback_days', 45, 14, 300));
    const cap = Math.trunc(num(settings, 'wa_winback_per_day', 20, 0, 200));
    const left = cap - wa_messages.filter((m) => m.kind === 'winback' && istDay(new Date(m.created_at)) === today).length;
    if (left > 0) {
      const done = new Set(wa_messages.map((m) => m.dedupe).filter(Boolean));
      const recent = new Set(wa_messages.filter((m) => m.kind === 'winback' && t(m.created_at) > n - 60 * D).map((m) => m.customer_id));
      const booked = new Set(bookings.filter((k) => ['requested', 'confirmed'].includes(k.status) && (k.want_date || (k.slot_at ? istDay(new Date(k.slot_at)) : '')) >= today).map((k) => k.phone));
      const staffPhones = new Set(staff.filter((s) => s.active).map((s) => digits10(s.phone)));
      const rows = customers.filter((c) => c.whatsapp_ok && !c.wa_stop && PHONE.test(c.phone || '') && Number(c.visits) >= 1 && c.last_visit
        && t(c.last_visit) <= n - days * D && t(c.last_visit) > n - 365 * D && !booked.has(c.phone) && !staffPhones.has(c.phone) && !recent.has(c.id))
        .map((c) => ({ c, dd: 'winback:' + c.id + ':' + istDay(new Date(c.last_visit)) }))
        .filter((x) => !done.has(x.dd))
        .sort((x, y) => t(y.c.last_visit) - t(x.c.last_visit) || cmp(x.c.id, y.c.id))
        .slice(0, left);
      for (const { c, dd } of rows) out.push({ kind: 'winback', dedupe: dd, phone: c.phone, name: c.name || null, customer_id: c.id, last_visit: c.last_visit, points: Number(c.points) || 0 });
    }
  }
  return out;
}

export const WA_KIND = { bill: 'Bill', feedback: 'Feedback request', reminder: 'Booking reminder', winback: 'We miss you' };
export const RATING = { good: 'Loved it', ok: 'It was okay', bad: 'Not happy' };
