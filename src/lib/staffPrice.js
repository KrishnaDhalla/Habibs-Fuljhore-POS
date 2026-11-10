// A staff member's own services (the salon's rule from November 2026):
//   the bill's mobile number is an active staff member's → services on the tabs in Settings (Hair, Threading,
//   Waxing) are free, the rest 50% off; products at the normal price; no offers and no points.
//   The staff price is the line's own discount (staff_discount); whoever did the service earns commission on the
//   full price (commission_base, worked out in calcBill).
// Same rules as staff_price_check() in the database.
import { toPaise } from './format';
import { mulDivRound } from './paise';

const digits10 = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const money = (n) => String(Math.round(Number(n) * 100) / 100);

export function staffPriceRules(settings = {}) {
  const free = Array.isArray(settings.staff_free_sections) ? settings.staff_free_sections : ['Hair', 'Threading', 'Waxing'];
  const raw = settings.staff_discount_pct;
  const pct = raw == null || raw === '' || isNaN(Number(raw)) ? 50 : Math.min(100, Math.max(0, Number(raw)));
  return { free, pct };
}

// The % off for one service: 100 on the free tabs, otherwise the staff % (50)
export const staffPctOf = (section, rules) => (rules.free.includes(section) ? 100 : rules.pct);

// The active staff member with this mobile number (10 digits), or null
export const staffOfPhone = (phone, staff) =>
  (phone && /^\d{10}$/.test(phone) ? [...(staff || [])].filter((s) => s.active && digits10(s.phone) === phone).sort(byName)[0] : null) || null;

// The staff price of a line in paise (offers are off on these lines, so it is a share of the whole line)
export const staffPriceP = (amount, pct) => mulDivRound(toPaise(amount), toPaise(pct), 10000);

// Checks a bill's staff prices like the database: { for_staff, total, err }
export function staffPriceCheck(p, { staff, services, settings }) {
  const rules = staffPriceRules(settings);
  const who = staffOfPhone(p.customer_phone || '', staff);
  let total = 0;
  let err = null;
  for (const it of p.items || []) {
    const sd = Number(it.staff_discount) || 0;
    if (!sd) continue;
    const name = it.name || 'item';
    total = Math.round((total + sd) * 100) / 100;
    if (err) continue;
    if (!who) err = "Staff price: this mobile number is not a staff member's";
    else if (it.item_type !== 'service') err = 'Staff price: only on services, not on ' + name;
    else if (Number(it.offer_discount) > 0) err = `Staff price: no offers on a staff member's own services (${name})`;
    else if (toPaise(it.line_discount) !== toPaise(sd)) err = 'Staff price: no other discount on ' + name;
    else {
      const s = (services || []).find((x) => x.id === it.service_id);
      if (s) {
        const pct = staffPctOf(s.section, rules);
        const want = staffPriceP(it.amount, pct);
        if (toPaise(sd) !== want) err = `Staff price: ${name} should be ₹${money(want / 100)} off (${money(pct)}% for staff)`;
      }
    }
  }
  return { for_staff: who ? who.id : null, total, err };
}
