import { useCallback, useEffect, useState } from 'react';
import { db, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { failedBills, backupAlert } from '../lib/alerts';

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
