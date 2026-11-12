// Expenses and the daily cash close. Same maths as cash_now() and close_day() in supabase/01_schema.sql:
// a close covers everything since the close before it (or since this morning, before the first one).
import { istDay, round2 } from './format';

export const NOTES = [500, 200, 100, 50, 20, 10, 5, 2, 1];
export const PAID_FROM = [['cash', 'Cash drawer'], ['upi', 'UPI'], ['bank', 'Bank / card'], ['owner', "Owner's pocket"]];
export const PAID_FROM_LABEL = Object.fromEntries(PAID_FROM);
export const DEFAULT_CATEGORIES = ['Tea & snacks', 'Cleaning', 'Laundry', 'Supplies', 'Repairs', 'Electricity', 'Rent', 'Internet & phone', 'Transport', 'Marketing', 'Other'];
export const expenseCategories = (settings) => (Array.isArray(settings && settings.expense_categories) && settings.expense_categories.length ? settings.expense_categories : DEFAULT_CATEGORIES);
export const cashTolerance = (settings) => { const n = Number(settings && settings.cash_tolerance); return settings && settings.cash_tolerance != null && settings.cash_tolerance !== '' && !isNaN(n) ? Math.max(0, n) : 10; };

// The notes counted → rupees. notes: { "500": 4, "200": 1, … }
export const countNotes = (notes) => round2(NOTES.reduce((a, n) => a + n * (Math.max(0, Math.floor(Number((notes || {})[n]) || 0))), 0));

const sum = (rows, f) => round2(rows.reduce((a, r) => a + (Number(f(r)) || 0), 0));

// What should be in the drawer now
//   Change given back by UPI: the note stayed in the drawer (cash + change), the change went out by UPI.
//   Dues collected (due_payments) come in on the day they are paid; given back if their bill is cancelled later.
export function cashNow({ bills, expenses, closes, dues = [], now = new Date() }) {
  const last = [...(closes || [])].sort((a, b) => (a.closed_at < b.closed_at ? 1 : -1))[0] || null;
  const start = last ? last.closed_at : new Date(istDay(now) + 'T00:00:00+05:30').toISOString();
  const t = (v) => new Date(v).getTime();
  const s = t(start), n = t(now);
  const paid = (bills || []).filter((b) => b.status === 'paid' && t(b.created_at) > s && t(b.created_at) <= n);
  const exp = (expenses || []).filter((e) => !e.cancelled_at && t(e.created_at) > s);
  const gone = last ? (bills || []).filter((b) => b.status === 'cancelled' && b.cancelled_at && t(b.cancelled_at) > s) : [];
  const goneIds = new Set(gone.map((b) => b.id));
  const refunds = last ? round2(sum(gone.filter((b) => t(b.created_at) <= s), (b) => b.paid_cash)
    + sum((dues || []).filter((d) => d.mode === 'cash' && t(d.created_at) <= s && goneIds.has(d.bill_id)), (d) => d.amount)) : 0;
  const back = last ? sum((expenses || []).filter((e) => e.paid_from === 'cash' && t(e.created_at) <= s && e.cancelled_at && t(e.cancelled_at) > s), (e) => e.amount) : 0;
  const opening = last ? Number(last.closing_cash) || 0 : 0;
  const stillPaid = new Set((bills || []).filter((b) => b.status === 'paid').map((b) => b.id));
  const col = (dues || []).filter((d) => t(d.created_at) > s && t(d.created_at) <= n && stillPaid.has(d.bill_id));
  const colBy = (m) => sum(col.filter((d) => d.mode === m), (d) => d.amount);
  const cashSales = round2(sum(paid, (b) => Number(b.paid_cash) + (Number(b.change_upi) || 0)) + colBy('cash'));
  const cashExp = round2(sum(exp.filter((e) => e.paid_from === 'cash'), (e) => e.amount) - back);
  return {
    first: !last, from_at: last ? last.closed_at : null, last_day: last ? last.day : null,
    opening_cash: opening, cash_sales: cashSales, cash_refunds: refunds, cash_expenses: cashExp,
    expected: round2(opening + cashSales - refunds - cashExp),
    bills: paid.length, total_sales: sum(paid, (b) => b.total),
    upi_sales: round2(sum(paid, (b) => Number(b.paid_upi) - (Number(b.change_upi) || 0)) + colBy('upi')),
    card_sales: round2(sum(paid, (b) => b.paid_card) + colBy('card')),
    expenses_total: sum(exp, (e) => e.amount), due_collected: sum(col, (d) => d.amount),
  };
}

const MONEY = /^[0-9]+(\.[0-9]{1,2})?$/;
const trim = (n) => String(round2(n));

// Checks a new expense like add_expense(); returns the row to save. owner: may add for an earlier day
export function checkExpense(p, { today = istDay(), owner = false } = {}) {
  if (!MONEY.test(String(p.amount ?? ''))) throw new Error('Type the amount');
  const amount = Number(p.amount);
  if (amount <= 0 || amount > 500000) throw new Error('Type the amount (up to ₹5,00,000)');
  const category = String(p.category || '').trim().slice(0, 40);
  if (!category) throw new Error('Choose what it was for');
  const paid_from = p.paid_from || 'cash';
  if (!PAID_FROM_LABEL[paid_from]) throw new Error('Choose how it was paid');
  const day = /^\d{4}-\d{2}-\d{2}$/.test(p.day || '') ? p.day : today;
  if (day > today) throw new Error("The day can't be after today");
  if (day < today && !owner) throw new Error('Only the owner can add an expense for an earlier day');
  const back = Math.round((new Date(today + 'T12:00:00Z') - new Date(day + 'T12:00:00Z')) / 86400000);
  if (back > 60) throw new Error('At most 60 days back');
  return { day, amount, category, note: String(p.note || '').trim().slice(0, 200) || null, paid_from };
}

// Works out a close like close_day(); returns the row to save (without id, day, closed_by)
export function checkClose(p, figures, settings) {
  if (!MONEY.test(String(p.counted ?? ''))) throw new Error('Type the cash counted');
  const counted = Number(p.counted);
  if (counted > 10000000) throw new Error('Type the cash counted');
  if (!MONEY.test(String(p.taken_out ?? '0'))) throw new Error('Type the cash taken out');
  const taken = Number(p.taken_out ?? 0);
  if (taken > counted) throw new Error("Cash taken out can't be more than the cash counted");
  let opening = figures.opening_cash;
  if (figures.first) {
    if (!MONEY.test(String(p.opening_cash ?? '0'))) throw new Error('Type the cash the day started with');
    opening = Number(p.opening_cash ?? 0);
  }
  const expected = round2(opening + figures.cash_sales - figures.cash_refunds - figures.cash_expenses);
  const difference = round2(counted - expected);
  const note = String(p.note || '').trim().slice(0, 300) || null;
  if (Math.abs(difference) > cashTolerance(settings) && !note) throw new Error(`The cash is ₹${trim(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}. Write why in the note.`);
  return {
    from_at: figures.from_at, opening_cash: opening, cash_sales: figures.cash_sales, cash_refunds: figures.cash_refunds, cash_expenses: figures.cash_expenses,
    expected, counted, difference, taken_out: taken, closing_cash: round2(counted - taken),
    notes: p.notes && typeof p.notes === 'object' && !Array.isArray(p.notes) ? p.notes : null, note,
    bills: figures.bills, total_sales: figures.total_sales, upi_sales: figures.upi_sales, card_sales: figures.card_sales, expenses_total: figures.expenses_total,
    due_collected: figures.due_collected || 0,
  };
}
