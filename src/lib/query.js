// Filter / sort / limit rows in the browser, using the same options as db.list().
// Used by the demo database and by offline mode (cached data).
export function matches(row, o = {}) {
  for (const [k, v] of Object.entries(o.eq || {})) if (row[k] !== v) return false;
  for (const [k, v] of Object.entries(o.neq || {})) if (row[k] === v) return false;
  for (const [k, v] of Object.entries(o.gte || {})) if (!(row[k] >= v)) return false;
  for (const [k, v] of Object.entries(o.lte || {})) if (!(row[k] <= v)) return false;
  for (const [k, v] of Object.entries(o.lt || {})) if (!(row[k] < v)) return false;
  for (const [k, v] of Object.entries(o.in || {})) if (!v.includes(row[k])) return false;
  for (const [k, v] of Object.entries(o.like || {})) if (!String(row[k] ?? '').startsWith(String(v).replace(/%$/, ''))) return false;
  if (o.search && o.search.q) {
    const q = o.search.q.toLowerCase();
    if (!o.search.cols.some((c) => String(row[c] ?? '').toLowerCase().includes(q))) return false;
  }
  return true;
}

export function orderAndLimit(rows, o = {}) {
  let out = rows;
  if (o.order) {
    const [col, dir] = o.order;
    out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1));
  }
  if (o.limit) out = out.slice(0, o.limit);
  return out;
}

export const applyQuery = (rows, o = {}) => orderAndLimit(rows.filter((r) => matches(r, o)), o);
