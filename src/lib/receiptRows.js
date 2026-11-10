// What a bill says, line by line: the same content as the printed receipt (components/Receipt.jsx).
// Used to draw the bill as a picture for WhatsApp (receiptImage.js). No browser code, so tests run it in Node.
import { rupee, fmtDateTime, fmtPhone, round2 } from './format';
import { gstByRate, gstIncluded } from './calc';
import { loyaltyRules, pointsSummary } from './loyalty';

// [[offer name, total saved], …] from the bill's lines
export function offerLines(items) {
  const m = new Map();
  for (const it of items || []) {
    const d = Number(it.offer_discount) || 0;
    if (!d) continue;
    const k = it.offer_name || 'Offer';
    m.set(k, round2((m.get(k) || 0) + d));
  }
  return [...m.entries()];
}
// staff prices on a staff member's own services (shown on their own line, not as the counter's discount)
export const staffPriceTotal = (items) => round2((items || []).reduce((a, it) => a + (Number(it.staff_discount) || 0), 0));
export const manualDiscount = (bill, items) => round2((Number(bill.discount) || 0) - (Number(bill.offer_discount) || 0) - staffPriceTotal(items));

export function payText(b) {
  if (b.pay_mode !== 'Split' && !(Number(b.paid_points) > 0)) return b.pay_mode;
  return [['Points', b.paid_points], ['Cash', b.paid_cash], ['UPI', b.paid_upi], ['Card', b.paid_card]]
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${k} ${rupee(v)}`)
    .join(' + ');
}

// Rows: { t: 'center' | 'left' | 'lr' | 'sub' | 'hr', text, right, bold, big }
export function receiptRows(bill, items, settings) {
  const s = settings || {};
  const rows = [];
  const C = (text, o = {}) => text && rows.push({ t: 'center', text: String(text), ...o });
  const LR = (text, right, o = {}) => rows.push({ t: 'lr', text: String(text), right: String(right), ...o });
  const HR = () => rows.push({ t: 'hr' });
  const gstOn = Number(bill.cgst) + Number(bill.sgst) > 0;
  const cancelled = bill.status === 'cancelled';

  C(s.salon_name || 'Habibs Hair & Beauty', { bold: true, big: true });
  C(s.branch);
  C(s.address);
  if (s.phone) C('Ph: ' + s.phone);
  if (s.gstin) C('GSTIN: ' + s.gstin);
  HR();
  C(cancelled ? '*** CANCELLED ***' : gstOn ? 'TAX INVOICE' : 'BILL', { bold: true });
  rows.push({ t: 'left', text: 'Bill No: ' + bill.bill_no });
  rows.push({ t: 'left', text: 'Date: ' + fmtDateTime(bill.created_at) });
  if (bill.customer_name || bill.customer_phone) {
    rows.push({ t: 'left', text: 'Customer: ' + [bill.customer_name, bill.customer_phone ? fmtPhone(bill.customer_phone) : ''].filter(Boolean).join(' ') });
  }
  HR();
  for (const it of items || []) {
    LR(it.name + (Number(it.qty) !== 1 ? ` x${Number(it.qty)}` : ''), rupee(it.amount));
    if (Number(it.staff_discount) > 0) rows.push({ t: 'sub', text: (Number(it.staff_discount) >= Number(it.amount) ? 'Staff price: free −' : 'Staff price −') + rupee(it.staff_discount) });
    if (Number(it.line_discount) - (Number(it.staff_discount) || 0) > 0.001) rows.push({ t: 'sub', text: 'Discount on this item −' + rupee(Math.round((Number(it.line_discount) - (Number(it.staff_discount) || 0)) * 100) / 100) });
    if (it.staff_name) rows.push({ t: 'sub', text: 'by ' + it.staff_name });
  }
  HR();
  LR('Subtotal', rupee(bill.subtotal));
  for (const [name, amt] of offerLines(items)) LR('Offer: ' + name, '−' + rupee(amt));
  if (staffPriceTotal(items) > 0) LR('Staff price', '−' + rupee(staffPriceTotal(items)));
  if (manualDiscount(bill, items) > 0) LR('Discount', '−' + rupee(manualDiscount(bill, items)));
  if (gstOn) {
    LR('Taxable value', rupee(bill.taxable, { paise: true }));
    for (const v of gstByRate(items)) {
      LR(`CGST @${v.rate / 2}%`, rupee(v.cgst, { paise: true }));
      LR(`SGST @${v.rate / 2}%`, rupee(v.sgst, { paise: true }));
    }
  }
  if (Number(bill.round_off) !== 0) LR('Round off', rupee(bill.round_off, { paise: true }));
  LR('TOTAL', rupee(bill.total), { bold: true, big: true });
  const pts = Number(bill.paid_points) || 0;
  if (pts > 0) {
    LR('Paid with points', '−' + rupee(pts));
    LR('Paid', rupee(round2(Number(bill.total) - pts)), { bold: true });
  }
  LR('Paid by', payText(bill));
  // Loyalty points
  const rules = loyaltyRules(s);
  const p = pointsSummary(bill, rules);
  if (p && !cancelled && (p.earned || p.balance != null)) {
    HR();
    C('LOYALTY POINTS', { bold: true });
    if (p.earned > 0) LR('Earned on this bill', '+' + p.earned);
    if (p.pending && p.earned > 0) C('Added when this bill uploads');
    if (p.balance != null) LR('Your balance', p.balance + ' points');
    if (p.balance != null && p.usable) C(`= ₹${p.balance} off your next visit (up to ${p.maxPct}% of a bill)`);
    if (p.balance != null && !p.usable && p.balance > 0) C(`Use them from ${p.minUse} points · 1 point = ₹1`);
    if (p.validTill) C('Valid till ' + p.validTill);
  }
  HR();
  if (gstOn) C(`SAC 9997 · Prices ${gstIncluded(bill) ? 'include' : 'exclude'} GST`);
  C(s.bill_footer);
  if (s.instagram) C('Instagram ' + s.instagram);
  return rows;
}

// The short message that goes with the picture on WhatsApp (and opens the chat)
export function billChatText(bill, settings) {
  const s = settings || {};
  const first = bill.customer_name ? bill.customer_name.trim().split(/\s+/)[0] : '';
  const salon = s.salon_name || 'Habibs Hair & Beauty';
  const rules = loyaltyRules(s);
  const p = pointsSummary(bill, rules);
  const parts = [`${first ? `Hi ${first}, thank you` : 'Thank you'} for visiting ${salon}${s.branch ? ' ' + String(s.branch).split(',')[0] : ''} today.`];
  parts.push(`Your bill ${bill.bill_no}: ${rupee(bill.total)}${Number(bill.paid_points) > 0 ? ` (${rupee(bill.paid_points)} paid with points)` : ''}.`);
  if (p && bill.status !== 'cancelled') {
    if (p.earned > 0) parts.push(`You earned ${p.earned} loyalty points${p.balance != null ? `, balance ${p.balance}${p.usable ? ` = ₹${p.balance} off your next visit` : ''}` : ''}.`);
    else if (p.balance > 0) parts.push(`Your loyalty points: ${p.balance}${p.usable ? ` = ₹${p.balance} off your next visit` : ''}.`);
  }
  parts.push('The bill is in the picture below.');
  return parts.join(' ');
}
