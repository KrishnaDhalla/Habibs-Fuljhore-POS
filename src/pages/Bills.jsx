import { useEffect, useMemo, useState } from 'react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, istDay, dayRangeISO, fmtTime, fmtPhone, round2 } from '../lib/format';
import { DateNav, SearchBox, Stat, Empty, Loading } from '../components/ui';
import { BillView } from '../components/BillView';
import { payText } from '../components/Receipt';
import { WA_SHORT } from '../lib/whatsapp';
import { Expenses, CashClose } from './Cash';

export default function Bills() {
  const [tab, setTab] = useState('bills');
  return (
    <div className="page">
      <div className="page-head"><h1>{tab === 'bills' ? 'Bills' : tab === 'exp' ? 'Expenses' : 'Cash close'}</h1></div>
      <div className="tabs" id="bills-tabs">
        {[['bills', 'Bills'], ['exp', 'Expenses'], ['close', 'Cash close']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'bills' && <BillsList />}
      {tab === 'exp' && <Expenses />}
      {tab === 'close' && <CashClose />}
    </div>
  );
}

function BillsList() {
  const { toast } = useApp();
  const [day, setDay] = useState(istDay());
  const [bills, setBills] = useState(null);
  const [items, setItems] = useState([]);
  const [wa, setWa] = useState({}); // bill id → its latest WhatsApp send
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);

  const load = async () => {
    setBills(null);
    try {
      const [from, to] = dayRangeISO(day);
      const [b, i] = await Promise.all([
        db.list('bills', { gte: { created_at: from }, lt: { created_at: to }, order: ['created_at', 'desc'] }),
        db.list('bill_items', { gte: { created_at: from }, lt: { created_at: to } }),
      ]);
      setBills(b);
      setItems(i);
      // WhatsApp bills: how each send went (needs the internet; nothing shown without it)
      const ids = b.filter((x) => x.customer_phone && !x._pending).map((x) => x.id);
      if (ids.length) {
        db.list('wa_messages', { in: { bill_id: ids }, order: ['created_at', 'asc'] })
          .then((rows) => setWa(Object.fromEntries(rows.map((r) => [r.bill_id, r]))))
          .catch(() => setWa({}));
      } else setWa({});
    } catch (e) {
      toast(e.message, 'bad');
      setBills([]);
    }
  };
  useEffect(() => { load(); }, [day]);

  const itemsByBill = useMemo(() => {
    const m = {};
    for (const it of items) (m[it.bill_id] = m[it.bill_id] || []).push(it);
    return m;
  }, [items]);

  const paid = (bills || []).filter((b) => b.status === 'paid');
  const sum = (f) => round2(paid.reduce((a, b) => a + Number(b[f] || 0), 0));
  const cancelled = (bills || []).length - paid.length;

  const shown = (bills || []).filter((b) => {
    if (!q) return true;
    const s = q.toLowerCase();
    return [b.bill_no, b.customer_name, b.customer_phone].some((x) => String(x || '').toLowerCase().includes(s));
  });

  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}><DateNav day={day} onChange={setDay} /></div>

      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat k="Total sales" v={rupee(sum('total'))} s={`${paid.length} bills${cancelled ? ` · ${cancelled} cancelled` : ''}`} accent />
        <Stat k="Cash" v={rupee(sum('paid_cash'))} s="Count it in Cash close" />
        <Stat k="UPI" v={rupee(sum('paid_upi'))} />
        <Stat k="Card" v={rupee(sum('paid_card'))} />
        <Stat k="Discounts" v={rupee(sum('discount'))} s={sum('paid_points') ? `${rupee(sum('paid_points'))} paid with points` : undefined} />
        <Stat k="New customers" v={paid.filter((b) => b.is_new_customer).length} />
      </div>

      <div className="card">
        <div className="card-pad" style={{ paddingBottom: 0 }}>
          <SearchBox value={q} onChange={setQ} placeholder="Search bill number, name or mobile" />
        </div>
        {bills === null ? (
          <Loading />
        ) : shown.length === 0 ? (
          <Empty title={q ? 'No bill matches your search' : 'No bills on this day'}>{!q && 'Bills saved on the New Bill screen show up here.'}</Empty>
        ) : (
          <div className="table-wrap" style={{ marginTop: 8 }}>
            <table className="rtable">
              <thead>
                <tr><th>Bill</th><th>Time</th><th>Customer</th><th>Services</th><th>Paid by</th><th className="r">Amount</th></tr>
              </thead>
              <tbody>
                {shown.map((b) => (
                  <tr key={b.id} className={'click' + (b.status === 'cancelled' ? ' cancelled' : '')} onClick={() => setOpen(b)}>
                    <td className="nowrap">{b.bill_no}{/-P\d+$/.test(b.bill_no || '') && <div><span className="pill warn">Past bill</span></div>}{b.for_staff && <div><span className="pill ok">Staff</span></div>}{wa[b.id] && <div><span className={'pill wa-pill ' + (wa[b.id].status === 'failed' ? 'warn' : 'ok')} title={wa[b.id].error || ''}>{WA_SHORT[wa[b.id].status]}</span></div>}</td>
                    <td className="nowrap">{fmtTime(b.created_at)}</td>
                    <td>
                      <div>{b.customer_name || 'Walk-in'}</div>
                      <div className="tiny muted">{fmtPhone(b.customer_phone)}{b.is_new_customer ? ' · new' : ''}</div>
                    </td>
                    <td className="small" style={{ maxWidth: 300 }}>{(itemsByBill[b.id] || []).map((i) => i.name).join(', ')}</td>
                    <td className="nowrap small">{b.status === 'cancelled' ? <span className="pill bad">Cancelled</span> : payText(b)}{b._pending && <div><span className="pill warn">Waiting to upload</span></div>}</td>
                    <td className="r strong amt nowrap">{rupee(b.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {open && (
        <BillView
          bill={open}
          items={itemsByBill[open.id]}
          onClose={() => setOpen(null)}
          onChanged={() => { setOpen(null); load(); }}
        />
      )}
    </>
  );
}
