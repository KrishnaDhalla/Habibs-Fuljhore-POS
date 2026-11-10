// Payroll tests: random staff, months, joins/leaves, attendance, advances and sales,
// checked against a simple day-by-day reference.
import { calcPayroll } from '../src/lib/calc.js';
import { offsOf, slipLines, slipRows, slipText } from '../src/lib/slipRows.js';

let seed = Number(process.env.SEED || 3);
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
let checks = 0;
const fails = {};
const check = (n, c, d) => { checks++; if (!c) { fails[n] = fails[n] || { count: 0, first: typeof d === 'function' ? d() : d }; fails[n].count++; } };

const iso = (d) => d.toISOString().slice(0, 10);
const daysOf = (month) => {
  const [y, m] = month.split('-').map(Number);
  const out = [];
  for (let d = new Date(Date.UTC(y, m - 1, 1)); d.getUTCMonth() === m - 1; d.setUTCDate(d.getUTCDate() + 1)) out.push(iso(d));
  return out;
};
const halfUp = (x) => Math.floor(x + 0.5 + 1e-9);

const MONTHS = ['2026-01', '2026-02', '2026-04', '2026-06', '2026-10', '2026-12', '2027-02', '2028-02', '2100-02', '2000-02'];
const DIM = { '2026-01': 31, '2026-02': 28, '2026-04': 30, '2026-06': 30, '2026-10': 31, '2026-12': 31, '2027-02': 28, '2028-02': 29, '2100-02': 28, '2000-02': 29 };

for (let i = 0; i < 20000; i++) {
  const month = pick(MONTHS);
  const days = daysOf(month);
  check('days in month (leap years too)', days.length === DIM[month], month);
  const shift = (n) => { const d = new Date(days[0] + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const join = pick([null, shift(-400), shift(-1), days[0], shift(ri(0, days.length - 1)), days[days.length - 1], shift(days.length + 3)]);
  let leave = pick([null, null, null, shift(-5), days[0], shift(ri(0, days.length - 1)), days[days.length - 1], shift(days.length + 10)]);
  if (leave && join && leave < join) leave = null;
  const staff = { id: 's1', monthly_salary: pick([0, 8000, 12000, 15000, 18500, 21999.5]), service_commission_pct: pick([0, 5, 8, 10, 12.5]), product_commission_pct: pick([0, 2, 5]), join_date: join, leave_date: leave };
  const att = [];
  for (const d of [shift(-1), ...days, shift(days.length)]) if (rnd() < 0.3) att.push({ staff_id: pick(['s1', 's1', 's2']), day: d, status: pick(['P', 'A', 'H', 'W', 'W', 'L']) });
  const paidOffs = pick([4, 4, 4, 0, 2, 6]);
  // one row per staff per day, like the database
  const seen = new Set();
  const attendance = att.filter((a) => { const k = a.staff_id + a.day; if (seen.has(k)) return false; seen.add(k); return true; });
  const advances = Array.from({ length: ri(0, 3) }, () => ({ staff_id: pick(['s1', 's2']), amount: pick([500, 1000, 2500, 30000]) }));
  // a staff member's own service: commission on the price before the staff price (commission_base)
  const lines = Array.from({ length: ri(0, 30) }, () => {
    const l = { staff_id: pick(['s1', 's1', 's2']), item_type: pick(['service', 'service', 'product']), taxable: ri(0, 500000) / 100 };
    if (l.item_type === 'service' && rnd() < 0.2) l.commission_base = Math.round((l.taxable + ri(0, 300000) / 100) * 100) / 100;
    return l;
  });
  const extra = { incentive: pick([0, 0, 500, 1000]), deductions: pick([0, 0, 200]) };
  const r = calcPayroll({ staff, month, attendance, advances, lines, extra, paidOffs });

  // reference, day by day
  const first = days[0], last = days[days.length - 1];
  if ((join && join > last) || (leave && leave < first)) { check('not employed this month → no payslip', r === null, JSON.stringify({ join, leave, month })); continue; }
  check('employed this month → payslip', r !== null, JSON.stringify({ join, leave, month }));
  if (!r) continue;
  const worked = days.filter((d) => (!join || d >= join) && (!leave || d <= leave));
  const mine = attendance.filter((a) => a.staff_id === 's1' && worked.includes(a.day));
  const absent = mine.filter((a) => a.status === 'A').length;
  const half = mine.filter((a) => a.status === 'H').length;
  const offs = mine.filter((a) => a.status === 'W' || a.status === 'L').length;
  const allowance = halfUp((paidOffs * worked.length) / days.length);
  const unpaidOff = Math.max(0, offs - allowance);
  // day rate = salary ÷ (days in month − paid days off); paid for the days worked
  const base = days.length - paidOffs > 0 ? days.length - paidOffs : days.length;
  const paidDays = Math.max(0, worked.length - absent - half / 2 - offs);
  const salary = halfUp((staff.monthly_salary * paidDays) / base);
  const s = (t) => lines.filter((l) => l.staff_id === 's1' && l.item_type === t).reduce((a, l) => a + Math.round((l.commission_base ?? l.taxable) * 100), 0) / 100;
  const commission = halfUp((s('service') * staff.service_commission_pct) / 100 + (s('product') * staff.product_commission_pct) / 100);
  const adv = advances.filter((a) => a.staff_id === 's1').reduce((a, x) => a + x.amount, 0);
  const raw = salary + commission + extra.incentive - adv - extra.deductions;
  const ctx = () => JSON.stringify({ month, join, leave, staff, absent, half, worked: worked.length, r });
  check('employed days', r.employed_days === worked.length, ctx);
  check('days worked = employed − absent − ½ half days − days off', r.paid_days === paidDays, ctx);
  check('days off: week offs and leave counted, the allowance in proportion, not taken / unpaid', r.unpaid_off_days === unpaidOff && r.paid_offs === allowance && r.week_off + r.leave_days === offs && r.offs_not_taken === Math.max(0, allowance - offs), ctx);
  check('day rate = salary ÷ (days in month − paid days off)', r.work_days_base === base && Math.abs(r.day_rate - staff.monthly_salary / base) < 0.006, ctx);
  check('only this person\'s days in range counted', r.absent_days === absent && r.half_days === half, ctx);
  check('salary = day rate × days worked', r.salary_earned === salary, ctx);
  check('service sales (own services at full price) and product sales', Math.abs(r.service_sales - s('service')) < 0.001 && Math.abs(r.product_sales - s('product')) < 0.001, ctx);
  check('commission', r.commission === commission, ctx);
  check('advances = this person only', r.advances === adv, ctx);
  check('net pay never below 0', r.net_pay === Math.max(0, raw), ctx);
  check('extra advance carried forward', r.carry_forward === Math.max(0, -raw), ctx);
  check('net − carry = salary + commission + incentive − advances − deductions', r.net_pay - r.carry_forward === raw, ctx);
  check('full month, no absences, exactly the paid days off = the monthly salary', !(worked.length === days.length && !absent && !half && offs === paidOffs && paidOffs < days.length) || r.salary_earned === halfUp(staff.monthly_salary), ctx);
  if (worked.length === days.length && !absent && !half && paidOffs < days.length) {
    check('each day off not taken is one day rate more, each above the paid ones one less (no carry over)',
      Math.abs(r.salary_earned - (staff.monthly_salary + (paidOffs - offs) * staff.monthly_salary / base)) <= 0.5 + 1e-9, ctx);
  }
}
// hand-picked
const one = (o) => calcPayroll({ paidOffs: o.paidOffs ?? 4, staff: { id: 'a', monthly_salary: 15000, service_commission_pct: 10, product_commission_pct: 5, ...o.staff }, month: o.month, attendance: o.att || [], advances: o.adv || [], lines: o.lines || [], extra: o.extra || {} });
let r = one({ month: '2026-11', staff: { join_date: '2026-11-16' } });
check('joined on 16 Nov (30-day month), no days off → 15 days × ₹15,000 ÷ 26 = ₹8,654', r.paid_days === 15 && r.salary_earned === 8654 && r.paid_offs === 2 && r.offs_not_taken === 2, JSON.stringify(r));
r = one({ month: '2026-10', staff: { leave_date: '2026-10-10' } });
check('left on 10 Oct → 10 days × ₹15,000 ÷ 27 = ₹5,556', r.paid_days === 10 && r.salary_earned === 5556, JSON.stringify(r));
r = one({ month: '2028-02', att: [{ staff_id: 'a', day: '2028-02-29', status: 'A' }, { staff_id: 'a', day: '2028-02-10', status: 'H' }] });
check('leap February: 29 days, 1 absent, 1 half, no days off → 27.5 days × ₹15,000 ÷ 25', r.days_in_month === 29 && r.paid_days === 27.5 && r.salary_earned === Math.round(15000 * 27.5 / 25), JSON.stringify(r));
r = one({ month: '2026-10', adv: [{ staff_id: 'a', amount: 20000 }] });
check('advance ₹20,000, no days off taken (₹17,222) → pay ₹0, ₹2,778 carried', r.net_pay === 0 && r.carry_forward === 2778, JSON.stringify(r));
r = one({ month: '2026-10', lines: [{ staff_id: 'a', item_type: 'service', taxable: 12345.67 }, { staff_id: 'a', item_type: 'product', taxable: 1000 }] });
check('commission 10% of ₹12,345.67 + 5% of ₹1,000 = ₹1,285', r.commission === 1285, JSON.stringify(r));
r = one({ month: '2026-10', lines: [{ staff_id: 'a', item_type: 'service', taxable: 0, commission_base: 349 }, { staff_id: 'a', item_type: 'service', taxable: 899.5, commission_base: 1799 }] });
check("staff's own services: commission on the full price (₹349 free + ₹1,799 at half) = ₹215", r.service_sales === 2148 && r.commission === 215, JSON.stringify(r));
const offs = (days) => days.map(([d, st]) => ({ staff_id: 'a', day: `2026-11-${String(d).padStart(2, '0')}`, status: st }));
const twenty = (o) => one({ ...o, staff: { monthly_salary: 20000, ...(o.staff || {}) } });
r = twenty({ month: '2026-11', att: offs([[3, 'L'], [10, 'L'], [17, 'L'], [24, 'L']]) });
check('the owner\'s example: ₹20,000, November, 4 days off → day rate ₹769.23, salary ₹20,000', r.day_rate === 769.23 && r.paid_days === 26 && r.salary_earned === 20000, JSON.stringify(r));
r = twenty({ month: '2026-11', att: offs([[3, 'L'], [10, 'L']]) });
check('2 days off not taken → paid 28 days = ₹21,538', r.offs_not_taken === 2 && r.salary_earned === 21538, JSON.stringify(r));
r = twenty({ month: '2026-11' });
check('no day off at all → 30 days = ₹23,077', r.offs_not_taken === 4 && r.salary_earned === 23077, JSON.stringify(r));
r = twenty({ month: '2026-11', att: offs([[3, 'L'], [10, 'L'], [11, 'L'], [17, 'L'], [24, 'L'], [25, 'L']]) });
check('6 days off → 2 unpaid: 24 days = ₹18,462', r.unpaid_off_days === 2 && r.salary_earned === 18462, JSON.stringify(r));
r = twenty({ month: '2026-12', att: [] });
check('December (31 days): day rate = ₹20,000 ÷ 27 = ₹740.74', r.day_rate === 740.74 && r.salary_earned === Math.round(20000 * 31 / 27), JSON.stringify(r));
r = one({ month: '2026-11', att: offs([[10, 'L'], [11, 'L'], [12, 'L'], [13, 'L']]) });
check('4 days of leave taken together, no week offs → the full ₹15,000', r.unpaid_off_days === 0 && r.leave_days === 4 && r.salary_earned === 15000, JSON.stringify(r));
r = one({ month: '2026-11', att: offs([[2, 'W'], [9, 'W'], [16, 'W'], [23, 'W'], [30, 'W']]) });
check('a fifth day off in the month is unpaid (4 a month)', r.unpaid_off_days === 1 && r.salary_earned === Math.round(15000 * 25 / 26), JSON.stringify(r));
r = one({ month: '2026-11', staff: { join_date: '2026-11-16' }, att: offs([[16, 'W'], [23, 'W'], [30, 'W']]) });
check('joined mid-month: 2 paid days off (4 × 15/30), the third unpaid; paid 12 days', r.paid_offs === 2 && r.unpaid_off_days === 1 && r.paid_days === 12, JSON.stringify(r));
r = one({ month: '2026-11', paidOffs: 0, att: offs([[2, 'W']]) });
check('no paid days off set → day rate = salary ÷ 30, every day off unpaid', r.unpaid_off_days === 1 && r.paid_days === 29 && r.salary_earned === 14500, JSON.stringify(r));

// ---------- the salary slip (printed, and the picture sent to the staff member on WhatsApp) ----------
{
  const c = twenty({ month: '2026-11', att: offs([[3, 'L'], [10, 'W'], [17, 'A'], [24, 'H']]), adv: [{ staff_id: 'a', day: '2026-11-05', amount: 1500 }],
    lines: [{ staff_id: 'a', item_type: 'service', taxable: 30000, commission_base: 30000 }, { staff_id: 'a', item_type: 'product', taxable: 4000, commission_base: 4000 }], extra: { incentive: 500, deductions: 200 } });
  // what Mark paid saves
  const slip = { id: 'p1', month: '2026-11', days_in_month: c.days_in_month, paid_days: c.paid_days, absent_days: c.absent_days, half_days: c.half_days, week_off_days: c.week_off, leave_days: c.leave_days,
    unpaid_off_days: c.unpaid_off_days, offs_not_taken: c.offs_not_taken, day_rate: c.day_rate, monthly_salary: c.monthly_salary, salary_earned: c.salary_earned, service_sales: c.service_sales, product_sales: c.product_sales,
    commission: c.commission, incentive: c.incentive, advances: c.advances, deductions: c.deductions, net_pay: c.net_pay, status: 'paid', paid_on: '2026-12-01', paid_mode: 'UPI', note: null };
  const st = { name: 'Priya Das', role: 'Stylist', phone: '9800000001' };
  const set = { salon_name: 'Habibs Hair & Beauty', branch: 'Fuljhore, Durgapur' };
  const o = offsOf(slip, c, 4);
  const L = slipLines(slip, o);
  const get = (k) => ([...L.days, ...L.pay].find(([x]) => x.startsWith(k)) || [])[1];
  check('slip: 2 days off taken of 4, 2 not taken (paid), 1 absent, 1 half → 26.5 days worked at ₹769.23', get('Day rate (salary ÷ 26 days)') === '₹769.23' && get('Days off taken (4 paid)') === '2 (1 week off, 1 leave)'
    && get('Days off not taken') === '2' && get('Days off above 4') === '0' && get('Absent / half') === '1 / 1' && get('Days worked') === '26.5', JSON.stringify(L));
  const n = (v) => Number(String(v).replace(/[₹,]/g, ''));
  check('slip: salary + commission + incentive − advances − deductions = net pay', n(get('Salary for 26.5 days worked')) + n(get('Commission')) + n(get('Incentive')) + n(get('Less: advances')) + n(get('Less: deductions')) === n(L.net[1]) && n(L.net[1]) === c.net_pay
    && get('Less: advances') === '-₹1,500' && get('Less: deductions') === '-₹200', JSON.stringify(L));
  const rows = slipRows(slip, st, set, o);
  const texts = rows.map((r) => [r.text, r.right].filter(Boolean).join(' | '));
  check('slip picture: salon, month, name, every line of the breakup, net pay big, how it was paid', texts[0] === 'Habibs Hair & Beauty' && texts.includes('Salary slip · November 2026') && texts.includes('Priya Das')
    && texts.includes('Stylist · 98000 00001') && [...L.days, ...L.pay].every(([k, v]) => texts.includes(`${k} | ${v}`)) && rows.some((r) => r.text === 'Net pay' && r.right === L.net[1] && r.big && r.bold)
    && texts.includes('Paid on 01 Dec 2026 by UPI'), JSON.stringify(texts));
  check('slip picture: only row kinds the picture knows, no empty line', rows.every((r) => ['center', 'left', 'lr', 'sub', 'hr'].includes(r.t) && (r.t === 'hr' || r.text)));
  const t = slipText(slip, st, set, o);
  check('slip as a message: the same lines', t.startsWith('*Habibs Hair & Beauty* · Fuljhore, Durgapur\n*Salary slip · November 2026*\nPriya Das\n') && [...L.days, ...L.pay].every(([k, v]) => t.includes(`${k}: ${v}`)) && t.includes(`*Net pay: ${L.net[1]}*`) && t.endsWith('Paid on 01 Dec 2026 by UPI'), t);
  const withNote = slipRows({ ...slip, advances: 0, note: 'Advance of ₹2,000 carried to December 2026' }, { name: 'Rahul' }, {}, o).map((r) => r.text);
  check('slip: the carried-advance note is on it; no advances shows ₹0, not -₹0; no role or phone → no empty line', withNote.includes('Advance of ₹2,000 carried to December 2026') && slipLines({ ...slip, advances: 0 }, o).pay.find(([k]) => k === 'Less: advances')[1] === '₹0' && !withNote.includes(''));
  // a slip saved before the day rate was kept: worked out again from the salary
  const old = offsOf({ ...slip, day_rate: null, offs_not_taken: null }, null, 4);
  check('an old slip without a day rate: worked out again (₹20,000 ÷ 26)', old.rate === 769.23 && old.base === 26 && old.notTaken === 0);
}

const names = Object.keys(fails);
console.log(`${checks.toLocaleString()} payroll checks, ${names.length ? names.length + ' kinds of failure' : 'no failures'}`);
for (const n of names) console.log(`✗ ${n}: ${fails[n].count}×  e.g. ${String(fails[n].first).slice(0, 500)}`);
process.exitCode = names.length ? 1 : 0;
