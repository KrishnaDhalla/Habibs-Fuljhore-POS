// The daily stock message to the staff WhatsApp group (one tap at the counter): what can be used today, what is
// running low, what is out (and the services that need it, so nobody promises them), and what is for sale.
// No cost prices. Kept under one WhatsApp message (4,000 characters).
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayText = (d) => { const t = new Date(d + 'T12:00:00Z'); return `${WD[t.getUTCDay()]} ${t.getUTCDate()} ${MON[t.getUTCMonth()]}`; };
const inr = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const num = (n) => String(Math.round(Number(n) * 100) / 100);
const MAX = 3900;

// openUnits: [{ product_id }] for each one in use now (given out, not finished), or inUse: { productId: count }
export function stockMessage({ products, openUnits = [], inUse = null, usage = [], services = [], settings = {}, day }) {
  const open = inUse || openUnits.reduce((m, u) => ({ ...m, [u.product_id]: (m[u.product_id] || 0) + 1 }), {});
  const live = products.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  const salon = live.filter((p) => p.kind === 'salon');
  const retail = live.filter((p) => p.kind === 'retail');
  const have = (p) => !p.finished_at && Number(p.stock) > 0;
  const svcOf = (p) => usage.filter((u) => u.product_id === p.id)
    .map((u) => services.find((s) => s.id === u.service_id && s.active !== false)).filter(Boolean).map((s) => s.name);

  const use = salon.filter(have).map((p) => {
    const o = open[p.id] || 0;
    const low = Number(p.stock) <= Number(p.low_stock);
    return `• ${p.name}: ${num(p.stock)}${o ? ` (${o} open)` : ''}${low ? ' · running low' : ''}`;
  });
  const out = salon.filter((p) => !have(p)).map((p) => {
    const o = open[p.id] || 0;
    const sv = svcOf(p);
    return `• ${p.name}${o ? ': only the open one left' : ''}${sv.length ? ` · ${sv.slice(0, 6).join(', ')}${sv.length > 6 ? ` +${sv.length - 6}` : ''}` : ''}`;
  });
  const sell = retail.filter(have).map((p) => `• ${p.name}: ${num(p.stock)} · ${inr(p.sell_price)}${Number(p.stock) <= Number(p.low_stock) ? ' · last few' : ''}`);
  const sold = retail.filter((p) => !have(p)).map((p) => `• ${p.name}`);

  const where = [settings.salon_name || 'Habibs', settings.branch ? String(settings.branch).split(',')[0] : ''].filter(Boolean).join(' ');
  const head = `*${where}: stock for ${dayText(day)}*`;
  const foot = 'Ask the counter before using anything not on this list. Reply here if something has run out.';
  const sections = [
    ['*To use today (salon products)*', use],
    ['*Out of stock: ask before booking these*', out],
    ['*For sale*', sell],
    ['*Sold out*', sold],
  ];
  const build = (limit) => [head, ...sections.filter(([, l]) => l.length).map(([t, l]) => [t, ...l.slice(0, limit), ...(l.length > limit ? [`…and ${l.length - limit} more`] : [])].join('\n')), foot].join('\n\n');
  let text = build(Infinity);
  for (let limit = 60; text.length > MAX && limit > 0; limit -= 5) text = build(limit);
  return text;
}
