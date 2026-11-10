// Picks the database.
//  - VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY set in .env  → live Supabase database (needs login),
//    with offline billing on top (see offline.js)
//  - not set                                                    → demo mode, data stays in this browser
//  - VITE_FAKE_CLOUD=1 (developer testing only)                 → demo data behind the offline layer, so
//    offline billing can be tried without Supabase: switch the browser to offline in DevTools
const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const FAKE_CLOUD = import.meta.env.VITE_FAKE_CLOUD === '1';

export const IS_DEMO = !(URL && KEY) && !FAKE_CLOUD;

// Demo data that behaves like a server that can't be reached when the browser is offline
function fakeNetwork(inner) {
  const net = (fn) => async (...a) => {
    if (!navigator.onLine) throw new Error('Failed to fetch');
    return fn(...a);
  };
  return {
    ...inner,
    mode: 'cloud',
    list: net(inner.list), get: net(inner.get), insert: net(inner.insert), update: net(inner.update),
    upsert: net(inner.upsert), remove: net(inner.remove), removeWhere: net(inner.removeWhere),
    // Testing: localStorage "fake-drop-reply" = 1 saves the next bill but loses the reply, like a dropped connection
    rpc: async (...a) => {
      const r = await net(inner.rpc)(...a);
      if (localStorage.getItem('fake-drop-reply') === '1') {
        localStorage.removeItem('fake-drop-reply');
        throw new Error('Failed to fetch');
      }
      return r;
    },
    ping: async () => navigator.onLine,
    files: { upload: net(inner.files.upload), download: net(inner.files.download), remove: net(inner.files.remove) },
    notify: async () => null,
    whatsapp: net(inner.whatsapp),
    loginStatus: net(inner.loginStatus), requestLogin: net(inner.requestLogin),
    listLogins: net(inner.listLogins), decideLogin: net(inner.decideLogin),
    ...Object.fromEntries(['ownerRequest', 'ownerStatus', 'ownerCode', 'ownerCurrent', 'ownerLock', 'ownerTotpStatus', 'ownerTotpSet', 'ownerTotpRemove', 'ownerList', 'ownerDecide']
      .map((k) => [k, net(inner[k])])),
  };
}

let ready;
export function getDb() {
  if (!ready) {
    if (IS_DEMO) ready = import('./localdb.js').then((m) => m.createLocalDb());
    else if (FAKE_CLOUD) ready = Promise.all([import('./localdb.js'), import('./offline.js')]).then(([l, o]) => o.withOffline(fakeNetwork(l.createLocalDb())));
    else ready = Promise.all([import('./supadb.js'), import('./offline.js')]).then(([s, o]) => o.withOffline(s.createSupaDb(URL, KEY)));
  }
  return ready;
}

const call = (fn) => (...args) => getDb().then((d) => d[fn](...args));

export const db = {
  list: call('list'),
  get: call('get'),
  insert: call('insert'),
  update: call('update'),
  upsert: call('upsert'),
  remove: call('remove'),
  removeWhere: call('removeWhere'),
  rpc: call('rpc'),
  // Staff documents (owner only): upload(path, blob), download(path) → Blob, remove([paths])
  files: {
    upload: (path, blob) => getDb().then((d) => d.files.upload(path, blob)),
    download: (path) => getDb().then((d) => d.files.download(path)),
    remove: (paths) => getDb().then((d) => d.files.remove(paths)),
  },
  // Telegram message to the owners about something just saved ('finished' product). Best effort: never throws.
  notify: (action, id) => getDb().then((d) => (d.notify ? d.notify(action, id) : null)).catch(() => null),
  // WhatsApp bills (WhatsApp Business Platform, the whatsapp Edge Function): { action: 'bill', id, image, again } or { action: 'status' }
  whatsapp: (body) => getDb().then((d) => {
    if (!d.whatsapp) throw new Error('WhatsApp is not available here');
    return d.whatsapp(body);
  }),
};

// Offline status: { online, pending, failed, entries, flushing }. Demo mode is always "online".
export function subscribeSync(cb) {
  let off = null;
  let dead = false;
  getDb().then((d) => {
    if (dead) return;
    if (d.subscribe) off = d.subscribe(cb);
    else cb({ online: true, pending: 0, failed: 0, entries: [], flushing: false });
  });
  return () => {
    dead = true;
    if (off) off();
  };
}

export const uploadNow = () => getDb().then((d) => d.flush && d.flush());

// Login approval: 'owner' | 'approved' | 'pending' | 'denied' | 'none' | 'offline'
export const loginApi = {
  status: () => getDb().then((d) => d.loginStatus()),
  request: (device) => getDb().then((d) => d.requestLogin(device)),
  list: () => getDb().then((d) => d.listLogins()),
  decide: (id, approve) => getDb().then((d) => d.decideLogin(id, approve)),
};

// Owner approval (Telegram / Authenticator code). See "Owner approval" in 01_schema.sql.
export const ownerApi = {
  request: (a) => getDb().then((d) => d.ownerRequest(a)),
  status: (id) => getDb().then((d) => d.ownerStatus(id)),
  code: (a) => getDb().then((d) => d.ownerCode(a)),
  current: () => getDb().then((d) => d.ownerCurrent()),
  lock: () => getDb().then((d) => d.ownerLock()),
  totpStatus: () => getDb().then((d) => d.ownerTotpStatus()),
  totpSet: (hex, code) => getDb().then((d) => d.ownerTotpSet(hex, code)),
  totpRemove: () => getDb().then((d) => d.ownerTotpRemove()),
  list: () => getDb().then((d) => d.ownerList()),
  decide: (id, approve) => getDb().then((d) => d.ownerDecide(id, approve)),
};
