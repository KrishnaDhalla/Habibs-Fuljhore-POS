import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { db, ownerApi, IS_DEMO } from './lib/db';
import { OwnerUnlock } from './components/OwnerUnlock';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);


export function AppProvider({ children, user, role = 'owner' }) {
  const [settings, setSettings] = useState(null);
  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [staff, setStaff] = useState([]);
  const [products, setProducts] = useState([]);
  const [offers, setOffers] = useState([]);
  const [loadError, setLoadError] = useState('');
  const [toastMsg, setToastMsg] = useState(null);
  // Owner unlock: an owner login is unlocked; the counter needs the owner's approval (Telegram or code)
  const ownerLogin = !IS_DEMO && role === 'owner';
  // method: 'owner' (owner login), 'code' (Authenticator code typed at the counter), or 'telegram' / 'app'
  const [unlock, setUnlock] = useState({ until: ownerLogin ? Infinity : 0, grantId: '', method: ownerLogin ? 'owner' : '' });
  const [ownerAsk, setOwnerAsk] = useState(null);
  const [, tick] = useState(0);
  const toastTimer = useRef();

  const toast = useCallback((text, kind = '') => {
    clearTimeout(toastTimer.current);
    setToastMsg({ text, kind });
    toastTimer.current = setTimeout(() => setToastMsg(null), kind === 'bad' ? 5000 : 2600);
  }, []);

  const loadSettings = useCallback(async () => {
    const rows = await db.list('settings', { order: ['key', 'asc'] });
    setSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  }, []);
  const loadServices = useCallback(async () => setServices(await db.list('services', { order: ['sort', 'asc'] })), []);
  // Categories hold the website fields; an older database without the table still opens
  const loadCategories = useCallback(async () => setCategories(await db.list('service_categories', { order: ['sort', 'asc'] }).catch(() => [])), []);
  const loadStaff = useCallback(async () => setStaff(await db.list('staff', { order: ['name', 'asc'] })), []);
  const loadProducts = useCallback(async () => setProducts(await db.list('products', { order: ['name', 'asc'] })), []);
  // Offers are optional: an older database without the offers table still opens
  const loadOffers = useCallback(async () => setOffers(await db.list('offers', { order: ['created_at', 'asc'] }).catch(() => [])), []);

  const reloadAll = useCallback(async () => {
    try {
      setLoadError('');
      await Promise.all([loadSettings(), loadServices(), loadCategories(), loadStaff(), loadProducts(), loadOffers()]);
    } catch (e) {
      setLoadError(e.message || 'Could not load data');
    }
  }, [loadSettings, loadServices, loadCategories, loadStaff, loadProducts, loadOffers]);

  useEffect(() => { reloadAll(); }, [reloadAll]);

  const saveSetting = useCallback(async (key, value) => {
    await db.upsert('settings', { key, value, updated_at: new Date().toISOString() }, 'key');
    setSettings((s) => ({ ...s, [key]: value }));
  }, []);

  // Locks again by itself when the 10 minutes are over
  useEffect(() => {
    if (!unlock.until || !Number.isFinite(unlock.until)) return;
    const t = setTimeout(() => tick((x) => x + 1), Math.max(0, unlock.until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [unlock.until]);
  // Still unlocked from before a page reload?
  useEffect(() => {
    if (ownerLogin) return;
    ownerApi.current().then((g) => {
      if (g && g.id && g.expires_at) setUnlock({ until: new Date(g.expires_at).getTime(), grantId: g.id, method: g.method || '' });
    }).catch(() => {});
  }, [ownerLogin]);
  const isOwner = unlock.until > Date.now();

  // askOwner(reason, { action, ref, detail, amount, fresh }) → the approval id (or true), or false if not approved.
  //   action 'unlock' (default): owner screens for 10 minutes.
  //   action 'cancel' / 'discount' / 'stock' / 'service': only that one thing (Telegram); the code always unlocks for 10 minutes.
  //   fresh: ask even while the owner screens are unlocked, unless the owner is here (owner login, or unlocked with the code).
  //   Used for price and menu changes, so the owner sees every one of them.
  //   codeOnly: only the owner in person: an owner login, or the owner's code here (no Telegram). Adding services and
  //   categories. (Past bills too until 13 Nov 2026: now Telegram is enough for them.)
  const ownerHere = unlock.until > Date.now() && (unlock.method === 'owner' || unlock.method === 'code');
  const askOwner = useCallback(
    (reason, opts = {}) => {
      if (unlock.until > Date.now() && ((!opts.fresh && !opts.codeOnly) || unlock.method === 'owner' || unlock.method === 'code')) return Promise.resolve(unlock.grantId || true);
      return new Promise((resolve) => setOwnerAsk({ reason, ...opts, resolve }));
    },
    [unlock]
  );
  const lockOwner = useCallback(() => {
    setUnlock({ until: 0, grantId: '', method: '' });
    ownerApi.lock().catch(() => {}); // also on the database, so a reload doesn't unlock again
  }, []);
  const ownerApproved = (g) => {
    if (g.action === 'unlock') {
      // 10 minutes from now on this device's clock
      const ms = Math.max(60000, new Date(g.expires_at).getTime() - new Date(g.decided_at || g.created_at).getTime());
      setUnlock({ until: Date.now() + ms, grantId: g.id, method: g.method || '' });
    }
    ownerAsk.resolve(g.id);
    setOwnerAsk(null);
  };

  const value = useMemo(
    () => ({
      user, role, settings, services, categories, staff, products, offers, loadError,
      reloadAll, loadSettings, loadServices, loadCategories, loadStaff, loadProducts, loadOffers, saveSetting,
      toast, isOwner, ownerHere, askOwner, lockOwner, ownerLogin,
      gstOn: !!(settings && settings.gstin),
    }),
    [user, role, settings, services, categories, staff, products, offers, loadError, reloadAll, loadSettings, loadServices, loadCategories, loadStaff, loadProducts, loadOffers, saveSetting, toast, isOwner, ownerHere, askOwner, lockOwner, ownerLogin]
  );

  return (
    <Ctx.Provider value={value}>
      {children}
      {ownerAsk && (
        <OwnerUnlock
          ask={ownerAsk}
          onApproved={ownerApproved}
          onClose={() => {
            ownerAsk.resolve(false);
            setOwnerAsk(null);
          }}
        />
      )}
      {toastMsg && <div className={'toast ' + toastMsg.kind} role="status">{toastMsg.text}</div>}
    </Ctx.Provider>
  );
}
