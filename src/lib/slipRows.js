// The salary slip, line by line: the same breakup on the printed slip, in the picture sent to the staff member on
// WhatsApp when the salary is marked paid, and in the plain-text copy. No browser code, so tests run it in Node.
import { rupee, fmtMonth, fmtDate, fmtPhone } from './format';

export const rupee2 = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Days off for the table and the slip (a slip saved before the day rate was kept: worked out again)
export function offsOf(c, calc, paidOffs) {
  const week = Number(c.week_off ?? c.week_off_days ?? 0), leave = Number(c.leave_days ?? 0);
  const base = Number(c.days_in_month) - paidOffs > 0 ? Number(c.days_in_month) - paidOffs : Number(c.days_in_month);
  return {
    week, leave, taken: week + leave,
    allowance: calc?.paid_offs ?? paidOffs,
    notTaken: Number(c.offs_not_taken ?? calc?.offs_not_taken ?? 0),
    unpaid: Number(c.unpaid_off_days ?? 0),
    base: c.day_rate != null && calc ? calc.work_days_base : base,
    rate: c.day_rate != null ? Number(c.day_rate) : Math.round((Number(c.monthly_salary) * 100) / base) / 100,
  };
}

const minus = (n) => (Number(n) ? '-' + rupee(n) : rupee(0));

// The breakup in three parts: [[label, value], …]. c = the saved payslip (or this month's sums), o = offsOf(…)
export function slipLines(c, o) {
  const days = Number(c.paid_days);
  return {
    days: [
      ['Monthly salary', rupee(c.monthly_salary)],
      ['Days in month', String(c.days_in_month)],
      [`Day rate (salary ÷ ${o.base} days)`, rupee2(o.rate)],
      [`Days off taken (${o.allowance} paid)`, `${o.taken} (${o.week} week off, ${o.leave} leave)`],
      ['Days off not taken (paid)', String(o.notTaken)],
      [`Days off above ${o.allowance} (not paid)`, String(o.unpaid)],
      ['Absent / half days', `${Number(c.absent_days)} / ${Number(c.half_days)}`],
      ['Days worked', String(days)],
    ],
    pay: [
      [`Salary for ${days} days worked`, rupee(c.salary_earned)],
      ['Service sales', rupee(c.service_sales)],
      ['Product sales', rupee(c.product_sales)],
      ['Commission', rupee(c.commission)],
      ['Incentive', rupee(c.incentive)],
      ['Less: advances', minus(c.advances)],
      ['Less: deductions', minus(c.deductions)],
    ],
    net: ['Net pay', rupee(c.net_pay)],
  };
}

// Rows for the picture: { t: 'center' | 'left' | 'lr' | 'sub' | 'hr', text, right, bold, big } (see receiptImage.js)
export function slipRows(slip, staff, settings, o) {
  const s = settings || {};
  const L = slipLines(slip, o);
  const rows = [];
  const C = (text, x = {}) => text && rows.push({ t: 'center', text: String(text), ...x });
  const LR = (text, right, x = {}) => rows.push({ t: 'lr', text: String(text), right: String(right), ...x });
  const HR = () => rows.push({ t: 'hr' });
  C(s.salon_name || 'Habibs Hair & Beauty', { bold: true, big: true });
  C(s.branch);
  C('Salary slip · ' + fmtMonth(slip.month), { bold: true });
  HR();
  rows.push({ t: 'left', text: staff.name, bold: true });
  const about = [staff.role, staff.phone ? fmtPhone(staff.phone) : ''].filter(Boolean).join(' · ');
  if (about) rows.push({ t: 'sub', text: about });
  HR();
  L.days.forEach(([k, v]) => LR(k, v));
  HR();
  L.pay.forEach(([k, v]) => LR(k, v));
  HR();
  LR(L.net[0], L.net[1], { bold: true, big: true });
  HR();
  if (slip.paid_on) C(`Paid on ${fmtDate(slip.paid_on)} by ${slip.paid_mode || 'cash'}`);
  if (slip.note) C(slip.note);
  rows.push({ t: 'sub', text: 'Sales and commission are after discount, without GST.' });
  return rows;
}

// The same slip as plain text (for the 2-tap WhatsApp button when the WhatsApp API isn't set up)
export function slipText(slip, staff, settings, o) {
  const s = settings || {};
  const L = slipLines(slip, o);
  const line = ([k, v]) => `${k}: ${v}`;
  return [
    `*${s.salon_name || 'Habibs Hair & Beauty'}*${s.branch ? ' · ' + s.branch : ''}`,
    `*Salary slip · ${fmtMonth(slip.month)}*`,
    staff.name,
    '',
    ...L.days.map(line),
    '',
    ...L.pay.map(line),
    '',
    `*${L.net[0]}: ${L.net[1]}*`,
    slip.paid_on ? `Paid on ${fmtDate(slip.paid_on)} by ${slip.paid_mode || 'cash'}` : null,
    slip.note || null,
  ].filter((x) => x !== null).join('\n');
}

export const slipFileName = (slip, staff) => `Salary slip ${staff.name} ${slip.month}.png`;
