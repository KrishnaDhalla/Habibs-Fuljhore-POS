import { useCallback, useEffect, useState } from 'react';
import { Check, X, ShieldCheck } from 'lucide-react';
import { loginApi } from '../lib/db';
import { useApp } from '../store';
import { fmtDateTime } from '../lib/format';
import { Empty, Loading } from './ui';

const PILL = { pending: ['warn', 'Waiting'], approved: ['ok', 'Approved'], denied: ['bad', 'Denied'] };

// Short readable label for the device that is signing in
export function deviceName() {
  const ua = navigator.userAgent;
  const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const os = ipad ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
    : /Windows/.test(ua) ? 'Windows PC' : /Mac/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux PC' : 'Device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /CriOS|Chrome\//.test(ua) ? 'Chrome' : /FxiOS|Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const app = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches ? ', home screen app' : '';
  return `${os} · ${browser}${app}`;
}

// The owner's list of logins, with Approve / Deny / Remove access
export function LoginList({ onlyPending = false, onChange }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await loginApi.list());
    } catch (e) {
      toast(e.message, 'bad');
      setRows([]);
    }
  }, [toast]);
  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const decide = async (r, approve) => {
    setBusy(r.session_id);
    try {
      await loginApi.decide(r.session_id, approve);
      toast(approve ? `Approved ${r.email}` : `${r.email} can no longer use this login`, approve ? 'ok' : '');
      await load();
      onChange && onChange();
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy('');
    }
  };

  if (rows === null) return <Loading />;
  const list = onlyPending ? rows.filter((r) => r.status === 'pending') : rows;
  if (!list.length) return <Empty title={onlyPending ? 'No logins waiting' : 'No staff logins yet'}>Staff logins show up here when someone signs in.</Empty>;

  return (
    <div className="login-list">
      {list.map((r) => (
        <div className="login-row" key={r.session_id}>
          <div className="grow">
            <div className="strong" style={{ overflowWrap: 'anywhere' }}>{r.email}</div>
            <div className="tiny muted">{r.device} · code {r.session_id.slice(0, 4).toUpperCase()}</div>
            <div className="tiny muted">
              {fmtDateTime(r.created_at)}
              {r.decided_by ? ` · ${PILL[r.status][1]} by ${r.decided_by}` : ''}
            </div>
          </div>
          <span className={'pill ' + PILL[r.status][0]}>{PILL[r.status][1]}</span>
          <div className="row login-actions">
            {r.status === 'pending' && (
              <>
                <button className="btn primary sm" disabled={busy === r.session_id} onClick={() => decide(r, true)}><Check size={15} /> Approve</button>
                <button className="btn danger sm" disabled={busy === r.session_id} onClick={() => decide(r, false)}><X size={15} /> Deny</button>
              </>
            )}
            {r.status === 'approved' && (
              <button className="btn line sm" disabled={busy === r.session_id} onClick={() => decide(r, false)}>Remove access</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// Settings → Logins
export function LoginSettings() {
  const { role } = useApp();
  if (role !== 'owner') {
    return (
      <div className="card card-pad stack" style={{ maxWidth: 640 }}>
        <h3>Approving logins</h3>
        <p className="small muted">
          This device is signed in with a staff login, so it can't approve logins. Owners approve from the Telegram message,
          or from this screen on their own phone after signing in with an owner login.
        </p>
      </div>
    );
  }
  return (
    <div className="stack">
      <p className="small muted" style={{ maxWidth: 720 }}>
        <ShieldCheck size={15} style={{ verticalAlign: '-3px' }} /> Every staff sign-in needs an owner's approval before it can see or change any data.
        "Remove access" signs that device out of the salon data straight away. The code matches the one on the waiting screen.
      </p>
      <div className="card"><LoginList /></div>
    </div>
  );
}
