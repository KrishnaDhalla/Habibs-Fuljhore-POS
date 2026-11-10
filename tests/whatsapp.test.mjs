// WhatsApp, one tap: reading a booking someone sent on WhatsApp (pasted at the counter), and the daily stock message to
// staff. Uses the real menu (src/data/menu.js) and random messages written the ways people write them.
import { MENU, menuToServices } from '../src/data/menu.js';
import { parseWaBooking, parseWaDate, parseWaTime, matchService, waBookingText } from '../src/lib/bookings.js';
import { stockMessage } from '../src/lib/stockMessage.js';

let checks = 0, fails = 0;
const check = (n, c, d = '') => { checks++; if (!c) { fails++; if (fails < 40) console.log('✗', n, typeof d === 'function' ? d() : d); } };
let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const services = menuToServices(MENU).map((s, i) => ({ ...s, id: 'svc-' + i, active: true }));
const today = '2026-11-10';

// ---------- dates and times ----------
check('date: "today", "tomorrow"', parseWaDate('today', today) === today && parseWaDate('Tomorrow please', today) === '2026-11-11');
check('date: 2026-11-14, 14/11, 14-11-2026, 14.11.26', ['2026-11-14', '14/11', '14-11-2026', '14.11.26'].every((x) => parseWaDate(x, today) === '2026-11-14'));
check('date: "14 Nov", "14th November", "Nov 14", "Sat, 14 Nov 2026"', ['14 Nov', '14th November', 'Nov 14', 'Sat, 14 Nov 2026', 'on 14th of nov'].every((x) => parseWaDate(x, today) === '2026-11-14'));
check('date: "Saturday" is the next Saturday; "Tuesday" today is today', parseWaDate('Saturday', today) === '2026-11-14' && parseWaDate('tuesday', today) === today && parseWaDate('next tuesday', today) === '2026-11-17');
check('date: "5 Jan" in November is next January', parseWaDate('5 Jan', today) === '2027-01-05');
check('date: nothing like a date: null', parseWaDate('hello', today) === null && parseWaDate('31/02', today) === null);
check('time: 11:30 AM, 5pm, 5.30 pm, 17:00, 12 pm, 6:15', [['11:30 AM', '11:30'], ['5pm', '17:00'], ['5.30 pm', '17:30'], ['17:00', '17:00'], ['12 pm', '12:00'], ['6:15', '18:15'], ['10:30', '10:30']].every(([a, b]) => parseWaTime(a) === b));
check('time: a date or a lone number is not a time', parseWaTime('14/11') === null && parseWaTime('3 people') === null && parseWaTime('14 Nov') === null);
// random dates written every way
for (let i = 0; i < 3000; i++) {
  const d = addDays(today, ri(0, 80));
  const dt = new Date(d + 'T12:00:00Z');
  const D = dt.getUTCDate(), M = dt.getUTCMonth();
  const forms = [d, `${D}/${M + 1}`, `${D}-${M + 1}-${dt.getUTCFullYear()}`, `${D} ${MON[M]}`, `${D}th ${LONG[M]}`, `${MON[M]} ${D}`, `${WD[dt.getUTCDay()]}, ${D} ${MON[M]} ${dt.getUTCFullYear()}`];
  const f = pick(forms);
  check('random date read back', parseWaDate(f, today) === d, () => `${f} → ${parseWaDate(f, today)} want ${d}`);
  const h = ri(10, 20), m = pick([0, 15, 30, 45]);
  const tf = pick([`${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, m ? `${h % 12 || 12}.${m} ${h < 12 ? 'am' : 'pm'}` : `${h % 12 || 12}${h < 12 ? 'am' : 'pm'}`]);
  check('random time read back', parseWaTime(tf) === `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`, () => `${tf} → ${parseWaTime(tf)}`);
}

// ---------- services ----------
const by = (n) => services.find((s) => s.name === n);
const ker = by('Keratin');
check('service: "Keratin (L · Thick)" → Keratin, L, Thick', JSON.stringify(matchService('Keratin (L · Thick)', services)) === JSON.stringify({ service_id: ker.id, option: 'L', extra: 'Thick' }), JSON.stringify(matchService('Keratin (L · Thick)', services)));
check('service: "keratin (waist, thick hair)" → L, Thick', (() => { const m = matchService('keratin (waist, thick hair)', services); return m && m.option === 'L' && m.extra === 'Thick'; })());
check('service: the bill name with an apostrophe typed differently', !!matchService('Mens Haircut & Styling', services) && !!matchService("Men’s Haircut and Styling", services));
check('service: not on the menu → null', matchService('Tattoo', services) === null);
// every service on the menu, written as the website sends it, comes back the same
let n = 0;
for (const s of services) {
  const labels = Array.isArray(s.variants) ? s.variants.map((v) => v.label).filter(Boolean) : [];
  const ex = s.extra_options && s.extra_options.choices ? s.extra_options.choices.map((c) => c.label) : [];
  const opt = labels.length ? pick(labels) : '';
  const extra = ex.length && rnd() < 0.5 ? pick(ex) : '';
  const txt = s.name + (opt || extra ? ` (${[opt, extra].filter(Boolean).join(' · ')})` : '');
  const m = matchService(txt, services);
  n++;
  check('every service by its bill name, with its option', m && m.service_id === s.id && m.option === opt && m.extra === extra, () => `${txt} → ${JSON.stringify(m)}`);
}
check(`all ${services.length} services tried`, n === services.length && n > 100);

// ---------- whole messages ----------
const msg = waBookingText({ items: ['Keratin (L · Thick)', "Men's Haircut & Styling"], date: 'Sat, 14 Nov 2026', time: '11:30 AM', name: 'Riya Sen', phone: '98300 12345', note: 'Coming with my sister' }, 'Habibs Fuljhore');
const p = parseWaBooking(msg, services, today);
check('the website\'s WhatsApp message: everything read', p.name === 'Riya Sen' && p.phone === '9830012345' && p.date === '2026-11-14' && p.time === '11:30'
  && p.items.length === 2 && p.items[0].option === 'L' && p.items[0].extra === 'Thick' && p.unknown.length === 0 && p.note === 'Coming with my sister', JSON.stringify(p));
const free = parseWaBooking("Hi, I'd like to book Keratin (M). Day and time: Saturday 5pm", services, today);
check('the "Book on WhatsApp" button message: service, Saturday, 5 pm', free.items.length === 1 && free.items[0].option === 'M' && free.date === '2026-11-14' && free.time === '17:00', JSON.stringify(free));
const typed = parseWaBooking('*Name:* Puja\n*Services:* Threading Eyebrows, Fake Service\n*Date:* tomorrow\n*Time:* 4:30 pm\n+91 98765-43210', services, today);
check('typed with WhatsApp bold, a +91 number, one unknown service', typed.name === 'Puja' && typed.phone === '9876543210' && typed.date === '2026-11-11' && typed.time === '16:30' && typed.unknown.join() === 'Fake Service', JSON.stringify(typed));
check('a message with nothing in it: empty, no crash', (() => { const e = parseWaBooking('ok thanks', services, today); return !e.items.length && !e.date && !e.time && !e.phone; })());
// random whole messages from the menu
for (let i = 0; i < 2000; i++) {
  const picks = Array.from({ length: ri(1, 3) }, () => pick(services));
  const uniq = [...new Map(picks.map((s) => [s.id, s])).values()];
  const items = uniq.map((s) => {
    const labels = Array.isArray(s.variants) ? s.variants.map((v) => v.label).filter(Boolean) : [];
    const opt = labels.length ? pick(labels) : '';
    return { s, opt, txt: s.name + (opt ? ` (${opt})` : '') };
  });
  const d = addDays(today, ri(0, 60));
  const dt = new Date(d + 'T12:00:00Z');
  const h = ri(11, 20);
  const txt = waBookingText({ items: items.map((x) => x.txt), date: `${WD[dt.getUTCDay()]}, ${dt.getUTCDate()} ${MON[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`, time: `${h % 12 || 12}:30 ${h < 12 ? 'AM' : 'PM'}`, name: 'Test ' + i, phone: `9${String(ri(100000000, 999999999))}` }, 'Habibs');
  const r = parseWaBooking(txt, services, today);
  check('random website message read back exactly', r.date === d && r.time === `${String(h).padStart(2, '0')}:30` && r.items.length === items.length && r.unknown.length === 0
    && items.every((x, k) => r.items[k].service_id === x.s.id && r.items[k].option === x.opt), () => `${txt}\n→ ${JSON.stringify(r)}`);
}

// ---------- the daily stock message to staff ----------
const P = (o) => ({ id: o.name, kind: 'salon', unit: 'pcs', stock: 0, low_stock: 1, active: true, ...o });
const products = [
  P({ name: 'Keratin Kit', stock: 2, low_stock: 1, use_type: 'treatment' }),
  P({ name: 'Rica Wax 800 ml', stock: 1, low_stock: 1, use_type: 'wax' }),
  P({ name: 'Lotus Facial Kit', stock: 0, low_stock: 1, use_type: 'facial_kit' }),
  P({ name: 'Shampoo 1 L', stock: 3, low_stock: 2, use_type: 'shampoo' }),
  P({ name: 'Old Gel', stock: 4, active: false }),
  P({ name: 'Hair Serum 100 ml', kind: 'retail', stock: 3, low_stock: 1, sell_price: 550 }),
  P({ name: 'Hair Mask 200 g', kind: 'retail', stock: 0, low_stock: 1, sell_price: 650 }),
];
const open = [{ product_id: 'Keratin Kit' }, { product_id: 'Shampoo 1 L' }, { product_id: 'Lotus Facial Kit' }];
const usage = [{ product_id: 'Lotus Facial Kit', service_id: 'f1' }, { product_id: 'Lotus Facial Kit', service_id: 'f2' }, { product_id: 'Rica Wax 800 ml', service_id: 'w1' }];
const svcs = [{ id: 'f1', name: 'Lotus Fruit Facial' }, { id: 'f2', name: 'Lotus Gold Facial' }, { id: 'w1', name: 'Full Arms (Rica)' }];
const sm = stockMessage({ products, openUnits: open, usage, services: svcs, settings: { salon_name: 'Habibs', branch: 'Fuljhore, Durgapur' }, day: today });
check('stock message: the day and salon', /^\*Habibs Fuljhore: stock for Tue 10 Nov\*/.test(sm), sm);
check('stock message: salon products to use, with packs left and "1 open"', /Keratin Kit: 2 \(1 open\)/.test(sm) && /Shampoo 1 L: 3 \(1 open\)/.test(sm), sm);
check('stock message: low stock flagged', /Rica Wax 800 ml: 1 · running low/.test(sm), sm);
check('stock message: out of stock, with the services that use it ("ask before booking")', /Lotus Facial Kit[^\n]*(only the open one|1 open)/.test(sm) || /Out of stock[\s\S]*Lotus Facial Kit/.test(sm), sm);
check('stock message: a product out with none open lists its services', (() => {
  const m = stockMessage({ products, openUnits: [], usage, services: svcs, settings: {}, day: today });
  return /Out of stock[\s\S]*Lotus Facial Kit[^\n]*Lotus Fruit Facial, Lotus Gold Facial/.test(m);
})());
check('stock message: retail for sale with the price; sold-out retail listed as sold out', /Hair Serum 100 ml: 3 · ₹550/.test(sm) && /Hair Mask 200 g/.test(sm.split('Sold out')[1] || ''), sm);
check('stock message: products switched off are left out; no cost prices', !/Old Gel/.test(sm) && !/cost/i.test(sm));
check('stock message: fits in one WhatsApp message (under 4,000 characters) even with 300 products', (() => {
  const many = Array.from({ length: 300 }, (_, i) => P({ id: 'p' + i, name: 'Product number ' + i, stock: i % 5, kind: i % 3 ? 'salon' : 'retail', sell_price: 100 }));
  const m = stockMessage({ products: many, openUnits: [], usage: [], services: [], settings: {}, day: today });
  return m.length <= 4000 && /and \d+ more/.test(m);
})());

console.log(`${checks.toLocaleString('en-IN')} WhatsApp checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
