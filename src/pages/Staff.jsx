import { useEffect, useMemo, useState } from 'react';
import { Plus, Lock, Printer, Trash2, ChevronLeft, ChevronRight, Check, Send } from 'lucide-react';
import { db, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { calcPayroll } from '../lib/calc';
import { rupee, istDay, istMonth, monthRange, dayRangeISO, addMonths, fmtMonth, fmtDate, fmtPhone, cleanPhone, round2 } from '../lib/format';
import { Seg, Modal, Field, MoneyInput, Empty, Loading, Confirm } from '../components/ui';
import { printNode } from '../components/Receipt';
import { Attendance, Leave, paidOffsOf, staffCounts } from './StaffAttendance';
import { FaceSection, DocsSection } from '../components/StaffExtras';
import { offsOf, rupee2, slipLines, slipText } from '../lib/slipRows';
import { waSlipsOn, sendSlipOnWhatsApp, SLIP_STATUS } from '../lib/whatsapp';

// Week offs and approved leave: this many paid days off a month (Settings), the rest unpaid
export { paidOffsOf, staffCounts };
const ROLES = ['Senior Stylist', 'Stylist', 'Beautician', 'Makeup Artist', 'Receptionist', 'Manager', 'Helper'];
const OPEN_TABS = ['att', 'leave']; // the counter can use these; the rest are for the owner

export default function Staff({ onCounts }) {
  const { askOwner, isOwner } = useApp();
  const [tab, setTab] = useState('att');
  const [counts, setCounts] = useState({ leave: 0 });
  const go = async (t) => {
    if (!OPEN_TABS.includes(t) && !(await askOwner('Salaries and payroll are for the owner only.'))) return;
    setTab(t);
  };
  useEffect(() => { if (!isOwner && !OPEN_TABS.includes(tab)) setTab('att'); }, [isOwner, tab]);
  const refresh = () => staffCounts().then((c) => { setCounts(c); if (onCounts) onCounts(c); }).catch(() => {});
  useEffect(() => { refresh(); }, [tab]);

  return (
    <div className="page">
      <div className="page-head"><h1>Staff</h1></div>
      <div className="tabs">
        {[['att', 'Attendance'], ['leave', 'Leave'], ['list', 'Staff list'], ['adv', 'Advances'], ['pay', 'Payroll']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {l} {!OPEN_TABS.includes(k) && !isOwner && <Lock size={12} />}{k === 'leave' && counts.leave > 0 && <span className="count">{counts.leave}</span>}
          </button>
        ))}
      </div>
      {tab === 'att' && <Attendance onLeave={() => setTab('leave')} />}
      {tab === 'leave' && <Leave onCounts={(c) => { setCounts(c); if (onCounts) onCounts(c); }} />}
      {tab === 'list' && <StaffList />}
      {tab === 'adv' && <Advances />}
      {tab === 'pay' && <Payroll />}
    </div>
  );
}

function MonthNav({ month, onChange }) {
  return (
    <div className="date-nav">
      <button className="icon-btn" onClick={() => onChange(addMonths(month, -1))} aria-label="Previous month"><ChevronLeft size={18} /></button>
      <b style={{ minWidth: 140, textAlign: 'center' }}>{fmtMonth(month)}</b>
      <button className="icon-btn" onClick={() => onChange(addMonths(month, 1))} disabled={month >= istMonth()} aria-label="Next month"><ChevronRight size={18} /></button>
    </div>
  );
}

// ---------------- Staff list ----------------
function StaffList() {
  const { staff, loadStaff } = useApp();
  const [edit, setEdit] = useState(null);
  const [showOld, setShowOld] = useState(false);
  const list = staff.filter((s) => showOld || s.active);
  return (
    <div className="stack">
      <div className="row between wrap">
        <label className="check"><input type="checkbox" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} /> Show staff who have left</label>
        <button className="btn primary sm" onClick={() => setEdit({})}><Plus size={15} /> Add staff</button>
      </div>
      <div className="card">
        {list.length === 0 ? <Empty title="No staff yet">Add your stylists, beauticians and front desk team.</Empty> : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Name</th><th>Role</th><th>Mobile</th><th>Joined</th><th className="r">Monthly salary</th><th className="r">Commission</th></tr></thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                    <td>{s.name} {!s.active && <span className="pill">Left</span>}</td>
                    <td>{s.role}</td>
                    <td className="nowrap">{fmtPhone(s.phone)}</td>
                    <td className="nowrap">{s.join_date ? fmtDate(s.join_date) : '–'}</td>
                    <td className="r">{rupee(s.monthly_salary)}</td>
                    <td className="r small">{Number(s.service_commission_pct)}% services · {Number(s.product_commission_pct)}% products</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <StaffModal person={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); loadStaff(); }} />}
    </div>
  );
}

function StaffModal({ person, onClose, onSaved }) {
  const { toast } = useApp();
  const isNew = !person.id;
  const [f, setF] = useState({
    name: person.name || '', phone: person.phone || '', role: person.role || 'Stylist', join_date: person.join_date || istDay(),
    monthly_salary: person.monthly_salary != null ? String(Number(person.monthly_salary)) : '',
    service_commission_pct: person.service_commission_pct != null ? String(Number(person.service_commission_pct)) : '0',
    product_commission_pct: person.product_commission_pct != null ? String(Number(person.product_commission_pct)) : '0',
    upi_id: person.upi_id || '', address: person.address || '', notes: person.notes || '', active: person.active !== false,
    leave_date: person.leave_date || '',
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  const save = async () => {
    if (!f.name.trim()) return setErr('Enter a name.');
    if (!f.active && !f.leave_date) return setErr('Enter the last working day, so the last salary is right.');
    if (f.leave_date && f.join_date && f.leave_date < f.join_date) return setErr('The last working day is before the joining date.');
    const row = {
      ...f, name: f.name.trim(), phone: f.phone || null, join_date: f.join_date || null, leave_date: f.active ? null : f.leave_date || null,
      monthly_salary: Number(f.monthly_salary) || 0, service_commission_pct: Number(f.service_commission_pct) || 0,
      product_commission_pct: Number(f.product_commission_pct) || 0, upi_id: f.upi_id || null, address: f.address || null, notes: f.notes || null,
    };
    try {
      if (isNew) await db.insert('staff', row); else await db.update('staff', person.id, row);
      toast('Saved');
      onSaved();
    } catch (e) { setErr(e.message); }
  };
  return (
    <Modal wide title={isNew ? 'Add staff' : f.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Close</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Full name"><input className="input" id="s-name" value={f.name} onChange={set('name')} /></Field>
        <Field label="Mobile"><input className="input" id="s-phone" inputMode="numeric" value={fmtPhone(f.phone)} onChange={(e) => setF({ ...f, phone: cleanPhone(e.target.value) })} /></Field>
        <Field label="Role">
          <select className="select" id="s-role" value={f.role} onChange={set('role')}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        </Field>
        <Field label="Joining date"><input className="input" id="s-join" type="date" value={f.join_date} onChange={set('join_date')} /></Field>
        <Field label="Monthly salary"><MoneyInput id="s-salary" value={f.monthly_salary} onChange={set('monthly_salary')} /></Field>
        <Field label="UPI ID for salary" hint="e.g. name@okaxis"><input className="input" id="s-upi" value={f.upi_id} onChange={set('upi_id')} /></Field>
        <Field label="Commission on services (%)" hint="Paid on their service sales after discount, without GST">
          <input className="input" id="s-scom" inputMode="decimal" value={f.service_commission_pct} onChange={(e) => setF({ ...f, service_commission_pct: e.target.value.replace(/[^\d.]/g, '') })} />
        </Field>
        <Field label="Commission on products (%)">
          <input className="input" id="s-pcom" inputMode="decimal" value={f.product_commission_pct} onChange={(e) => setF({ ...f, product_commission_pct: e.target.value.replace(/[^\d.]/g, '') })} />
        </Field>
        <Field label="Address" className="span2"><input className="input" id="s-addr" value={f.address} onChange={set('address')} /></Field>
        <Field label="Notes" className="span2"><textarea className="textarea" id="s-notes" value={f.notes} onChange={set('notes')} /></Field>
        <label className="check span2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked, leave_date: e.target.checked ? '' : f.leave_date || istDay() })} /> Currently working here (untick when someone leaves)</label>
        {!f.active && (
          <Field label="Last working day" hint="Salary is paid up to this day">
            <input className="input" id="s-leave" type="date" value={f.leave_date} min={f.join_date || undefined} onChange={set('leave_date')} />
          </Field>
        )}
      </div>
      {err && <p className="err-text" style={{ marginTop: 10 }}>{err}</p>}
      {!isNew && (
        <div className="stack" style={{ marginTop: 16 }}>
          <FaceSection person={person} />
          <DocsSection person={person} />
        </div>
      )}
      {isNew && <p className="small muted" style={{ marginTop: 12 }}>After saving, open the person again to set up face check-in and add documents (Aadhaar, PAN…).</p>}
    </Modal>
  );
}

// ---------------- Advances ----------------
function Advances() {
  const { staff, toast } = useApp();
  const [month, setMonth] = useState(istMonth());
  const [rows, setRows] = useState(null);
  const [f, setF] = useState({ staff_id: '', amount: '', day: istDay(), note: '' });
  const [del, setDel] = useState(null);
  const name = (id) => (staff.find((s) => s.id === id) || {}).name || '–';

  const load = async () => {
    const [a, b] = monthRange(month);
    try {
      setRows(await db.list('staff_advances', { gte: { day: a }, lte: { day: b }, order: ['day', 'desc'] }));
    } catch (e) {
      toast(e.message, 'bad');
      setRows([]);
    }
  };
  useEffect(() => { load(); }, [month]);

  const add = async () => {
    if (!f.staff_id || !(Number(f.amount) > 0)) return toast('Choose a staff member and enter the amount', 'bad');
    try {
      await db.insert('staff_advances', { staff_id: f.staff_id, amount: Number(f.amount), day: f.day, note: f.note || null });
    } catch (e) {
      return toast(e.message, 'bad');
    }
    toast('Advance saved. It will be cut from ' + fmtMonth(f.day.slice(0, 7)) + ' salary.');
    setF({ ...f, amount: '', note: '' });
    if (f.day.slice(0, 7) === month) load(); else setMonth(f.day.slice(0, 7));
  };

  return (
    <div className="stack loose">
      <div className="card card-pad">
        <div className="form-grid">
          <Field label="Staff">
            <select className="select" id="adv-staff" value={f.staff_id} onChange={(e) => setF({ ...f, staff_id: e.target.value })}>
              <option value="">Choose</option>
              {staff.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label="Amount"><MoneyInput id="adv-amt" value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /></Field>
          <Field label="Date"><input className="input" id="adv-day" type="date" value={f.day} max={istDay()} onChange={(e) => setF({ ...f, day: e.target.value })} /></Field>
          <Field label="Note"><input className="input" id="adv-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Optional" /></Field>
        </div>
        <button className="btn primary" style={{ marginTop: 14 }} onClick={add}><Plus size={15} /> Save advance</button>
      </div>
      <div className="row between wrap"><MonthNav month={month} onChange={setMonth} /></div>
      <div className="card">
        {rows === null ? <Loading /> : rows.length === 0 ? <Empty title="No advances this month" /> : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Date</th><th>Staff</th><th>Note</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{fmtDate(r.day)}</td><td>{name(r.staff_id)}</td><td className="small">{r.note}</td>
                    <td className="r">{rupee(r.amount)}</td>
                    <td className="r"><button className="icon-btn plain sm" aria-label="Delete" onClick={() => setDel(r)}><Trash2 size={15} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {del && (
        <Confirm title="Delete this advance?" text={`${rupee(del.amount)} for ${name(del.staff_id)} on ${fmtDate(del.day)}.`} okLabel="Delete" danger
          onClose={() => setDel(null)} onOk={async () => { await db.remove('staff_advances', del.id); setDel(null); load(); }} />
      )}
    </div>
  );
}

// ---------------- Payroll ----------------
function Payroll() {
  const { staff, toast, settings } = useApp();
  const [month, setMonth] = useState(istMonth());
  const [data, setData] = useState(null);
  const [extra, setExtra] = useState({});
  const [paying, setPaying] = useState(null);

  const load = async () => {
    setData(null);
    const [a, b] = monthRange(month);
    const [from, to] = dayRangeISO(a, b);
    let attendance, advances, bills, lines, slips, sends = [];
    try {
      [attendance, advances, bills, lines, slips] = await Promise.all([
      db.list('attendance', { gte: { day: a }, lte: { day: b } }),
      db.list('staff_advances', { gte: { day: a }, lte: { day: b } }),
      db.list('bills', { gte: { created_at: from }, lt: { created_at: to }, eq: { status: 'paid' } }),
      db.list('bill_items', { gte: { created_at: from }, lt: { created_at: to } }),
      db.list('payslips', { eq: { month } }),
      ]);
    } catch (e) {
      setData({ attendance: [], advances: [], lines: [], slips: [], error: e.message });
      return;
    }
    // salary slips sent on WhatsApp (an older database has no such column: the page still works)
    if (slips.length) sends = await db.list('wa_messages', { in: { payslip_id: slips.map((x) => x.id) }, order: ['created_at', 'desc'] }).catch(() => []);
    const paidIds = new Set(bills.map((x) => x.id));
    setData({ attendance, advances, lines: lines.filter((l) => paidIds.has(l.bill_id)), slips, sends });
  };
  useEffect(() => { load(); setExtra({}); }, [month]);

  const rows = useMemo(() => {
    if (!data) return [];
    return staff
      .filter((s) => s.active || (s.leave_date && s.leave_date >= monthRange(month)[0]) || data.slips.some((p) => p.staff_id === s.id) || data.lines.some((l) => l.staff_id === s.id))
      .map((s) => {
        const slip = data.slips.find((p) => p.staff_id === s.id);
        const ex = extra[s.id] || { incentive: slip ? slip.incentive : 0, deductions: slip ? slip.deductions : 0 };
        const calc = calcPayroll({ staff: s, month, attendance: data.attendance, advances: data.advances, lines: data.lines, extra: ex, paidOffs: paidOffsOf(settings) });
        return calc && { s, calc, slip, ex };
      })
      .filter(Boolean);
  }, [data, staff, extra, month, settings]);

  const setEx = (sid, k, v) => setExtra((e) => ({ ...e, [sid]: { ...(e[sid] || rows.find((r) => r.s.id === sid).ex), [k]: v } }));
  const totalNet = rows.reduce((a, r) => a + (r.slip ? Number(r.slip.net_pay) : r.calc.net_pay), 0);
  const current = month === istMonth();

  // The salary slip to the staff member's own WhatsApp: by itself when the salary is marked paid, again from the row
  const [sending, setSending] = useState(null);
  const [share, setShare] = useState(null);
  const sendOf = (slip) => (slip && data && data.sends ? data.sends.find((m) => m.payslip_id === slip.id) : null) || null;
  const sendSlip = async (r, slip, { again = false, quiet = false } = {}) => {
    const first = r.s.name.split(' ')[0];
    const o = offsOf(slip, r.calc, paidOffsOf(settings));
    setSending(r.s.id);
    try {
      const out = await sendSlipOnWhatsApp(slip, r.s, settings, o, { again });
      if (out && out.ok) toast(out.already ? `${first} already has this salary slip on WhatsApp` : `Salary slip sent to ${first} on WhatsApp ✓`);
      else if (out && out.setup) {
        // the WhatsApp API isn't connected: the slip as a ready message, 2 taps
        if (!quiet) {
          const ph = String(r.s.phone || '').replace(/\D/g, '').slice(-10);
          if (!/^[6-9]\d{9}$/.test(ph)) toast(`${first} has no mobile number in Staff`, 'bad');
          else setShare({ name: first, text: slipText(slip, r.s, settings, o), href: `https://wa.me/91${ph}?text=${encodeURIComponent(slipText(slip, r.s, settings, o))}` });
        }
      } else toast(`Salary slip not sent: ${(out && out.error) || 'try again'}`, 'bad');
    } catch (e) { toast(`Salary slip not sent: ${e.message}`, 'bad'); }
    setSending(null);
    if (slip.id) db.list('wa_messages', { eq: { payslip_id: slip.id }, order: ['created_at', 'desc'] }).then((rows) => setData((d) => (d ? { ...d, sends: [...rows, ...(d.sends || []).filter((m) => m.payslip_id !== slip.id)] } : d))).catch(() => {});
  };

  const printSlip = (r) => {
    if (IS_DEMO && window.self !== window.top) return toast('Printing works in the installed app.');
    const c = r.slip || r.calc;
    const o = offsOf(c, r.calc, paidOffsOf(settings));
    const L = slipLines(c, o);
    printNode(
      <div className="payslip" style={{ fontFamily: 'Jost, sans-serif', color: '#000' }}>
        <h2 style={{ fontSize: 20 }}>{settings.salon_name} · {settings.branch}</h2>
        <p>Salary slip for {fmtMonth(month)}</p>
        <hr />
        <p><b>{r.s.name}</b> · {r.s.role}{r.s.phone ? ' · ' + fmtPhone(r.s.phone) : ''}</p>
        <table style={{ marginTop: 10 }}>
          <tbody>
            {[...L.days, ...L.pay].map(([k, v]) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{v}</td></tr>)}
            <tr><td><b>{L.net[0]}</b></td><td style={{ textAlign: 'right' }}><b>{L.net[1]}</b></td></tr>
          </tbody>
        </table>
        {(r.slip ? r.slip.note : r.calc.carry_forward > 0 && `Advance of ${rupee(r.calc.carry_forward)} carried to ${fmtMonth(addMonths(month, 1))}`) && (
          <p style={{ marginTop: 12 }}>{r.slip ? r.slip.note : `Advance of ${rupee(r.calc.carry_forward)} carried to ${fmtMonth(addMonths(month, 1))}`}</p>
        )}
        {r.slip && <p style={{ marginTop: 12 }}>Paid on {fmtDate(r.slip.paid_on)} by {r.slip.paid_mode}</p>}
        <p style={{ marginTop: 40 }}>Signature: ____________________</p>
      </div>
    );
  };

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <MonthNav month={month} onChange={setMonth} />
        <span className="muted small">Net pay this month: <b className="money">{rupee(totalNet)}</b></span>
      </div>
      {current && <p className="small" style={{ color: 'var(--warn)' }}>This month is not over. Numbers will change until the last day.</p>}
      <div className="card">
        {!data ? <Loading /> : data.error ? <Empty title="Payroll could not load">{data.error}</Empty> : rows.length === 0 ? <Empty title="No staff to pay" /> : (
          <div className="table-wrap">
            <table className="rtable">
              <thead>
                <tr>
                  <th>Staff</th><th className="r">Days worked</th><th className="r">Salary</th><th className="r">Sales</th>
                  <th className="r">Commission</th><th className="r">Advance</th><th className="r">Incentive</th><th className="r">Deduction</th>
                  <th className="r">Net pay</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const c = r.slip || r.calc;
                  const o = offsOf(c, r.calc, paidOffsOf(settings));
                  return (
                    <tr key={r.s.id}>
                      <td><div className="strong">{r.s.name}</div><div className="tiny muted">{rupee(r.s.monthly_salary)}/month</div></td>
                      <td className="r pay-days">{Number(c.paid_days)} / {c.days_in_month}
                        <div className="tiny muted">{o.taken} of {o.allowance} off{Number(c.absent_days) ? `, ${Number(c.absent_days)} absent` : ''}{Number(c.half_days) ? `, ${Number(c.half_days)} half` : ''}</div>
                        {o.notTaken > 0 && <div className="tiny" style={{ color: 'var(--ok)' }}>+{o.notTaken} off not taken: paid</div>}
                        {o.unpaid > 0 && <div className="tiny strong" style={{ color: 'var(--warn)' }}>{o.unpaid} off above {o.allowance}: not paid</div>}
                      </td>
                      <td className="r">{rupee(c.salary_earned)}<div className="tiny muted">{rupee2(o.rate)} a day</div></td>
                      <td className="r">{rupee(Math.round(Number(c.service_sales) + Number(c.product_sales)))}</td>
                      <td className="r">{rupee(c.commission)}</td>
                      <td className="r">{Number(c.advances) ? '−' + rupee(c.advances) : '–'}</td>
                      <td className="r">
                        {r.slip ? rupee(r.slip.incentive) : (
                          <input className="input" style={{ width: 90, height: 34, textAlign: 'right' }} inputMode="numeric" aria-label={'Incentive for ' + r.s.name}
                            value={r.ex.incentive || ''} placeholder="0" onChange={(e) => setEx(r.s.id, 'incentive', e.target.value.replace(/\D/g, ''))} />
                        )}
                      </td>
                      <td className="r">
                        {r.slip ? rupee(r.slip.deductions) : (
                          <input className="input" style={{ width: 90, height: 34, textAlign: 'right' }} inputMode="numeric" aria-label={'Deduction for ' + r.s.name}
                            value={r.ex.deductions || ''} placeholder="0" onChange={(e) => setEx(r.s.id, 'deductions', e.target.value.replace(/\D/g, ''))} />
                        )}
                      </td>
                      <td className="r strong">{rupee(c.net_pay)}{!r.slip && r.calc.carry_forward > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}>{rupee(r.calc.carry_forward)} to next month</div>}</td>
                      <td className="r">
                        <span className="acts">
                          {r.slip ? <span className="pill ok"><Check size={12} /> Paid</span> : (
                            <button className="btn primary sm" onClick={() => setPaying(r)}>Mark paid</button>
                          )}
                          {r.slip && (
                            <button className="icon-btn plain sm slip-wa" style={{ color: 'var(--wa)' }} disabled={sending === r.s.id}
                              aria-label={`Send ${r.s.name}'s salary slip on WhatsApp`} title="Send the salary slip on WhatsApp"
                              onClick={() => sendSlip(r, r.slip, { again: !!sendOf(r.slip) })}><Send size={15} /></button>
                          )}
                          <button className="icon-btn plain sm" aria-label="Print salary slip" onClick={() => printSlip(r)}><Printer size={15} /></button>
                        </span>
                        {sendOf(r.slip) && (
                          <div className="tiny slip-wa-status" style={{ color: sendOf(r.slip).status === 'failed' ? 'var(--bad)' : 'var(--wa)' }} title={sendOf(r.slip).error || ''}>
                            {sending === r.s.id ? SLIP_STATUS.sending : SLIP_STATUS[sendOf(r.slip).status] || ''}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted small">
        Day rate = monthly salary ÷ (days in the month − {paidOffsOf(settings)} paid days off). Salary = day rate × days worked (days employed − days off − absent − half of half days).
        So {paidOffsOf(settings)} days off a month cost nothing, a day off not taken is paid one day more, and each day off above {paidOffsOf(settings)} is one day less. Days off don't carry over to next month.
        Commission is worked out on each person's sales after discount and without GST, from bills that are not cancelled.
      </p>
      {share && (
        <Modal title={`Salary slip for ${share.name}`} onClose={() => setShare(null)}
          foot={<><button className="btn line" onClick={() => setShare(null)}>Back</button><a className="btn primary wa" id="slip-wa-open" href={share.href} target="_blank" rel="noopener noreferrer" onClick={() => setShare(null)}>Open WhatsApp</a></>}>
          <p className="small muted">The WhatsApp API isn't connected yet, so the slip goes as a message from this device's WhatsApp: tap Open WhatsApp, then Send.</p>
          <p className="small note-line" style={{ marginTop: 10 }}>{share.text.replace(/\*/g, '')}</p>
        </Modal>
      )}
      {paying && <PayModal row={paying} month={month} onClose={() => setPaying(null)} onDone={async (slip) => { const r = paying; setPaying(null); await load(); if (slip && waSlipsOn(settings)) sendSlip(r, slip, { quiet: true }); }} />}
    </div>
  );
}

function PayModal({ row, month, onClose, onDone }) {
  const { toast, settings } = useApp();
  const [mode, setMode] = useState('UPI');
  const [day, setDay] = useState(istDay());
  const c = row.calc;
  const save = async () => {
    try {
      const slip = await db.upsert('payslips', {
        staff_id: row.s.id, month, days_in_month: c.days_in_month, paid_days: c.paid_days, absent_days: c.absent_days, half_days: c.half_days,
        week_off_days: c.week_off, leave_days: c.leave_days, unpaid_off_days: c.unpaid_off_days, offs_not_taken: c.offs_not_taken, day_rate: c.day_rate,
        monthly_salary: c.monthly_salary, salary_earned: c.salary_earned, service_sales: c.service_sales, product_sales: c.product_sales,
        commission: c.commission, incentive: c.incentive, advances: c.advances, deductions: c.deductions, net_pay: c.net_pay,
        status: 'paid', paid_on: day, paid_mode: mode,
        note: c.carry_forward ? `Advance of ${rupee(c.carry_forward)} carried to ${fmtMonth(addMonths(month, 1))}` : null,
      }, 'staff_id,month');
      // Advances bigger than the pay: the rest is cut from next month's salary
      if (c.carry_forward > 0) {
        await db.insert('staff_advances', { staff_id: row.s.id, day: addMonths(month, 1) + '-01', amount: c.carry_forward, note: `Carried from ${fmtMonth(month)} salary` });
      }
      toast(`${row.s.name}: ${rupee(c.net_pay)} marked paid`);
      onDone(slip);
    } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <Modal title={'Pay ' + row.s.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" onClick={save}>Mark {rupee(c.net_pay)} paid</button></>}>
      <div className="stack">
        <dl className="kv">
          <dt>Salary for {c.paid_days} days worked <span className="muted">× {rupee2(c.day_rate)}</span></dt><dd>{rupee(c.salary_earned)}</dd>
          {c.offs_not_taken > 0 && <><dt className="muted">…includes {c.offs_not_taken} day{c.offs_not_taken === 1 ? '' : 's'} off not taken</dt><dd className="muted">+{rupee(Math.round(c.offs_not_taken * c.day_rate))}</dd></>}
          {c.unpaid_off_days > 0 && <><dt style={{ color: 'var(--warn)' }}>{c.unpaid_off_days} day{c.unpaid_off_days === 1 ? '' : 's'} off above {c.paid_offs}: not paid</dt><dd style={{ color: 'var(--warn)' }}>−{rupee(Math.round(c.unpaid_off_days * c.day_rate))}</dd></>}
          <dt>Commission</dt><dd>{rupee(c.commission)}</dd>
          <dt>Incentive</dt><dd>{rupee(c.incentive)}</dd>
          <dt>Advances</dt><dd>−{rupee(c.advances)}</dd>
          <dt>Deductions</dt><dd>−{rupee(c.deductions)}</dd>
          <dt className="strong">Net pay</dt><dd className="strong">{rupee(c.net_pay)}</dd>
        </dl>
        {c.carry_forward > 0 && (
          <p className="small" style={{ color: 'var(--warn)' }}>
            Advances are {rupee(c.carry_forward)} more than this month's pay. That amount will be cut from {fmtMonth(addMonths(month, 1))} salary.
          </p>
        )}
        <Field label="Paid by"><Seg full options={[['Cash', 'Cash'], ['UPI', 'UPI'], ['Bank', 'Bank']]} value={mode} onChange={setMode} /></Field>
        <Field label="Date"><input className="input" id="pay-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} /></Field>
        {row.s.upi_id && <p className="small muted">UPI ID: {row.s.upi_id}</p>}
        <p className="small muted">This saves the salary slip. Numbers for {fmtMonth(month)} are then fixed for this person.</p>
        {waSlipsOn(settings) && (
          <p className="small" id="pay-slip-note" style={{ color: /^[6-9]\d{9}$/.test(String(row.s.phone || '').replace(/\D/g, '').slice(-10)) ? 'var(--wa)' : 'var(--warn)' }}>
            {/^[6-9]\d{9}$/.test(String(row.s.phone || '').replace(/\D/g, '').slice(-10))
              ? `The salary slip with this breakup goes to ${row.s.name.split(' ')[0]} on WhatsApp (${fmtPhone(row.s.phone)}).`
              : `${row.s.name.split(' ')[0]} has no mobile number in Staff, so the slip can't go on WhatsApp. Add the number first, or print the slip.`}
          </p>
        )}
      </div>
    </Modal>
  );
}

