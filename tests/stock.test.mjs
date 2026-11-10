// Bottle check maths: how many services each tube / jar / bottle / kit lasted, from the bills.
// Units, sharing between two open ones, batches, gaps, normal (set or learned), flags, by person, suggestions.
import { productUnits, sizesInStore } from '../src/lib/units.js';
import { bottleCheck, unitNormal, daysNormal, median, openInfo, isEarly, levelResult } from '../src/lib/stockcheck.js';
import { useWeight, freeUseWeight, suggestTags, typicalUses, variantOf, parseSize, sizeText } from '../src/data/usage.js';
import { menuToServices } from '../src/data/menu.js';

let checks = 0;
const fails = [];
const check = (n, c, d = '') => { checks++; if (!c) fails.push(`✗ ${n} ${typeof d === 'function' ? d() : d}`); };
const near = (a, b, e = 0.011) => Math.abs(a - b) <= e;

const services = menuToServices().map((s, i) => ({ ...s, id: 's' + i }));
const byName = (n) => services.find((s) => s.name === n);

// ---------- how much one bill line counts ----------
check('plain service = 1', useWeight('Root Touch-up') === 1);
check('a bracket that is not an option = 1', useWeight("Kids' Haircut (Boys, under 10)") === 1 && useWeight('Lotus Basic Facial (Oily Skin)') === 1 && useWeight('O3+ Bridal Facial (Vitamin C Glow or Radiant Glow)') === 1);
check('hair length S/M/L/XL = 1 / 1.5 / 2 / 2.5', ['S', 'M', 'L', 'XL'].map((l) => useWeight(`Women's Global Colour (${l})`)).join() === '1,1.5,2,2.5');
check('fringe 0.5, crown 0.75', useWeight('Smoothening / Straightening / Rebonding (Fringe)') === 0.5 && useWeight('Smoothening / Straightening / Rebonding (Crown area)') === 0.75);
check('thick hair adds 0.5', useWeight('Keratin / Cysteine (L · Thick)') === 2.5 && useWeight('Nano-Active / Plastia (XL · Thick)') === 3);
check('thick without a length', useWeight('Something (Thick)') === 1.5);
check('empty bracket, no name', useWeight('x ()') === 1 && useWeight(null) === 1 && useWeight('') === 1);
check('use without a bill: same weights', freeUseWeight('L', 'Thick') === 2.5 && freeUseWeight(null, null) === 1 && freeUseWeight('M', '') === 1.5);
check('a thick-hair line still counts as its length for the option', variantOf({ name: 'Keratin (L · Thick)' }, byName('Keratin')) === 'L');

// ---------- suggestions ----------
for (const t of ['colour', 'developer', 'lightener', 'spa', 'shampoo', 'conditioner', 'treatment', 'oil', 'wax', 'rica', 'skin_bleach', 'facial_kit', 'manipedi']) {
  const s = suggestTags(t, services);
  check(`suggested services for ${t} are on the menu`, s.length > 0 && s.every((x) => x.service && x.weight > 0 && x.weight <= 50 && x.weight * 4 === Math.round(x.weight * 4)), JSON.stringify(s.map((x) => [x.service.name, x.weight])));
}
const dev = Object.fromEntries(suggestTags('developer', services).map((x) => [x.service.name, x.weight]));
check('developer: root touch-up 1, women\'s global colour 1.5 (short hair), beard 0.25', dev['Root Touch-up'] === 1 && dev["Women's Global Colour"] === 1.5 && dev['Beard Colour'] === 0.25, JSON.stringify(dev));
const wax = Object.fromEntries(suggestTags('wax', services).map((x) => [x.service.name, x.weight]));
check('peel-off wax: full face counts much more than the nose', wax['Peel-off Wax Full Face'] >= 4 * wax['Peel-off Wax Nose'], JSON.stringify(wax));
const rica = Object.fromEntries(suggestTags('rica', services).map((x) => [x.service.name, x.weight]));
check('rica: full body much more than half arms; men\'s full arms more than women\'s', rica['Rica Full Body'] >= 8 * rica['Rica Half Arms'] && rica["Men's Rica Full Arms"] > rica['Rica Full Arms'], JSON.stringify(rica));
check('brand-specific products (spa, treatment, D-tan) suggest their services but tick none by themselves', ['spa', 'treatment', 'skin_bleach', 'oil'].every((t) => suggestTags(t, services).every((x) => !x.ticked)));
check('every chart service that uses a product is suggested for one', services.filter((x) => !['Nails', 'Makeup', 'Threading'].includes(x.section) && !/Shave|Beard Trim|Kids'|Ironing/.test(x.name))
  .every((x) => ['colour', 'spa', 'shampoo', 'treatment', 'oil', 'wax', 'rica', 'skin_bleach', 'facial_kit'].some((t) => suggestTags(t, services).some((r) => r.service.id === x.id))),
  () => services.filter((x) => !['Nails', 'Makeup', 'Threading'].includes(x.section) && !/Shave|Beard Trim|Kids'|Ironing/.test(x.name) && !['colour', 'spa', 'shampoo', 'treatment', 'oil', 'wax', 'rica', 'skin_bleach', 'facial_kit'].some((t) => suggestTags(t, services).some((r) => r.service.id === x.id))).map((x) => x.name).join(', '));
check('facial kits: every facial counts 1 and none ticked by itself', suggestTags('facial_kit', services).every((x) => x.weight === 1 && !x.ticked));
check('typical: 1 L developer ≈ 17 services', typicalUses('developer', 1000, 'ml') === 17);
check('typical: a 5-use kit = 5', typicalUses('facial_kit', 5, 'uses') === 5);
check('typical: no size → none', typicalUses('spa', null, 'g') === null && typicalUses('other', 500, 'g') === null);

// ---------- units ----------
const H = 3600e3;
const T0 = Date.parse('2026-10-01T10:00:00+05:30');
const at = (h) => new Date(T0 + h * H).toISOString();
let seq = 0;
const id = (p) => `${p}${String(++seq).padStart(4, '0')}`;
const gcw = byName("Women's Global Colour");
const rtu = byName('Root Touch-up');
const spa = byName("Women's L'Oreal Classic Hair Spa");
const P = 'dev1';
const tags = [
  { product_id: P, service_id: rtu.id, weight: 1 },
  { product_id: P, service_id: gcw.id, weight: 1.5 },
];
function world() {
  const w = { moves: [], ends: [], bills: {}, items: [], free: [] };
  w.give = (h, staff = 'a', qty = 1, pid = P) => { const m = { id: id('m'), product_id: pid, type: 'use', qty: -qty, staff_id: staff, unit_cost: 450, empty_returned: true, created_at: at(h) }; w.moves.push(m); return m; };
  w.end = (m, h, how = 'empty', by = null) => w.ends.push({ move_id: m.id, product_id: m.product_id, ended_at: at(h), how, by_move: by });
  w.bill = (h, lines, status = 'paid') => { const b = { id: id('b'), created_at: at(h), status }; w.bills[b.id] = b; for (const [svc, name, qty = 1] of lines) w.items.push({ bill_id: b.id, item_type: 'service', service_id: svc.id, name, qty }); return b; };
  w.units = (from = at(-1000), t = tags) => productUnits({ productId: P, moves: w.moves, ends: w.ends, bills: w.bills, items: w.items, tags: t, freeUses: w.free, from });
  return w;
}
{
  const w = world();
  const a = w.give(0);
  w.bill(1, [[rtu, 'Root Touch-up']]);
  w.bill(2, [[gcw, "Women's Global Colour (L)"]]);           // 1.5 × 2 = 3
  w.bill(3, [[spa, "Women's L'Oreal Classic Hair Spa"]]);            // not ticked for this product
  w.bill(4, [[rtu, 'Root Touch-up']], 'cancelled');        // cancelled: not counted
  w.items.push({ bill_id: Object.keys(w.bills)[0], item_type: 'product', product_id: 'x', name: 'retail', qty: 1 });
  const b = w.give(5, 'r');
  w.end(a, 5, 'empty', b.id);
  w.bill(5, [[gcw, "Women's Global Colour (S · Thick)", 2]]); // exactly at the change: the new one; (1 + 0.5) × 1.5 × 2 = 4.5
  w.bill(6, [[rtu, 'Root Touch-up']]);
  const u = w.units();
  check('two units, oldest first', u.length === 2 && u[0].move_id === a.id && u[1].move_id === b.id, JSON.stringify(u));
  check('first unit: 1 + 3 = 4 uses, 2 clients', u[0].uses === 4 && u[0].clients === 2, JSON.stringify(u[0]));
  check('…is marked first, ended with the empty, by the next give-out', u[0].is_first && u[0].how === 'empty' && u[0].by_move === b.id && u[0].ended_at === at(5));
  check('second unit (open): a service at the very moment of the change is the new one\'s', u[1].uses === 5.5 && u[1].clients === 3 && !u[1].ended_at && !u[1].is_first, JSON.stringify(u[1]));
  check('no gap row when something was always in use', !u.some((x) => !x.move_id));
  // the window: only units in use on or after `from`
  const late = w.units(at(5.5));
  check('window: units that ended before it are left out', late.length === 1 && late[0].move_id === b.id && late[0].uses === 5.5, JSON.stringify(late));
  check('…but the one in use keeps all its uses', w.units(at(100))[0].uses === 5.5);
}
{
  // two open at once (a second one while the first is still in use): services in between count half for each
  const w = world();
  const a = w.give(0, 'a');
  w.bill(1, [[rtu, 'Root Touch-up']]);                    // only a: 1
  const b = w.give(2, 'r');                               // b opened, a still in use
  w.bill(3, [[rtu, 'Root Touch-up']]);                    // a ½, b ½
  w.bill(4, [[gcw, "Women's Global Colour (M)"]]);          // 2.25: a 1.125, b 1.125
  w.end(a, 5, 'empty', 'mX');
  w.bill(6, [[rtu, 'Root Touch-up']]);                    // only b: 1
  const u = w.units();
  check('shared: a = 1 + 0.5 + 1.125 = 2.63', near(u[0].uses, 2.63), JSON.stringify(u));
  check('shared: b = 0.5 + 1.125 + 1 = 2.63', near(u[1].uses, 2.63));
  check('shared: clients split too (a 2, b 2)', u[0].clients === 2 && u[1].clients === 2);
  check('nothing is counted twice: 2.63 + 2.63 ≈ 5.25', near(u[0].uses + u[1].uses, 5.25, 0.02));
}
{
  // a batch: 3 kits given out together, each kit's share
  const w = world();
  const a = w.give(0, 'p', 3);
  for (let i = 1; i <= 6; i++) w.bill(i, [[rtu, 'Root Touch-up']]);
  const u = w.units();
  check('3 together, 6 services → 2 each', u[0].n === 3 && u[0].uses === 2 && u[0].clients === 2, JSON.stringify(u));
  void a;
}
{
  // a gap: finished, then services billed before the next one was given out
  const w = world();
  w.bill(-5, [[rtu, 'Root Touch-up']]);                    // before the first give-out: not a gap
  const a = w.give(0);
  w.bill(1, [[rtu, 'Root Touch-up']]);
  w.end(a, 2, 'finished');
  w.bill(3, [[gcw, "Women's Global Colour (L)"]]);           // nothing in use: 3
  w.bill(4, [[rtu, 'Root Touch-up']]);                     // 1
  w.give(5);
  w.bill(6, [[rtu, 'Root Touch-up']]);
  const u = w.units();
  const gap = u.find((x) => !x.move_id);
  check('gap: 2 services (4 uses) billed with none in use', gap && gap.how === 'gap' && gap.uses === 4 && gap.clients === 2, JSON.stringify(u));
  check('gap row comes last', !u[u.length - 1].move_id);
  check('marked Finished ends the unit', u[0].how === 'finished' && u[0].uses === 1);
  check('no gap for a product never given out', productUnits({ productId: 'none', moves: w.moves, ends: w.ends, bills: w.bills, items: w.items, tags: [{ product_id: 'none', service_id: rtu.id }], freeUses: [], from: at(-1000) }).length === 0);
}
{
  // uses without a bill count like a bill line
  const w = world();
  w.give(0);
  w.free.push({ service_id: gcw.id, option_label: 'XL', extra_label: 'Thick', qty: 1, created_at: at(1) }); // 1.5 × 3 = 4.5
  w.free.push({ service_id: spa.id, option_label: null, extra_label: null, qty: 1, created_at: at(2) });    // not ticked
  check('a use without a bill counts', w.units()[0].uses === 4.5 && w.units()[0].clients === 1);
  check('weight 1 when a tag has none', productUnits({ productId: P, moves: w.moves, ends: w.ends, bills: w.bills, items: w.items, tags: [{ product_id: P, service_id: gcw.id }], freeUses: w.free, from: at(-10) })[0].uses === 3);
}

// ---------- normal ----------
const U = (uses, o = {}) => ({ move_id: id('u'), uses, clients: uses, n: 1, started_at: at(0), ended_at: at(10), is_first: false, ...o });
check('median odd / even', median([3, 1, 2]) === 2 && median([4, 1, 3, 2]) === 2.5 && median([]) === null);
{
  const units = [U(30, { is_first: true }), U(9), U(10)];
  check('2 finished (not counting the first) → still learning', unitNormal({}, units).normal === null && unitNormal({}, units).learnedN === 2);
  const n = unitNormal({}, [...units, U(12), U(1, { ended_at: null })]);
  check('3 finished → normal is their middle (10); the first and the open one don\'t count', n.normal === 10 && n.source === 'learned' && n.learnedN === 3, JSON.stringify(n));
  const set = unitNormal({ uses_per_unit: 14 }, [...units, U(12)]);
  check('the owner\'s number wins, the learned one is still shown', set.normal === 14 && set.source === 'set' && set.learned === 10);
  check('learned 0 (nothing billed) is not a normal', unitNormal({}, [U(0), U(0), U(0)]).normal === null);
  check('days normal', daysNormal([U(0, { started_at: at(0), ended_at: at(48) }), U(0, { started_at: at(0), ended_at: at(72) }), U(0, { started_at: at(0), ended_at: at(24) })]).normal === 2);
}

// ---------- the check ----------
{
  const NOW = at(1000);
  const prod = (o) => ({ id: id('p'), name: 'P' + seq, unit: 'bottle', cost_price: 400, stock: 3, low_stock: 1, ...o });
  const dev1 = prod({ name: 'Developer 1 L', uses_per_unit: 10 });
  const kit = prod({ name: 'Gold kit', unit: 'kit', cost_price: 350 });
  const gloves = prod({ name: 'Gloves box', unit: 'box', cost_price: 300 });
  const spaJar = prod({ name: 'Spa cream', unit: 'jar', stock: 0 });
  const fresh = prod({ name: 'New wax' });
  const report = {
    now: NOW,
    products: [
      { product_id: dev1.id, tags: 3, units: [
        U(14, { is_first: true, staff_id: 'a', started_at: at(0), ended_at: at(100) }),
        U(10, { staff_id: 'a', started_at: at(100), ended_at: at(300), how: 'empty' }),
        U(4, { staff_id: 'r', started_at: at(300), ended_at: at(400), how: 'no_empty', empty_returned: true, unit_cost: 450 }),   // early: 40% of 10
        U(6.9, { staff_id: 'r', started_at: at(400), ended_at: at(900), empty_returned: false }),                                 // early: 69%
        U(7, { staff_id: 'a', started_at: at(900), ended_at: at(950) }),                                                           // fine: 70%
        U(9.2, { staff_id: 'a', started_at: at(950), ended_at: null }),                                                            // open, 92%: almost
      ] },
      { product_id: kit.id, tags: 18, units: [U(1, { is_first: true }), U(1), U(1), U(0, { staff_id: 'p' }), U(1)] },             // learned 1, a kit with no facial → early
      { product_id: gloves.id, tags: 0, units: [
        U(0, { is_first: true, started_at: at(0), ended_at: at(240) }), U(0, { started_at: at(240), ended_at: at(480) }), U(0, { started_at: at(480), ended_at: at(720) }),
        U(0, { started_at: at(720), ended_at: at(960) }), U(0, { started_at: at(960), ended_at: at(980) }),                         // 20 h of a normal 240 h: early by days
        U(0, { started_at: at(980), ended_at: null }),
      ] },
      { product_id: spaJar.id, tags: 5, units: [U(3, { is_first: true }), U(2.1, { ended_at: null, staff_id: 'r' }), { move_id: null, how: 'gap', uses: 2, clients: 2 }] },
      { product_id: fresh.id, tags: 13, units: [] },
    ],
  };
  spaJar.uses_per_unit = 2;
  const staff = [{ id: 'a', name: 'Amit Das' }, { id: 'r', name: 'Rahul Roy' }, { id: 'p', name: 'Priya Saha' }];
  const free = [{ id: 'f1', staff_id: 'r', qty: 1, created_at: at(500) }, { id: 'f2', staff_id: 'a', qty: 1, created_at: at(-50) }];
  const r = bottleCheck({ report, products: [dev1, kit, gloves, spaJar, fresh], staff, freeUses: free, from: at(0), to: NOW });
  const row = (p) => r.rows.find((x) => x.product.id === p.id);
  const d = row(dev1);
  check('developer: normal 10 (yours)', d.normal === 10 && d.source === 'set' && d.by === 'uses');
  check('developer: newest first', d.units[0].ended_at === null && d.units[d.units.length - 1].is_first);
  check('developer: 4 and 6.9 uses finished early, 7 is fine (70%)', d.units.filter((u) => u.status === 'early').map((u) => u.uses).join() === '6.9,4' && d.units.find((u) => u.uses === 7).status === 'fine', JSON.stringify(d.units.map((u) => [u.uses, u.status])));
  check('developer: the first one is never judged', d.units.find((u) => u.is_first).status === 'first');
  check('developer: value not explained = 60% × ₹450 + 31% × ₹400', d.lost === 270 + 124, d.lost);
  check('developer: the one in use at 92% → almost finished, but 3 in the store → no "order now"', d.almost && !d.orderNow && d.units[0].status === 'almost');
  check('developer: Check (early wins over almost)', d.status === 'check' && d.early === 2);
  check('developer: 1 give-out without the empty', d.noEmpty === 1);
  const k = row(kit);
  check('kit: learned normal 1 from the finished kits', k.normal === 1 && k.source === 'learned');
  check('kit: a kit with no facial billed → finished early, ₹350', k.early === 1 && k.lost === 350);
  const g = row(gloves);
  check('gloves (no services ticked): checked by days, normal 10 days', g.by === 'days' && g.normal === 10, JSON.stringify([g.by, g.normal]));
  check('gloves: a box gone in under a day → early', g.early === 1 && g.units.find((u) => u.status === 'early').days < 1);
  const s = row(spaJar);
  check('spa: the jar in use has done 2.1 of 2 → almost; none in store → order now', s.almost && s.orderNow && s.status === 'almost');
  check('spa: services billed with none given out are shown', s.gap && s.gap.clients === 2);
  const info = openInfo(s);
  check('stock list line: uses so far and normal', info.uses === 2.1 && info.normal === 2 && info.almost && info.by === 'uses');
  check('a product never given out', row(fresh).status === 'none' && openInfo(row(fresh)) === null);
  check('order: Check first, then Almost finished', r.rows[0].status === 'check' && r.rows.findIndex((x) => x.status === 'almost') > r.rows.findIndex((x) => x.status === 'check') && r.rows[r.rows.length - 1].status === 'none');
  check('totals', r.totals.early === 4 && r.totals.almost === 2 && r.totals.orderNow === 1 && r.totals.free === 1 && r.totals.gaps === 1, JSON.stringify(r.totals));
  const rahul = r.staff.find((x) => x.id === 'r');
  check('by person: Rahul took 3, 2 finished early, 1 without the empty, 1 used without a bill', rahul.taken === 3 && rahul.early === 2 && rahul.noEmpty === 1 && rahul.free === 1, JSON.stringify(rahul));
  check('by person: worst first', r.staff[0].id === 'r');
  // period: only what ended in it
  const recent = bottleCheck({ report, products: [dev1, kit, gloves, spaJar, fresh], staff, freeUses: free, from: at(901), to: NOW });
  check('a shorter period counts only what ended in it', recent.rows.find((x) => x.product.id === dev1.id).early === 0);
  check('…the one in use still shows', recent.rows.find((x) => x.product.id === dev1.id).almost);
  check('…the free use before it is left out', recent.totals.free === 0);
  // learning
  const learn = bottleCheck({ report: { now: NOW, products: [{ product_id: kit.id, tags: 2, units: [U(1, { is_first: true }), U(1), U(1, { ended_at: null })] }] }, products: [kit] });
  check('not enough finished ones yet → Learning, nothing flagged', learn.rows[0].status === 'learning' && learn.rows[0].units.every((u) => u.status !== 'early'));
}

// ---------- size of one bottle ----------
const ps = (t, u) => JSON.stringify(parseSize(t, u));
check('sizes typed as printed', ps('1 L') === '{"size":1000,"unit":"ml"}' && ps('800ml') === '{"size":800,"unit":"ml"}' && ps('1.5l') === '{"size":1500,"unit":"ml"}'
  && ps('60 g') === '{"size":60,"unit":"g"}' && ps('1 kg') === '{"size":1000,"unit":"g"}' && ps('5 uses') === '{"size":5,"unit":"uses"}' && ps('1,000 ml') === '{"size":1000,"unit":"ml"}');
check('a plain number takes the product type\'s unit', ps('500', 'g') === '{"size":500,"unit":"g"}' && ps('500') === '{"size":500,"unit":"ml"}');
check('nonsense refused', parseSize('big') === null && parseSize('0 ml') === null && parseSize('1 cup') === null && parseSize('') === null && parseSize('-1 L') === null);
check('shown the way it is printed', sizeText(1000, 'ml') === '1 L' && sizeText(800, 'ml') === '800 ml' && sizeText(1500, 'ml') === '1.5 L' && sizeText(1000, 'g') === '1 kg' && sizeText(5, 'uses') === '5 uses' && sizeText(null, 'ml') === '');
{
  // a 500 ml delivery of a 1 L product: its bottles are expected to do half
  const w = world();
  const a = w.give(0); a.unit_size = 1000;
  for (let i = 1; i <= 4; i++) w.bill(i, [[rtu, 'Root Touch-up']]);
  const b = w.give(5); b.unit_size = 500;
  w.end(a, 5, 'empty', b.id);
  for (let i = 6; i <= 8; i++) w.bill(i, [[rtu, 'Root Touch-up']]);
  const u = productUnits({ productId: P, productSize: 1000, moves: w.moves, ends: w.ends, bills: w.bills, items: w.items, tags, freeUses: [], from: at(-10) });
  check('scale: 1 L = 1, 500 ml = 0.5', u[0].scale === 1 && u[1].scale === 0.5 && u[1].unit_size === 500);
  check('no product size → scale 1', productUnits({ productId: P, moves: w.moves, ends: w.ends, bills: w.bills, items: w.items, tags, freeUses: [], from: at(-10) }).every((x) => x.scale === 1));
  const moves = [
    { product_id: 'z', type: 'in', qty: 3, created_at: at(0) }, { product_id: 'z', type: 'in', qty: 2, unit_size: 500, created_at: at(1) },
    { product_id: 'z', type: 'use', qty: -1, unit_size: 1000, created_at: at(2) }, { product_id: 'z', type: 'use', qty: -1, unit_size: 500, created_at: at(3) },
  ];
  check('sizes in the store: 2 × 1 L (older) and 1 × 500 ml', JSON.stringify(sizesInStore({ id: 'z', size: 1000 }, moves).map((x) => [x.size, x.qty])) === '[[1000,2],[500,1]]');
  check('one size only when all deliveries are the usual one', sizesInStore({ id: 'z', size: 1000 }, moves.filter((m) => !m.unit_size || m.unit_size === 1000)).length === 1);
}
{
  const NOW = at(500);
  const P2 = { id: 'pp', name: 'Developer 1 L', unit: 'bottle', size: 1000, size_unit: 'ml', use_type: 'developer', cost_price: 400, stock: 2, uses_per_unit: 10 };
  const rep2 = { now: NOW, products: [{ product_id: 'pp', tags: 5, units: [
    U(9, { is_first: true }), U(4.5, { scale: 0.5, unit_size: 500, staff_id: 'a' }), U(3, { scale: 0.5, unit_size: 500, staff_id: 'a' }), U(6.5, { staff_id: 'a' }),
    U(2, { move_id: 'open1', ended_at: null, staff_id: 'r' }),
  ] }] };
  const staff2 = [{ id: 'a', name: 'Amit' }, { id: 'r', name: 'Rahul' }];
  const r2 = bottleCheck({ report: rep2, products: [P2], staff: staff2, from: at(-100), to: NOW });
  const units = r2.rows[0].units;
  const find = (uses) => units.find((x) => Number(x.uses) === uses);
  check('a 500 ml one is expected to do 5: 4.5 is fine, 3 is early', find(4.5).expected === 5 && find(4.5).status === 'fine' && find(3).status === 'early', JSON.stringify(units.map((x) => [x.uses, x.expected, x.status])));
  check('6.5 of 10: early (65%, 3.5 short)', find(6.5).status === 'early');
  check('a 500 ml one finished early loses half a bottle\'s cost × the share: (1 − 3/5) × ₹400', find(3).lost === 160);
  check('the same person, 2 early → talk to them', r2.staff.find((x) => x.id === 'a').repeat && r2.totals.repeats === 1 && r2.rows[0].repeat);
  check('the early rule needs a whole service short', isEarly(0.4, 1.2) === false && isEarly(0, 1) === true && isEarly(6.9, 10) === true && isEarly(7, 10) === false);
  // weekly check of the one in use: half gone means ~5 uses; the bills show 2 → running fast
  const fast = bottleCheck({ report: rep2, products: [P2], staff: staff2, checks: [{ move_id: 'open1', left_pct: 50, uses_at: 2, expected_at: 5, created_at: at(400) }], from: at(-100), to: NOW });
  check('weekly check: ½ left but bills explain 2 of ~5 → running fast, product Check', fast.rows[0].units[0].status === 'fast' && fast.rows[0].status === 'check' && fast.totals.fast === 1);
  check('…the stock list line says so', openInfo(fast.rows[0]).fast === true);
  check('levelResult: 4 of 5 fine, 2 of 5 fast, no normal → unknown', levelResult(4, 5) === 'ok' && levelResult(2, 5) === 'fast' && levelResult(2, null) === 'unknown' && levelResult(0, 0.5) === 'ok');
  const fine = bottleCheck({ report: rep2, products: [P2], staff: staff2, checks: [{ move_id: 'open1', left_pct: 75, uses_at: 2, expected_at: 2.5, created_at: at(400) }], from: at(-100), to: NOW });
  check('weekly check: ¾ left, 2 of ~2.5 → fine', fine.rows[0].units[0].status === 'open');
  // learned normal far below the typical for that size
  const learnedLow = bottleCheck({ report: { now: NOW, products: [{ product_id: 'pp', tags: 5, units: [U(9, { is_first: true }), U(6), U(6), U(7)] }] }, products: [{ ...P2, uses_per_unit: null }] });
  check('learned 6 for a 1 L developer that usually lasts ~17 → warned', learnedLow.rows[0].lowLearned && learnedLow.rows[0].lowLearned.typical === 17 && learnedLow.totals.lowLearned === 1);
  check('…not when it is your own number', !bottleCheck({ report: { now: NOW, products: [{ product_id: 'pp', tags: 5, units: [U(6), U(6), U(7)] }] }, products: [{ ...P2, uses_per_unit: 6 }] }).rows[0].lowLearned);
  check('learned normal counts a 500 ml one double', unitNormal({}, [U(5, { scale: 0.5 }), U(10), U(9)]).normal === 10);
}

console.log(`${checks} bottle check tests, ${fails.length} failed`);
for (const f of fails) console.log(f);
process.exitCode = fails.length ? 1 : 0;
