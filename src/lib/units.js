// Bottle check maths: the units (each Give out) of a product, and how many uses each one served.
// The same as product_units() and unit_report() in supabase/01_schema.sql; npm test runs both on the same data.
// Used by the demo database. With Supabase, the database does this and the app only shows it.
import { round2 } from './format';
import { useWeight, freeUseWeight } from '../data/usage';

const ms = (x) => new Date(x).getTime();
const byTimeThenId = (a, b) => a.s - b.s || (a.move_id < b.move_id ? -1 : a.move_id > b.move_id ? 1 : 0);

/**
 * Units of one product in use on or after `from`.
 * moves: stock_moves; ends: unit_ends; bills: { id → bill }; items: bill_items; tags: service_usage; freeUses: free_uses
 * Returns rows like product_units(): { move_id, staff_id, n, unit_cost, started_at, ended_at, how, by_move,
 * empty_returned, is_first, uses, clients }, plus one { move_id: null, how: 'gap' } row for services billed
 * while nothing was in use (after the first Give out).
 */
export function productUnits({ productId, productSize = null, moves, ends, bills, items, tags, freeUses, from }) {
  const usual = Number(productSize) > 0 ? Number(productSize) : null;
  const endOf = new Map(ends.map((e) => [e.move_id, e]));
  const mv = moves
    .filter((m) => m.product_id === productId && m.type === 'use' && Number(m.qty) < 0)
    .map((m) => {
      const e = endOf.get(m.id);
      return {
        move_id: m.id, staff_id: m.staff_id || null, n: -Number(m.qty), unit_cost: m.unit_cost ?? null,
        started_at: m.created_at, ended_at: e ? e.ended_at : null, how: e ? e.how : null, by_move: e ? e.by_move || null : null,
        empty_returned: m.empty_returned ?? null, s: ms(m.created_at), e: e ? ms(e.ended_at) : null,
        // its size against the usual one (a 500 ml bottle of a 1 L product = 0.5)
        unit_size: m.unit_size ?? null,
        scale: usual ? Math.round(((Number(m.unit_size) > 0 ? Number(m.unit_size) : usual) / usual) * 10000) / 10000 : 1,
      };
    })
    .sort(byTimeThenId)
    .map((u, i) => ({ ...u, is_first: i === 0 }));
  const F = ms(from);
  const rep = mv.filter((u) => u.s >= F || u.e === null || u.e > F);
  const t0 = Math.min(F, rep.length ? Math.min(...rep.map((u) => u.s)) : F);
  const allu = mv.filter((u) => u.e === null || u.e > t0);

  const weight = new Map(tags.filter((t) => t.product_id === productId).map((t) => [t.service_id, Number(t.weight ?? 1)]));
  const lines = [];
  for (const it of items) {
    if (it.item_type !== 'service' || !weight.has(it.service_id)) continue;
    const b = bills[it.bill_id];
    if (!b || b.status !== 'paid') continue;
    const t = ms(b.created_at);
    if (t < t0) continue;
    const q = Number(it.qty ?? 1);
    lines.push({ t, w: q * weight.get(it.service_id) * useWeight(it.name), c: q });
  }
  for (const f of freeUses) {
    if (!weight.has(f.service_id)) continue;
    const t = ms(f.created_at);
    if (t < t0) continue;
    const q = Number(f.qty ?? 1);
    lines.push({ t, w: q * weight.get(f.service_id) * freeUseWeight(f.option_label, f.extra_label), c: q });
  }
  // how many units were open when each service was done: a service done while two were open counts half for each
  for (const l of lines) l.k = allu.reduce((a, x) => a + (x.s <= l.t && (x.e === null || x.e > l.t) ? x.n : 0), 0);

  const out = rep.map(({ s, e, ...u }) => {
    let w = 0;
    let c = 0;
    for (const l of lines) {
      if (l.k > 0 && l.t >= s && (e === null || l.t < e)) { w += l.w / l.k; c += l.c / l.k; }
    }
    return { ...u, uses: round2(w), clients: round2(c) };
  });
  if (mv.length) {
    const after = Math.max(F, mv[0].s);
    const gap = lines.filter((l) => l.k === 0 && l.t >= after);
    if (gap.length) {
      out.push({
        move_id: null, staff_id: null, n: 0, unit_cost: null, started_at: null, ended_at: null, how: 'gap', by_move: null,
        empty_returned: null, is_first: false, uses: round2(gap.reduce((a, l) => a + l.w, 0)), clients: round2(gap.reduce((a, l) => a + l.c, 0)),
        unit_size: null, scale: null,
      });
    }
  }
  return out;
}

// What unit_report() returns, from the demo database's tables
export function unitReport(T, { since, now = new Date() } = {}) {
  const from = since || new Date(now.getTime() - 180 * 86400000).toISOString();
  const bills = Object.fromEntries(T('bills').map((b) => [b.id, b]));
  const tags = T('service_usage');
  const moves = T('stock_moves');
  const products = T('products')
    .filter((p) => tags.some((t) => t.product_id === p.id) || moves.some((m) => m.product_id === p.id && m.type === 'use'))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : 1));
  return {
    now: now.toISOString(),
    from,
    products: products.map((p) => ({
      product_id: p.id,
      tags: tags.filter((t) => t.product_id === p.id).length,
      units: productUnits({ productId: p.id, productSize: p.size, moves, ends: T('unit_ends'), bills, items: T('bill_items'), tags, freeUses: T('free_uses'), from }),
    })),
  };
}

// The open units of a product right now (Give out asks what happened to them)
export const openUnits = (moves, ends, productId) => {
  const done = new Set(ends.map((e) => e.move_id));
  return moves.filter((m) => m.product_id === productId && m.type === 'use' && Number(m.qty) < 0 && !done.has(m.id))
    .sort((a, b) => ms(a.created_at) - ms(b.created_at) || (a.id < b.id ? -1 : 1));
};

// Which open unit a Give out to this person ends: their own, else the oldest (same as issue_stock())
export const unitToEnd = (open, staffId) => open.find((m) => (m.staff_id || null) === (staffId || null)) || open[0] || null;

// How many of each size are in the store (deliveries of a different pack size), oldest first.
// Returns [{ size, qty }] in the product's size unit; null size = the usual one.
export function sizesInStore(product, moves) {
  const usual = Number(product.size) > 0 ? Number(product.size) : null;
  const key = (m) => (Number(m.unit_size) > 0 ? Number(m.unit_size) : usual);
  const left = new Map();
  const first = new Map();
  for (const m of [...moves].filter((x) => x.product_id === product.id).sort((a, b) => ms(a.created_at) - ms(b.created_at))) {
    const k = m.type === 'in' || m.type === 'use' ? key(m) : usual; // sales, counts and returns: the usual size
    left.set(k, (left.get(k) || 0) + Number(m.qty));
    if (m.type === 'in' && !first.has(k)) first.set(k, ms(m.created_at));
  }
  return [...left.entries()].filter(([, q]) => q > 0).map(([size, qty]) => ({ size, qty: round2(qty), since: first.get(size) || 0 }))
    .sort((a, b) => a.since - b.since);
}
