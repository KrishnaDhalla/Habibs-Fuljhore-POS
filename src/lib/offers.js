// Offers: festival offers, weekly offer days and happy hours, applied by themselves at checkout.
// One offer per bill line: if two offers cover the same service, the bigger saving wins.
import { istDay, round2, rupee, fmtDate, toPaise } from './format';
import { mulDivRound, allocate } from './paise';
import { sectionLabel } from '../data/menu';

export const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Current Indian date, time and weekday (1 = Monday … 7 = Sunday)
export function istNow(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  }).formatToParts(d);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value;
  const hour = get('hour') === '24' ? '00' : get('hour');
  return { day: istDay(d), time: `${hour}:${get('minute')}`, dow: DOW.indexOf(get('weekday')) + 1 };
}

const hhmm = (t) => (t ? String(t).slice(0, 5) : '');

export function offerLive(o, now) {
  if (!o || !o.active) return false;
  if (o.starts_on && now.day < o.starts_on) return false;
  if (o.ends_on && now.day > o.ends_on) return false;
  if (o.days && o.days.length && !o.days.map(Number).includes(now.dow)) return false;
  if (o.start_time && now.time < hhmm(o.start_time)) return false;
  if (o.end_time && now.time >= hhmm(o.end_time)) return false;
  return true;
}

// For the owner's list: off / ended / upcoming / running / waiting (not this day or hour)
export function offerStatus(o, now) {
  if (!o.active) return 'off';
  if (o.ends_on && now.day > o.ends_on) return 'ended';
  if (o.starts_on && now.day < o.starts_on) return 'upcoming';
  return offerLive(o, now) ? 'running' : 'waiting';
}

export function offerCovers(o, line, service) {
  if (line.item_type === 'product') return o.applies_to === 'all' && !!o.include_products;
  if (o.applies_to === 'all') return true;
  if (!service) return false;
  if (o.applies_to === 'section') return (o.sections || []).includes(service.section);
  if (o.applies_to === 'category') return (o.categories || []).includes(service.category);
  if (o.applies_to === 'services') return (o.service_ids || []).includes(service.id);
  return false;
}

// Saving on one line in paise: % off, ₹ off each, or a special price
function savingP(o, unitPrice, qty) {
  const p = Math.max(0, toPaise(unitPrice));
  const q = Math.max(0, Number(qty) || 0);
  const v = Math.max(0, toPaise(o.value));
  if (o.kind === 'percent') return mulDivRound(p * q, Math.min(v, 10000), 10000);
  if (o.kind === 'amount') return Math.min(v, p) * q;
  if (o.kind === 'price') return Math.max(0, p - v) * q;
  return 0;
}
export function offerSaving(o, unitPrice, qty) {
  return savingP(o, unitPrice, qty) / 100;
}

const capP = (o) => (Number(o.max_discount) > 0 ? toPaise(o.max_discount) : 0);

// Total saving (paise) for a choice of one offer (or none) per line, with "up to ₹X" caps applied
function totalSaving(choice, sav) {
  const per = new Map();
  choice.forEach((o, i) => { if (o) per.set(o, (per.get(o) || 0) + sav[i].get(o)); });
  let t = 0;
  for (const [o, s] of per) t += capP(o) ? Math.min(s, capP(o)) : s;
  return t;
}

// Picks one offer per line so the customer gets the biggest total saving.
// Without caps that is simply the best offer on each line. With caps ("up to ₹500 off") the best
// mix is found by trying the combinations (a bill has a handful of lines, so this is instant).
function bestChoice(opts, sav) {
  const greedy = opts.map((o) => o[0] || null);
  if (!opts.some((o) => o.some((x) => x && capP(x)))) return greedy;
  let space = 1;
  for (const o of opts) space *= o.length + 1;
  if (space <= 50000) {
    const cur = new Array(opts.length).fill(null);
    let best = greedy;
    let bestT = totalSaving(greedy, sav);
    const walk = (i) => {
      if (i === opts.length) {
        const t = totalSaving(cur, sav);
        if (t > bestT) { bestT = t; best = [...cur]; }
        return;
      }
      for (const o of [...opts[i], null]) { cur[i] = o; walk(i + 1); }
    };
    walk(0);
    return best;
  }
  // Very big bills: improve one line at a time until nothing gets better
  let choice = greedy;
  let t = totalSaving(choice, sav);
  for (let guard = 0; guard < 1000; guard++) {
    let move = null;
    for (let i = 0; i < opts.length; i++) {
      for (const o of [...opts[i], null]) {
        if (o === choice[i]) continue;
        const next = choice.map((x, j) => (j === i ? o : x));
        const nt = totalSaving(next, sav);
        if (nt > t && (!move || nt > move.t)) move = { next, t: nt };
      }
    }
    if (!move) break;
    choice = move.next;
    t = move.t;
  }
  return choice;
}

/**
 * Works out which offer applies to each line right now.
 * Returns the lines with offer_id / offer_name / offer_discount filled in, the offers used,
 * and offers the customer *almost* got (bill too small), so the counter can mention them.
 */
export function applyOffers(lines, offers, { now = istNow(), servicesById = {}, isNew = false, enabled = true } = {}) {
  const live = (offers || []).filter((o) => offerLive(o, now));
  const grossP = lines.reduce((a, l) => a + Math.max(0, toPaise((Number(l.qty) || 0) * (Number(l.unit_price) || 0))), 0);
  const svc = (l) => servicesById[l.service_id];

  const ok = [];
  const missed = [];
  for (const o of live) {
    const covers = lines.some((l) => offerCovers(o, l, svc(l)));
    if (!covers) continue;
    const minP = Math.max(0, toPaise(o.min_bill));
    if (o.new_customers_only && !isNew) missed.push({ offer: o, reason: 'new' });
    else if (grossP < minP) missed.push({ offer: o, reason: 'min', short: (minP - grossP) / 100 });
    else ok.push(o);
  }

  // For each line: the offers that cover it, biggest saving first (ties: the order offers were made)
  const sav = lines.map(() => new Map());
  const opts = lines.map((l, i) => {
    if (!enabled) return [];
    const list = ok.filter((o) => offerCovers(o, l, svc(l))).map((o) => ({ o, s: savingP(o, l.unit_price, l.qty) })).filter((x) => x.s > 0);
    for (const x of list) sav[i].set(x.o, x.s);
    return list.sort((a, b) => b.s - a.s).map((x) => x.o);
  });
  const choice = bestChoice(opts, sav);

  // "Up to ₹500 off": share the cap across that offer's lines in proportion to their saving
  const discP = choice.map((o, i) => (o ? sav[i].get(o) : 0));
  for (const o of new Set(choice.filter(Boolean))) {
    const cap = capP(o);
    if (!cap) continue;
    const idx = choice.map((x, i) => (x === o ? i : -1)).filter((i) => i >= 0);
    const full = idx.reduce((a, i) => a + discP[i], 0);
    if (full <= cap) continue;
    const parts = allocate(cap, idx.map((i) => discP[i]));
    idx.forEach((i, k) => { discP[i] = parts[k]; });
  }
  const out = lines.map((l, i) => {
    const o = discP[i] ? choice[i] : null;
    return { ...l, offer_id: o ? o.id : '', offer_name: o ? o.name : '', offer_discount: o ? discP[i] / 100 : 0 };
  });

  const applied = [];
  for (const l of out) {
    if (!l.offer_discount) continue;
    let a = applied.find((x) => x.id === l.offer_id);
    if (!a) applied.push((a = { id: l.offer_id, name: l.offer_name, discount: 0 }));
    a.discount = round2(a.discount + l.offer_discount);
  }
  return { lines: out, applied, missed: enabled ? missed : [], live };
}

// One plain sentence describing an offer, for the owner's list and the counter banner
export function describeOffer(o, services = []) {
  const what =
    o.kind === 'percent' ? `${Number(o.value)}% off` : o.kind === 'amount' ? `${rupee(o.value)} off each` : `special price ${rupee(o.value)}`;
  let on = 'all services';
  if (o.applies_to === 'all' && o.include_products) on = 'all services and products';
  if (o.applies_to === 'section') on = (o.sections || []).map(sectionLabel).join(', ') + ' services';
  if (o.applies_to === 'category') on = (o.categories || []).join(', ');
  if (o.applies_to === 'services') {
    const names = (o.service_ids || []).map((id) => (services.find((s) => s.id === id) || {}).name).filter(Boolean);
    on = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ') || 'chosen services';
  }
  const when = [];
  if (o.starts_on && o.ends_on) when.push(o.starts_on === o.ends_on ? fmtDate(o.starts_on, false) : `${fmtDate(o.starts_on, false)} – ${fmtDate(o.ends_on, false)}`);
  else if (o.starts_on) when.push('from ' + fmtDate(o.starts_on, false));
  else if (o.ends_on) when.push('till ' + fmtDate(o.ends_on, false));
  if (o.days && o.days.length && o.days.length < 7) when.push('every ' + o.days.map((d) => DOW[d - 1]).join(', '));
  if (o.start_time || o.end_time) when.push(`${hhmm(o.start_time) || 'opening'}–${hhmm(o.end_time) || 'closing'}`);
  const extra = [];
  if (Number(o.min_bill)) extra.push(`bills over ${rupee(o.min_bill)}`);
  if (Number(o.max_discount)) extra.push(`up to ${rupee(o.max_discount)} off`);
  if (o.new_customers_only) extra.push('first visit only');
  return [`${what} on ${on}`, when.join(' · '), extra.join(' · ')].filter(Boolean).join(' · ');
}
