// Bills → Expenses and Bills → Cash close.
// Expenses: money paid out for anything but stock and salaries (tea, cleaning, laundry, repairs, rent …).
// Cash close: at the end of the day the drawer is counted; the app says what should be there
// (what was left yesterday + cash bills − cancelled cash bills − expenses from the drawer) and keeps the difference.
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Wallet, CheckCircle2, AlertTriangle, Lock } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, istDay, addDays, fmtTime, round2, uid } from '../lib/format';
import { Modal, Field, Seg, Stat, Empty, Loading, DateNav, MoneyInput } from '../components/ui';
import { NOTES, PAID_FROM, PAID_FROM_LABEL, expenseCategories, countNotes, cashTolerance } from '../lib/cash';

const monthEnd = (d) => d.slice(0, 8) + String(new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0');
const dayText = (d) => new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });

export function Expenses() {
  const { toast, askOwner, isOwner, settings } = useApp();
  const today = istDay();
  const [day, setDay] = useState(today);
  const [rows, setRows] = useState(null);
  const [month, setMonth] = useState([]);
  const [adding, setAdding] = useState(false);

  const load = async () => {
    try {
      const [d, m] = await Promise.all([
        db.list('expenses', { eq: { day }, order: ['created_at', 'desc'] }),
        db.list('expenses', { gte: { day: day.slice(0, 8) + '01' }, lte: { day: monthEnd(day) } }),
      ]);
      setRows(d);
      setMonth(m.filter((e) => !e.cancelled_at));
    } catch (e) {
      toast(e.message, 'bad');
      setRows([]);
    }
  };
  useEffect(() => { setRows(null); load(); }, [day]);

  const live = (rows || []).filter((e) => !e.cancelled_at);
  const sum = (list, f = () => true) => round2(list.filter(f).reduce((a, e) => a + Number(e.amount), 0));
  const byCat = useMemo(() => {
    const m = {};
    for (const e of month) m[e.category] = round2((m[e.category] || 0) + Number(e.amount));
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [month]);

  const remove = async (e) => {
    if (!(await askOwner('Removing an expense is for the owner.'))) return;
    try {
      await db.rpc('cancel_expense', { p_id: e.id, p_reason: null });
      toast('Expense removed');
      load();
    } catch (err) { toast(err.message, 'bad'); }
  };

  return (
    <>
      <div className="row between wrap" style={{ gap: 10, marginBottom: 14 }}>
        <DateNav day={day} onChange={setDay} />
        <button className="btn primary" id="add-expense" onClick={() => setAdding(true)}><Plus size={16} /> Add expense</button>
      </div>
      <div className="stats" style={{ marginBottom: 16 }}>
        <Stat k={day === today ? 'Today' : dayText(day)} v={rupee(sum(live))} s={`${live.length} ${live.length === 1 ? 'expense' : 'expenses'}`} accent />
        <Stat k="From the cash drawer" v={rupee(sum(live, (e) => e.paid_from === 'cash'))} s="Counted in the cash close" />
        <Stat k="UPI, bank, owner" v={rupee(sum(live, (e) => e.paid_from !== 'cash'))} />
        <Stat k={new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long', timeZone: 'Asia/Kolkata' }) + ' so far'} v={rupee(sum(month))} />
      </div>
      <div className="card">
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty title="No expenses this day">Tea, cleaning, laundry, a repair: add it here, so the cash in the drawer matches at closing.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="rtable" id="expense-list">
              <thead><tr><th>Time</th><th>For</th><th>Note</th><th>Paid from</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((e) => (
                  <tr key={e.id} className={e.cancelled_at ? 'cancelled' : ''}>
                    <td data-label="Time">{fmtTime(e.created_at)}</td>
                    <td data-label="For"><b>{e.category}</b>{e.cancelled_at && <div><span className="pill bad">Removed</span></div>}</td>
                    <td data-label="Note" className="muted">{e.note || '–'}{e.created_by ? <div className="tiny">{e.created_by}</div> : null}</td>
                    <td data-label="Paid from">{PAID_FROM_LABEL[e.paid_from] || e.paid_from}</td>
                    <td data-label="Amount" className="r strong">{rupee(e.amount)}</td>
                    <td className="r">{!e.cancelled_at && <button className="btn ghost sm" aria-label="Remove expense" onClick={() => remove(e)}>{!isOwner && <Lock size={12} />}<Trash2 size={15} /></button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {byCat.length > 0 && (
        <div className="card card-pad stack" style={{ marginTop: 16 }} id="expense-month">
          <div className="sec-title">This month by kind</div>
          <div className="chips">{byCat.map(([c, v]) => <span key={c} className="pill">{c}: <b>{rupee(v)}</b></span>)}</div>
        </div>
      )}
      {adding && <ExpenseModal day={day} today={today} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} categories={expenseCategories(settings)} />}
    </>
  );
}

function ExpenseModal({ day, today, onClose, onSaved, categories }) {
  const { toast, askOwner } = useApp();
  const [id] = useState(uid());
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [note, setNote] = useState('');
  const [from, setFrom] = useState('cash');
  const [busy, setBusy] = useState(false);
  const ok = Number(amount) > 0 && category;
  const save = async () => {
    if (!ok || busy) return;
    if (day < today && !(await askOwner('An expense for an earlier day is for the owner.'))) return;
    setBusy(true);
    try {
      await db.rpc('add_expense', { p: { id, amount: String(amount), category, note, paid_from: from, day } });
      toast(`Expense saved: ${category} ${rupee(amount)}`);
      onSaved();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  };
  return (
    <Modal title={day === today ? 'Add expense' : `Add expense for ${dayText(day)}`} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" id="expense-save" disabled={!ok || busy} onClick={save}>Save expense</button></>}>
      <div className="stack">
        <Field label="Amount (₹)"><MoneyInput id="expense-amount" value={amount} onChange={setAmount} autoFocus /></Field>
        <Field label="What was it for?">
          <div className="chips" id="expense-cats">{categories.map((c) => <button key={c} type="button" className={'chip sm' + (category === c ? ' on' : '')} onClick={() => setCategory(c)}>{c}</button>)}</div>
        </Field>
        <Field label="Paid from" hint={from === 'cash' ? 'It comes off the cash expected in the drawer at closing.' : "It doesn't touch the cash drawer."}>
          <Seg full options={PAID_FROM} value={from} onChange={setFrom} />
        </Field>
        <Field label="Note (optional)"><input className="input" id="expense-note" value={note} maxLength={200} placeholder="e.g. milk and biscuits, plumber" onChange={(e) => setNote(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

export function CashClose() {
  const { toast, askOwner, isOwner, settings } = useApp();
  const today = istDay();
  const [f, setF] = useState(null);       // what should be in the drawer now
  const [closes, setCloses] = useState(null);
  const [notes, setNotes] = useState({});
  const [typed, setTyped] = useState('');  // counted, typed as one figure
  const [byNotes, setByNotes] = useState(true);
  const [opening, setOpening] = useState('');
  const [keep, setKeep] = useState('');    // left in the drawer for tomorrow
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [redo, setRedo] = useState(false);

  const load = async () => {
    try {
      const [fig, cs] = await Promise.all([db.rpc('cash_now', {}), db.list('cash_closes', { gte: { day: addDays(today, -45) }, order: ['day', 'desc'] })]);
      setF(fig);
      setCloses(cs);
    } catch (e) {
      toast(e.message, 'bad');
      setCloses([]);
    }
  };
  useEffect(() => { load(); }, []);

  const done = (closes || []).find((c) => c.day === today);
  const counted = byNotes ? countNotes(notes) : Number(typed) || 0;
  const hasCount = byNotes ? Object.values(notes).some((v) => Number(v) > 0) : typed !== '';
  const open = f && f.first ? Number(opening) || 0 : f ? Number(f.opening_cash) : 0;
  const expected = f ? round2(open + Number(f.cash_sales) - Number(f.cash_refunds) - Number(f.cash_expenses)) : 0;
  const diff = round2(counted - expected);
  const tol = cashTolerance(settings);
  const left = keep === '' ? counted : Math.min(counted, Number(keep) || 0);
  const needNote = hasCount && Math.abs(diff) > tol && !note.trim();

  const close = async () => {
    if (busy || !hasCount || needNote) return;
    if (done && !(await askOwner('Today is already closed. Counting again is for the owner.'))) return;
    setBusy(true);
    try {
      const r = await db.rpc('close_day', { p: { counted: String(counted), taken_out: String(round2(counted - left)), opening_cash: String(open), note, notes: byNotes ? notes : null } });
      toast(Number(r.difference) === 0 ? 'Day closed: the cash matches ✓' : `Day closed: ${rupee(Math.abs(r.difference))} ${Number(r.difference) < 0 ? 'short' : 'over'}`, Number(r.difference) < -tol ? 'bad' : undefined);
      db.notify('cash_close', r.id);
      setRedo(false); setNotes({}); setTyped(''); setNote(''); setKeep('');
      load();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy(false);
  };

  if (!f || !closes) return <Loading />;
  return (
    <>
      {done && !redo ? (
        <div className="card card-pad stack" id="close-done">
          <div className="row between wrap">
            <div className="row" style={{ gap: 10 }}><CheckCircle2 size={22} color="var(--ok)" /><b>Today is closed</b><span className="muted small">{fmtTime(done.closed_at)}{done.closed_by ? ` · ${done.closed_by}` : ''}</span></div>
            <button className="btn line sm" id="close-again" onClick={async () => { if (await askOwner('Today is already closed. Counting again is for the owner.')) setRedo(true); }}>{!isOwner && <Lock size={12} />} Count again</button>
          </div>
          <CloseSummary c={done} />
          {(Number(f.bills) > 0 || Number(f.cash_expenses) !== 0) && (
            <p className="small warn-text" id="after-close">Since closing: {f.bills} {Number(f.bills) === 1 ? 'bill' : 'bills'} ({rupee(f.cash_sales)} cash){Number(f.cash_expenses) ? `, ${rupee(f.cash_expenses)} expenses from the drawer` : ''}. They are counted in tomorrow's close.</p>
          )}
        </div>
      ) : (
        <div className="close-grid">
          <div className="card card-pad stack" id="close-expected">
            <div className="sec-title">{f.first ? 'Should be in the drawer (since this morning)' : `Should be in the drawer (since the close of ${dayText(f.last_day)})`}</div>
            <dl className="kv">
              <dt>{f.first ? 'Cash the day started with' : 'Left in the drawer last time'}</dt>
              <dd>{f.first ? <MoneyInput id="close-opening" value={opening} onChange={setOpening} className="sm" /> : rupee(f.opening_cash)}</dd>
              <dt>+ Cash from bills <span className="muted">({f.bills} {Number(f.bills) === 1 ? 'bill' : 'bills'})</span></dt><dd>{rupee(f.cash_sales)}</dd>
              {Number(f.cash_refunds) > 0 && <><dt>− Cash bills cancelled since</dt><dd>−{rupee(f.cash_refunds)}</dd></>}
              <dt>− Expenses from the drawer</dt><dd>{Number(f.cash_expenses) ? `−${rupee(f.cash_expenses)}` : rupee(0)}</dd>
              <dt className="strong">Should be there</dt><dd className="strong" id="close-should">{rupee(expected)}</dd>
            </dl>
            <p className="tiny muted">UPI {rupee(f.upi_sales)} and card {rupee(f.card_sales)} are not in the drawer. Total sales {rupee(f.total_sales)}, expenses {rupee(f.expenses_total)}.</p>
          </div>
          <div className="card card-pad stack" id="close-count">
            <div className="row between">
              <div className="sec-title" style={{ margin: 0 }}>Count the drawer</div>
              <Seg options={[[true, 'By notes'], [false, 'Type the total']]} value={byNotes} onChange={setByNotes} />
            </div>
            {byNotes ? (
              <div className="notes-grid" id="close-notes">
                {NOTES.map((n) => (
                  <label key={n} className="note-row">
                    <span className="note-face">₹{n}</span><span className="muted">×</span>
                    <input className="input" inputMode="numeric" id={'note-' + n} value={notes[n] ?? ''} placeholder="0" onChange={(e) => setNotes({ ...notes, [n]: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
                    <span className="note-sum">{Number(notes[n]) ? rupee(n * Number(notes[n])) : ''}</span>
                  </label>
                ))}
              </div>
            ) : (
              <Field label="Cash counted (₹)"><MoneyInput id="close-typed" value={typed} onChange={setTyped} /></Field>
            )}
            <div className={'close-result' + (!hasCount ? '' : diff === 0 ? ' ok' : Math.abs(diff) <= tol ? ' near' : ' off')} id="close-result">
              <div className="row between"><span>Counted</span><b>{rupee(counted)}</b></div>
              <div className="row between"><span>Should be there</span><b>{rupee(expected)}</b></div>
              <div className="row between strong">
                <span>{!hasCount ? 'Difference' : diff === 0 ? 'Matches' : diff < 0 ? 'Short' : 'Over'}</span>
                <span id="close-diff">{!hasCount ? '–' : diff === 0 ? <>✓</> : <>{diff < 0 && <AlertTriangle size={15} />} {rupee(Math.abs(diff))}</>}</span>
              </div>
            </div>
            {hasCount && Math.abs(diff) > tol && (
              <Field label={`Why is it ${diff < 0 ? 'short' : 'over'}?`} hint="The owner sees this on Telegram.">
                <input className="input" id="close-note" value={note} maxLength={300} placeholder="e.g. gave ₹50 change too much" onChange={(e) => setNote(e.target.value)} />
              </Field>
            )}
            {hasCount && Math.abs(diff) <= tol && (
              <Field label="Note (optional)"><input className="input" id="close-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></Field>
            )}
            <Field label="Leave in the drawer for tomorrow (₹)" hint={hasCount ? `Taken out now: ${rupee(round2(counted - left))} (home or bank)` : 'The rest is taken out (home or bank).'}>
              <MoneyInput id="close-keep" value={keep} onChange={setKeep} placeholder={String(counted || 0)} />
            </Field>
            <div className="row" style={{ gap: 8 }}>
              {redo && <button className="btn line" onClick={() => setRedo(false)}>Back</button>}
              <button className="btn primary grow" id="close-save" disabled={busy || !hasCount || needNote} onClick={close}><Wallet size={16} /> Close the day</button>
            </div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="sec-title" style={{ padding: '14px 16px 0' }}>Earlier days</div>
        {closes.filter((c) => c.day !== today || redo).length === 0 ? <Empty title="No closes yet">Close the day each evening: the app keeps what was counted, and what was short or over.</Empty> : (
          <div className="table-wrap">
            <table className="rtable" id="close-list">
              <thead><tr><th>Day</th><th className="r">Sales</th><th className="r">Cash</th><th className="r">Expenses</th><th className="r">Should be</th><th className="r">Counted</th><th className="r">Difference</th><th className="r">Taken out</th></tr></thead>
              <tbody>
                {closes.filter((c) => c.day !== today || redo).map((c) => (
                  <tr key={c.id}>
                    <td data-label="Day"><b>{dayText(c.day)}</b>{c.note ? <div className="tiny muted">{c.note}</div> : null}</td>
                    <td data-label="Sales" className="r">{rupee(c.total_sales)}<div className="tiny muted">{c.bills} {Number(c.bills) === 1 ? 'bill' : 'bills'}</div></td>
                    <td data-label="Cash" className="r">{rupee(c.cash_sales)}</td>
                    <td data-label="Expenses" className="r">{rupee(c.expenses_total)}</td>
                    <td data-label="Should be" className="r">{rupee(c.expected)}</td>
                    <td data-label="Counted" className="r">{rupee(c.counted)}</td>
                    <td data-label="Difference" className="r strong" style={{ color: Number(c.difference) < 0 ? 'var(--bad)' : Number(c.difference) > 0 ? 'var(--warn)' : 'var(--ok)' }}>
                      {Number(c.difference) === 0 ? '✓' : `${Number(c.difference) < 0 ? '−' : '+'}${rupee(Math.abs(c.difference))}`}
                    </td>
                    <td data-label="Taken out" className="r">{rupee(c.taken_out)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function CloseSummary({ c }) {
  const d = Number(c.difference);
  return (
    <dl className="kv" id="close-summary">
      <dt>Sales</dt><dd>{rupee(c.total_sales)} <span className="muted">({c.bills} {Number(c.bills) === 1 ? 'bill' : 'bills'}: cash {rupee(c.cash_sales)}, UPI {rupee(c.upi_sales)}, card {rupee(c.card_sales)})</span></dd>
      <dt>Expenses</dt><dd>{rupee(c.expenses_total)}{Number(c.cash_expenses) ? <span className="muted"> ({rupee(c.cash_expenses)} from the drawer)</span> : null}</dd>
      <dt>Should be in the drawer</dt><dd>{rupee(c.expected)}</dd>
      <dt>Counted</dt><dd>{rupee(c.counted)}</dd>
      <dt className="strong">Difference</dt>
      <dd className="strong" style={{ color: d < 0 ? 'var(--bad)' : d > 0 ? 'var(--warn)' : 'var(--ok)' }}>{d === 0 ? 'Matches ✓' : `${rupee(Math.abs(d))} ${d < 0 ? 'short' : 'over'}`}</dd>
      {c.note && <><dt>Note</dt><dd>{c.note}</dd></>}
      <dt>Taken out</dt><dd>{rupee(c.taken_out)}</dd>
      <dt>Left for tomorrow</dt><dd>{rupee(c.closing_cash)}</dd>
    </dl>
  );
}
