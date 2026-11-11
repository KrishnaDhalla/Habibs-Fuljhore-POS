// Database tests: the real schema (01_schema.sql) in an in-memory PostgreSQL (PGlite),
// with the same bills also saved through the demo database (localdb.js) and compared line by line.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { calcBill, checkBill, calcPayroll } = await import('../src/lib/calc.js');
const { staffPriceRules, staffPctOf } = await import('../src/lib/staffPrice.js');
const { cashNow, checkExpense, checkClose } = await import('../src/lib/cash.js');
const { dueMessages } = await import('../src/lib/waAuto.js');
const { applyOffers } = await import('../src/lib/offers.js');
const { createLocalDb } = await import('../src/lib/localdb.js');
const { toPaise, round2, istDay, addDays } = await import('../src/lib/format.js');
const { productUnits } = await import('../src/lib/units.js');
const { unitNormal } = await import('../src/lib/stockcheck.js');

let seed = Number(process.env.SEED || 7);
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];

let checks = 0;
const fails = [];
const check = (name, cond, detail = '') => { checks++; if (!cond) fails.push(`✗ ${name} ${typeof detail === 'function' ? detail() : detail}`.slice(0, 700)); };
const P = toPaise;

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
await db.exec(schema); // safe to run again
await db.exec(`grant usage on schema public to authenticated; grant all on all tables in schema public to authenticated;`);

const q = async (sql, p) => (await db.query(sql, p)).rows;
const owner = randomUUID(), clerk = randomUUID(), sOwner = randomUUID(), sClerk = randomUUID(), sPending = randomUUID();
await q(`insert into app_roles values ($1, 'owner', 'Krishna')`, [owner]);
await q(`insert into login_requests (session_id, user_id, email, status) values ($1, $2, 'counter@x', 'approved'), ($3, $2, 'counter@x', 'pending')`, [sClerk, clerk, sPending]);
async function as(user, session, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user, session_id: session, role: 'authenticated' })]);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const tryq = async (sql, p) => { try { return await q(sql, p); } catch (e) { return { error: e.message }; } };

// ---------- shared master data (same ids in both databases) ----------
const services = await q(`select * from services where active order by sort`);
const staff = [
  { id: randomUUID(), name: 'Amit Das', monthly_salary: 18000, service_commission_pct: 10, product_commission_pct: 5 },
  { id: randomUUID(), name: 'Priya Saha', monthly_salary: 14000, service_commission_pct: 8, product_commission_pct: 5 },
  { id: randomUUID(), name: 'Sneha Paul', monthly_salary: 10000, service_commission_pct: 0, product_commission_pct: 2 },
];
const products = [
  { id: randomUUID(), name: 'Shampoo 250 ml', sell_price: 450, gst_pct: 18, stock: 0 },
  { id: randomUUID(), name: 'Hair Serum 100 ml', sell_price: 549.5, gst_pct: 18, stock: 0 },
  { id: randomUUID(), name: 'Comb', sell_price: 99, gst_pct: 12, stock: 0 },
];
const offers = [
  { id: randomUUID(), name: 'Pujo 20% hair (up to ₹500)', active: true, applies_to: 'section', sections: ['Hair'], kind: 'percent', value: 20, max_discount: 500, min_bill: 0 },
  { id: randomUUID(), name: 'Facial ₹300 off', active: true, applies_to: 'category', categories: [services.find((s) => /facial/i.test(s.category))?.category || 'x'], kind: 'amount', value: 300, min_bill: 0 },
  { id: randomUUID(), name: 'Everything 10% over ₹3000', active: true, applies_to: 'all', include_products: true, kind: 'percent', value: 10, min_bill: 3000, max_discount: 1000 },
  { id: randomUUID(), name: 'First visit ₹199 cut', active: true, applies_to: 'services', service_ids: [services[0].id], kind: 'price', value: 199, new_customers_only: true, min_bill: 0 },
];
for (const s of staff) await q(`insert into staff (id, name, monthly_salary, service_commission_pct, product_commission_pct) values ($1,$2,$3,$4,$5)`, [s.id, s.name, s.monthly_salary, s.service_commission_pct, s.product_commission_pct]);
for (const p of products) {
  await q(`insert into products (id, name, sell_price, gst_pct) values ($1,$2,$3,$4)`, [p.id, p.name, p.sell_price, p.gst_pct]);
  await q(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 500)`, [p.id]);
}
for (const o of offers) await q(`insert into offers (id, name, active, applies_to, sections, categories, service_ids, include_products, kind, value, min_bill, max_discount, new_customers_only)
  values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [o.id, o.name, o.active, o.applies_to, o.sections || null, o.categories || null, o.service_ids || null, !!o.include_products, o.kind, o.value, o.min_bill || 0, o.max_discount || null, !!o.new_customers_only]);

// demo database starting empty, with the same master data
const T = ['settings', 'services', 'customers', 'staff', 'attendance', 'staff_advances', 'payslips', 'products', 'stock_moves', 'bills', 'bill_items', 'counters', 'offers'];
localStorage.setItem('habibs-pos-demo-v1', JSON.stringify({ version: 3, ...Object.fromEntries(T.map((t) => [t, []])), settings: [{ key: 'bill_prefix', value: 'HF' }] }));
const ldb = createLocalDb();
for (const s of services) await ldb.insert('services', s);
for (const s of staff) await ldb.insert('staff', s);
for (const p of products) { await ldb.insert('products', { ...p }); await ldb.insert('stock_moves', { product_id: p.id, type: 'in', qty: 500 }); }

// ---------- 1. random bills through both databases ----------
const phones = Array.from({ length: 40 }, (_, i) => String(9000000000 + i * 1234567).slice(0, 10));
const svcById = Object.fromEntries(services.map((s) => [s.id, s]));
const seenPhones = new Set();
const NOW = { day: '2026-10-20', time: '12:00', dow: 2 };
function makeBill() {
  const lines = [];
  for (let k = ri(1, 5); k > 0; k--) {
    if (rnd() < 0.2) { const p = pick(products); lines.push({ item_type: 'product', product_id: p.id, name: p.name, category: 'Products', staff_id: pick(staff).id, qty: ri(1, 3), unit_price: p.sell_price, gst_pct: p.gst_pct }); continue; }
    const s = pick(services);
    const price = s.variants ? pick(s.variants).price : Number(s.price) || ri(300, 3000);
    lines.push({ item_type: 'service', service_id: s.id, name: s.name, category: s.category, staff_id: pick(staff).id, qty: 1, unit_price: Number(price), gst_pct: Number(s.gst_pct) });
  }
  // a discount on some lines (% or ₹), as the counter gives one
  for (const l of lines) if (rnd() < 0.2) Object.assign(l, rnd() < 0.6 ? { disc_type: 'pct', disc_value: pick([5, 10, 20, 33.33]) } : { disc_type: 'amt', disc_value: pick([10, 50, 99.99, 5000]) });
  const phone = rnd() < 0.85 ? pick(phones) : '';
  const isNew = phone && !seenPhones.has(phone);
  const r = applyOffers(lines, offers, { now: NOW, servicesById: svcById, isNew });
  const disc = rnd() < 0.3 ? { discountType: pick(['pct', 'amt']), discountValue: pick([5, 10, 12.5, 15, 50, 99.99]) } : {};
  const b = calcBill(r.lines, { ...disc, gstOn: rnd() < 0.6, inclusive: rnd() < 0.7 });
  const mode = pick(['Cash', 'UPI', 'UPI', 'Card', 'Split']);
  const c = mode === 'Split' ? round2(Math.floor(rnd() * P(b.total)) / 100) : 0;
  const pay = mode === 'Split' ? { paid_cash: c, paid_upi: round2(b.total - c), paid_card: 0 } : { paid_cash: mode === 'Cash' ? b.total : 0, paid_upi: mode === 'UPI' ? b.total : 0, paid_card: mode === 'Card' ? b.total : 0 };
  if (phone) seenPhones.add(phone);
  return {
    id: randomUUID(), customer_phone: phone, customer_name: phone ? 'Cust ' + phone.slice(-4) : '',
    subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total,
    pay_mode: mode, ...pay, note: '',
    items: b.items.map((l) => ({ item_type: l.item_type, service_id: l.service_id || '', product_id: l.product_id || '', name: l.name, category: l.category, hsn_sac: '', staff_id: l.staff_id, staff_name: staff.find((s) => s.id === l.staff_id).name, qty: l.qty, unit_price: l.unit_price, amount: l.amount, offer_id: l.offer_id || '', offer_name: l.offer_name || '', offer_discount: l.offer_discount || 0, line_discount: l.line_discount || 0, discount: l.discount, taxable: l.taxable, gst_pct: l.gst_pct, gst: l.gst })),
  };
}

await q(`update settings set value = '100' where key = 'max_discount_pct'`);
const NB = Number(process.env.NB || 300);
const sent = [];
const fy = (await q(`select fy_code(now()) f`))[0].f;
const t0 = Date.now() - 3 * 86400e3;
for (let i = 0; i < NB; i++) {
  const p = { ...makeBill(), created_at: new Date(t0 + i * 37e3).toISOString() };
  check('app bill passes the JS check', checkBill(p).length === 0, () => checkBill(p).join('; '));
  const [b] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(p)]));
  const lb = await ldb.rpc('create_bill', { p });
  sent.push({ p, b });
  check('bill numbers run 0001, 0002 … with no gaps', b.bill_no === `HF${fy}-${String(i + 1).padStart(4, '0')}`, b.bill_no);
  check('demo database gives the same bill number', lb.bill_no === b.bill_no, `${lb.bill_no} vs ${b.bill_no}`);
  for (const k of ['subtotal', 'offer_discount', 'discount', 'taxable', 'cgst', 'sgst', 'round_off', 'total', 'paid_cash', 'paid_upi', 'paid_card']) {
    check(`stored ${k} = sent ${k}`, P(b[k]) === P(p[k]), () => `${b[k]} vs ${p[k]}`);
    check(`demo stored ${k} = sent ${k}`, P(lb[k]) === P(p[k]), () => `${lb[k]} vs ${p[k]}`);
  }
}
const items = await q(`select * from bill_items`);
check('every line stored', items.length === sent.reduce((a, s) => a + s.p.items.length, 0));
for (const { p, b } of sent) {
  const mine = items.filter((i) => i.bill_id === b.id);
  for (const k of ['amount', 'offer_discount', 'line_discount', 'discount', 'taxable', 'gst']) check(`line ${k} totals match the bill`, mine.reduce((a, i) => a + P(i[k]), 0) === p.items.reduce((a, i) => a + P(i[k]), 0));
}

{
  const flagged = await q(`select note from bills where note like '%CHECK%' or note like '%Not on the menu%'`);
  check('300 app-made bills (menu prices, offers by their rules): none flagged by the menu check', flagged.length === 0, JSON.stringify(flagged.slice(0, 3)));
}

async function compareAll(label, demo = true) {
  const bills = await q(`select * from bills order by bill_no`);
  const lbills = (await ldb.list('bills', {})).sort((a, b) => (a.bill_no < b.bill_no ? -1 : 1));
  if (demo) check(`${label}: same number of bills`, bills.length === lbills.length, `${bills.length} vs ${lbills.length}`);
  if (demo) bills.forEach((b, i) => {
    const l = lbills[i] || {};
    check(`${label}: same bill numbers`, l.bill_no === b.bill_no, `${l.bill_no} vs ${b.bill_no}`);
    check(`${label}: same status`, l.status === b.status, b.bill_no);
    check(`${label}: same new-customer flag`, !!l.is_new_customer === !!b.is_new_customer, () => `${b.bill_no} pg=${b.is_new_customer} demo=${l.is_new_customer}`);
  });
  // customers
  const cs = await q(`select * from customers order by phone`);
  const lcs = (await ldb.list('customers', {})).sort((a, b) => (a.phone < b.phone ? -1 : 1));
  if (demo) check(`${label}: same customers`, cs.length === lcs.length);
  for (const c of cs) {
    const paid = bills.filter((b) => b.customer_id === c.id && b.status === 'paid');
    check(`${label}: visits = paid bills`, c.visits === paid.length, `${c.phone} ${c.visits} vs ${paid.length}`);
    check(`${label}: total spent = sum of paid bills`, P(c.total_spent) === paid.reduce((a, b) => a + P(b.total), 0), c.phone);
    check(`${label}: exactly one first visit per customer with bills`, paid.length === 0 || paid.filter((b) => b.is_new_customer).length === 1, () => `${c.phone}: ${paid.filter((b) => b.is_new_customer).length}`);
    if (paid.length) {
      const first = [...paid].sort((a, b) => a.created_at - b.created_at)[0];
      check(`${label}: the first visit is the earliest paid bill`, first.is_new_customer, c.phone);
    }
    const l = lcs.find((x) => x.phone === c.phone) || {};
    if (demo) check(`${label}: demo visits match`, l.visits === c.visits, c.phone);
    if (demo) check(`${label}: demo spend matches`, P(l.total_spent) === P(c.total_spent), c.phone);
  }
  // stock
  for (const p of products) {
    const [row] = await q(`select stock from products where id = $1`, [p.id]);
    const sold = (await q(`select coalesce(sum(i.qty),0) s from bill_items i join bills b on b.id = i.bill_id where i.product_id = $1 and b.status = 'paid'`, [p.id]))[0].s;
    const moves = (await q(`select coalesce(sum(qty),0) s from stock_moves where product_id = $1`, [p.id]))[0].s;
    check(`${label}: stock = 500 − sold on paid bills`, Number(row.stock) === 500 - Number(sold), () => `${p.name} ${row.stock} vs ${500 - Number(sold)}`);
    check(`${label}: stock = sum of stock moves`, Number(row.stock) === Number(moves), p.name);
    const lp = (await ldb.list('products', { eq: { id: p.id } }))[0];
    if (demo) check(`${label}: demo stock matches`, Number(lp.stock) === Number(row.stock), () => `${lp.stock} vs ${row.stock}`);
  }
  // views used by dashboards
  const [v] = await q(`select coalesce(sum(revenue),0) r, coalesce(sum(bills),0) n, coalesce(sum(cash),0) c, coalesce(sum(upi),0) u, coalesce(sum(card),0) k, coalesce(sum(gst),0) g from v_daily_sales`);
  const paidBills = bills.filter((b) => b.status === 'paid');
  check(`${label}: daily sales view = sum of paid bills`, P(v.r) === paidBills.reduce((a, b) => a + P(b.total), 0) && Number(v.n) === paidBills.length);
  check(`${label}: cash + UPI + card = sales`, P(v.c) + P(v.u) + P(v.k) === P(v.r));
  check(`${label}: GST in view = CGST + SGST of paid bills`, P(v.g) === paidBills.reduce((a, b) => a + P(b.cgst) + P(b.sgst), 0));
  const [sl] = await q(`select count(*)::int n, coalesce(sum(taxable),0) t from v_sales_lines`);
  const paidItems = (await q(`select i.* from bill_items i join bills b on b.id = i.bill_id where b.status='paid'`));
  check(`${label}: sales lines view has only paid lines`, sl.n === paidItems.length && P(sl.t) === paidItems.reduce((a, i) => a + P(i.taxable), 0));
  const [op] = await q(`select coalesce(sum(discount_given),0) d from v_offer_performance`);
  check(`${label}: offer view = offer discounts on paid bills`, P(op.d) === paidItems.reduce((a, i) => a + P(i.offer_discount), 0));
}
await compareAll('after billing');

// ---------- 2. cancelling ----------
const toCancel = sent.filter(() => rnd() < 0.12);
for (const { b } of toCancel) {
  const [c] = await as(owner, sOwner, () => q(`select * from cancel_bill($1, 'test')`, [b.id]));
  await ldb.rpc('cancel_bill', { p_id: b.id, p_reason: 'test' });
  check('cancelled bill keeps its numbers', c.status === 'cancelled' && P(c.total) === P(b.total));
}
const again = await as(owner, sOwner, () => tryq(`select * from cancel_bill($1, 'twice')`, [toCancel[0].b.id]));
check('a bill cannot be cancelled twice (stock not returned twice)', again.error && /already cancelled/.test(again.error), JSON.stringify(again));
await compareAll('after cancelling ' + toCancel.length);

// ---------- 3. idempotent: the same bill sent again ----------
{
  const { p, b } = sent[5];
  const before = (await q(`select count(*)::int n from bill_items`))[0].n;
  const [b2] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(p)]));
  check('same bill sent twice → same bill, nothing added', b2.id === b.id && b2.bill_no === b.bill_no && (await q(`select count(*)::int n from bill_items`))[0].n === before);
  const off = { ...p, bill_no: `HF${fy}-A0042`, created_at: new Date(Date.now() - 3600e3).toISOString() };
  await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(off)]));
  const [b3] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(off)]));
  check('offline copy of an already-saved bill → note added once', b3.bill_no === b.bill_no && (b3.note.match(/Also printed offline/g) || []).length === 1, b3.note);
}

// ---------- 4. offline bills: own numbers, clashes, out of order, wrong clock ----------
{
  const ph = '9123400001';
  const mk = (extra) => { const p = makeBill(); return { ...p, customer_phone: ph, customer_name: 'Order Test', ...extra }; };
  const online = mk({});
  const [bOnline] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(online)]));
  check('online first bill is the first visit', bOnline.is_new_customer === true);
  const earlier = mk({ bill_no: `HF${fy}-B0001`, created_at: new Date(Date.now() - 2 * 3600e3).toISOString() });
  const [bOff] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(earlier)]));
  check('offline bill keeps its printed number and time', bOff.bill_no === `HF${fy}-B0001` && Math.abs(new Date(bOff.created_at) - new Date(earlier.created_at)) < 1000);
  const flags = await q(`select bill_no, is_new_customer from bills where customer_phone = $1 order by created_at`, [ph]);
  check('an earlier offline bill uploaded later becomes the first visit', flags[0].is_new_customer === true && flags[1].is_new_customer === false, JSON.stringify(flags));
  const [c] = await q(`select * from customers where phone = $1`, [ph]);
  check('customer first visit = the offline bill time', Math.abs(new Date(c.first_visit) - new Date(earlier.created_at)) < 1000 && c.visits === 2);
  await as(owner, sOwner, () => q(`select * from cancel_bill($1, 'x')`, [bOff.id]));
  const [nb] = await q(`select is_new_customer from bills where id = $1`, [bOnline.id]);
  check('first bill cancelled → next paid bill becomes the first visit', nb.is_new_customer === true);
  const clash1 = await as(clerk, sClerk, () => q(`select bill_no, note from create_bill($1)`, [JSON.stringify(mk({ bill_no: `HF${fy}-B0001`, created_at: new Date(Date.now() - 3600e3).toISOString() }))]));
  const clash2 = await as(clerk, sClerk, () => q(`select bill_no, note from create_bill($1)`, [JSON.stringify(mk({ bill_no: `HF${fy}-B0001`, created_at: new Date(Date.now() - 3000e3).toISOString() }))]));
  check('two devices with the same offline number → -2, then -3, with a note', clash1[0].bill_no === `HF${fy}-B0001-2` && clash2[0].bill_no === `HF${fy}-B0001-3` && /Number clash/.test(clash2[0].note), JSON.stringify([clash1, clash2]));
  const future = mk({ bill_no: `HF${fy}-B0009`, created_at: new Date(Date.now() + 3 * 86400e3).toISOString() });
  const [bf] = await as(clerk, sClerk, () => q(`select * from create_bill($1)`, [JSON.stringify(future)]));
  check('bill from a tablet with its clock days ahead is saved at the real time, with a note', Math.abs(new Date(bf.created_at) - Date.now()) < 60e3 && /clock was ahead/.test(bf.note), bf.note);
}

// ---------- 5. something deleted while a bill waited offline ----------
{
  const p = makeBill();
  const delStaff = randomUUID(), delProd = randomUUID(), delOffer = randomUUID();
  await q(`insert into staff (id, name) values ($1, 'Left Staff')`, [delStaff]);
  await q(`insert into products (id, name, sell_price, gst_pct) values ($1, 'Old product', 100, 18)`, [delProd]);
  await q(`insert into offers (id, name, kind, value) values ($1, 'Ended offer', 'percent', 10)`, [delOffer]);
  const lines = [
    { item_type: 'service', service_id: services[3].id, name: services[3].name, staff_id: delStaff, qty: 1, unit_price: 1000, gst_pct: 5, offer_id: delOffer, offer_name: 'Ended offer', offer_discount: 100 },
    { item_type: 'product', product_id: delProd, name: 'Old product', staff_id: staff[0].id, qty: 2, unit_price: 100, gst_pct: 18 },
  ];
  const b = calcBill(lines, { gstOn: true, inclusive: true });
  const pay = { ...p, bill_no: `HF${fy}-C0001`, created_at: new Date(Date.now() - 600e3).toISOString(), customer_phone: '', subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, pay_mode: 'Cash', paid_cash: b.total, paid_upi: 0, paid_card: 0, items: b.items.map((l) => ({ ...l, staff_name: 'x' })) };
  await q(`delete from staff where id = $1`, [delStaff]);
  await q(`delete from products where id = $1`, [delProd]);
  await q(`delete from offers where id = $1`, [delOffer]);
  const r = await as(clerk, sClerk, () => tryq(`select * from create_bill($1)`, [JSON.stringify(pay)]));
  check('bill still uploads after its staff, product and offer were deleted', !r.error, JSON.stringify(r));
  if (!r.error) {
    const its = await q(`select name, staff_id, product_id, offer_id, offer_name from bill_items where bill_id = $1`, [r[0].id]);
    check('names kept, links cleared', its.every((i) => i.name && !i.offer_id && !(i.product_id)) && its.some((i) => i.offer_name === 'Ended offer') && its[0].staff_id === null, JSON.stringify(its));
  }
}

// ---------- 6. wrong or tampered bills are refused, and the counter does not move ----------
{
  const before = (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value;
  let base = makeBill();
  while (!base.items.some((x) => x.taxable > 0)) base = makeBill();
  const j = base.items.findIndex((x) => x.taxable > 0);
  const at = (f) => ({ ...base, items: base.items.map((x, i) => (i === j ? f(x) : x)) });
  const bad = [
    ['total one rupee less', { ...base, total: base.total - 1, paid_cash: 0, paid_upi: base.total - 1, paid_card: 0, pay_mode: 'UPI' }],
    ['subtotal changed', { ...base, subtotal: base.subtotal + 0.01 }],
    ['payments short', { ...base, pay_mode: 'Split', paid_cash: 1, paid_upi: 0, paid_card: 0 }],
    ['discount on the bill not on the lines', { ...base, discount: base.discount + 10 }],
    ['CGST moved to SGST', { ...base, cgst: round2(base.cgst - 0.05), sgst: round2(base.sgst + 0.05) }],
    ['line price changed', at((x) => ({ ...x, unit_price: x.unit_price + 1 }))],
    ['zero quantity', at((x) => ({ ...x, qty: 0 }))],
    ['half quantity', at((x) => ({ ...x, qty: 0.5 }))],
    ['negative price', at((x) => ({ ...x, unit_price: -x.unit_price, amount: -x.amount }))],
    ['GST at the wrong rate', at((x) => ({ ...x, gst_pct: x.gst_pct ? x.gst_pct + 1 : 5 }))],
    ['line taxable value raised', at((x) => ({ ...x, taxable: round2(x.taxable + 0.01), gst: round2(x.gst - 0.01) }))],
    ['no items', { ...base, items: [] }],
    ['no payment mode', { ...base, pay_mode: '' }],
    ['bad mobile number', { ...base, customer_phone: '12345' }],
  ];
  for (const [name, p] of bad) {
    const r = await as(clerk, sClerk, () => tryq(`select * from create_bill($1)`, [JSON.stringify({ ...p, id: randomUUID() })]));
    check(`refused: ${name}`, !!r.error, JSON.stringify(r).slice(0, 200));
    const lr = await ldb.rpc('create_bill', { p: { ...p, id: randomUUID() } }).then(() => null, (e) => e.message);
    check(`demo refuses too: ${name}`, !!lr);
  }
  const after = (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value;
  check('refused bills use no bill number (no gaps)', after === before, `${before} → ${after}`);
  const pend = await as(clerk, sPending, () => tryq(`select * from create_bill($1)`, [JSON.stringify({ ...makeBill(), id: randomUUID() })]));
  check('a login waiting for approval cannot bill', pend.error && /not approved/.test(pend.error), JSON.stringify(pend));
  const pc = await as(clerk, sPending, () => tryq(`select * from cancel_bill($1, 'x')`, [sent[10].b.id]));
  check('a login waiting for approval cannot cancel', !!pc.error);
}

// ---------- 7. nobody can quietly edit or delete saved bills ----------
{
  const { b } = sent.find((s) => s.b.status === 'paid' && !toCancel.includes(s));
  const tries = [
    [`update bills set total = 1 where id = $1`, [b.id]],
    [`delete from bills where id = $1`, [b.id]],
    [`update bill_items set amount = 1, taxable = 1 where bill_id = $1`, [b.id]],
    [`delete from bill_items where bill_id = $1`, [b.id]],
    [`update counters set value = 1`, []],
    [`delete from stock_moves where bill_id = $1`, [b.id]],
    [`update stock_moves set qty = 0 where type = 'in'`, []],
    [`insert into bills (bill_no, subtotal, taxable, total, pay_mode) values ('FAKE-1', 1, 1, 1, 'Cash')`, []],
  ];
  for (const who of [[clerk, sClerk, 'counter login'], [owner, sOwner, 'owner login']]) {
    for (const [sql, args] of tries) await as(who[0], who[1], () => tryq(sql, args));
  }
  const [after] = await q(`select * from bills where id = $1`, [b.id]);
  check('bill unchanged after direct edit/delete attempts', after && P(after.total) === P(b.total));
  const its = await q(`select sum(amount) a from bill_items where bill_id = $1`, [b.id]);
  check('bill lines unchanged', P(its[0].a) === P(b.subtotal));
  check('no fake bill', (await q(`select count(*)::int n from bills where bill_no = 'FAKE-1'`))[0].n === 0);
  check('counter unchanged', (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value >= NB);
  const add = await as(clerk, sClerk, () => tryq(`insert into stock_moves (product_id, type, qty, note) values ($1, 'in', 5, 'Delivery') returning id`, [products[0].id]));
  check('counter can still add stock', !add.error, JSON.stringify(add));
  const read = await as(clerk, sClerk, () => tryq(`select count(*)::int n from bills`));
  check('counter can read bills', !read.error && read[0].n > 0);
  const pendRead = await as(clerk, sPending, () => tryq(`select count(*)::int n from bills`));
  check('waiting login sees no bills', !pendRead.error && pendRead[0].n === 0);
  await q(`delete from stock_moves where note = 'Delivery'`);
}
await compareAll('final', false).catch((e) => check('final checks ran', false, e.message));

// ---------- 8. financial year in bill numbers ----------
const fyCases = [['2027-03-31T23:59:59+05:30', '2627'], ['2027-04-01T00:00:00+05:30', '2728'], ['2026-04-01T00:00:00+05:30', '2627'], ['2026-03-31T18:29:59Z', '2526'], ['2026-03-31T18:30:00Z', '2627'], ['2099-12-31T12:00:00+05:30', '9900'], ['2100-01-15T12:00:00+05:30', '9900']];
for (const [t, want] of fyCases) {
  const [r] = await q(`select fy_code($1::timestamptz) f`, [t]);
  check('financial year code', r.f === want, `${t} → ${r.f}, want ${want}`);
}


// ---------- 10. owner approval: Telegram requests, Authenticator codes, and what they unlock ----------
{
  const { totp, stepNow, toHex, newSecret } = await import('../src/lib/totp.js');
  await q(`update settings set value = '20' where key = 'max_discount_pct'`);
  const secret = newSecret();
  const codeAt = (step) => totp(secret, step);
  const C = (user, sess) => (sql, p) => as(user, sess, () => tryq(sql, p));
  const clerkQ = C(clerk, sClerk);
  const ownerQ = C(owner, sOwner);
  const pendQ = C(clerk, sPending);
  const one = async (r) => (Array.isArray(r) ? r[0] : r);
  // the counter can't touch the Authenticator key
  check('counter cannot set up the Authenticator', !!(await clerkQ(`select owner_totp_set($1, $2)`, [toHex(secret), await codeAt(stepNow())])).error);
  check('owner sets up the Authenticator with a code from the phone', !(await ownerQ(`select owner_totp_set($1, $2)`, [toHex(secret), await codeAt(stepNow())])).error);
  check('wrong set-up code refused', !!(await ownerQ(`select owner_totp_set($1, '000000')`, [toHex(newSecret())])).error);
  check('counter cannot read the key', (await clerkQ(`select count(*)::int n from owner_secrets`))[0].n === 0);
  check('counter sees one owner has codes', (await clerkQ(`select owner_totp_status() s`))[0].s.owners === 1);
  check('a waiting login cannot ask the owner', !!(await pendQ(`select * from request_owner_unlock('unlock', null, 'x', 'tab', null)`)).error);
  check('a waiting login cannot use a code', !!(await pendQ(`select * from owner_unlock_with_code('123456', 'x', 'tab')`)).error);

  // without approval: owner things are blocked for the counter
  const paid = (await q(`select id, bill_no from bills where status = 'paid' order by bill_no limit 5`));
  check('counter cannot cancel without the owner', /Owner approval needed/.test((await clerkQ(`select * from cancel_bill($1, 'x')`, [paid[0].id])).error || ''));
  check('counter cannot change settings', (await clerkQ(`update settings set value = '90' where key = 'max_discount_pct' returning key`)).length === 0);
  check('counter cannot change a price', (await clerkQ(`update services set price = 1 where id = $1 returning id`, [services[0].id])).length === 0);
  check('counter cannot add an offer', !!(await clerkQ(`insert into offers (name, kind, value) values ('Free', 'percent', 100)`)).error);
  check('counter cannot change salaries', (await clerkQ(`update staff set monthly_salary = 99999 returning id`)).length === 0);
  check('counter cannot add an advance', !!(await clerkQ(`insert into staff_advances (staff_id, day, amount) values ($1, current_date, 5000)`, [staff[0].id])).error);
  check('counter cannot mark salary paid', !!(await clerkQ(`insert into payslips (staff_id, month, days_in_month, paid_days, monthly_salary, salary_earned, net_pay) values ($1, '2026-09', 30, 30, 1, 1, 1)`, [staff[0].id])).error);
  check('counter cannot change a product price', !!(await clerkQ(`update products set sell_price = 1 where id = $1`, [products[0].id])).error);
  check('counter can update a product cost (stock coming in)', !(await clerkQ(`update products set cost_price = 333 where id = $1`, [products[0].id])).error);
  check('counter cannot add a product', !!(await clerkQ(`insert into products (name, sell_price) values ('Cheap', 1)`)).error);
  check('counter can add stock in', !(await clerkQ(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 1)`, [products[0].id])).error);
  check('counter cannot correct the stock count', !!(await clerkQ(`insert into stock_moves (product_id, type, qty) values ($1, 'adjust', -50)`, [products[0].id])).error);
  check('counter cannot fake a sale move', !!(await clerkQ(`insert into stock_moves (product_id, type, qty) values ($1, 'return', 50)`, [products[0].id])).error);
  check('counter cannot mark attendance by hand (staff check in with their face; the owner marks the rest)', !!(await clerkQ(`insert into attendance (staff_id, day, status) values ($1, current_date, 'A') on conflict (staff_id, day) do update set status = 'A'`, [staff[0].id])).error);

  // big discount
  const big = () => {
    const lines = [{ item_type: 'service', service_id: services[2].id, name: 'x', qty: 1, unit_price: 2000, gst_pct: 5, staff_id: staff[0].id }];
    const b = calcBill(lines, { discountType: 'pct', discountValue: 25, gstOn: true, inclusive: true });
    return { id: randomUUID(), customer_phone: '', subtotal: b.subtotal, offer_discount: 0, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, pay_mode: 'Cash', paid_cash: b.total, paid_upi: 0, paid_card: 0, items: b.items.map((l) => ({ ...l, staff_name: 'x' })) };
  };
  const b1 = big();
  check('25% discount refused without the owner (limit 20%)', /Owner approval needed: the discount is above the 20% limit/.test((await clerkQ(`select * from create_bill($1)`, [JSON.stringify(b1)])).error || ''));
  const small = { ...big() };
  {
    const lines = [{ item_type: 'service', service_id: services[2].id, name: 'x', qty: 1, unit_price: 2000, gst_pct: 5 }];
    const b = calcBill(lines, { discountType: 'pct', discountValue: 20, gstOn: true, inclusive: true });
    Object.assign(small, { subtotal: b.subtotal, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, paid_cash: b.total, items: b.items.map((l) => ({ ...l, staff_name: 'x' })) });
  }
  check('20% discount (at the limit) needs nobody', !(await clerkQ(`select * from create_bill($1)`, [JSON.stringify(small)])).error);
  // Telegram-style request for exactly this bill
  const req = await one(await clerkQ(`select * from request_owner_unlock('discount', $1, 'Discount 25% on ₹2,000', 'Android tablet', 500)`, [b1.id]));
  check('request is waiting', req.status === 'pending');
  check('still refused while waiting', !!(await clerkQ(`select * from create_bill($1)`, [JSON.stringify({ ...b1, owner_grant_id: req.id })])).error);
  check('counter cannot approve its own request', !!(await clerkQ(`select * from decide_owner_request($1, true)`, [req.id])).error);
  check('counter cannot approve by editing the table', (await clerkQ(`update owner_grants set status = 'approved' where id = $1 returning id`, [req.id])).length === 0);
  const ap = await one(await ownerQ(`select * from decide_owner_request($1, true)`, [req.id]));
  check('owner approves in the app', ap.status === 'approved' && /Krishna/.test(ap.decided_by));
  check('…the counter sees it approved', (await clerkQ(`select status from owner_grant_status($1)`, [req.id]))[0].status === 'approved');
  check('approved discount saves', !(await clerkQ(`select * from create_bill($1)`, [JSON.stringify({ ...b1, owner_grant_id: req.id })])).error);
  check('…and the approval is used up', !!(await q(`select used_at from owner_grants where id = $1`, [req.id]))[0].used_at);
  const b2 = big();
  check('the same approval cannot be used for another bill', !!(await clerkQ(`select * from create_bill($1)`, [JSON.stringify({ ...b2, owner_grant_id: req.id })])).error);
  const req2 = await one(await clerkQ(`select * from request_owner_unlock('discount', $1, 'Discount', 'tab', 100)`, [b2.id]));
  await ownerQ(`select * from decide_owner_request($1, true)`, [req2.id]);
  check('an approval for ₹100 off does not cover ₹500 off', !!(await clerkQ(`select * from create_bill($1)`, [JSON.stringify({ ...b2, owner_grant_id: req2.id })])).error);
  const req3 = await one(await clerkQ(`select * from request_owner_unlock('cancel', $1, 'Cancel', 'tab', null)`, [paid[0].id]));
  check('a denied request stays denied', (await one(await ownerQ(`select * from decide_owner_request($1, false)`, [req3.id]))).status === 'denied' && !!(await clerkQ(`select * from cancel_bill($1, 'x')`, [paid[0].id])).error);
  check('an answered request cannot be answered again', !!(await ownerQ(`select * from decide_owner_request($1, true)`, [req3.id])).error);
  // cancel approved for exactly one bill
  const req4 = await one(await clerkQ(`select * from request_owner_unlock('cancel', $1, 'Cancel bill', 'tab', null)`, [paid[1].id]));
  await ownerQ(`select * from decide_owner_request($1, true)`, [req4.id]);
  check('approved cancel works for that bill', !(await clerkQ(`select * from cancel_bill($1, 'approved')`, [paid[1].id])).error);
  check('…but not for another bill', !!(await clerkQ(`select * from cancel_bill($1, 'sneaky')`, [paid[2].id])).error);
  // a request older than 15 minutes can't be approved
  const req5 = await one(await clerkQ(`select * from request_owner_unlock('unlock', null, 'Open', 'tab', null)`));
  await q(`update owner_grants set created_at = now() - interval '16 minutes' where id = $1`, [req5.id]);
  check('an old request can no longer be approved', !!(await ownerQ(`select * from decide_owner_request($1, true)`, [req5.id])).error);

  // Authenticator code
  const w = await one(await clerkQ(`select * from owner_unlock_with_code('000000', 'Open', 'tab')`));
  check('wrong code: recorded, not unlocked', w.status === 'wrong_code' && !(await clerkQ(`select owner_ok() ok`))[0].ok);
  const step = stepNow();
  const good = await codeAt(step + 1); // the set-up already used this 30-second code
  const u = await one(await clerkQ(`select * from owner_unlock_with_code($1, 'Open reports', 'tab')`, [good]));
  check('right code: unlocked for 10 minutes', u.status === 'approved' && Math.abs(new Date(u.expires_at) - new Date(u.decided_at) - 600000) < 2000 && (await clerkQ(`select owner_ok() ok`))[0].ok);
  check('the same code cannot be used twice', (await one(await clerkQ(`select * from owner_unlock_with_code($1, 'again', 'tab')`, [good]))).status === 'wrong_code');
  check('an old code (2 minutes ago) is refused', (await one(await clerkQ(`select * from owner_unlock_with_code($1, 'old', 'tab')`, [await codeAt(step - 4)]))).status === 'wrong_code');
  check('while unlocked the counter can change settings', (await clerkQ(`update settings set value = '20' where key = 'max_discount_pct' returning key`)).length === 1);
  check('while unlocked a big discount saves', !(await clerkQ(`select * from create_bill($1)`, [JSON.stringify(big())])).error);
  check('while unlocked a cancel works', !(await clerkQ(`select * from cancel_bill($1, 'unlocked')`, [paid[3].id])).error);
  check('the unlock is for this login only (another device stays locked)', !(await C(clerk, randomUUID())(`select owner_ok() ok`))[0]?.ok);
  check('after a reload the unlock is found again', (await clerkQ(`select id from current_owner_unlock()`))[0].id === u.id);
  await clerkQ(`select owner_lock()`);
  check('Lock ends the unlock, and a reload does not bring it back', !(await clerkQ(`select owner_ok() ok`))[0].ok && !(await clerkQ(`select id from current_owner_unlock()`))[0]?.id);
  // a bill made offline during the unlock uploads later, after it ran out
  const offB = { ...big(), bill_no: `HF${fy}-D0001`, created_at: new Date(Date.now() - 60000).toISOString(), owner_grant_id: u.id };
  await q(`update owner_grants set expires_at = now() - interval '1 second' where id = $1`, [u.id]);
  check('after 10 minutes it locks again', !(await clerkQ(`select owner_ok() ok`))[0].ok && (await clerkQ(`update settings set value = '90' where key = 'max_discount_pct' returning key`)).length === 0);
  check('a big-discount bill made offline while unlocked still uploads', !(await clerkQ(`select * from create_bill($1)`, [JSON.stringify(offB)])).error);
  const lateB = { ...big(), bill_no: `HF${fy}-D0002`, created_at: new Date(Date.now() + 9 * 60000).toISOString(), owner_grant_id: u.id };
  check('…but not one made after the unlock ended', !!(await clerkQ(`select * from create_bill($1)`, [JSON.stringify(lateB)])).error);
  // too many wrong codes
  for (let i = 0; i < 5; i++) await clerkQ(`select * from owner_unlock_with_code('11111' || $1, 'guess', 'tab')`, [String(i)]);
  check('5 wrong codes in 15 minutes block more tries', /Too many wrong codes/.test((await clerkQ(`select * from owner_unlock_with_code($1, 'x', 'tab')`, [await codeAt(stepNow())])).error || ''));
  // owner login
  check('owner login needs no approval', (await ownerQ(`select owner_ok() ok`))[0].ok && !(await ownerQ(`select * from create_bill($1)`, [JSON.stringify(big())])).error);
  check('owner sees the record of requests', (await ownerQ(`select count(*)::int n from list_owner_requests()`))[0].n >= 8);
  check('counter does not see the record', (await clerkQ(`select count(*)::int n from list_owner_requests()`))[0].n === 0);
  check('counter cannot read approvals directly', (await clerkQ(`select count(*)::int n from owner_grants`))[0].n === 0);
}


// ---------- 11. stock control: giving stock out, which unit it ends, the Bottle check ----------
{
  const C = (user, sess) => (sql, p) => as(user, sess, () => tryq(sql, p));
  const clerkQ = C(clerk, sClerk);
  const ownerQ = C(owner, sOwner);
  await q(`update settings set value = '"expensive"' where key = 'stock_approval'`);
  await q(`update settings set value = '500' where key = 'stock_approval_above'`);
  const cheap = randomUUID(), dear = randomUUID();
  await q(`insert into products (id, name, kind, unit, cost_price, use_type, size, size_unit) values ($1, 'Shampoo 1.5 L', 'salon', 'bottle', 300, 'shampoo', 1500, 'ml'), ($2, 'Majirel 6.0', 'salon', 'tube', 650, 'colour', 60, 'g')`, [cheap, dear]);
  await q(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 20), ($2, 'in', 10)`, [cheap, dear]);
  const give = (who, sess, body) => as(who, sess, () => tryq(`select * from issue_stock($1)`, [JSON.stringify(body)]));
  const stockOf = async (id) => Number((await q(`select stock from products where id = $1`, [id]))[0].stock);
  const endOf = async (moveId) => (await q(`select * from unit_ends where move_id = $1`, [moveId]))[0];
  const openOf = async (pid) => (await q(`select m.id, m.staff_id from stock_moves m where m.product_id = $1 and m.type = 'use' and not exists (select 1 from unit_ends e where e.move_id = m.id) order by m.created_at, m.id`, [pid]));

  check('counter cannot write a take-out directly (must say who took it)', !!(await clerkQ(`insert into stock_moves (product_id, type, qty) values ($1, 'use', -1)`, [cheap])).error);
  const g1 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[0].id, last: 'no_empty' };
  const r1 = await give(clerk, sClerk, g1);
  check('the first one (none in use): no empty to hand back, no approval for ₹300', !r1.error && r1[0].staff_id === staff[0].id && r1[0].empty_returned === null && Number(r1[0].qty) === -1, JSON.stringify(r1));
  check('…stock goes down', (await stockOf(cheap)) === 19);
  check('the same take-out sent twice is saved once', !(await give(clerk, sClerk, g1)).error && (await stockOf(cheap)) === 19);
  check('one in use now, finished WITHOUT the empty → needs the owner', /Owner approval needed/.test((await give(clerk, sClerk, { ...g1, id: randomUUID(), last: 'no_empty' })).error || ''));
  check('…a second one while it is still in use → needs the owner', /Owner approval needed/.test((await give(clerk, sClerk, { ...g1, id: randomUUID(), last: 'in_use' })).error || ''));
  check('…a made-up answer is refused', /what happened/.test((await give(owner, sOwner, { ...g1, id: randomUUID(), last: 'lost' })).error || ''));
  const g2 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[1].id, last: 'empty' };
  check('empty handed back: no approval for ₹300', !(await give(clerk, sClerk, g2)).error && (await q(`select empty_returned from stock_moves where id = $1`, [g2.id]))[0].empty_returned === true);
  const e1 = await endOf(g1.id);
  check('…it ends the one in use, recording the give-out that ended it', e1 && e1.how === 'empty' && e1.by_move === g2.id && e1.product_id === cheap
    && +new Date(e1.ended_at) === +new Date((await q(`select created_at from stock_moves where id = $1`, [g2.id]))[0].created_at), JSON.stringify(e1));
  // a second one while one is in use (owner login): nothing ends, two in use
  const g3 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[0].id, last: 'in_use', note: 'two colours at once' };
  check('owner: a second one while one is in use', !(await give(owner, sOwner, g3)).error && (await q(`select empty_returned from stock_moves where id = $1`, [g3.id]))[0].empty_returned === false);
  check('…nothing ended, two in use', !(await endOf(g2.id)) && (await openOf(cheap)).length === 2);
  // Amit hands back an empty: his own one ends (not Priya's older one)
  const g4 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[0].id, last: 'empty' };
  await give(clerk, sClerk, g4);
  check('an empty ends the taker\'s own one first', (await endOf(g3.id))?.by_move === g4.id && !(await endOf(g2.id)));
  // Sneha (has none in use) hands back an empty: the oldest one ends
  const g5 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[2].id, empty_returned: true }; // an older app: only empty_returned
  check('an older app (empty_returned only) still works', !(await give(clerk, sClerk, g5)).error);
  check('…someone with none in use: the oldest one ends', (await endOf(g2.id))?.by_move === g5.id);
  // finished, no empty (owner approves): it ends, marked no_empty
  const g6 = { id: randomUUID(), product_id: cheap, qty: 1, staff_id: staff[1].id, last: 'no_empty' };
  const req0 = (await clerkQ(`select * from request_owner_unlock('stock', $1, 'Give 1 × Shampoo · no empty', 'tab', null)`, [g6.id]))[0];
  await ownerQ(`select * from decide_owner_request($1, true)`, [req0.id]);
  check('finished without the empty, approved → saved', !(await give(clerk, sClerk, { ...g6, owner_grant_id: req0.id })).error);
  check('…the one in use ends as "no empty"', (await q(`select how from unit_ends where by_move = $1`, [g6.id]))[0]?.how === 'no_empty');
  check('still two in use (a finished one was replaced)', (await openOf(cheap)).length === 2, JSON.stringify(await openOf(cheap)));
  // one of the two is empty and no new one is needed
  const [o1, o2] = await openOf(cheap);
  const eu = (who, sess, body) => as(who, sess, () => tryq(`select * from end_unit($1)`, [JSON.stringify(body)]));
  const rEnd = await eu(clerk, sClerk, { move_id: o1.id, how: 'empty' });
  check('"One is empty": ends that one, the other stays in use', !rEnd.error && rEnd[0].how === 'empty' && !rEnd[0].by_move && (await openOf(cheap)).length === 1 && (await openOf(cheap))[0].id === o2.id, JSON.stringify(rEnd));
  check('…sent twice, saved once', !(await eu(clerk, sClerk, { move_id: o1.id, how: 'no_empty' })).error && (await endOf(o1.id)).how === 'empty');
  check('…not the only one in use (then none would be in use and no empty asked)', /only one in use/.test((await eu(owner, sOwner, { move_id: o2.id })).error || ''));
  check('…a made-up answer is refused', !!(await eu(owner, sOwner, { move_id: o2.id, how: 'lost' })).error);
  check('…a move that is not a give-out is refused', /Not found/.test((await eu(owner, sOwner, { move_id: randomUUID() })).error || ''));
  // the old rules for the dear one
  const d1 = { id: randomUUID(), product_id: dear, qty: 1, staff_id: staff[1].id, last: 'empty' };
  check('₹650 tube needs the owner even with the empty', /Owner approval needed/.test((await give(clerk, sClerk, d1)).error || ''));
  const req = (await clerkQ(`select * from request_owner_unlock('stock', $1, 'Give 1 × Majirel 6.0', 'tab', null)`, [d1.id]))[0];
  await ownerQ(`select * from decide_owner_request($1, true)`, [req.id]);
  check('approved on Telegram → saved, with the approval recorded', !(await give(clerk, sClerk, { ...d1, owner_grant_id: req.id })).error && (await stockOf(dear)) === 9 &&
    (await q(`select owner_grant_id from stock_moves where id = $1`, [d1.id]))[0].owner_grant_id === req.id);
  check('the same approval can\'t be used for another tube', !!(await give(clerk, sClerk, { ...d1, id: randomUUID(), owner_grant_id: req.id })).error);
  check('two bottles of ₹300 (₹600) need the owner', !!(await give(clerk, sClerk, { ...g2, id: randomUUID(), qty: 2 })).error);
  check('more than in stock is refused', /in stock/.test((await give(owner, sOwner, { ...g2, id: randomUUID(), qty: 50 })).error || ''));
  check('0 or negative refused', !!(await give(owner, sOwner, { ...g2, id: randomUUID(), qty: 0 })).error && !!(await give(owner, sOwner, { ...g2, id: randomUUID(), qty: -2 })).error);
  await q(`update settings set value = '"always"' where key = 'stock_approval'`);
  check('rule "always": even a cheap one with the empty needs the owner', !!(await give(clerk, sClerk, { ...g2, id: randomUUID() })).error);
  await q(`update settings set value = '"never"' where key = 'stock_approval'`);
  check('rule "never": no approval at all', !(await give(clerk, sClerk, { ...d1, id: randomUUID(), last: 'no_empty' })).error);
  await q(`update settings set value = '"expensive"' where key = 'stock_approval'`);
  check('counter cannot change the rule', (await clerkQ(`update settings set value = '"never"' where key = 'stock_approval' returning key`)).length === 0);
  // marked Finished: the ones in use end too
  const openDear = (await openOf(dear)).length;
  check('marked Finished (owner, writing off what is left)', !(await ownerQ(`select * from mark_finished($1)`, [JSON.stringify({ id: randomUUID(), product_id: dear })])).error && (await stockOf(dear)) === 0);
  check('…every one in use ends as "finished"', openDear > 0 && (await openOf(dear)).length === 0 && (await q(`select count(*)::int n from unit_ends where product_id = $1 and how = 'finished'`, [dear]))[0].n === openDear);
  await q(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 2)`, [dear]);
  const after = { id: randomUUID(), product_id: dear, qty: 1, staff_id: staff[0].id, last: 'no_empty' };
  check('after Finished and a delivery, the next one has no empty to hand back', !(await give(owner, sOwner, after)).error
    && (await q(`select empty_returned from stock_moves where id = $1`, [after.id]))[0].empty_returned === null && (await openOf(dear)).length === 1);
  // who may read / write
  check('counter can read unit ends (Stock list)', (await clerkQ(`select count(*)::int n from unit_ends`))[0].n > 0);
  check('counter cannot write unit ends', !!(await clerkQ(`insert into unit_ends (move_id, product_id, how) values ($1, $2, 'empty')`, [g6.id, cheap])).error
    && (await clerkQ(`delete from unit_ends returning move_id`)).length === 0 && (await clerkQ(`update unit_ends set how = 'finished' returning move_id`)).length === 0);
  // "Used in": owner only; counts as 0 < x ≤ 50
  check('counter cannot tick a service for a product', !!(await clerkQ(`insert into service_usage (service_id, product_id) values ($1, $2)`, [services[0].id, dear])).error);
  check('owner ticks a service (counts as 1 by default)', !(await ownerQ(`insert into service_usage (service_id, product_id) values ($1, $2)`, [services[0].id, dear])).error
    && Number((await q(`select weight from service_usage where product_id = $1`, [dear]))[0].weight) === 1);
  check('one row per service and product', !!(await ownerQ(`insert into service_usage (service_id, product_id) values ($1, $2)`, [services[0].id, dear])).error);
  check('counts as 0 or more than 50 refused', !!(await ownerQ(`update service_usage set weight = 0 where product_id = $1 returning id`, [dear])).error && !!(await ownerQ(`update service_usage set weight = 51 where product_id = $1 returning id`, [dear])).error);
  check('counter can read what is ticked (Bottle check)', (await clerkQ(`select count(*)::int n from service_usage`))[0].n === 1);
  check('counter cannot change a product\'s size or how long it lasts', !!(await clerkQ(`update products set size = 1000 where id = $1`, [dear])).error && !!(await clerkQ(`update products set uses_per_unit = 2 where id = $1`, [dear])).error);
  check('owner sets how long it lasts', !(await ownerQ(`update products set uses_per_unit = 12 where id = $1`, [dear])).error);
  check('how long it lasts: more than 0', !!(await ownerQ(`update products set uses_per_unit = 0 where id = $1`, [dear])).error);
  // used without a bill
  const gcw = services.find((x) => x.name === "Women's Global Colour");
  const fu = (who, sess, body) => as(who, sess, () => tryq(`select * from record_free_use($1)`, [JSON.stringify(body)]));
  const f1 = { id: randomUUID(), service_id: gcw.id, option: 'L', staff_id: staff[1].id, reason: 'redo', note: 'uneven colour' };
  const rf = await fu(clerk, sClerk, f1);
  check('counter records a use without a bill', !rf.error && rf[0].option_label === 'L' && rf[0].reason === 'redo' && rf[0].created_by === null, JSON.stringify(rf));
  check('…sent twice, saved once', !(await fu(clerk, sClerk, f1)).error && (await q(`select count(*)::int n from free_uses where id = $1`, [f1.id]))[0].n === 1);
  check('…an option not on the menu is refused', /option/.test((await fu(clerk, sClerk, { ...f1, id: randomUUID(), option: 'XXL' })).error || ''));
  check('…an extra not on the menu is refused', /option/.test((await fu(clerk, sClerk, { ...f1, id: randomUUID(), extra: 'Thick' })).error || ''));
  check('…a reason is needed', /why/.test((await fu(clerk, sClerk, { ...f1, id: randomUUID(), reason: 'because' })).error || ''));
  check('…"other" needs a note', /Write what/.test((await fu(clerk, sClerk, { ...f1, id: randomUUID(), reason: 'other', note: ' ' })).error || ''));
  check('…a made-up service is refused', /service/.test((await fu(clerk, sClerk, { ...f1, id: randomUUID(), service_id: randomUUID() })).error || ''));
  check('…how many: 1 to 20', !!(await fu(clerk, sClerk, { ...f1, id: randomUUID(), qty: 0 })).error && !!(await fu(clerk, sClerk, { ...f1, id: randomUUID(), qty: 21 })).error);
  check('…a pending login cannot', /not approved/.test((await fu(clerk, sPending, { ...f1, id: randomUUID() })).error || ''));
  const treat = services.find((x) => x.extra_options && x.extra_options.choices);
  check('…hair thickness from the menu is fine', !(await fu(clerk, sClerk, { id: randomUUID(), service_id: treat.id, option: 'M', extra: 'Thick', reason: 'staff', staff_id: staff[0].id })).error);
  check('counter cannot read the uses without a bill, or write them directly', (await clerkQ(`select count(*)::int n from free_uses`))[0].n === 0
    && !!(await clerkQ(`insert into free_uses (service_id, reason) values ($1, 'redo')`, [gcw.id])).error);
  check('owner reads them', (await ownerQ(`select count(*)::int n from free_uses`))[0].n === 2);
  // the Bottle check report: any approved login; the inside functions and the Telegram ones: nobody in the app
  const rep = await clerkQ(`select unit_report() r`);
  check('counter gets the Bottle check report', !rep.error && rep[0].r.products.some((x) => x.product_id === cheap), JSON.stringify(rep).slice(0, 300));
  check('pending login cannot', /not approved/.test((await as(clerk, sPending, () => tryq(`select unit_report()`))).error || ''));
  for (const fn of [`product_units('${cheap}', now())`, `unit_normal('${cheap}')`, `unit_alert('${g6.id}')`, `bill_stock_alert('${randomUUID()}')`, `free_use_alert('${f1.id}')`]) {
    check(`app logins cannot call ${fn.split('(')[0]}`, /permission denied/.test((await clerkQ(`select ${fn}`)).error || '') && /permission denied/.test((await ownerQ(`select ${fn}`)).error || ''));
  }
  await db.exec(`set role anon`);
  check('the website key cannot call the Bottle check', /permission denied/.test((await tryq(`select unit_report()`)).error || '') && /permission denied/.test((await tryq(`select record_free_use('{}')`)).error || ''));
  await db.exec(`reset role`);
  check('product deleted → its ticks and unit ends go too', !(await q(`delete from products where id = $1`, [cheap])).error
    && (await q(`select count(*)::int n from unit_ends where product_id = $1`, [cheap]))[0].n === 0);
}

// ---------- 11b. Bottle check: the database and the app count the same ----------
{
  const svc = Object.fromEntries(services.map((x) => [x.name, x]));
  const pool = [['Root Touch-up', null], ["Women's Global Colour", ['S', 'M', 'L', 'XL']], ['Keratin', ['S', 'M', 'L', 'XL']], ["Women's L'Oreal Classic Hair Spa", null], ["Men's Haircut & Styling", null]]
    .filter(([n]) => svc[n]);
  const base = Date.parse('2026-06-01T10:00:00+05:30');
  const iso = (h) => new Date(base + h * 3600e3).toISOString();
  let billNo = 0;
  const prods = [];
  const sizes = {};
  for (let k = 0; k < 14; k++) {
    const pid = randomUUID();
    prods.push(pid);
    const psize = k % 3 === 0 ? null : 1000;
    sizes[pid] = psize;
    await q(`insert into products (id, name, kind, unit, cost_price, uses_per_unit, size, size_unit) values ($1, $2, 'salon', 'bottle', 400, $3, $4, 'ml')`, [pid, 'Parity ' + k, k % 4 === 0 ? 8 : null, psize]);
    await q(`insert into stock_moves (product_id, type, qty, created_at) values ($1, 'in', 500, $2)`, [pid, iso(-100)]);
    const tagged = pool.filter(() => rnd() < 0.7);
    if (k === 13) tagged.length = 0; // one with nothing ticked
    for (const [n] of tagged) await q(`insert into service_usage (service_id, product_id, weight) values ($1, $2, $3)`, [svc[n].id, pid, pick([1, 1, 0.5, 1.5, 2.25])]);
    // events over ~40 days
    let h = 0;
    const open = [];
    for (let e = 0; e < 70; e++) {
      h += rnd() * 14;
      const x = rnd();
      if (x < 0.14 || !open.length && x < 0.3) {
        const id = randomUUID();
        const stf = pick(staff).id;
        const last = open.length ? pick(['empty', 'empty', 'empty', 'no_empty', 'in_use']) : null;
        await q(`insert into stock_moves (id, product_id, type, qty, unit_cost, staff_id, empty_returned, created_at, unit_size) values ($1, $2, 'use', $3, 400, $4, $5, $6, $7)`,
          [id, pid, -(rnd() < 0.15 ? 3 : 1), stf, last ? last === 'empty' : null, iso(h), pick([null, null, null, 500, 1500])]);
        if (last && last !== 'in_use') {
          const i = Math.max(0, open.findIndex((o) => o.staff === stf));
          const [o] = open.splice(i, 1);
          await q(`insert into unit_ends (move_id, product_id, ended_at, how, by_move) values ($1, $2, $3, $4, $5)`, [o.id, pid, iso(h), last, id]);
        }
        open.push({ id, staff: stf });
      } else if (x < 0.17 && open.length) {
        for (const o of open.splice(0)) await q(`insert into unit_ends (move_id, product_id, ended_at, how) values ($1, $2, $3, 'finished')`, [o.id, pid, iso(h)]);
      } else if (x < 0.22) {
        const [n, opts] = pick(pool);
        await q(`insert into free_uses (service_id, option_label, qty, reason, created_at) values ($1, $2, $3, 'redo', $4)`, [svc[n].id, opts ? pick(opts) : null, pick([1, 1, 2]), iso(h)]);
      } else {
        const bid = randomUUID();
        await q(`insert into bills (id, bill_no, created_at, subtotal, taxable, total, pay_mode, status) values ($1, $2, $3, 0, 0, 0, 'Cash', $4)`, [bid, 'PAR-' + (++billNo), iso(h), rnd() < 0.08 ? 'cancelled' : 'paid']);
        for (let j = 0; j < ri(1, 3); j++) {
          const [n, opts] = pick(pool);
          const nm = n + (opts ? ` (${pick(opts)}${rnd() < 0.3 ? ' · Thick' : ''})` : '');
          await q(`insert into bill_items (bill_id, created_at, item_type, service_id, name, qty, unit_price, amount, taxable) values ($1, $2, 'service', $3, $4, $5, 0, 0, 0)`, [bid, iso(h), svc[n].id, nm, pick([1, 1, 1, 2])]);
        }
      }
    }
  }
  const T = async (t) => q(`select * from ${t}`);
  const [moves, ends, billsRows, items, tags, freeUses] = await Promise.all(['stock_moves', 'unit_ends', 'bills', 'bill_items', 'service_usage', 'free_uses'].map(T));
  const iso2 = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
  const J = { moves: moves.map(iso2), ends: ends.map(iso2), bills: Object.fromEntries(billsRows.map((b) => [b.id, iso2(b)])), items: items.map(iso2), tags, freeUses: freeUses.map(iso2) };
  let units = 0, bad = 0;
  for (const since of [iso(-200), iso(300), iso(700)]) {
    const rep = (await q(`select unit_report($1::timestamptz) r`, [since]))[0].r;
    for (const pid of prods) {
      const sqlRows = (rep.products.find((x) => x.product_id === pid) || { units: [] }).units;
      const jsRows = productUnits({ productId: pid, productSize: sizes[pid], ...J, from: since });
      if (sqlRows.length !== jsRows.length) { bad++; fails.push(`✗ parity: ${pid} from ${since}: ${sqlRows.length} vs ${jsRows.length} units`); continue; }
      sqlRows.forEach((a, i) => {
        const b = jsRows[i];
        units++;
        const same = a.move_id === b.move_id && a.how === b.how && a.is_first === b.is_first && Math.abs(Number(a.uses) - b.uses) <= 0.011
          && Math.abs(Number(a.clients) - b.clients) <= 0.011 && Number(a.n) === Number(b.n) && (a.ended_at ? +new Date(a.ended_at) : null) === (b.ended_at ? +new Date(b.ended_at) : null)
          && (a.scale == null ? b.scale == null : Number(a.scale) === b.scale);
        if (!same) { bad++; if (bad < 5) fails.push(`✗ parity: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`); }
      });
    }
  }
  check(`the database and the app count the same uses (${units} units, 3 windows)`, bad === 0 && units > 150, `${bad} different of ${units}`);
  // normal: the same in both (180 days back from now: these are older, so use a window that includes them)
  let nbad = 0;
  for (const pid of prods) {
    const sqlN = (await q(`select unit_normal($1) n`, [pid]))[0].n;
    const p = (await q(`select uses_per_unit from products where id = $1`, [pid]))[0];
    const jsN = unitNormal(p, productUnits({ productId: pid, productSize: sizes[pid], ...J, from: new Date(Date.now() - 180 * 86400e3).toISOString() }));
    const sameN = (sqlN.normal == null ? null : Number(sqlN.normal)) === jsN.normal && sqlN.learned_n === jsN.learnedN;
    if (!sameN) { nbad++; fails.push(`✗ normal parity ${JSON.stringify(sqlN)} vs ${JSON.stringify(jsN)}`); }
  }
  check('the database and the app agree on normal', nbad === 0);
  check('the parity data has shared units, batches, gaps, finished and no-empty ends, other sizes', moves.some((m) => Number(m.unit_size) === 500) && moves.some((m) => Number(m.qty) === -3) && ends.some((e) => e.how === 'finished') && ends.some((e) => e.how === 'no_empty')
    && (await q(`select count(*)::int n from unit_report('2026-01-01'::timestamptz) r, jsonb_array_elements(r -> 'products') p, jsonb_array_elements(p -> 'units') u where u ->> 'how' = 'gap'`))[0].n > 0);
}

// ---------- 11c. Telegram stock alerts: what the database tells the Telegram function ----------
{
  const pid = randomUUID();
  const rtu = services.find((x) => x.name === "Men's Global Colour"); // not used by the parity products
  await q(`insert into products (id, name, brand, kind, unit, cost_price, low_stock, uses_per_unit) values ($1, 'Developer 1 L', 'L''Oreal', 'salon', 'bottle', 450, 1, 10)`, [pid]);
  await q(`insert into service_usage (service_id, product_id) values ($1, $2)`, [rtu.id, pid]);
  await q(`insert into stock_moves (product_id, type, qty, created_at) values ($1, 'in', 4, now() - interval '3 days')`, [pid]);
  const g = async (body) => (await as(owner, sOwner, () => q(`select * from issue_stock($1)`, [JSON.stringify({ product_id: pid, qty: 1, staff_id: staff[0].id, ...body })])))[0];
  const bill = async (n, back) => {
    for (let i = 0; i < n; i++) {
      const bid = randomUUID();
      await q(`insert into bills (id, bill_no, created_at, subtotal, taxable, total, pay_mode) values ($1, $2, now() - $3::interval, 0, 0, 0, 'UPI')`, [bid, 'AL-' + bid.slice(0, 8), back]);
      await q(`insert into bill_items (bill_id, item_type, service_id, name, qty, unit_price, amount, taxable) values ($1, 'service', $2, 'Men''s Global Colour', 1, 0, 0, 0)`, [bid, rtu.id]);
    }
  };
  // bottle 0 two days ago (the first one ever), bottle 1 yesterday (served 3 Root Touch-Ups), bottle 2 now: early, 3 of 10
  const m0 = await g({ id: randomUUID(), last: 'empty' });
  const m1 = await g({ id: randomUUID(), last: 'empty' });
  await q(`update stock_moves set created_at = now() - interval '2 days' where id = $1`, [m0.id]);
  await q(`update stock_moves set created_at = now() - interval '1 day' where id = $1`, [m1.id]);
  await q(`update unit_ends set ended_at = now() - interval '1 day' where by_move = $1`, [m1.id]);
  await bill(3, '20 hours');
  const m2 = await g({ id: randomUUID(), last: 'empty' });
  const a2 = (await q(`select unit_alert($1) a`, [m2.id]))[0].a;
  check('alert: the one it replaced served 3 of 10 → finished early', a2 && a2.ended && a2.ended.early && !a2.ended.first && Number(a2.ended.uses) === 3 && Number(a2.ended.normal) === 10
    && a2.ended.normal_source === 'set' && a2.ended.given_to === staff[0].name && a2.product === 'Developer 1 L' && a2.brand === "L'Oreal", JSON.stringify(a2));
  check('alert: value not explained = 70% × ₹450 = ₹315', a2 && Number(a2.ended.value) === 315);
  check('alert: stock now 1 of alert 1, was 2 → running low', a2 && Number(a2.stock) === 1 && Number(a2.before) === 2 && Number(a2.low_stock) === 1);
  check('alert: only once', (await q(`select unit_alert($1) a`, [m2.id]))[0].a === null);
  check('alert: the first one ever is not called early', (await q(`select unit_ended_info($1) a`, [m0.id]))[0].a.first === true && (await q(`select unit_ended_info($1) a`, [m0.id]))[0].a.early === false);
  const m3 = await g({ id: randomUUID(), last: 'in_use' });
  const a3 = (await q(`select unit_alert($1) a`, [m3.id]))[0].a;
  check('alert: the last sealed one given out (none in the store); nothing ended', a3 && Number(a3.stock) === 0 && !a3.ended, JSON.stringify(a3));
  await q(`update stock_moves set created_at = now() - interval '11 minutes' where id = $1`, [m3.id]);
  await q(`delete from alerts_sent where ref = $1`, [m3.id]);
  check('alert: not after 10 minutes', (await q(`select unit_alert($1) a`, [m3.id]))[0].a === null);
  await q(`update stock_moves set created_at = now() - interval '1 second' where id = $1`, [m3.id]);
  // after a bill: the ones in use almost finished (90% of 10) with none in the store
  await bill(4, '0 seconds');
  const newest = async () => (await q(`select id from bills where bill_no like 'AL-%' order by created_at desc, id limit 1`))[0].id;
  check('bill alert: not yet (4 services shared between the two in use: 2 each)', ((await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a || []).length === 0);
  await bill(14, '0 seconds');
  const al = (await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a;
  check('bill alert: both in use reached 9 of 10 with none in the store → told, each once', Array.isArray(al) && al.length === 2 && al.every((x) => Number(x.uses) === 9 && Number(x.normal) === 10 && x.product === 'Developer 1 L'), JSON.stringify(al));
  check('bill alert: only once per bottle', ((await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a || []).length === 0);
  await bill(1, '20 minutes');
  const oldBill = (await q(`select id from bills where bill_no like 'AL-%' and created_at < now() - interval '15 minutes' order by created_at desc limit 1`))[0].id;
  check('bill alert: a bill older than 10 minutes says nothing', ((await q(`select bill_stock_alert($1) a`, [oldBill]))[0].a || []).length === 0);
  // one of the two is empty ("One is empty"): told if it finished early
  await as(owner, sOwner, () => q(`select * from end_unit($1)`, [JSON.stringify({ move_id: m2.id, how: 'no_empty' })]));
  const ae = (await q(`select unit_end_alert($1) a`, [m2.id]))[0].a;
  check('one is empty: it served 9 + the late bill, not early; told how it ended', ae && ae.ended && ae.ended.how === 'no_empty' && ae.ended.early === false, JSON.stringify(ae));
  check('one is empty: only once', (await q(`select unit_end_alert($1) a`, [m2.id]))[0].a === null);
  // a use without a bill
  const fid = (await as(clerk, sClerk, () => q(`select id from record_free_use($1)`, [JSON.stringify({ service_id: rtu.id, staff_id: staff[1].id, reason: 'staff', note: 'own roots' })])))[0].id;
  const fa = (await q(`select free_use_alert($1) a`, [fid]))[0].a;
  check('free use alert: service, who, why, how many this month', fa && fa.service === "Men's Global Colour" && fa.staff === staff[1].name && fa.reason === 'staff' && fa.note === 'own roots' && Number(fa.this_month) >= 1, JSON.stringify(fa));
  check('free use alert: only once', (await q(`select free_use_alert($1) a`, [fid]))[0].a === null);
  // none in use in the app although it has been given out before → "not given out?", once a day
  await as(owner, sOwner, () => q(`select * from mark_finished($1)`, [JSON.stringify({ id: randomUUID(), product_id: pid })]));
  await bill(1, '0 seconds');
  const gp = (await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a;
  check('gap alert: a service billed with none in use → told, with the service', Array.isArray(gp) && gp.length === 1 && gp[0].kind === 'gap' && gp[0].product === 'Developer 1 L' && gp[0].service === "Men's Global Colour", JSON.stringify(gp));
  await bill(1, '0 seconds');
  check('gap alert: once a day per product', ((await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a || []).length === 0);
  const never = randomUUID();
  await q(`insert into products (id, name, kind, unit, cost_price) values ($1, 'Never given out', 'salon', 'jar', 100)`, [never]);
  await q(`insert into service_usage (service_id, product_id) values ($1, $2)`, [rtu.id, never]);
  await bill(1, '0 seconds');
  check('gap alert: not for a product never given out yet', ((await q(`select bill_stock_alert($1) a`, [await newest()]))[0].a || []).every((x) => x.product !== 'Never given out'));
}

// ---------- 11d. pack sizes, the early rule, repeats, weekly checks of the one in use ----------
{
  const C = (user, sess) => (sql, p) => as(user, sess, () => tryq(sql, p));
  const clerkQ = C(clerk, sClerk), ownerQ = C(owner, sOwner);
  const svc = services.find((x) => x.name === "Women's Global Colour");
  const pid = randomUUID();
  await q(`insert into products (id, name, kind, unit, cost_price, size, size_unit, uses_per_unit) values ($1, 'Developer 1 L sizes', 'salon', 'bottle', 400, 1000, 'ml', 10)`, [pid]);
  await q(`insert into service_usage (service_id, product_id) values ($1, $2)`, [svc.id, pid]);
  await q(`insert into stock_moves (product_id, type, qty, created_at) values ($1, 'in', 6, now() - interval '30 days')`, [pid]);
  check('a delivery of another pack size is kept on the stock in', !(await clerkQ(`insert into stock_moves (product_id, type, qty, unit_size) values ($1, 'in', 2, 500)`, [pid])).error);
  check('a pack size of 0 is refused', !!(await clerkQ(`insert into stock_moves (product_id, type, qty, unit_size) values ($1, 'in', 1, 0)`, [pid])).error);
  const give = async (body, days) => {
    const id = randomUUID();
    const r = await as(owner, sOwner, () => tryq(`select * from issue_stock($1)`, [JSON.stringify({ id, product_id: pid, qty: 1, staff_id: staff[0].id, last: 'empty', ...body })]));
    if (r.error) return r;
    await q(`update stock_moves set created_at = now() - ($2 || ' days')::interval where id = $1`, [id, String(days)]);
    await q(`update unit_ends set ended_at = now() - ($2 || ' days')::interval where by_move = $1`, [id, String(days)]);
    return { id, row: (await q(`select * from stock_moves where id = $1`, [id]))[0] };
  };
  const bills = async (n, daysAgo, name = "Women's Global Colour (S)") => {
    for (let i = 0; i < n; i++) {
      const bid = randomUUID();
      await q(`insert into bills (id, bill_no, created_at, subtotal, taxable, total, pay_mode) values ($1, $2, now() - ($3 || ' days')::interval, 0, 0, 0, 'UPI')`, [bid, 'SZ-' + bid.slice(0, 8), String(daysAgo)]);
      await q(`insert into bill_items (bill_id, item_type, service_id, name, qty, unit_price, amount, taxable) values ($1, 'service', $2, $3, 1, 0, 0, 0)`, [bid, svc.id, name]);
    }
  };
  check('give-out size 0 refused', /more than 0/.test((await as(owner, sOwner, () => tryq(`select * from issue_stock($1)`, [JSON.stringify({ product_id: pid, qty: 1, staff_id: staff[0].id, unit_size: 0 })]))).error || ''));
  const u0 = await give({}, 25);
  check('a give-out without a size is the product\'s size (1,000 ml)', Number(u0.row.unit_size) === 1000);
  await bills(10, 24);
  const u1 = await give({}, 20);
  await bills(5, 19);
  const u2 = await give({ unit_size: 500 }, 18);                       // the 500 ml one, 5 services: fine for its size
  check('a 500 ml one is recorded as 500 ml', Number(u2.row.unit_size) === 500);
  await bills(1, 17);
  const u3 = await give({ staff_id: staff[1].id }, 16);                // the 500 ml one ended at… wait: u2 served 1 → early (1 of 5)
  const pu = async () => (await q(`select * from product_units($1, now() - interval '60 days') x where x.move_id is not null order by x.started_at`, [pid]));
  let rows = await pu();
  const by = (id) => rows.find((x) => x.move_id === id);
  check('scale: the 500 ml one is 0.5 of the usual size', Number(by(u2.id).scale) === 0.5 && Number(by(u1.id).scale) === 1, JSON.stringify(rows.map((x) => [x.unit_size, x.scale])));
  const i1 = (await q(`select unit_ended_info($1) a`, [u1.id]))[0].a;
  check('the 1 L one that served 5 of 10 → early', i1.early === true && Number(i1.normal) === 10, JSON.stringify(i1));
  const i2 = (await q(`select unit_ended_info($1) a`, [u2.id]))[0].a;
  check('the 500 ml one expects 5; it served 1 → early, ₹ from its own cost', i2.early === true && Number(i2.normal) === 5 && Number(i2.uses) === 1 && Number(i2.scale) === 0.5, JSON.stringify(i2));
  check('…and the history: one more early in 90 days, given to the same person', Number(i2.early_before) === 1 && Number(i2.early_same_person) === 1, JSON.stringify(i2));
  // the early rule needs a whole service short
  check('unit_early: 4 of 10 yes, 7 of 10 no, 1.5 of 2.5 yes, 0.4 of 1.2 no (not a whole service short)',
    (await q(`select unit_early(4, 10) a, unit_early(7, 10) b, unit_early(1.5, 2.5) c, unit_early(0.4, 1.2) d`))[0].a === true
      && (await q(`select unit_early(7, 10) b`))[0].b === false && (await q(`select unit_early(1.5, 2.5) c`))[0].c === true && (await q(`select unit_early(0.4, 1.2) d`))[0].d === false);
  // normal learned per usual size: a 500 ml one that did 5 counts as 10
  await q(`update products set uses_per_unit = null where id = $1`, [pid]);
  const n1 = (await q(`select unit_normal($1) n`, [pid]))[0].n;
  check('learned normal is per the usual size (1 L): 5 and 1×2 → still learning with 2', n1.learned_n === 2 && n1.normal === null, JSON.stringify(n1));
  // weekly check of the one in use: owner only
  check('counter cannot record or read a check of the one in use', !!(await clerkQ(`insert into unit_checks (move_id, product_id, left_pct) values ($1, $2, 50)`, [u3.id, pid])).error
    && (await clerkQ(`select count(*)::int n from unit_checks`))[0].n === 0);
  check('owner records one', !(await ownerQ(`insert into unit_checks (move_id, product_id, left_pct, uses_at, expected_at) values ($1, $2, 50, 1, 5)`, [u3.id, pid])).error
    && (await ownerQ(`select count(*)::int n from unit_checks`))[0].n === 1);
  check('how much left: 0 to 100', !!(await ownerQ(`insert into unit_checks (move_id, product_id, left_pct) values ($1, $2, 120)`, [u3.id, pid])).error);
  // the database and the app agree with sizes too
  const J = async (t) => (await q(`select * from ${t}`)).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v])));
  const [mv, en, bl, it, tg, fu] = await Promise.all(['stock_moves', 'unit_ends', 'bills', 'bill_items', 'service_usage', 'free_uses'].map(J));
  const js = productUnits({ productId: pid, productSize: 1000, moves: mv, ends: en, bills: Object.fromEntries(bl.map((b) => [b.id, b])), items: it, tags: tg, freeUses: fu, from: new Date(Date.now() - 60 * 86400e3).toISOString() })
    .filter((x) => x.move_id);
  rows = await pu();
  check('sizes: the database and the app agree (uses and scale)', js.length === rows.length && js.every((x, i) => x.move_id === rows[i].move_id && Math.abs(x.uses - Number(rows[i].uses)) < 0.011 && x.scale === Number(rows[i].scale)),
    JSON.stringify([js.map((x) => [x.uses, x.scale]), rows.map((x) => [x.uses, x.scale])]));
  const jn = unitNormal({ uses_per_unit: null }, productUnits({ productId: pid, productSize: 1000, moves: mv, ends: en, bills: Object.fromEntries(bl.map((b) => [b.id, b])), items: it, tags: tg, freeUses: fu, from: new Date(Date.now() - 180 * 86400e3).toISOString() }));
  check('sizes: normal agrees', jn.learnedN === n1.learned_n && jn.normal === n1.normal);
}


// ---------- 12. prices and offers are checked against the menu (a crafted request can't hide a discount) ----------
{
  await q(`update settings set value = '20' where key = 'max_discount_pct'`);
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  const byName = async (n) => (await q(`select * from services where name = $1`, [n]))[0];
  // round test prices on three chart services (a price change is a menu change like any other)
  await q(`update services set price = 1500 where name in ('Men''s Anti-dandruff Treatment', 'Men''s Highlights')`);
  await q(`update services set variants = '[{"label":"S","price":3000},{"label":"M","price":3500},{"label":"L","price":4000},{"label":"XL","price":4500}]' where name = 'Women''s Global Colour'`);
  await q(`update offers set sections = '{Hair,Colour,"Hair Spa","Hair Treatments"}' where id = $1`, [offers[0].id]); // the Pujo offer on every hair tab
  const fixed = await byName("Men's Anti-dandruff Treatment"); // ₹1,500, one price
  const opts = await byName("Women's Global Colour");       // S 3000 … XL 4500
  const open = await byName('Bridal Makeup');               // from ₹10,000, typed at billing
  const hair = await byName("Men's Highlights");            // ₹1,500, Colour tab, for the Pujo offer
  const prod = products[0];
  const make = (lines, extra = {}) => {
    const b = calcBill(lines.map((l, i) => ({ id: i + 1, qty: 1, gst_pct: 5, staff_id: staff[0].id, ...l })), { gstOn: true, inclusive: true, ...(extra.disc || {}) });
    return { id: randomUUID(), customer_phone: extra.phone || '', subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst,
      round_off: b.round_off, total: b.total, pay_mode: 'Cash', paid_cash: b.total, paid_upi: 0, paid_card: 0, ...(extra.offline ? { bill_no: `HF${fy}-T${String(ri(1000, 9999))}`, created_at: extra.at || new Date(Date.now() - 3600e3).toISOString() } : {}),
      items: b.items.map((l) => ({ ...l, staff_name: 'x', offer_id: l.offer_id || '', offer_name: l.offer_name || '', offer_discount: l.offer_discount || 0 })) };
  };
  const save = (b) => C(`select * from create_bill($1)`, [JSON.stringify(b)]);
  const refused = async (name, b) => { const r = await save(b); check(`refused: ${name}`, /Owner approval needed: the discount is above|not on the menu/.test(r.error || ''), JSON.stringify(r).slice(0, 300)); };
  const noted = async (name, b, re) => { const r = await save(b); check(`saved with a CHECK note: ${name}`, !r.error && re.test(r[0].note || ''), JSON.stringify(r).slice(0, 300)); };
  const clean = async (name, b) => { const r = await save(b); check(`saved, nothing to check: ${name}`, !r.error && !/CHECK|Not on the menu/.test(r[0].note || ''), JSON.stringify(r).slice(0, 300)); };
  const S = (svc, price, more = {}) => ({ item_type: 'service', service_id: svc.id, name: svc.name, category: svc.category, unit_price: price, ...more });

  // prices
  await clean('menu price', make([S(fixed, 1500)]));
  await clean('one of the options (size M)', make([S(opts, 3500)]));
  await clean('"onwards" service above its starting price', make([S(open, 14000)]));
  const nano = await byName('Nanoplastia');
  await clean('treatment, long and thick hair (L ₹6,999 + ₹500)', make([S(nano, 7499, { name: 'Nanoplastia (L · Thick)' })]));
  const rtuF = await byName('Root Touch-up');
  await clean('root touch-up typed at ₹1,599 (from ₹1,299)', make([S(rtuF, 1599)]));
  await noted('root touch-up typed below ₹1,299: counted as discount', make([S(rtuF, 1199)]), /CHECK: ₹100 below menu prices.*Root Touch-up at ₹1199, menu ₹1299/);
  await refused('₹1,500 service billed at ₹500 (67% hidden off)', make([S(fixed, 500)]));
  await noted('₹1,500 service billed at ₹1,350 (10% hidden, within the limit)', make([S(fixed, 1350)]), /CHECK: ₹150 below menu prices.*Men's Anti-dandruff Treatment at ₹1350, menu ₹1500/);
  await refused('colour below its cheapest option', make([S(opts, 1000)]));
  await refused('"onwards" service below its starting price', make([S(open, 5000)]));
  await refused('product below its price', make([{ item_type: 'product', product_id: prod.id, name: prod.name, unit_price: 50, gst_pct: 18 }]));
  await refused('hidden price cut + a counter discount together over the limit', make([S(fixed, 1350)], { disc: { discountType: 'pct', discountValue: 15 } }));
  await refused('a service that is not on the menu (online)', make([{ item_type: 'service', service_id: randomUUID(), name: 'Global Colour', unit_price: 500 }]));
  await refused('a service line with no service at all (online)', make([{ item_type: 'service', name: 'Global Colour', unit_price: 500 }]));
  await noted('offline bill: a service removed since', make([{ item_type: 'service', service_id: randomUUID(), name: 'Old service', unit_price: 500 }], { offline: true }), /Not on the menu any more: Old service/);
  // offers
  const pujo = offers[0]; // 20% on Hair, up to ₹500
  const off = (o, d) => ({ offer_id: o.id, offer_name: o.name, offer_discount: d });
  await clean('Pujo 20% on a hair service, as the offer says', make([S(hair, 1500, off(pujo, 300))]));
  await refused('Pujo "20%" claimed as 60%', make([S(hair, 1500, off(pujo, 900))]));
  await noted('Pujo cap ₹500 passed across two lines (₹400 over: 10%, noted)', make([S(hair, 1500, off(pujo, 300)), S(opts, 3000, off(pujo, 600))]), /CHECK: ₹400.*offer cap ₹500 passed/);
  await refused('Pujo cap passed + a counter discount', make([S(hair, 1500, off(pujo, 300)), S(opts, 3000, off(pujo, 600))], { disc: { discountType: 'pct', discountValue: 12 } }));
  await clean('Pujo cap ₹500 shared across two lines', make([S(hair, 1500, off(pujo, 167)), S(opts, 3000, off(pujo, 333))]));
  await refused('hair offer on a beauty service', make([S(await byName('Lotus Hydravitals Facial (Dry Skin)'), 2500, off(pujo, 600))]));
  await refused('an offer that does not exist', make([S(fixed, 1500, { offer_id: randomUUID(), offer_name: 'Staff special', offer_discount: 1000 })]));
  await refused('an offer discount with no offer at all', make([S(fixed, 1500, { offer_id: '', offer_name: 'Diwali', offer_discount: 1000 })]));
  const over = offers[2]; // 10% on everything over ₹3,000
  await refused('"over ₹3,000" offer on a ₹1,500 bill (10% + 15% counter discount)', make([S(fixed, 1500, off(over, 150))], { disc: { discountType: 'pct', discountValue: 15 } }));
  await noted('"over ₹3,000" offer on a ₹1,500 bill alone (10%, within the limit)', make([S(fixed, 1500, off(over, 150))]), /CHECK: ₹150.*allowed ₹0/);
  const first = offers[3]; // ₹199 first-visit cut
  const ladies = services[0];
  await clean('first-visit price for a new number', make([S(ladies, 800, off(first, 601))], { phone: '9876500012' }));
  await refused('first-visit price for a returning customer', make([S(ladies, 800, off(first, 601))], { phone: '9876500012' }));
  // offers that are off, or not on today
  await q(`update offers set active = false where id = $1`, [pujo.id]);
  await noted('offer switched off, online (20%: at the limit, noted)', make([S(hair, 1500, off(pujo, 300))]), /CHECK: ₹300/);
  await refused('offer switched off, online, with a counter discount too', make([S(hair, 1500, off(pujo, 300))], { disc: { discountType: 'pct', discountValue: 10 } }));
  await clean('offer switched off after an offline bill used it', make([S(hair, 1500, off(pujo, 300))], { offline: true }));
  await q(`update offers set active = true, ends_on = current_date - 3 where id = $1`, [pujo.id]);
  await noted('offer that ended (online): counted and noted', make([S(hair, 1500, off(pujo, 300))]), /CHECK: ₹300/);
  await refused('offer that ended + a counter discount', make([S(hair, 1500, off(pujo, 300))], { disc: { discountType: 'pct', discountValue: 10 } }));
  await noted('offline bill dated after the offer ended', make([S(hair, 1500, off(pujo, 300))], { offline: true }), /CHECK: ₹300/);
  await clean('offline bill made while the offer was on', make([S(hair, 1500, off(pujo, 300))], { offline: true, at: new Date(Date.now() - 4 * 86400e3).toISOString() }));
  // the price went up after an offline bill was made: allowed
  const at = new Date(Date.now() - 2 * 3600e3).toISOString();
  await as(owner, sOwner, () => q(`select * from save_service($1)`, [JSON.stringify({ id: fixed.id, price: 1699 })]));
  await clean('offline bill at the old price, made before the price went up', make([S(fixed, 1500)], { offline: true, at }));
  await noted('online bill at the old price after it went up: counted', make([S(fixed, 1500)]), /CHECK: ₹199/);
  const late = await save(make([S(fixed, 1699)], { offline: true, at: new Date(Date.now() - 2 * 86400e3).toISOString() }));
  check('offline bill uploaded days later says so', !late.error && /Made offline .* uploaded /.test(late[0].note || ''), JSON.stringify(late).slice(0, 200));
  await q(`update offers set ends_on = null where id = $1`, [pujo.id]);
  // the owner can still give any discount
  check('owner login: a big discount still saves', !(await as(owner, sOwner, () => tryq(`select * from create_bill($1)`, [JSON.stringify(make([S(fixed, 500)]))]))).error);
  // stock changes only through stock moves
  check('counter cannot set a stock count directly', /Stock changes only through/.test((await C(`update products set stock = 999 where id = $1`, [prod.id])).error || ''));
  check('owner login cannot either (use Count stock)', /Stock changes only through/.test((await as(owner, sOwner, () => tryq(`update products set stock = 999 where id = $1`, [prod.id]))).error || ''));
  check('counter cannot record a negative "stock in" (a hidden take-out)', !!(await C(`insert into stock_moves (product_id, type, qty) values ($1, 'in', -5)`, [prod.id])).error);
  check('nor a zero one', !!(await C(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 0)`, [prod.id])).error);
  check('stock in still works', !(await C(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 2)`, [prod.id])).error);
  check('stock = sum of its moves', Number((await q(`select stock from products where id = $1`, [prod.id]))[0].stock) === Number((await q(`select sum(qty) s from stock_moves where product_id = $1`, [prod.id]))[0].s));
}

// ---------- 13. past bills (owner only) and discounts on single lines ----------
{
  await q(`update settings set value = '20' where key = 'max_discount_pct'`);
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  const O = (sql, p) => as(owner, sOwner, () => tryq(sql, p));
  const save = (who, p) => (who === 'owner' ? O : C)(`select * from create_bill($1)`, [JSON.stringify(p)]);
  const dayAgo = (n) => new Date(Date.now() + 5.5 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
  const when = (n, hm) => new Date(`${dayAgo(n)}T${hm}:00+05:30`).toISOString();
  const svc = (n) => services.find((x) => x.name === n);
  const cut = svc("Men's Haircut & Styling");
  const prod = products[0];
  // a bill as the billing screen makes it, from lines (with their own discounts) and a bill discount
  const make = (lines, extra = {}, d = {}) => {
    const b = calcBill(lines.map((l, i) => ({ id: i + 1, qty: 1, gst_pct: 5, staff_id: staff[0].id, ...l })), { gstOn: false, inclusive: true, ...d });
    return { id: randomUUID(), customer_phone: extra.phone || '', customer_name: extra.phone ? 'Past Customer' : '', subtotal: b.subtotal, offer_discount: b.offerDiscount,
      discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, pay_mode: 'Cash', paid_cash: b.total, paid_upi: 0, paid_card: 0,
      created_by: 'krishna@habibs', ...extra,
      items: b.items.map((l) => ({ ...l, staff_name: staff[0].name, offer_id: '', offer_name: '', line_discount: l.line_discount, hsn_sac: '' })) };
  };
  const S = (s, price, more = {}) => ({ item_type: 'service', service_id: s.id, name: s.name, category: s.category, unit_price: price, ...more });
  const pastOf = (lines, extra = {}) => make(lines, { past: true, created_at: when(3, '11:30'), paper_no: 'Book 1 / 17', ...extra });

  // who may add one
  check('counter: a past bill is refused', /Only the owner can add a past bill/.test((await save('clerk', pastOf([S(cut, 600)]))).error || ''));
  const tg = randomUUID();
  await q(`insert into owner_grants (id, session_id, user_id, action, method, status, expires_at) values ($1, $2, $3, 'unlock', 'telegram', 'approved', now() + interval '10 minutes')`, [tg, sClerk, clerk]);
  check('…also with owner screens unlocked on Telegram (the owner must be here)', /Only the owner can add a past bill/.test((await save('clerk', pastOf([S(cut, 600)]))).error || ''));
  await q(`update owner_grants set expires_at = now() where id = $1`, [tg]);
  const code = randomUUID();
  await q(`insert into owner_grants (id, session_id, user_id, action, method, status, expires_at) values ($1, $2, $3, 'unlock', 'code', 'approved', now() + interval '10 minutes')`, [code, sClerk, clerk]);
  const normalBefore = (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value;
  const p1 = pastOf([S(cut, 600), { item_type: 'product', product_id: prod.id, name: prod.name, category: 'Products', unit_price: Number(prod.sell_price), qty: 2 }], { phone: '9876512345' });
  const r1 = await save('clerk', p1);
  const pfy = (await q(`select fy_code($1::timestamptz) f`, [p1.created_at]))[0].f;
  check('the owner\'s code at the counter: saved as HF…-P0001, in its own series', !r1.error && r1[0].bill_no === `HF${pfy}-P0001`, JSON.stringify(r1).slice(0, 300));
  const b1 = r1[0];
  check('…dated the day and time typed', new Date(b1.created_at).toISOString() === p1.created_at);
  check('…with a note: past bill, the paper bill number, when and by whom it was typed in', /^Past bill, paper bill no\. Book 1 \/ 17, typed in \d\d \w{3} \d{4} \d\d:\d\d by krishna@habibs/.test(b1.note || ''), b1.note);
  check('…at the price on the paper bill (₹600; today ₹349), without a menu CHECK note', !/CHECK/.test(b1.note || ''));
  check('…its product left the stock on that day', (await q(`select created_at from stock_moves where bill_id = $1`, [b1.id])).every((m) => new Date(m.created_at).toISOString() === p1.created_at));
  const r1b = await save('clerk', pastOf([S(cut, 100)], { created_at: when(2, '18:05'), paper_no: '' }));
  check('a price far below the menu is fine on a past bill (no CHECK, no owner question)', !r1b.error && r1b[0].bill_no === `HF${pfy}-P0002` && !/CHECK/.test(r1b[0].note || '') && /^Past bill, typed in/.test(r1b[0].note || ''), JSON.stringify(r1b).slice(0, 300));
  check('today\'s bill numbers didn\'t move', (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value === normalBefore);
  const nb = await save('clerk', make([S(cut, 349)]));
  check('…and the next bill today is the next normal number', !nb.error && nb[0].bill_no === `HF${fy}-${String(normalBefore + 1).padStart(4, '0')}`, JSON.stringify(nb).slice(0, 200));
  await q(`update owner_grants set expires_at = now() where id = $1`, [code]);
  check('code unlock over: refused again', /Only the owner/.test((await save('clerk', pastOf([S(cut, 600)]))).error || ''));
  const r2 = await save('owner', pastOf([S(cut, 600)], { created_at: when(1, '10:00') }));
  check('owner login: saved, P0003', !r2.error && r2[0].bill_no === `HF${pfy}-P0003`, JSON.stringify(r2).slice(0, 200));
  // what is refused
  for (const [why, extra, re] of [
    ['a time after now', { created_at: new Date(Date.now() + 3600e3).toISOString() }, /before now/],
    ['more than 400 days ago', { created_at: new Date(Date.now() - 401 * 86400e3).toISOString() }, /400 days/],
    ['no day and time', { created_at: '' }, /day and time/],
    ['made offline', { bill_no: 'HF2627-A0001' }, /internet/],
  ]) check(`past bill refused: ${why}`, re.test((await save('owner', pastOf([S(cut, 600)], extra))).error || ''), why);
  const withPts = pastOf([S(cut, 600)], { phone: '9876512345' });
  withPts.paid_cash = withPts.total - 100; withPts.paid_points = 100;
  check('past bill refused: points used on it', /points can't be used on a past bill/.test((await save('owner', withPts)).error || ''));
  // the customer: the past bill is their first visit now
  const c = (await q(`select * from customers where phone = '9876512345'`))[0];
  const later = await save('owner', make([S(cut, 349)], { phone: '9876512346' }));
  await save('owner', pastOf([S(cut, 600)], { phone: '9876512346', created_at: when(5, '12:00') }));
  const firsts = await q(`select bill_no, is_new_customer from bills where customer_phone = '9876512346' order by created_at`);
  check('a past bill before a customer\'s first bill becomes the first visit', firsts.length === 2 && firsts[0].is_new_customer === true && firsts[1].is_new_customer === false && !later.error, JSON.stringify(firsts));
  check('…visits and first visit follow', c.visits === 1 && (await q(`select visits, first_visit from customers where phone = '9876512346'`))[0].visits === 2);
  // the demo does the same
  await ldb.insert('owner_grants', { id: randomUUID(), action: 'unlock', method: 'code', status: 'approved', expires_at: new Date(Date.now() + 600e3).toISOString() });
  const dpast = await ldb.rpc('create_bill', { p: pastOf([S(cut, 600)]) });
  check('demo: a past bill gets its own series and the note', /^HF\d{4}-P0001$/.test(dpast.bill_no) && /^Past bill, paper bill no\. Book 1 \/ 17, typed in .+ by krishna@habibs/.test(dpast.note || ''), JSON.stringify([dpast.bill_no, dpast.note]));
  check('demo: the same refusals', /before now/.test(await ldb.rpc('create_bill', { p: pastOf([S(cut, 600)], { created_at: new Date(Date.now() + 3600e3).toISOString() }) }).then(() => '', (e) => e.message))
    && /internet/.test(await ldb.rpc('create_bill', { p: pastOf([S(cut, 600)], { bill_no: 'X-1' }) }).then(() => '', (e) => e.message)));

  // discounts on single lines
  const ld = make([S(cut, 349, { disc_type: 'amt', disc_value: 49 }), S(svc('Shave'), 149)]);
  const r3 = await save('clerk', ld);
  const li = r3.error ? [] : await q(`select name, line_discount, discount from bill_items where bill_id = $1 order by name`, [r3[0].id]);
  check('a ₹49 discount on one line: saved on that line, the other has none', !r3.error && Number(li.find((x) => /Haircut/.test(x.name)).line_discount) === 49 && Number(li.find((x) => x.name === 'Shave').line_discount) === 0, JSON.stringify([r3.error, li]));
  const big = make([S(cut, 349, { disc_type: 'pct', disc_value: 30 })]);
  check('line discounts count towards the owner\'s limit (30% on a one-line bill, limit 20%)', /Owner approval needed: the discount is above/.test((await save('clerk', big)).error || ''));
  const both = make([S(cut, 349, { disc_type: 'pct', disc_value: 15 })], {}, { discountType: 'pct', discountValue: 10 }); // 52.35 + 29.67 = 23.5%
  const under = make([S(cut, 349, { disc_type: 'pct', disc_value: 15 }), S(svc('Shave'), 149)], {}, { discountType: 'pct', discountValue: 10 }); // 96.92 of 498 = 19.5%
  check('line + bill discounts under 20% together: saved without the owner', !(await save('clerk', under)).error);
  check('line + bill discount over 20% together needs the owner', /Owner approval needed/.test((await save('clerk', both)).error || ''), JSON.stringify([both.discount, both.subtotal]));
  for (const [why, f] of [['more than the line\'s discount', (it) => ({ ...it, line_discount: Number(it.discount) + 0.01 })], ['below 0', (it) => ({ ...it, line_discount: -1 })]]) {
    const bad = { ...ld, id: randomUUID(), items: ld.items.map((it, i) => (i === 0 ? f(it) : it)) };
    check(`a line discount ${why} is refused`, /discount on this item is wrong/.test((await save('owner', bad)).error || ''), why);
  }
  const dld = await ldb.rpc('create_bill', { p: { ...ld, id: randomUUID() } });
  check('demo: the line discount is stored on the line', (await ldb.list('bill_items', { eq: { bill_id: dld.id } })).some((x) => Number(x.line_discount) === 49));
}

// ---------- 14. a staff member's own services: free or 50% off, commission on the full price ----------
{
  await q(`update settings set value = '20' where key = 'max_discount_pct'`);
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  const save = (p) => C(`select * from create_bill($1)`, [JSON.stringify(p)]);
  const dsave = (p) => ldb.rpc('create_bill', { p }).then((b) => b, (e) => ({ error: e.message }));
  const cur = {}; // the staff rules in Settings, as the billing screen has them
  const setBoth = async (key, value) => {
    cur[key] = value;
    await q(`update settings set value = $2 where key = $1`, [key, JSON.stringify(value)]);
    await ldb.upsert('settings', { key, value }, 'key');
  };
  // Amit's own number (typed with a space); Priya does his services
  const amit = staff[0], priya = staff[1];
  await q(`update staff set phone = '98300 12345' where id = $1`, [amit.id]);
  await ldb.update('staff', amit.id, { phone: '98300 12345', active: true });
  for (const x of staff.slice(1)) await ldb.update('staff', x.id, { active: true });
  const simple = (sec) => services.find((x) => x.section === sec && !(x.variants && x.variants.length) && !x.open_price && Number(x.price) > 0);
  const hair = simple('Hair'), facial = simple('Facials'), thread = simple('Threading');
  const sRules = () => staffPriceRules(cur);
  // as the billing screen makes it: service lines at the staff price (the % for their tab), offers off
  const mk = (lines, { phone = '9830012345', d = {}, gst = true, staffOn = true, tweak } = {}) => {
    const r = sRules();
    const ls = lines.map((l, i) => ({ id: i + 1, qty: 1, staff_id: priya.id, ...l }))
      .map((l) => (staffOn && l.item_type === 'service' ? { ...l, staff: true, disc_type: 'pct', disc_value: staffPctOf(svcById[l.service_id]?.section, r) } : l));
    const b = calcBill(tweak ? tweak(ls) : ls, { gstOn: gst, inclusive: true, ...d });
    return { id: randomUUID(), customer_phone: phone, customer_name: 'Amit Das', subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount,
      taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total, pay_mode: 'Cash', paid_cash: b.total, paid_upi: 0, paid_card: 0,
      items: b.items.map((l) => ({ item_type: l.item_type, service_id: l.service_id || '', product_id: l.product_id || '', name: l.name, category: l.category || '', hsn_sac: '',
        staff_id: l.staff_id, staff_name: priya.name, qty: l.qty, unit_price: l.unit_price, amount: l.amount, offer_id: l.offer_id || '', offer_name: l.offer_name || '',
        offer_discount: l.offer_discount || 0, line_discount: l.line_discount || 0, staff_discount: l.staff_discount || 0, commission_base: l.commission_base,
        discount: l.discount, taxable: l.taxable, gst_pct: l.gst_pct, gst: l.gst })) };
  };
  const S = (x) => ({ item_type: 'service', service_id: x.id, name: x.name, category: x.category, unit_price: Number(x.price), gst_pct: Number(x.gst_pct) || 5 });
  const prod = products[0];
  const PR = { item_type: 'product', product_id: prod.id, name: prod.name, category: 'Products', unit_price: Number(prod.sell_price), gst_pct: prod.gst_pct };

  const p1 = mk([S(hair), S(facial), PR]);
  const r1 = await save(p1);
  const d1 = await dsave({ ...p1 });
  const it1 = r1.error ? [] : await q(`select name, item_type, amount, line_discount, staff_discount, commission_base, taxable from bill_items where bill_id = $1`, [r1[0].id]);
  const H = it1.find((x) => x.name === hair.name) || {}, F = it1.find((x) => x.name === facial.name) || {}, PRx = it1.find((x) => x.item_type === 'product') || {};
  check(`staff bill: saved, for Amit (his number, typed with a space in Staff)`, !r1.error && r1[0].for_staff === amit.id, JSON.stringify(r1).slice(0, 300));
  check(`staff bill: ${hair.name} (Hair) free: ₹${hair.price} staff price`, P(H.staff_discount) === P(hair.price) && P(H.taxable) === 0, JSON.stringify(H));
  check(`staff bill: ${facial.name} (Facials) 50% off`, P(F.staff_discount) === Math.round(P(facial.price) / 2) && P(F.line_discount) === P(F.staff_discount), JSON.stringify(F));
  check('staff bill: the product at the normal price', P(PRx.staff_discount) === 0 && P(PRx.line_discount) === 0 && P(PRx.amount) === P(prod.sell_price), JSON.stringify(PRx));
  const exGst = (x) => Math.round((P(x.price) * 100) / (100 + (Number(x.gst_pct) || 5)));
  check('staff bill: Priya earns commission on the full price (before GST), not on ₹0', P(H.commission_base) === exGst(hair) && P(F.commission_base) === exGst(facial), JSON.stringify([H, F, hair.gst_pct]));
  check('staff bill: products keep commission on what was paid', P(PRx.commission_base) === P(PRx.taxable));
  check('staff bill: no points', r1[0]?.points_earned === 0);
  check('staff bill: no menu CHECK note, no owner question (staff prices are not the counter\'s discount)', !/CHECK/.test(r1[0]?.note || ''));
  check('demo: the same bill, for Amit, with the same staff prices', !d1.error && d1.for_staff === amit.id
    && (await ldb.list('bill_items', { eq: { bill_id: d1.id } })).map((x) => `${x.name}|${P(x.staff_discount)}|${P(x.commission_base)}`).sort().join() === it1.map((x) => `${x.name}|${P(x.staff_discount)}|${P(x.commission_base)}`).sort().join(), JSON.stringify(d1).slice(0, 200));
  const pay = calcPayroll({ staff: { ...priya, join_date: '2025-01-01' }, month: new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7), attendance: [], advances: [], lines: it1.map((x) => ({ ...x, staff_id: priya.id })) });
  check('payroll: Priya\'s service sales count the full price of Amit\'s services', P(pay.service_sales) === P(H.commission_base) + P(F.commission_base), JSON.stringify(pay.service_sales));

  // the owner's limit: staff prices don't count; the counter's own discount on top does
  check('a staff bill with only staff prices (100% and 50% off): no owner needed', !(await save(mk([S(hair), S(thread)]))).error);
  const extra = mk([S(facial), PR], { d: { discountType: 'pct', discountValue: 25 } });
  check('a 25% bill discount on top of staff prices needs the owner (limit 20%)', /Owner approval needed/.test((await save(extra)).error || ''));
  check('…15% is fine', !(await save(mk([S(facial), PR], { d: { discountType: 'pct', discountValue: 15 } }))).error);

  // refused, the same way in the demo
  const same = async (label, p, re) => {
    const a = (await save(p)).error || '', b = (await dsave({ ...p, id: randomUUID() })).error || '';
    check(label, re.test(a) && a === b, JSON.stringify([a, b]));
  };
  await same('staff price on a customer\'s number: refused', mk([S(hair)], { phone: '9830099999' }), /^Staff price: this mobile number is not a staff member's$/);
  await same('staff price on a product: refused', mk([PR], { tweak: (ls) => ls.map((l) => ({ ...l, staff: true, disc_type: 'pct', disc_value: 50 })) }), /^Staff price: only on services, not on Shampoo 250 ml$/);
  await same('Hair at 50% instead of free: refused, says what it should be', mk([S(hair)], { tweak: (ls) => ls.map((l) => ({ ...l, disc_value: 50 })) }),
    new RegExp(`^Staff price: ${hair.name.replace(/[()&+]/g, '\\$&')} should be ₹${Number(hair.price)} off \\(100% for staff\\)$`));
  await same('a facial free instead of 50%: refused', mk([S(facial)], { tweak: (ls) => ls.map((l) => ({ ...l, disc_value: 100 })) }), /should be ₹[\d.]+ off \(50% for staff\)$/);
  await same('an offer on a staff line: refused', mk([S(facial)], { tweak: (ls) => ls.map((l) => ({ ...l, offer_discount: 100, offer_id: offers[1].id, offer_name: offers[1].name })) }), /^Staff price: no offers on a staff member's own services/);
  {
    const p = mk([S(facial)], { tweak: (ls) => ls.map((l) => ({ ...l, staff: false })) });
    p.items = p.items.map((it) => ({ ...it, staff_discount: round2(Number(it.line_discount) - 1), commission_base: it.taxable }));
    await same('a staff line with another discount on it: refused', p, /^Staff price: no other discount on /);
  }
  await q(`update staff set active = false where id = $1`, [amit.id]);
  await ldb.update('staff', amit.id, { active: false });
  await same('someone who left is not staff any more', mk([S(hair)]), /not a staff member's$/);
  await q(`update staff set active = true where id = $1`, [amit.id]);
  await ldb.update('staff', amit.id, { active: true });
  // a bill made offline is saved anyway, with a CHECK note
  {
    const off = mk([S(hair)], { tweak: (ls) => ls.map((l) => ({ ...l, disc_value: 50 })) });
    off.bill_no = 'HF' + fy + '-S0001';
    off.created_at = new Date(Date.now() - 600e3).toISOString();
    const a = await save(off), b = await dsave({ ...off });
    check('made offline with a wrong staff price: saved with a CHECK note (database and demo)', !a.error && /CHECK: Staff price: .+ should be/.test(a[0].note || '') && !b.error && /CHECK: Staff price: .+ should be/.test(b.note || ''), JSON.stringify([a, b?.note]).slice(0, 300));
  }
  // the owner changes the rules in Settings
  await setBoth('staff_discount_pct', 40);
  await same('Settings 40%: a 50% staff price is refused', mk([S(facial)], { tweak: (ls) => ls.map((l) => ({ ...l, disc_value: 50 })) }), /\(40% for staff\)$/);
  { const a = await save(mk([S(facial)])), b = await dsave(mk([S(facial)])); check('Settings 40%: the 40% staff price is saved', !a.error && !b.error, JSON.stringify([a.error, b.error, sRules()])); }
  await setBoth('staff_free_sections', ['Hair', 'Threading', 'Waxing', 'Facials']);
  const fr = mk([S(facial)]);
  { const a = await save(fr), b = await dsave({ ...fr, id: randomUUID() }); check('Settings: facials free for staff too', P(fr.items[0].staff_discount) === P(facial.price) && !a.error && !b.error, JSON.stringify([a.error, b.error, fr.items[0].staff_discount])); }
  await setBoth('staff_free_sections', ['Hair', 'Threading', 'Waxing']);
  await setBoth('staff_discount_pct', 50);
  // WhatsApp bills: only the whatsapp function (service key) writes how a send went; the app reads it
  await q(`insert into wa_messages (bill_id, phone, status, wamid) values ($1, '9830012345', 'sent', 'wamid.T1')`, [r1[0].id]);
  check('WhatsApp sends: the counter reads them', (await C(`select status from wa_messages where bill_id = $1`, [r1[0].id]))[0]?.status === 'sent');
  const wIns = await C(`insert into wa_messages (bill_id, phone, status) values ($1, '9830012345', 'read')`, [r1[0].id]);
  const wUpd = await C(`update wa_messages set status = 'read' returning id`);
  const wDel = await C(`delete from wa_messages returning id`);
  check('…but can\'t add, change or delete them', !!wIns.error && Array.isArray(wUpd) && wUpd.length === 0 && Array.isArray(wDel) && wDel.length === 0
    && (await q(`select status from wa_messages`)).map((x) => x.status).join() === 'sent', JSON.stringify([wIns, wUpd, wDel]));
  check('…a status WhatsApp doesn\'t have is refused', !!(await tryq(`insert into wa_messages (bill_id, phone, status) values ($1, '9830012345', 'opened')`, [r1[0].id])).error);
  check('the counter cannot change who is staff', !!(await C(`update staff set phone = '9830099999' where id = $1 returning id`, [priya.id])).error
    || (await C(`update staff set phone = '9830099999' where id = $1 returning id`, [priya.id])).length === 0);
}

// ---------- 15. how each bill was paid, as rows (ready for a wallet or voucher later) ----------
{
  const bad = await q(`select count(*)::int n from bills b where
    (select coalesce(sum(amount), 0) from bill_payments p where p.bill_id = b.id) <> b.paid_cash + b.paid_upi + b.paid_card + b.paid_points
    or (select coalesce(sum(amount) filter (where mode = 'upi'), 0) from bill_payments p where p.bill_id = b.id) <> b.paid_upi`);
  const n = (await q(`select count(*)::int n, count(distinct bill_id)::int b from bill_payments`))[0];
  check('payments as rows: every bill\'s rows add up to its cash + UPI + card + points', bad[0].n === 0 && n.n >= n.b && n.b > 300, JSON.stringify([bad, n]));
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  const anyBill = (await q(`select id, created_at from bills limit 1`))[0];
  check('the counter reads them but cannot add, change or delete one', (await C(`select count(*)::int n from bill_payments`))[0].n > 0
    && !!(await C(`insert into bill_payments (bill_id, created_at, mode, amount) values ($1, $2, 'wallet', 5)`, [anyBill.id, anyBill.created_at])).error
    && (await C(`update bill_payments set amount = 1 returning id`)).length === 0 && (await C(`delete from bill_payments returning id`)).length === 0);
}

// ---------- 16. expenses and the daily cash close ----------
{
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  const O = (sql, p) => as(owner, sOwner, () => tryq(sql, p));
  const exp = (who, p) => who(`select * from add_expense($1)`, [JSON.stringify(p)]);
  const today = istDay();
  const jsErr = (f) => { try { f(); return ''; } catch (e) { return e.message; } };
  // refused, with the same words as the app's own check
  for (const [why, p] of [['no amount', { category: 'Tea & snacks' }], ['an amount in words', { amount: 'fifty', category: 'Tea & snacks' }], ['zero', { amount: '0', category: 'Tea & snacks' }],
    ['3 decimals', { amount: '10.555', category: 'Tea & snacks' }], ['more than ₹5,00,000', { amount: '500001', category: 'Rent' }], ['nothing chosen', { amount: '50' }],
    ['an unknown way of paying', { amount: '50', category: 'Tea & snacks', paid_from: 'wallet' }], ['tomorrow', { amount: '50', category: 'Tea & snacks', day: addDays(today, 1) }],
    ['yesterday, by the counter', { amount: '50', category: 'Tea & snacks', day: addDays(today, -1) }]]) {
    const a = (await exp(C, p)).error || '', b = jsErr(() => checkExpense(p, { today }));
    check(`expense refused: ${why}`, !!a && a === b, JSON.stringify([a, b]));
  }
  check('expense refused: 61 days back, even for the owner', /At most 60 days back/.test((await exp(O, { amount: '50', category: 'Rent', day: addDays(today, -61) })).error || '')
    && jsErr(() => checkExpense({ amount: '50', category: 'Rent', day: addDays(today, -61) }, { today, owner: true })) === 'At most 60 days back');
  check('a login waiting for approval and the website cannot add one', !!(await as(clerk, sPending, () => tryq(`select * from add_expense($1)`, [JSON.stringify({ amount: '50', category: 'Tea & snacks' })]))).error);
  const eid = randomUUID();
  const e1 = (await exp(C, { id: eid, amount: '120.50', category: '  Tea & snacks ', note: ' milk and biscuits ', paid_from: 'cash' }))[0];
  check('the counter adds an expense: today, from the drawer, who added it', e1 && e1.day.toISOString?.().slice(0, 10) !== undefined && Number(e1.amount) === 120.5 && e1.category === 'Tea & snacks' && e1.note === 'milk and biscuits' && e1.paid_from === 'cash', JSON.stringify(e1));
  check('sent twice (a retry): saved once', (await exp(C, { id: eid, amount: '120.50', category: 'Tea & snacks' }))[0].id === eid && (await q(`select count(*)::int n from expenses`))[0].n === 1);
  await exp(C, { amount: '300', category: 'Laundry', paid_from: 'upi' });
  const eOld = (await exp(O, { amount: '2500', category: 'Electricity', paid_from: 'bank', day: addDays(today, -3) }))[0];
  check('the owner adds one for an earlier day', !!eOld && (await q(`select day::text from expenses where id = $1`, [eOld.id]))[0].day === addDays(today, -3));
  check('the counter cannot change, delete or add an expense past the function, or remove one', (await C(`update expenses set amount = 1 returning id`)).length === 0 && (await C(`delete from expenses returning id`)).length === 0
    && !!(await C(`insert into expenses (day, amount, category) values (current_date, 5, 'x')`)).error && /Only the owner can remove/.test((await C(`select * from cancel_expense($1)`, [e1.id])).error || ''));

  // what should be in the drawer: the database and the app work it out the same way
  const rows = async () => ({ bills: await q(`select * from bills`), expenses: await q(`select * from expenses`), closes: await q(`select * from cash_closes`) });
  const same = async (label) => {
    const ra = await C(`select cash_now() f`); if (ra.error) console.log('cash_now:', ra.error); const a = ra[0].f, b = cashNow({ ...(await rows()), now: new Date() });
    const pick = (x) => ['first', 'opening_cash', 'cash_sales', 'cash_refunds', 'cash_expenses', 'expected', 'bills', 'total_sales', 'upi_sales', 'card_sales', 'expenses_total'].map((k) => (typeof x[k] === 'boolean' ? x[k] : P(x[k]))).join();
    check(label, pick(a) === pick(b), JSON.stringify([a, b]));
    return a;
  };
  const f0 = await same('cash now (before the first close): since this morning, the app and the database agree');
  check('…cash on today\'s paid bills, less the ₹120.50 from the drawer; the UPI and bank expenses (₹2,800) don\'t touch the drawer', f0.first === true && P(f0.cash_expenses) === 12050 && P(f0.expenses_total) === 292050 && P(f0.expected) === P(f0.cash_sales) - 12050 && f0.bills > 0, JSON.stringify(f0));

  const close = (who, p) => who(`select * from close_day($1)`, [JSON.stringify(p)]);
  const want0 = round2(1000 + Number(f0.expected));
  for (const [why, p, re] of [['nothing counted', {}, /Type the cash counted/], ['words', { counted: 'lots' }, /Type the cash counted/], ['taken out more than counted', { counted: '100', taken_out: '200' }, /can't be more than the cash counted/],
    ['a bad opening amount', { counted: '100', opening_cash: 'x' }, /Type the cash the day started with/]]) {
    const a = (await close(C, p)).error || '';
    check(`close refused: ${why}`, re.test(a) && a === jsErr(() => checkClose(p, f0, {})), a);
  }
  const short = { counted: String(round2(want0 - 60)), opening_cash: '1000', taken_out: '0' };
  const a1 = (await close(C, short)).error || '';
  check('₹60 short without a note: refused, "The cash is ₹60 short. Write why in the note."', a1 === 'The cash is ₹60 short. Write why in the note.' && a1 === jsErr(() => checkClose(short, f0, {})), a1);
  check('₹8 over (within ₹10): no note needed', !jsErr(() => checkClose({ counted: String(round2(want0 + 8)), opening_cash: '1000' }, f0, {})));
  const c1 = (await close(C, { ...short, note: 'Gave change twice', taken_out: String(round2(want0 - 60 - 2000)), notes: { 500: 3, 100: 5 } }))[0];
  const j1 = checkClose({ ...short, note: 'Gave change twice', taken_out: String(round2(want0 - 60 - 2000)), notes: { 500: 3, 100: 5 } }, f0, {});
  check('the counter closes the day: the figures kept are the app\'s own sum', c1 && ['opening_cash', 'cash_sales', 'cash_refunds', 'cash_expenses', 'expected', 'counted', 'difference', 'taken_out', 'closing_cash', 'total_sales', 'upi_sales', 'card_sales', 'expenses_total'].every((k) => P(c1[k]) === P(j1[k]))
    && c1.bills === j1.bills && P(c1.difference) === -6000 && P(c1.closing_cash) === 200000 && c1.note === 'Gave change twice' && c1.notes['500'] === 3, JSON.stringify([c1, j1]));
  check('closing again: the counter can\'t', /already closed\. Only the owner/.test((await close(C, { counted: '2000' })).error || ''));
  check('the counter cannot write a close past the function', (await C(`update cash_closes set counted = 1 returning id`)).length === 0 && (await C(`delete from cash_closes returning id`)).length === 0 && !!(await C(`insert into cash_closes (day, expected, counted, difference, closing_cash) values (current_date + 1, 0, 0, 0, 0)`)).error);

  // after the close: the drawer starts from what was left
  const f1 = await same('after closing: nothing since, the drawer has what was left');
  check('…₹2,000 expected, no bills since', f1.first === false && P(f1.expected) === 200000 && f1.bills === 0);
  const cashBill = (await q(`select id, paid_cash from bills where status = 'paid' and paid_cash > 0 and bill_no !~ '-P' order by created_at desc limit 1`))[0];
  await as(owner, sOwner, () => q(`select * from cancel_bill($1, 'refund after close')`, [cashBill.id]));      // a cash bill from before, cancelled now
  await as(owner, sOwner, () => q(`select * from cancel_expense($1, 'typed twice')`, [e1.id]));                   // a drawer expense from before, removed now
  await exp(C, { amount: '80', category: 'Cleaning' });
  const nb = makeBill();
  nb.pay_mode = 'Cash'; nb.paid_cash = nb.total; nb.paid_upi = 0; nb.paid_card = 0; delete nb.paid_points; delete nb.use_points;
  const saved = await as(owner, sOwner, () => tryq(`select * from create_bill($1)`, [JSON.stringify(nb)]));
  const f2 = await same('a bill, an expense, a cancelled old bill and a removed old expense since the close: the app and the database agree');
  check('…expected = ₹2,000 + the new cash bill − the cancelled bill\'s cash − ₹80 + the ₹120.50 put back', !saved.error && P(f2.expected) === 200000 + P(nb.total) - P(cashBill.paid_cash) - 8000 + 12050 && P(f2.cash_refunds) === P(cashBill.paid_cash) && P(f2.cash_expenses) === 8000 - 12050,
    JSON.stringify([f2, saved.error, nb.total, cashBill]));
  const fresh = cashNow({ ...(await rows()), closes: [], now: new Date() });
  const cr = await close(O, { counted: '5000', opening_cash: '1000', note: 'Counted again with the owner' });
  const c2 = cr[0];
  check('the owner closes today again: one close for the day, counted afresh from this morning (no close before it)', c2 && (await q(`select count(*)::int n from cash_closes`))[0].n === 1
    && c2.from_at === null && P(c2.opening_cash) === 100000 && P(c2.expected) === 100000 + P(fresh.expected) && P(c2.difference) === 500000 - P(c2.expected), JSON.stringify([cr, fresh]));
  // the demo: the same functions, the same words
  const d = (name, args) => ldb.rpc(name, args).then((x) => x, (e) => ({ error: e.message }));
  check('demo: the same refusals', (await d('add_expense', { p: { amount: 'x', category: 'Rent' } })).error === 'Type the amount' && (await d('close_day', { p: { counted: '5', taken_out: '9' } })).error === "Cash taken out can't be more than the cash counted");
  const de = await d('add_expense', { p: { amount: '75', category: 'Tea & snacks' } });
  const df = await d('cash_now', {});
  const dc = await d('close_day', { p: { counted: String(df.expected), opening_cash: '0' } });
  check('demo: an expense leaves the drawer, the close matches', !de.error && P(df.cash_expenses) === 7500 && !dc.error && P(dc.difference) === 0 && (await d('cash_now', {})).first === false, JSON.stringify([de, df, dc]));
  check('demo: removing an expense keeps it, marked', !!(await d('cancel_expense', { p_id: de.id, p_reason: 'wrong' })).cancelled_at && (await ldb.list('expenses')).length === 1);
}

// ---------- 17. automatic WhatsApp messages: who is due (the database and the app agree) ----------
{
  const set = (k, v) => q(`update settings set value = $2 where key = $1`, [k, JSON.stringify(v)]);
  const settings = async () => Object.fromEntries((await q(`select key, value from settings`)).map((x) => [x.key, x.value]));
  const tables = async () => ({ bills: await q(`select * from bills`), bookings: await q(`select *, want_date::text as want_date from bookings`), booking_items: await q(`select * from booking_items`),
    customers: await q(`select * from customers`), staff: await q(`select * from staff`), wa_messages: await q(`select * from wa_messages`) });
  const norm = (rows) => JSON.stringify(rows.map((r) => Object.fromEntries(Object.entries({ ...r, slot_at: r.slot_at ? new Date(r.slot_at).getTime() : undefined, last_visit: r.last_visit ? new Date(r.last_visit).getTime() : undefined }).filter(([, v]) => v !== undefined).sort(([x], [y]) => (x < y ? -1 : 1)))));
  const both = async (at) => [norm((await q(`select wa_due($1) d`, [at.toISOString()]))[0].d), norm(dueMessages(await tables(), await settings(), at))];
  // 2 pm today in India, so the test works at any hour
  const noon = new Date(istDay() + 'T14:00:00+05:30');
  check('all three switched off: nothing is due', (await both(noon))[0] === '[]');
  await set('wa_feedback_on', true); await set('wa_reminders_on', true); await set('wa_winback_on', true);
  // bills: spread over the last 3 days; customers: some agreed to offers, last seen 20 to 400 days ago; bookings in the next hours
  await q(`update bills set created_at = $1::timestamptz - (random() * interval '70 hours') where bill_no !~ '-P'`, [noon.toISOString()]);
  await q(`update customers set whatsapp_ok = (random() < 0.7), last_visit = $1::timestamptz - (20 + random() * 380) * interval '1 day', visits = greatest(visits, 1)`, [noon.toISOString()]);
  const cust = await q(`select phone, name from customers order by phone limit 12`);
  const svc = (await q(`select id, name from services where active limit 3`));
  for (let i = 0; i < 12; i++) {
    const slot = new Date(noon.getTime() + (i - 2) * 40 * 60000);
    const [bk] = await q(`insert into bookings (ref, phone, name, want_date, slot_at, status, source, created_at) values ($1, $2, $3, $4, $5, $6, 'phone', $7) returning id`,
      ['R' + i, i === 5 ? '12345' : cust[i].phone, cust[i].name, istDay(slot), slot.toISOString(), i % 4 === 3 ? 'requested' : 'confirmed', new Date(noon.getTime() - (i === 6 ? 10 : 200) * 60000).toISOString()]);
    for (const s2 of svc.slice(0, 1 + (i % 3))) await q(`insert into booking_items (booking_id, service_id, name) values ($1, $2, $3)`, [bk.id, s2.id, s2.name]);
  }
  const [a0, b0] = await both(noon);
  const d0 = JSON.parse(a0);
  const kinds = (d) => ['feedback', 'reminder', 'winback'].map((k) => d.filter((x) => x.kind === k).length);
  check(`2 pm: the database and the app pick the same messages, in the same order (${kinds(d0).join(' feedback, ')} we-miss-you)`, a0 === b0 && kinds(d0).every((n) => n > 0), a0.slice(0, 300) + ' | ' + b0.slice(0, 300));
  check('feedback: one a customer (their latest bill), never a staff or past bill', new Set(d0.filter((x) => x.kind === 'feedback').map((x) => x.phone)).size === kinds(d0)[0]
    && (await q(`select count(*)::int n from bills where id = any($1::uuid[]) and (for_staff is not null or bill_no ~ '-P' or status <> 'paid')`, [d0.filter((x) => x.kind === 'feedback').map((x) => x.bill_id)]))[0].n === 0);
  check('reminders: only confirmed bookings starting in the next 3 hours, booked an hour or more ago, with a real number', d0.filter((x) => x.kind === 'reminder').every((x) => x.slot_at > noon.getTime() && x.slot_at <= noon.getTime() + 3 * 3600e3 && /^[6-9]\d{9}$/.test(x.phone) && x.services)
    && kinds(d0)[1] <= 4, JSON.stringify(d0.filter((x) => x.kind === 'reminder')));
  check('"we miss you": at most 20 a day, the most recently lapsed first, only customers who agreed, none with a booking coming', kinds(d0)[2] <= 20
    && d0.filter((x) => x.kind === 'winback').every((x, i, arr) => !i || arr[i - 1].last_visit >= x.last_visit)
    && (await q(`select count(*)::int n from customers where id = any($1::uuid[]) and (not whatsapp_ok or last_visit > $2::timestamptz - interval '45 days')`, [d0.filter((x) => x.kind === 'winback').map((x) => x.customer_id), noon.toISOString()]))[0].n === 0);
  // sent: record them as the function does, mark the reminders; nothing is due twice
  for (const x of d0) await q(`insert into wa_messages (kind, dedupe, phone, bill_id, booking_id, customer_id, status, created_at) values ($1, $2, $3, $4, $5, $6, 'sent', $7)`, [x.kind, x.dedupe, x.phone, x.bill_id || null, x.booking_id || null, x.customer_id || null, noon.toISOString()]);
  const [a1, b1] = await both(new Date(noon.getTime() + 60000));
  check('a minute later: none of them again', a1 === b1 && !JSON.parse(a1).some((x) => d0.some((y) => y.dedupe === x.dedupe)) && kinds(JSON.parse(a1))[0] === 0, a1.slice(0, 200));
  await q(`update settings set value = $1 where key = 'wa_winback_per_day'`, [JSON.stringify(kinds(d0)[2])]);
  await q(`update customers set last_visit = last_visit - interval '1 day' where id = $1`, [d0.find((x) => x.kind === 'winback').customer_id]);
  check('the day\'s limit of "we miss you" is used up: no more today, even for someone newly due', kinds(JSON.parse((await both(new Date(noon.getTime() + 60000)))[0]))[2] === 0);
  await q(`update settings set value = '20' where key = 'wa_winback_per_day'`);
  check('a duplicate send is refused by the database (one message per bill, booking or lapse)', !!(await tryq(`insert into wa_messages (kind, dedupe, phone) values ('feedback', $1, '9')`, [d0[0].dedupe])).error);
  // random times over the next 3 days, STOP, the settings
  await q(`update customers set wa_stop = true where phone in (select phone from customers order by phone limit 15)`);
  let agree = 0, quiet = 0, n = 0;
  for (let i = 0; i < 24; i++) {
    const at = new Date(noon.getTime() + Math.floor(rnd() * 72 * 60) * 60000);
    if (i === 8) { await set('wa_winback_days', 90); await set('wa_remind_hours', 24); await set('wa_feedback_after_hours', 6); await set('wa_winback_per_day', 5); }
    if (i === 16) { await set('wa_feedback_on', false); }
    const [a, b] = await both(at);
    n++; if (a === b) agree++;
    const h = new Date(at.getTime() + 5.5 * 3600e3).getUTCHours();
    if ((h < 9 || h >= 21) && a === '[]') quiet++;
    else if (h >= 9 && h < 21) quiet++;
  }
  check('24 random times over 3 days, the settings changed on the way: the database and the app always agree', agree === n, `${agree}/${n}`);
  check('nothing is due between 9 pm and 9 am', quiet === n);
  const stopped = (await q(`select phone from customers where wa_stop`)).map((x) => x.phone);
  await set('wa_feedback_on', true); await set('wa_winback_per_day', 200);
  check('a customer who replied STOP gets nothing', !JSON.parse((await both(new Date(noon.getTime() + 2 * 3600e3)))[0]).some((x) => stopped.includes(x.phone)));
  const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
  check('the counter cannot ask who is due, write a send, or write feedback', !!(await C(`select wa_due()`)).error && !!(await C(`insert into wa_messages (kind, phone) values ('winback', '9')`)).error
    && !!(await C(`insert into feedback (phone, rating) values ('9', 'good')`)).error);
  const [f] = await q(`insert into feedback (bill_id, phone, name, rating) values ($1, '9830000001', 'Test', 'bad') returning id`, [(await q(`select id from bills limit 1`))[0].id]);
  check('feedback: the counter reads it; only the owner marks it dealt with', (await C(`select count(*)::int n from feedback`))[0].n === 1 && /Only the owner/.test((await C(`select * from handle_feedback($1, 'x')`, [f.id])).error || '')
    && (await as(owner, sOwner, () => q(`select * from handle_feedback($1, 'Called, redo booked')`, [f.id])))[0].handled_note === 'Called, redo booked');
  for (const k of ['wa_feedback_on', 'wa_reminders_on', 'wa_winback_on']) await set(k, false);
  await set('wa_winback_days', 45); await set('wa_remind_hours', 3); await set('wa_feedback_after_hours', 2); await set('wa_winback_per_day', 20);
}

// ---------- 9. running the schema again keeps everything ----------
{
  const n = (await q(`select count(*)::int n from bills`))[0].n;
  const before = (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value;
  await db.exec(schema);
  check('schema re-run keeps the bills', (await q(`select count(*)::int n from bills`))[0].n === n);
  check('schema re-run keeps the Authenticator key', (await q(`select count(*)::int n from owner_secrets`))[0].n === 1);
  const [b] = await as(owner, sOwner, () => q(`select bill_no from create_bill($1)`, [JSON.stringify({ ...makeBill(), id: randomUUID() })]));
  const ctr = (await q(`select value from counters where key = $1`, ['bill-' + fy]))[0].value;
  check('numbering continues after re-run', b.bill_no === `HF${fy}-${String(ctr).padStart(4, '0')}` && ctr === before + 1, `${b.bill_no} ctr ${ctr}`);
}

{
  // The app's list() ends every query with a unique column: "id", or the table's own key (KEY_OF in supadb.js).
  // A table without an id that isn't in KEY_OF fails on the real database ("column staff_faces.id does not exist").
  const cols = await db.query(`select c.table_name t from information_schema.tables c where c.table_schema = 'public' and c.table_type = 'BASE TABLE'
                                 and not exists (select 1 from information_schema.columns x where x.table_schema = 'public' and x.table_name = c.table_name and x.column_name = 'id')`);
  const src = readFileSync('src/lib/supadb.js', 'utf8');
  const keyOf = Object.fromEntries([...src.match(/const KEY_OF = \{([^}]*)\}/)[1].matchAll(/(\w+): '(\w+)'/g)].map((m) => [m[1], m[2]]));
  const skip = new Set(['alerts_sent']); // the app never lists it (two-column key)
  for (const { t } of cols.rows) {
    if (skip.has(t)) continue;
    const k = keyOf[t];
    const has = k && (await db.query(`select 1 from information_schema.columns where table_schema = 'public' and table_name = $1 and column_name = $2`, [t, k])).rows.length === 1;
    check(`list(): ${t} has no id, so it is sorted by its own key (KEY_OF in supadb.js)`, !!has, `${t} → ${k}`);
  }
}

{
  // ---------- backups: the nightly GitHub backup records each file; the owner is reminded to download one ----------
  const at = (days) => new Date(Date.parse('2026-11-16T06:00:00Z') + days * 86400000).toISOString(); // a Monday, 11:30 in India
  const st = async (now) => (await q(`select backup_status($1::timestamptz) s`, [now]))[0].s;
  check('backups: nothing before the first backup', (await st(at(0))) === null);
  // the workflow writes with the database login (no row security), 30 days kept
  for (let i = 30; i >= 1; i--) {
    await q(`insert into backups (made_at, file, size_bytes, run_url, expires_at) values ($1, $2, 1000, $3, $1::timestamptz + interval '30 days')`,
      [at(-i), `habibs-${at(-i).slice(0, 10)}.dump`, `https://github.com/x/y/actions/runs/${i}`]);
  }
  let s = await st(at(0));
  check('backups: the newest one, 29 still kept (the 30-day-old one goes now), never downloaded → due', s.latest.file === `habibs-${at(-1).slice(0, 10)}.dump` && s.kept === 29 && s.due === true && s.last_download === null && s.stale === false, JSON.stringify(s));
  check('backups: never downloaded and one goes within 5 days → urgent, naming the oldest', !!s.urgent && Date.parse(s.urgent.made_at) === Date.parse(at(-29)), JSON.stringify(s.urgent));
  // the app: only the owner sees it; the counter gets nothing and can't read the table
  const ca = await as(clerk, sClerk, () => q(`select backup_alert() a`));
  const cr = await as(clerk, sClerk, () => q(`select count(*)::int n from backups`));
  check('backups: the counter sees no reminder and no backups', ca[0].a === null && cr[0].n === 0, JSON.stringify([ca, cr]));
  const oa = await as(owner, sOwner, () => q(`select backup_alert() a`));
  const or = await as(owner, sOwner, () => q(`select count(*)::int n from backups`));
  check('backups: the owner sees the reminder and the list', oa[0].a && oa[0].a.latest && or[0].n === 30, JSON.stringify(or));
  check('backups: the counter cannot mark one downloaded', !!(await as(clerk, sClerk, () => tryq(`select * from mark_backup_downloaded($1)`, [s.latest.id]))).error);
  check('backups: the counter cannot add one', !!(await as(clerk, sClerk, () => tryq(`insert into backups (file, expires_at) values ('x', now())`))).error);
  await db.exec('set role anon');
  const an = await tryq(`select backup_status(now())`);
  await db.exec('reset role');
  check('backups: the website cannot read the status', !!an.error, JSON.stringify(an));
  // the owner downloads it
  const m = await as(owner, sOwner, () => q(`select * from mark_backup_downloaded($1)`, [s.latest.id]));
  check('backups: "I downloaded it" records when (by the owner)', m[0].downloaded_at && m[0].id === s.latest.id, JSON.stringify(m));
  await q(`update backups set downloaded_at = $1 where id = $2`, [at(0), s.latest.id]);
  s = await st(at(0));
  check('backups: just downloaded → nothing due, nothing urgent', s.due === false && s.urgent === null && Date.parse(s.last_download) === Date.parse(at(0)), JSON.stringify(s));
  s = await st(at(7));
  check('backups: a week later → due again (the Monday reminder)', s.due === true && s.urgent === null, JSON.stringify(s));
  s = await st(at(26));
  check('backups: 26 days without a download, one goes within 5 days → urgent', s.due === true && !!s.urgent, JSON.stringify(s));
  check('backups: no backup for 3 days → stale (the nightly backup stopped)', (await st(at(2))).stale === true && (await st(at(1))).stale === false);
  // the morning message carries it
  const ds = (await q(`select day_summary() d`))[0].d;
  check('backups: in the morning summary', ds && ds.backup && ds.backup.latest, JSON.stringify(ds && ds.backup));
  await q(`delete from backups`);
  await q(`delete from alerts_sent where kind like 'day %'`);
}
{
  // the app's bars (src/lib/alerts.js)
  const { failedBills, backupAlert } = await import('../src/lib/alerts.js');
  const now = Date.parse('2026-11-16T10:00:00Z');
  const h = (n) => new Date(now - n * 3600000).toISOString();
  const rows = [
    { id: 'a1', bill_id: 'A', kind: 'bill', status: 'failed', created_at: h(3), phone: '9831100021', error: 'No WhatsApp' },
    { id: 'a2', bill_id: 'A', kind: 'bill', status: 'delivered', created_at: h(2) },            // sent again: fine now
    { id: 'b1', bill_id: 'B', kind: 'bill', status: 'sent', created_at: h(5) },
    { id: 'b2', bill_id: 'B', kind: 'bill', status: 'failed', created_at: h(1), error: 'Blocked' },
    { id: 'c1', bill_id: 'C', kind: 'bill', status: 'failed', created_at: h(30) },              // older than a day
    { id: 'd1', bill_id: 'D', kind: 'feedback', status: 'failed', created_at: h(1) },            // not a bill
    { id: 'e1', bill_id: 'E', status: 'failed', created_at: h(2), updated_at: h(0.5) },          // kind missing = bill
  ];
  const f = failedBills(rows, { now });
  check('alerts: failed bills = newest send failed, last 24 h, bills only, newest first', JSON.stringify(f.map((x) => x.bill_id)) === JSON.stringify(['E', 'B']), JSON.stringify(f));
  check('alerts: "Done" on this device hides them', failedBills(rows, { now, dismissed: ['e1', 'b2'] }).length === 0);
  check('alerts: no backup → no bar', backupAlert(null) === null && backupAlert({}) === null);
  const L = { made_at: '2026-11-15T21:30:00Z', run_url: 'u' };
  check('alerts: stale beats the rest (red)', backupAlert({ latest: L, stale: true, due: true, urgent: { made_at: L.made_at, expires_at: L.made_at } }).level === 'bad');
  check('alerts: urgent (red) names the dates', /GitHub deletes the one of .* on /.test(backupAlert({ latest: L, due: true, urgent: { made_at: '2026-10-17T21:30:00Z', expires_at: '2026-11-16T21:30:00Z' } }).text));
  check('alerts: due (yellow), says when last downloaded', backupAlert({ latest: L, due: true, last_download: '2026-11-01T05:00:00Z' }).level === 'warn' && /last downloaded/.test(backupAlert({ latest: L, due: true, last_download: '2026-11-01T05:00:00Z' }).text));
  check('alerts: downloaded recently → no bar', backupAlert({ latest: L, due: false, stale: false, urgent: null }) === null);
}

console.log(`${checks.toLocaleString()} database checks, ${fails.length} failed`);
for (const f of [...new Set(fails)].slice(0, 40)) console.log(f);
process.exitCode = fails.length ? 1 : 0;
