import { useEffect, useState } from 'react';
import { MessageCircle } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, fmtDate, fmtPhone, daysSince, round2 } from '../lib/format';
import { Modal, Field, Seg, MoneyInput, Empty, Loading, Stat } from '../components/ui';
import { dueLeft } from '../lib/receiptRows';
import { waUrl } from '../components/Receipt';

// Bills with money still to pay (a due, "pay later"). Collect takes part or all of it, by cash, UPI or card, and it
// counts in that day's cash close (collect_due in the database).
export function Dues() {
  const { settings } = useApp();
  const [rows, setRows] = useState(null);
  const [collect, setCollect] = useState(null);
  const load = () => {
    setRows(null);
    db.list('bills', { eq: { status: 'paid' }, gte: { due_left: 0.01 }, order: ['created_at', 'asc'] })
      .then((r) => setRows(r.filter((b) => dueLeft(b) > 0)))
      .catch(() => setRows([]));
  };
  useEffect(load, []);
  if (!rows) return <Loading />;
  const total = round2(rows.reduce((a, b) => a + dueLeft(b), 0));
  const remind = (b) => waUrl(b.customer_phone, `Hi ${String(b.customer_name || '').split(' ')[0] || 'there'}, a reminder from ${(settings && settings.salon_name) || 'Habibs'}: ${rupee(dueLeft(b))} is still due on bill ${b.bill_no} of ${fmtDate(b.created_at, false)}. You can pay it on your next visit or by UPI${settings && settings.upi_id ? ` to ${settings.upi_id}` : ''}. Thank you!`);
  return (
    <div className="stack loose" id="dues">
      <div className="stats"><Stat k="Due to the salon" v={rupee(total)} s={`${rows.length} ${rows.length === 1 ? 'bill' : 'bills'}`} accent /></div>
      {rows.length === 0 ? (
        <div className="card"><Empty title="Nothing due">Bills with part left to pay later show here.</Empty></div>
      ) : (
        <div className="card">
          {rows.map((b) => (
            <div className="login-row" key={b.id} data-due={b.bill_no}>
              <div className="grow">
                <div className="strong">{b.customer_name || 'Customer'} · {fmtPhone(b.customer_phone)}</div>
                <div className="small muted">
                  {b.bill_no} · {fmtDate(b.created_at, false)} · {daysSince(b.created_at) === 0 ? 'today' : `${daysSince(b.created_at)} days ago`} ·
                  bill {rupee(b.total)}{Number(b.due_cleared) > 0 ? ` · ${rupee(b.due_cleared)} paid since` : ''}
                </div>
              </div>
              <b className="nowrap">{rupee(dueLeft(b))} due</b>
              <div className="row login-actions">
                {b.customer_phone && <a className="btn wa sm" href={remind(b)} target="_blank" rel="noreferrer"><MessageCircle size={14} /> Remind</a>}
                <button className="btn primary sm" onClick={() => setCollect(b)}>Collect</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {collect && <CollectDue bill={collect} onClose={() => setCollect(null)} onSaved={() => { setCollect(null); load(); }} />}
    </div>
  );
}

export function CollectDue({ bill, onClose, onSaved }) {
  const { toast } = useApp();
  const left = dueLeft(bill);
  const [amt, setAmt] = useState(String(left));
  const [mode, setMode] = useState('cash');
  const [busy, setBusy] = useState(false);
  const ok = Number(amt) > 0 && Number(amt) <= left;
  const save = async () => {
    setBusy(true);
    try {
      await db.rpc('collect_due', { p: { bill_id: bill.id, amount: String(round2(Number(amt))), mode } });
      toast(`${rupee(amt)} collected on ${bill.bill_no}`, 'ok');
      onSaved();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };
  return (
    <Modal title={'Collect the due: ' + bill.bill_no} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" id="due-collect" disabled={!ok || busy} onClick={save}>Collect {ok ? rupee(amt) : ''}</button></>}>
      <div className="stack">
        <p className="small">{bill.customer_name || 'Customer'} · {fmtPhone(bill.customer_phone)} · <b>{rupee(left)} due</b> on a {rupee(bill.total)} bill of {fmtDate(bill.created_at, false)}.</p>
        <Field label="Amount paid now" hint="Part of it is fine: the rest stays due"><MoneyInput id="due-amt" value={amt} onChange={setAmt} /></Field>
        <Field label="Paid by"><Seg full options={[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']]} value={mode} onChange={setMode} /></Field>
        <p className="tiny muted" style={{ margin: 0 }}>It counts in today's cash close. The bill keeps its date and number.</p>
      </div>
    </Modal>
  );
}
