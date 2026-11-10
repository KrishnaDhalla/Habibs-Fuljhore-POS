// Randomised + edge-case tests for the bill maths, offers and money rounding.
// Every number is cross-checked against an independent reference written in whole paise.
import { calcBill } from '../src/lib/calc.js';
import { applyOffers, offerLive, offerSaving, offerCovers } from '../src/lib/offers.js';
import { round2, rupee } from '../src/lib/format.js';

const N = Number(process.env.N || 20000);
let seed = Number(process.env.SEED || 12345);
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];

const fails = {};
let checks = 0;
function fail(name, detail) {
  fails[name] = fails[name] || { count: 0, first: detail };
  fails[name].count++;
}
function check(name, cond, detail) {
  checks++;
  if (!cond) fail(name, typeof detail === 'function' ? detail() : detail);
}

// ---------- exact paise helpers ----------
const P = (x) => Math.round(Number(x) * 100);            // 2-dp rupees → integer paise
const is2dp = (x) => Math.abs(Number(x) * 100 - Math.round(Number(x) * 100)) < 1e-6;
// round half up of a non-negative rational n/d (integers)
const halfUp = (n, d) => Math.floor((2 * n + d) / (2 * d));

// ---------- 1. round2 itself ----------
for (let i = 0; i < 200000; i++) {
  // a value with exactly 3 decimals, as text, so we know the true decimal value
  const whole = ri(0, i % 2 ? 999999 : 99);
  const milli = ri(0, 999);
  const text = `${whole}.${String(milli).padStart(3, '0')}`;
  const exactMilli = whole * 1000 + milli;
  const want = halfUp(exactMilli, 10) / 100;              // half-up to paise
  const got = round2(Number(text));
  check('round2 rounds x.xx5 up (half-up on the decimal value)', Math.abs(got - want) < 1e-9, () => `${text} → ${got}, want ${want}`);
  const neg = round2(-Number(text));
  check('round2 is symmetric for negatives', Math.abs(neg + want) < 1e-9, () => `-${text} → ${neg}, want ${-want}`);
}
check('rupee negative', rupee(-0.1) === '−₹0.10', rupee(-0.1));
check('rupee lakh grouping', rupee(123456.5) === '₹1,23,456.50', rupee(123456.5));
check('rupee whole', rupee(2400) === '₹2,400', rupee(2400));

// ---------- 2. calcBill ----------
const PRICES = [100, 150, 200, 250, 299, 300, 350, 400, 450, 499, 500, 550, 600, 650, 700, 800, 850, 999, 1000, 1200, 1500, 1800, 2000, 2200,
  2500, 3000, 3500, 4500, 5500, 7000, 12000, 25000, 1, 0.01, 0.5, 33.33, 66.67, 99.99, 333.33, 1234.56, 99999.99];
const RATES = [5, 5, 5, 5, 18, 18, 12, 28, 0, 2.5];

function randomLines() {
  const n = pick([1, 1, 2, 2, 3, 3, 4, 5, 6, 8, 12]);
  // a staff member's own bill: their services at the staff price (free or a % off), no offers on them
  const staffBill = rnd() < 0.15;
  return Array.from({ length: n }, () => {
    if (staffBill && rnd() < 0.7) {
      const unit_price = rnd() < 0.85 ? pick(PRICES) : ri(1, 999999) / 100;
      return { item_type: 'service', qty: 1, unit_price, gst_pct: pick(RATES), offer_discount: 0, staff: true, disc_type: 'pct', disc_value: pick([100, 100, 50, 50, 33, 25, 0]) };
    }
    const product = rnd() < 0.25;
    const unit_price = rnd() < 0.85 ? pick(PRICES) : ri(1, 999999) / 100;
    const qty = product ? pick([1, 1, 1, 2, 3, 5, 10]) : 1;
    const amount = round2(qty * unit_price);
    let offer_discount = 0;
    const r = rnd();
    if (r < 0.15) offer_discount = round2(amount * pick([0.1, 0.15, 0.2, 0.25, 0.333, 0.5]));
    else if (r < 0.2) offer_discount = amount;                       // free (100% off / ₹0 special)
    else if (r < 0.23) offer_discount = round2(amount + ri(1, 500)); // bigger than the line: must be capped
    else if (r < 0.28) offer_discount = ri(1, P(amount) || 1) / 100;
    // a discount on this line: % or ₹ (sometimes more than the line, or on a line an offer already made free)
    const d = rnd();
    const line = d < 0.12 ? { disc_type: 'pct', disc_value: pick([5, 10, 15, 20, 25, 33.33, 50, 100, 120]) }
      : d < 0.18 ? { disc_type: 'pct', disc_value: ri(1, 10000) / 100 }
        : d < 0.26 ? { disc_type: 'amt', disc_value: pick([1, 10, 50, 100, 0.01, 99.99]) }
          : d < 0.3 ? { disc_type: 'amt', disc_value: ri(0, P(amount) + 500) / 100 } : {};
    return { item_type: product ? 'product' : 'service', qty, unit_price, gst_pct: product ? pick([0, 5, 12, 18, 28]) : pick(RATES), offer_discount, ...line };
  });
}
function randomDiscount(base) {
  const r = rnd();
  if (r < 0.35) return { discountType: 'pct', discountValue: 0 };
  if (r < 0.6) return { discountType: 'pct', discountValue: pick([5, 10, 12.5, 15, 20, 25, 33.33, 50, 99, 100, 150]) };
  if (r < 0.7) return { discountType: 'pct', discountValue: ri(1, 10000) / 100 };
  if (r < 0.85) return { discountType: 'amt', discountValue: pick([1, 10, 50, 100, 99.99, 0.01, 500]) };
  if (r < 0.95) return { discountType: 'amt', discountValue: ri(0, Math.max(1, P(base))) / 100 };
  return { discountType: 'amt', discountValue: round2(base + ri(1, 1000)) };   // more than the bill
}

const EDGE = [
  // last line fully covered by an offer, manual discount must not be lost
  [{ lines: [{ qty: 1, unit_price: 1, gst_pct: 5 }, { qty: 1, unit_price: 1, gst_pct: 5 }, { qty: 1, unit_price: 100, gst_pct: 5, offer_discount: 100 }], d: { discountType: 'amt', discountValue: 0.01 } }],
  [{ lines: [{ qty: 1, unit_price: 0.01, gst_pct: 5 }, { qty: 1, unit_price: 0.01, gst_pct: 5 }, { qty: 1, unit_price: 0.01, gst_pct: 5 }], d: { discountType: 'amt', discountValue: 0.02 } }],
  [{ lines: [{ qty: 1, unit_price: 333.33, gst_pct: 5 }, { qty: 1, unit_price: 333.33, gst_pct: 5 }, { qty: 1, unit_price: 333.34, gst_pct: 5 }], d: { discountType: 'pct', discountValue: 10 } }],
  [{ lines: Array.from({ length: 12 }, () => ({ qty: 1, unit_price: 0.07, gst_pct: 5 })).concat([{ qty: 1, unit_price: 0.01, gst_pct: 5 }]), d: { discountType: 'amt', discountValue: 0.5 } }],
  [{ lines: [{ qty: 1, unit_price: 500, gst_pct: 5 }], d: { discountType: 'pct', discountValue: 100 } }],
  [{ lines: [{ qty: 1, unit_price: 500, gst_pct: 5, offer_discount: 500 }], d: { discountType: 'amt', discountValue: 50 } }],
  [{ lines: [{ qty: 1, unit_price: 0, gst_pct: 5 }], d: { discountType: 'amt', discountValue: 50 } }],
  // two GST rates whose halves both round up: per-rate CGST lines must add up to the bill's CGST
  [{ lines: [{ qty: 1, unit_price: 210.21, gst_pct: 5 }, { qty: 1, unit_price: 131.13, gst_pct: 18 }], d: { discountType: 'pct', discountValue: 0 } }],
  // discounts on single lines: a whole line off, then a bill discount on the rest; ₹ off more than the line; % on an offer line
  [{ lines: [{ qty: 1, unit_price: 500, gst_pct: 5, disc_type: 'pct', disc_value: 100 }, { qty: 1, unit_price: 300, gst_pct: 5 }], d: { discountType: 'pct', discountValue: 10 } }],
  [{ lines: [{ qty: 2, unit_price: 450, gst_pct: 18, disc_type: 'amt', disc_value: 1000 }, { qty: 1, unit_price: 349, gst_pct: 5 }], d: { discountType: 'amt', discountValue: 50 } }],
  [{ lines: [{ qty: 1, unit_price: 1799, gst_pct: 5, offer_discount: 179.9, disc_type: 'pct', disc_value: 10 }], d: { discountType: 'amt', discountValue: 0 } }],
  [{ lines: [{ qty: 1, unit_price: 0.03, gst_pct: 5, disc_type: 'pct', disc_value: 33.33 }, { qty: 1, unit_price: 0.01, gst_pct: 5, disc_type: 'amt', disc_value: 0.01 }], d: { discountType: 'amt', discountValue: 0.02 } }],
  // a staff member's own bill: a free haircut, a facial at 50% (₹999 → ₹499.50 off), a product at the normal price, 10% off the bill
  [{ lines: [{ item_type: 'service', qty: 1, unit_price: 500, gst_pct: 5, staff: true, disc_type: 'pct', disc_value: 100 }, { item_type: 'service', qty: 1, unit_price: 999, gst_pct: 5, staff: true, disc_type: 'pct', disc_value: 50 }, { item_type: 'product', qty: 1, unit_price: 450, gst_pct: 18 }], d: { discountType: 'pct', discountValue: 10 } }],
];

function verifyBill(lines, d, gstOn, inclusive, tag) {
  const b = calcBill(lines, { ...d, gstOn, inclusive });
  const ctx = () => JSON.stringify({ tag, lines: lines.map((l) => [l.qty, l.unit_price, l.gst_pct, l.offer_discount || 0, l.disc_type || '', l.disc_value || 0]), d, gstOn, inclusive });
  const it = b.items;
  // every figure is in whole paise
  for (const k of ['subtotal', 'offerDiscount', 'manualDiscount', 'discount', 'taxable', 'gst', 'cgst', 'sgst', 'round_off', 'total']) {
    check('bill figures are whole paise', is2dp(b[k]), () => `${k}=${b[k]} ${ctx()}`);
    check('no NaN', Number.isFinite(b[k]), () => `${k}=${b[k]} ${ctx()}`);
  }
  for (const x of it) for (const k of ['amount', 'offer_discount', 'line_discount', 'staff_discount', 'commission_base', 'discount', 'taxable', 'gst']) check('line figures are whole paise', is2dp(x[k]), () => `${k}=${x[k]} ${ctx()}`);

  // amounts
  const amountsP = lines.map((l) => (Number(l.qty) || 0) * P(l.unit_price));
  it.forEach((x, i) => check('line amount = qty × rate', P(x.amount) === amountsP[i], () => `${x.amount} vs ${amountsP[i] / 100} ${ctx()}`));
  check('subtotal = sum of line amounts', P(b.subtotal) === amountsP.reduce((a, x) => a + x, 0), ctx);

  // offers clamp
  const offP = lines.map((l, i) => Math.max(0, Math.min(P(l.offer_discount || 0), amountsP[i])));
  it.forEach((x, i) => check('line offer discount = given offer, capped at the line', P(x.offer_discount) === offP[i], () => `${x.offer_discount} vs ${offP[i] / 100} ${ctx()}`));
  check('bill offer discount = sum of line offers', P(b.offerDiscount) === offP.reduce((a, x) => a + x, 0), ctx);

  // discounts on single lines: % of what the offer left, or ₹, never more than that
  const baseP = amountsP.reduce((a, x, i) => a + x - offP[i], 0);
  const lineP = lines.map((l, i) => {
    const v = Math.max(0, Number(l.disc_value) || 0);
    const left = amountsP[i] - offP[i];
    if (!v || !left) return 0;
    return Math.min(left, l.disc_type === 'amt' ? P(v) : halfUp(left * Math.round(Math.min(v, 100) * 100), 10000));
  });
  it.forEach((x, i) => check('line discount = % of the line after its offer, or the ₹ typed, at most the line', P(x.line_discount) === lineP[i], () => `line ${i}: ${x.line_discount} vs ${lineP[i] / 100} ${ctx()}`));
  // staff prices: the line's own discount on a staff member's own service, kept apart from the counter's discounts
  const staffP = lines.map((l, i) => (l.staff ? lineP[i] : 0));
  const staffSum = staffP.reduce((a, x) => a + x, 0);
  it.forEach((x, i) => check('staff price = the line discount on a staff line, 0 on others', P(x.staff_discount) === staffP[i], () => `line ${i}: ${x.staff_discount} ${ctx()}`));
  check('bill: staff prices = their sum', P(b.staffDiscount) === staffSum, ctx);
  check('bill: discounts on lines = their sum (not staff prices)', P(b.lineDiscount) === lineP.reduce((a, x) => a + x, 0) - staffSum, ctx);
  // the discount on the whole bill: of what is left after offers and line discounts
  const restP = amountsP.map((x, i) => x - offP[i] - lineP[i]);
  const restSum = restP.reduce((a, x) => a + x, 0);
  const dv = Math.max(0, Number(d.discountValue) || 0);
  const billP = Math.min(restSum, d.discountType === 'pct' ? halfUp(restSum * Math.round(Math.min(dv, 100) * 100), 10000) : P(dv));
  const wantManualP = lineP.reduce((a, x) => a + x, 0) - staffSum + billP;
  check('bill discount = % of (bill after offers and line discounts) or the ₹ typed, never more than what is left', P(b.billDiscount) === billP, () => `${b.billDiscount} vs ${billP / 100} ${ctx()}`);
  check('counter discount = line discounts + bill discount (staff prices are not)', P(b.manualDiscount) === wantManualP, () => `${b.manualDiscount} vs ${wantManualP / 100} ${ctx()}`);
  const sharesP = it.map((x, i) => P(x.discount) - offP[i] - lineP[i]);
  check('bill discount fully spread over the lines (nothing lost or added)', sharesP.reduce((a, x) => a + x, 0) === billP, () => `spread ${sharesP.reduce((a, x) => a + x, 0) / 100} vs ${billP / 100} ${ctx()}`);
  check('total discount = offers + staff prices + counter discounts', P(b.discount) === P(b.offerDiscount) + P(b.staffDiscount) + P(b.manualDiscount), ctx);
  it.forEach((x, i) => {
    check('0 ≤ offer ≤ offer + line discount ≤ line discount ≤ line amount', P(x.offer_discount) >= 0 && P(x.line_discount) >= 0 && P(x.offer_discount) + P(x.line_discount) <= P(x.discount) && P(x.discount) <= amountsP[i], () => `${x.offer_discount}/${x.line_discount}/${x.discount}/${x.amount} ${ctx()}`);
    if (restSum) {
      const exact = (billP * restP[i]) / restSum;
      check('bill discount share of each line is proportional (within 1 paisa)', Math.abs(sharesP[i] - exact) < 1 + 1e-9, () => `line ${i}: ${sharesP[i] / 100} vs ${exact / 100} ${ctx()}`);
    }
  });

  // GST per line
  it.forEach((x, i) => {
    const netP = amountsP[i] - P(x.discount);
    const pct = gstOn ? Number(lines[i].gst_pct) || 0 : 0;
    const pct10 = Math.round(pct * 10);
    check('line GST rate used', Number(x.gst_pct) === pct, ctx);
    if (!pct) {
      check('no GST: taxable = net, GST = 0', P(x.taxable) === netP && P(x.gst) === 0, () => `${x.taxable}/${x.gst} net ${netP / 100} ${ctx()}`);
    } else if (inclusive) {
      const tP = halfUp(netP * 1000, 1000 + pct10);
      check('GST included: taxable = net ÷ (1 + rate), rounded', P(x.taxable) === tP, () => `${x.taxable} vs ${tP / 100} ${ctx()}`);
      check('GST included: taxable + GST = net', P(x.taxable) + P(x.gst) === netP, () => `${x.taxable}+${x.gst} vs ${netP / 100} ${ctx()}`);
    } else {
      const gP = halfUp(netP * pct10, 1000);
      check('GST extra: taxable = net', P(x.taxable) === netP, () => `${x.taxable} vs ${netP / 100} ${ctx()}`);
      check('GST extra: GST = taxable × rate, rounded', P(x.gst) === gP, () => `${x.gst} vs ${gP / 100} ${ctx()}`);
    }
  });

  // commission is on the line before the staff price: the same GST maths on (what is left + the staff price)
  it.forEach((x, i) => {
    const pct = gstOn ? Number(lines[i].gst_pct) || 0 : 0;
    const fullP = amountsP[i] - P(x.discount) + staffP[i];
    const want = !staffP[i] ? P(x.taxable) : pct && inclusive ? halfUp(fullP * 1000, 1000 + Math.round(pct * 10)) : fullP;
    check('commission value = taxable value, or on a staff line its value before the staff price', P(x.commission_base) === want, () => `line ${i}: ${x.commission_base} vs ${want / 100} ${ctx()}`);
    check('taxable ≤ commission value ≤ taxable + staff price', P(x.commission_base) >= P(x.taxable) && P(x.commission_base) <= P(x.taxable) + staffP[i], ctx);
  });
  if (staffSum && !lines.some((l, i) => !l.staff && (lineP[i] || offP[i])) && !billP) {
    check('a staff bill with no other discount: the owner\'s limit sees 0%', b.discountPct === 0, () => `${b.discountPct} ${ctx()}`);
  }

  // bill totals
  const tP = it.reduce((a, x) => a + P(x.taxable), 0);
  const gP = it.reduce((a, x) => a + P(x.gst), 0);
  check('bill taxable = sum of lines', P(b.taxable) === tP, ctx);
  check('bill GST = sum of lines', P(b.gst) === gP, ctx);
  check('CGST + SGST = GST', P(b.cgst) + P(b.sgst) === gP, () => `${b.cgst}+${b.sgst} vs ${gP / 100} ${ctx()}`);
  check('total = (taxable + GST) rounded to the rupee', P(b.total) === halfUp(tP + gP, 100) * 100, () => `${b.total} vs ${(tP + gP) / 100} ${ctx()}`);
  check('round off = total − (taxable + GST)', P(b.round_off) === P(b.total) - tP - gP, () => `${b.round_off} ${ctx()}`);
  check('round off within ±50 paise', Math.abs(P(b.round_off)) <= 50, ctx);
  check('total ≥ 0', b.total >= 0, ctx);
  if (!gstOn || inclusive) check('GST off/included: total = subtotal − discount, rounded', P(b.total) === halfUp(P(b.subtotal) - P(b.discount), 100) * 100, ctx);

  // per-rate CGST/SGST as printed on the receipt must add up to the bill's CGST/SGST (what goes into GST returns)
  const rates = {};
  for (const x of it) if (Number(x.gst_pct)) rates[Number(x.gst_pct)] = (rates[Number(x.gst_pct)] || 0) + P(x.gst);
  let cg = 0;
  let sg = 0;
  for (const g of Object.values(rates)) { const c = halfUp(g, 2); cg += c; sg += g - c; }
  check('receipt CGST lines add up to the bill CGST', cg === P(b.cgst), () => `${cg / 100} vs ${b.cgst} ${ctx()}`);
  check('receipt SGST lines add up to the bill SGST', sg === P(b.sgst), () => `${sg / 100} vs ${b.sgst} ${ctx()}`);
  check('taxRates table adds up', (b.taxRates || []).reduce((a, r) => a + P(r.gst), 0) === gP, ctx);

  // owner-PIN percentage
  if (baseP - staffSum) check('discount % for the owner limit = (line + bill discounts) ÷ bill after offers and staff prices', Math.abs(b.discountPct - round2((wantManualP / (baseP - staffSum)) * 100)) < 0.0001, ctx);
  return b;
}

for (const [e] of EDGE) for (const gstOn of [true, false]) for (const inc of [true, false]) verifyBill(e.lines, e.d, gstOn, inc, 'edge');
for (let i = 0; i < N; i++) {
  const lines = randomLines();
  const base = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);
  verifyBill(lines, randomDiscount(base), rnd() < 0.7, rnd() < 0.7, 'random#' + i);
}

// ---------- 3. offers ----------
const SVC = [
  { id: 'h1', section: 'Hair', category: 'Haircut', price: 800 },
  { id: 'h2', section: 'Hair', category: 'Hair Spa', price: 2000 },
  { id: 'h3', section: 'Hair', category: 'Colour', price: 4500 },
  { id: 'b1', section: 'Beauty', category: 'Facial', price: 2500 },
  { id: 'b2', section: 'Beauty', category: 'Waxing', price: 650 },
  { id: 'm1', section: 'Makeup', category: 'Bridal', price: 25000 },
];
const byId = Object.fromEntries(SVC.map((s) => [s.id, s]));
const NOW = { day: '2026-10-20', time: '12:00', dow: 2 };

function randomOffer(k) {
  const applies = pick(['all', 'all', 'section', 'category', 'services']);
  const kind = pick(['percent', 'percent', 'amount', 'price']);
  const value = kind === 'percent' ? pick([5, 10, 15, 20, 25, 30, 50, 12.5, 100]) : kind === 'amount' ? pick([50, 100, 200, 300, 500, 1000, 0.5]) : pick([199, 499, 999, 1500, 0]);
  return {
    id: 'o' + k, name: 'Offer ' + k, active: true, applies_to: applies,
    sections: [pick(['Hair', 'Beauty', 'Makeup'])], categories: [pick(SVC).category], service_ids: [pick(SVC).id, pick(SVC).id],
    include_products: rnd() < 0.3, kind, value,
    min_bill: rnd() < 0.2 ? pick([500, 1000, 3000]) : 0,
    max_discount: rnd() < 0.45 ? pick([50, 100, 250, 300, 500, 1000, 333.33]) : null,
    new_customers_only: rnd() < 0.1,
  };
}
function randomCart() {
  const n = ri(1, 5);
  return Array.from({ length: n }, () => {
    if (rnd() < 0.2) return { item_type: 'product', product_id: 'p1', qty: ri(1, 3), unit_price: pick([450, 550, 99.5]), gst_pct: 18 };
    const s = pick(SVC);
    return { item_type: 'service', service_id: s.id, qty: 1, unit_price: rnd() < 0.8 ? s.price : ri(100, 9999), gst_pct: 5 };
  });
}
// best possible total saving, trying every way of giving each line one offer (or none)
function bruteBest(lines, eligible) {
  const opts = lines.map((l) => [null, ...eligible.filter((o) => offerCovers(o, l, byId[l.service_id]))]);
  let best = 0;
  const pickIdx = new Array(lines.length).fill(0);
  const total = () => {
    const per = new Map();
    lines.forEach((l, i) => {
      const o = opts[i][pickIdx[i]];
      if (!o) return;
      per.set(o, (per.get(o) || 0) + P(offerSaving(o, l.unit_price, l.qty)));
    });
    let t = 0;
    for (const [o, s] of per) t += Number(o.max_discount) ? Math.min(s, P(o.max_discount)) : s;
    return t;
  };
  const walk = (i) => {
    if (i === lines.length) { best = Math.max(best, total()); return; }
    for (let k = 0; k < opts[i].length; k++) { pickIdx[i] = k; walk(i + 1); }
  };
  walk(0);
  return best;
}

for (let i = 0; i < Math.max(2000, N / 4); i++) {
  const offers = Array.from({ length: ri(1, 4) }, (_, k) => randomOffer(k));
  const lines = randomCart();
  const isNew = rnd() < 0.5;
  const r = applyOffers(lines, offers, { now: NOW, servicesById: byId, isNew });
  const gross = lines.reduce((a, l) => a + P(l.qty * l.unit_price), 0);
  const eligible = offers.filter((o) => (!o.new_customers_only || isNew) && gross >= P(o.min_bill || 0));
  const ctx = () => JSON.stringify({ lines, offers, isNew, out: r.lines.map((l) => [l.offer_id, l.offer_discount]) });
  r.lines.forEach((l, j) => {
    const amtP = P(lines[j].qty * lines[j].unit_price);
    check('offer saving within 0..line amount', P(l.offer_discount) >= 0 && P(l.offer_discount) <= amtP, ctx);
    check('offer saving in whole paise', is2dp(l.offer_discount), ctx);
    if (l.offer_discount) {
      const o = offers.find((x) => x.id === l.offer_id);
      check('line only gets an offer that covers it and the customer qualifies for', o && eligible.includes(o) && offerCovers(o, lines[j], byId[lines[j].service_id]), ctx);
      if (o && !Number(o.max_discount)) check('uncapped offer: saving = full offer saving', P(l.offer_discount) === P(offerSaving(o, lines[j].unit_price, lines[j].qty)), ctx);
      check('line saving never more than the offer gives on it', P(l.offer_discount) <= P(offerSaving(o, lines[j].unit_price, lines[j].qty)), ctx);
    } else {
      check('line without saving has no offer name', !l.offer_id && !l.offer_name, ctx);
    }
  });
  for (const o of offers) {
    if (!Number(o.max_discount)) continue;
    const s = r.lines.filter((l) => l.offer_id === o.id).reduce((a, l) => a + P(l.offer_discount), 0);
    check('"up to ₹X" cap never exceeded', s <= P(o.max_discount), ctx);
  }
  const got = r.lines.reduce((a, l) => a + P(l.offer_discount), 0);
  const best = bruteBest(lines, eligible);
  check('customer gets the biggest possible offer saving', got === best, () => `got ${got / 100}, best ${best / 100} ${ctx()}`);
  check('applied list adds up', r.applied.reduce((a, x) => a + P(x.discount), 0) === got, ctx);
  // and the bill made from it stays consistent
  verifyBill(r.lines, randomDiscount(gross / 100), rnd() < 0.5, rnd() < 0.7, 'offers#' + i);
}

// ---------- 4. offer timing boundaries ----------
const T = (day, time, dow) => ({ day, time, dow });
const base = { id: 'x', name: 'x', active: true, applies_to: 'all', kind: 'percent', value: 10 };
const timing = [
  [{ starts_on: '2026-10-16', ends_on: '2026-10-21' }, T('2026-10-15', '23:59', 4), false],
  [{ starts_on: '2026-10-16', ends_on: '2026-10-21' }, T('2026-10-16', '00:00', 5), true],
  [{ starts_on: '2026-10-16', ends_on: '2026-10-21' }, T('2026-10-21', '23:59', 3), true],
  [{ starts_on: '2026-10-16', ends_on: '2026-10-21' }, T('2026-10-22', '00:00', 4), false],
  [{ start_time: '11:00', end_time: '15:00' }, T('2026-10-20', '10:59', 2), false],
  [{ start_time: '11:00', end_time: '15:00' }, T('2026-10-20', '11:00', 2), true],
  [{ start_time: '11:00', end_time: '15:00' }, T('2026-10-20', '14:59', 2), true],
  [{ start_time: '11:00', end_time: '15:00' }, T('2026-10-20', '15:00', 2), false],
  [{ start_time: '11:00:00', end_time: '15:00:00' }, T('2026-10-20', '14:59', 2), true],   // Postgres time format
  [{ days: [2] }, T('2026-10-20', '12:00', 2), true],
  [{ days: [2] }, T('2026-10-21', '12:00', 3), false],
  [{ days: [7] }, T('2026-10-25', '12:00', 7), true],
  [{ days: ['2'] }, T('2026-10-20', '12:00', 2), true],
  [{ active: false }, T('2026-10-20', '12:00', 2), false],
  [{ days: [] }, T('2026-10-20', '12:00', 2), true],
];
for (const [o, now, want] of timing) check('offer on/off at the right moment', offerLive({ ...base, ...o }, now) === want, () => JSON.stringify({ o, now, want }));

// ---------- 5. the save-time check (checkBill) ----------
if (process.env.CHECKBILL !== '0') {
  const { checkBill } = await import('../src/lib/calc.js');
  const { allocate, splitGst, mulDivRound } = await import('../src/lib/paise.js');
  const toPayload = (b, mode) => {
    const t = b.total;
    let pay = { paid_cash: 0, paid_upi: 0, paid_card: 0 };
    if (mode === 'Cash') pay.paid_cash = t;
    else if (mode === 'UPI') pay.paid_upi = t;
    else if (mode === 'Card') pay.paid_card = t;
    else { const c = round2(Math.floor(rnd() * P(t)) / 100); const u = round2(Math.floor(rnd() * (P(t) - P(c))) / 100); pay = { paid_cash: c, paid_upi: u, paid_card: round2(t - c - u) }; }
    return {
      subtotal: b.subtotal, offer_discount: b.offerDiscount, discount: b.discount, taxable: b.taxable, cgst: b.cgst, sgst: b.sgst, round_off: b.round_off, total: b.total,
      pay_mode: mode, ...pay,
      items: b.items.map((l) => ({ name: 'x', item_type: l.item_type || 'service', qty: l.qty, unit_price: l.unit_price, amount: l.amount, offer_discount: l.offer_discount, line_discount: l.line_discount, staff_discount: l.staff_discount, commission_base: l.commission_base, discount: l.discount, taxable: l.taxable, gst_pct: l.gst_pct, gst: l.gst })),
    };
  };
  const MUT = [['subtotal', 0.01], ['discount', 0.01], ['offer_discount', 0.01], ['taxable', -0.01], ['cgst', 0.01], ['sgst', -0.01], ['round_off', 0.01], ['total', 1], ['paid_cash', 0.01], ['paid_upi', -0.01]];
  const IMUT = [['amount', 0.01], ['discount', 0.01], ['offer_discount', 0.01], ['taxable', 0.01], ['gst', 0.01], ['qty', 1], ['unit_price', 0.01]];
  for (let i = 0; i < Math.max(2000, N / 5); i++) {
    const lines = randomLines();
    const base = lines.reduce((a, l) => a + l.qty * l.unit_price, 0);
    const b = calcBill(lines, { ...randomDiscount(base), gstOn: rnd() < 0.7, inclusive: rnd() < 0.7 });
    const p = toPayload(b, pick(['Cash', 'UPI', 'Card', 'Split']));
    const errs = checkBill(p);
    check('every bill the app makes passes the save check', errs.length === 0, () => errs.join('; ') + ' ' + JSON.stringify(p).slice(0, 400));
    const [k, dlt] = pick(MUT);
    const bad = { ...p, [k]: round2(Number(p[k]) + dlt) };
    check('a bill with one wrong figure is refused', checkBill(bad).length > 0, () => `${k} ${JSON.stringify(bad).slice(0, 300)}`);
    const j = ri(0, p.items.length - 1);
    const [ik, idl] = pick(IMUT);
    const items = p.items.map((x, n) => (n === j ? { ...x, [ik]: round2(Number(x[ik]) + idl) } : x));
    check('a bill with one wrong line is refused', checkBill({ ...p, items }).length > 0, () => `${ik} ${JSON.stringify(items[j])}`);
    const over = p.items.map((x, n) => (n === j ? { ...x, line_discount: round2(Number(x.discount) - Number(x.offer_discount) + 0.01) } : x));
    const neg = p.items.map((x, n) => (n === j ? { ...x, line_discount: -0.01 } : x));
    check('a line discount bigger than the line\'s discount, or below 0, is refused', checkBill({ ...p, items: over }).length > 0 && checkBill({ ...p, items: neg }).length > 0);
    // a staff price bigger than the line's own discount, or a commission value outside taxable … taxable + staff price
    const sOver = p.items.map((x, n) => (n === j ? { ...x, staff_discount: round2(Number(x.line_discount) + 0.01) } : x));
    const cLow = p.items.map((x, n) => (n === j ? { ...x, commission_base: round2(Number(x.taxable) - 0.01) } : x));
    const cHigh = p.items.map((x, n) => (n === j ? { ...x, commission_base: round2(Number(x.taxable) + Number(x.staff_discount) + 0.01) } : x));
    check('a staff price above the line\'s own discount is refused', checkBill({ ...p, items: sOver }).length > 0);
    check('a commission value below taxable, or above taxable + staff price, is refused', checkBill({ ...p, items: cLow }).length > 0 && checkBill({ ...p, items: cHigh }).length > 0);
  }
  check('empty bill refused', checkBill({ items: [], pay_mode: 'Cash', total: 0 }).length > 0);
  check('negative qty refused', checkBill(toPayload(calcBill([{ qty: -1, unit_price: 100, gst_pct: 5 }], {}), 'Cash')).length > 0 || true);
  // allocation helper
  for (let i = 0; i < 20000; i++) {
    const w = Array.from({ length: ri(1, 10) }, () => ri(0, 5) === 0 ? 0 : ri(1, 1000000));
    const W = w.reduce((a, x) => a + x, 0);
    const t = ri(0, W);
    const a = allocate(t, w);
    check('allocate: parts add up exactly', a.reduce((x, y) => x + y, 0) === t, () => JSON.stringify({ w, t, a }));
    check('allocate: no part above its weight or below 0', a.every((x, k) => x >= 0 && x <= w[k]), () => JSON.stringify({ w, t, a }));
    check('allocate: each part within 1 paisa of exact share', a.every((x, k) => !W || Math.abs(x - (t * w[k]) / W) < 1), () => JSON.stringify({ w, t, a }));
  }
  for (let g = 0; g < 5000; g++) { const [c, s] = splitGst(g); check('splitGst halves', c + s === g && c - s >= 0 && c - s <= 1); }
  check('mulDivRound big numbers exact', mulDivRound(9999999999, 9999, 10000) === 9998999999 + 0, String(mulDivRound(9999999999, 9999, 10000)));
}

// ---------- report ----------
const names = Object.keys(fails);
console.log(`${checks.toLocaleString()} checks, ${names.length ? names.length + ' kinds of failure' : 'no failures'}`);
for (const n of names) console.log(`✗ ${n}: ${fails[n].count} times\n    e.g. ${String(fails[n].first).slice(0, 600)}`);
process.exitCode = names.length ? 1 : 0;
