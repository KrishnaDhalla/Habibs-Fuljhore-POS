// Offline billing.
// Wraps the live database so the counter keeps billing when the internet is down:
//  - keeps a copy of settings, services, staff, products and customers on this device
//  - bills made without internet get this device's own number series (HF2627-A0001),
//    are kept in an "outbox" on the device and upload by themselves when the internet is back
//  - every bill carries its own id, so a bill is never saved twice
import { uid, istDay } from './format';
import { applyQuery, matches, orderAndLimit } from './query';

const K = {
  cache: 'pos-cache-v1:',
  outbox: 'pos-outbox-v1',
  user: 'pos-last-user',
  device: 'pos-device-letter',
  counter: 'pos-offline-counter',
  approved: 'pos-login-approved',
  recent: 'pos-recent-v1:',
};
const RECENT_DAYS = 3; // bills seen in the last 3 days stay readable offline (Bills page, day totals)
const CACHED = ['settings', 'services', 'staff', 'products', 'customers', 'offers'];
const RETRY_MS = 30000;
const DOWN_MS = 20000; // after a failed request, skip the network for this long

const read = (k, d) => {
  try {
    const v = localStorage.getItem(k);
    return v ? JSON.parse(v) : d;
  } catch {
    return d;
  }
};
const write = (k, v) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
};

export const isNetworkError = (e) => /reach the database|fetch|network|abort|timeout|load failed/i.test((e && e.message) || '');
const isRetryable = (e) => isNetworkError(e) || /jwt|token|401|not authenticated/i.test((e && e.message) || '');

export const getDeviceLetter = () => read(K.device, 'A');
export const setDeviceLetter = (l) => write(K.device, l);

function fyCode(iso) {
  const day = istDay(iso);
  let y = Number(day.slice(0, 4));
  if (Number(day.slice(5, 7)) < 4) y -= 1;
  return String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
}

const slimCustomer = (c) => ({
  id: c.id, phone: c.phone, name: c.name, gender: c.gender, birthday: c.birthday, source: c.source, whatsapp_ok: c.whatsapp_ok,
  visits: c.visits, total_spent: c.total_spent, first_visit: c.first_visit, last_visit: c.last_visit, created_at: c.created_at, notes: c.notes,
});

const NEEDS_NET = 'No internet. This needs a connection. Billing still works.';
const OWNER_NET = 'Owner approval needs internet. Billing still works, with discounts up to the limit.';

export function withOffline(inner) {
  const listeners = new Set();
  let flushing = false;
  let downUntil = 0;

  const looksOffline = () => !navigator.onLine || Date.now() < downUntil;
  const markDown = () => {
    const was = looksOffline();
    downUntil = Date.now() + DOWN_MS;
    if (!was) notify();
  };
  const markUp = () => {
    const was = looksOffline();
    downUntil = 0;
    if (was) notify();
  };

  const outbox = () => read(K.outbox, []);
  const status = () => {
    const o = outbox();
    return { online: !looksOffline(), pending: o.length, failed: o.filter((x) => x.error).length, entries: o, flushing };
  };
  function notify() {
    const s = status();
    listeners.forEach((cb) => cb(s));
  }
  const saveOutbox = (list) => {
    if (!write(K.outbox, list)) throw new Error('This device has no storage space left, so the bill was not saved.');
    notify();
  };

  // ----- reading -----
  function cacheIfFull(t, o, rows) {
    if (!CACHED.includes(t)) return;
    const filtered = ['eq', 'neq', 'gte', 'lte', 'lt', 'in', 'like', 'search', 'limit'].some((k) => o[k] && (typeof o[k] !== 'object' || Object.keys(o[k]).length));
    if (filtered) return;
    write(K.cache + t, t === 'customers' ? rows.map(slimCustomer) : rows);
  }

  // Recent bills and their lines, kept so the Bills page and the day's totals still work offline
  function rememberRecent(t, rows) {
    if ((t !== 'bills' && t !== 'bill_items') || !rows || !rows.length) return;
    const since = new Date(Date.now() - RECENT_DAYS * 86400000).toISOString();
    const m = new Map(read(K.recent + t, []).map((r) => [r.id, r]));
    for (const r of rows) if (r && r.id && !r._pending && String(r.created_at) >= since) m.set(r.id, r);
    const keep = [...m.values()].filter((r) => String(r.created_at) >= since).sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 3000);
    write(K.recent + t, keep);
  }

  // Customers whose only bills are still waiting to upload
  function pendingCustomers(known) {
    const phones = new Set(known.map((c) => c.phone));
    const out = {};
    for (const e of outbox()) {
      const ph = e.bill.customer_phone;
      if (!ph || phones.has(ph)) continue;
      const c = (out[ph] = out[ph] || { id: null, phone: ph, name: e.bill.customer_name, visits: 0, total_spent: 0, first_visit: e.created_at, last_visit: e.created_at, created_at: e.created_at });
      c.visits += 1;
      c.total_spent += Number(e.bill.total);
      c.last_visit = e.created_at;
    }
    return Object.values(out);
  }

  function fromCache(t, o) {
    if (CACHED.includes(t)) {
      const rows = read(K.cache + t, null);
      if (!rows) throw new Error('No internet, and this was never loaded on this device. Connect once to set it up.');
      return applyQuery(t === 'customers' ? [...rows, ...pendingCustomers(rows)] : rows, o);
    }
    if (t === 'bills' || t === 'bill_items') return applyQuery(read(K.recent + t, []), o);
    throw new Error(NEEDS_NET);
  }

  // Bills waiting to upload show up in the Bills list, reports and payroll straight away
  function withPending(t, o, rows) {
    if (t !== 'bills' && t !== 'bill_items') return rows;
    const ob = outbox();
    if (!ob.length) return rows;
    let extra;
    if (t === 'bills') {
      const have = new Set(rows.map((r) => r.id));
      extra = ob.map((e) => e.bill).filter((b) => !have.has(b.id) && matches(b, o));
    } else {
      const have = new Set(rows.map((r) => r.bill_id));
      extra = ob.flatMap((e) => e.items).filter((i) => !have.has(i.bill_id) && matches(i, o));
    }
    return extra.length ? orderAndLimit([...rows, ...extra], o) : rows;
  }

  async function online(fn) {
    try {
      const r = await fn();
      markUp();
      return r;
    } catch (e) {
      if (isNetworkError(e)) markDown();
      throw e;
    }
  }

  // ----- offline bill numbers -----
  function series(when) {
    const settings = read(K.cache + 'settings', []);
    const prefix = (settings.find((s) => s.key === 'bill_prefix') || {}).value || 'HF';
    return `${prefix}${fyCode(when)}-${getDeviceLetter()}`;
  }
  function nextOfflineNo(when) {
    const s = series(when);
    const ctr = read(K.counter, {});
    const used = outbox().filter((e) => e.bill_no.startsWith(s)).map((e) => parseInt(e.bill_no.slice(s.length, s.length + 4), 10) || 0);
    const n = Math.max(ctr[s] || 0, ...used) + 1;
    ctr[s] = n;
    write(K.counter, ctr);
    return s + String(n).padStart(4, '0');
  }
  async function syncCounter() {
    const s = series(new Date().toISOString());
    const [last] = await inner.list('bills', { like: { bill_no: s + '%' }, order: ['bill_no', 'desc'], limit: 1 });
    const n = last ? parseInt(last.bill_no.slice(s.length, s.length + 4), 10) || 0 : 0;
    const ctr = read(K.counter, {});
    if (n > (ctr[s] || 0)) {
      ctr[s] = n;
      write(K.counter, ctr);
    }
  }

  function saveOffline(p) {
    const when = new Date().toISOString();
    const bill_no = nextOfflineNo(when);
    const custs = read(K.cache + 'customers', []);
    const known = p.customer_phone && (custs.some((c) => c.phone === p.customer_phone && c.visits > 0) || outbox().some((e) => e.bill.customer_phone === p.customer_phone));
    const bill = {
      id: p.id, bill_no, created_at: when, customer_id: null, customer_name: p.customer_name || null, customer_phone: p.customer_phone || null,
      is_new_customer: !!p.customer_phone && !known, subtotal: p.subtotal, offer_discount: p.offer_discount || 0, discount: p.discount || 0, taxable: p.taxable, cgst: p.cgst || 0,
      sgst: p.sgst || 0, round_off: p.round_off || 0, total: p.total, pay_mode: p.pay_mode, paid_cash: p.paid_cash || 0, paid_upi: p.paid_upi || 0,
      paid_card: p.paid_card || 0, paid_points: p.paid_points || 0, points_earned: 0, points_balance: null,
      status: 'paid', note: p.note || null, created_by: p.created_by || null, _pending: true,
    };
    const items = p.items.map((it, i) => ({
      ...it, id: `${p.id}-${i}`, bill_id: p.id, created_at: when, service_id: it.service_id || null, product_id: it.product_id || null,
      staff_id: it.staff_id || null, staff_name: it.staff_name || null, _pending: true,
    }));
    saveOutbox([...outbox(), { id: p.id, bill_no, created_at: when, payload: { ...p, bill_no, created_at: when }, bill, items, tries: 0, error: '' }]);
    return { ...bill, _items: items };
  }

  // ----- uploading -----
  async function flush() {
    if (flushing || !navigator.onLine || !outbox().length) return;
    flushing = true;
    notify();
    try {
      for (const entry of outbox()) {
        try {
          const saved = await inner.rpc('create_bill', { p: entry.payload });
          rememberRecent('bills', [saved]);
          markUp();
          saveOutbox(outbox().filter((x) => x.id !== entry.id));
          // ticked "Send the bill on WhatsApp" while offline: it goes now, with the bill as uploaded (its final number)
          if (entry.payload.wa_send && inner.whatsapp && saved && saved.id) {
            const settings = Object.fromEntries((read(K.cache + 'settings', []) || []).map((x) => [x.key, x.value]));
            import('./whatsapp.js')
              .then((m) => m.sendBillOnWhatsApp(saved, entry.items, settings, { send: (b) => inner.whatsapp(b) }))
              .catch(() => { /* shown on the bill as not sent; can be sent from Bills */ });
          }
        } catch (e) {
          if (isRetryable(e)) {
            if (isNetworkError(e)) markDown();
            break;
          }
          saveOutbox(outbox().map((x) => (x.id === entry.id ? { ...x, error: e.message, tries: x.tries + 1 } : x)));
        }
      }
    } finally {
      flushing = false;
      notify();
    }
  }

  // Refresh the copies kept on this device
  async function warm() {
    if (!navigator.onLine) return;
    try {
      for (const t of CACHED) cacheIfFull(t, {}, await inner.list(t, { order: [t === 'settings' ? 'key' : 'created_at', 'asc'] }));
      await syncCounter();
      markUp();
    } catch (e) {
      if (isNetworkError(e)) markDown();
    }
  }

  if (typeof window !== 'undefined') {
    window.addEventListener('online', () => { downUntil = 0; notify(); flush().then(warm); });
    window.addEventListener('offline', notify);
    setInterval(() => { if (outbox().length) flush(); }, RETRY_MS);
    setTimeout(() => flush().then(warm), 2500);
  }

  const passWrite = (fn) => async (...args) => {
    if (looksOffline() && !navigator.onLine) throw new Error(NEEDS_NET);
    try {
      return await online(() => fn(...args));
    } catch (e) {
      throw isNetworkError(e) ? new Error(NEEDS_NET) : e;
    }
  };

  return {
    mode: inner.mode,
    async list(t, o = {}) {
      if (!looksOffline()) {
        try {
          const rows = await online(() => inner.list(t, o));
          cacheIfFull(t, o, rows);
          rememberRecent(t, rows);
          return withPending(t, o, rows);
        } catch (e) {
          if (!isNetworkError(e)) throw e;
        }
      }
      return withPending(t, o, fromCache(t, o));
    },
    async get(t, id) {
      if (!looksOffline()) {
        try {
          return await online(() => inner.get(t, id));
        } catch (e) {
          if (!isNetworkError(e)) throw e;
        }
      }
      return fromCache(t, { eq: { id } })[0] || null;
    },
    insert: passWrite((...a) => inner.insert(...a)),
    update: passWrite((...a) => inner.update(...a)),
    upsert: passWrite((...a) => inner.upsert(...a)),
    remove: passWrite((...a) => inner.remove(...a)),
    removeWhere: passWrite((...a) => inner.removeWhere(...a)),
    async rpc(name, args) {
      if (name !== 'create_bill') {
        if (name === 'cancel_bill' && outbox().some((e) => e.id === args.p_id)) {
          throw new Error('This bill is still waiting to upload. Cancel it after it uploads.');
        }
        const out = await passWrite((...a) => inner.rpc(...a))(name, args);
        if (name === 'cancel_bill') rememberRecent('bills', [out]);
        return out;
      }
      const p = { ...args.p, id: args.p.id || uid() };
      if (!looksOffline()) {
        if (outbox().length) await flush();
        try {
          const b = await online(() => inner.rpc(name, { p }));
          rememberRecent('bills', [b]);
          return b;
        } catch (e) {
          if (!isNetworkError(e)) throw e;
        }
      }
      // A past bill is the owner's, typed in later: it needs the internet (its number comes from the database)
      if (p.past) throw new Error('Past bills need the internet. Try again when it is back.');
      return saveOffline(p);
    },
    // ----- offline status for the screen -----
    subscribe(cb) {
      listeners.add(cb);
      cb(status());
      return () => listeners.delete(cb);
    },
    flush,
    status,
    // ----- login approval -----
    async loginStatus() {
      try {
        const s = await online(() => inner.loginStatus());
        if (s === 'owner' || s === 'approved') write(K.approved, s);
        else try { localStorage.removeItem(K.approved); } catch { /* ignore */ }
        return s;
      } catch (e) {
        if (!isNetworkError(e) && navigator.onLine) throw e;
        return read(K.approved, null) || 'offline'; // approved before on this device: keep billing offline
      }
    },
    // ----- owner approval: always asks the database, so it needs internet -----
    ...Object.fromEntries(['ownerRequest', 'ownerStatus', 'ownerCode', 'ownerCurrent', 'ownerLock', 'ownerTotpStatus', 'ownerTotpSet', 'ownerTotpRemove', 'ownerList', 'ownerDecide']
      .map((k) => [k, async (...a) => {
        if (!navigator.onLine) throw new Error(OWNER_NET);
        try {
          return await online(() => inner[k](...a));
        } catch (e) {
          throw isNetworkError(e) ? new Error(OWNER_NET) : e;
        }
      }])),
    // Staff documents need the internet
    files: Object.fromEntries(['upload', 'download', 'remove'].map((k) => [k, (...a) => passWrite((...b) => inner.files[k](...b))(...a)])),
    notify: async (...a) => {
      if (!navigator.onLine || !inner.notify) return null;
      try { return await inner.notify(...a); } catch { return null; }
    },
    // WhatsApp bills need the internet
    whatsapp: async (body) => {
      if (!inner.whatsapp) throw new Error('WhatsApp is not available here');
      if (!navigator.onLine) throw new Error('WhatsApp needs the internet. The bill goes when it is back (or send it from Bills).');
      try {
        return await online(() => inner.whatsapp(body));
      } catch (e) {
        throw isNetworkError(e) ? new Error('WhatsApp needs the internet. Send it from Bills when it is back.') : e;
      }
    },
    requestLogin: (device) => online(() => inner.requestLogin(device)),
    listLogins: () => online(() => inner.listLogins()),
    decideLogin: (id, approve) => online(() => inner.decideLogin(id, approve)),
    auth: {
      async session() {
        let s = null;
        try {
          s = await inner.auth.session();
        } catch { /* offline */ }
        if (s) {
          write(K.user, { id: s.user.id, email: s.user.email });
          return s;
        }
        // Signed in before on this device but can't reach the server: keep working offline
        const u = read(K.user, null);
        if (u && (!navigator.onLine || !(await inner.ping()))) {
          markDown();
          return { user: u, offline: true };
        }
        return null;
      },
      async signIn(email, password) {
        try { localStorage.removeItem(K.approved); } catch { /* ignore */ }
        const s = await inner.auth.signIn(email, password);
        if (s) write(K.user, { id: s.user.id, email: s.user.email });
        return s;
      },
      async signOut() {
        if (outbox().length) throw new Error('Some bills are still waiting to upload. Connect to the internet and let them upload before signing out.');
        try {
          for (const k of [K.user, K.approved, K.recent + 'bills', K.recent + 'bill_items']) localStorage.removeItem(k);
        } catch { /* ignore */ }
        await inner.auth.signOut();
      },
      onChange(cb) {
        return inner.auth.onChange((session) => {
          if (session) {
            write(K.user, { id: session.user.id, email: session.user.email });
            return cb(session);
          }
          const u = read(K.user, null);
          if (u && looksOffline()) return; // a failed token refresh while offline is not a sign-out
          cb(null);
        });
      },
    },
  };
}
