import { useEffect, useMemo, useState } from 'react';
import { Plus, Download, MessageCircle, Star } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, fmtDate, fmtPhone, daysSince, cleanPhone, validPhone, istMonth, toCSV, downloadFile, istDay, canDownload, NO_DOWNLOAD } from '../lib/format';
import { SearchBox, Empty, Loading, Modal, Field, Stat } from '../components/ui';
import { BillView } from '../components/BillView';
import { payText, waUrl } from '../components/Receipt';
import { loyaltyRules, liveBalance, expiresAt } from '../lib/loyalty';
import { Feedback } from './Feedback';

const POINT_KIND = { earn: 'Earned', use: 'Used', cancel: 'Bill cancelled', expire: 'Expired', adjust: 'Changed' };

const FILTERS = [
  ['all', 'All'],
  ['new', 'New this month'],
  ['regular', 'Regulars (3+ visits)'],
  ['due', 'Not seen in 45+ days'],
  ['points', 'Points to use'],
];

export default function Customers() {
  const [tab, setTab] = useState('list');
  const [toCall, setToCall] = useState(0);
  // unhappy customers still to call: a red number on the Feedback tab
  useEffect(() => {
    db.list('feedback', { eq: { rating: 'bad' }, order: ['created_at', 'desc'], limit: 50 }).then((r) => setToCall(r.filter((x) => !x.handled_at).length)).catch(() => null);
  }, []);
  return (
    <div className="page">
      <div className="tabs" id="cust-tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'list' ? 'on' : ''} onClick={() => setTab('list')}>Customers</button>
        <button className={tab === 'fb' ? 'on' : ''} onClick={() => setTab('fb')}>Feedback {toCall > 0 && <span className="count">{toCall}</span>}</button>
      </div>
      {tab === 'list' ? <CustomersList /> : (<><div className="page-head"><h1>Feedback</h1></div><Feedback onCount={setToCall} /></>)}
    </div>
  );
}

function CustomersList() {
  const { toast, askOwner, settings } = useApp();
  const rules = loyaltyRules(settings);
  const [rows, setRows] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState(null);

  const load = async () => {
    try {
      setRows(await db.list('customers', { order: ['last_visit', 'desc'] }));
    } catch (e) {
      toast(e.message, 'bad');
      setRows([]);
    }
  };
  useEffect(() => { load(); }, []);

  const month = istMonth();
  const shown = useMemo(() => {
    let r = rows || [];
    if (filter === 'new') r = r.filter((c) => c.first_visit && istDay(c.first_visit).startsWith(month));
    if (filter === 'regular') r = r.filter((c) => c.visits >= 3);
    if (filter === 'due') r = r.filter((c) => c.visits > 0 && daysSince(c.last_visit) >= 45);
    if (filter === 'points') r = r.filter((c) => liveBalance(c, rules) >= rules.minUse);
    if (q) {
      const s = q.toLowerCase().replace(/\s/g, '');
      r = r.filter((c) => (c.phone || '').includes(s) || (c.name || '').toLowerCase().replace(/\s/g, '').includes(s));
    }
    return [...r].sort((a, b) => String(b.last_visit || b.created_at).localeCompare(String(a.last_visit || a.created_at)));
  }, [rows, q, filter, month, settings]);

  const all = rows || [];
  const repeat = all.filter((c) => c.visits >= 2).length;
  const withVisits = all.filter((c) => c.visits >= 1).length;

  const exportCsv = async () => {
    if (!canDownload()) return toast(NO_DOWNLOAD);
    if (!(await askOwner('Only the owner can download the customer list.'))) return;
    const csv = toCSV(shown, [
      ['name', 'Name'], ['phone', 'Mobile'], ['gender', 'Gender'],
      [(c) => (c.whatsapp_ok ? 'Yes' : 'No'), 'WhatsApp offers OK'], ['visits', 'Visits'], ['total_spent', 'Total spent'],
      [(c) => (c.first_visit ? istDay(c.first_visit) : ''), 'First visit'], [(c) => (c.last_visit ? istDay(c.last_visit) : ''), 'Last visit'],
      [(c) => liveBalance(c, rules), 'Points'],
    ]);
    downloadFile(`customers-${istDay()}.csv`, csv);
  };

  return (
    <>
      <div className="page-head">
        <h1>Customers</h1>
        <div className="row">
          <button className="btn line sm" onClick={exportCsv}><Download size={15} /> Download list</button>
          <button className="btn primary sm" onClick={() => setEdit({})}><Plus size={15} /> Add customer</button>
        </div>
      </div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat k="Customers" v={all.length} />
        <Stat k="Came back again" v={withVisits ? Math.round((repeat / withVisits) * 100) + '%' : '–'} s={`${repeat} of ${withVisits} came 2+ times`} accent />
        <Stat k="New this month" v={all.filter((c) => c.first_visit && istDay(c.first_visit).startsWith(month)).length} />
        <Stat k="WhatsApp offers OK" v={all.filter((c) => c.whatsapp_ok).length} />
        {rules.on && (() => {
          const live = all.map((c) => liveBalance(c, rules)).filter((x) => x > 0);
          return <Stat k="Points not yet used" v={rupee(live.reduce((a, x) => a + x, 0))} s={`${live.length} customers · ${all.filter((c) => liveBalance(c, rules) >= rules.minUse).length} can use them now`} />;
        })()}
      </div>

      <div className="card">
        <div className="card-pad stack" style={{ paddingBottom: 6 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search name or mobile number" />
          <div className="chips scroll">
            {FILTERS.map(([k, l]) => (
              <button key={k} className={'chip sm' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}</button>
            ))}
          </div>
        </div>
        {rows === null ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty title={rows.length ? 'Nobody matches' : 'No customers yet'}>{rows.length ? 'Try another search or filter.' : 'Customers are added automatically when you save a bill with their mobile number.'}</Empty>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead>
                <tr><th>Name</th><th>Mobile</th><th className="r">Visits</th><th className="r">Spent</th>{rules.on && <th className="r">Points</th>}<th>Last visit</th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 300).map((c) => (
                  <tr key={c.id} className="click" onClick={() => setEdit(c)}>
                    <td>
                      {c.name || <span className="muted">No name</span>}
                      {c.visits >= 3 && <span className="pill red" style={{ marginLeft: 8 }}>Regular</span>}
                    </td>
                    <td className="nowrap">{fmtPhone(c.phone)}</td>
                    <td className="r">{c.visits}</td>
                    <td className="r nowrap">{rupee(c.total_spent)}</td>
                    {rules.on && <td className="r">{liveBalance(c, rules) || '–'}</td>}
                    <td className="nowrap">{c.last_visit ? fmtDate(c.last_visit) : '–'}{c.last_visit && daysSince(c.last_visit) >= 45 && <span className="pill warn" style={{ marginLeft: 8 }}>{daysSince(c.last_visit)} days</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {shown.length > 300 && <p className="muted small card-pad">Showing the first 300. Search to find others.</p>}
          </div>
        )}
      </div>

      {edit && <CustomerModal customer={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function CustomerModal({ customer, onClose, onSaved }) {
  const { toast, settings } = useApp();
  const isNew = !customer.id;
  const [f, setF] = useState({
    name: customer.name || '', phone: customer.phone || '', gender: customer.gender || '',
    whatsapp_ok: !!customer.whatsapp_ok, notes: customer.notes || '',
  });
  const [bills, setBills] = useState(null);
  const [points, setPoints] = useState(null);
  const [open, setOpen] = useState(null);
  const rules = loyaltyRules(settings);
  const bal = liveBalance(customer, rules);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNew) db.list('bills', { eq: { customer_id: customer.id }, order: ['created_at', 'desc'] }).then(setBills).catch(() => setBills([]));
    if (!isNew) db.list('loyalty_points', { eq: { customer_id: customer.id }, order: ['created_at', 'desc'] }).then(setPoints).catch(() => setPoints([]));
  }, [customer.id, isNew]);

  const save = async () => {
    if (!validPhone(f.phone)) return setErr('Enter a 10-digit mobile number.');
    setBusy(true);
    try {
      const row = { ...f, name: f.name.trim() || null, gender: f.gender || null, notes: f.notes.trim() || null };
      if (isNew) {
        const [exists] = await db.list('customers', { eq: { phone: f.phone }, limit: 1 });
        if (exists) { setBusy(false); return setErr('A customer with this number already exists.'); }
        await db.insert('customers', row);
      } else {
        await db.update('customers', customer.id, row);
      }
      toast('Customer saved');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (open) return <BillView bill={open} onClose={() => setOpen(null)} onChanged={() => setOpen(null)} />;

  const hello = `Hi ${(f.name || '').split(' ')[0] || 'there'}, greetings from ${settings.salon_name || 'Habibs'}${settings.branch ? ', ' + settings.branch : ''}!`
    + (rules.on && bal >= rules.minUse ? `\n\nYou have ${bal} loyalty points = ₹${bal} off your next visit (up to ${rules.maxPct}% of a bill), valid till ${fmtDate(expiresAt(customer.last_visit, rules))}.` : '');

  return (
    <Modal
      wide
      title={isNew ? 'Add customer' : f.name || fmtPhone(f.phone)}
      onClose={onClose}
      foot={
        <>
          {!isNew && validPhone(f.phone) && (
            <a className="btn wa" href={waUrl(f.phone, hello)} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} /> WhatsApp</a>
          )}
          <span className="grow" />
          <button className="btn line" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save</button>
        </>
      }
    >
      <div className="stack loose">
        <div className="form-grid">
          <Field label="Name"><input className="input" id="c-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Mobile">
            <input className="input" id="c-phone" inputMode="numeric" disabled={!isNew} value={fmtPhone(f.phone)} onChange={(e) => setF({ ...f, phone: cleanPhone(e.target.value) })} />
          </Field>
          <Field label="Gender">
            <select className="select" id="c-gender" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
              <option value="">Not set</option><option value="F">Female</option><option value="M">Male</option><option value="O">Other</option>
            </select>
          </Field>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input type="checkbox" checked={f.whatsapp_ok} onChange={(e) => setF({ ...f, whatsapp_ok: e.target.checked })} /> OK to send offers on WhatsApp
          </label>
          <Field label="Notes" className="span2" hint="Hair type, allergies, preferred stylist…">
            <textarea className="textarea" id="c-notes" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
          </Field>
        </div>
        {err && <p className="err-text">{err}</p>}

        {!isNew && rules.on && (
          <div className="stack tight" id="cust-points-history">
            <div className="sec-title"><Star size={13} /> Loyalty points: {bal}{bal > 0 && customer.last_visit ? ` · valid till ${fmtDate(expiresAt(customer.last_visit, rules))}` : ''}{bal !== Number(customer.points) ? ` (${customer.points} expired)` : ''}</div>
            {points === null ? <Loading /> : points.length === 0 ? <p className="muted small">No points yet. They earn {rules.pct}% of what they pay for services at the normal price.</p> : (
              <div className="table-wrap card">
                <table>
                  <tbody>
                    {points.slice(0, 50).map((x) => {
                      const b = (bills || []).find((y) => y.id === x.bill_id);
                      return (
                        <tr key={x.id}>
                          <td className="nowrap">{fmtDate(x.created_at)}</td>
                          <td>{POINT_KIND[x.kind] || x.kind}{b ? ` · ${b.bill_no}` : ''}{x.note && x.kind !== 'cancel' ? ` · ${x.note}` : ''}</td>
                          <td className={'r strong' + (x.points < 0 ? ' muted' : '')}>{x.points > 0 ? '+' : ''}{x.points}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {!isNew && (
          <div className="stack tight">
            <div className="sec-title">Visits ({customer.visits}) · spent {rupee(customer.total_spent)}</div>
            {bills === null ? <Loading /> : bills.length === 0 ? <p className="muted small">No bills yet.</p> : (
              <div className="table-wrap card">
                <table>
                  <tbody>
                    {bills.map((b) => (
                      <tr key={b.id} className={'click' + (b.status === 'cancelled' ? ' cancelled' : '')} onClick={() => setOpen(b)}>
                        <td className="nowrap">{fmtDate(b.created_at)}</td>
                        <td>{b.bill_no}</td>
                        <td className="small">{b.status === 'cancelled' ? 'Cancelled' : payText(b)}</td>
                        <td className="r strong amt">{rupee(b.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
