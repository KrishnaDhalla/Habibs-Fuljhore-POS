// Which services use which salon product, and how much, to begin with.
// The amounts are typical figures, not exact: every salon, brand and stylist differs. They are used only to
// suggest which services to tick for a product (Stock → Used in), how much bigger one service is than another
// ("counts as"), and how many services one unit typically lasts. The Bottle check then learns your real numbers
// from the bottles themselves.
//
// Amounts are per service, in the product's own unit: grams (g), millilitres (ml) or uses (a kit).
// Where a service has options (hair length S / M / L …), there is an amount per option.

export const PRODUCT_TYPES = [
  ['colour', 'Hair colour (tube)', 'g', 'e.g. 60 g per tube'],
  ['developer', 'Developer / oxidant', 'ml', 'e.g. 1000 ml per bottle'],
  ['lightener', 'Bleach / lightener powder (hair)', 'g', 'e.g. 500 g per tub'],
  ['spa', 'Hair spa cream / mask', 'g', 'e.g. 500 g per jar'],
  ['shampoo', 'Shampoo (wash station)', 'ml', 'e.g. 1500 ml per bottle'],
  ['conditioner', 'Conditioner (wash station)', 'ml', 'e.g. 1000 ml per bottle'],
  ['treatment', 'Smoothening / keratin / botox cream', 'ml', 'e.g. 500 ml per bottle'],
  ['oil', 'Head massage oil', 'ml', 'e.g. 500 ml per bottle'],
  ['rica', 'Rica wax, liposoluble (arms, legs, back)', 'g', 'e.g. 800 ml per tin'],
  ['wax', 'Peel-off wax (face, underarms)', 'g', 'e.g. 800 ml per tin'],
  ['skin_bleach', 'D-Tan / bleach pack (skin)', 'g', 'e.g. 500 g per jar'],
  ['facial_kit', 'Facial or clean-up kit', 'uses', 'single-use kit = 1 use; a 5-use kit = 5 uses'],
  ['mask', 'Face mask (add-on)', 'g', 'e.g. 250 g per jar'],
  ['manipedi', 'Manicure / pedicure cream, scrub, salts', 'g', 'e.g. 500 g per jar'],
  ['other', 'Something else', 'g', ''],
];
export const TYPE_LABEL = Object.fromEntries(PRODUCT_TYPES.map(([k, l]) => [k, l]));
export const TYPE_UNIT = Object.fromEntries(PRODUCT_TYPES.map(([k, , u]) => [k, u]));

const len4 = (a, b, c, d) => ({ S: a, M: b, L: c, XL: d });

// [service name, amount, amounts per option (optional), ticked by default]
// Brand-specific products (facial kits, spa creams, treatment creams, D-tan packs, oils) are not ticked:
// tick only the services that use that exact product.
const STARTER = {
  colour: [
    ['Root Touch-up', 40], ['Root Touch-up, Ammonia-free', 40], ["Men's Global Colour", 40], ["Men's Global Colour, Ammonia-free", 40], ['Beard Colour', 10],
    ["Women's Global Colour", 90, len4(60, 90, 120, 150)], ["Women's Global Colour, Ammonia-free", 90, len4(60, 90, 120, 150)],
    ["Men's Highlights", 20], ['Crown Highlights', 30, len4(20, 30, 40, 50)], ['T-section Highlights', 45, len4(30, 45, 60, 75)],
    ['Full Highlights', 90, len4(60, 90, 120, 150)], ['Ombre', 60, len4(40, 60, 80, 100)], ['Sombre', 60, len4(40, 60, 80, 100)],
    ['Balayage', 60, len4(40, 60, 80, 100)], ["Men's Per Streak", 5], ["Women's Per Streak", 5], ['Extra-thick Hair (Highlights Add-on)', 20],
  ],
  // Developer: most professional colours mix 1 : 1 to 1 : 1.5 (colour : developer). Starting at 1.5.
  developer: [
    ['Root Touch-up', 60], ['Root Touch-up, Ammonia-free', 60], ["Men's Global Colour", 60], ["Men's Global Colour, Ammonia-free", 60], ['Beard Colour', 15],
    ["Women's Global Colour", 135, len4(90, 135, 180, 225)], ["Women's Global Colour, Ammonia-free", 135, len4(90, 135, 180, 225)],
    ["Men's Highlights", 40], ['Crown Highlights', 45, len4(30, 45, 60, 75)], ['T-section Highlights', 70, len4(45, 70, 90, 110)],
    ['Full Highlights', 135, len4(90, 135, 180, 225)], ['Ombre', 90, len4(60, 90, 120, 150)], ['Sombre', 90, len4(60, 90, 120, 150)],
    ['Balayage', 90, len4(60, 90, 120, 150)], ["Men's Per Streak", 10], ["Women's Per Streak", 10], ['Extra-thick Hair (Highlights Add-on)', 30],
  ],
  lightener: [
    ["Men's Highlights", 15], ['Crown Highlights', 20, len4(15, 20, 30, 40)], ['T-section Highlights', 30, len4(20, 30, 40, 50)],
    ['Full Highlights', 60, len4(40, 60, 80, 100)], ['Ombre', 45, len4(30, 45, 60, 75)], ['Sombre', 45, len4(30, 45, 60, 75)],
    ['Balayage', 45, len4(30, 45, 60, 75)], ["Men's Per Streak", 5], ["Women's Per Streak", 5], ['Extra-thick Hair (Highlights Add-on)', 15],
  ],
  // Spa creams are brand-specific: tick the services of that brand (Wella, L'Oreal or Streax)
  spa: [
    ["Men's Wella Classic Hair Spa", 30, null, false], ["Men's Wella Nourishing / Repair Hair Spa", 30, null, false],
    ["Men's L'Oreal Classic Hair Spa", 30, null, false], ["Men's L'Oreal Nourishing / Repair Hair Spa", 30, null, false],
    ["Men's Streax Classic Hair Spa", 30, null, false], ["Men's Streax Nourishing / Repair Hair Spa", 30, null, false],
    ["Women's Wella Classic Hair Spa", 50, null, false], ["Women's Wella Nourishing / Repair Hair Spa", 50, null, false],
    ["Women's L'Oreal Classic Hair Spa", 50, null, false], ["Women's L'Oreal Nourishing / Repair Hair Spa", 50, null, false],
    ["Women's Streax Classic Hair Spa", 50, null, false], ["Women's Streax Nourishing / Repair Hair Spa", 50, null, false],
    ["Men's Anti-dandruff Treatment", 30, null, false], ["Women's Anti-dandruff Treatment", 50, null, false],
    ["Men's Keratin Wash", 20, null, false], ["Women's Keratin Wash", 40, null, false],
  ],
  shampoo: [
    ["Men's Haircut & Styling", 8], ["Women's Haircut & Styling", 15], ["Kids' Haircut (Boys, under 10)", 5], ["Kids' Haircut (Girls, under 10)", 8],
    ["Men's Hair Wash & Blow-dry", 8], ["Women's Hair Wash & Blow-dry", 15],
    ["Men's Wella Classic Hair Spa", 8], ["Men's Wella Nourishing / Repair Hair Spa", 8], ["Men's L'Oreal Classic Hair Spa", 8],
    ["Men's L'Oreal Nourishing / Repair Hair Spa", 8], ["Men's Streax Classic Hair Spa", 8], ["Men's Streax Nourishing / Repair Hair Spa", 8],
    ["Women's Wella Classic Hair Spa", 15], ["Women's Wella Nourishing / Repair Hair Spa", 15], ["Women's L'Oreal Classic Hair Spa", 15],
    ["Women's L'Oreal Nourishing / Repair Hair Spa", 15], ["Women's Streax Classic Hair Spa", 15], ["Women's Streax Nourishing / Repair Hair Spa", 15],
    ['Root Touch-up', 15], ['Root Touch-up, Ammonia-free', 15], ["Men's Global Colour", 10], ["Men's Global Colour, Ammonia-free", 10],
    ["Women's Global Colour", 20], ["Women's Global Colour, Ammonia-free", 20],
    ["Men's Head Massage, 30 min", 8], ["Women's Head Massage, 30 min", 15],
  ],
  conditioner: [
    ["Women's Haircut & Styling", 10], ["Women's Hair Wash & Blow-dry", 10],
    ['Root Touch-up', 10], ['Root Touch-up, Ammonia-free', 10], ["Women's Global Colour", 15], ["Women's Global Colour, Ammonia-free", 15],
  ],
  // Each treatment uses its own cream: tick the services of that cream
  treatment: [
    ['Smoothening / Straightening', 80, len4(60, 80, 110, 150)], ["Men's Smoothening (Short Hair)", 40],
    ['Keratin', 60, len4(40, 60, 80, 110)], ['Kera Smoothening', 80, len4(60, 80, 110, 150)],
    ['Hair Botox', 60, len4(40, 60, 80, 110)], ['Nanoplastia', 60, len4(40, 60, 80, 110)],
  ].map(([n, a, per]) => [n, a, per, false]),
  oil: [
    ["Men's Head Massage, 30 min", 20, null, false], ["Women's Head Massage, 30 min", 25, null, false],
  ],
  // Rica liposoluble wax (arms, legs, back, body)
  rica: [
    ['Rica Half Arms', 20], ['Rica Full Arms', 35], ['Rica Half Legs', 35], ['Rica Full Legs', 70], ['Rica Midriff', 25],
    ['Rica Half Back', 30], ['Rica Full Back', 50], ['Rica Buttock', 30], ['Rica Full Body', 180],
    ["Men's Rica Full Arms", 45], ["Men's Rica Chest", 50], ["Men's Rica Full Back", 65],
  ],
  // Peel-off wax (Rica Brazilian) for the face and underarms
  wax: [
    ['Peel-off Wax Nose', 3], ['Peel-off Wax Chin', 4], ['Peel-off Wax Forehead', 4], ['Peel-off Wax Upper & Lower Lip', 5],
    ['Peel-off Wax Side Locks', 5], ['Peel-off Wax Underarms', 10], ['Peel-off Wax Full Face', 20],
  ],
  // D-tan packs are brand-specific: Raaga and O3+ each count their own services
  skin_bleach: [
    ['Raaga D-Tan Face & Neck', 15], ['Raaga Charcoal D-Tan', 15], ['Raaga D-Tan Underarms', 6], ['Raaga D-Tan Half Arms', 15],
    ['Raaga D-Tan Full Arms', 25], ['Raaga D-Tan Half Legs', 25], ['Raaga D-Tan Full Legs', 45], ['Raaga D-Tan Back', 35],
    ['Raaga D-Tan Stomach', 25], ['Raaga D-Tan Feet & Palms', 15], ['Raaga D-Tan Full Body', 120],
    ['O3+ D-Tan Face & Neck', 15], ['O3+ Charcoal D-Tan', 15], ['O3+ D-Tan Underarms', 6], ['O3+ D-Tan Half Arms', 15],
    ['O3+ D-Tan Full Arms', 25], ['O3+ D-Tan Half Legs', 25], ['O3+ D-Tan Full Legs', 45], ['O3+ D-Tan Back', 35],
    ['O3+ D-Tan Stomach', 25], ['O3+ D-Tan Feet & Palms', 15], ['O3+ D-Tan Full Body', 120],
    ['Lotus D-Tan Clean-up', 15], ['O3+ D-Tan Facial', 15],
  ].map(([n, a]) => [n, a, null, false]),
  facial_kit: [
    'Lotus Clean-up', 'Lotus D-Tan Clean-up', 'Lotus Basic Facial (Oily Skin)', 'Lotus Hydravitals Facial (Dry Skin)', 'Lotus Acne-X Facial',
    'Lotus Preservita Sensitive Facial', 'Lotus Preservita Anti-ageing Facial', 'Lotus Insta Fair Facial', 'Lotus Goldsheen Facial',
    'Lotus Bridal Glow Facial', 'Lotus Ultimo Gold / Pearl Facial', 'Lotus Miraki Facial',
    'O3+ Clean-up', 'O3+ D-Tan Facial', 'O3+ Whitening / Brightening Facial', 'O3+ Seaweed Facial', "O3+ Men's Facial", 'O3+ Anti-ageing Facial',
    'O3+ Bridal Facial (Vitamin C Glow or Radiant Glow)', 'O3+ Gold Facial', 'O3+ Diamond Facial',
  ].map((n) => [n, 1, null, false]),
  mask: [],
  manipedi: [
    ['Regular Manicure', 10], ['Regular Pedicure', 15], ['Spa Manicure', 20], ['Spa Pedicure', 30],
    ['Paraffin Manicure', 20], ['Paraffin Pedicure', 30], ['Crystal Manicure', 20], ['Crystal Pedicure', 30],
  ],
  other: [],
};

// Starting rows for a product of this type, matched to the salon's services by name.
// Returns [{ service, amount, amounts, ticked }]
export function starterUsage(type, services) {
  const byName = new Map(services.filter((s) => s.active !== false).map((s) => [s.name.toLowerCase(), s]));
  return (STARTER[type] || [])
    .map(([name, amount, amounts, ticked]) => {
      const service = byName.get(name.toLowerCase());
      if (!service) return null;
      // keep only options this service really has
      let per = null;
      if (amounts && service.variants && service.variants.length) {
        per = {};
        for (const v of service.variants) if (v.label && amounts[v.label] != null) per[v.label] = amounts[v.label];
        if (!Object.keys(per).length) per = null;
      }
      return { service, amount, amounts: per, ticked: ticked !== false };
    })
    .filter(Boolean);
}

// Which option of the service a bill line was for ("Global Colour Women (M)" → "M")
export function variantOf(item, service) {
  if (item.variant) return item.variant;
  if (!service || !service.variants) return '';
  const m = /\(([^()]*)\)$/.exec(item.name || '');
  if (!m) return '';
  const label = m[1].split(' · ')[0]; // "(L · Thick)": the length is the option
  return service.variants.some((v) => v.label === label) ? label : '';
}

// How much of a product one bill line should have used
export function lineUsage(rule, item, service) {
  const qty = Number(item.qty) || 1;
  const v = variantOf(item, service);
  const per = rule.amounts && v && rule.amounts[v] != null ? Number(rule.amounts[v]) : Number(rule.amount) || 0;
  return per * qty;
}

// ---------------- Size of one bottle / tube / jar ----------------
// Typed the way it's printed: "1 L", "800 ml", "1.5l", "60 g", "1 kg", "5 uses". Stored in ml, g or uses.
const SIZE_UNITS = {
  ml: ['ml', 1], l: ['ml', 1000], lt: ['ml', 1000], ltr: ['ml', 1000], litre: ['ml', 1000], liter: ['ml', 1000], litres: ['ml', 1000],
  g: ['g', 1], gm: ['g', 1], gms: ['g', 1], gram: ['g', 1], grams: ['g', 1], kg: ['g', 1000],
  use: ['uses', 1], uses: ['uses', 1], pc: ['uses', 1], pcs: ['uses', 1],
};
export function parseSize(text, defUnit = 'ml') {
  const m = /^\s*(\d+(?:\.\d+)?)\s*([a-z]*)\s*$/i.exec(String(text ?? '').replace(/,/g, ''));
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  const [unit, mult] = u ? SIZE_UNITS[u] || [] : [defUnit, 1];
  if (!unit || !(n > 0)) return null;
  const size = Math.round(n * mult * 100) / 100;
  return size > 0 && size <= 100000 ? { size, unit } : null;
}
export function sizeText(size, unit) {
  const n = Number(size);
  if (!(n > 0)) return '';
  const r = (x) => String(Math.round(x * 100) / 100);
  if (unit === 'ml' && n >= 1000) return `${r(n / 1000)} L`;
  if (unit === 'g' && n >= 1000) return `${r(n / 1000)} kg`;
  if (unit === 'uses') return `${r(n)} ${n === 1 ? 'use' : 'uses'}`;
  return `${r(n)} ${unit || ''}`.trim();
}

// ---------------- Bottle check ----------------
// How many uses one bill line counts as, from the option in its name: "Keratin / Cysteine (L · Thick)" = 2 + 0.5.
// The same as use_weight() in supabase/01_schema.sql.
export const LENGTH_WEIGHT = { Fringe: 0.5, 'Crown area': 0.75, S: 1, M: 1.5, L: 2, XL: 2.5 };
export const EXTRA_WEIGHT = { Thick: 0.5, 'Extra thick': 1 };
export function useWeight(name) {
  const m = /\(([^()]*)\)\s*$/.exec(name || '');
  if (!m) return 1;
  const parts = m[1].split(' · ').map((x) => x.trim());
  let w = LENGTH_WEIGHT[parts[0]] ?? 1;
  for (const x of parts) w += EXTRA_WEIGHT[x] || 0;
  return w;
}
// A use without a bill: the same weight as a bill line with that option
export const freeUseWeight = (option, extra) => useWeight(`(${[option, extra].filter(Boolean).join(' · ')})`);

const median = (a) => {
  const v = [...a].sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
// the amount for the smallest option (S), or the plain amount: hair length is counted separately
const baseAmount = ([, amount, amounts]) => (amounts ? amounts.S ?? amounts.Fringe ?? Math.min(...Object.values(amounts)) : amount);
const typeBase = (type) => median((STARTER[type] || []).map(baseAmount).filter((x) => x > 0));
const quarter = (x) => Math.min(50, Math.max(0.25, Math.round(x * 4) / 4));

// Services to tick for a product of this type, with how much bigger or smaller each one is than a normal
// service of that type ("counts as"). Returns [{ service, weight, ticked }]
export function suggestTags(type, services) {
  const base = typeBase(type);
  return starterUsage(type, services).map((x) => {
    const row = (STARTER[type] || []).find(([n]) => n.toLowerCase() === x.service.name.toLowerCase());
    const w = base && row ? quarter(baseAmount(row) / base) : 1;
    return { service: x.service, weight: type === 'facial_kit' ? 1 : w, ticked: x.ticked };
  });
}

// How many normal services one unit typically lasts: 1000 ml developer ÷ 60 ml ≈ 17. A kit: its number of uses.
export function typicalUses(type, size, sizeUnit) {
  if (!(Number(size) > 0)) return null;
  if (sizeUnit === 'uses') return Number(size);
  const base = typeBase(type);
  return base ? Math.max(1, Math.round(Number(size) / base)) : null;
}
