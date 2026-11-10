// Habibs Fuljhore service menu: the printed rate chart of November 2026 (pages 2–7: Hair · Men, Hair · Women,
// Hair Spa & Treatments, Facials, D-Tan & Threading, Waxing). Nails and Makeup & Bridal are not on those pages
// and are as before.
// supabase/02_seed_services.sql is generated from this file (node scripts/make-seed-sql.mjs) and demo mode loads it.
// After that, edit prices in the app: Settings → Services.
//
// Item format: [name, price, options]
//   price: a number, or a list of options "S:2999, M:3499" (label:price). Options without a label show only the price.
//   options: 'open' = the printed price is a starting price ("onwards"): the counter types the final price, and
//            less than the starting price counts as a discount (needs the owner above the limit).
//            Or an object: { open, was: ['Old name', …], for: 'men' | 'women' }.
//            was = the name(s) this service had in the October menu. A database or demo that still has that service
//            keeps the same row (same id: bills, bookings, Stock → Used in all stay linked), with the new name and price.
//
// Hair length: S = Shoulder, M = Below shoulder, L = Waist, XL = Below waist.
// The printed "onwards" price is S; each longer length is ₹500 more (hair treatments and women's colour).

export const SIZE_HINT = { S: 'Shoulder', M: 'Below shoulder', L: 'Waist', XL: 'Below waist' };
export const LENGTH_STEP = 500;

// A second choice on a service, added to its price at billing: thick hair +₹500 on hair treatments
export const THICKNESS = { title: 'Hair thickness', choices: [{ label: 'Thick', price: 500 }] };

// "S:2999, M:3499, L:3999, XL:4499" from the printed (shoulder-length) price
const byLength = (s) => ['S', 'M', 'L', 'XL'].map((l, i) => `${l}:${s + i * LENGTH_STEP}`).join(', ');

const HAIR_SAC = '999721'; // Hairdressing and barbers' services
const NAIL_SAC = '999722'; // Cosmetic treatment, manicure and pedicure
const BEAUTY_SAC = '999729'; // Other beauty treatment services

// The tabs on the billing screen, in order. A category belongs to one tab.
// "Beauty" is for anything else the owner adds later (it shows only when it has services).
export const SECTIONS = ['Hair', 'Colour', 'Hair Spa', 'Hair Treatments', 'Facials', 'D-Tan', 'Threading', 'Waxing', 'Nails', 'Beauty', 'Makeup'];
export const SECTION_LABEL = { Makeup: 'Makeup & Bridal' };
export const sectionLabel = (s) => SECTION_LABEL[s] || s;
// Tabs whose options S / M / L / XL are hair lengths
export const HAIR_SECTIONS = ['Hair', 'Colour', 'Hair Spa', 'Hair Treatments'];
// The website page for a category that has none set (same as section_web_page() in the database)
export const webPageOf = (section) => (HAIR_SECTIONS.includes(section) ? 'hair' : section === 'Nails' ? 'nails' : section === 'Makeup' ? 'makeup' : 'beauty');

// Each category: one heading on its billing tab, one group on the website.
//   strip: taken off the front of the name on the website, where the category already says it
//   ("Men's Haircut & Styling" is "Haircut & Styling" under Men's Cut & Grooming)
export const MENU = [
  // ---------------- HAIR (page 2: Hair · Men, page 3: Hair · Women) ----------------
  { section: 'Hair', category: "Men's Cut & Grooming", slug: 'mens-cut', sac: HAIR_SAC, for: 'men', strip: /^Men's /,
    web: { page: 'hair', tab: 'Cuts & Styling', type: 'Cut & Style' },
    items: [
      ["Men's Haircut & Styling", 349, { was: ['Men Cut and Styling'] }],
      ["Kids' Haircut (Boys, under 10)", 199, { was: ['Child Cut Boy (under 10)'] }],
      ['Beard Trim / Shape', 199, { was: ['Beard Trimming'] }],
      ['Shave', 149, { was: ['Shaving'] }],
      ['Head Shave', 249, { was: ['Men Head Shave'] }],
      ["Men's Hair Wash & Blow-dry", 149, { was: ['Men Wash and Blast Dry'] }],
    ] },
  { section: 'Hair', category: "Women's Cut & Styling", slug: 'womens-cut', sac: HAIR_SAC, for: 'women', strip: /^Women's /,
    web: { page: 'hair', tab: 'Cuts & Styling', type: 'Cut & Style' },
    items: [
      ["Women's Haircut & Styling", 499, { was: ['Ladies Cut and Styling'] }],
      ["Kids' Haircut (Girls, under 10)", 299, { was: ['Child Cut Girl (under 10)'] }],
      ["Women's Hair Wash & Blow-dry", 399, { was: ['Ladies Wash and Blast Dry'] }],
      ['Ironing / Tongs / Crimping / Roller Set', 999, { was: ['Crimping / Ironing'] }],
    ] },

  // ---------------- COLOUR ----------------
  { section: 'Colour', category: "Men's Colour", slug: 'mens-colour', sac: HAIR_SAC, for: 'men', strip: /^Men's /,
    web: { page: 'hair', tab: 'Colour', type: 'Colour', note: 'Colour includes wash & blow-dry. Patch test 48 hours before your first colour.' },
    items: [
      ["Men's Global Colour", 1199, { was: ['Global Colour Men'] }],
      ["Men's Global Colour, Ammonia-free", 1399],
      ["Men's Highlights", 1299, { was: ['Men Highlights'] }],
      ["Men's Per Streak", 149],
      ['Beard Colour', 299],
    ] },
  { section: 'Colour', category: "Women's Colour", slug: 'womens-colour', sac: HAIR_SAC, for: 'women', strip: /^Women's /,
    web: { page: 'hair', tab: 'Colour', type: 'Colour', note: 'Colour includes wash & blow-dry. Patch test 48 hours before your first colour. Prices by hair length.' },
    items: [
      ['Root Touch-up', 1299, { open: true, was: ['Root Touch Up'] }],
      ['Root Touch-up, Ammonia-free', 1499, 'open'],
      ["Women's Global Colour", byLength(2999), { was: ['Global Colour Women'] }],
      ["Women's Global Colour, Ammonia-free", byLength(3999)],
      ['Crown Highlights', byLength(1999)],
      ['T-section Highlights', byLength(2999), { was: ['T-Section Highlights'] }],
      ['Full Highlights', byLength(4499)],
      ['Ombre', byLength(3999)],
      ['Sombre', byLength(4999)],
      ['Balayage', byLength(5499)],
      ["Women's Per Streak", 299, { was: ['Per Streak'] }],
      ['Extra-thick Hair (Highlights Add-on)', 999, { open: true, was: ['Extra Thick Hair (Highlights)'] }],
    ] },

  // ---------------- HAIR SPA (page 4) ----------------
  { section: 'Hair Spa', category: "Men's Hair Spa", slug: 'mens-hair-spa', sac: HAIR_SAC, for: 'men', strip: /^Men's /,
    web: { page: 'hair', tab: 'Spa & Treatments', type: 'Spa & Treatment' },
    items: [
      ["Men's Wella Classic Hair Spa", 799],
      ["Men's Wella Nourishing / Repair Hair Spa", 999],
      ["Men's L'Oreal Classic Hair Spa", 699, { was: ["L'Oreal Hair Spa Men"] }],
      ["Men's L'Oreal Nourishing / Repair Hair Spa", 799],
      ["Men's Streax Classic Hair Spa", 499],
      ["Men's Streax Nourishing / Repair Hair Spa", 499],
      ["Men's Keratin Wash", 299],
      ["Men's Anti-dandruff Treatment", 1499],
      ["Men's Head Massage, 30 min", 499],
    ] },
  { section: 'Hair Spa', category: "Women's Hair Spa", slug: 'womens-hair-spa', sac: HAIR_SAC, for: 'women', strip: /^Women's /,
    web: { page: 'hair', tab: 'Spa & Treatments', type: 'Spa & Treatment', note: 'Prices depend on hair length & density; final price after consultation.' },
    items: [
      ["Women's Wella Classic Hair Spa", 1499, 'open'],
      ["Women's Wella Nourishing / Repair Hair Spa", 2299, 'open'],
      ["Women's L'Oreal Classic Hair Spa", 1499, { open: true, was: ["L'Oreal Hair Spa Women"] }],
      ["Women's L'Oreal Nourishing / Repair Hair Spa", 1999, 'open'],
      ["Women's Streax Classic Hair Spa", 999, 'open'],
      ["Women's Streax Nourishing / Repair Hair Spa", 1299, 'open'],
      ["Women's Keratin Wash", 799, 'open'],
      ["Women's Anti-dandruff Treatment", 1499],
      ["Women's Head Massage, 30 min", 499],
    ] },

  // ---------------- HAIR TREATMENTS (page 4): length S / M / L / XL (+₹500 a step) and thick hair +₹500 ----------------
  { section: 'Hair Treatments', category: 'Hair Treatments', slug: 'hair-treatments', sac: HAIR_SAC, extra: THICKNESS,
    web: { page: 'hair', tab: 'Spa & Treatments', type: 'Spa & Treatment', consult: true, note: 'Prices by hair length; thick hair ₹500 more. Final price after consultation.' },
    items: [
      ['Smoothening / Straightening', byLength(4499), { was: ['Smoothening / Straightening / Rebonding'] }],
      ["Men's Smoothening (Short Hair)", 1999, { for: 'men', noExtra: true }],
      ['Keratin', byLength(3999), { was: ['Keratin / Cysteine'] }],
      ['Kera Smoothening', byLength(5999)],
      ['Hair Botox', byLength(4999), { was: ['Botox / Botoplex'] }],
      ['Nanoplastia', byLength(5999), { was: ['Nano-Active / Plastia'] }],
    ] },

  // ---------------- FACIALS (page 5) ----------------
  { section: 'Facials', category: 'Lotus Professional Facials', slug: 'lotus-facials', sac: BEAUTY_SAC, strip: /^Lotus /,
    web: { page: 'beauty', tab: 'Facials', type: 'Skin & Facial' },
    items: [
      ['Lotus Clean-up', 1299, { was: ['Clean-Up'] }],
      ['Lotus D-Tan Clean-up', 1499, { was: ['D-Tan Clean-Up'] }],
      ['Lotus Basic Facial (Oily Skin)', 1799],
      ['Lotus Hydravitals Facial (Dry Skin)', 1799, { was: ['Fruit Facial'] }],
      ['Lotus Acne-X Facial', 2499],
      ['Lotus Preservita Sensitive Facial', 2499],
      ['Lotus Preservita Anti-ageing Facial', 2499],
      ['Lotus Insta Fair Facial', 2799],
      ['Lotus Goldsheen Facial', 2799],
      ['Lotus Bridal Glow Facial', 2999],
      ['Lotus Ultimo Gold / Pearl Facial', 3499],
      ['Lotus Miraki Facial', 3999],
    ] },
  { section: 'Facials', category: 'O3+ Facials', slug: 'o3-facials', sac: BEAUTY_SAC, strip: /^O3\+ /,
    web: { page: 'beauty', tab: 'Facials', type: 'Skin & Facial' },
    items: [
      ['O3+ Clean-up', 1499],
      ['O3+ D-Tan Facial', 2499, { was: ['D-Tan Facial'] }],
      ['O3+ Whitening / Brightening Facial', 3499, { was: ['Whitening Skin Starts Here Premium Facial'] }],
      ['O3+ Seaweed Facial', 3499, { was: ['Seaweed Treatment Facial'] }],
      ["O3+ Men's Facial", 3499, { for: 'men' }],
      ['O3+ Anti-ageing Facial', 3499, { was: ['Anti-Ageing Facial'] }],
      ['O3+ Bridal Facial (Vitamin C Glow or Radiant Glow)', 3499, { for: 'women', was: ['Bridal Premium Facial'] }],
      ['O3+ Gold Facial', 4499, { was: ['Gold Premium Facial'] }],
      ['O3+ Diamond Facial', 4499, { was: ['Diamond Brightening Premium Facial'] }],
    ] },

  // ---------------- D-TAN (page 6): the brand is part of the name, so each pack counts its own services ----------------
  { section: 'D-Tan', category: 'Raaga D-Tan', slug: 'raaga-dtan', sac: BEAUTY_SAC, strip: /^Raaga (D-Tan )?/,
    web: { page: 'beauty', tab: 'D-Tan & Bleach', type: 'Skin & Facial' },
    items: [
      ['Raaga D-Tan Face & Neck', 499],
      ['Raaga Charcoal D-Tan', 599],
      ['Raaga D-Tan Underarms', 249, { was: ['D-Tan/Bleach Underarms'] }],
      ['Raaga D-Tan Half Arms', 599, { was: ['D-Tan/Bleach Half Arms'] }],
      ['Raaga D-Tan Full Arms', 799, { was: ['D-Tan/Bleach Full Arms'] }],
      ['Raaga D-Tan Half Legs', 999, { was: ['D-Tan/Bleach Half Legs'] }],
      ['Raaga D-Tan Full Legs', 1799, { was: ['D-Tan/Bleach Full Legs'] }],
      ['Raaga D-Tan Back', 1499, { was: ['D-Tan/Bleach Full Back or Front'] }],
      ['Raaga D-Tan Stomach', 999, { was: ['D-Tan/Bleach Half Back or Stomach'] }],
      ['Raaga D-Tan Feet & Palms', 499, { was: ['D-Tan/Bleach Feet or Palms'] }],
      ['Raaga D-Tan Full Body', 2999, { was: ['D-Tan/Bleach Full Body'] }],
    ] },
  { section: 'D-Tan', category: 'O3+ D-Tan', slug: 'o3-dtan', sac: BEAUTY_SAC, strip: /^O3\+ (D-Tan )?/,
    web: { page: 'beauty', tab: 'D-Tan & Bleach', type: 'Skin & Facial' },
    items: [
      ['O3+ D-Tan Face & Neck', 699, { was: ['D-Tan/Bleach Face & Neck'] }],
      ['O3+ Charcoal D-Tan', 799],
      ['O3+ D-Tan Underarms', 299],
      ['O3+ D-Tan Half Arms', 799],
      ['O3+ D-Tan Full Arms', 999],
      ['O3+ D-Tan Half Legs', 1199],
      ['O3+ D-Tan Full Legs', 1999],
      ['O3+ D-Tan Back', 1699],
      ['O3+ D-Tan Stomach', 1199],
      ['O3+ D-Tan Feet & Palms', 699],
      ['O3+ D-Tan Full Body', 3499],
    ] },

  // ---------------- THREADING (page 6) ----------------
  { section: 'Threading', category: 'Threading', slug: 'threading', sac: BEAUTY_SAC, strip: /^Threading /,
    web: { page: 'beauty', tab: 'Threading', type: 'Hair Removal' },
    items: [
      ['Threading Eyebrows', 50],
      ['Threading Forehead', 50],
      ['Threading Upper Lip', 50],
      ['Threading Chin', 50],
      ['Threading Side Locks', 50],
      ["Men's Threading", 50, { for: 'men', was: ['Men Threading'] }],
      ['Threading Full Face', 399],
    ] },

  // ---------------- WAXING, RICA (page 7) ----------------
  { section: 'Waxing', category: 'Rica Wax', slug: 'rica', sac: BEAUTY_SAC, strip: /^Rica /,
    web: { page: 'beauty', tab: 'Waxing', type: 'Hair Removal' },
    items: [
      ['Rica Half Arms', 600],
      ['Rica Full Arms', 800],
      ['Rica Half Legs', 800],
      ['Rica Full Legs', 1100],
      ['Rica Midriff', 800],
      ['Rica Half Back', 900],
      ['Rica Full Back', 1200, { was: ['Rica Back'] }],
      ['Rica Buttock', 900],
      ['Rica Full Body', 4000],
    ] },
  { section: 'Waxing', category: "Men's Rica Wax", slug: 'mens-rica', sac: BEAUTY_SAC, for: 'men', strip: /^Men's Rica /,
    web: { page: 'beauty', tab: 'Waxing', type: 'Hair Removal' },
    items: [
      ["Men's Rica Full Arms", 999],
      ["Men's Rica Chest", 1199],
      ["Men's Rica Full Back", 1499],
    ] },
  { section: 'Waxing', category: 'Peel-off Wax (Face & Underarms)', slug: 'peel-off-wax', sac: BEAUTY_SAC, strip: /^Peel-off Wax /,
    web: { page: 'beauty', tab: 'Waxing', type: 'Hair Removal' },
    items: [
      ['Peel-off Wax Nose', 100],
      ['Peel-off Wax Chin', 120],
      ['Peel-off Wax Forehead', 120],
      ['Peel-off Wax Upper & Lower Lip', 150],
      ['Peel-off Wax Side Locks', 150],
      ['Peel-off Wax Underarms', 300],
      ['Peel-off Wax Full Face', 550],
    ] },

  // ---------------- NAILS (not on pages 2–7: as before) ----------------
  { section: 'Nails', category: 'Manicure & Pedicure', slug: 'manicure-and-pedicure', sac: NAIL_SAC,
    web: { page: 'nails', tab: 'Mani / Pedi', type: 'Nails' },
    items: [
      ['Regular Manicure', 699],
      ['Regular Pedicure', 799],
      ['Spa Manicure', 800],
      ['Spa Pedicure', 900],
      ['Paraffin Manicure', 900],
      ['Paraffin Pedicure', 1000],
      ['Crystal Manicure', 1000],
      ['Crystal Pedicure', 1100],
      ['Nail Cut & File', 100],
      ['Change of Nail Polish', 120],
    ] },

  // ---------------- MAKEUP & BRIDAL (not on pages 2–7: as before) ----------------
  { section: 'Makeup', category: 'Makeup', slug: 'makeup', sac: BEAUTY_SAC, web: { page: 'makeup', type: 'Makeup & Styling' },
    items: [
      ['Simple Make-up', 1000, 'open'],
      ['Party Make-up', 1500, 'open'],
      ['Saree Draping', 500],
      ['Bridal Makeup', 10000, 'open'],
      ['Reception Makeup', 10000, 'open'],
    ] },
  { section: 'Makeup', category: 'Bridal Packages', slug: 'bridal-package', sac: BEAUTY_SAC, web: { page: 'bridal', type: 'Package', consult: true },
    items: [
      ['Bride Package A + B', 20000, 'open'],
      ['Pre-Bridal Package (5 days prior)', 10000, 'open'],
      ['Wedding Day Package (Bride)', 10000, 'open'],
      ['Reception Package (Contemporary)', 6000, 'open'],
      ['Wedding Premium (Friends & Relatives)', 3000, 'open'],
    ] },
  { section: 'Makeup', category: 'Groom Packages', slug: 'groom-package', sac: BEAUTY_SAC, web: { page: 'groom', type: 'Package' },
    items: [
      ['Groom Pre-Wedding Package', 7000],
      ['Advance Groom Package', 10000, 'open'],
      ['Wedding Day Groom Make-up', 4000],
    ] },
];

// ---------------- From the October menu ----------------
// Categories of the October menu that the printed rate chart replaces: where offers on them now apply,
// and where their services that are no longer on the chart are kept (hidden from billing, old bills keep them).
// Everything in these categories that isn't on the chart is hidden: switch one back on in Settings → Services if needed.
export const OLD_CATEGORIES = {
  'Haircut': { home: "Men's Cut & Grooming", now: ["Men's Cut & Grooming", "Women's Cut & Styling"] },
  'Blow Dry & Styling': { home: "Women's Cut & Styling", now: ["Women's Cut & Styling", "Men's Cut & Grooming"] },
  'Head Massage': { home: "Women's Hair Spa", now: ["Men's Hair Spa", "Women's Hair Spa"] },
  'Hair Colour': { home: "Women's Colour", now: ["Men's Colour", "Women's Colour"] },
  'Hair Spa': { home: "Women's Hair Spa", now: ["Men's Hair Spa", "Women's Hair Spa"] },
  'Waxing': { home: 'Rica Wax', now: ['Rica Wax', "Men's Rica Wax", 'Peel-off Wax (Face & Underarms)'] },
  'D-Tan / Bleach': { home: 'Raaga D-Tan', now: ['Raaga D-Tan', 'O3+ D-Tan'] },
  'Clean-up & Facials': { home: 'Lotus Professional Facials', now: ['Lotus Professional Facials', 'O3+ Facials'] },
  'Add-on Mask': { home: 'O3+ Facials', now: [] },
};
// The October tabs, for offers made for a whole tab ("20% off Hair")
export const OLD_SECTIONS = {
  Hair: ['Hair', 'Colour', 'Hair Spa', 'Hair Treatments'],
  Beauty: ['Facials', 'D-Tan', 'Threading', 'Waxing', 'Nails', 'Beauty'],
};
// The categories the chart covers (with the October ones): their services not on the chart are hidden
export const CHART_CATEGORIES = [...MENU.filter((g) => !['Nails', 'Makeup'].includes(g.section)).map((g) => g.category), ...Object.keys(OLD_CATEGORIES)];

// ---------------- Website ----------------
// Each category is one group on the website (pages, tabs and filters as in the website's src/data/services.js).
// The slugs are the website's group ids.
export const WEB_PAGES = [['hair', 'Hair'], ['beauty', 'Beauty'], ['nails', 'Manicure / Pedicure'], ['makeup', 'Makeup'], ['bridal', 'Bridal'], ['groom', 'Groom']];
export const WEB_TABS = { hair: ['Cuts & Styling', 'Colour', 'Spa & Treatments'], beauty: ['D-Tan & Bleach', 'Threading', 'Waxing', 'Mani / Pedi', 'Facials'], nails: ['Mani / Pedi'] };
export const WEB_TYPES = ['Cut & Style', 'Colour', 'Spa & Treatment', 'Skin & Facial', 'Hair Removal', 'Makeup & Styling', 'Package', 'Nails'];

// The October rule for website names ("Wax Full Legs" → "Full Legs" under Waxing); 01_schema.sql uses it
// when it upgrades an October database.
const WEB_PREFIX = /^(Wax|Rica|Threading|D-Tan\/Bleach) /;
const PREFIX_CATS = ['Waxing', 'Rica Wax', 'Threading', 'D-Tan / Bleach'];
export const webNameOf = (name, category) => (PREFIX_CATS.includes(category) && WEB_PREFIX.test(name) ? name.replace(WEB_PREFIX, '') : null);

// "Men's Cut & Grooming" → "mens-cut-and-grooming", "L'Oréal" → "loreal" (same as slugify() in the database)
export const slugify = (t) => String(t || '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ')
  .replace(/[àáâä]/g, 'a').replace(/[èéêë]/g, 'e').replace(/[ìíîï]/g, 'i').replace(/[òóôö]/g, 'o').replace(/[ùúûü]/g, 'u').replace(/ç/g, 'c')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

// The categories, in menu order, with their website fields (same columns as service_categories)
export function menuToCategories() {
  let sort = 0;
  return MENU.map((g) => {
    const w = g.web || {};
    sort += 10;
    return {
      section: g.section, name: g.category, slug: g.slug || slugify(g.category), sort,
      web_page: w.page || null, web_tab: w.tab || null, web_type: w.type || null, consult_only: !!w.consult, show_on_website: true,
      note: w.note || null,
    };
  });
}

// "S:2500, M:3000" -> [{label:'S', price:2500}, ...]; "800, 899" -> [{label:'', price:800}, ...]
export function parseVariants(text) {
  if (text == null || text === '') return null;
  if (typeof text === 'number') return null;
  const parts = String(text).split(',').map((s) => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const i = p.lastIndexOf(':');
    const label = i >= 0 ? p.slice(0, i).trim() : '';
    const price = Number((i >= 0 ? p.slice(i + 1) : p).replace(/[^\d.]/g, ''));
    if (!Number.isFinite(price)) continue;
    out.push({ label, price });
  }
  return out.length > 1 ? out : null;
}

// "Thick:500" ↔ [{ label: 'Thick', price: 500 }]  (one or more choices; "Normal" = no extra charge)
export function parseExtra(text) {
  const out = [];
  for (const p of String(text || '').split(',').map((x) => x.trim()).filter(Boolean)) {
    const i = p.lastIndexOf(':');
    const label = i >= 0 ? p.slice(0, i).trim() : '';
    const price = Number((i >= 0 ? p.slice(i + 1) : '').replace(/[^\d.]/g, ''));
    if (!label || !Number.isFinite(price) || i < 0) return null;
    out.push({ label, price });
  }
  return out.length && out.length <= 5 ? out : null;
}
export const extraToText = (e) => (e && e.choices ? e.choices.map((c) => `${c.label}:${c.price}`).join(', ') : '');

export function variantsToText(variants) {
  if (!variants || !variants.length) return '';
  return variants.map((v) => (v.label ? `${v.label}:${v.price}` : `${v.price}`)).join(', ');
}

// Flatten MENU into service rows (same columns as the services table, plus `was`: the October names)
export function menuToServices() {
  const rows = [];
  let sort = 0;
  for (const g of MENU) {
    for (const [name, price, o] of g.items) {
      const opt = typeof o === 'string' ? { [o]: true } : o || {};
      const variants = typeof price === 'string' ? parseVariants(price) : null;
      const short = g.strip ? name.replace(g.strip, '') : name;
      rows.push({
        section: g.section,
        category: g.category,
        name,
        price: variants ? Math.min(...variants.map((v) => v.price)) : price,
        variants,
        open_price: !!opt.open,
        sac: g.sac,
        gst_pct: 5,
        sort: (sort += 10),
        active: true,
        web_name: short !== name && short ? short.charAt(0).toUpperCase() + short.slice(1) : null,
        extra_options: g.extra && !opt.noExtra ? g.extra : null,
        for_gender: opt.for || g.for || 'any',
        was: opt.was || [],
      });
    }
  }
  return rows;
}
