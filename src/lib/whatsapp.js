// WhatsApp bills through the WhatsApp Business Platform: the bill picture (the same as the printed bill) goes to the
// whatsapp Edge Function, which sends it to the customer with the approved bill template. See README "WhatsApp bills".
import { db } from './db';
import { receiptImage, rowsImage } from './receiptImage';
import { slipRows } from './slipRows';

// Settings → Salon & bill → WhatsApp bills: "Send each bill on WhatsApp by itself"
export const waBillsOn = (settings) => !!settings && settings.wa_bills_on === true;

export function blobToBase64(blob) {
  return new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).replace(/^data:[^,]*,/, ''));
    r.onerror = () => bad(new Error('Could not read the bill picture'));
    r.readAsDataURL(blob);
  });
}

// Sends one bill. Returns { ok, status, error, already }. `again` sends it once more (by hand).
export async function sendBillOnWhatsApp(bill, items, settings, { again = false, send = (b) => db.whatsapp(b) } = {}) {
  const blob = await receiptImage(bill, items, settings);
  const image = await blobToBase64(blob);
  return send({ action: 'bill', id: bill.id, image, again });
}

// Settings → Salon & bill → WhatsApp: "Send the salary slip to the staff member when salary is marked paid"
export const waSlipsOn = (settings) => !settings || settings.wa_slips_on !== false;

// Sends one salary slip (the breakup as a picture) to the staff member's own number. Returns { ok, status, error, setup }.
export async function sendSlipOnWhatsApp(slip, staff, settings, offs, { again = false, send = (b) => db.whatsapp(b) } = {}) {
  const blob = await rowsImage(slipRows(slip, staff, settings, offs));
  const image = await blobToBase64(blob);
  return send({ action: 'slip', id: slip.id, image, again });
}

// How a send went, for the bill screen and the Bills list
export const WA_STATUS = {
  sending: 'Sending on WhatsApp…',
  sent: 'Sent on WhatsApp ✓',
  delivered: 'Delivered on WhatsApp ✓✓',
  read: 'Read on WhatsApp ✓✓',
  failed: 'Not sent on WhatsApp',
};
export const SLIP_STATUS = { sending: 'Sending the slip…', sent: 'Slip sent ✓', delivered: 'Slip delivered ✓✓', read: 'Slip read ✓✓', failed: 'Slip not sent' };
export const WA_SHORT = { sending: 'WA …', sent: 'WA ✓', delivered: 'WA ✓✓', read: 'WA read', failed: 'WA failed' };
