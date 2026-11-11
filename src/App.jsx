import { useCallback, useEffect, useMemo, useState } from 'react';
import { ReceiptText, ListOrdered, Users, UserCog, Package, BarChart3, Settings as Cog, Lock, Unlock, CloudUpload, RefreshCw, ShieldCheck, CalendarDays, SunMoon } from 'lucide-react';
import { DisplayModal } from './components/DisplayModal';
import { AlertBars } from './components/Alerts';
import { db, getDb, IS_DEMO, subscribeSync, uploadNow, loginApi, ownerApi } from './lib/db';
import { waAutoOn } from './lib/waAuto';
import { deviceName, LoginList } from './components/Logins';
import { OwnerRequests } from './components/OwnerUnlock';
import { DEMO_OWNER_CODE } from './lib/totp';
import { rupee, fmtDateTime, istDay } from './lib/format';
import { AppProvider, useApp } from './store';
import { Loading, Field, Modal } from './components/ui';
import Billing from './pages/Billing';
import Appointments, { appointmentCounts } from './pages/Appointments';
import Bills from './pages/Bills';
import Customers from './pages/Customers';
import Staff, { staffCounts } from './pages/Staff';
import Inventory from './pages/Inventory';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

const PAGES = [
  ['bill', 'New bill', ReceiptText],
  ['appts', 'Bookings', CalendarDays],
  ['bills', 'Bills', ListOrdered],
  ['customers', 'Customers', Users],
  ['staff', 'Staff', UserCog],
  ['stock', 'Stock', Package],
  ['reports', 'Reports', BarChart3, true],
  ['settings', 'Settings', Cog, true],
];

// On phones, tables with className "rtable" show as cards. Each cell gets its column name
// from the table header, so the card can say "Mobile  98300 12345".
if (typeof window !== 'undefined' && typeof MutationObserver !== 'undefined') {
  let raf = 0;
  const label = () => {
    document.querySelectorAll('table.rtable').forEach((t) => {
      const heads = [...t.querySelectorAll('thead th')].map((th) => th.textContent.trim());
      t.querySelectorAll('tbody tr').forEach((tr) => {
        [...tr.children].forEach((td, i) => {
          const l = heads[i] || '';
          if (td.getAttribute('data-label') !== l) td.setAttribute('data-label', l);
        });
      });
    });
  };
  new MutationObserver(() => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(label);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

export default function App() {
  const [session, setSession] = useState(undefined);
  useEffect(() => {
    let off = () => {};
    getDb().then(async (d) => {
      setSession(await d.auth.session());
      off = d.auth.onChange((s) => setSession(s));
    });
    return () => off();
  }, []);

  if (session === undefined) return <Loading />;
  if (!session) return <Login />;
  const signOut = async () => (await getDb()).auth.signOut();
  return (
    <LoginGate session={session} onSignOut={signOut}>
      {(role) => (
        <AppProvider user={session.user} role={role}>
          <Shell onSignOut={signOut} />
        </AppProvider>
      )}
    </LoginGate>
  );
}

// A staff login stays here until an owner approves it (Telegram or the Logins screen).
// Owners go straight in. The database itself blocks unapproved logins, this screen just explains it.
function LoginGate({ session, onSignOut, children }) {
  const [st, setSt] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const code = useMemo(() => {
    try {
      const p = session.access_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).session_id.slice(0, 4).toUpperCase();
    } catch {
      return '';
    }
  }, [session.access_token]);

  const check = useCallback(async () => {
    try {
      let s = await loginApi.status();
      if (s === 'none') s = await loginApi.request(deviceName());
      setSt(s);
      setErr('');
    } catch (e) {
      setErr(e.message);
      setSt((x) => x || 'error');
    }
  }, []);

  useEffect(() => { check(); }, [check, session.user && session.user.id]);
  useEffect(() => {
    // While waiting: check every 3 seconds. Once approved: every minute, in case the owner removes access.
    const ms = st === 'pending' ? 3000 : st === 'approved' ? 60000 : st === 'offline' ? 15000 : 0;
    if (!ms) return;
    const t = setInterval(check, ms);
    return () => clearInterval(t);
  }, [st, check]);

  const signOut = async () => {
    setBusy(true);
    try { await onSignOut(); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  if (st === 'owner' || st === 'approved') return children(st === 'owner' ? 'owner' : 'staff');
  if (st === null) return <Loading />;

  const who = session.user && session.user.email;
  const screens = {
    pending: ['Waiting for the owner to approve', 'The owner got a message on Telegram. This screen opens by itself as soon as they approve.'],
    denied: ['This login was not approved', 'The owner did not allow this login, or removed it. Ask the owner, then sign in again.'],
    offline: ['No internet', "This login hasn't been approved on this device yet, so it needs internet once to ask the owner."],
    error: ['Could not check this login', err],
  };
  const [title, text] = screens[st] || screens.error;
  return (
    <div className="login">
      <div className="card stack loose" style={{ textAlign: 'center' }}>
        <div className="brand" style={{ alignItems: 'center' }}><b>HABIBS</b><span>Fuljhore · Billing</span></div>
        <ShieldCheck size={34} style={{ margin: '0 auto', color: st === 'denied' ? 'var(--bad)' : 'var(--red)' }} />
        <h2 style={{ fontSize: 20 }}>{title}</h2>
        <p className="muted">{text}</p>
        {st === 'pending' && code && (
          <div>
            <div className="eyebrow">Code to match</div>
            <div style={{ fontSize: 34, letterSpacing: '.2em', fontWeight: 600 }}>{code}</div>
          </div>
        )}
        {st === 'pending' && <div className="spinner" style={{ margin: '0 auto' }} />}
        {(st === 'offline' || st === 'error') && <button className="btn primary" onClick={check}>Try again</button>}
        {err && st !== 'error' && <p className="err-text">{err}</p>}
        <p className="small muted">Signed in as {who}</p>
        <button className="btn line" disabled={busy} onClick={signOut}>Use a different login</button>
      </div>
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await (await getDb()).auth.signIn(email.trim(), password);
    } catch (x) {
      setErr(navigator.onLine ? x.message : 'No internet connection.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="login">
      <form className="card stack loose" onSubmit={submit}>
        <div className="brand" style={{ alignItems: 'center' }}><b>HABIBS</b><span>Fuljhore · Billing</span></div>
        <Field label="Email"><input className="input" id="login-email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></Field>
        <Field label="Password"><input className="input" id="login-pass" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        {err && <p className="err-text">{err}</p>}
        <button className="btn primary block lg" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function Shell({ onSignOut }) {
  const { settings, loadError, reloadAll, isOwner, askOwner, lockOwner } = useApp();
  const [page, setPage] = useState('bill');
  const [sync, setSync] = useState({ online: navigator.onLine, pending: 0, failed: 0, entries: [] });
  const [showOutbox, setShowOutbox] = useState(false);
  const [waiting, setWaiting] = useState({ logins: 0, owner: 0 });
  const [showLogins, setShowLogins] = useState(false);
  const [showDisplay, setShowDisplay] = useState(false);
  const { role } = useApp();

  // Owners see a button when a staff login, or a request from the counter, is waiting for them
  const loadWaiting = useCallback(async () => {
    const fresh = (r) => Date.now() - new Date(r.created_at).getTime() < 15 * 60000;
    const [l, o] = await Promise.all([
      loginApi.list().then((r) => r.filter((x) => x.status === 'pending').length).catch(() => 0),
      ownerApi.list().then((r) => r.filter((x) => x.status === 'pending' && fresh(x)).length).catch(() => 0),
    ]);
    setWaiting({ logins: l, owner: o });
  }, []);
  useEffect(() => {
    if (role !== 'owner' || IS_DEMO) return;
    loadWaiting();
    const t = setInterval(loadWaiting, 10000);
    return () => clearInterval(t);
  }, [role, loadWaiting]);
  const waitingTotal = waiting.logins + waiting.owner;
  // New booking requests (website, Instagram) and enquiries waiting: a number on Appointments
  const [appts, setAppts] = useState(0);
  // Leave waiting for the owner: a number on Staff
  const [staffWait, setStaffWait] = useState(0);
  useEffect(() => {
    const get = () => {
      if (!navigator.onLine) return;
      appointmentCounts().then(setAppts).catch(() => {});
      staffCounts().then((c) => setStaffWait(c.leave)).catch(() => {});
    };
    get();
    const t = setInterval(get, 60000);
    return () => clearInterval(t);
  }, [page]);
  // The morning message to the owners on Telegram (leave today and tomorrow, leave waiting, bookings, who didn't
  // check in yesterday): the first time the app is opened each day. The database sends it once a day, whichever device asks.
  useEffect(() => {
    const day = istDay();
    let sent = '';
    try { sent = localStorage.getItem('pos-day-note') || ''; } catch { /* ignore */ }
    if (sent === day || IS_DEMO) return;
    const t = setTimeout(() => {
      if (!navigator.onLine) return;
      getDb().then((d) => (d.notify ? d.notify('day') : null)).catch(() => null);
      try { localStorage.setItem('pos-day-note', day); } catch { /* ignore */ }
    }, 5000);
    return () => clearTimeout(t);
  }, [page]);
  // The automatic WhatsApp messages (feedback after a visit, booking reminders, "we miss you"): while the app is open
  // it asks the whatsapp function every 20 minutes to send what is due. The database decides who is due and sends each
  // once, whichever device asks. (With supabase/05_daily_schedule.sql they also go with the app closed.)
  const autoOn = waAutoOn(settings);
  useEffect(() => {
    if (!autoOn) return undefined;
    const run = () => { if (navigator.onLine) db.whatsapp({ action: 'auto' }).catch(() => null); };
    // (the demo sends nothing: it only shows what would go, a little sooner)
    const first = setTimeout(run, IS_DEMO ? 2000 : 15000);
    const t = setInterval(run, IS_DEMO ? 60000 : 20 * 60000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [autoOn]);
  const [update, setUpdate] = useState(null);
  const online = sync.online;

  useEffect(() => subscribeSync(setSync), []);

  // A new version of the app was deployed: offer a refresh instead of reloading in the middle of a bill
  useEffect(() => {
    const on = () => setUpdate(() => window.__posUpdate);
    window.addEventListener('pos-update', on);
    if (window.__posUpdate && window.__posUpdateReady) on();
    return () => window.removeEventListener('pos-update', on);
  }, []);

  // Owner-only pages lock again when the 10 minutes are over
  useEffect(() => {
    const p = PAGES.find((x) => x[0] === page);
    if (p && p[3] && !isOwner) setPage('bill');
  }, [isOwner, page]);

  const go = async (key, ownerOnly) => {
    if (ownerOnly && !(await askOwner('This page is for the owner only.'))) return;
    setPage(key);
    window.scrollTo(0, 0);
    document.querySelector('.main')?.scrollTo(0, 0);
  };

  if (loadError) {
    return (
      <div className="login">
        <div className="card stack" style={{ maxWidth: 420 }}>
          <h2>Could not load the salon data</h2>
          <p className="muted">{loadError}</p>
          <button className="btn primary" onClick={reloadAll}>Try again</button>
        </div>
      </div>
    );
  }
  if (!settings) return <Loading />;

  const banner = IS_DEMO || !online;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><b>HABIBS</b><span>{(settings.branch || 'Fuljhore').split(',')[0]} · Billing</span></div>
        <nav className="nav" aria-label="Main">
          {PAGES.map(([key, label, Icon, ownerOnly]) => (
            <button key={key} className={page === key ? 'on' : ''} aria-current={page === key ? 'page' : undefined} onClick={() => go(key, ownerOnly)}>
              <Icon size={17} /> {label} {ownerOnly && !isOwner && <Lock size={11} className="lock" />}
              {key === 'appts' && appts > 0 && <span className="nav-badge" aria-label={`${appts} waiting`}>{appts}</span>}
              {key === 'staff' && staffWait > 0 && <span className="nav-badge" aria-label={`${staffWait} leave waiting`}>{staffWait}</span>}
            </button>
          ))}
        </nav>
        <div className="top-right">
          {update && <button className="btn line sm" onClick={() => update(true)} title="A new version is ready"><RefreshCw size={14} /><span className="btn-label">Update</span></button>}
          {waitingTotal > 0 && (
            <button className="btn primary sm" onClick={() => setShowLogins(true)} title="Waiting for your approval">
              <ShieldCheck size={14} /> {waitingTotal}<span className="btn-label">to approve</span>
            </button>
          )}
          {sync.pending > 0 && (
            <button className={'btn sm ' + (sync.failed ? 'danger' : 'line')} onClick={() => setShowOutbox(true)} title="Bills saved on this device">
              <CloudUpload size={14} /> {sync.pending}<span className="btn-label">to upload</span>
            </button>
          )}
          <span className={'netdot' + (online ? '' : ' off')} title={online ? 'Online' : 'Offline'}><i /><span>{online ? 'Online' : 'Offline'}</span></span>
          <button className="btn ghost sm" id="display-btn" onClick={() => setShowDisplay(true)} title="Dark mode and text size" aria-label="Display: dark mode and text size"><SunMoon size={16} /><span className="btn-label">Display</span></button>
          {isOwner ? (
            <button className="btn line sm" onClick={lockOwner} title="Lock owner pages" aria-label="Lock owner pages"><Unlock size={14} /><span className="btn-label">Owner</span></button>
          ) : (
            <button className="btn ghost sm" onClick={() => askOwner()} title="Unlock owner pages" aria-label="Unlock owner pages"><Lock size={14} /><span className="btn-label">Owner</span></button>
          )}
        </div>
      </header>
      {IS_DEMO && (
        <div className="banner demo">
          Demo with sample data. It is saved only in this browser.
          <button onClick={() => go('settings', true)}>Reset or connect a real database</button>
          <span>· Owner code: {DEMO_OWNER_CODE}</span>
        </div>
      )}
      {!online && !IS_DEMO && (
        <div className="banner off">
          No internet. Keep billing: bills are saved on this device and upload by themselves when the connection is back.
          {page !== 'bill' && page !== 'bills' && page !== 'customers' && <b>This page needs internet.</b>}
        </div>
      )}
      {online && <AlertBars onOpenBills={() => go('bills')} />}
      <main className="main">
        {page === 'bill' && <Billing hasBanner={banner} />}
        {page === 'appts' && <Appointments onOpenBill={() => go('bill')} onCounts={setAppts} />}
        {page === 'bills' && <Bills />}
        {page === 'customers' && <Customers />}
        {page === 'staff' && <Staff onCounts={(c) => setStaffWait(c.leave)} />}
        {page === 'stock' && <Inventory />}
        {page === 'reports' && <Reports />}
        {page === 'settings' && <Settings onSignOut={onSignOut} />}
      </main>
      {showOutbox && <Outbox sync={sync} onClose={() => setShowOutbox(false)} />}
      {showDisplay && <DisplayModal onClose={() => setShowDisplay(false)} />}
      {showLogins && (
        <Modal wide title="Waiting for your approval" onClose={() => setShowLogins(false)}>
          <div className="stack">
            {waiting.owner > 0 && <><div className="eyebrow">From the counter</div><OwnerRequests onlyPending onChange={loadWaiting} /></>}
            {waiting.logins > 0 && <><div className="eyebrow">New logins</div><LoginList onlyPending onChange={loadWaiting} /></>}
            {waitingTotal === 0 && <p className="muted">Nothing waiting.</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// Bills saved on this device that have not reached the database yet
function Outbox({ sync, onClose }) {
  const [busy, setBusy] = useState(false);
  const total = sync.entries.reduce((a, e) => a + Number(e.bill.total), 0);
  return (
    <Modal
      title="Bills waiting to upload"
      onClose={onClose}
      foot={
        <>
          <button className="btn line" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={!sync.online || busy || sync.flushing} onClick={async () => { setBusy(true); await uploadNow(); setBusy(false); }}>
            <CloudUpload size={15} /> {sync.flushing || busy ? 'Uploading…' : 'Upload now'}
          </button>
        </>
      }
    >
      <div className="stack">
        <p className="small muted">
          These {sync.pending} bills ({rupee(total)}) were made without internet. They are safe on this device and upload by themselves every 30 seconds once the connection is back.
          Don't clear the browser data or sign out until this list is empty.
        </p>
        {!sync.online && <p className="small strong" style={{ color: 'var(--bad)' }}>Still offline.</p>}
        <div className="card table-wrap">
          <table>
            <tbody>
              {sync.entries.map((e) => (
                <tr key={e.id}>
                  <td className="nowrap">{e.bill_no}</td>
                  <td className="small">{fmtDateTime(e.created_at)}<div className="tiny muted">{e.bill.customer_name || 'Walk-in'}</div></td>
                  <td className="r strong">{rupee(e.bill.total)}</td>
                  <td className="small" style={{ color: e.error ? 'var(--bad)' : 'var(--muted)' }}>{e.error ? 'Problem: ' + e.error : 'Waiting'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
