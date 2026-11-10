// Bottle check: how many services each tube / jar / bottle / kit lasted, from the bills already made.
// Pure maths on the rows unit_report() returns (see units.js), so it can be tested on its own.
import { round2 } from './format';
import { typicalUses } from '../data/usage';

export const EARLY = 0.7;      // a unit that ended below 70% of normal: finished early
export const ALMOST = 0.9;     // the one in use has served 90% of normal ("9 of 10"): almost finished
export const DAYS_EARLY = 0.6; // products not ticked for any service are checked by days: below 60% of normal
export const LEARN_MIN = 3;    // finished units needed before the app knows "normal" by itself
export const FAST = 0.7;       // weekly check: the bills explain less than 70% of how empty it looks: running fast
export const LOW_LEARNED = 0.7; // learned normal below 70% of the typical for that size: warn (it may have learned the loss)
const DAY = 86400000;
const ms = (x) => new Date(x).getTime();

export function median(a) {
  const v = [...a].sort((x, y) => x - y);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

// Finished early: below 70% of what it should have served AND at least one whole service short.
// Same as unit_early() in the database.
export const isEarly = (uses, expected) => expected != null && uses < EARLY * expected && expected - uses >= 1;
const scaleOf = (u) => (Number(u.scale) > 0 ? Number(u.scale) : 1);

// Normal uses per unit (of the usual size): the owner's number, else the middle of the finished ones (not the
// very first one, which may have shared with one opened before the app), once there are 3. A 500 ml bottle of
// a 1 L product counts double towards it. Same as unit_normal() in the database.
export function unitNormal(product, units) {
  const vals = units.filter((u) => u.move_id && u.ended_at && !u.is_first).map((u) => Number(u.uses) / scaleOf(u));
  const learned = vals.length >= LEARN_MIN ? round2(median(vals)) : null;
  const set = Number(product.uses_per_unit) > 0 ? Number(product.uses_per_unit) : null;
  const normal = set ?? (learned > 0 ? learned : null);
  return { normal, source: set ? 'set' : normal ? 'learned' : null, learned, learnedN: vals.length };
}

// For products not ticked for any service: normal days one unit lasts
export function daysNormal(units) {
  const vals = units.filter((u) => u.move_id && u.ended_at && !u.is_first).map((u) => (ms(u.ended_at) - ms(u.started_at)) / DAY / scaleOf(u));
  const normal = vals.length >= LEARN_MIN ? round2(median(vals)) : null;
  return { normal: normal > 0 ? normal : null, learnedN: vals.length };
}

// Weekly check of the one in use: it looks this empty, so it should have served `expected`; the bills show `at`
export const levelResult = (at, expected) => (expected == null ? 'unknown' : at < FAST * expected && expected - at >= 1 ? 'fast' : 'ok');

/**
 * report: what unit_report() returns; products, staff: rows; freeUses: free_uses rows (owner only, may be empty)
 * checks: unit_checks rows (owner only, may be empty)
 * from / to: ISO times of the period (units that ended in it, give-outs made in it). Open units always count.
 * Returns { rows, staff, totals }
 */
export function bottleCheck({ report, products, staff = [], freeUses = [], checks = [], from = null, to = null }) {
  const now = ms(report.now);
  const F = from ? ms(from) : -Infinity;
  const T = to ? ms(to) : Infinity;
  const inP = (t) => t != null && ms(t) >= F && ms(t) <= T;
  const byId = Object.fromEntries(products.map((p) => [p.id, p]));
  const nameOf = (id) => (staff.find((s) => s.id === id) || {}).name || '';
  const rows = [];

  for (const r of report.products) {
    const p = byId[r.product_id];
    if (!p) continue;
    const tagged = Number(r.tags) > 0;
    const units = r.units.filter((u) => u.move_id);
    const gap = r.units.find((u) => !u.move_id) || null;
    const N = tagged ? unitNormal(p, units) : { normal: null, source: null, learned: null, learnedN: 0 };
    const D = tagged ? { normal: null, learnedN: 0 } : daysNormal(units);
    const normal = tagged ? N.normal : D.normal;
    const lastCheck = (moveId) => checks.filter((c) => c.move_id === moveId).sort((a, b) => ms(b.created_at) - ms(a.created_at))[0] || null;
    const list = units.map((u) => {
      const open = !u.ended_at;
      const days = ((open ? now : ms(u.ended_at)) - ms(u.started_at)) / DAY;
      const expected = normal ? normal * scaleOf(u) : null; // what this one (its size) should serve
      const measure = tagged ? Number(u.uses) : days;
      const ratio = expected ? measure / expected : null;
      const check = open ? lastCheck(u.move_id) : null;
      const level = check ? { ...check, result: levelResult(Number(check.uses_at), check.expected_at == null ? null : Number(check.expected_at)) } : null;
      let status;
      if (open) status = level && level.result === 'fast' ? 'fast' : ratio != null && ratio >= ALMOST ? 'almost' : 'open';
      else if (u.is_first) status = 'first';
      else if (ratio == null) status = 'learning';
      else if (tagged ? isEarly(measure, expected) : ratio < DAYS_EARLY && expected - measure >= 1) status = 'early';
      else status = 'fine';
      const cost = Number(u.unit_cost ?? p.cost_price) || 0;
      return {
        ...u, open, days: round2(days), expected: expected == null ? null : round2(expected), ratio: ratio == null ? null : round2(ratio), status, level,
        lost: status === 'early' ? round2((1 - ratio) * cost * Number(u.n || 1)) : 0,
        givenTo: nameOf(u.staff_id),
      };
    }).reverse(); // newest first
    const open = list.filter((u) => u.open);
    const ended = list.filter((u) => !u.open && inP(u.ended_at));
    const early = ended.filter((u) => u.status === 'early');
    const noEmpty = list.filter((u) => inP(u.started_at) && u.empty_returned === false).length;
    const almost = open.some((u) => u.status === 'almost');
    const fast = open.filter((u) => u.status === 'fast');
    // learned normal far below what that size usually lasts: it may have learned the loss
    const typical = tagged ? typicalUses(p.use_type, p.size, p.size_unit) : null;
    const lowLearned = tagged && N.source === 'learned' && typical && normal < LOW_LEARNED * typical ? { typical } : null;
    let status;
    if (early.length || fast.length) status = 'check';
    else if (almost) status = 'almost';
    else if (!units.length) status = 'none';
    else if (!normal) status = 'learning';
    else status = 'fine';
    rows.push({
      product: p, tagged, by: tagged ? 'uses' : 'days',
      normal, source: tagged ? N.source : normal ? 'learned' : null, learned: tagged ? N.learned : D.normal, learnedN: tagged ? N.learnedN : D.learnedN,
      units: list, open, ended, early: early.length, fast: fast.length, repeat: early.length >= 2, lowLearned, lost: round2(early.reduce((a, u) => a + u.lost, 0)), noEmpty,
      gap: gap && Number(gap.clients) > 0 ? { uses: Number(gap.uses), clients: Number(gap.clients) } : null,
      almost, orderNow: almost && Number(p.stock) <= 0, status,
    });
  }
  const order = { check: 0, almost: 1, learning: 2, fine: 3, none: 4 };
  rows.sort((a, b) => order[a.status] - order[b.status] || b.lost - a.lost || a.product.name.localeCompare(b.product.name));

  // by person: who took the units, which of those finished early, give-outs without the empty, uses without a bill
  const per = {};
  const get = (id) => (per[id || ''] = per[id || ''] || { id: id || '', name: id ? nameOf(id) || 'Staff removed' : 'Not recorded', taken: 0, early: 0, lost: 0, noEmpty: 0, free: 0 });
  for (const row of rows) {
    for (const u of row.units) {
      if (inP(u.started_at)) {
        const s = get(u.staff_id);
        s.taken += Number(u.n) || 1;
        if (u.empty_returned === false) s.noEmpty += 1;
      }
      if (u.status === 'early' && inP(u.ended_at)) { const s = get(u.staff_id); s.early += 1; s.lost = round2(s.lost + u.lost); }
    }
  }
  const free = freeUses.filter((f) => inP(f.created_at));
  for (const f of free) get(f.staff_id).free += Number(f.qty) || 1;
  const people = Object.values(per).map((x) => ({ ...x, repeat: x.early >= 2 }))
    .sort((a, b) => b.early - a.early || b.lost - a.lost || b.noEmpty - a.noEmpty || b.taken - a.taken);

  return {
    rows,
    staff: people,
    totals: {
      early: rows.reduce((a, r) => a + r.early, 0),
      fast: rows.reduce((a, r) => a + r.fast, 0),
      repeats: people.filter((x) => x.repeat && x.id).length,
      lowLearned: rows.filter((r) => r.lowLearned).length,
      lost: round2(rows.reduce((a, r) => a + r.lost, 0)),
      almost: rows.filter((r) => r.almost).length,
      orderNow: rows.filter((r) => r.orderNow).length,
      noEmpty: rows.reduce((a, r) => a + r.noEmpty, 0),
      free: free.length,
      gaps: rows.filter((r) => r.gap).length,
    },
  };
}

// The one in use now, for the Stock list: "6 of ~10 uses"
export function openInfo(row) {
  if (!row || !row.open.length) return null;
  const u = row.open[0];
  return { unit: u, uses: Number(u.uses), clients: Number(u.clients), days: u.days, normal: u.expected, by: row.by, almost: row.almost, fast: u.status === 'fast', count: row.open.length };
}
