// Customers → Feedback: what customers answered to "How was your visit?" on WhatsApp, the unhappy ones first
// (the owner calls them and marks it dealt with), and the automatic messages that went out.
import { useEffect, useState } from 'react';
import { MessageCircle, Phone, Check, Lock } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { fmtDate, fmtTime, fmtPhone, addDays, istDay } from '../lib/format';
import { Stat, Empty, Loading, Modal, Field } from '../components/ui';
import { waUrl } from '../components/Receipt';
import { WA_KIND, RATING, waAutoOn } from '../lib/waAuto';
import { WA_STATUS } from '../lib/whatsapp';

const PILL = { good: 'ok', ok: 'warn', bad: 'bad' };

export function Feedback({ onCount }) {
  const { toast, askOwner, isOwner, settings } = useApp();
  const [rows, setRows] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [bills, setBills] = useState({});
  const [done, setDone] = useState(null);

  const load = async () => {
    try {
      const since = new Date(addDays(istDay(), -60) + 'T00:00:00+05:30').toISOString();
      const [f, m] = await Promise.all([
        db.list('feedback', { gte: { created_at: since }, order: ['created_at', 'desc'] }),
        db.list('wa_messages', { in: { kind: ['feedback', 'reminder', 'winback'] }, gte: { created_at: since }, order: ['created_at', 'desc'], limit: 60 }),
      ]);
      setRows(f);
      setMsgs(m);
      if (onCount) onCount(f.filter((x) => x.rating === 'bad' && !x.handled_at).length);
      const ids = [...new Set(f.map((x) => x.bill_id).filter(Boolean))];
      if (ids.length) {
        const [b, it] = await Promise.all([db.list('bills', { in: { id: ids } }), db.list('bill_items', { in: { bill_id: ids } })]);
        setBills(Object.fromEntries(b.map((x) => [x.id, { ...x, items: it.filter((i) => i.bill_id === x.id) }])));
      }
    } catch (e) {
      toast(e.message, 'bad');
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);

  if (!rows) return <Loading />;
  const n = (r) => rows.filter((x) => x.rating === r).length;
  const waiting = rows.filter((x) => x.rating === 'bad' && !x.handled_at);
  const asked = msgs.filter((m) => m.kind === 'feedback').length;
  const sorted = [...waiting, ...rows.filter((x) => !waiting.includes(x))];
  const markDone = async (f) => {
    if (!(await askOwner('Marking feedback as dealt with is for the owner.'))) return;
    setDone(f);
  };

  return (
    <>
      {!waAutoOn(settings) && (
        <p className="banner demo small" id="fb-off" style={{ borderRadius: 6, marginBottom: 14 }}>The automatic WhatsApp messages are switched off. Turn them on in Settings → Salon &amp; bill → WhatsApp: automatic messages.</p>
      )}
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat k="Answers (60 days)" v={rows.length} s={asked ? `${asked} asked` : undefined} />
        <Stat k="Loved it" v={rows.length ? Math.round((n('good') / rows.length) * 100) + '%' : '–'} s={`${n('good')} customers`} accent />
        <Stat k="It was okay" v={n('ok')} />
        <Stat k="Not happy" v={n('bad')} s={waiting.length ? `${waiting.length} to call` : n('bad') ? 'All dealt with' : undefined} />
      </div>
      <div className="card" id="fb-list">
        {rows.length === 0 ? (
          <Empty title="No answers yet">A couple of hours after a bill, the customer gets "How was your visit?" on WhatsApp. Their answer shows here; "Not happy" also comes to you on Telegram.</Empty>
        ) : sorted.map((f) => {
          const b = bills[f.bill_id];
          const svc = b ? b.items.filter((i) => i.item_type === 'service').map((i) => `${i.name}${i.staff_name ? ` (${i.staff_name.split(' ')[0]})` : ''}`).join(', ') : '';
          return (
            <div key={f.id} className={'fb-card' + (f.rating === 'bad' && !f.handled_at ? ' bad' : '')} data-fb={f.name || f.phone}>
              <div className="row between wrap" style={{ gap: 8 }}>
                <div className="row" style={{ gap: 10 }}>
                  <span className={'pill ' + PILL[f.rating]}>{RATING[f.rating]}</span>
                  <b>{f.name || 'No name'}</b><span className="muted small">{fmtPhone(f.phone)}</span>
                </div>
                <span className="muted small">{fmtDate(f.created_at, false)}, {fmtTime(f.created_at)}</span>
              </div>
              {b && <div className="small muted">Bill {b.bill_no}{svc ? `: ${svc}` : ''}</div>}
              {f.comment && <div className="small">“{f.comment}”</div>}
              {f.handled_at ? (
                <div className="small" style={{ color: 'var(--ok)' }}><Check size={13} /> Dealt with{f.handled_by ? ` by ${f.handled_by}` : ''}{f.handled_note ? `: ${f.handled_note}` : ''}</div>
              ) : f.rating !== 'good' && (
                <div className="row wrap" style={{ gap: 8 }}>
                  <a className="btn line sm" href={'tel:+91' + f.phone}><Phone size={14} /> Call</a>
                  <a className="btn wa sm" href={waUrl(f.phone, `Hi ${(f.name || '').split(' ')[0] || ''}, this is Habibs Fuljhore. Thank you for telling us about your visit.`)} target="_blank" rel="noopener noreferrer"><MessageCircle size={14} /> WhatsApp</a>
                  <button className="btn primary sm" onClick={() => markDone(f)}>{!isOwner && <Lock size={12} />} Dealt with</button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="card" style={{ marginTop: 16 }}>
        <div className="sec-title" style={{ padding: '14px 16px 0' }}>Automatic messages sent</div>
        {msgs.length === 0 ? <Empty title="None yet" /> : (
          <div className="table-wrap">
            <table className="rtable" id="auto-list">
              <thead><tr><th>When</th><th>Message</th><th>To</th><th>How it went</th></tr></thead>
              <tbody>
                {msgs.map((m) => (
                  <tr key={m.id}>
                    <td data-label="When">{fmtDate(m.created_at, false)}, {fmtTime(m.created_at)}</td>
                    <td data-label="Message">{WA_KIND[m.kind] || m.kind}</td>
                    <td data-label="To">{fmtPhone(m.phone)}</td>
                    <td data-label="How it went" className={m.status === 'failed' ? 'warn-text' : ''}>{(WA_STATUS[m.status] || m.status).replace(' on WhatsApp', '')}{m.error ? <div className="tiny">{m.error}</div> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {done && <DoneModal f={done} onClose={() => setDone(null)} onSaved={() => { setDone(null); load(); }} />}
    </>
  );
}

function DoneModal({ f, onClose, onSaved }) {
  const { toast } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await db.rpc('handle_feedback', { p_id: f.id, p_note: note }); toast('Marked as dealt with'); onSaved(); } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  };
  return (
    <Modal title={`Dealt with: ${f.name || fmtPhone(f.phone)}`} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" id="fb-done-save" disabled={busy} onClick={save}>Save</button></>}>
      <Field label="What was done? (optional)"><input className="input" id="fb-done-note" value={note} maxLength={300} placeholder="e.g. called, free redo booked for Tuesday" onChange={(e) => setNote(e.target.value)} autoFocus /></Field>
    </Modal>
  );
}
