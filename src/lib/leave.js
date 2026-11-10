// Leave and attendance helpers (no browser code, so tests run them in Node).
// Week offs (W) and approved leave (L) share the paid days off of a month (Settings, 4 by default).
// Pay is a day rate (salary ÷ (days in month − 4)) for each day worked, so a day off not taken is paid extra
// and a day off above 4 is not paid; nothing carries to next month. Same rule as calcPayroll().
//
// The salon's leave rules (Settings → Staff rules), checked when leave is asked (request_leave() in the database):
//  1. No days off on Friday, Saturday or Sunday (leave_blocked_days), except medical leave.
//  2. One person off a day (leave_one_at_a_time): not when someone else has leave asked, approved or marked.
//  3. Two or more days off in the last week of the month (from the 22nd) are asked at least 14 days before
//     (leave_notice_days): saving the month's days off for the end.
//  Medical leave is not held to 1–3 (the owner still approves it).
import { addDays, monthDays, monthRange, istDay } from './format';

export const LEAVE_KINDS = [['planned', 'Planned'], ['sick', 'Medical'], ['personal', 'Personal'], ['other', 'Other']];
export const LEAVE_KIND = Object.fromEntries(LEAVE_KINDS);
export const LEAVE_STATUS = { pending: 'Waiting for the owner', approved: 'Approved', rejected: 'Refused', cancelled: 'Cancelled' };

export const daysIn = (from, to) => Math.round((new Date(to + 'T12:00:00Z') - new Date(from + 'T12:00:00Z')) / 86400000) + 1;
export function eachDay(from, to) {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

// The leave rules from Settings
export function leaveRules(settings = {}) {
  const v = (k, d) => (settings[k] == null || settings[k] === '' ? d : settings[k]);
  const blocked = v('leave_blocked_days', [5, 6, 0]);
  return {
    blocked: (Array.isArray(blocked) ? blocked : []).map(Number).filter((x) => x >= 0 && x <= 6),
    notice: Math.max(0, Number(v('leave_notice_days', 14)) || 0),
    oneAtATime: v('leave_one_at_a_time', true) !== false && v('leave_one_at_a_time', true) !== 'false',
  };
}
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WD_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dow = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
// "Sat 14 Nov" (the same as to_char(d, 'Dy DD Mon') in the database)
export const ruleDay = (d) => `${WD[dow(d)]} ${d.slice(8, 10)} ${MON[Number(d.slice(5, 7)) - 1]}`;
// "Friday, Saturday or Sunday" (Monday first)
export const blockedText = (blocked) => {
  const n = [...blocked].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((x) => WD_LONG[x]);
  return n.length > 1 ? n.slice(0, -1).join(', ') + ' or ' + n[n.length - 1] : n[0] || '';
};

// The first leave rule a request breaks, or null. Same answers as leave_rule_error() in the database.
//   leaves: leave_requests; attendance: rows; staff: everyone (only active staff count for "one person off")
export function leaveRuleError({ staffId, from, to, kind, today = istDay(), leaves, attendance, staff, settings }) {
  if (kind === 'sick') return null;
  const r = leaveRules(settings);
  const days = eachDay(from, to || from);
  // 1. busy days
  const bad = days.find((d) => r.blocked.includes(dow(d)));
  if (bad) return `${ruleDay(bad)}: no days off on ${blockedText(r.blocked)}, except medical leave`;
  // 2. one person off a day
  const offOn = (sid, d) => leaves.some((l) => l.staff_id === sid && ['pending', 'approved'].includes(l.status) && l.from_day <= d && l.to_day >= d)
    || attendance.some((a) => a.staff_id === sid && a.day === d && (a.status === 'W' || a.status === 'L'));
  if (r.oneAtATime) {
    const others = staff.filter((s) => s.active && s.id !== staffId).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of days) {
      const o = others.find((s) => offOn(s.id, d));
      if (o) return `Only one person can be off a day: ${o.name} is off on ${ruleDay(d)}`;
    }
  }
  // 3. two or more days off in the last week of a month: asked in time
  for (const month of [...new Set(days.map((d) => d.slice(0, 7)))]) {
    const [, last] = monthRange(month);
    const lastWeek = eachDay(month + '-22', last);
    const mine = days.filter((d) => d >= month + '-22' && d <= last);
    if (!mine.length) continue;
    const n = lastWeek.filter((d) => mine.includes(d) || offOn(staffId, d)).length;
    const lead = daysIn(today, mine[0]) - 1;
    if (n >= 2 && lead < r.notice) {
      return `2 or more days off in the last week of the month (from the 22nd) must be asked ${r.notice} days before: by ${ruleDay(addDays(mine[0], -r.notice))}`;
    }
  }
  return null;
}

// Who else is off on these days (asked or approved leave, a week off or leave marked): [{ name, day }]
export function othersOff({ staffId, from, to, leaves, attendance, staff }) {
  const out = [];
  for (const d of eachDay(from, to || from)) {
    for (const s of staff.filter((x) => x.active && x.id !== staffId)) {
      const off = leaves.some((l) => l.staff_id === s.id && ['pending', 'approved'].includes(l.status) && l.from_day <= d && l.to_day >= d)
        || attendance.some((a) => a.staff_id === s.id && a.day === d && (a.status === 'W' || a.status === 'L'));
      if (off) out.push({ name: s.name, day: d });
    }
  }
  return out;
}

// Approved leave covering a day
export const leaveOn = (leaves, day, staffId) =>
  leaves.filter((l) => l.status === 'approved' && l.from_day <= day && l.to_day >= day && (!staffId || l.staff_id === staffId));

// The paid days off this person gets in a month (in proportion for a part month, like the payroll)
export function allowanceOf(staff, month, paidOffs) {
  const [first, last] = monthRange(month);
  if ((staff.join_date && staff.join_date > last) || (staff.leave_date && staff.leave_date < first)) return 0;
  const from = staff.join_date && staff.join_date > first ? staff.join_date : first;
  const to = staff.leave_date && staff.leave_date < last ? staff.leave_date : last;
  return Math.round(((Number(paidOffs) || 0) * daysIn(from, to)) / monthDays(month));
}

// What a leave request would do to each month it touches:
// [{ month, used, adds, after, allowance, unpaid, newUnpaid }]
//   used: week offs + leave already in attendance; adds: request days that will become L (not a week off, a day
//   they came, a half day or leave already); unpaid: after − allowance (at least 0); newUnpaid: what this request adds
export function offsPreview({ staff, attendance, from, to, paidOffs }) {
  const days = eachDay(from, to || from);
  const months = [...new Set(days.map((d) => d.slice(0, 7)))];
  const att = attendance.filter((a) => a.staff_id === staff.id);
  return months.map((month) => {
    const used = att.filter((a) => a.day.startsWith(month) && (a.status === 'W' || a.status === 'L')).length;
    const adds = days.filter((d) => d.startsWith(month)).filter((d) => {
      const a = att.find((x) => x.day === d);
      return !a || a.status === 'A';
    }).length;
    const allowance = allowanceOf(staff, month, paidOffs);
    const after = used + adds;
    const unpaid = Math.max(0, after - allowance);
    return { month, used, adds, after, allowance, unpaid, newUnpaid: unpaid - Math.max(0, used - allowance) };
  });
}

// Days someone with face check-in neither checked in nor was marked: the owner decides (they count as present
// until then). From the day their face was set up (or they joined), up to yesterday.
export function missedCheckIns({ staff, faces, checks, attendance, from, to, today = istDay() }) {
  const out = [];
  const last = to < today ? to : addDays(today, -1);
  for (const s of staff) {
    const f = faces.find((x) => x.staff_id === s.id);
    if (!f || !s.active) continue;
    let start = istDay(new Date(f.created_at || f.consent_at));
    if (s.join_date && s.join_date > start) start = s.join_date;
    if (from > start) start = from;
    const end = s.leave_date && s.leave_date < last ? s.leave_date : last;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      if (checks.some((c) => c.staff_id === s.id && c.day === d)) continue;
      if (attendance.some((a) => a.staff_id === s.id && a.day === d)) continue;
      out.push({ staff_id: s.id, day: d });
    }
  }
  return out;
}

const dayText = (d) => new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });
export const leaveDays = (l) => (l.from_day === l.to_day ? dayText(l.from_day) : `${dayText(l.from_day)} to ${dayText(l.to_day)}`);

// WhatsApp to the staff member: the owner's answer, or a reminder the day before
export function leaveMessage(kind, l, name, settings) {
  const salon = (settings && settings.salon_name) || 'Habibs';
  const first = String(name || '').split(' ')[0] || 'there';
  const n = daysIn(l.from_day, l.to_day);
  const back = addDays(l.to_day, 1);
  if (kind === 'approved') return `Hi ${first}, your leave for ${leaveDays(l)} (${n} ${n === 1 ? 'day' : 'days'}) is approved. See you back on ${dayText(back)}. – ${salon}`;
  if (kind === 'rejected') return `Hi ${first}, sorry, your leave for ${leaveDays(l)} could not be approved. Please talk to the owner. – ${salon}`;
  if (kind === 'remind') return `Hi ${first}, a reminder: your leave starts ${l.from_day === addDays(istDay(), 1) ? 'tomorrow' : 'on ' + dayText(l.from_day)} (${leaveDays(l)}). See you back on ${dayText(back)}. – ${salon}`;
  return `Hi ${first}, about your leave for ${leaveDays(l)}. – ${salon}`;
}
