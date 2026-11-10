// Live database: Supabase (PostgreSQL). Same interface as localdb.js.
import { createClient } from '@supabase/supabase-js';

const PAGE = 1000; // Supabase returns at most 1000 rows per request

export function createSupaDb(url, key) {
  // Give up on a request after 12 seconds, so a bad connection falls back to offline billing quickly
  const fetchWithTimeout = (input, init = {}) => {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 12000);
    if (init.signal) init.signal.addEventListener('abort', () => ctl.abort());
    return fetch(input, { ...init, signal: ctl.signal }).finally(() => clearTimeout(t));
  };
  const sb = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true },
    global: { fetch: fetchWithTimeout },
  });

  const friendly = (msg) =>
    /fetch|network|load failed|abort/i.test(msg || '') ? 'Could not reach the database. Check the internet connection.' : msg || 'Database error';
  const check = ({ data, error }) => {
    if (error) throw new Error(friendly(error.message));
    return data;
  };

  function build(t, o) {
    let q = sb.from(t).select(o.select || '*');
    for (const [k, v] of Object.entries(o.eq || {})) q = q.eq(k, v);
    for (const [k, v] of Object.entries(o.neq || {})) q = q.neq(k, v);
    for (const [k, v] of Object.entries(o.gte || {})) q = q.gte(k, v);
    for (const [k, v] of Object.entries(o.lte || {})) q = q.lte(k, v);
    for (const [k, v] of Object.entries(o.lt || {})) q = q.lt(k, v);
    for (const [k, v] of Object.entries(o.in || {})) q = q.in(k, v);
    for (const [k, v] of Object.entries(o.like || {})) q = q.like(k, v);
    if (o.search && o.search.q) {
      const s = o.search.q.replace(/[,()%*\\]/g, ' ').trim();
      if (s) q = q.or(o.search.cols.map((c) => `${c}.ilike.*${s}*`).join(','));
    }
    // Always end with a unique column, so reading page by page never skips or repeats a row
    // (all lines of one bill share the same time)
    const noId = t === 'settings' || t === 'counters';
    if (o.order) q = q.order(o.order[0], { ascending: o.order[1] !== 'desc' });
    if (!noId && (!o.order || o.order[0] !== 'id')) q = q.order('id');
    else if (noId && !o.order) q = q.order('key');
    return q;
  }

  return {
    mode: 'cloud',
    client: sb,
    async list(t, o = {}) {
      if (o.limit && o.limit <= PAGE) return check(await build(t, o).limit(o.limit));
      const out = [];
      for (let from = 0; ; from += PAGE) {
        const rows = check(await build(t, o).range(from, from + PAGE - 1));
        out.push(...rows);
        if (rows.length < PAGE || (o.limit && out.length >= o.limit)) break;
      }
      return o.limit ? out.slice(0, o.limit) : out;
    },
    async get(t, id) {
      return check(await sb.from(t).select('*').eq('id', id).maybeSingle());
    },
    async insert(t, rows) {
      const data = check(await sb.from(t).insert(rows).select());
      return Array.isArray(rows) ? data : data[0];
    },
    async update(t, id, patch) {
      return check(await sb.from(t).update(patch).eq('id', id).select().single());
    },
    async upsert(t, row, onConflict) {
      return check(await sb.from(t).upsert(row, { onConflict }).select().single());
    },
    async remove(t, id) {
      check(await sb.from(t).delete().eq('id', id));
    },
    // Delete by other columns, e.g. { staff_id } for a table keyed by staff
    async removeWhere(t, match) {
      if (!match || !Object.keys(match).length) throw new Error('Nothing to delete');
      check(await sb.from(t).delete().match(match));
    },
    async rpc(name, args) {
      return check(await sb.rpc(name, args));
    },
    // Staff documents: private storage "staff-docs" (owner only, see 01_schema.sql)
    files: {
      async upload(path, blob) {
        return check(await sb.storage.from('staff-docs').upload(path, blob, { contentType: blob.type || 'application/octet-stream', upsert: false }));
      },
      async download(path) {
        return check(await sb.storage.from('staff-docs').download(path));
      },
      async remove(paths) {
        return check(await sb.storage.from('staff-docs').remove(paths));
      },
    },
    // WhatsApp bills: the whatsapp Edge Function sends the bill with its picture (WhatsApp Business Platform)
    async whatsapp(body) {
      const { data, error } = await sb.functions.invoke('whatsapp', { body });
      if (error) {
        let msg = error.message;
        try { const j = await error.context.json(); if (j && j.error) msg = j.error; } catch { /* keep the message */ }
        throw new Error(msg === 'Not allowed' ? 'This login is not approved, or the bill is not found' : msg);
      }
      return data;
    },
    // Telegram message to the owners (e.g. a product marked finished). Never holds up the app.
    async notify(action, id) {
      try { await sb.functions.invoke('login-approval', { body: { action, id } }); } catch { /* ignore */ }
      return null;
    },
    // ----- login approval (see "Login approval" in 01_schema.sql) -----
    async loginStatus() {
      return check(await sb.rpc('my_login_status'));
    },
    async requestLogin(device) {
      const st = check(await sb.rpc('request_login', { p_device: device }));
      if (st === 'pending') {
        // Telegram message to the owners. If Telegram isn't set up, owners can still approve in the app.
        try { await sb.functions.invoke('login-approval', { body: { action: 'notify' } }); } catch { /* ignore */ }
      }
      return st;
    },
    async listLogins() {
      return check(await sb.rpc('list_logins'));
    },
    async decideLogin(sessionId, approve) {
      return check(await sb.rpc('decide_login', { p_session: sessionId, p_approve: approve }));
    },
    // ----- owner approval (see "Owner approval" in 01_schema.sql) -----
    async ownerRequest({ action, ref, detail, device, amount }) {
      const g = check(await sb.rpc('request_owner_unlock', { p_action: action, p_ref: ref || null, p_detail: detail || '', p_device: device || '', p_amount: amount ?? null }));
      // Telegram message to the owners. Without Telegram, owners still see the request in the app on their phone.
      try { await sb.functions.invoke('login-approval', { body: { action: 'unlock', id: g.id } }); } catch { /* ignore */ }
      return g;
    },
    async ownerStatus(id) {
      return check(await sb.rpc('owner_grant_status', { p_id: id }));
    },
    async ownerCode({ code, detail, device }) {
      return check(await sb.rpc('owner_unlock_with_code', { p_code: code, p_detail: detail || '', p_device: device || '' }));
    },
    async ownerCurrent() {
      return check(await sb.rpc('current_owner_unlock'));
    },
    async ownerLock() {
      return check(await sb.rpc('owner_lock'));
    },
    async ownerTotpStatus() {
      return check(await sb.rpc('owner_totp_status'));
    },
    async ownerTotpSet(hex, code) {
      return check(await sb.rpc('owner_totp_set', { p_secret_hex: hex, p_code: code }));
    },
    async ownerTotpRemove() {
      return check(await sb.rpc('owner_totp_remove'));
    },
    async ownerList() {
      return check(await sb.rpc('list_owner_requests'));
    },
    async ownerDecide(id, approve) {
      return check(await sb.rpc('decide_owner_request', { p_id: id, p_approve: approve }));
    },
    // Can this device reach Supabase right now?
    async ping() {
      try {
        const r = await fetchWithTimeout(url + '/auth/v1/health', { headers: { apikey: key } });
        return r.ok;
      } catch {
        return false;
      }
    },
    auth: {
      async session() {
        const { data } = await sb.auth.getSession();
        return data.session;
      },
      async signIn(email, password) {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong email or password' : friendly(error.message));
        return data.session;
      },
      async signOut() {
        await sb.auth.signOut();
      },
      onChange(cb) {
        const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session));
        return () => data.subscription.unsubscribe();
      },
    },
  };
}
