import { useCallback, useEffect, useState } from 'react';
import { db, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { failedBills, backupAlert, newWebsiteItems } from '../lib/alerts';
import { Modal } from './ui';
import { fmtPhone } from '../lib/format';

// ---- New from the website: a popup with a sound on every device, until someone taps Seen ----
const SEEN_KEY = 'pos-web-seen';
let seenMemory = null;   // when the browser keeps nothing (private window)
const readSeen = () => { try { const v = localStorage.getItem(SEEN_KEY); return v ? JSON.parse(v) : seenMemory; } catch { return seenMemory; } };
const saveSeen = (ids) => { seenMemory = ids.slice(-300); try { localStorage.setItem(SEEN_KEY, JSON.stringify(seenMemory)); } catch { /* memory only */ } };
function chime() {
  try {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return;
    const ctx = new A();
    [[880, 0], [1320, 0.18], [880, 0.5], [1320, 0.68]].forEach(([f, t]) => {
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.frequency.value = f; o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.16);
      o.connect(g); g.connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.2);
    });
    setTimeout(() => ctx.close().catch(() => {}), 1500);
  } catch { /* no sound */ }
}
const dayOf = (d) => (d ? new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' }) : '');

export function WebsitePopup({ onOpen }) {
  const [items, setItems] = useState([]);
  const check = useCallback(async () => {
    if (!navigator.onLine) return;
    try {
      const since = new Date(Date.now() - 86400000).toISOString();
      const [bookings, enquiries] = await Promise.all([
        db.list('bookings', { eq: { source: 'website' }, gte: { created_at: since } }),
        db.list('enquiries', { eq: { source: 'website' }, gte: { created_at: since } }),
      ]);
      const seen = readSeen();
      if (!seen) { saveSeen([...bookings, ...enquiries].map((r) => r.id)); return; }   // first time on this device
      const fresh = newWebsiteItems({ bookings, enquiries }, seen);
      if (!fresh.length) return;
      const ids = fresh.filter((x) => x.kind === 'booking').map((x) => x.id);
      const lines = ids.length ? await db.list('booking_items', { in: { booking_id: ids } }).catch(() => []) : [];
      setItems((prev) => {
        const have = new Set(prev.map((x) => x.id));
        const add = fresh.filter((x) => !have.has(x.id)).map((x) => ({ ...x, lines: lines.filter((l) => l.booking_id === x.id) }));
        if (add.length) chime();
        return [...prev, ...add];
      });
    } catch { /* try again next time */ }
  }, []);
  useEffect(() => {
    const first = setTimeout(check, 3000);
    const t = setInterval(check, 30000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [check]);
  if (!items.length) return null;
  const seenAll = () => { saveSeen([...(readSeen() || []), ...items.map((x) => x.id)]); setItems([]); };
  const nB = items.filter((x) => x.kind === 'booking').length, nE = items.length - nB;
  const title = [nB ? `${nB} new booking ${nB === 1 ? 'request' : 'requests'}` : '', nE ? `${nE} new ${nE === 1 ? 'question' : 'questions'}` : ''].filter(Boolean).join(' and ') + ' from the website';
  return (
    <Modal title={title} onClose={seenAll}
      foot={<><button className="btn line" onClick={seenAll}>Seen</button>
        <button className="btn primary" id="web-open" onClick={() => { const tab = nB ? 'req' : 'enq'; seenAll(); onOpen(tab); }}>Open {nB ? 'requests' : 'enquiries'}</button></>}>
      <div className="stack" id="web-popup">
        {items.map(({ id, kind, row, lines }) => (
          <div key={id} className="card stack tight">
            <div className="row between wrap">
              <b>{row.name || 'No name'} · <a href={'tel:+91' + row.phone}>{fmtPhone(row.phone)}</a></b>
              <span className={'pill ' + (kind === 'booking' ? 'warn' : '')}>{kind === 'booking' ? 'Booking request' : 'Question'}</span>
            </div>
            {kind === 'booking' ? (
              <>
                <div className="small">Wants: <b>{dayOf(row.want_date) || 'any day'}{row.want_time ? `, ${row.want_time}` : ''}</b></div>
                {lines.length > 0 && <div className="small">{lines.map((l) => l.name + (l.option_label ? ` (${l.option_label})` : '')).join(', ')}</div>}
                {row.note && <div className="small muted">"{row.note}"</div>}
              </>
            ) : <div className="small">"{row.message || ''}"</div>}
          </div>
        ))}
        <p className="tiny muted" style={{ margin: 0 }}>Call or WhatsApp them, then confirm the booking with a time in Bookings → Requests.</p>
      </div>
    </Modal>
  );
}

const DISMISS_KEY = 'pos-wa-dismissed';
const readDismissed = () => { try { return JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); } catch { return []; } };
const saveDismissed = (ids) => { try { localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-100))); } catch { /* ignore */ } };

// The automatic backups: what the database says, and "I downloaded it" (owner only). Used by the bar and Settings.
export function useBackupStatus(on) {
  const [status, setStatus] = useState(null);
  const load = useCallback(() => {
    if (!on || IS_DEMO || !navigator.onLine) return;
    db.rpc('backup_alert', {}).then(setStatus).catch(() => setStatus(null));
  }, [on]);
  useEffect(() => {
    load();
    const t = setInterval(load, 30 * 60000);
    return () => clearInterval(t);
  }, [load]);
  const markDownloaded = async () => {
    if (!status || !status.latest) return;
    await db.rpc('mark_backup_downloaded', { p_id: status.latest.id });
    load();
  };
  return { status, load, markDownloaded };
}

// The bars under the top bar: bills not delivered on WhatsApp (everyone), backups to download (the owner)
export function AlertBars({ onOpenBills }) {
  const { isOwner, toast } = useApp();
  const [failed, setFailed] = useState([]);
  const { status, markDownloaded } = useBackupStatus(isOwner);

  const loadFailed = useCallback(() => {
    if (IS_DEMO || !navigator.onLine) return;
    const since = new Date(Date.now() - 86400000).toISOString();
    db.list('wa_messages', { eq: { kind: 'bill' }, gte: { created_at: since } })
      .then((rows) => setFailed(failedBills(rows, { dismissed: readDismissed() })))
      .catch(() => {});
  }, []);
  useEffect(() => {
    loadFailed();
    const t = setInterval(loadFailed, 2 * 60000);
    return () => clearInterval(t);
  }, [loadFailed]);

  const bk = backupAlert(status);
  return (
    <>
      {failed.length > 0 && (
        <div className="banner off" id="alert-wa-failed" role="status">
          {failed.length === 1 ? 'A bill' : `${failed.length} bills`} didn't reach the customer on WhatsApp{failed[0].error ? ` (${failed[0].error})` : ''}.
          <button onClick={onOpenBills}>Open Bills to send {failed.length === 1 ? 'it' : 'them'} the other way</button>
          <button onClick={() => { saveDismissed([...readDismissed(), ...failed.map((f) => f.id)]); setFailed([]); }}>Done</button>
        </div>
      )}
      {bk && (
        <div className={'banner ' + (bk.level === 'bad' ? 'off' : 'demo')} id="alert-backup" role="status">
          {bk.text}
          {status.latest.run_url && <a href={status.latest.run_url} target="_blank" rel="noreferrer">Open the newest backup</a>}
          <button onClick={async () => { try { await markDownloaded(); toast('Thanks. The next reminder is in a week.', 'ok'); } catch (e) { toast(e.message, 'bad'); } }}>I downloaded it</button>
        </div>
      )}
    </>
  );
}
