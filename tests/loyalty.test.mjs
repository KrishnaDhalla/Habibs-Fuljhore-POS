// Loyalty points: the rules (src/lib/loyalty.js), the real database (create_bill, cancel_bill, expiry, who may
// change what) and the demo database, which must give every customer the same points as the real one.
//   Earn 5% of what is paid with money for services at their normal price (not offer prices, not products, not
//   staff's own numbers), use from 100 points, at most 20% of a bill, expire 12 months after the last visit.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const L = await import('../src/lib/loyalty.js');
const { calcBill, checkBill } = await import('../src/lib/calc.js');
const { applyOffers } = await import('../src/lib/offers.js');
const { createLocalDb } = await import('../src/lib/localdb.js');
const { toPaise, round2 } = await import('../src/lib/format.js');
const { billWhatsAppText } = await import('../src/components/Receipt.jsx').catch(() => ({}));
const { textReceipt } = await import('../src/lib/textReceipt.js');

let seed = Number(process.env.SEED || 21);
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
let checks = 0;
const fails = {};
const check = (n, c, d = '') => { checks++; if (!c) { fails[n] = fails[n] || { count: 0, first: typeof d === 'function' ? d() : d }; fails[n].count++; } };
const P = toPaise;
const R = L.loyaltyRules({});

// =============== 1. the rules ===============
const svc = (price, more = {}) => ({ item_type: 'service', amount: price, discount: 0, offer_discount: 0, taxable: price, gst: 0, ...more });
const bill = (items, pay = {}) => {
  const total = items.reduce((a, i) => a + Number(i.taxable) + Number(i.gst), 0);
  return { total: Math.round(total), items, paid_cash: Math.round(total), ...pay };
};
const E = (b, o = {}) => L.earnPoints(b, o.rules || R, { phone: '9830000001', ...o });
check('defaults: on, 5%, from 100, up to 20%, 12 months, not products', R.on && R.pct === 5 && R.minUse === 100 && R.maxPct === 20 && R.months === 12 && !R.products);
check('the example: ₹1,000 facial → 50 points', E(bill([svc(1000)])) === 50);
check('rounded down: ₹399 cut → 19', E(bill([svc(399)])) === 19);
check('₹19 eyebrows → 0', E(bill([svc(19)])) === 0);
check('no number → no points', L.earnPoints(bill([svc(1000)]), R, { phone: null }) === 0);
check('an offer price earns nothing', E(bill([svc(800, { offer_discount: 200, discount: 200, taxable: 800 })])) === 0);
check('…the other lines still earn', E(bill([svc(800, { offer_discount: 200, discount: 200, taxable: 800 }), svc(600)])) === 30);
check('a counter discount earns on what is paid', E(bill([svc(900, { discount: 100, taxable: 900 })])) === 45);
check('products earn nothing (unless switched on)', E(bill([{ ...svc(500), item_type: 'product' }])) === 0
  && E(bill([{ ...svc(500), item_type: 'product' }]), { rules: { ...R, products: true } }) === 25);
check('GST included in what is paid: ₹952.38 + ₹47.62 GST → 50', E(bill([svc(0, { taxable: 952.38, gst: 47.62 })])) === 50);
check('paid partly with points: ₹1,000 bill, ₹200 points → earns on ₹800 = 40', E({ ...bill([svc(1000)]), paid_cash: 800, paid_points: 200 }) === 40);
check('split cash + UPI + card all earn', E({ ...bill([svc(1000)]), paid_cash: 300, paid_upi: 500, paid_card: 200 }) === 50);
check('a prepaid card (not in the app yet) would earn nothing: only cash, UPI and card count', E({ ...bill([svc(1000)]), paid_cash: 0, paid_prepaid: 1000 }) === 0);
check('staff numbers earn nothing', L.earnPoints(bill([svc(1000)]), R, { phone: '9800000009', staff: [{ active: true, phone: '+91 98000 00009' }] }) === 0
  && L.earnPoints(bill([svc(1000)]), R, { phone: '9800000009', staff: [{ active: false, phone: '9800000009' }] }) === 50);
check('switched off → nothing', E(bill([svc(1000)]), { rules: { ...R, on: false } }) === 0);
check('7% in Settings → 70', E(bill([svc(1000)]), { rules: { ...R, pct: 7 } }) === 70);
check('2.5% → 25', E(bill([svc(1000)]), { rules: { ...R, pct: 2.5 } }) === 25);
check('a big bridal bill: ₹99,999 → 4,999 (no overflow)', E(bill([svc(99999)])) === 4999);
check('use: below 100 points → none', L.maxPointsUse(99, 5000, R) === 0);
check('use: 100 points, ₹300 bill → 60 (20%)', L.maxPointsUse(100, 300, R) === 60);
check('use: 150 points, ₹1,000 bill → 150', L.maxPointsUse(150, 1000, R) === 150);
check('use: 500 points, ₹1,000 bill → 200', L.maxPointsUse(500, 1000, R) === 200);
check('use: ₹999 bill → 199 (rounded down)', L.maxPointsUse(500, 999, R) === 199);
check('use: switched off → none', L.maxPointsUse(500, 1000, { ...R, on: false }) === 0);
check('expiry: 12 months after the last visit', L.expiresAt('2026-11-07T06:00:00.000Z', R) === '2027-11-07T06:00:00.000Z');
check('expiry from 29 Feb: 28 Feb next year', L.expiresAt('2028-02-29T06:00:00.000Z', R).startsWith('2029-02-28'));
check('balance shown as 0 once expired', L.liveBalance({ points: 150, last_visit: '2025-10-01T00:00:00Z' }, R, new Date('2026-11-07')) === 0
  && L.liveBalance({ points: 150, last_visit: '2026-01-01T00:00:00Z' }, R, new Date('2026-11-07')) === 150);
{
  const b = { bill_no: 'HF2627-0101', created_at: '2026-11-07T06:00:00Z', customer_phone: '9830000001', customer_name: 'Riya Sen', status: 'paid', total: 1000, paid_points: 150, paid_cash: 850,
    pay_mode: 'Cash', subtotal: 1000, discount: 0, taxable: 1000, cgst: 0, sgst: 0, round_off: 0, points_earned: 42, points_balance: 12 };
  const lines = L.pointsWhatsApp(b, R).join('\n');
  check('WhatsApp: points earned, used, balance, from 100', /You earned \*42 points\*/.test(lines) && /Paid with 150 points \(₹150\)/.test(lines) && /Your balance: 12 points\. Use them from 100 points/.test(lines), lines);
  const lines2 = L.pointsWhatsApp({ ...b, points_balance: 240, paid_points: 0 }, R).join('\n');
  check('WhatsApp: a usable balance says ₹ off and valid till', /\*240 points = ₹240 off\* your next visit \(up to 20% of a bill\)/.test(lines2) && /valid till 07 Nov 2027/.test(lines2), lines2);
  check('WhatsApp: nothing on a cancelled bill', L.pointsWhatsApp({ ...b, status: 'cancelled' }, R).length === 0);
  check('WhatsApp: a bill saved offline says the points come when it uploads', /added when the bill uploads/.test(L.pointsWhatsApp({ ...b, _pending: true, _points_preview: 30, points_balance: null }, R).join(' ')));
  const t = textReceipt(b, [{ name: 'Facial', qty: 1, amount: 1000 }], {});
  check('printed (tablet) receipt: paid with points, paid, points box', /Paid with points\s+-Rs\.150/.test(t) && /PAID\s+Rs\.850/.test(t) && /Paid by\s+Points Rs\.150 \+ Cash Rs\.850/.test(t) && /Earned on this bill\s+\+42/.test(t) && /Your balance\s+12 points/.test(t), t);
  if (billWhatsAppText) {
    const w = billWhatsAppText(b, [{ name: 'Facial', qty: 1, amount: 1000 }], {});
    check('WhatsApp bill: total, points paid, paid, points earned', /\*Total: ₹1,000\*/.test(w) && /Paid with points: −₹150/.test(w) && /\*Paid: ₹850\*/.test(w) && /You earned \*42 points\*/.test(w), w);
  }
}

// the WhatsApp picture is drawn from receiptRows(): the same lines as the printed bill
{
  const { receiptRows, billChatText } = await import('../src/lib/receiptRows.js');
  const settings = { salon_name: 'Habibs Hair & Beauty', branch: 'Fuljhore, Durgapur', phone: '+91 89275 63835', bill_footer: 'Thank you!', instagram: '@habibsfuljhore', gstin: '19ABCDE1234F1Z5' };
  const items = [
    { name: 'Fruit Facial', qty: 1, amount: 2500, staff_name: 'Amit Das', offer_discount: 0, discount: 0, taxable: 2380.95, gst: 119.05, gst_pct: 5 },
    { name: 'Hair Spa', qty: 1, amount: 1000, staff_name: 'Rahul Roy', offer_name: 'Pujo 20%', offer_discount: 200, discount: 200, taxable: 761.9, gst: 38.1, gst_pct: 5 },
  ];
  const b = { bill_no: 'HF2627-0042', created_at: '2026-11-06T19:34:00Z', customer_name: 'Arijit Pal', customer_phone: '9830031676', status: 'paid', subtotal: 3500, offer_discount: 200, discount: 200,
    taxable: 3142.85, cgst: 78.58, sgst: 78.57, round_off: 0, total: 3300, pay_mode: 'Cash', paid_cash: 3200, paid_points: 100, points_earned: 120, points_balance: 270 };
  const rows = receiptRows(b, items, settings);
  const all = rows.map((r) => [r.text, r.right].filter(Boolean).join(' ')).join('\n');
  const t = textReceipt(b, items, settings);
  for (const [label, re] of [['salon, branch, GSTIN', /Habibs Hair & Beauty[\s\S]*Fuljhore, Durgapur[\s\S]*GSTIN: 19ABCDE1234F1Z5/], ['tax invoice, bill no, customer', /TAX INVOICE[\s\S]*Bill No: HF2627-0042[\s\S]*Customer: Arijit Pal 98300 31676/],
    ['items and who did them', /Fruit Facial ₹2,500\nby Amit Das\nHair Spa ₹1,000\nby Rahul Roy/], ['offer', /Offer: Pujo 20% −₹200/], ['GST halves', /Taxable value ₹3,142\.85[\s\S]*CGST @2\.5% ₹78\.58[\s\S]*SGST @2\.5% ₹78\.57/],
    ['total, points paid, paid, paid by', /TOTAL ₹3,300\nPaid with points −₹100\nPaid ₹3,200\nPaid by Points ₹100 \+ Cash ₹3,200/], ['loyalty points', /LOYALTY POINTS\nEarned on this bill \+120\nYour balance 270 points\n= ₹270 off your next visit \(up to 20% of a bill\)\nValid till 07 Nov 2027/],
    ['footer', /SAC 9997 · Prices include GST\nThank you!\nInstagram @habibsfuljhore/]]) check('bill picture: ' + label, re.test(all), all);
  check('bill picture and the tablet receipt say the same figures', ['2,500', '1,000', '200', '3,142.85', '78.58', '78.57', '3,300', '3,200', '+120', '270 points'].every((x) => all.includes(x) && t.includes(x.replace('₹', ''))), t);
  check('a cancelled bill: CANCELLED, no points box', /\*\*\* CANCELLED \*\*\*/.test(receiptRows({ ...b, status: 'cancelled' }, items, settings).map((r) => r.text).join(' ')) && !receiptRows({ ...b, status: 'cancelled' }, items, settings).some((r) => r.text === 'LOYALTY POINTS'));
  // a discount on one line: under that line on the picture, the printed bill and the tablet's text bill
  const li = [{ ...items[0], line_discount: 250, discount: 250, taxable: 2142.86, gst: 107.14 }, items[1]];
  const lb = { ...b, discount: 450, taxable: 2904.76, cgst: 72.62, sgst: 72.62, total: 3050, paid_cash: 2950 };
  const lrows = receiptRows(lb, li, settings).map((r) => [r.text, r.right].filter(Boolean).join(' ')).join('\n');
  check('line discount: under its line, then the total discount', /Fruit Facial ₹2,500\nDiscount on this item −₹250\nby Amit Das/.test(lrows) && /Discount −₹250/.test(lrows) && /Offer: Pujo 20% −₹200/.test(lrows), lrows);
  check('line discount: the tablet\'s text bill too', /Discount on this item -Rs\.250/.test(textReceipt(lb, li, settings)), textReceipt(lb, li, settings));
  // a staff member's own services: "Staff price: free" / "Staff price −₹X" under the line, not "Discount on this item"
  const si = [{ ...items[0], line_discount: 1250, staff_discount: 1250, discount: 1250 }, { ...items[1], line_discount: 1000, staff_discount: 1000, discount: 1000, amount: 1000 }];
  const srows = receiptRows(lb, si, settings).map((r) => [r.text, r.right].filter(Boolean).join(' ')).join('\n');
  check('staff price: under its line (50% off), and "free"', /Fruit Facial ₹2,500\nStaff price −₹1,250\nby Amit Das/.test(srows) && /Hair Spa ₹1,000\nStaff price: free −₹1,000/.test(srows) && !/Discount on this item/.test(srows), srows);
  {
    const sb = { ...lb, for_staff: 'staff-1', paid_points: 0, paid_cash: lb.total, points_earned: 0, points_balance: 0 };
    const r = receiptRows(sb, si, settings).map((x) => [x.text, x.right].filter(Boolean).join(' ')).join('\n');
    check('a staff bill: "Staff price −₹2,250" in the totals, no loyalty points box', /\nStaff price −₹2,250\n/.test(r) && !/LOYALTY POINTS/.test(r) && !/LOYALTY POINTS/.test(textReceipt(sb, si, settings)), r);
  }
  check('staff price: the tablet\'s text bill too', /Staff price -Rs\.1,?250/.test(textReceipt(lb, si, settings)) && /Staff price: free -Rs\.1,?000/.test(textReceipt(lb, si, settings)), textReceipt(lb, si, settings));
  const chat = billChatText(b, settings);
  check('the chat message: thank you, bill, total, points paid, points earned and balance', chat === 'Hi Arijit, thank you for visiting Habibs Hair & Beauty Fuljhore today. Your bill HF2627-0042: ₹3,300 (₹100 paid with points). You earned 120 loyalty points, balance 270 = ₹270 off your next visit. The bill is in the picture below.', chat);
}

// =============== 2. the real database and the demo database ===============
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on all functions in schema auth to authenticated, anon;`);
const schema = readFileSync('supabase/01_schema.sql', 'utf8');
await db.exec(schema);
await db.exec(readFileSync('supabase/02_seed_services.sql', 'utf8'));
await db.exec(`grant usage on schema public to authenticated, anon; grant all on all tables in schema public to authenticated, anon;`);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const tryq = async (sql, p) => { try { return await q(sql, p); } catch (e) { return { error: e.message }; } };
const owner = randomUUID(), clerk = randomUUID(), sOwner = randomUUID(), sClerk = randomUUID(), sPending = randomUUID();
await q(`insert into app_roles values ($1, 'owner', 'Krishna')`, [owner]);
await q(`insert into login_requests (session_id, user_id, email, status) values ($1, $2, 'counter@x', 'approved'), ($3, $2, 'counter@x', 'pending')`, [sClerk, clerk, sPending]);
async function as(user, session, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user, session_id: session, role: 'authenticated', email: user === owner ? 'owner@x' : 'counter@x' })]);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
const O = (sql, p) => as(owner, sOwner, () => tryq(sql, p));
const err = (r) => (r && r.error) || '';
await q(`update settings set value = '100' where key = 'max_discount_pct'`);

const services = (await q(`select * from services where active order by sort`)).map((s) => ({ ...s, price: Number(s.price), gst_pct: Number(s.gst_pct) }));
const staff = [
  { id: randomUUID(), name: 'Amit Das', phone: '9800000001' },
  { id: randomUUID(), name: 'Sneha Paul', phone: '+91 98000 00009' },
];
const products = [{ id: randomUUID(), name: 'Shampoo 250 ml', sell_price: 450, gst_pct: 18 }];
const offer = { id: randomUUID(), name: 'Hair 20%', active: true, applies_to: 'section', sections: ['Hair'], kind: 'percent', value: 20, min_bill: 0 };
for (const s of staff) await q(`insert into staff (id, name, phone) values ($1, $2, $3)`, [s.id, s.name, s.phone]);
for (const p of products) { await q(`insert into products (id, name, sell_price, gst_pct) values ($1,$2,$3,$4)`, [p.id, p.name, p.sell_price, p.gst_pct]); await q(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 5000)`, [p.id]); }
await q(`insert into offers (id, name, active, applies_to, sections, kind, value, min_bill) values ($1, $2, true, 'section', $3, 'percent', 20, 0)`, [offer.id, offer.name, offer.sections]);

const TT = ['settings', 'services', 'customers', 'staff', 'products', 'stock_moves', 'bills', 'bill_items', 'counters', 'offers', 'loyalty_points'];
localStorage.setItem('habibs-pos-demo-v1', JSON.stringify({ version: 7, ...Object.fromEntries(TT.map((t) => [t, []])), settings: [{ key: 'bill_prefix', value: 'HF' }, { key: 'max_discount_pct', value: 100 }] }));
const ldb = createLocalDb();
for (const s of services) await ldb.insert('services', s);
for (const s of staff) await ldb.insert('staff', { ...s, active: true });
for (const p of products) { await ldb.insert('products', { ...p }); await ldb.insert('stock_moves', { product_id: p.id, type: 'in', qty: 5000 }); }
await ldb.insert('offers', offer);
const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
const NOW = { day: '2026-10-20', time: '12:00', dow: 2 };

function makeBill(phone, { offers = rnd() < 0.3, products: withProd = rnd() < 0.15 } = {}) {
  const lines = [];
  for (let k = ri(1, 3); k > 0; k--) {
    const s = pick(services);
    const price = s.variants ? Number(pick(s.variants).price) : s.price || ri(300, 3000);
    lines.push({ item_type: 'service', service_id: s.id, name: s.name, category: s.category, staff_id: staff[0].id, qty: 1, unit_price: price, gst_pct: s.gst_pct });
  }
  if (withProd) lines.push({ item_type: 'product', product_id: products[0].id, name: products[0].name, category: 'Products', staff_id: staff[0].id, qty: 1, unit_price: 450, gst_pct: 18 });
  const r = applyOffers(lines, offers ? [offer] : [], { now: NOW, servicesById: svcById, isNew: false });
  const disc = rnd() < 0.2 ? { discountType: 'pct', discountValue: pick([5, 10]) } : {};
  const b = calcBill(r.lines, { ...disc, gstOn: rnd() < 0.5, inclusive: rnd() < 0.7 });
  return {
    id: randomUUID(), customer_phone: phone, customer_name: phone ? 'Cust ' + phone.slice(-4) : '',
    subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, note: '',
    items: b.items.map((l) => ({ item_type: l.item_type, service_id: l.service_id || '', product_id: l.product_id || '', name: l.name, category: l.category, hsn_sac: '', staff_id: l.staff_id, staff_name: 'Amit Das', qty: l.qty, unit_price: l.unit_price, amount: l.amount, offer_id: l.offer_id || '', offer_name: l.offer_name || '', offer_discount: l.offer_discount || 0, discount: l.discount, taxable: l.taxable, gst_pct: l.gst_pct, gst: l.gst })),
  };
}
function pay(b, points) {
  const rest = round2(b.total - points);
  const mode = pick(['Cash', 'UPI', 'Card', 'Split']);
  const c = mode === 'Split' ? round2(Math.floor(rnd() * P(rest)) / 100) : 0;
  const m = mode === 'Split' ? { paid_cash: c, paid_upi: round2(rest - c), paid_card: 0 } : { paid_cash: mode === 'Cash' ? rest : 0, paid_upi: mode === 'UPI' ? rest : 0, paid_card: mode === 'Card' ? rest : 0 };
  return { ...b, pay_mode: mode, ...m, paid_points: points };
}
const both = async (p, who = [clerk, sClerk]) => {
  const a = await as(who[0], who[1], () => tryq(`select * from create_bill($1)`, [JSON.stringify(p)]));
  let l;
  try { l = await ldb.rpc('create_bill', { p }); } catch (e) { l = { error: e.message }; }
  return [a.error ? a : a[0], l];
};

// --- a random year and a bit of bills, with points used whenever the customer can (and some wrong tries) ---
// Phones A come in the first 30% of the time, phones B in the middle 50% (15 months), then both: A's points expire
const phonesA = Array.from({ length: 15 }, (_, i) => String(9830000100 + i * 7919));
const phonesB = Array.from({ length: 15 }, (_, i) => String(9840000100 + i * 7919));
const phoneFor = (k) => (k < 0.3 ? pick(phonesA) : k < 0.8 ? pick(phonesB) : pick([...phonesA, ...phonesB, '9800000009']));
const model = {}; // phone → { bal, bills: [{ id, at, earned, used, status }] }
const lastVisit = (m) => m.bills.filter((b) => b.status === 'paid').map((b) => b.at).sort().pop() || null;
const NB = Number(process.env.NB || 500);
const SPAN = 900 * 86400e3;
const t0 = Date.now() - SPAN;
let saved = 0, refused = 0, used = 0, expired = 0, mism = 0;
const sentBills = [];
for (let i = 0; i < NB; i++) {
  const k = (i + rnd() * 0.9) / NB;
  const at = new Date(t0 + k * (SPAN - 3600e3)).toISOString();
  const phone = rnd() < 0.9 ? phoneFor(k) : '';
  const m = phone ? (model[phone] = model[phone] || { bal: 0, bills: [], expiries: [] }) : null;
  // the model: expire after 12 months without a visit
  if (m && m.bal > 0) {
    const lv = lastVisit(m);
    if (lv && L.expiresAt(lv, R) <= at) { m.bal = 0; m.expiries.push(L.expiresAt(lv, R)); expired++; }
  }
  const b0 = { ...makeBill(phone), created_at: at };
  const can = m ? L.maxPointsUse(m.bal, b0.total, R) : 0;
  let want = 0;
  const r = rnd();
  if (can > 0 && r < 0.6) want = r < 0.4 ? can : ri(1, can);
  else if (r < 0.66 && m) want = can + 1 + ri(0, 3); // too many (or below 100): refused
  else if (r < 0.68 && !m) want = 50; // no number: refused
  if (want > b0.total) want = Math.floor(b0.total);
  const p = pay(b0, want);
  check('app bill passes the JS check', checkBill(p).length === 0, () => checkBill(p).join('; '));
  const [a, l] = await both(p);
  const valid = want === 0 || (m && m.bal >= 100 && want <= m.bal && want <= Math.floor((b0.total * 20) / 100 + 1e-9));
  check('database: refused exactly when the points break a rule', !!a.error === !valid, () => JSON.stringify({ want, bal: m && m.bal, total: b0.total, err: a.error }));
  check('demo: the same answer', !!l.error === !!a.error && (!a.error || l.error === a.error.replace(/^.*?Points:/, 'Points:')), () => JSON.stringify([a.error, l.error]));
  if (a.error) { refused++; continue; }
  saved++;
  const earn = L.earnPoints(p, R, { phone: phone || null, staff: staff.map((s) => ({ ...s, active: true })) });
  check('database earned = the rule', a.points_earned === earn, () => `${a.points_earned} vs ${earn}`);
  check('demo earned = database', l.points_earned === a.points_earned, () => `${l.points_earned} vs ${a.points_earned}`);
  check('paid with points stored', P(a.paid_points) === P(want) && P(l.paid_points) === P(want));
  if (m) {
    if (want) used++;
    m.bal = m.bal - want + earn;
    m.bills.push({ id: a.id, at, earned: earn, used: want, status: 'paid' });
    check('balance on the bill = the model', a.points_balance === m.bal && l.points_balance === m.bal, () => `${a.points_balance} / ${l.points_balance} vs ${m.bal}`);
    if (phone === '9800000009') check("a staff member's number earns nothing", a.points_earned === 0);
  } else check('no number: no points, no balance', a.points_earned === 0 && a.points_balance == null);
  sentBills.push({ id: a.id, phone, at });
}
// The owner cancels some bills (today): points used come back, earned come off; points from before an expiry stay expired
let cancels = 0, skipped = 0;
for (const x of sentBills.filter(() => rnd() < 0.08).sort(() => rnd() - 0.5)) {
  const mm = x.phone ? model[x.phone] : null;
  const nowIso = new Date().toISOString();
  if (mm) {
    const lv = lastVisit(mm);
    if (mm.bal > 0 && lv && L.expiresAt(lv, R) <= nowIso) { mm.bal = 0; mm.expiries.push(L.expiresAt(lv, R)); }
  }
  const c = await O(`select * from cancel_bill($1, 'test')`, [x.id]);
  let lc;
  try { lc = await ldb.rpc('cancel_bill', { p_id: x.id, p_reason: 'test' }); } catch (e) { lc = { error: e.message }; }
  check('cancel: the same answer in both', !!c.error === !!lc.error && !c.error, () => JSON.stringify([c.error, lc.error]));
  cancels++;
  if (mm) {
    const bb = mm.bills.find((y) => y.id === x.id);
    if (mm.expiries.some((e) => e > bb.at)) skipped++;
    else mm.bal += bb.used - bb.earned;
    bb.status = 'cancelled';
  }
}
check('cancels done, some of them from before an expiry', cancels > 20 && skipped > 0, `${cancels} cancels, ${skipped} before an expiry`);
check('the run used points, refused wrong tries and saw points expire', saved > 300 && refused > 10 && used > 30 && expired > 3, `saved ${saved} refused ${refused} used ${used} expired ${expired}`);
// the model, as of now: 12 months since the last visit → expired
for (const m of Object.values(model)) {
  const lv = lastVisit(m);
  if (m.bal > 0 && lv && L.expiresAt(lv, R) <= new Date().toISOString()) m.bal = 0;
}
const lcust = await ldb.list('customers', {});
for (const c of await q(`select phone, points, last_visit from customers`)) {
  // points of someone who hasn't come for 12 months are gone, even before the daily run writes it down
  const lc = lcust.find((x) => x.phone === c.phone);
  check('demo balance = database', lc && Number(lc.points) === c.points, () => `${c.phone}: ${lc && lc.points} vs ${c.points}`);
  check('the balance the app shows = the model (earned − used ± cancelled − expired)', model[c.phone] && L.liveBalance(c, R) === model[c.phone].bal, () => `${c.phone}: ${L.liveBalance(c, R)} vs ${model[c.phone] && model[c.phone].bal}`);
}
await q(`select expire_points()`);
const cust = await q(`select phone, points from customers`);
for (const c of cust) {
  const mm = model[c.phone];
  check('after the daily run: every balance = the model', mm && c.points === mm.bal, () => `${c.phone}: ${c.points} vs ${mm && mm.bal}`);
  const [s] = await q(`select coalesce(sum(l.points), 0)::int s from loyalty_points l join customers c on c.id = l.customer_id where c.phone = $1`, [c.phone]);
  check('balance = sum of the points rows', s.s === c.points);
}
{
  const kinds = await q(`select kind, count(*)::int n, sum(points)::int s from loyalty_points group by kind order by kind`);
  const lk = {};
  for (const r of await ldb.list('loyalty_points', {})) { lk[r.kind] = lk[r.kind] || { n: 0, s: 0 }; lk[r.kind].n++; lk[r.kind].s += Number(r.points); }
  check('demo and database: the same points rows (earned, used, cancelled; expired once written down)', kinds.filter((k) => k.kind !== 'expire').every((k) => lk[k.kind] && lk[k.kind].n === k.n && lk[k.kind].s === k.s) && Object.keys(lk).filter((k) => k !== 'expire').length === kinds.filter((k) => k.kind !== 'expire').length, () => JSON.stringify([kinds, lk]));
  check('expired rows are dated 12 months after the last visit', (await q(`select count(*)::int n from loyalty_points where kind = 'expire' and note like 'No visit for 12 months'`))[0].n === kinds.find((k) => k.kind === 'expire')?.n);
  const [v] = await q(`select coalesce(sum(points_used), 0) u, coalesce(sum(points_earned), 0) e from v_daily_sales`);
  const [bb] = await q(`select coalesce(sum(paid_points), 0) u, coalesce(sum(points_earned), 0) e from bills where status = 'paid'`);
  check('daily sales view: points used and earned', P(v.u) === P(bb.u) && Number(v.e) === Number(bb.e));
  const [pay3] = await q(`select count(*)::int n from bills where paid_cash + paid_upi + paid_card + paid_points <> total`);
  check('every bill: cash + UPI + card + points = total', pay3.n === 0);
}

// --- hand-picked cases ---
const phoneA = '9831100001';
const S = (price, more) => ({ id: randomUUID(), customer_phone: phoneA, customer_name: 'Riya Sen', subtotal: price, offer_discount: 0, discount: 0, taxable: price, cgst: 0, sgst: 0, round_off: 0, total: price, note: '',
  items: [{ item_type: 'service', service_id: services[0].id, name: services[0].name, category: services[0].category, staff_id: staff[0].id, staff_name: 'Amit Das', qty: 1, unit_price: price, amount: price, offer_discount: 0, discount: 0, taxable: price, gst_pct: 0, gst: 0 }], ...more });
const cash = (p, pts = 0) => ({ ...p, pay_mode: 'Cash', paid_cash: round2(p.total - pts), paid_upi: 0, paid_card: 0, paid_points: pts });
await q(`update services set price = 0 where id = $1`, [services[0].id]); // any price is the menu price from here
const b1 = (await both(cash(S(1000))))[0];
check('₹1,000 → 50 points, balance 50', b1.points_earned === 50 && b1.points_balance === 50);
const b1x = await both(cash(S(1000), 50));
check('50 points: below 100, refused', /Points: points can be used from 100 points \(balance 50\)/.test(err(b1x[0])) && b1x[1].error === b1x[0].error.replace(/^.*?Points:/, 'Points:'), JSON.stringify(b1x));
const b2 = (await both(cash(S(1000))))[0];
check('second ₹1,000 → balance 100', b2.points_balance === 100);
check('more than 20% refused', /at most 20% of a bill \(₹40 here\)/.test(err((await both(cash(S(200), 41)))[0])));
check('more than the balance refused', /only 100 points left/.test(err((await both(cash(S(1000), 101)))[0])));
const b3 = (await both(cash(S(1000), 100)))[0];
check('the example: 100 points off a ₹1,000 bill → pays ₹900, earns 45, balance 45', !b3.error && P(b3.paid_cash) === 90000 && b3.points_earned === 45 && b3.points_balance === 45, JSON.stringify(b3));
const [cA] = await q(`select points from customers where phone = $1`, [phoneA]);
check('customer balance 45', cA.points === 45);
check('points need a number', /need the customer's mobile number/.test(err((await both(cash({ ...S(1000), customer_phone: '', customer_name: '' }, 10)))[0])));
check('points are whole rupees', /whole rupees/i.test(err((await both(cash(S(1000), 10.5)))[0])));
// cancel the bill that used points: the 100 come back, the 45 come off
const cc = await O(`select * from cancel_bill($1, 'wrong service')`, [b3.id]);
await ldb.rpc('cancel_bill', { p_id: b3.id, p_reason: 'wrong service' });
check('cancelled: 100 used come back, 45 earned come off → 100', !cc.error && (await q(`select points from customers where phone = $1`, [phoneA]))[0].points === 100
  && Number((await ldb.list('customers', { eq: { phone: phoneA } }))[0].points) === 100);
// an offline bill using points it didn't have: saved with a CHECK note (it was already printed and paid)
const off = cash({ ...S(1000), bill_no: 'HF2627-A9001', created_at: new Date(Date.now() - 3600e3).toISOString() }, 200);
const [o1, o2] = await both(off);
check('offline bill with too many points: saved, with a CHECK note', !o1.error && /CHECK: 200 points used offline, but only 100 points left/.test(o1.note || '') && !o2.error && /CHECK: 200 points used offline/.test(o2.note || ''), JSON.stringify([o1.note, o2.note]));
check('…and the balance shows what is owed (100 − 200 used + 40 earned on ₹800 = −60)', (await q(`select points from customers where phone = $1`, [phoneA]))[0].points === -60);
// switched off
await q(`update settings set value = 'false' where key = 'loyalty_on'`);
await ldb.upsert('settings', { key: 'loyalty_on', value: false }, 'key');
const offb = await both(cash(S(1000)));
check('switched off: nothing earned', offb[0].points_earned === 0 && offb[1].points_earned === 0);
await q(`update settings set value = 'true' where key = 'loyalty_on'`);
await ldb.upsert('settings', { key: 'loyalty_on', value: true }, 'key');
// 7% and products
await q(`update settings set value = '7' where key = 'loyalty_earn_pct'`);
await q(`update settings set value = 'true' where key = 'loyalty_products'`);
await ldb.upsert('settings', { key: 'loyalty_earn_pct', value: 7 }, 'key');
await ldb.upsert('settings', { key: 'loyalty_products', value: true }, 'key');
const prodBill = { ...S(1000), subtotal: 1450, taxable: 1450, total: 1450, items: [...S(1000).items, { item_type: 'product', product_id: products[0].id, name: products[0].name, category: 'Products', staff_id: staff[0].id, staff_name: 'Amit Das', qty: 1, unit_price: 450, amount: 450, offer_discount: 0, discount: 0, taxable: 450, gst_pct: 0, gst: 0 }] };
const pb = await both(cash(prodBill));
check('Settings: 7% and products too → ₹1,450 earns 101', pb[0].points_earned === 101 && pb[1].points_earned === 101, JSON.stringify([pb[0].points_earned, pb[1].points_earned]));
await q(`update settings set value = '5' where key = 'loyalty_earn_pct'`);
await q(`update settings set value = 'false' where key = 'loyalty_products'`);
await ldb.upsert('settings', { key: 'loyalty_earn_pct', value: 5 }, 'key');
await ldb.upsert('settings', { key: 'loyalty_products', value: false }, 'key');
// expiry once a day (the morning message) for everyone
const phoneZ = '9831100077';
const old = { ...cash({ ...S(3000), customer_phone: phoneZ }), created_at: new Date(Date.now() - 380 * 86400e3).toISOString() };
await both(old);
check('a bill 380 days ago: 150 points', (await q(`select points from customers where phone = $1`, [phoneZ]))[0].points === 150);
const sum = (await q(`select day_summary() s`))[0].s;
check('the daily run expires them (no visit for 12 months)', !!sum && (await q(`select points from customers where phone = $1`, [phoneZ]))[0].points === 0
  && (await q(`select count(*)::int n from loyalty_points l join customers c on c.id = l.customer_id where c.phone = $1 and kind = 'expire'`, [phoneZ]))[0].n === 1);
check('the app shows the same (0) before the daily run', L.liveBalance({ points: 150, last_visit: old.created_at }, R) === 0);

// --- nobody types a balance ---
const [anyC] = await q(`select id, points from customers where phone = $1`, [phoneA]);
check('counter cannot set a balance', /Points change only through bills/.test(err(await C(`update customers set points = 5000 where id = $1`, [anyC.id]))));
check('an owner login cannot either', /Points change only through bills/.test(err(await O(`update customers set points = 5000 where id = $1`, [anyC.id]))));
await C(`insert into customers (phone, name, points) values ('9831100099', 'Fake', 9999)`);
check('a customer added with points starts at 0', (await q(`select points from customers where phone = '9831100099'`))[0]?.points === 0);
check('counter cannot add points rows', !!err(await C(`insert into loyalty_points (customer_id, kind, points) values ($1, 'adjust', 500)`, [anyC.id])));
check('counter cannot change or delete points rows', (await C(`update loyalty_points set points = 999 returning id`)).length === 0 && (await C(`delete from loyalty_points returning id`)).length === 0);
check('counter can read points (the bill shows the balance)', (await C(`select count(*)::int n from loyalty_points`))[0].n > 0);
check('a login waiting for approval cannot', (await as(clerk, sPending, () => tryq(`select count(*)::int n from loyalty_points`)))[0].n === 0);
check('counter cannot run the expiry', !!err(await C(`select expire_points()`)));
check('the customer still edits fine (name)', !err(await C(`update customers set name = 'Riya S' where id = $1`, [anyC.id])));
const before = (await q(`select (select count(*) from loyalty_points) a, (select sum(points) from customers) b`))[0];
await db.exec(schema);
const after = (await q(`select (select count(*) from loyalty_points) a, (select sum(points) from customers) b`))[0];
check('schema re-run keeps the points', JSON.stringify(before) === JSON.stringify(after));
check('settings: 44 in all', (await q(`select count(*)::int n from settings`))[0].n === 44);

const bad = Object.entries(fails);
console.log(`${checks.toLocaleString()} loyalty checks, ${bad.reduce((a, [, v]) => a + v.count, 0)} failed`);
for (const [n, v] of bad.slice(0, 30)) console.log(`✗ ${n} (${v.count}×) ${String(v.first).slice(0, 700)}`);
process.exitCode = bad.length ? 1 : 0;
