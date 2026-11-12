// One menu for the billing app and the website: categories, service changes and their approvals,
// the public website API (web_site, request_booking), products marked finished, and upgrading a
// database made with the October 2026 schema. Real SQL in an in-memory PostgreSQL (PGlite),
// with the demo database (localdb.js) checked against the same rules.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const { menuToCategories, menuToServices, SECTIONS, OLD_CATEGORIES } = await import('../src/data/menu.js');
const { createLocalDb } = await import('../src/lib/localdb.js');
const { applyOffers } = await import('../src/lib/offers.js');

let checks = 0;
const fails = [];
const check = (name, cond, detail = '') => { checks++; if (!cond) fails.push(`✗ ${name} ${typeof detail === 'function' ? detail() : detail}`.slice(0, 900)); };

const SCHEMA = readFileSync('supabase/01_schema.sql', 'utf8');
const SEED = readFileSync('supabase/02_seed_services.sql', 'utf8');
const OLD_SCHEMA = readFileSync('tests/fixtures/schema-2026-10.sql', 'utf8');
const OLD_SEED = readFileSync('tests/fixtures/seed-2026-10.sql', 'utf8');
const NOV_SEED = readFileSync('tests/fixtures/seed-2026-11-06.sql', 'utf8'); // the menu before the printed rate chart

async function newDb(steps) {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant execute on all functions in schema auth to authenticated, anon;`);
  for (const s of steps) await db.exec(s);
  // Supabase gives both API roles table rights; row level security is what keeps them out
  await db.exec(`grant usage on schema public to anon, authenticated; grant all on all tables in schema public to anon, authenticated;`);
  return db;
}
const IST_TODAY = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

// ======================= A. fresh install =======================
const db = await newDb([SCHEMA, SEED, SCHEMA]);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const tryq = async (sql, p) => { try { return await q(sql, p); } catch (e) { return { error: e.message }; } };
async function as(role, claims, fn) {
  await db.exec(`set role ${role}`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify(claims)]);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const owner = randomUUID(), clerk = randomUUID(), sOwner = randomUUID(), sClerk = randomUUID();
await q(`insert into app_roles values ($1, 'owner', 'Krishna')`, [owner]);
await q(`insert into login_requests (session_id, user_id, email, status) values ($1, $2, 'counter@habibs', 'approved')`, [sClerk, clerk]);
const clerkQ = (sql, p) => as('authenticated', { sub: clerk, session_id: sClerk, role: 'authenticated', email: 'counter@habibs' }, () => tryq(sql, p));
const ownerQ = (sql, p) => as('authenticated', { sub: owner, session_id: sOwner, role: 'authenticated', email: 'krishna@habibs' }, () => tryq(sql, p));
const anonQ = (sql, p) => as('anon', { role: 'anon' }, () => tryq(sql, p));
const grant = async (action, ref, extra = {}) => (await q(
  `insert into owner_grants (session_id, user_id, action, ref, status, method, decided_at, decided_by, expires_at)
   values ($1, $2, $3, $4, 'approved', $5, now(), $6, now() + interval '10 minutes') returning id`,
  [sClerk, clerk, action, ref, extra.method || 'telegram', extra.by || 'Raj (Telegram)']))[0].id;
const svc = async (id) => (await q(`select * from services where id = $1`, [id]))[0];

// ---------- 1. the rate chart (November 2026): every printed price, typed again here from the printed pages ----------
// kind: f = fixed price; len = "onwards" by hair length (S = printed, +₹500 a length); from = "onwards", typed at billing
const PRINTED = {
  "Men's Cut & Grooming": [["Men's Haircut & Styling", 349], ["Kids' Haircut (Boys, under 10)", 199], ['Beard Trim / Shape', 199], ['Shave', 149], ['Head Shave', 249], ["Men's Hair Wash & Blow-dry", 149]],
  "Women's Cut & Styling": [["Women's Haircut & Styling", 499], ["Kids' Haircut (Girls, under 10)", 299], ["Women's Hair Wash & Blow-dry", 399], ['Ironing / Tongs / Crimping / Roller Set', 999]],
  "Men's Colour": [["Men's Global Colour", 1199], ["Men's Global Colour, Ammonia-free", 1399], ["Men's Highlights", 1299], ["Men's Per Streak", 149], ['Beard Colour', 299]],
  // root touch-up corrected by the owner (printed 1,499 / 1,799): from 1,299 ammonia, from 1,499 ammonia-free
  "Women's Colour": [['Root Touch-up', 1299, 'from'], ['Root Touch-up, Ammonia-free', 1499, 'from'], ["Women's Global Colour", 2999, 'len'], ["Women's Global Colour, Ammonia-free", 3999, 'len'],
    ['Crown Highlights', 1999, 'len'], ['T-section Highlights', 2999, 'len'], ['Full Highlights', 4499, 'len'], ['Ombre', 3999, 'len'], ['Sombre', 4999, 'len'], ['Balayage', 5499, 'len'],
    ["Women's Per Streak", 299], ['Extra-thick Hair (Highlights Add-on)', 999, 'from']],
  "Men's Hair Spa": [["Men's Wella Classic Hair Spa", 799], ["Men's Wella Nourishing / Repair Hair Spa", 999], ["Men's L'Oreal Classic Hair Spa", 699], ["Men's L'Oreal Nourishing / Repair Hair Spa", 799],
    ["Men's Streax Classic Hair Spa", 499], ["Men's Streax Nourishing / Repair Hair Spa", 499], ["Men's Keratin Wash", 299], ["Men's Anti-dandruff Treatment", 1499], ["Men's Head Massage, 30 min", 499]],
  "Women's Hair Spa": [["Women's Wella Classic Hair Spa", 1499, 'from'], ["Women's Wella Nourishing / Repair Hair Spa", 2299, 'from'], ["Women's L'Oreal Classic Hair Spa", 1499, 'from'],
    ["Women's L'Oreal Nourishing / Repair Hair Spa", 1999, 'from'], ["Women's Streax Classic Hair Spa", 999, 'from'], ["Women's Streax Nourishing / Repair Hair Spa", 1299, 'from'],
    ["Women's Keratin Wash", 799, 'from'], ["Women's Anti-dandruff Treatment", 1499], ["Women's Head Massage, 30 min", 499]],
  'Hair Treatments': [['Smoothening / Straightening', 4499, 'len'], ["Men's Smoothening (Short Hair)", 1999], ['Keratin', 3999, 'len'], ['Kera Smoothening', 5999, 'len'], ['Hair Botox', 4999, 'len'], ['Nanoplastia', 5999, 'len']],
  'Lotus Professional Facials': [['Lotus Clean-up', 1299], ['Lotus D-Tan Clean-up', 1499], ['Lotus Basic Facial (Oily Skin)', 1799], ['Lotus Hydravitals Facial (Dry Skin)', 1799], ['Lotus Acne-X Facial', 2499],
    ['Lotus Preservita Sensitive Facial', 2499], ['Lotus Preservita Anti-ageing Facial', 2499], ['Lotus Insta Fair Facial', 2799], ['Lotus Goldsheen Facial', 2799], ['Lotus Bridal Glow Facial', 2999],
    ['Lotus Ultimo Gold / Pearl Facial', 3499], ['Lotus Miraki Facial', 3999]],
  'O3+ Facials': [['O3+ Clean-up', 1499], ['O3+ D-Tan Facial', 2499], ['O3+ Whitening / Brightening Facial', 3499], ['O3+ Seaweed Facial', 3499], ["O3+ Men's Facial", 3499], ['O3+ Anti-ageing Facial', 3499],
    ['O3+ Bridal Facial (Vitamin C Glow or Radiant Glow)', 3499], ['O3+ Gold Facial', 4499], ['O3+ Diamond Facial', 4499]],
  'Raaga D-Tan': [['Raaga D-Tan Face & Neck', 499], ['Raaga Charcoal D-Tan', 599], ['Raaga D-Tan Underarms', 249], ['Raaga D-Tan Half Arms', 599], ['Raaga D-Tan Full Arms', 799], ['Raaga D-Tan Half Legs', 999],
    ['Raaga D-Tan Full Legs', 1799], ['Raaga D-Tan Back', 1499], ['Raaga D-Tan Stomach', 999], ['Raaga D-Tan Feet & Palms', 499], ['Raaga D-Tan Full Body', 2999]],
  'O3+ D-Tan': [['O3+ D-Tan Face & Neck', 699], ['O3+ Charcoal D-Tan', 799], ['O3+ D-Tan Underarms', 299], ['O3+ D-Tan Half Arms', 799], ['O3+ D-Tan Full Arms', 999], ['O3+ D-Tan Half Legs', 1199],
    ['O3+ D-Tan Full Legs', 1999], ['O3+ D-Tan Back', 1699], ['O3+ D-Tan Stomach', 1199], ['O3+ D-Tan Feet & Palms', 699], ['O3+ D-Tan Full Body', 3499]],
  'Threading': [['Threading Eyebrows', 50], ['Threading Forehead', 50], ['Threading Upper Lip', 50], ['Threading Chin', 50], ['Threading Side Locks', 50], ["Men's Threading", 50], ['Threading Full Face', 399]],
  'Rica Wax': [['Rica Half Arms', 600], ['Rica Full Arms', 800], ['Rica Half Legs', 800], ['Rica Full Legs', 1100], ['Rica Midriff', 800], ['Rica Half Back', 900], ['Rica Full Back', 1200], ['Rica Buttock', 900], ['Rica Full Body', 4000]],
  "Men's Rica Wax": [["Men's Rica Full Arms", 999], ["Men's Rica Chest", 1199], ["Men's Rica Full Back", 1499]],
  'Peel-off Wax (Face & Underarms)': [['Peel-off Wax Nose', 100], ['Peel-off Wax Chin', 120], ['Peel-off Wax Forehead', 120], ['Peel-off Wax Upper & Lower Lip', 150], ['Peel-off Wax Side Locks', 150],
    ['Peel-off Wax Underarms', 300], ['Peel-off Wax Full Face', 550]],
};
const TABS = [['Hair', ["Men's Cut & Grooming", "Women's Cut & Styling"]], ['Colour', ["Men's Colour", "Women's Colour"]], ['Hair Spa', ["Men's Hair Spa", "Women's Hair Spa"]],
  ['Hair Treatments', ['Hair Treatments']], ['Facials', ['Lotus Professional Facials', 'O3+ Facials']], ['D-Tan', ['Raaga D-Tan', 'O3+ D-Tan']], ['Threading', ['Threading']],
  ['Waxing', ['Rica Wax', "Men's Rica Wax", 'Peel-off Wax (Face & Underarms)']], ['Nails', ['Manicure & Pedicure']], ['Makeup', ['Makeup', 'Bridal Packages', 'Groom Packages']]];
const nums = (v) => JSON.stringify((v || []).map((x) => [x.label, Number(x.price)]));
// One printed line against a services row: name, category, price, options
function printedOk(row, [name, price, kind = 'f'], cat) {
  if (!row || row.active === false || row.category !== cat) return false;
  if (kind === 'len') return !row.open_price && Number(row.price) === price && nums(row.variants) === JSON.stringify(['S', 'M', 'L', 'XL'].map((l, i) => [l, price + 500 * i]));
  if (kind === 'from') return row.open_price === true && Number(row.price) === price && !row.variants;
  return !row.open_price && Number(row.price) === price && !row.variants;
}
async function chartChecks(label, rows, cats, ownNails = 0) {
  const active = rows.filter((s) => s.active);
  let lines = 0;
  for (const [cat, items] of Object.entries(PRINTED)) {
    for (const it of items) {
      lines++;
      const r = active.find((s) => s.name === it[0]);
      check(`${label}: printed ${it[0]} ₹${it[1]}${it[2] ? ' ' + it[2] : ''}`, printedOk(r, it, cat), () => JSON.stringify(r && { c: r.category, p: r.price, v: r.variants, o: r.open_price }));
    }
    check(`${label}: ${cat} has exactly the printed lines`, active.filter((s) => s.category === cat).length === items.length, active.filter((s) => s.category === cat).map((s) => s.name).join(', '));
  }
  check(`${label}: 120 printed lines + 10 nails + 13 makeup = 143 services in billing`, lines === 120 && active.length === 143 + ownNails, active.length);
  check(`${label}: tabs and their categories in order`, JSON.stringify(TABS) === JSON.stringify(TABS.map(([t]) => [t, cats.filter((c) => c.section === t).sort((a, b) => a.sort - b.sort).map((c) => c.name)]))
    , () => JSON.stringify(cats.map((c) => [c.section, c.name, c.sort])));
  const tr = active.filter((s) => s.category === 'Hair Treatments');
  check(`${label}: hair treatments thick hair +₹500 (not the men's short-hair price)`, tr.every((s) => (s.name === "Men's Smoothening (Short Hair)" ? s.extra_options === null
    : s.extra_options && s.extra_options.title === 'Hair thickness' && JSON.stringify(s.extra_options.choices) === '[{"label":"Thick","price":500}]')));
  check(`${label}: no other service has an extra choice`, active.filter((s) => s.extra_options).length === 5);
  if (!ownNails) check(`${label}: nails and makeup as before`, nums(active.filter((s) => ['Nails', 'Makeup'].includes(s.section)).map((s) => ({ label: s.name, price: s.price })))
    === nums(menuToServices().filter((s) => ['Nails', 'Makeup'].includes(s.section)).map((s) => ({ label: s.name, price: s.price }))));
}
{
  const cats = await q(`select * from service_categories order by sort`);
  const want = menuToCategories();
  check('19 categories from the menu', cats.length === 19 && want.length === 19, cats.length);
  for (const w of want) {
    const c = cats.find((x) => x.name === w.name);
    check(`category ${w.name}: tab, slug and website fields`, c && c.section === w.section && c.slug === w.slug && c.web_page === w.web_page
      && c.web_tab === w.web_tab && c.web_type === w.web_type && c.consult_only === w.consult_only && (c.note || null) === w.note, () => JSON.stringify([c, w]));
  }
  const rows = await q(`select s.*, c.name cat from services s join service_categories c on c.id = s.category_id order by s.sort`);
  check('143 services, each in its category', rows.length === 143 && rows.every((s) => s.cat === s.category), rows.length);
  check('every service has a unique, tidy slug', new Set(rows.map((s) => s.slug)).size === 143 && rows.every((s) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(s.slug)), () => rows.map((s) => s.slug).join(' '));
  check('slugs without the apostrophe ("mens-loreal-classic-hair-spa")', rows.find((s) => s.name === "Men's L'Oreal Classic Hair Spa").slug === 'mens-loreal-classic-hair-spa');
  const menu = menuToServices();
  check('billing names, tabs, prices and options as in menu.js', menu.every((m, i) => rows[i].name === m.name && rows[i].section === m.section && rows[i].category === m.category
    && Number(rows[i].price) === m.price && JSON.stringify(rows[i].variants) === JSON.stringify(m.variants) && rows[i].open_price === m.open_price && rows[i].for_gender === m.for_gender));
  await chartChecks('new install', rows, cats);
  check('website names: "Men\'s Haircut & Styling" is "Haircut & Styling" under Men\'s Cut & Grooming', rows.find((s) => s.name === "Men's Haircut & Styling").web_name === 'Haircut & Styling'
    && rows.find((s) => s.name === 'Raaga Charcoal D-Tan').web_name === 'Charcoal D-Tan' && rows.find((s) => s.name === 'Peel-off Wax Nose').web_name === 'Nose' && rows.find((s) => s.name === 'Keratin').web_name === null);
  check('men and women marked for the website', rows.filter((s) => s.for_gender === 'men').length === 26 && rows.filter((s) => s.for_gender === 'women').length === 26
    && rows.find((s) => s.name === "O3+ Men's Facial").for_gender === 'men', () => [rows.filter((s) => s.for_gender === 'men').length, rows.filter((s) => s.for_gender === 'women').length]);
  check('tabs: the same list in the database and the app', JSON.stringify((await q(`select menu_sections() s`))[0].s) === JSON.stringify(SECTIONS));
  check('a category on a tab that does not exist is refused', !!(await tryq(`insert into service_categories (name, section) values ('X', 'Spa')`)).error);
  check('loading the menu is not logged as changes', (await q(`select count(*)::int n from service_changes`))[0].n === 0);
  let again = '';
  try { await db.exec(SEED); } catch (e) { again = e.message; }
  check('running the rate chart again changes nothing', !again && (await q(`select count(*)::int n from service_changes`))[0].n === 0 && (await q(`select count(*)::int n from services`))[0].n === 143, again);
}

// ---------- 2. who can change the menu ----------
const cut = (await q(`select id from services where name = $1`, ["Men's Haircut & Styling"]))[0].id;
const beard = (await q(`select id from services where name = 'Beard Trim / Shape'`))[0].id;
{
  check('counter reads the menu', (await clerkQ(`select count(*)::int n from services`))[0].n === 143 && (await clerkQ(`select count(*)::int n from service_categories`))[0].n === 19);
  check('counter cannot change a price directly', (await clerkQ(`update services set price = 1 where id = $1 returning id`, [cut])).length === 0);
  check('counter cannot add a category directly', !!(await clerkQ(`insert into service_categories (name, slug) values ('Free', 'free')`)).error);
  check('counter cannot change a category directly', (await clerkQ(`update service_categories set name = 'X' returning id`)).length === 0);
  const r0 = await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: cut, price: 1 })]);
  check('counter: price change refused without the owner', /Owner approval needed/.test(r0.error || ''), JSON.stringify(r0));
  // an "open owner screens" approval from Telegram is not enough
  await grant('unlock', null, { method: 'telegram' });
  check('owner screens unlocked on Telegram: still refused', /Owner approval needed/.test((await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: cut, price: 1 })])).error || ''));
  check('…and the counter can now change settings (the unlock works)', (await clerkQ(`update settings set value = '20' where key = 'max_discount_pct' returning key`)).length === 1);
  await q(`update owner_grants set expires_at = now() where action = 'unlock'`);
  // one-time approval of exactly this change
  const g1 = await grant('service', cut);
  check('approval for another service does not work', !!(await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: beard, price: 1, owner_grant_id: g1 })])).error);
  const r1 = await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: cut, variants: [{ label: 'Stylist', price: 399 }, { label: 'Senior', price: 549 }], owner_grant_id: g1 })]);
  check('approved on Telegram: saved, price = cheapest option', !r1.error && Number(r1[0].price) === 399 && r1[0].name === "Men's Haircut & Styling" && r1[0].category === "Men's Cut & Grooming", JSON.stringify(r1));
  // adding to the menu: the owner only (owner login or the owner's code here), not a Telegram approval
  const newId = randomUUID(), newCat = randomUUID();
  const gNew = await grant('service', newId), gCat = await grant('service', newCat);
  const anyCat = (await q(`select id from service_categories limit 1`))[0].id;
  check('a new service with a Telegram approval is refused: only the owner adds services', /Only the owner can add a service/.test((await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: newId, name: 'Hair Tattoo', category_id: anyCat, price: 999, owner_grant_id: gNew })])).error || ''));
  check('…and a new category', /Only the owner can add a category/.test((await clerkQ(`select * from save_service_category($1)`, [JSON.stringify({ id: newCat, name: 'Tattoo', section: 'Beauty', owner_grant_id: gCat })])).error || ''));
  check('…the approval is not used up by the refusal', !(await q(`select used_at from owner_grants where id = $1`, [gNew]))[0].used_at);
  check('the approval is used up', !!(await q(`select used_at from owner_grants where id = $1`, [g1]))[0].used_at
    && !!(await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: cut, price: 1, owner_grant_id: g1 })])).error);
  const log = (await q(`select * from service_changes order by created_at desc limit 1`))[0];
  check('change history: before → after, who, who approved', log && log.service_id === cut && log.action === 'edit' && Number(log.changes.price[0]) === 349 && Number(log.changes.price[1]) === 399
    && log.changes.variants && log.changed_by === 'counter@habibs' && log.approved_by === 'Raj (Telegram)' && log.owner_grant_id === g1, JSON.stringify(log));
  check('counter cannot read the change history', (await clerkQ(`select count(*)::int n from service_changes`))[0].n === 0);
  check('owner reads the change history', (await ownerQ(`select count(*)::int n from service_changes`))[0].n >= 1);
  // the owner at the counter (Authenticator code): every change in the next 10 minutes
  const code = await grant('unlock', null, { method: 'code', by: 'Krishna (code)' });
  check('code unlock: counter can change services', !(await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: beard, price: 229 })])).error && Number((await svc(beard)).price) === 229);
  check('code unlock: the counter can add a service (the owner is here)', !(await clerkQ(`select * from save_service($1)`, [JSON.stringify({ name: 'Hair Tattoo', category_id: (await q(`select id from service_categories limit 1`))[0].id, price: 999 })])).error);
  check('code unlock: and add a category', !(await clerkQ(`select * from save_service_category($1)`, [JSON.stringify({ name: 'Nail Art', section: 'Beauty', web_page: 'nails', web_tab: 'Mani / Pedi' })])).error);
  check('…logged as approved by the code', (await q(`select approved_by from service_changes where owner_grant_id = $1 limit 1`, [code]))[0]?.approved_by === 'Krishna (code)');
  await q(`update owner_grants set expires_at = now() where id = $1`, [code]);
  check('after 10 minutes: locked again', !!(await clerkQ(`select * from save_service($1)`, [JSON.stringify({ id: beard, price: 1 })])).error);
  // owner login
  check('owner login: changes directly', (await ownerQ(`update services set price = 249 where id = $1 returning id`, [beard])).length === 1);
  check('owner login: save_service without asking', !(await ownerQ(`select * from save_service($1)`, [JSON.stringify({ id: beard, subtitle: 'With hot towel' })])).error);
  check('…logged as "Owner login"', (await q(`select approved_by, changed_by from service_changes where service_id = $1 order by created_at desc limit 1`, [beard]))[0].approved_by === 'Owner login');
  check('a waiting login cannot even ask', !!(await as('authenticated', { sub: clerk, session_id: randomUUID(), role: 'authenticated' }, () => tryq(`select * from save_service($1)`, [JSON.stringify({ id: beard, price: 1 })]))).error);
}

// ---------- 3. services and categories behave ----------
{
  const O = (p) => ownerQ(`select * from save_service($1)`, [JSON.stringify(p)]);
  const spa = (await q(`select id from service_categories where name = $1`, ["Men's Hair Spa"]))[0].id;
  const n1 = await O({ name: "Men's Keratin Wash", category_id: spa, price: 2499 });
  check('new service with the same name gets its own slug', !n1.error && n1[0].slug === 'mens-keratin-wash-2' && n1[0].section === 'Hair Spa' && n1[0].category === "Men's Hair Spa", JSON.stringify(n1));
  check('new service: website defaults on', n1[0].show_on_website === true && n1[0].book_online === true && n1[0].for_gender === 'any');
  const n2 = await O({ name: 'Scalp Detox', category: 'Scalp Care', price: 999 });
  check('old apps can still send a category name: a new category is made', !n2.error && (await q(`select slug, section from service_categories where name = 'Scalp Care'`))[0]?.slug === 'scalp-care');
  check('bad options refused', /Price options/.test((await O({ id: n1[0].id, variants: [{ label: 'S', price: 'x' }] })).error || '') && /Price options/.test((await O({ id: n1[0].id, variants: [{ label: 'S', price: 100 }] })).error || ''));
  check('negative price refused', !!(await O({ id: n1[0].id, price: -5 })).error);
  check('only the fields sent change', !(await O({ id: n1[0].id, description: 'Smooth, shiny hair' })).error && Number((await svc(n1[0].id)).price) === 2499 && (await svc(n1[0].id)).name === "Men's Keratin Wash");
  check('unknown fields are ignored (no changing the id or slug)', !(await O({ id: n1[0].id, slug: 'hacked', created_at: '2020-01-01', cost: 1 })).error && (await svc(n1[0].id)).slug === 'mens-keratin-wash-2');
  check('includes saved as a list', !(await O({ id: n1[0].id, includes: ['Wash', 'Blow-dry'] })).error && JSON.stringify((await svc(n1[0].id)).includes) === '["Wash","Blow-dry"]');
  check('extra choice saved', !(await O({ id: n1[0].id, extra_options: { title: 'Hair thickness', choices: [{ label: 'Thick', price: 500 }, { label: 'Extra thick', price: 1000 }] } })).error
    && (await svc(n1[0].id)).extra_options.choices.length === 2);
  for (const [bad, why] of [[{ title: '', choices: [{ label: 'Thick', price: 500 }] }, 'no title'], [{ title: 'T', choices: [] }, 'no choices'], [{ title: 'T', choices: [{ label: 'Thick', price: -1 }] }, 'negative price'],
    [{ title: 'T', choices: [{ label: ' ', price: 5 }] }, 'blank name'], [[1, 2], 'not a choice list']]) {
    check(`bad extra choice refused (${why})`, /Extra choice/.test((await O({ id: n1[0].id, extra_options: bad })).error || '') || !!(await O({ id: n1[0].id, extra_options: bad })).error);
  }
  check('extra choice removed again', !(await O({ id: n1[0].id, extra_options: null })).error && (await svc(n1[0].id)).extra_options === null);
  check('time taken checked (5 to 720 minutes)', !!(await O({ id: n1[0].id, duration_min: 2 })).error && !(await O({ id: n1[0].id, duration_min: 60 })).error);
  // rename a category: services, offers and bills keep working
  const facials = (await q(`select * from service_categories where name = 'Lotus Professional Facials'`))[0];
  const offerId = randomUUID();
  await q(`insert into offers (id, name, applies_to, categories, kind, value) values ($1, 'Tuesday facial', 'category', $2, 'amount', 300)`, [offerId, ['Lotus Professional Facials']]);
  check('rename refused if the name is taken', /already a category/.test((await ownerQ(`select * from save_service_category($1)`, [JSON.stringify({ id: facials.id, name: "men's colour" })])).error || ''));
  const rn = await ownerQ(`select * from save_service_category($1)`, [JSON.stringify({ id: facials.id, name: 'Lotus Facials & Clean-ups', section: 'Facials' })]);
  check('rename works, slug stays (website links keep working)', !rn.error && rn[0].slug === facials.slug && rn[0].name === 'Lotus Facials & Clean-ups', JSON.stringify(rn));
  check('…its services follow', (await q(`select count(*)::int n from services where category_id = $1 and category = 'Lotus Facials & Clean-ups'`, [facials.id]))[0].n === 12);
  const off = (await q(`select * from offers where id = $1`, [offerId]))[0];
  check('…and the offer still applies to it', JSON.stringify(off.categories) === '["Lotus Facials & Clean-ups"]');
  const fruit = (await q(`select * from services where name = 'Lotus Hydravitals Facial (Dry Skin)'`))[0];
  const applied = applyOffers([{ id: 1, item_type: 'service', service_id: fruit.id, name: fruit.name, qty: 1, unit_price: 1799, gst_pct: 5 }],
    [{ ...off, value: 300, min_bill: 0 }], { servicesById: { [fruit.id]: fruit } });
  check('…billing still gives the offer', JSON.stringify(applied).includes('Tuesday facial'), () => JSON.stringify(applied).slice(0, 300));
  const mv = await ownerQ(`select * from save_service_category($1)`, [JSON.stringify({ id: (await q(`select id from service_categories where name = 'Scalp Care'`))[0].id, section: 'Beauty' })]);
  check('category moved to another tab: its services follow', !mv.error && (await q(`select section from services where name = 'Scalp Detox'`))[0].section === 'Beauty');
  check('a category with services cannot be deleted', !!(await tryq(`delete from service_categories where id = $1`, [facials.id])).error);
}

// ---------- 4. the website API ----------
{
  check('website (no login) cannot read any table', (await Promise.all(['services', 'service_categories', 'offers', 'settings', 'customers', 'bills', 'bill_items', 'staff', 'products', 'stock_moves', 'bookings', 'owner_grants', 'service_changes']
    .map(async (t) => { const r = await anonQ(`select count(*)::int n from ${t}`); return r.error || r[0].n === 0; }))).every(Boolean));
  check('website cannot write to tables', !!(await anonQ(`insert into bookings (ref, phone) values ('x', '9830012345')`)).error && (await anonQ(`update services set price = 1 returning id`)).length === 0);
  for (const fn of [`save_service('{}')`, `save_service_category('{}')`, `mark_finished('{}')`, `create_bill('{}')`, `issue_stock('{}')`, `request_owner_unlock('unlock', null, '', '', null)`, `menu_change_grant(null, null)`]) {
    check(`website cannot call ${fn.split('(')[0]}`, /permission denied/.test((await anonQ(`select ${fn}`)).error || ''), fn);
  }
  await ownerQ(`select * from save_service($1)`, [JSON.stringify({ id: beard, show_on_website: false })]);
  await ownerQ(`update services set active = false where name = 'Shave'`);
  const hidden = (await q(`select id from service_categories where name = 'Groom Packages'`))[0].id;
  await ownerQ(`select * from save_service_category($1)`, [JSON.stringify({ id: hidden, show_on_website: false })]);
  await q(`insert into offers (name, kind, value, show_on_website, web_title, web_text, web_tag, applies_to, service_ids, ends_on)
           values ('Groom 2999', 'price', 2999, true, 'Groom Makeup', 'Wedding season', 'WEDDING SEASON', 'services', $1, $2),
                  ('Old offer', 'percent', 10, true, null, null, null, 'all', null, $3),
                  ('Secret staff offer', 'percent', 50, false, null, null, null, 'all', null, null),
                  ('Next month', 'percent', 15, true, null, null, null, 'category', null, null)`,
  [[(await q(`select id from services where name = 'Wedding Day Groom Make-up'`))[0].id], plusDays(5), plusDays(-1)]);
  await q(`update offers set starts_on = $1, categories = '{"Women''s Hair Spa"}' where name = 'Next month'`, [plusDays(20)]);
  await q(`update offers set active = true`);
  const w = (await anonQ(`select web_site() w`))[0].w;
  const all = w.menu.flatMap((g) => g.items);
  const visible = (await q(`select s.* from services s join service_categories c on c.id = s.category_id where s.active and s.show_on_website and c.show_on_website`));
  check('website gets the menu, offers, salon and a version', Array.isArray(w.menu) && Array.isArray(w.offers) && w.salon && /^\d{8}T\d{6}$/.test(w.version), Object.keys(w));
  check('exactly the visible services', all.length === visible.length && visible.every((s) => all.some((i) => i.uid === s.id)), `${all.length} vs ${visible.length}`);
  check('hidden service, stopped service and hidden category left out', !all.some((i) => i.bill_name === 'Beard Trim / Shape' || i.bill_name === 'Shave') && !w.menu.some((g) => g.title === 'Groom Packages'));
  const colour = w.menu.find((g) => g.id === 'womens-colour');
  const gcw = colour.items.find((i) => i.bill_name === "Women's Global Colour");
  check('groups in the website\'s CATALOGUE shape', colour.cat === 'hair' && colour.tab === 'Colour' && colour.type === 'Colour' && colour.title === "Women's Colour" && /Patch test/.test(colour.note) && Array.isArray(colour.items));
  check('items: name, prices, labels, sized', JSON.stringify(gcw.p) === '[2999,3499,3999,4499]' && JSON.stringify(gcw.lbl) === '["S","M","L","XL"]' && gcw.sized === true && gcw.from === false && gcw.n === 'Global Colour' && gcw.for === 'women', JSON.stringify(gcw));
  const men = all.find((i) => i.bill_name === "Men's Haircut & Styling");
  check('a price changed in the app is what the website shows', JSON.stringify(men.p) === '[399,549]' && JSON.stringify(men.lbl) === '["Stylist","Senior"]' && men.sized === false);
  await ownerQ(`select * from save_service($1)`, [JSON.stringify({ id: (await q(`select id from services where name = 'Head Shave'`))[0].id, variants: [{ label: '', price: 249 }, { label: '', price: 299 }] })]);
  const unl = (await anonQ(`select web_site() w`))[0].w.menu.flatMap((g) => g.items).find((i) => i.bill_name === 'Head Shave');
  check('options without labels: prices only', JSON.stringify(unl.p) === '[249,299]' && unl.lbl === null);
  const rtu = all.find((i) => i.bill_name === 'Root Touch-up');
  check('root touch-up is "from ₹1,299"', rtu.from === true && JSON.stringify(rtu.p) === '[1299]');
  const bridal = all.find((i) => i.bill_name === 'Bridal Makeup');
  check('"onwards" prices are "from"', bridal.from === true && JSON.stringify(bridal.p) === '[10000]');
  const nanoW = all.find((i) => i.bill_name === 'Nanoplastia');
  check('website gets the treatment sizes and the thickness choice', nanoW.sized === true && JSON.stringify(nanoW.p) === '[5999,6499,6999,7499]' && nanoW.extra.title === 'Hair thickness' && nanoW.extra.choices[0].price === 500, JSON.stringify(nanoW));
  check('website names used ("Full Legs" under Rica Wax)', w.menu.find((g) => g.id === 'rica').items.some((i) => i.n === 'Full Legs' && i.bill_name === 'Rica Full Legs'));
  check('categories in menu order', w.menu[0].id === 'mens-cut' && w.menu.findIndex((g) => g.id === 'womens-colour') < w.menu.findIndex((g) => g.id === 'rica'));
  check('offers: only website, running or coming, with what they apply to', w.offers.length === 2 && w.offers[0].title === 'Groom Makeup' && w.offers[0].live === true
    && JSON.stringify(w.offers[0].services) === '["wedding-day-groom-make-up"]' && w.offers.some((o) => o.live === false && JSON.stringify(o.categories) === '["womens-hair-spa"]'), () => JSON.stringify(w.offers));
  check('salon details only (no GSTIN, UPI or limits)', Object.keys(w.salon).sort().join() === 'address,branch,instagram,maps_url,opening_hours,phone,prices_include_gst,salon_name,whatsapp', Object.keys(w.salon).join());
  const txt = JSON.stringify(w);
  // (ids taken out first: a random id can have "9830" in it, which isn't a phone number)
  const pub = txt.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, 'ID').replace(/"max_discount":|"new_customers_only":/g, '');
  const PRIVATE = /cost_price|stock|gstin|upi|salary|9830|customer|max_discount_pct|owner/;
  check('nothing private in it', !PRIVATE.test(pub), () => { const k = pub.search(PRIVATE); return pub.slice(Math.max(0, k - 120), k + 60); });
  const v1 = w.version;
  await new Promise((r) => setTimeout(r, 1100));
  await ownerQ(`select * from save_service($1)`, [JSON.stringify({ id: cut, variants: [{ label: 'Stylist', price: 349 }, { label: 'Senior', price: 549 }] })]);
  const w2 = (await anonQ(`select web_site() w`))[0].w;
  check('version changes when a price changes (website can cache until then)', w2.version !== v1 && JSON.stringify(w2.menu[0].items.find((i) => i.uid === cut).p) === '[349,549]');
}

// ---------- 5. booking requests from the website ----------
{
  const B = (p) => anonQ(`select request_booking($1) r`, [JSON.stringify(p)]);
  const gcw = (await q(`select id from services where name = $1`, ["Women's Global Colour"]))[0].id;
  const cutId = cut;
  const bridalId = (await q(`select id from services where name = 'Bridal Makeup'`))[0].id;
  await q(`insert into customers (phone, name) values ('9830011111', 'Riya Sen')`);
  const r1 = await B({ phone: '+91 98300 11111', name: 'Riya', date: IST_TODAY, time: 'Evening', note: 'First time colour', items: [{ service_id: gcw, option: 'M', price: 1 }, { service_id: bridalId }],
    utm: { source: 'instagram', campaign: 'diwali', evil: 'x'.repeat(500) } });
  check('booking accepted, with a short code', !r1.error && /^[0-9A-F]{6}$/.test(r1[0].r.ref) && r1[0].r.status === 'requested', JSON.stringify(r1));
  const b = (await q(`select * from bookings where id = $1`, [r1[0].r.id]))[0];
  const its = await q(`select * from booking_items where booking_id = $1 order by name desc`, [b.id]);
  check('phone cleaned to 10 digits and linked to the customer', b.phone === '9830011111' && !!b.customer_id && b.source === 'website' && b.want_time === 'Evening');
  check('prices come from the menu, not the website', Number(its[0].price) === 3499 && its[0].option_label === 'M' && its[0].price_from === false, JSON.stringify(its));
  check('"onwards" service booked as a "from" price', its[1].name === 'Bridal Makeup' && its[1].price_from === true && Number(its[1].price) === 10000);
  check('only known tracking fields kept, cut to 100 characters', JSON.stringify(Object.keys(b.utm).sort()) === '["campaign","source"]');
  check('the website cannot read bookings back', (await anonQ(`select count(*)::int n from bookings`))[0].n === 0);
  check('the counter sees it and can confirm it', (await clerkQ(`update bookings set status = 'confirmed', slot_at = now() where id = $1 returning id`, [b.id])).length === 1);
  const nanoId = (await q(`select id from services where name = 'Nanoplastia'`))[0].id;
  const rb = await B({ phone: '9830077777', name: 'Moumita', date: IST_TODAY, items: [{ service_id: nanoId, option: 'L', extra: 'Thick' }] });
  const bi = (await q(`select i.* from booking_items i join bookings b on b.id = i.booking_id where b.phone = '9830077777'`))[0];
  check('booking: long thick hair = L price + ₹500', !rb.error && Number(bi.price) === 7499 && bi.option_label === 'L · Thick' && bi.price_from === false, JSON.stringify([rb, bi]));
  const no = async (p, re, name) => { const r = await B(p); check(name, re.test(r.error || ''), JSON.stringify(r)); };
  const ok1 = { phone: '9830022222', name: 'Arijit', date: IST_TODAY, items: [{ service_id: cutId }] };
  await no({ ...ok1, phone: '12345' }, /10-digit/, 'bad phone refused');
  await no({ ...ok1, phone: '5830022222' }, /10-digit/, 'phone not starting 6-9 refused');
  await no({ ...ok1, name: ' ' }, /name/, 'name needed');
  await no({ ...ok1, date: plusDays(-1) }, /next 90 days/, 'past date refused');
  await no({ ...ok1, date: plusDays(120) }, /next 90 days/, 'date too far refused');
  await no({ ...ok1, date: 'soon' }, /date/, 'nonsense date refused');
  await no({ ...ok1, items: [] }, /1 to 10/, 'no services refused');
  await no({ ...ok1, items: Array(11).fill({ service_id: cutId }) }, /1 to 10/, 'more than 10 refused');
  await no({ ...ok1, items: [{ service_id: beard }] }, /can't be booked online/, 'service hidden from the website refused');
  await no({ ...ok1, items: [{ service_id: 'not-a-uuid' }] }, /can't be booked online/, 'made-up service refused');
  await q(`update services set book_online = false where name = 'Saree Draping'`);
  await no({ ...ok1, items: [{ service_id: (await q(`select id from services where name = 'Saree Draping'`))[0].id }] }, /can't be booked online/, '"no online booking" service refused');
  check('a variant service without an option is a "from" price', !(await B({ ...ok1, phone: '9830033333', items: [{ service_id: gcw }] })).error
    && (await q(`select price_from from booking_items i join bookings b on b.id = i.booking_id where b.phone = '9830033333'`))[0].price_from === true);
  for (let i = 0; i < 3; i++) await B(ok1);
  await no(ok1, /3 requests/, 'more than 3 a day from one number refused');
  // one connection sending many numbers (a script)
  const fromIp = (p) => as('anon', { role: 'anon' }, async () => { await db.query(`select set_config('request.headers', '{"x-forwarded-for": "203.0.113.9, 10.0.0.1"}', false)`);
    try { return await tryq(`select request_booking($1) r`, [JSON.stringify(p)]); } finally { await db.query(`select set_config('request.headers', '', false)`); } });
  let lastIp;
  for (let i = 0; i < 6; i++) lastIp = await fromIp({ ...ok1, phone: '97000000' + String(10 + i) });
  check('more than 5 an hour from one connection refused', /Too many requests from this connection/.test(lastIp.error || ''), JSON.stringify(lastIp));
  check('…only a hash of the address is kept', (await q(`select count(distinct client_key)::int n, bool_and(client_key ~ '^[0-9a-f]{32}$') h from bookings where phone like '97000000%'`))[0].h === true);
  check('offer only if it is on the website', !(await B({ ...ok1, phone: '9830044444', offer_id: (await q(`select id from offers where name = 'Secret staff offer'`))[0].id })).error
    && (await q(`select offer_id from bookings where phone = '9830044444'`))[0].offer_id === null);
}

// ---------- 5c. bookings at the counter (WhatsApp, phone, walk-in), enquiries, and the visit link ----------
{
  const sv = async (n) => (await q(`select * from services where name = $1`, [n]))[0];
  const ker = await sv('Keratin'), facial = await sv('Lotus Hydravitals Facial (Dry Skin)'), cutS = await sv("Men's Haircut & Styling");
  const SB = (p, who = clerkQ) => who(`select * from save_booking($1)`, [JSON.stringify(p)]);
  const stf = randomUUID();
  await q(`insert into staff (id, name) values ($1, 'Rahul Roy')`, [stf]);
  const tomorrow = plusDays(1);
  const r1 = await SB({ phone: '98311 00012', name: 'Megha', source: 'whatsapp', date: tomorrow, slot_at: `${tomorrow}T17:00:00+05:30`, staff_id: stf,
    items: [{ service_id: ker.id, option: 'L', extra: 'Thick' }, { service_id: facial.id }], note: 'wants Rahul' });
  const b1 = r1[0];
  check('counter books a WhatsApp customer: confirmed with the time, stylist and who took it', !r1.error && b1.status === 'confirmed' && b1.source === 'whatsapp' && b1.want_time === '17:00'
    && b1.staff_id === stf && b1.created_by === 'counter@habibs' && !!b1.confirmed_at && /^[0-9A-F]{6}$/.test(b1.ref), JSON.stringify(r1));
  const it1 = await q(`select * from booking_items where booking_id = $1 order by name = 'Keratin' desc`, [b1.id]);
  check('prices from the menu: Keratin L + thick ₹5,499, facial ₹' + Number(facial.price), Number(it1[0].price) === 5499 && it1[0].option_label === 'L · Thick' && Number(it1[1].price) === Number(facial.price), JSON.stringify(it1));
  check('duration: 30 min a service when not set', b1.duration_min === 60);
  const r2 = await SB({ phone: '9831100013', name: 'Ritika', source: 'instagram', date: tomorrow, time: 'Morning', items: [{ service_id: cutS.id }] });
  check('no time yet → a request, keeping what they asked for', !r2.error && r2[0].status === 'requested' && r2[0].want_time === 'Morning' && !r2[0].slot_at);
  const no = async (p, re, name, who) => { const r = await SB(p, who); check(name, re.test(r.error || ''), JSON.stringify(r)); };
  const base = { phone: '9831100014', name: 'Test', date: tomorrow, items: [{ service_id: cutS.id }] };
  await no({ ...base, phone: '123' }, /10-digit/, 'counter booking: bad phone refused');
  await no({ ...base, name: 'x' }, /name/, 'counter booking: name needed');
  await no({ ...base, items: [] }, /1 to 10/, 'counter booking: a service needed');
  await no({ ...base, date: plusDays(-1) }, /today or a later day/, 'counter booking: a past day refused');
  await no({ ...base, date: plusDays(200) }, /6 months/, 'counter booking: too far refused');
  await no({ ...base, slot_at: `${plusDays(2)}T10:00:00+05:30` }, /another day/, 'counter booking: a time on another day refused');
  await no({ ...base, status: 'confirmed' }, /time to confirm/, 'counter booking: confirmed needs a time');
  await no({ ...base, source: 'tv' }, /source/, 'counter booking: unknown source refused');
  await no({ ...base, items: [{ service_id: randomUUID() }] }, /not on the menu/, 'counter booking: made-up service refused');
  await no(base, /permission denied/, 'the website key cannot use the counter booking', anonQ);
  // confirm the request, then move it: a new time needs a new confirmation
  const r3 = await SB({ id: r2[0].id, phone: '9831100013', name: 'Ritika', date: tomorrow, slot_at: `${tomorrow}T11:00:00+05:30`, staff_id: stf });
  check('confirming a request: time and stylist, services kept, source kept', !r3.error && r3[0].status === 'confirmed' && r3[0].want_time === '11:00' && r3[0].source === 'instagram'
    && (await q(`select count(*)::int n from booking_items where booking_id = $1`, [r2[0].id]))[0].n === 1, JSON.stringify(r3));
  await q(`update bookings set confirm_sent_at = now(), reminded_at = now() where id = $1`, [r2[0].id]);
  const r4 = await SB({ id: r2[0].id, phone: '9831100013', name: 'Ritika', date: tomorrow, slot_at: `${tomorrow}T12:30:00+05:30`, staff_id: stf });
  check('moving it clears "confirmation sent" and "reminder sent"', !r4.error && r4[0].confirm_sent_at === null && r4[0].reminded_at === null && r4[0].want_time === '12:30');
  const web = (await q(`select id, phone, name from bookings where source = 'website' limit 1`))[0];
  const r5 = await SB({ id: web.id, phone: web.phone, name: web.name, source: 'whatsapp', date: IST_TODAY, slot_at: `${IST_TODAY}T18:00:00+05:30` });
  check('a website booking stays a website booking when confirmed', !r5.error && r5[0].source === 'website' && r5[0].status === 'confirmed');
  // enquiries: the website form
  const E = (p) => anonQ(`select request_enquiry($1) r`, [JSON.stringify(p)]);
  const nano = await sv('Nanoplastia');
  const e1 = await E({ phone: '+91 98311 00021', name: 'Ananya', message: 'Nano price for waist-length hair?', service_ids: [nano.id, 'junk', randomUUID()], utm: { source: 'instagram', x: 'y' } });
  check('website enquiry accepted with a code', !e1.error && /^[0-9A-F]{6}$/.test(e1[0].r.ref), JSON.stringify(e1));
  const er = (await q(`select * from enquiries where id = $1`, [e1[0].r.id]))[0];
  check('…phone cleaned, only real visible services kept, status new, only known tracking fields', er.phone === '9831100021' && JSON.stringify(er.service_ids) === JSON.stringify([nano.id])
    && er.status === 'new' && er.source === 'website' && JSON.stringify(Object.keys(er.utm)) === '["source"]', JSON.stringify(er));
  const ne = async (p, re, name) => { const r = await E(p); check(name, re.test(r.error || ''), JSON.stringify(r)); };
  await ne({ phone: '12', name: 'A B', message: 'hi there' }, /10-digit/, 'enquiry: bad phone refused');
  await ne({ phone: '9831100029', name: '', message: 'hi there' }, /name/, 'enquiry: name needed');
  await ne({ phone: '9831100029', name: 'Abc', message: '' }, /question/, 'enquiry: a question or a service needed');
  await ne({ phone: '9831100029', name: 'Abc', message: 'x', service_ids: Array(11).fill(nano.id) }, /up to 10/, 'enquiry: up to 10 services');
  for (let i = 0; i < 3; i++) await E({ phone: '9831100028', name: 'Spam', message: 'hello ' + i });
  await ne({ phone: '9831100028', name: 'Spam', message: 'again' }, /already have your question/, 'enquiry: 3 a day per number');
  check('the website cannot read enquiries back', (await anonQ(`select count(*)::int n from enquiries`))[0].n === 0);
  // enquiries at the counter
  check('counter adds a WhatsApp enquiry', !(await clerkQ(`insert into enquiries (phone, name, source, message) values ('9831100022', 'Shreya', 'whatsapp', 'Bridal trial?')`)).error);
  check('enquiry phone must be 10 digits', !!(await clerkQ(`insert into enquiries (phone, source, message) values ('+919831100022', 'whatsapp', 'x')`)).error);
  check('enquiry status must be known', !!(await clerkQ(`update enquiries set status = 'maybe' where phone = '9831100022' returning id`)).error);
  const eid = (await q(`select id from enquiries where phone = '9831100022'`))[0].id;
  const r6 = await SB({ phone: '9831100022', name: 'Shreya', source: 'whatsapp', date: tomorrow, slot_at: `${tomorrow}T15:00:00+05:30`, items: [{ service_id: facial.id }], enquiry_id: eid });
  check('booking made from an enquiry: the enquiry is booked, and they point at each other', !r6.error && r6[0].enquiry_id === eid
    && (await q(`select status, booking_id from enquiries where id = $1`, [eid]))[0].status === 'booked' && (await q(`select booking_id from enquiries where id = $1`, [eid]))[0].booking_id === r6[0].id);
  // the visit link: a paid bill for that phone on that day
  const bill = async (phone, day, status = 'paid') => {
    const id = randomUUID();
    await q(`insert into bills (id, bill_no, created_at, customer_phone, subtotal, taxable, total, pay_mode, status) values ($1, $2, $3, $4, 0, 0, 0, 'UPI', $5)`, [id, 'LV-' + id.slice(0, 8), `${day}T15:30:00+05:30`, phone, status]);
    return id;
  };
  const otherDay = await bill('9831100012', IST_TODAY);
  check('a bill on another day does not touch the booking', (await q(`select status from bookings where id = $1`, [b1.id]))[0].status === 'confirmed');
  const bid = await bill('9831100012', tomorrow);
  let row = (await q(`select status, bill_id from bookings where id = $1`, [b1.id]))[0];
  check('a bill for that phone that day: the booking came, with the bill', row.status === 'came' && row.bill_id === bid, JSON.stringify(row));
  await q(`insert into enquiries (phone, name, source, message, created_at) values ('9831100012', 'Megha', 'whatsapp', 'keratin price?', $1::timestamptz - interval '3 days')`, [`${tomorrow}T12:00:00+05:30`]);
  await bill('9831100012', tomorrow);
  check('…an enquiry from before the visit is marked came', (await q(`select status from enquiries where phone = '9831100012'`))[0].status === 'came');
  check('a second bill the same day doesn\'t move the booking to it', (await q(`select bill_id from bookings where id = $1`, [b1.id]))[0].bill_id === bid);
  await q(`update bills set status = 'cancelled' where id = $1`, [bid]);
  row = (await q(`select status, bill_id from bookings where id = $1`, [b1.id]))[0];
  check('the bill cancelled → the booking is back to confirmed', row.status === 'confirmed' && row.bill_id === null, JSON.stringify(row));
  void otherDay;
  // counter actions
  check('counter marks a no-show', (await clerkQ(`update bookings set status = 'no_show' where id = $1 returning status`, [r6[0].id]))[0]?.status === 'no_show');
  check('a booking status must be known', !!(await clerkQ(`update bookings set status = 'maybe' where id = $1 returning id`, [r6[0].id])).error);
  check('the website key cannot change bookings', (await anonQ(`update bookings set status = 'cancelled' returning id`)).length === 0 || !!(await anonQ(`update bookings set status = 'cancelled' returning id`)).error);
}

// ---------- 5d. the WhatsApp booking bot (wa_book, wa_enquiry: only the whatsapp function, service key) ----------
{
  const sv = async (n) => (await q(`select * from services where name = $1`, [n]))[0];
  const gcw = await sv("Women's Global Colour"), cutS = await sv("Men's Haircut & Styling");
  const WB = (p) => tryq(`select wa_book($1) r`, [JSON.stringify(p)]);
  const WE = (p) => tryq(`select wa_enquiry($1) r`, [JSON.stringify(p)]);
  const day = plusDays(2);
  // they asked for prices first
  const e0 = await WE({ phone: '919831155501', name: 'Payel', message: 'Asked for prices & offers on WhatsApp' });
  check('bot: an enquiry from "Prices & offers"', !e0.error && e0[0].r.fresh === true, JSON.stringify(e0));
  const e1 = await WE({ phone: '9831155501', message: 'Do you do keratin for boys?' });
  const er = (await q(`select * from enquiries where phone = '9831155501'`));
  check('…what they write next is added to the same enquiry', !e1.error && e1[0].r.fresh === false && er.length === 1 && /prices/.test(er[0].message) && /keratin for boys/.test(er[0].message) && er[0].source === 'whatsapp' && er[0].created_by === 'whatsapp', JSON.stringify(er));
  await WE({ phone: '9831155501', message: 'Do you do keratin for boys?' });
  check('…the same words twice are kept once', (await q(`select message from enquiries where phone = '9831155501'`))[0].message.split('keratin').length === 2);
  const r1 = await WB({ phone: '919831155501', name: 'Payel Das', date: day, time: '17:00', items: [{ service_id: gcw.id, option: 'M' }, { service_id: cutS.id }] });
  check('bot: a booking request, with a code', !r1.error && /^[0-9A-F]{6}$/.test(r1[0].r.ref) && r1[0].r.items.length === 2, JSON.stringify(r1));
  const b = (await q(`select * from bookings where id = $1`, [r1[0].r.id]))[0];
  check('…in Appointments → Requests: WhatsApp, the day and time asked, 10-digit phone, how long', b.status === 'requested' && b.source === 'whatsapp' && b.created_by === 'whatsapp' && b.want_time === '17:00'
    && b.phone === '9831155501' && !b.slot_at && b.duration_min >= 30, JSON.stringify(b));
  const its = await q(`select * from booking_items where booking_id = $1 order by name desc`, [b.id]);
  check('…prices from the menu (M size)', Number(its[0].price) === 3499 && its[0].option_label === 'M', JSON.stringify(its));
  check('…the enquiry before it is now booked, and they point at each other', b.enquiry_id === er[0].id && (await q(`select status, booking_id from enquiries where id = $1`, [er[0].id]))[0].booking_id === b.id
    && (await q(`select status from enquiries where id = $1`, [er[0].id]))[0].status === 'booked');
  check('…the counter sees it', (await clerkQ(`select id from bookings where id = $1`, [b.id])).length === 1);
  const base = { phone: '9831155502', name: 'Test', date: day, time: '11:00', items: [{ service_id: cutS.id }] };
  const no = async (p, re, name) => { const r = await WB(p); check(name, re.test(r.error || ''), JSON.stringify(r)); };
  await no({ ...base, phone: '123' }, /Bad phone/, 'bot booking: bad phone refused');
  await no({ ...base, name: '' }, /Name/, 'bot booking: name needed');
  await no({ ...base, date: plusDays(-1) }, /Bad date/, 'bot booking: a past day refused');
  await no({ ...base, date: plusDays(40) }, /Bad date/, 'bot booking: more than 30 days ahead refused');
  await no({ ...base, time: '5pm' }, /Bad time/, 'bot booking: a time must be HH:MM');
  await no({ ...base, items: Array(6).fill({ service_id: cutS.id }) }, /1 to 5/, 'bot booking: 5 services at most');
  await no({ ...base, items: [{ service_id: (await sv('Beard Trim / Shape')).id }] }, /not bookable/, 'bot booking: a service hidden from online booking refused');
  check('…a refused booking leaves nothing behind', (await q(`select count(*)::int n from bookings where phone = '9831155502'`))[0].n === 0);
  for (let i = 0; i < 3; i++) await WB(base);
  await no(base, /Too many/, 'bot booking: 3 a day from one number');
  check('the app and the website cannot call the bot\'s functions', /permission denied/.test((await anonQ(`select wa_book($1)`, [JSON.stringify(base)])).error || '')
    && /permission denied/.test((await clerkQ(`select wa_enquiry($1)`, [JSON.stringify(base)])).error || ''));
  check('the bot\'s chats are not readable by the app', (await clerkQ(`select * from wa_chats`)).length === 0 || !!(await clerkQ(`select * from wa_chats`)).error);
}

// ---------- 5b. CSV exports can't carry spreadsheet formulas ----------
{
  const { toCSV } = await import('../src/lib/format.js');
  const csv = toCSV([{ n: '=HYPERLINK("http://x","Click")', m: '+91 98300', a: -250, t: '-3 days', ok: 'Riya, Sen' }], [['n', 'Name'], ['m', 'Phone'], ['a', 'Amount'], ['t', 'Note'], ['ok', 'Other']]);
  const row = csv.split('\n')[1];
  check('CSV: formula text is defused', row.startsWith(`"'=HYPERLINK(""http://x"",""Click"")"`), row);
  check('CSV: + and - text defused, numbers kept', row.includes(",'+91 98300,") && row.includes(',-250,') && row.includes(",'-3 days,"), row);
  check('CSV: commas still quoted', row.endsWith('"Riya, Sen"'), row);
}

// ---------- 6. products: MRP, supplier discount, note, finished ----------
{
  const p1 = randomUUID(), p2 = randomUUID();
  await q(`insert into products (id, name, kind, unit, cost_price, mrp, supplier_discount_pct) values ($1, 'Hair Spa Cream 500 g', 'salon', 'jar', 900, 1500, 40), ($2, 'Shampoo 250 ml', 'retail', 'pcs', 320, 450, null)`, [p1, p2]);
  await q(`insert into stock_moves (product_id, type, qty, unit_cost) values ($1, 'in', 2, 900)`, [p1]);
  check('counter can change the supplier discount, cost and note', (await clerkQ(`update products set supplier_discount_pct = 35, cost_price = 975, note = 'Order from Raaga' where id = $1 returning id`, [p1])).length === 1);
  check('counter cannot change the MRP', !!(await clerkQ(`update products set mrp = 100 where id = $1`, [p1])).error);
  const F = (who, p) => who(`select * from mark_finished($1)`, [JSON.stringify(p)]);
  const f0 = await F(clerkQ, { product_id: p2, note: 'Need 6 by Friday' });
  check('finished with nothing left: no approval needed', !f0.error && !!f0[0].finished_at && f0[0].finished_by === 'counter@habibs' && /Need 6 by Friday/.test(f0[0].note), JSON.stringify(f0));
  const id1 = randomUUID();
  check('finished while the app shows 2: needs the owner', /Owner approval needed: the app still shows 2 jar/.test((await F(clerkQ, { id: id1, product_id: p1 })).error || ''));
  check('…nothing changed', Number((await q(`select stock from products where id = $1`, [p1]))[0].stock) === 2 && !(await q(`select finished_at from products where id = $1`, [p1]))[0].finished_at);
  const g = await grant('stock', id1);
  const f1 = await F(clerkQ, { id: id1, product_id: p1, owner_grant_id: g });
  const mv = (await q(`select * from stock_moves where id = $1`, [id1]))[0];
  check('approved: the 2 written off as missing, at cost', !f1.error && mv && mv.type === 'adjust' && Number(mv.qty) === -2 && Number(mv.unit_cost) === 975 && mv.owner_grant_id === g && /still in the app/.test(mv.note), JSON.stringify([f1, mv]));
  check('…stock 0, marked finished', Number(f1[0].stock) === 0 && !!f1[0].finished_at);
  check('sending it twice writes off once', !(await F(clerkQ, { id: id1, product_id: p1, owner_grant_id: g })).error && (await q(`select count(*)::int n from stock_moves where product_id = $1 and type = 'adjust'`, [p1]))[0].n === 1);
  await q(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 3)`, [p1]);
  check('stock coming in ends "finished"', !(await q(`select finished_at from products where id = $1`, [p1]))[0].finished_at);
  check('owner login marks finished without asking', !(await F(ownerQ, { product_id: p1 })).error);
  check('the website cannot mark finished', /permission denied/.test((await anonQ(`select mark_finished('{}')`)).error || ''));
}

// ---------- 6b. demo data from before the Bottle check (version 4) is kept and upgraded ----------
{
  mem.clear();
  const d0 = createLocalDb();
  await new Promise((r) => setTimeout(r, 200)); // the demo saves itself a moment later
  const st = JSON.parse(mem.get('habibs-pos-demo-v1'));
  const prod = st.products.find((x) => x.kind === 'salon');
  const moves = [10, 8, 6].map((d, i) => ({ id: 'old' + i, product_id: prod.id, type: 'use', qty: -1, staff_id: st.staff[i % 2].id, empty_returned: i !== 1, created_at: new Date(Date.now() - d * 86400e3).toISOString() }));
  st.version = 4;
  st.stock_moves = [...st.stock_moves.filter((m) => m.type !== 'use'), ...moves];
  delete st.unit_ends;
  delete st.free_uses;
  for (const u of st.service_usage) delete u.weight;
  mem.set('habibs-pos-demo-v1', JSON.stringify(st));
  const d = createLocalDb();
  const ends = await d.list('unit_ends', {});
  check('demo upgrade: old give-outs end the one before, the newest is in use', ends.length === 2 && ends.find((e) => e.move_id === 'old0')?.by_move === 'old1'
    && ends.find((e) => e.move_id === 'old0')?.how === 'no_empty' && ends.find((e) => e.move_id === 'old1')?.how === 'empty', JSON.stringify(ends));
  check('demo upgrade: bills and usage kept, usage counts as 1', (await d.list('bills', {})).length === st.bills.length && (await d.list('service_usage', {})).every((u) => u.weight === 1));
  check('demo upgrade: Bottle check works', (await d.rpc('unit_report', {})).products.some((x) => x.product_id === prod.id && x.units.length >= 3));
  void d0;
}

// ---------- 7. demo database follows the same rules ----------
{
  mem.clear();
  localStorage.setItem('demo-owner-auto', '0'); // approve by hand below
  const d = createLocalDb();
  const cats = await d.list('service_categories', {});
  const rows = await d.list('services', {});
  const want = menuToCategories();
  check('demo: same categories and website fields as the database', cats.length === 19 && want.every((w) => { const c = cats.find((x) => x.name === w.name); return c && c.slug === w.slug && c.web_page === w.web_page && c.web_tab === w.web_tab; }));
  const pg = await q(`select name, slug from services where slug <> 'mens-keratin-wash-2' and name <> 'Scalp Detox'`);
  check('demo: same service slugs as the database', rows.length === 143 && rows.every((s) => pg.find((x) => x.name === s.name)?.slug === s.slug));
  const s0 = rows.find((x) => x.name === "Men's Haircut & Styling");
  check('demo: change refused without the owner', /Owner approval needed/.test(await d.rpc('save_service', { p: { id: s0.id, price: 1 } }).catch((e) => e.message)));
  const g = await d.ownerRequest({ action: 'service', ref: s0.id, detail: 'x' });
  await d.ownerDecide(g.id, true);
  const other = rows.find((x) => x.name === 'Beard Trim / Shape');
  check('demo: approval for another service refused', /Owner approval needed/.test(await d.rpc('save_service', { p: { id: other.id, price: 1, owner_grant_id: g.id } }).catch((e) => e.message)));
  const r = await d.rpc('save_service', { p: { id: s0.id, variants: [{ label: 'Stylist', price: 399 }, { label: 'Senior', price: 549 }], owner_grant_id: g.id } });
  check('demo: approved change saved, price = cheapest option', r.price === 399 && r.slug === s0.slug);
  check('demo: approval used up', /Owner approval needed/.test(await d.rpc('save_service', { p: { id: s0.id, price: 1, owner_grant_id: g.id } }).catch((e) => e.message)));
  const gn = await d.ownerRequest({ action: 'service', ref: 'new-svc-1', detail: 'x' });
  await d.ownerDecide(gn.id, true);
  check('demo: a new service with a Telegram approval is refused (owner only)', /Only the owner can add a service/.test(await d.rpc('save_service', { p: { id: 'new-svc-1', name: 'Hair Tattoo', category_id: s0.category_id, price: 999, owner_grant_id: gn.id } }).catch((e) => e.message)));
  const log = (await d.list('service_changes', {}))[0];
  check('demo: change history kept', log && log.service_id === s0.id && log.changes.price[0] === 349 && log.changes.price[1] === 399);
  await d.ownerCode({ code: '123456' });
  const cat = cats.find((c) => c.name === 'Lotus Professional Facials');
  await d.insert('offers', { name: 'Tue', applies_to: 'category', categories: ['Lotus Professional Facials'], kind: 'amount', value: 300 });
  await d.rpc('save_service_category', { p: { id: cat.id, name: 'Lotus Facials & Clean-ups' } });
  check('demo: rename moves services and offers along, slug stays', (await d.list('services', { eq: { category_id: cat.id } })).every((s) => s.category === 'Lotus Facials & Clean-ups')
    && (await d.list('offers', {})).find((o) => o.name === 'Tue').categories[0] === 'Lotus Facials & Clean-ups' && (await d.list('service_categories', { eq: { id: cat.id } }))[0].slug === cat.slug);
  check('demo: duplicate category name refused', /already a category/.test(await d.rpc('save_service_category', { p: { name: "men's colour" } }).catch((e) => e.message)));
  check('demo: a tab that does not exist becomes Hair (the database refuses it)', (await d.rpc('save_service_category', { p: { name: 'Odd', section: 'Spa' } })).section === 'Hair');
  const prod = (await d.list('products', {})).find((p) => p.name === 'Hair Spa Cream 500 g');
  // bookings at the counter and the visit link, the same as the database
  const { calcBill } = await import('../src/lib/calc.js');
  const svcs = await d.list('services', {});
  const kerD = svcs.find((x) => x.name === 'Keratin');
  const dayD = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
  const bd = await d.rpc('save_booking', { p: { phone: '98311 00055', name: 'Demo Megha', source: 'whatsapp', date: dayD, slot_at: `${dayD}T23:30:00+05:30`, items: [{ service_id: kerD.id, option: 'L', extra: 'Thick' }] } });
  const bdi = await d.list('booking_items', { eq: { booking_id: bd.id } });
  check('demo: counter booking priced like the database (L + thick = ₹5,499), confirmed', bd.status === 'confirmed' && bd.want_time === '23:30' && bdi.length === 1 && bdi[0].price === 5499 && bdi[0].option_label === 'L · Thick', JSON.stringify([bd, bdi]));
  check('demo: same checks (past day refused)', /today or a later day/.test(await d.rpc('save_booking', { p: { phone: '9831100056', name: 'Abc', date: '2020-01-01', items: [{ service_id: kerD.id }] } }).catch((e) => e.message)));
  const lines = [{ item_type: 'service', service_id: kerD.id, name: 'Keratin (L · Thick)', category: kerD.category, qty: 1, unit_price: 5499, gst_pct: Number(kerD.gst_pct) || 0 }];
  const rb = calcBill(lines, { discountType: 'pct', discountValue: 0, gstOn: false, inclusive: true });
  const billD = await d.rpc('create_bill', { p: { customer_phone: '9831100055', customer_name: 'Demo Megha', subtotal: rb.subtotal, discount: rb.discount, taxable: rb.taxable, cgst: rb.cgst, sgst: rb.sgst, round_off: rb.round_off, total: rb.total, pay_mode: 'UPI', paid_upi: rb.total, items: rb.items } });
  const bd2 = (await d.list('bookings', { eq: { id: bd.id } }))[0];
  check('demo: a bill for that phone today → the booking came, with the bill', bd2.status === 'came' && bd2.bill_id === billD.id, JSON.stringify(bd2));
  await d.rpc('cancel_bill', { p_id: billD.id, p_reason: 'test' }).catch(() => {});
  check('demo: the bill cancelled → back to confirmed', (await d.list('bookings', { eq: { id: bd.id } }))[0].status === 'confirmed');
  check('demo: finished writes off and clears with stock in', !!(await d.rpc('mark_finished', { p: { product_id: prod.id } })).finished_at && (await d.get('products', prod.id)).stock === 0
    && (await d.insert('stock_moves', { product_id: prod.id, type: 'in', qty: 2 })) && !(await d.get('products', prod.id)).finished_at);
}

// ======================= B. upgrading a database made with the October schema =======================
{
  const old = await newDb([OLD_SCHEMA, OLD_SEED]);
  const oq = async (sql, p) => (await old.query(sql, p)).rows;
  const before = await oq(`select id, name, price, section, category from services order by sort`);
  const ow = randomUUID();
  await oq(`insert into app_roles values ($1, 'owner', 'Krishna')`, [ow]);
  await oq(`insert into offers (name, applies_to, categories, kind, value) values ('Wax week', 'category', '{"Waxing"}', 'percent', 20)`);
  await oq(`insert into bills (bill_no, subtotal, taxable, total, pay_mode) values ('HF2627-0001', 600, 600, 600, 'Cash')`);
  // October give-outs: four bottles of developer (the third without the empty), and a jar later marked finished
  const st = [randomUUID(), randomUUID()], pDev = randomUUID(), pJar = randomUUID(), mv = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await oq(`insert into staff (id, name) values ($1, 'Amit'), ($2, 'Rahul')`, st);
  await oq(`insert into products (id, name, kind, unit, cost_price) values ($1, 'Developer', 'salon', 'bottle', 450), ($2, 'Spa jar', 'salon', 'jar', 900)`, [pDev, pJar]);
  await oq(`insert into stock_moves (product_id, type, qty) values ($1, 'in', 10), ($2, 'in', 2)`, [pDev, pJar]);
  const svc0 = (await oq(`select id from services where name = 'Root Touch Up'`))[0].id;
  await oq(`insert into service_usage (service_id, product_id, amount) values ($1, $2, 60)`, [svc0, pDev]);
  for (const [i, [d, sIdx, empty]] of [[10, 0, true], [8, 1, true], [6, 0, false], [4, 1, true]].entries()) {
    await oq(`insert into stock_moves (id, product_id, type, qty, staff_id, empty_returned, created_at) values ($1, $2, 'use', -1, $3, $4, now() - ($5 || ' days')::interval)`, [mv[i], pDev, st[sIdx], empty, d]);
  }
  await oq(`insert into stock_moves (id, product_id, type, qty, staff_id, empty_returned, created_at) values ($1, $2, 'use', -1, $3, true, now() - interval '5 days')`, [mv[4], pJar, st[0]]);
  await oq(`alter table products add column if not exists finished_at timestamptz`); // as the 3 November schema had it
  await oq(`update products set finished_at = now() - interval '1 day' where id = $1`, [pJar]);
  let err = '';
  try { await old.exec(SCHEMA); await old.exec(SCHEMA); } catch (e) { err = e.message; }
  check('upgrade: the new schema runs on the October database (twice)', !err, err);
  const after = await oq(`select s.id, s.name, s.price, s.section, s.category, s.slug, s.web_name, c.name cat from services s join service_categories c on c.id = s.category_id order by s.sort`);
  check('upgrade: every service kept (same ids, names, prices) and put in its category', after.length === before.length && before.every((b, i) => after[i].id === b.id && after[i].name === b.name
    && Number(after[i].price) === Number(b.price) && after[i].category === b.category && after[i].cat === b.category && !!after[i].slug));
  // the October categories, with their website fields, as a database set up on 6 November had them
  const nov = await newDb([SCHEMA, NOV_SEED, SCHEMA]);
  const cats = await oq(`select * from service_categories`);
  const novCats = (await nov.query(`select * from service_categories`)).rows;
  const same = (a, b) => a && b && a.slug === b.slug && a.section === b.section && a.web_page === b.web_page && a.web_tab === b.web_tab && a.web_type === b.web_type && a.consult_only === b.consult_only;
  check('upgrade: the October categories and website fields, as on 6 November', cats.length === 16
    && cats.every((c) => same(c, novCats.find((f) => f.name === c.name))), () => JSON.stringify(cats.filter((c) => !same(c, novCats.find((f) => f.name === c.name))).map((c) => c.name)));
  check('upgrade: website names filled', after.find((s) => s.name === 'Rica Full Legs').web_name === 'Full Legs' && after.find((s) => s.name === 'Threading Eyebrows').web_name === 'Eyebrows');
  check('upgrade: not logged as changes', (await oq(`select count(*)::int n from service_changes`))[0].n === 0);
  check('upgrade: bills and offers kept', (await oq(`select count(*)::int n from bills`))[0].n === 1 && (await oq(`select categories from offers`))[0].categories[0] === 'Waxing');
  const w = (await oq(`select web_site() w`))[0].w;
  check('upgrade: website menu works straight away', w.menu.length === 16 && w.menu.reduce((a, g) => a + g.items.length, 0) === 130);
  check('upgrade: every table has row level security', (await oq(`select count(*)::int n from pg_tables where schemaname = 'public' and not rowsecurity`))[0].n === 0);
  const ends = await oq(`select * from unit_ends order by ended_at`);
  const endOf = (m) => ends.find((e) => e.move_id === m);
  check('upgrade: each October give-out ended the bottle before it; the newest is in use', ends.length === 4 && endOf(mv[0])?.by_move === mv[1] && endOf(mv[1])?.by_move === mv[2]
    && endOf(mv[2])?.by_move === mv[3] && !endOf(mv[3]), () => JSON.stringify(ends));
  check('upgrade: the one replaced without the empty is marked so', endOf(mv[1]).how === 'no_empty' && endOf(mv[0]).how === 'empty' && endOf(mv[2]).how === 'empty');
  check('upgrade: the jar marked finished ended then', endOf(mv[4])?.how === 'finished');
  check('upgrade: old usage rows count as 1', Number((await oq(`select weight from service_usage where product_id = $1`, [pDev]))[0].weight) === 1);
  check('upgrade: running it again doesn\'t rebuild them', (await (async () => { await old.exec(SCHEMA); return (await oq(`select count(*)::int n from unit_ends`))[0].n; })()) === 4);
  const rep0 = (await oq(`select unit_report() r`))[0].r;
  check('upgrade: the Bottle check works straight away', rep0.products.find((x) => x.product_id === pDev)?.units.length === 4);
  // then the rate chart (twice): the October database ends up with the same menu as a new install
  let e02 = '';
  try { await old.exec(SEED); await old.exec(SEED); } catch (e) { e02 = e.message; }
  check('rate chart runs (twice) on the October database', !e02, e02);
  const rows2 = await oq(`select * from services order by sort`);
  const cats2 = await oq(`select * from service_categories order by sort`);
  await chartChecks('October database', rows2, cats2);
  check('October database: every October service is still there (old bills keep them)', before.every((b) => rows2.some((r) => r.id === b.id)) && rows2.length === 130 + 143 - 85, rows2.length);
  check('October database: the root touch-up keeps its row and its developer bottle', rows2.find((r) => r.id === svc0)?.name === 'Root Touch-up'
    && (await oq(`select count(*)::int n from service_usage where service_id = $1 and product_id = $2`, [svc0, pDev]))[0].n === 1);
  check('October database: the "Wax week" offer is on the three waxing categories', JSON.stringify((await oq(`select categories from offers where name = 'Wax week'`))[0].categories.sort())
    === JSON.stringify(["Men's Rica Wax", 'Peel-off Wax (Face & Underarms)', 'Rica Wax'].sort()));
  const wantCats = menuToCategories();
  check('October database: categories as a new install (tabs, order, slugs, website fields)', cats2.length === 19
    && cats2.every((c) => { const w = wantCats.find((f) => f.name === c.name); return same(c, w) && c.sort === w.sort && (c.note || null) === w.note; }), () => JSON.stringify(cats2.map((c) => [c.name, c.slug, c.section, c.web_page, c.web_tab, c.note])));
  check('October database: price changes are in the change history', (await oq(`select count(*)::int n from service_changes where item = 'Root Touch-up'`))[0].n === 1);
  const w2 = (await oq(`select web_site() w`))[0].w;
  check('October database: the website shows the chart', w2.menu.length === 19 && w2.menu.reduce((a, g) => a + g.items.length, 0) === 143);
  check('October database: the Bottle check still works', (await oq(`select unit_report() r`))[0].r.products.find((x) => x.product_id === pDev)?.units.length === 4);
}

// ======================= C. the live menu of 6 November → the rate chart, and the demo the same =======================
{
  const live = await newDb([SCHEMA, NOV_SEED, SCHEMA]);
  const lq = async (sql, p) => (await live.query(sql, p)).rows;
  const id = async (n) => (await lq(`select id from services where name = $1`, [n]))[0].id;
  // what a salon had by 7 November: bills, a booking, product links, offers on a category, a tab and a service, a price edit, its own service
  const staff = randomUUID(), prod = randomUUID(), prod2 = randomUUID();
  await lq(`insert into staff (id, name) values ($1, 'Amit')`, [staff]);
  await lq(`insert into products (id, name, kind, unit, cost_price, use_type) values ($1, 'Raaga D-tan 1 kg', 'salon', 'jar', 1030, 'skin_bleach'), ($2, 'Floractive Nanoplastia', 'salon', 'bottle', 16450, 'treatment')`, [prod, prod2]);
  const dtanArms = await id('D-Tan/Bleach Full Arms'), nano = await id('Nano-Active / Plastia'), braids = await id('Braids'), fruit = await id('Fruit Facial');
  await lq(`insert into service_usage (service_id, product_id, amount, weight) values ($1, $2, 25, 1), ($3, $4, 60, 1)`, [dtanArms, prod, nano, prod2]);
  await lq(`insert into offers (name, applies_to, categories, kind, value) values ('Facial Tuesday', 'category', '{"Clean-up & Facials"}', 'amount', 300), ('Mask', 'category', '{"Add-on Mask"}', 'percent', 10)`);
  await lq(`insert into offers (name, applies_to, sections, kind, value) values ('Hair 20', 'section', '{"Hair"}', 'percent', 20), ('Beauty 10', 'section', '{"Beauty","Makeup"}', 'percent', 10)`);
  await lq(`insert into offers (name, applies_to, service_ids, kind, value) values ('Nano launch', 'services', $1, 'percent', 25)`, [[nano]]);
  await lq(`update services set price = 549 where name = 'Spa Pedicure'`);
  await lq(`insert into services (category, name, price) values ('Waxing', 'Wax Bikini Line', 999), ('Manicure & Pedicure', 'Gel Polish', 590)`);
  await lq(`insert into bills (id, bill_no, subtotal, taxable, total, pay_mode) values ($1, 'HF2627-0009', 2500, 2500, 2500, 'Cash')`, [randomUUID()]);
  const billId = (await lq(`select id from bills`))[0].id;
  await lq(`insert into bill_items (bill_id, item_type, service_id, name, category, qty, unit_price, amount, taxable) values ($1, 'service', $2, 'Fruit Facial', 'Clean-up & Facials', 1, 2500, 2500, 2500)`, [billId, fruit]);
  const before = await lq(`select * from services`);
  // the demo with the same menu and offers (a demo saved before this version)
  mem.clear();
  const d0 = createLocalDb();
  await d0.list('services', {});
  await new Promise((r) => setTimeout(r, 300)); // the demo saves a moment later
  const st = JSON.parse(localStorage.getItem('habibs-pos-demo-v1'));
  const svcCols = ['id', 'name', 'category_id', 'category', 'section', 'price', 'variants', 'open_price', 'gst_pct', 'sac', 'sort', 'active', 'slug', 'web_name', 'extra_options', 'for_gender', 'created_at', 'note'];
  st.service_categories = (await lq(`select * from service_categories`)).map((c) => ({ ...c, sort: Number(c.sort) }));
  st.services = (await lq(`select * from services`)).map((s) => ({ ...Object.fromEntries(Object.entries(s).filter(([k]) => svcCols.includes(k))), price: Number(s.price), gst_pct: Number(s.gst_pct), created_at: new Date(s.created_at).toISOString() }));
  st.offers = (await lq(`select * from offers`)).map((o) => ({ ...o, value: Number(o.value) }));
  st.service_usage = (await lq(`select * from service_usage`)).map((u) => ({ ...u, amount: Number(u.amount), weight: Number(u.weight) }));
  st.version = 7;
  localStorage.setItem('habibs-pos-demo-v1', JSON.stringify(st));

  let err = '';
  try { await live.exec(SEED); } catch (e) { err = e.message; }
  check('live menu: the rate chart runs', !err, err);
  const rows = await lq(`select * from services order by sort`);
  const cats = await lq(`select * from service_categories order by sort`);
  await chartChecks('live menu', rows, cats, 1);
  check('live menu: no service lost (130 + 2 own ones; 45 + 1 hidden)', before.every((b) => rows.some((r) => r.id === b.id)) && rows.length === 132 + 143 - 85 && rows.filter((r) => !r.active).length === 46, rows.length + ' ' + rows.filter((r) => !r.active).length);
  check('live menu: same rows kept for the same services (D-tan full arms is now Raaga, Nano-Active is Nanoplastia, Fruit Facial is Lotus Hydravitals)',
    rows.find((r) => r.id === dtanArms)?.name === 'Raaga D-Tan Full Arms' && rows.find((r) => r.id === nano)?.name === 'Nanoplastia' && rows.find((r) => r.id === fruit)?.name === 'Lotus Hydravitals Facial (Dry Skin)');
  check('live menu: their product links stay', (await lq(`select count(*)::int n from service_usage`))[0].n === 2 && (await lq(`select count(*)::int n from service_usage u join services s on s.id = u.service_id where s.active`))[0].n === 2);
  check('live menu: a service not on the chart is hidden, not deleted', rows.find((r) => r.id === braids)?.active === false && rows.find((r) => r.name === 'Wax Bikini Line')?.active === false);
  check('live menu: hidden ones sit in the nearest chart category', rows.find((r) => r.id === braids)?.category === "Women's Cut & Styling" && rows.find((r) => r.name === 'Wax Bikini Line')?.category === 'Rica Wax');
  check('live menu: nails keep the owner\'s own changes (not on the chart pages)', Number(rows.find((r) => r.name === 'Spa Pedicure').price) === 549 && rows.find((r) => r.name === 'Gel Polish')?.active === true,
    () => JSON.stringify(rows.filter((r) => ['Spa Pedicure', 'Gel Polish'].includes(r.name))));
  check('live menu: the October categories are gone', !cats.some((c) => OLD_CATEGORIES[c.name]) && cats.length === 19);
  const offers = Object.fromEntries((await lq(`select name, categories, sections, service_ids from offers`)).map((o) => [o.name, o]));
  check('live menu: offers moved to the new categories and tabs', JSON.stringify(offers['Facial Tuesday'].categories) === '["Lotus Professional Facials","O3+ Facials"]'
    && JSON.stringify(offers['Mask'].categories) === '[]' && JSON.stringify([...offers['Hair 20'].sections].sort()) === '["Colour","Hair","Hair Spa","Hair Treatments"]'
    && JSON.stringify([...offers['Beauty 10'].sections].sort()) === '["Beauty","D-Tan","Facials","Makeup","Nails","Threading","Waxing"]' && offers['Nano launch'].service_ids[0] === nano, () => JSON.stringify(offers));
  check('live menu: old bill lines keep their service and name', (await lq(`select service_id, name from bill_items`))[0].service_id === fruit && (await lq(`select name from bill_items`))[0].name === 'Fruit Facial');
  const cut = rows.find((r) => r.name === "Men's Haircut & Styling");
  check('live menu: changes logged with before and after (men\'s cut 600 → 349)', (await lq(`select changes from service_changes where service_id = $1`, [cut.id]))[0]?.changes.price.map(Number).join() === '600,349');
  await live.exec(SEED);
  check('live menu: running it again keeps the offers as they are', JSON.stringify((await lq(`select sections from offers where name = 'Hair 20'`))[0].sections.sort()) === '["Colour","Hair","Hair Spa","Hair Treatments"]'
    && (await lq(`select count(*)::int n from services`))[0].n === rows.length);
  // the demo saved before this version: the same upgrade
  const d = createLocalDb();
  const ds = await d.list('services', {});
  const dc = await d.list('service_categories', {});
  const was = new Set(before.map((b) => b.id));
  const twin = (r) => (was.has(r.id) ? ds.find((y) => y.id === r.id) : ds.find((y) => y.name === r.name && !was.has(y.id))); // new services: by name
  check('demo upgrade: same services as the database (ids, names, prices, options, tabs, hidden)', ds.length === rows.length && rows.every((r) => {
    const x = twin(r);
    return x && x.name === r.name && Number(x.price) === Number(r.price) && JSON.stringify(x.variants) === JSON.stringify(r.variants) && x.open_price === r.open_price
      && x.section === r.section && x.category === r.category && x.active === r.active && JSON.stringify(x.extra_options) === JSON.stringify(r.extra_options)
      && (x.web_name || null) === (r.web_name || null) && x.for_gender === r.for_gender && x.slug === r.slug;
  }), () => JSON.stringify(rows.filter((r) => { const x = twin(r); return !x || x.name !== r.name || x.slug !== r.slug || x.active !== r.active || x.category !== r.category || Number(x.price) !== Number(r.price) || x.open_price !== r.open_price || (x.web_name || null) !== (r.web_name || null) || x.for_gender !== r.for_gender || JSON.stringify(x.variants) !== JSON.stringify(r.variants); }).map((r) => [r.name, JSON.stringify(ds.find((y) => y.id === r.id))])).slice(0, 900));
  check('demo upgrade: same categories (names, tabs, order, slugs, website)', dc.length === cats.length && cats.every((c) => { const x = dc.find((y) => y.id === c.id || y.name === c.name); return x && x.section === c.section && x.sort === c.sort && x.slug === c.slug && x.web_page === c.web_page && (x.note || null) === (c.note || null); }),
    () => JSON.stringify(dc.map((c) => [c.name, c.slug, c.section])));
  const doff = Object.fromEntries((await d.list('offers', {})).map((o) => [o.name, o]));
  check('demo upgrade: same offers', Object.keys(offers).every((k) => JSON.stringify([...(doff[k].categories || [])].sort()) === JSON.stringify([...(offers[k].categories || [])].sort())
    && JSON.stringify([...(doff[k].sections || [])].sort()) === JSON.stringify([...(offers[k].sections || [])].sort())), () => JSON.stringify(doff));
  // a new demo = a new database
  mem.clear();
  const nd = createLocalDb();
  const nrows = await nd.list('services', {});
  await chartChecks('new demo', nrows, await nd.list('service_categories', {}));
}

check('new install: every table has row level security', (await q(`select count(*)::int n from pg_tables where schemaname = 'public' and not rowsecurity`))[0].n === 0);

console.log(`${checks} menu, website and stock checks, ${fails.length} failed`);
for (const f of fails.slice(0, 40)) console.log(f);
process.exitCode = fails.length ? 1 : 0;
