import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ShieldCheck, Smartphone } from 'lucide-react';
import { ownerApi, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { newSecret, otpauthUrl, toHex, base32 } from '../lib/totp';
import { Confirm, Seg, Field, MoneyInput } from './ui';
import { OwnerRequests } from './OwnerUnlock';

// Settings → Owner unlock: how it works, Google Authenticator set-up, and the record of approvals
export function OwnerSettings() {
  const { role, user, toast, settings } = useApp();
  const canSetUp = IS_DEMO || role === 'owner';
  const [st, setSt] = useState(null);
  const [setup, setSetup] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);

  const load = () => ownerApi.totpStatus().then((s) => setSt(s || { owners: 0, mine: false })).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const start = async () => {
    const secret = newSecret();
    const url = otpauthUrl(secret, (user && user.email) || 'owner');
    setSetup({ secret, url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }) });
    setCode('');
    setErr('');
  };
  const finish = async () => {
    setBusy(true);
    setErr('');
    try {
      await ownerApi.totpSet(toHex(setup.secret), code);
      setSetup(null);
      toast('Google Authenticator is set up', 'ok');
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const max = Number(settings && settings.max_discount_pct) || 0;
  return (
    <div className="stack loose" style={{ maxWidth: 760 }}>
      <div className="card card-pad stack">
        <h3><ShieldCheck size={18} style={{ verticalAlign: '-3px' }} /> How owner approval works</h3>
        <p className="small">
          Reports, settings, salaries, product prices, stock corrections, cancelling a bill and discounts above {max}% need you.
        </p>
        <ul className="small plain-list">
          <li><b>From anywhere:</b> the counter taps <i>Ask the owner on Telegram</i>. You get a message saying exactly what is asked, and tap Approve or Deny. A cancel or a discount approved this way works only for that one bill.</li>
          <li><b>At the counter:</b> type the 6-digit code from Google Authenticator on your phone. It opens owner screens on that device for 10 minutes. Each code works once, for about a minute, so seeing a code is no use to anyone later.</li>
          <li><b>Your own owner login</b> (on your phone) never needs approval. Don't leave the counter tablet signed in with an owner login.</li>
        </ul>
        <p className="small muted">The database checks every approval itself, so it can't be skipped by going around the app. Approving needs internet; without internet the counter can still bill, with discounts up to the limit.</p>
      </div>

      <div className="card card-pad stack">
        <h3><Smartphone size={18} style={{ verticalAlign: '-3px' }} /> Google Authenticator</h3>
        {!canSetUp ? (
          <p className="small">Each owner sets this up on their own phone: sign in with your owner login, then open Settings → Owner unlock.</p>
        ) : setup ? (
          <div className="totp-setup">
            <ol className="small stack tight" style={{ paddingLeft: 18 }}>
              <li>Install <b>Google Authenticator</b> on your phone (Play Store or App Store).</li>
              <li>In it, tap <b>+</b> → <b>Scan a QR code</b>, and scan this.
                <div className="row wrap" style={{ marginTop: 8, alignItems: 'flex-start' }}>
                  <img src={setup.qr} alt="Set-up QR code for Google Authenticator" width={180} height={180} style={{ border: '1px solid var(--line)', borderRadius: 8 }} />
                  <div className="stack tight small" style={{ maxWidth: 300 }}>
                    <a className="btn line sm" href={setup.url}>Setting up on this phone? Add to Authenticator</a>
                    <span className="muted">Or type this key in the app:</span>
                    <code style={{ fontSize: 15, letterSpacing: '.08em', overflowWrap: 'anywhere' }}>{base32(setup.secret).match(/.{1,4}/g).join(' ')}</code>
                  </div>
                </div>
              </li>
              <li>Type the 6-digit code the app shows now:</li>
            </ol>
            <div className="row wrap">
              <input className="input" id="totp-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} style={{ width: 160, fontSize: 22, letterSpacing: '.2em', textAlign: 'center' }}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" />
              <button className="btn primary" disabled={code.length !== 6 || busy} onClick={finish}>Finish set-up</button>
              <button className="btn line" onClick={() => setSetup(null)}>Back</button>
            </div>
            {err && <p className="err-text" role="alert">{err}</p>}
            <p className="tiny muted">Keep this key private. Anyone with it can make owner codes. If your phone is lost, set it up again here: the old key stops working.</p>
          </div>
        ) : (
          <div className="stack">
            <p className="small">
              {st === null ? 'Checking…' : st.mine ? <><span className="pill ok">Set up</span> Your phone makes owner codes.</> : <><span className="pill warn">Not set up</span> Set it up so you can unlock at the counter with a code.</>}
              {st && st.owners > (st.mine ? 1 : 0) ? ` ${st.owners - (st.mine ? 1 : 0)} other owner${st.owners - (st.mine ? 1 : 0) > 1 ? 's have' : ' has'} set it up too.` : ''}
            </p>
            <div className="row wrap">
              <button className="btn primary" onClick={start}>{st && st.mine ? 'Set up again (new phone)' : 'Set up Google Authenticator'}</button>
              {st && st.mine && <button className="btn line" onClick={() => setRemoving(true)}>Remove from my login</button>}
            </div>
            {err && <p className="err-text">{err}</p>}
          </div>
        )}
      </div>

      <StockRule />

      {canSetUp && (
        <div className="card">
          <div className="card-head"><h3>Approvals and unlocks</h3><span className="tiny muted">Newest first</span></div>
          <OwnerRequests />
        </div>
      )}
      {removing && (
        <Confirm title="Remove Google Authenticator?" text="Codes from your phone will stop working. Telegram approval still works." okLabel="Remove" danger
          onClose={() => setRemoving(false)}
          onOk={async () => { try { await ownerApi.totpRemove(); toast('Removed'); load(); } catch (e) { toast(e.message, 'bad'); } setRemoving(false); }} />
      )}
    </div>
  );
}

// When does taking stock out of the store need the owner? (checked again by the database: issue_stock)
function StockRule() {
  const { settings, saveSetting, toast } = useApp();
  const [rule, setRule] = useState((settings && settings.stock_approval) || 'expensive');
  const [above, setAbove] = useState(String(settings && settings.stock_approval_above != null ? settings.stock_approval_above : 500));
  const save = async () => {
    try {
      await saveSetting('stock_approval', rule);
      await saveSetting('stock_approval_above', Number(above) || 0);
      toast('Saved', 'ok');
    } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <div className="card card-pad stack">
      <h3>Taking stock out of the store</h3>
      <p className="small muted">Every tube, jar, tin or kit given out is recorded with who took it and whether the finished one came back. Choose when you approve it on Telegram (or with the code).</p>
      <Seg full options={[['expensive', 'Costly ones, or no empty back'], ['always', 'Every time'], ['never', 'Never']]} value={rule} onChange={setRule} />
      {rule === 'expensive' && (
        <Field label="Costly means worth at least" hint="Below this, with the empty handed back, no approval is needed">
          <MoneyInput id="st-stock-above" value={above} onChange={setAbove} />
        </Field>
      )}
      <div><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  );
}
