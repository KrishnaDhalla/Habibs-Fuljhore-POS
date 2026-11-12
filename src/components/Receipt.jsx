import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { rupee, fmtDateTime, fmtPhone, round2 } from '../lib/format';
import { textReceipt, rawbtUrl } from '../lib/textReceipt';
import { gstByRate, gstIncluded } from '../lib/calc';
import { loyaltyRules, pointsSummary, pointsWhatsApp } from '../lib/loyalty';
import { offerLines, manualDiscount, payText, staffPriceTotal, dueLeft } from '../lib/receiptRows';

export { offerLines, manualDiscount, payText };

// How this device prints bills: 'browser' (print window, for a laptop with a USB printer)
// or 'rawbt' (one tap, for an Android tablet with the RawBT app and a Bluetooth/USB thermal printer)
export const getPrintMethod = () => {
  try { return localStorage.getItem('pos-print-method') || 'browser'; } catch { return 'browser'; }
};
export const setPrintMethod = (m) => {
  try { localStorage.setItem('pos-print-method', m); } catch { /* ignore */ }
};

// The printed bill. 80 mm thermal by default (58 mm option in Settings).
export function Receipt({ bill, items, settings }) {
  const s = settings || {};
  const gstOn = Number(bill.cgst) + Number(bill.sgst) > 0;
  const rates = gstByRate(items);
  const cancelled = bill.status === 'cancelled';
  return (
    <div className={'receipt' + (Number(s.receipt_width) === 58 ? ' w58' : '')}>
      <div className="c b big">{s.salon_name || 'Habibs Hair & Beauty'}</div>
      {s.branch && <div className="c">{s.branch}</div>}
      {s.address && <div className="c">{s.address}</div>}
      {s.phone && <div className="c">Ph: {s.phone}</div>}
      {s.gstin && <div className="c">GSTIN: {s.gstin}</div>}
      <hr />
      <div className="c b">{cancelled ? '*** CANCELLED ***' : gstOn ? 'TAX INVOICE' : 'BILL'}</div>
      <div className="r2"><span>Bill No: {bill.bill_no}</span></div>
      <div className="r2"><span>Date: {fmtDateTime(bill.created_at)}</span></div>
      {(bill.customer_name || bill.customer_phone) && (
        <div className="r2"><span>Customer: {bill.customer_name || ''} {bill.customer_phone ? fmtPhone(bill.customer_phone) : ''}</span></div>
      )}
      <hr />
      {items.map((it) => (
        <div key={it.id || it.name + it.unit_price}>
          <div className="r2">
            <span>{it.name}{Number(it.qty) !== 1 ? ` x${Number(it.qty)}` : ''}</span>
            <span>{rupee(it.amount)}</span>
          </div>
          {Number(it.staff_discount) > 0 && <div className="sub">Staff price{Number(it.staff_discount) >= Number(it.amount) ? ': free' : ''} −{rupee(it.staff_discount)}</div>}
          {Number(it.line_discount) - (Number(it.staff_discount) || 0) > 0.001 && <div className="sub">Discount on this item −{rupee(Math.round((Number(it.line_discount) - (Number(it.staff_discount) || 0)) * 100) / 100)}</div>}
          {it.staff_name && <div className="sub">by {it.staff_name}</div>}
        </div>
      ))}
      <hr />
      <div className="r2"><span>Subtotal</span><span>{rupee(bill.subtotal)}</span></div>
      {offerLines(items).map(([name, amt]) => (
        <div className="r2" key={name}><span>Offer: {name}</span><span>−{rupee(amt)}</span></div>
      ))}
      {staffPriceTotal(items) > 0 && <div className="r2"><span>Staff price</span><span>−{rupee(staffPriceTotal(items))}</span></div>}
      {manualDiscount(bill, items) > 0 && <div className="r2"><span>Discount</span><span>−{rupee(manualDiscount(bill, items))}</span></div>}
      {gstOn && (
        <>
          <div className="r2"><span>Taxable value</span><span>{rupee(bill.taxable, { paise: true })}</span></div>
          {rates.map((v) => (
            <div key={v.rate}>
              <div className="r2"><span>CGST @{v.rate / 2}%</span><span>{rupee(v.cgst, { paise: true })}</span></div>
              <div className="r2"><span>SGST @{v.rate / 2}%</span><span>{rupee(v.sgst, { paise: true })}</span></div>
            </div>
          ))}
        </>
      )}
      {Number(bill.round_off) !== 0 && <div className="r2"><span>Round off</span><span>{rupee(bill.round_off, { paise: true })}</span></div>}
      <div className="r2 b big"><span>TOTAL</span><span>{rupee(bill.total)}</span></div>
      {Number(bill.paid_points) > 0 && <div className="r2"><span>Paid with points</span><span>−{rupee(bill.paid_points)}</span></div>}
      {Number(bill.paid_points) > 0 && <div className="r2 b"><span>Paid</span><span>{rupee(round2(Number(bill.total) - Number(bill.paid_points)))}</span></div>}
      <div className="r2"><span>Paid by</span><span>{payText(bill)}</span></div>
      {Number(bill.paid_due) > 0 && bill.status !== 'cancelled' && (
        <>
          <div className="r2"><span>Paid now</span><span>{rupee(round2(Number(bill.total) - (Number(bill.paid_points) || 0) - Number(bill.paid_due)))}</span></div>
          <div className="r2 b"><span>DUE (to pay later)</span><span>{rupee(bill.paid_due)}</span></div>
          {Number(bill.due_cleared) > 0 && <div className="r2"><span>{dueLeft(bill) > 0 ? 'Due paid since' : 'Due paid in full'}</span><span>{rupee(bill.due_cleared)}</span></div>}
        </>
      )}
      <PointsBox bill={bill} settings={s} />
      <hr />
      {gstOn && <div className="c">SAC 9997 · Prices {gstIncluded(bill) ? 'include' : 'exclude'} GST</div>}
      {s.bill_footer && <div className="c">{s.bill_footer}</div>}
      {s.instagram && <div className="c">Instagram {s.instagram}</div>}
    </div>
  );
}

// Loyalty points on the receipt: earned on this bill, the balance and until when it is valid
function PointsBox({ bill, settings }) {
  const rules = loyaltyRules(settings);
  const p = pointsSummary(bill, rules);
  if (!p || bill.status === 'cancelled' || (!p.earned && p.balance == null)) return null;
  return (
    <>
      <hr />
      <div className="c b">LOYALTY POINTS</div>
      {p.earned > 0 && <div className="r2"><span>Earned on this bill</span><span>+{p.earned}</span></div>}
      {p.pending && p.earned > 0 && <div className="c">Added when this bill uploads</div>}
      {p.balance != null && <div className="r2"><span>Your balance</span><span>{p.balance} points</span></div>}
      {p.balance != null && p.usable && <div className="c">= ₹{p.balance} off your next visit (up to {p.maxPct}% of a bill)</div>}
      {p.balance != null && !p.usable && p.balance > 0 && <div className="c">Use them from {p.minUse} points · 1 point = ₹1</div>}
      {p.validTill && <div className="c">Valid till {p.validTill}</div>}
    </>
  );
}

// Print just the receipt (or any node) using the browser print dialog
export function printNode(node) {
  let host = document.getElementById('print-root');
  if (!host) {
    host = document.createElement('div');
    host.id = 'print-root';
    document.body.appendChild(host);
  }
  const root = createRoot(host);
  flushSync(() => root.render(node));
  setTimeout(() => {
    window.print();
    setTimeout(() => root.unmount(), 500);
  }, 50);
}

export function printBill(bill, items, settings) {
  if (getPrintMethod() === 'rawbt') {
    window.location.href = rawbtUrl(textReceipt(bill, items, settings));
    return;
  }
  printNode(<Receipt bill={bill} items={items} settings={settings} />);
}

// WhatsApp uses a proportional font, so amounts can't be lined up in columns.
// Each line reads on its own instead: "• Service – ₹amount".
export function billWhatsAppText(bill, items, settings) {
  const s = settings || {};
  const first = bill.customer_name ? bill.customer_name.trim().split(/\s+/)[0] : '';
  const gst = Number(bill.cgst) + Number(bill.sgst);
  const lines = [
    `*${s.salon_name || 'Habibs Hair & Beauty'}*${s.branch ? '\n' + s.branch : ''}`,
    '',
    first ? `Hi ${first}, thank you for visiting us today.` : 'Thank you for visiting us today.',
    '',
    `*Bill ${bill.bill_no}*`,
    fmtDateTime(bill.created_at),
    '',
    ...items.map((it) => `• ${it.name}${Number(it.qty) !== 1 ? ' × ' + Number(it.qty) : ''} – ${rupee(it.amount)}${Number(it.staff_discount) > 0 ? ` (−${rupee(it.staff_discount)} staff price)` : Number(it.line_discount) > 0 ? ` (−${rupee(it.line_discount)} discount)` : ''}`),
    '',
  ];
  if (Number(bill.discount) > 0) {
    lines.push(`Subtotal: ${rupee(bill.subtotal)}`);
    for (const [name, amt] of offerLines(items)) lines.push(`${name}: −${rupee(amt)}`);
    if (staffPriceTotal(items) > 0) lines.push(`Staff price: −${rupee(staffPriceTotal(items))}`);
    if (manualDiscount(bill, items) > 0) lines.push(`Discount: −${rupee(manualDiscount(bill, items))}`);
  }
  if (gst > 0) lines.push(`${gstIncluded(bill) ? 'GST included' : 'GST'}: ${rupee(gst, { paise: true })}`);
  lines.push(`*Total${Number(bill.paid_points) > 0 ? '' : ' paid'}: ${rupee(bill.total)}*`);
  if (Number(bill.paid_points) > 0) lines.push(`Paid with points: −${rupee(bill.paid_points)}`, `*Paid: ${rupee(round2(Number(bill.total) - Number(bill.paid_points)))}*`);
  lines.push(`Paid by ${payText(bill)}`);
  if (Number(bill.paid_due) > 0 && bill.status !== 'cancelled') lines.push(`*Due (to pay later): ${rupee(bill.paid_due)}*`);
  const pts = pointsWhatsApp(bill, loyaltyRules(s));
  if (pts.length) lines.push('', ...pts);
  const tail = [s.instagram ? `Instagram: ${s.instagram}` : '', s.phone ? `Call / WhatsApp: ${s.phone}` : ''].filter(Boolean);
  if (tail.length) lines.push('', ...tail);
  return lines.join('\n');
}

export function waUrl(phone, text) {
  return `https://wa.me/${phone ? '91' + phone : ''}?text=${encodeURIComponent(text)}`;
}
