import { useEffect, useRef, useState } from 'react';
import { Send, ShieldCheck, Check, X } from 'lucide-react';
import { ownerApi, IS_DEMO } from '../lib/db';
import { DEMO_OWNER_CODE } from '../lib/totp';
import { fmtDateTime } from '../lib/format';
import { Modal, CodePad, Empty, Loading } from './ui';
import { deviceName } from './Logins';

const WAIT_MINUTES = 15; // a request older than this can no longer be approved

// "Owner approval" window. Two ways in, both need the owner's phone:
//  - Ask on Telegram: the owner taps Approve (works from anywhere)
//  - The owner, at the counter, types the 6-digit code from Google Authenticator
// ask = { reason, action: 'unlock' | 'cancel' | 'discount', ref, detail, amount }
export function OwnerUnlock({ ask, onApproved, onClose }) {
  const [waiting, setWaiting] = useState(null); // the request sent to Telegram
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // How many owners set up Authenticator: undefined = still asking, null = couldn't ask (the keypad shows, in case).
  // What was found last time is remembered on the device, so the keypad doesn't flash and go when none is set up.
  const [codes, setCodes] = useState(() => {
    try { const v = localStorage.getItem('pos-totp-owners'); return v === null ? undefined : Number(v) || 0; } catch { return undefined; }
  });
  const [resetKey, setResetKey] = useState(0);
  const done = useRef(false);
  const action = ask.action || 'unlock';
  const detail = ask.detail || (action === 'unlock' ? 'Open owner screens' : '');

  useEffect(() => {
    ownerApi.totpStatus().then((s) => {
      const n = s ? Number(s.owners) || 0 : 0;
      setCodes(n);
      try { localStorage.setItem('pos-totp-owners', String(n)); } catch { /* not kept */ }
    }).catch(() => setCodes((c) => (c === undefined ? null : c)));
  }, []);

  const approved = (g) => {
    if (done.current) return;
    done.current = true;
    onApproved(g);
  };

  // While waiting, check every 2 seconds
  useEffect(() => {
    if (!waiting) return;
    let live = true;
    const t = setInterval(async () => {
      try {
        const g = await ownerApi.status(waiting.id);
        if (!live || !g || !g.id) return;
        if (g.status === 'approved') approved(g);
        else if (g.status === 'denied') { setWaiting(null); setNote(''); setErr(`${(g.decided_by || 'The owner').replace(/ \(.*\)$/, '')} said no.`); }
        else if (Date.now() - new Date(g.created_at).getTime() > WAIT_MINUTES * 60000) { setWaiting(null); setNote(''); setErr('No answer from the owner. Ask again, or use the code.'); }
      } catch { /* keep trying */ }
    }, 2000);
    return () => { live = false; clearInterval(t); };
  }, [waiting]);

  const askTelegram = async () => {
    setErr('');
    setBusy(true);
    try {
      const g = await ownerApi.request({ action, ref: ask.ref, detail, device: deviceName(), amount: ask.amount });
      setWaiting(g);
      setNote(IS_DEMO ? 'Demo: the owner "approves" by itself in 3 seconds.' : 'The owner got a Telegram message. This carries on by itself when they tap Approve.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const tryCode = async (code) => {
    setErr('');
    setBusy(true);
    try {
      const g = await ownerApi.code({ code, detail, device: deviceName() });
      if (g && g.status === 'approved') return approved(g);
      setErr('Wrong code. Use the newest code from Google Authenticator.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
      setResetKey((k) => k + 1);
    }
  };

  return (
    <Modal title="Owner approval" onClose={onClose}>
      <div className="stack owner-unlock">
        <div className="owner-ask">
          <ShieldCheck size={20} />
          <div>
            {ask.reason && <div className="small muted">{ask.reason}</div>}
            {detail && <div className="strong">{detail}</div>}
          </div>
        </div>

        {ask.codeOnly ? (
          <p className="small" style={{ textAlign: 'center', margin: 0 }} id="owner-code-only">Only the owner can do this, here at the counter.</p>
        ) : waiting ? (
          <div className="owner-wait" role="status">
            <div className="spinner" />
            <div className="grow">
              <div className="strong">Waiting for the owner…</div>
              <div className="small muted">{note}</div>
            </div>
            <button className="btn line sm" onClick={() => { setWaiting(null); setNote(''); }}>Stop</button>
          </div>
        ) : (
          <button className="btn primary block lg" disabled={busy} onClick={askTelegram}>
            <Send size={17} /> Ask the owner on Telegram
          </button>
        )}

        {!ask.codeOnly && <div className="or-line"><span>or, if the owner is here</span></div>}

        {codes === undefined && !IS_DEMO ? (
          <p className="small muted" style={{ textAlign: 'center' }} id="owner-code-checking">Checking the code set-up…</p>
        ) : codes === 0 && !IS_DEMO ? (
          <p className="small muted" style={{ textAlign: 'center' }}>
            The code isn't set up yet. The owner sets it up once in Settings → Owner unlock, on their own phone.
          </p>
        ) : (
          <>
            <p className="small" style={{ textAlign: 'center', margin: 0 }}>
              Owner types the 6-digit code from <b>Google Authenticator</b>
              {IS_DEMO && <span className="muted"> (demo code {DEMO_OWNER_CODE})</span>}
            </p>
            <CodePad onComplete={tryCode} busy={busy} err={err} resetKey={resetKey} />
          </>
        )}
        {codes === 0 && !IS_DEMO && err && <p className="err-text" role="alert" style={{ textAlign: 'center' }}>{err}</p>}
      </div>
    </Modal>
  );
}

const STATUS = {
  pending: ['warn', 'Waiting'], approved: ['ok', 'Approved'], denied: ['bad', 'Denied'], wrong_code: ['bad', 'Wrong code'],
};
const WHAT = { unlock: 'Owner screens', cancel: 'Cancel bill', discount: 'Big discount', stock: 'Stock taken out' };

// Owner's list of requests from the counter, with Approve / Deny for the waiting ones
export function OwnerRequests({ onlyPending = false, onChange }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const load = async () => {
    try { setRows(await ownerApi.list()); setErr(''); } catch (e) { setErr(e.message); setRows([]); }
  };
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);
  const decide = async (r, yes) => {
    setBusy(r.id);
    try { await ownerApi.decide(r.id, yes); await load(); onChange && onChange(); } catch (e) { setErr(e.message); } finally { setBusy(''); }
  };
  if (rows === null) return <Loading />;
  const fresh = (r) => Date.now() - new Date(r.created_at).getTime() < WAIT_MINUTES * 60000;
  const list = onlyPending ? rows.filter((r) => r.status === 'pending' && fresh(r)) : rows.slice(0, 50);
  if (!list.length) return <Empty title={onlyPending ? 'Nothing waiting' : 'No approvals yet'}>{err || 'Requests from the counter show up here.'}</Empty>;
  return (
    <div className="login-list">
      {err && <p className="err-text">{err}</p>}
      {list.map((r) => {
        const st = r.status === 'pending' && !fresh(r) ? ['', 'Expired'] : STATUS[r.status] || ['', r.status];
        return (
          <div className="login-row" key={r.id}>
            <div className="grow">
              <div className="strong" style={{ overflowWrap: 'anywhere' }}>{r.detail || WHAT[r.action]}</div>
              <div className="tiny muted">{WHAT[r.action]} · {r.email || 'counter'}{r.device ? ' · ' + r.device : ''}</div>
              <div className="tiny muted">
                {fmtDateTime(r.created_at)}
                {r.decided_by ? ` · ${st[1]} by ${r.decided_by}` : ''}
                {r.status === 'approved' && r.used_at ? ' · used' : ''}
              </div>
            </div>
            <span className={'pill ' + st[0]}>{st[1]}</span>
            {r.status === 'pending' && fresh(r) && (
              <div className="row login-actions">
                <button className="btn primary sm" disabled={busy === r.id} onClick={() => decide(r, true)}><Check size={15} /> Approve</button>
                <button className="btn danger sm" disabled={busy === r.id} onClick={() => decide(r, false)}><X size={15} /> Deny</button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
