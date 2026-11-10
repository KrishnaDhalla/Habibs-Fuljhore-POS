import { round2, toPaise, monthDays, monthRange } from './format';
import { mulDivRound, allocate, splitGst } from './paise';

const sum = (arr, f = (x) => x) => round2(arr.reduce((a, x) => a + (Number(f(x)) || 0), 0));
const add = (arr) => arr.reduce((a, x) => a + x, 0);
const R = (p) => p / 100; // paise → rupees

/**
 * Bill maths. Everything is worked out in whole paise, so nothing is lost to rounding.
 * lines: [{ qty, unit_price, gst_pct, offer_discount?, offer_name?, disc_type?, disc_value?, ... }]
 * 1. Offer savings (worked out by applyOffers) come off their own lines first.
 * 2. A discount on one line (disc_type 'pct' = % of what is left of that line, 'amt' = ₹ off the line)
 *    comes off that line next: line_discount.
 * 3. The counter's discount on the whole bill (% or ₹) is then shared across lines in proportion to what is left
 *    (largest remainder, so the shares add up to the exact discount), so each line's taxable
 *    value (used for GST and staff commission) is correct.
 *    A line's discount = its offer + its own discount + its share of the bill discount.
 * Staff's own services (line.staff = true): the line's own discount is the staff price (free or 50% off);
 *    it is also staff_discount, and commission_base is the line's value without it, so whoever did the service
 *    earns their commission on the full price.
 * 3. GST per line: prices including GST → taxable = net ÷ (1 + rate); prices without GST → GST = net × rate.
 *    CGST and SGST are split per GST rate, exactly as the receipt prints them.
 * 4. Total is rounded to the nearest rupee (50 paise goes up); the difference is the round off.
 */
export function calcBill(lines, { discountType = 'amt', discountValue = 0, gstOn = false, inclusive = true } = {}) {
  const amountP = lines.map((l) => Math.max(0, toPaise((Number(l.qty) || 0) * (Number(l.unit_price) || 0))));
  const offerP = lines.map((l, i) => Math.max(0, Math.min(toPaise(l.offer_discount), amountP[i])));
  const afterP = amountP.map((a, i) => a - offerP[i]);
  const baseP = add(afterP);
  const lineP = lines.map((l, i) => {
    const v = Math.max(0, Number(l.disc_value) || 0);
    if (!v || !afterP[i]) return 0;
    return Math.min(afterP[i], l.disc_type === 'amt' ? toPaise(v) : mulDivRound(afterP[i], toPaise(Math.min(v, 100)), 10000));
  });
  const restP = afterP.map((a, i) => a - lineP[i]);
  const restSum = add(restP);
  const dv = Math.max(0, Number(discountValue) || 0);
  const billP = Math.min(restSum, discountType === 'pct' ? mulDivRound(restSum, toPaise(Math.min(dv, 100)), 10000) : toPaise(dv));
  const shareP = allocate(billP, restP);
  // a staff member's own services: the staff price is not the counter's discount (not in the owner's limit)
  const staffSumP = add(lines.map((l, i) => (l.staff ? lineP[i] : 0)));
  const manualP = add(lineP) - staffSumP + billP;

  const items = lines.map((l, i) => {
    const discP = offerP[i] + lineP[i] + shareP[i];
    const netP = amountP[i] - discP;
    const pct = gstOn ? Number(l.gst_pct) || 0 : 0;
    const rate = toPaise(pct); // 5% → 500
    let taxP = netP;
    let gstP = 0;
    if (rate > 0) {
      if (inclusive) {
        taxP = mulDivRound(netP, 10000, 10000 + rate);
        gstP = netP - taxP;
      } else {
        gstP = mulDivRound(netP, rate, 10000);
      }
    }
    // commission is on the price before a staff price
    const staffP = l.staff ? lineP[i] : 0;
    const baseP = !staffP ? taxP : rate > 0 && inclusive ? mulDivRound(netP + staffP, 10000, 10000 + rate) : netP + staffP;
    return {
      ...l, amount: R(amountP[i]), offer_discount: R(offerP[i]),
      offer_id: offerP[i] ? l.offer_id || '' : '', offer_name: offerP[i] ? l.offer_name || '' : '',
      line_discount: R(lineP[i]), staff_discount: R(staffP), discount: R(discP), taxable: R(taxP), gst_pct: pct, gst: R(gstP),
      commission_base: R(baseP),
      _taxP: taxP, _gstP: gstP,
    };
  });

  const taxP = add(items.map((x) => x._taxP));
  const gstP = add(items.map((x) => x._gstP));
  const byRate = {};
  for (const it of items) {
    if (!it.gst_pct) continue;
    const k = it.gst_pct;
    byRate[k] = byRate[k] || { rate: k, taxP: 0, gstP: 0 };
    byRate[k].taxP += it._taxP;
    byRate[k].gstP += it._gstP;
  }
  const taxRates = Object.values(byRate).sort((a, b) => a.rate - b.rate).map((r) => {
    const [c, s] = splitGst(r.gstP);
    return { rate: r.rate, taxable: R(r.taxP), gst: R(r.gstP), cgst: R(c), sgst: R(s) };
  });
  const cgstP = add(taxRates.map((r) => toPaise(r.cgst)));
  const grandP = taxP + gstP;
  const totalP = mulDivRound(grandP, 1, 100) * 100;

  return {
    items: items.map(({ _taxP, _gstP, ...x }) => x),
    subtotal: R(add(amountP)),
    offerDiscount: R(add(offerP)),
    lineDiscount: R(add(lineP) - staffSumP),   // the discounts on single lines (not staff prices)
    staffDiscount: R(staffSumP),    // staff prices on a staff member's own services
    billDiscount: R(billP),         // the discount on the whole bill
    manualDiscount: R(manualP),     // both: the counter's own discounts
    discount: R(add(offerP) + staffSumP + manualP),
    // % of the counter's own discounts (lines + bill), after offers and staff prices: the owner's limit applies to this
    discountPct: baseP - staffSumP ? mulDivRound(manualP, 10000, baseP - staffSumP) / 100 : 0,
    taxable: R(taxP),
    gst: R(gstP),
    cgst: R(cgstP),
    sgst: R(gstP - cgstP),
    round_off: R(totalP - grandP),
    total: R(totalP),
    taxRates,
  };
}

// Were this bill's prices GST-inclusive? Read from the bill itself, so an old bill reprints
// correctly even after the setting is changed.
export const gstIncluded = (b) =>
  toPaise(b.taxable) + toPaise(b.cgst) + toPaise(b.sgst) === toPaise(b.subtotal) - toPaise(b.discount);

// GST summary per rate for a saved bill's lines (used by the printed and WhatsApp receipts).
// Same split as calcBill, so the printed CGST/SGST always add up to the bill's CGST/SGST.
export function gstByRate(items) {
  const m = {};
  for (const it of items || []) {
    const r = Number(it.gst_pct) || 0;
    if (!r) continue;
    m[r] = m[r] || { rate: r, taxP: 0, gstP: 0 };
    m[r].taxP += toPaise(it.taxable);
    m[r].gstP += toPaise(it.gst);
  }
  return Object.values(m).sort((a, b) => a.rate - b.rate).map((x) => {
    const [c, s] = splitGst(x.gstP);
    return { rate: x.rate, taxable: R(x.taxP), gst: R(x.gstP), cgst: R(c), sgst: R(s) };
  });
}

/**
 * Checks a bill before it is saved: every line and total must add up exactly.
 * The database runs the same checks (create_bill), so a wrong bill can never be stored.
 * Returns a list of problems (empty = fine).
 */
export function checkBill(p) {
  const out = [];
  const P = toPaise;
  const items = p.items || [];
  if (!items.length) out.push('A bill needs at least one item');
  const bad = (cond, msg) => { if (cond) out.push(msg); };
  for (const it of items) {
    const n = it.name || 'item';
    const qty = Number(it.qty);
    bad(!(qty > 0) || !Number.isInteger(qty), `${n}: quantity must be a whole number above 0`);
    bad(!(Number(it.unit_price) >= 0), `${n}: price can't be below 0`);
    bad(P(it.amount) !== P(qty * Number(it.unit_price)), `${n}: amount is not quantity × price`);
    bad(P(it.offer_discount) < 0 || P(it.offer_discount) > P(it.discount), `${n}: offer discount is wrong`);
    bad(P(it.line_discount) < 0 || P(it.offer_discount) + P(it.line_discount) > P(it.discount), `${n}: discount on this item is wrong`);
    bad(P(it.staff_discount) < 0 || P(it.staff_discount) > P(it.line_discount), `${n}: staff price is wrong`);
    if (it.commission_base != null && it.commission_base !== '') {
      bad(P(it.commission_base) < P(it.taxable) || P(it.commission_base) > P(it.taxable) + P(it.staff_discount), `${n}: commission value is wrong`);
    }
    bad(P(it.discount) < 0 || P(it.discount) > P(it.amount), `${n}: discount is more than the price`);
    bad(P(it.taxable) < 0 || P(it.gst) < 0, `${n}: taxable value or GST below 0`);
    const net = P(it.amount) - P(it.discount);
    const rate = P(it.gst_pct);
    if (!rate) bad(P(it.gst) !== 0 || P(it.taxable) !== net, `${n}: taxable value doesn't match`);
    else {
      const inc = P(it.taxable) + P(it.gst) === net && P(it.taxable) === mulDivRound(net, 10000, 10000 + rate);
      const exc = P(it.taxable) === net && P(it.gst) === mulDivRound(net, rate, 10000);
      bad(!inc && !exc, `${n}: GST doesn't match the rate`);
    }
  }
  const s = (k) => items.reduce((a, it) => a + P(it[k]), 0);
  bad(P(p.subtotal) !== s('amount'), 'Subtotal is not the sum of the items');
  bad(P(p.offer_discount) !== s('offer_discount'), 'Offer discount is not the sum of the items');
  bad(P(p.discount) !== s('discount'), 'Discount is not the sum of the items');
  bad(P(p.taxable) !== s('taxable'), 'Taxable value is not the sum of the items');
  bad(P(p.cgst) + P(p.sgst) !== s('gst'), 'CGST + SGST is not the GST of the items');
  // Halves per GST rate: an odd paisa per rate may go to CGST
  const rates = new Set(items.filter((it) => Number(it.gst_pct) > 0).map((it) => Number(it.gst_pct))).size;
  bad(P(p.cgst) < 0 || P(p.sgst) < 0 || Math.abs(P(p.cgst) - P(p.sgst)) > rates, 'CGST and SGST must be the two halves of the GST');
  const grand = P(p.taxable) + P(p.cgst) + P(p.sgst);
  bad(P(p.total) % 100 !== 0 || P(p.total) !== mulDivRound(grand, 1, 100) * 100, 'Total is not rounded to the rupee correctly');
  bad(P(p.round_off) !== P(p.total) - grand, 'Round off is wrong');
  bad(P(p.total) < 0, 'Total below 0');
  // Points (loyalty) are a payment too, in whole rupees
  const paid = ['paid_cash', 'paid_upi', 'paid_card', 'paid_points'];
  bad(P(p.paid_points) % 100 !== 0, 'Points are whole rupees');
  bad(paid.some((k) => P(p[k]) < 0), 'A payment amount is below 0');
  bad(paid.reduce((a, k) => a + P(p[k]), 0) !== P(p.total), 'Payments do not add up to the total');
  bad(!['Cash', 'UPI', 'Card', 'Split'].includes(p.pay_mode), 'Payment mode missing');
  return out;
}

/**
 * Monthly payroll for one staff member (the salon's rule from November 2026).
 * Day rate = monthly salary ÷ (days in the month − paid days off), e.g. ₹20,000 ÷ (30 − 4) = ₹769.23.
 * Days worked = days employed this month (from joining, up to the last working day if they left)
 *               − absent days − ½ × half days − days off (week offs W + approved leave L).
 *               (Days with nothing marked count as worked.)
 * Salary earned = day rate × days worked. So 4 days off in a full month = the monthly salary; each day off not
 * taken is paid one day rate more (nothing carries to next month); each day off above 4 is one day rate less.
 * For a part month the same day rate, and the days off are in proportion (paid_offs) for the slip.
 * Commission = service sales × service % + product sales × product %, on sales after discount and without GST;
 * a staff member's own service counts at its price before the staff price (commission_base).
 */
export function calcPayroll({ staff, month, attendance, advances, lines, extra = {}, paidOffs = 4 }) {
  const dim = monthDays(month);
  const [first, last] = monthRange(month);
  const from = staff.join_date && staff.join_date > first ? staff.join_date : first;
  // Someone who left is paid up to their last working day
  const to = staff.leave_date && staff.leave_date < last ? staff.leave_date : last;
  if (staff.join_date && staff.join_date > last) return null;
  if (staff.leave_date && staff.leave_date < first) return null;
  const employedDays = Math.max(0, Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1);

  const att = attendance.filter((a) => a.staff_id === staff.id && a.day >= from && a.day <= to);
  const absent = att.filter((a) => a.status === 'A').length;
  const half = att.filter((a) => a.status === 'H').length;
  const weekOff = att.filter((a) => a.status === 'W').length;
  const leave = att.filter((a) => a.status === 'L').length;
  // paid days off: the month's allowance, in proportion for a part month
  const offsMonth = Math.max(0, Number(paidOffs) || 0);
  const allowance = Math.round((offsMonth * employedDays) / dim);
  const offs = weekOff + leave;
  const unpaidOff = Math.max(0, offs - allowance);
  const notTaken = Math.max(0, allowance - offs);
  const paidDays = Math.max(0, employedDays - absent - half * 0.5 - offs);

  const salary = Number(staff.monthly_salary) || 0;
  const base = dim - offsMonth > 0 ? dim - offsMonth : dim; // working days in a full month
  const salaryEarned = Math.round((salary * paidDays) / base);

  const mine = lines.filter((l) => l.staff_id === staff.id);
  const serviceSales = sum(mine.filter((l) => l.item_type === 'service'), (l) => (l.commission_base != null && l.commission_base !== '' ? l.commission_base : l.taxable));
  const productSales = sum(mine.filter((l) => l.item_type === 'product'), (l) => l.taxable);
  const servicesDone = mine.filter((l) => l.item_type === 'service').length;
  const commission = Math.round(
    (serviceSales * (Number(staff.service_commission_pct) || 0)) / 100 +
      (productSales * (Number(staff.product_commission_pct) || 0)) / 100
  );

  const adv = sum(advances.filter((a) => a.staff_id === staff.id), (a) => a.amount);
  const incentive = Number(extra.incentive) || 0;
  const deductions = Number(extra.deductions) || 0;
  // Pay can't go below zero: advances bigger than this month's pay are carried to next month
  const raw = Math.round(salaryEarned + commission + incentive - adv - deductions);
  const net = Math.max(0, raw);

  return {
    staff_id: staff.id,
    month,
    days_in_month: dim,
    employed_days: employedDays,
    paid_days: paidDays,
    absent_days: absent,
    half_days: half,
    week_off: weekOff,
    leave_days: leave,
    paid_offs: allowance,
    unpaid_off_days: unpaidOff,
    offs_not_taken: notTaken,
    work_days_base: base,
    day_rate: Math.round((salary * 100) / base) / 100,
    monthly_salary: salary,
    salary_earned: salaryEarned,
    services_done: servicesDone,
    service_sales: serviceSales,
    product_sales: productSales,
    commission,
    incentive,
    advances: adv,
    deductions,
    net_pay: net,
    carry_forward: Math.max(0, -raw),
  };
}
