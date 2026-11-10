// Plain-text receipt for thermal printers driven by the RawBT app on Android tablets.
// 48 characters per line on 80 mm paper, 32 on 58 mm. ASCII only ("Rs." instead of the rupee sign),
// because most thermal printers can't print ₹.
import { fmtDateTime, fmtPhone, round2 } from './format';
import { gstByRate, gstIncluded } from './calc';
import { loyaltyRules, pointsSummary } from './loyalty';

const money = (n) => {
  const v = Number(n) || 0;
  const hasPaise = Math.abs(v % 1) > 0.001;
  return (v < 0 ? '-' : '') + 'Rs.' + Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: hasPaise ? 2 : 0, maximumFractionDigits: 2 });
};
const ascii = (s) => String(s ?? '').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7E]/g, '');

function wrap(text, w) {
  const words = ascii(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const word of words) {
    if (!cur) cur = word.slice(0, w);
    else if ((cur + ' ' + word).length <= w) cur += ' ' + word;
    else { lines.push(cur); cur = word.slice(0, w); }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}
const center = (text, w) => wrap(text, w).map((l) => ' '.repeat(Math.max(0, Math.floor((w - l.length) / 2))) + l);
function lr(left, right, w) {
  const r = ascii(right);
  // Right side too long to share the line: put it on its own line, right-aligned
  if (r.length + 9 > w) return [...wrap(left, w), ...wrap(r, w).map((l) => ' '.repeat(Math.max(0, w - l.length)) + l)];
  const lines = wrap(left, Math.max(8, w - r.length - 1));
  const last = lines.pop();
  return [...lines, last + ' '.repeat(Math.max(1, w - last.length - r.length)) + r];
}

export function textReceipt(bill, items, settings = {}) {
  const w = Number(settings.receipt_width) === 58 ? 32 : 48;
  const hr = '-'.repeat(w);
  const out = [];
  const add = (x) => out.push(...(Array.isArray(x) ? x : [x]));
  const gstOn = Number(bill.cgst) + Number(bill.sgst) > 0;

  add(center((settings.salon_name || 'Habibs Hair & Beauty').toUpperCase(), w));
  if (settings.branch) add(center(settings.branch, w));
  if (settings.address) add(center(settings.address, w));
  if (settings.phone) add(center('Ph: ' + settings.phone, w));
  if (settings.gstin) add(center('GSTIN: ' + settings.gstin, w));
  add(hr);
  add(center(bill.status === 'cancelled' ? '*** CANCELLED ***' : gstOn ? 'TAX INVOICE' : 'BILL', w));
  add('Bill No: ' + bill.bill_no);
  add('Date: ' + ascii(fmtDateTime(bill.created_at)));
  if (bill.customer_name || bill.customer_phone) add(wrap('Customer: ' + [bill.customer_name, fmtPhone(bill.customer_phone)].filter(Boolean).join(' '), w));
  add(hr);
  for (const it of items) {
    add(lr(it.name + (Number(it.qty) !== 1 ? ' x' + Number(it.qty) : ''), money(it.amount), w));
    if (Number(it.staff_discount) > 0) add('  Staff price' + (Number(it.staff_discount) >= Number(it.amount) ? ': free' : '') + ' -' + money(it.staff_discount));
    if (Number(it.line_discount) - (Number(it.staff_discount) || 0) > 0.001) add('  Discount on this item -' + money(Math.round((Number(it.line_discount) - (Number(it.staff_discount) || 0)) * 100) / 100));
    if (it.staff_name) add('  by ' + ascii(it.staff_name));
  }
  add(hr);
  add(lr('Subtotal', money(bill.subtotal), w));
  const offers = new Map();
  for (const it of items) if (Number(it.offer_discount)) offers.set(it.offer_name || 'Offer', round2((offers.get(it.offer_name || 'Offer') || 0) + Number(it.offer_discount)));
  for (const [name, amt] of offers) add(lr('Offer: ' + name, '-' + money(amt), w));
  const staffP = round2(items.reduce((a, it) => a + (Number(it.staff_discount) || 0), 0));
  const manual = round2((Number(bill.discount) || 0) - (Number(bill.offer_discount) || 0) - staffP);
  if (staffP > 0) add(lr('Staff price', '-' + money(staffP), w));
  if (manual > 0) add(lr('Discount', '-' + money(manual), w));
  if (gstOn) {
    add(lr('Taxable value', money(bill.taxable), w));
    for (const v of gstByRate(items)) {
      add(lr(`CGST @${v.rate / 2}%`, money(v.cgst), w));
      add(lr(`SGST @${v.rate / 2}%`, money(v.sgst), w));
    }
  }
  if (Number(bill.round_off)) add(lr('Round off', money(bill.round_off), w));
  add(lr('TOTAL', money(bill.total), w));
  const pts = Number(bill.paid_points) || 0;
  if (pts > 0) {
    add(lr('Paid with points', '-' + money(pts), w));
    add(lr('PAID', money(round2(Number(bill.total) - pts)), w));
  }
  const paid = bill.pay_mode !== 'Split' && !pts ? bill.pay_mode
    : [['Points', bill.paid_points], ['Cash', bill.paid_cash], ['UPI', bill.paid_upi], ['Card', bill.paid_card]].filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${money(v)}`).join(' + ');
  add(lr('Paid by', paid, w));
  // Loyalty points: earned, balance, valid till
  const lp = pointsSummary(bill, loyaltyRules(settings));
  if (lp && bill.status !== 'cancelled' && (lp.earned || lp.balance != null)) {
    add(hr);
    add(center('LOYALTY POINTS', w));
    if (lp.earned > 0) add(lr('Earned on this bill', '+' + lp.earned, w));
    if (lp.pending && lp.earned > 0) add(center('Added when this bill uploads', w));
    if (lp.balance != null) add(lr('Your balance', lp.balance + ' points', w));
    if (lp.balance != null && lp.usable) add(center(`= Rs.${lp.balance} off your next visit (up to ${lp.maxPct}% of a bill)`, w));
    if (lp.balance != null && !lp.usable && lp.balance > 0) add(center(`Use them from ${lp.minUse} points. 1 point = Rs.1`, w));
    if (lp.validTill) add(center('Valid till ' + lp.validTill, w));
  }
  add(hr);
  if (gstOn) add(center('SAC 9997. Prices ' + (gstIncluded(bill) ? 'include' : 'exclude') + ' GST', w));
  if (settings.bill_footer) add(center(settings.bill_footer, w));
  if (settings.instagram) add(center('Instagram ' + settings.instagram, w));
  add(['', '', '']);
  return out.join('\n');
}

// Opens the RawBT app, which prints the text on the paired thermal printer
export function rawbtUrl(text) {
  return 'intent:' + encodeURIComponent(text) + '#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;';
}
