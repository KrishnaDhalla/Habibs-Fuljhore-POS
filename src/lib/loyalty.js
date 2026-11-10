// Loyalty points: the same rules as the "Loyalty points" section of supabase/01_schema.sql.
// 1 point = ₹1. Earned on what the customer pays with money (cash, UPI, card) for services at their normal price:
// 5% by default, whole points, rounded down. Nothing on offer prices, on products (unless switched on), on staff's
// own numbers, or on what points (or, later, a prepaid card) pay. Used from 100 points, up to 20% of a bill, as a
// payment, so prices, GST and commission don't change. Expire 12 months after the last visit.
import { toPaise, fmtDate } from './format';

export function loyaltyRules(settings) {
  const s = settings || {};
  const num = (k, d) => (s[k] === undefined || s[k] === null || s[k] === '' || isNaN(Number(s[k])) ? d : Number(s[k]));
  const flag = (k, d) => (s[k] === undefined || s[k] === null || s[k] === '' ? d : s[k] === true || s[k] === 'true');
  return {
    on: flag('loyalty_on', true),
    pct: num('loyalty_earn_pct', 5),
    minUse: num('loyalty_min_use', 100),
    maxPct: num('loyalty_max_use_pct', 20),
    months: Math.max(1, Math.trunc(num('loyalty_expiry_months', 12))),
    products: flag('loyalty_products', false),
  };
}

const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
export const isStaffPhone = (phone, staff) => !!phone && (staff || []).some((s) => s.active && digits10(s.phone) === phone);

// Points a bill earns. bill: { total, paid_cash, paid_upi, paid_card, items: [{ item_type, offer_discount, taxable, gst }] }
export function earnPoints(bill, rules, { phone, staff } = {}) {
  if (!rules.on || !phone || isStaffPhone(phone, staff)) return 0;
  const total = toPaise(bill.total);
  const pct = Math.round(Number(rules.pct) * 100);
  if (total <= 0 || pct <= 0) return 0;
  const money = toPaise(bill.paid_cash) + toPaise(bill.paid_upi) + toPaise(bill.paid_card);
  let base = 0;
  for (const it of bill.items || []) {
    if ((Number(it.offer_discount) || 0) !== 0) continue;
    if (it.item_type === 'service' || (rules.products && it.item_type === 'product')) base += toPaise(it.taxable) + toPaise(it.gst);
  }
  if (base <= 0 || money <= 0) return 0;
  // whole numbers all the way (paise × paise × % × 100 is too big for ordinary numbers)
  return Number((BigInt(base) * BigInt(money) * BigInt(pct)) / (BigInt(total) * 1000000n));
}

// The most points this bill can use (0 when they can't use any yet)
export function maxPointsUse(balance, total, rules) {
  const b = Math.trunc(Number(balance) || 0);
  if (!rules.on || b < rules.minUse) return 0;
  return Math.max(0, Math.min(b, Math.floor(((Number(total) || 0) * rules.maxPct) / 100 + 1e-9)));
}

// Expiry: 12 months after the last visit
export function expiresAt(lastVisit, rules) {
  if (!lastVisit) return null;
  const d = new Date(lastVisit);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + rules.months);
  if (d.getUTCDate() !== day) d.setUTCDate(0); // 31 Jan + 1 month → 28/29 Feb, as the database does
  return d.toISOString();
}
// The points a customer can count on now (none once they've expired)
export function liveBalance(customer, rules, at = new Date()) {
  if (!customer) return 0;
  const pts = Math.trunc(Number(customer.points) || 0);
  if (pts <= 0) return pts;
  const exp = expiresAt(customer.last_visit, rules);
  return exp && new Date(exp) <= new Date(at) ? 0 : pts;
}

// "Points: +44 earned · balance 150 (₹150 off the next visit) · valid till 07 Nov 2027"
export function pointsSummary(bill, rules) {
  // a staff member's own bill earns no points: no points box (unless they paid with points)
  if (bill.for_staff && !Number(bill.paid_points)) return null;
  if (!bill.customer_phone || (!Number(bill.points_earned) && !Number(bill.paid_points) && bill.points_balance == null && !bill._points_preview)) return null;
  const earned = bill._pending ? Number(bill._points_preview) || 0 : Number(bill.points_earned) || 0;
  const bal = bill._pending ? null : bill.points_balance == null ? null : Number(bill.points_balance);
  return {
    earned,
    used: Number(bill.paid_points) || 0,
    balance: bal,
    usable: bal != null && bal >= rules.minUse,
    minUse: rules.minUse,
    maxPct: rules.maxPct,
    // (not on a past bill: typed in later, its balance is today's, valid from their latest visit)
    validTill: bill.status === 'paid' && bal > 0 && !/-P\d+$/.test(bill.bill_no || '') ? fmtDate(expiresAt(bill.created_at, rules)) : null,
    pending: !!bill._pending,
  };
}

// Lines for the WhatsApp bill
export function pointsWhatsApp(bill, rules) {
  const p = pointsSummary(bill, rules);
  if (!p || bill.status === 'cancelled') return [];
  const out = [];
  if (p.earned > 0) out.push(`⭐ You earned *${p.earned} points* on this bill${p.pending ? ' (added when the bill uploads)' : ''}.`);
  if (p.used > 0) out.push(`Paid with ${p.used} points (₹${p.used}).`);
  if (p.balance != null) {
    if (p.usable) out.push(`Your balance: *${p.balance} points = ₹${p.balance} off* your next visit (up to ${p.maxPct}% of a bill).`);
    else if (p.balance > 0) out.push(`Your balance: ${p.balance} points. Use them from ${p.minUse} points (1 point = ₹1).`);
    if (p.validTill) out.push(`Points are valid till ${p.validTill} and stay valid while you visit at least once in ${rules.months} months.`);
  }
  return out;
}
