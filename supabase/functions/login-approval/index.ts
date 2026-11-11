// Supabase Edge Function: login-approval
//
// 1. Right after a staff login, the billing app calls this function. It sends the owners a
//    Telegram message with Approve / Deny buttons.
// 2. When the counter needs the owner (owner screens, cancelling a bill, a big discount), the app
//    calls this function with { action: 'unlock', id }. The owners get a message saying exactly
//    what is being asked, with Approve / Deny.
// 3. When an owner taps a button, Telegram calls this function. It records the decision, and the
//    waiting screen on the tablet carries on by itself.
// 4. Sending /start to the bot replies with your Telegram chat ID (needed once during setup).
// 5. { action: 'finished', id }: a product was just marked "finished" in the app. The owners are told what to buy.
// 6. { action: 'booking', id }: the website just sent a booking request. The owners get the details to call back.
//    (The website has no login, so this only works once per booking, within 10 minutes of it being made.)
// 7. { action: 'unit', id }: stock was just given out. The owners are told if the one it replaced finished
//    early (far fewer services than normal), or if the store is now running out.
// 8. { action: 'bill', id }: a bill was just saved. The owners are told if a bottle its services use is almost
//    finished with none left in the store, or if none of it is in use in the app (taken without Give out?).
// 9. { action: 'free_use', id }: a service was recorded as done without a bill.
// 11. { action: 'enquiry', id }: the website's "Ask us" form. The owners get the question to reply on WhatsApp.
//    (No login, like 'booking': once per enquiry, within 10 minutes of it being made.)
// 10. { action: 'unit_end', id }: one of two in use was handed back empty ("One is empty"); told if it finished early.
//    7–10 work once each, within 10 minutes; the database decides what to say (the app sends only the id).
// 12. { action: 'leave', id }: a staff member asked for leave at the counter. The owners get Approve / Deny
//    (once, within 10 minutes of the request). Approved days become L in attendance by themselves.
// 13. { action: 'day' }: the morning message, once a day (the first time the app is opened, or at 9:00 by the daily
//    schedule in supabase/05_daily_schedule.sql): who is on leave today and tomorrow, leave waiting for an answer,
//    today's bookings, who didn't check in yesterday; on Mondays everyone's leave this week. Then, for planning, one
//    message per leave coming up (7, 3 and 1 days before: the bookings given to them on those days, who else is off).
// 14. { action: 'leave_plan', id }: leave was just approved in the app; if it starts within a week, the planning
//    message goes now (approving on Telegram does the same by itself).
//
// Secrets (Supabase → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN        from @BotFather
//   TELEGRAM_OWNER_CHAT_IDS   chat IDs of the owners, comma separated, e.g. 123456789,987654321
//   TELEGRAM_WEBHOOK_SECRET   any long random text; also used when connecting the bot (see README)
//   CRON_SECRET               optional: any long random text, for the daily 9:00 schedule (05_daily_schedule.sql)
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase automatically.
//
// Deploy with "Verify JWT" turned OFF: Telegram can't send a Supabase login token,
// so this function checks every caller itself (Telegram secret header, or the user's login token).

const env = (k: string) => Deno.env.get(k) || '';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function telegram(method: string, payload: unknown) {
  const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return r.json();
}

// Database access with the service key (only inside this function, never in the app)
function rest(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(init.headers || {}),
    },
  });
}

const owners = () => env('TELEGRAM_OWNER_CHAT_IDS').split(',').map((s) => s.trim()).filter(Boolean);
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

function jwtPayload(token: string) {
  const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
  return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4)));
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit' });

// The signed-in user calling this function (checked with Supabase), or null
async function caller(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const check = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` },
  });
  if (!check.ok) return null;
  const user = await check.json();
  return { token, user };
}

async function sendToOwners(text: string, yes: string, no: string) {
  let sent = 0;
  for (const chat of owners()) {
    const res = await telegram('sendMessage', {
      chat_id: chat,
      text,
      reply_markup: { inline_keyboard: [[{ text: 'Approve', callback_data: yes }, { text: 'Deny', callback_data: no }]] },
    });
    if (res.ok) sent++;
  }
  return sent;
}

async function sendTextToOwners(text: string) {
  let sent = 0;
  for (const chat of owners()) {
    const res = await telegram('sendMessage', { chat_id: chat, text });
    if (res.ok) sent++;
  }
  return sent;
}

const rupee = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const TEN_MIN = 10 * 60000;

// ---- 1. The app asks: tell the owners about my login ----
async function notifyOwners(req: Request) {
  const who = await caller(req);
  if (!who) return json({ error: 'Not signed in' }, 401);
  const token = who.token;

  const sid = String(jwtPayload(token).session_id || '');
  if (!isUuid(sid)) return json({ error: 'No session' }, 400);
  const rows = await (await rest(`login_requests?session_id=eq.${sid}&select=*`)).json();
  const r = rows[0];
  if (!r || r.status !== 'pending' || r.notified_at) return json({ ok: true, sent: 0 });

  const text =
    `Login request: Habibs billing\n\n` +
    `${r.email}\n${r.device || 'Unknown device'}\n${when(r.created_at)}\n` +
    `Code on the screen: ${sid.slice(0, 4).toUpperCase()}\n\n` +
    `Approve only if you know who is signing in.`;
  const sent = await sendToOwners(text, 'a:' + sid, 'd:' + sid);
  await rest(`login_requests?session_id=eq.${sid}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// ---- 2. The app asks: the counter needs the owner (screens, cancel, big discount) ----
async function notifyUnlock(req: Request, id: string) {
  const who = await caller(req);
  if (!who) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const rows = await (await rest(`owner_grants?id=eq.${id}&select=*`)).json();
  const g = rows[0];
  // Only the login that made the request can send it, and only once
  if (!g || g.user_id !== who.user.id || g.status !== 'pending' || g.notified_at) return json({ ok: true, sent: 0 });
  const what = g.detail || (g.action === 'unlock' ? 'Open owner screens' : g.action);
  const text =
    `Owner approval: Habibs billing\n\n` +
    `${what}\n\n` +
    `Asked by ${g.email || 'counter'}\n${g.device || 'Unknown device'}\n${when(g.created_at)}\n\n` +
    (g.action === 'unlock'
      ? 'Approve opens owner screens on that device for 10 minutes (reports, settings, salaries, cancelling bills, big discounts). Service and price changes still ask you each time.'
      : g.action === 'service'
        ? 'Approve allows only this change, once. It also changes the website.'
        : 'Approve allows only this, once.');
  const sent = await sendToOwners(text, 'ua:' + id, 'ud:' + id);
  await rest(`owner_grants?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// ---- 5. The app tells us: a product was marked finished (used up, to buy again) ----
async function notifyFinished(req: Request, id: string) {
  const who = await caller(req);
  if (!who) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const p = (await (await rest(`products?id=eq.${id}&select=*`)).json())[0];
  // once, and only right after it was marked
  if (!p || !p.finished_at || p.finished_notified_at || Date.now() - new Date(p.finished_at).getTime() > TEN_MIN) return json({ ok: true, sent: 0 });
  const since = new Date(new Date(p.finished_at).getTime() - 60000).toISOString();
  const moves = await (await rest(`stock_moves?product_id=eq.${id}&type=eq.adjust&created_at=gte.${encodeURIComponent(since)}&select=qty,unit_cost&order=created_at.desc&limit=1`)).json();
  const lost = moves[0] && Number(moves[0].qty) < 0 ? moves[0] : null;
  const lastNote = String(p.note || '').split('\n').filter(Boolean).slice(-1)[0];
  const text =
    `Finished: ${p.name}${p.brand ? ` (${p.brand})` : ''}\n\n` +
    `Marked by ${p.finished_by || 'the counter'}, ${when(p.finished_at)}.\n` +
    (lost ? `The app still showed ${-Number(lost.qty)} ${p.unit}: saved as missing (${rupee(-Number(lost.qty) * Number(lost.unit_cost || p.cost_price))}).\n` : '') +
    (lastNote ? `Note: ${lastNote}\n` : '') +
    `\nIt is on Stock → To buy. The next Stock in takes it off.`;
  const sent = await sendTextToOwners(text);
  await rest(`products?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ finished_notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// ---- 6. The website tells us: a new booking request ----
async function notifyBooking(id: string) {
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const b = (await (await rest(`bookings?id=eq.${id}&select=*,booking_items(name,option_label,price,price_from)`)).json())[0];
  if (!b || b.notified_at || Date.now() - new Date(b.created_at).getTime() > TEN_MIN) return json({ ok: true, sent: 0 });
  const items = (b.booking_items || []).map((i: any) =>
    `• ${i.name}${i.option_label ? ` (${i.option_label})` : ''}: ${i.price_from ? 'from ' : ''}${rupee(i.price)}`).join('\n');
  const day = b.want_date ? new Date(b.want_date + 'T00:00:00+05:30').toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }) : 'Any day';
  const text =
    `New booking request (${b.source})\n\n` +
    `${b.name || 'No name'}\n${b.phone}\n${day}${b.want_time ? ', ' + b.want_time : ''}\n\n${items}\n` +
    (b.note ? `\nNote: ${b.note}\n` : '') +
    `\nCall or WhatsApp to confirm. Ref ${b.ref}`;
  const sent = await sendTextToOwners(text);
  await rest(`bookings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// ---- The app tells us: the day's cash was counted and closed ----
async function notifyCashClose(req: Request, id: string) {
  const who = await caller(req);
  if (!who) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const c = (await (await rest(`cash_closes?id=eq.${id}&select=*`)).json())[0];
  if (!c || c.notified_at || Date.now() - new Date(c.closed_at).getTime() > TEN_MIN) return json({ ok: true, sent: 0 });
  const diff = Number(c.difference);
  const text =
    `Cash close: ${dayName(c.day)}\n\n` +
    `Sales ${rupee(c.total_sales)} (${c.bills} ${Number(c.bills) === 1 ? 'bill' : 'bills'}): cash ${rupee(c.cash_sales)}, UPI ${rupee(c.upi_sales)}, card ${rupee(c.card_sales)}\n` +
    `Expenses ${rupee(c.expenses_total)}${Number(c.cash_expenses) ? ` (${rupee(c.cash_expenses)} from the drawer)` : ''}\n\n` +
    `Drawer: ${rupee(c.opening_cash)} at the start + ${rupee(c.cash_sales)} cash` +
    (Number(c.cash_refunds) ? ` − ${rupee(c.cash_refunds)} cancelled bills` : '') +
    (Number(c.cash_expenses) ? ` − ${rupee(c.cash_expenses)} expenses` : '') + ` = ${rupee(c.expected)}\n` +
    `Counted: ${rupee(c.counted)} → ${diff === 0 ? 'matches ✓' : diff < 0 ? `${rupee(-diff)} SHORT` : `${rupee(diff)} over`}\n` +
    (c.note ? `Note: ${c.note}\n` : '') +
    `Taken out ${rupee(c.taken_out)}, left in the drawer ${rupee(c.closing_cash)}\n\n` +
    `Closed by ${c.closed_by || 'the counter'}, ${when(c.closed_at)}`;
  const sent = await sendTextToOwners(text);
  await rest(`cash_closes?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// Database functions only this function may call (they check the time window and send each alert once)
async function dbFn(name: string, args: Record<string, unknown>) {
  const r = await rest(`rpc/${name}`, { method: 'POST', body: JSON.stringify(args) });
  return r.ok ? r.json() : null;
}
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short' });
const n2 = (x: number) => String(Math.round(Number(x) * 100) / 100);
const plural = (unit: string, n: number) => (!unit || Number(n) === 1 || /s$/.test(unit) ? unit : unit + 's');

function earlyText(a: any) {
  const e = a.ended;
  return `Finished early: ${a.product}${a.brand ? ` (${a.brand})` : ''}\n\n` +
    `The ${a.unit} given to ${e.given_to || 'someone'} on ${day(e.started_at)} ended today after ${n2(e.uses)} uses (${n2(e.clients)} clients). ` +
    `Normal: about ${n2(e.normal)}${e.normal_source === 'set' ? ' (your number)' : ''}.\n` +
    (e.value ? `About ${rupee(e.value)} of it is not explained by bills.\n` : '') +
    (e.how === 'no_empty' ? 'The empty was not handed back.\n' : '') +
    (Number(e.early_before) > 0
      ? `\nThis product has finished early ${Number(e.early_before) + 1} times in 90 days` +
        (Number(e.early_same_person) > 0 ? ` (${Number(e.early_same_person) + 1} of them given to ${e.given_to || 'the same person'}).` : '.') + ' Time to talk to the team.\n'
      : '\nThe first time in 90 days: one bottle can fairly vary.\n') +
    `\nAsk who used it and check for services done without a bill. Details: Stock → Bottle check.`;
}

// ---- 7. The app tells us: stock was given out ----
async function notifyUnit(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const a = await dbFn('unit_alert', { p_move: id });
  if (!a) return json({ ok: true, sent: 0 });
  const parts: string[] = [];
  if (a.ended && a.ended.early) parts.push(earlyText(a));
  const stock = Number(a.stock), low = Number(a.low_stock), before = Number(a.before);
  if (stock <= 0) parts.push(`Order now: ${a.product}\n\nThe last sealed ${a.unit} was just given out${a.taker ? ` to ${a.taker}` : ''}. None left in the store.`);
  else if (stock <= low && before > low) parts.push(`Running low: ${a.product}\n\n${n2(stock)} ${plural(a.unit, stock)} left in the store (alert at ${n2(low)}). It is on Stock → To buy.`);
  if (!parts.length) return json({ ok: true, sent: 0 });
  return json({ ok: true, sent: await sendTextToOwners(parts.join('\n\n—\n\n')) });
}

// ---- 10. The app tells us: one of two in use was handed back empty ----
async function notifyUnitEnd(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const a = await dbFn('unit_end_alert', { p_move: id });
  if (!a || !a.ended || !a.ended.early) return json({ ok: true, sent: 0 });
  return json({ ok: true, sent: await sendTextToOwners(earlyText(a)) });
}

// ---- 8. The app tells us: a bill was saved ----
async function notifyBill(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const list = (await dbFn('bill_stock_alert', { p_bill: id })) || [];
  if (!Array.isArray(list) || !list.length) return json({ ok: true, sent: 0 });
  const text = list.map((x: any) => (x.kind === 'gap'
    ? `Not given out? ${x.product}${x.brand ? ` (${x.brand})` : ''}\n\n` +
      `${x.service || 'A service'} that uses it was just billed, but no ${x.unit} of it is in use in the app` +
      (Number(x.stock) > 0 ? '.' : ', and the store shows none left.') + ` Was one taken without Give out?\n\n(Told once a day.)`
    : `Almost finished: ${x.product}${x.brand ? ` (${x.brand})` : ''}\n\n` +
      `The ${x.unit} in use (given to ${x.given_to || 'someone'} on ${day(x.started_at)}) has done ${n2(x.uses)} of about ${n2(x.normal)} uses, ` +
      `and none is left in the store. Order now.`)).join('\n\n—\n\n');
  return json({ ok: true, sent: await sendTextToOwners(text) });
}

// ---- 9. The app tells us: a service was done without a bill ----
const REASON: Record<string, string> = { redo: 'Redo / complaint', staff: "Staff's own", family: 'Owner / family', training: 'Training / model', other: 'Other' };
async function notifyFreeUse(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const f = await dbFn('free_use_alert', { p_id: id });
  if (!f) return json({ ok: true, sent: 0 });
  const opt = [f.option, f.extra].filter(Boolean).join(' · ');
  const text =
    `Used without a bill: ${f.service}${opt ? ` (${opt})` : ''}${Number(f.qty) !== 1 ? ` × ${n2(f.qty)}` : ''}\n\n` +
    `Done by ${f.staff || 'not recorded'} · ${REASON[f.reason] || f.reason}\n` +
    (f.note ? `Note: ${f.note}\n` : '') +
    `Recorded by ${f.by || 'the counter'}, ${when(f.at)}. ${f.this_month} this month.`;
  return json({ ok: true, sent: await sendTextToOwners(text) });
}

// ---- 11. The website tells us: a new question ----
async function notifyEnquiry(id: string) {
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const e = (await (await rest(`enquiries?id=eq.${id}&select=*`)).json())[0];
  if (!e || e.source !== 'website' || e.notified_at || Date.now() - new Date(e.created_at).getTime() > TEN_MIN) return json({ ok: true, sent: 0 });
  let about = '';
  const ids = (e.service_ids || []).filter(isUuid);
  if (ids.length) {
    const svcs = await (await rest(`services?id=in.(${ids.join(',')})&select=name`)).json();
    about = (svcs || []).map((x: any) => x.name).join(', ');
  }
  const text =
    `New question from the website\n\n${e.name || 'No name'}\n${e.phone}\n` +
    (about ? `About: ${about}\n` : '') +
    (e.message ? `\n"${e.message}"\n` : '') +
    `\nReply on WhatsApp: https://wa.me/91${e.phone}\nIt is in the app under Appointments → Enquiries. Ref ${e.ref}`;
  const sent = await sendTextToOwners(text);
  await rest(`enquiries?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// ---- 12. The app tells us: a leave request ----
const KIND: Record<string, string> = { planned: 'Planned leave', sick: 'Medical leave', personal: 'Personal', other: 'Other' };
const dayName = (d: string) => new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: '2-digit', month: 'short' });
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T12:00:00Z').getTime() - new Date(a + 'T12:00:00Z').getTime()) / 86400000) + 1;
async function notifyLeave(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const l = (await (await rest(`leave_requests?id=eq.${id}&select=*,staff(name)`)).json())[0];
  if (!l || l.status !== 'pending' || l.notified_at || Date.now() - new Date(l.created_at).getTime() > TEN_MIN) return json({ ok: true, sent: 0 });
  // Days off already this month (week offs and leave share the paid days off)
  const month = String(l.from_day).slice(0, 7);
  const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10);
  const off = await (await rest(`attendance?staff_id=eq.${l.staff_id}&day=gte.${month}-01&day=lte.${last}&status=in.(W,L)&select=day`)).json();
  const set = (await (await rest(`settings?key=eq.paid_offs_per_month&select=value`)).json())[0];
  const paid = set && set.value != null ? Number(set.value) : 4;
  const n = daysBetween(l.from_day, l.to_day);
  const name = (l.staff && l.staff.name) || 'Staff';
  // Who else is off on those days (medical leave skips the owner's rules, so the owner sees the cover)
  const others = await (await rest(`leave_requests?staff_id=neq.${l.staff_id}&status=in.(pending,approved)&from_day=lte.${l.to_day}&to_day=gte.${l.from_day}&select=from_day,to_day,staff(name,active)`)).json();
  const marked = await (await rest(`attendance?staff_id=neq.${l.staff_id}&day=gte.${l.from_day}&day=lte.${l.to_day}&status=in.(W,L)&select=day,staff(name,active)`)).json();
  const alsoOff = new Set<string>();
  for (const o of Array.isArray(others) ? others : []) if (o.staff && o.staff.active) alsoOff.add(`${o.staff.name} (${o.from_day === o.to_day ? dayName(o.from_day) : `${dayName(o.from_day)} to ${dayName(o.to_day)}`})`);
  for (const a of Array.isArray(marked) ? marked : []) if (a.staff && a.staff.active) alsoOff.add(`${a.staff.name} (${dayName(a.day)})`);
  // Busy days (Settings: Fri, Sat, Sun): the request isn't refused, the owner decides (medical leave isn't flagged)
  const bset = (await (await rest(`settings?key=eq.leave_blocked_days&select=value`)).json())[0];
  const blocked: number[] = bset && Array.isArray(bset.value) ? bset.value.map(Number) : [5, 6, 0];
  const busy: string[] = [];
  if (l.kind !== 'sick') {
    for (let t = Date.parse(l.from_day + 'T12:00:00Z'); t <= Date.parse(l.to_day + 'T12:00:00Z'); t += 86400000) {
      const d = new Date(t).toISOString().slice(0, 10);
      if (blocked.includes(new Date(t).getUTCDay())) busy.push(dayName(d));
    }
  }
  const text =
    `Leave request: ${name}\n\n` +
    `${l.from_day === l.to_day ? dayName(l.from_day) : `${dayName(l.from_day)} to ${dayName(l.to_day)}`} (${n} ${n === 1 ? 'day' : 'days'})\n` +
    `${KIND[l.kind] || l.kind}${l.reason ? `: ${l.reason}` : ''}\n\n` +
    (busy.length ? `Busy ${busy.length === 1 ? 'day' : 'days'}: ${busy.join(', ')}. Approve only if you agree to leave then.\n\n` : '') +
    (alsoOff.size ? `Also off on these days: ${[...alsoOff].join(', ')}\n\n` : '') +
    `Days off in ${new Date(l.from_day + 'T12:00:00+05:30').toLocaleDateString('en-IN', { month: 'long' })} so far: ${Array.isArray(off) ? off.length : 0} (${paid} paid a month; more are unpaid).\n` +
    `Asked ${when(l.created_at)} by ${l.requested_by || 'the counter'}.`;
  const sent = await sendToOwners(text, 'la:' + id, 'ld:' + id);
  await rest(`leave_requests?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: new Date().toISOString() }) });
  return json({ ok: true, sent });
}

// Leave coming up: what to plan before someone goes on leave
const phone10 = (p: string) => (p && p.length === 10 ? `${p.slice(0, 5)} ${p.slice(5)}` : p || '');
const span = (a: string, b: string) => (a === b ? dayName(a) : `${dayName(a)} to ${dayName(b)}`);
function planText(p: any) {
  const first = String(p.name || '').split(' ')[0];
  const lines = [
    `Leave coming up: ${p.name}`,
    `${span(p.from, p.to)} (${p.days} ${Number(p.days) === 1 ? 'day' : 'days'}) · ${Number(p.in_days) === 1 ? 'tomorrow' : `in ${p.in_days} days`}`,
    `${KIND[p.kind] || p.kind}${p.reason ? `: ${p.reason}` : ''}`,
    '',
  ];
  const b = p.bookings || [];
  if (b.length) {
    lines.push(`Bookings with ${first} on those days (${b.length}): give them to someone else`);
    for (const x of b) {
      lines.push(`• ${dayName(x.day)}${x.time ? ' ' + x.time : ''}: ${x.name || 'Customer'} ${phone10(x.phone)}${x.services ? ` (${x.services})` : ''}${x.status === 'requested' ? ', not confirmed yet' : ''}`);
    }
    lines.push('In the app: Bookings → the day → the booking → Stylist.');
  } else lines.push(`No bookings with ${first} on those days yet.`);
  lines.push('');
  if ((p.also_off || []).length) lines.push(`Also off then: ${p.also_off.join(', ')}`);
  lines.push(`In on those days: ${p.in_least} of ${p.staff} staff${Number(p.days) > 1 ? ' (fewest on one day)' : ''}.`);
  return lines.join('\n');
}
async function sendPlan(id: string) {
  const p = await dbFn('leave_plan_due', { p_id: id });
  return p ? sendTextToOwners(planText(p)) : 0;
}

// ---- 14. The app tells us: leave was approved in the app (planning message if it starts within a week) ----
async function notifyLeavePlan(req: Request, id: string) {
  if (!(await caller(req))) return json({ error: 'Not signed in' }, 401);
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  return json({ ok: true, sent: await sendPlan(id) });
}

// ---- 13. The app tells us: the app was opened today (the database sends the morning message once a day) ----
//      Or the daily 9:00 schedule calls with the cron secret.
async function notifyDay(req: Request) {
  const cron = req.headers.get('x-cron-secret');
  const byCron = !!cron && !!env('CRON_SECRET') && cron === env('CRON_SECRET');
  if (!byCron && !(await caller(req))) return json({ error: 'Not signed in' }, 401);
  const d = await dbFn('day_summary', {});
  if (!d) return json({ ok: true, sent: 0 });
  const names = (a: string[]) => (a || []).join(', ');
  const lines: string[] = [];
  if ((d.leave_today || []).length) lines.push(`On leave today: ${names(d.leave_today)}`);
  if ((d.leave_tomorrow || []).length) lines.push(`On leave tomorrow: ${names(d.leave_tomorrow)}`);
  if ((d.pending_leave || []).length) {
    lines.push(`Leave waiting for your answer:\n` + d.pending_leave.map((x: any) => `• ${x.name}: ${x.from === x.to ? dayName(x.from) : `${dayName(x.from)} to ${dayName(x.to)}`}`).join('\n') +
      `\nTap Approve or Deny on the request, or in the app: Staff → Attendance.`);
  }
  if (Number(d.bookings_today) || Number(d.requests)) lines.push(`Bookings today: ${Number(d.bookings_today)}` + (Number(d.requests) ? ` · ${Number(d.requests)} booking requests to confirm` : ''));
  if ((d.not_checked_in || []).length) {
    lines.push(`Didn't check in yesterday: ${names(d.not_checked_in)}\nThey count as present until you mark the day (Staff → Attendance, the day before).`);
  }
  if (Array.isArray(d.week_leave)) {
    lines.push(d.week_leave.length
      ? `Leave this week:\n` + d.week_leave.map((x: any) => `• ${x.name}: ${span(x.from, x.to)}${x.status === 'pending' ? ' (waiting for your answer)' : ''}`).join('\n')
      : 'Leave this week: nobody.');
  }
  let sent = lines.length ? await sendTextToOwners(`Good morning: ${dayName(d.day)}\n\n` + lines.join('\n\n')) : 0;
  // planning: one message per leave coming up
  for (const p of d.leave_ahead || []) sent += await sendTextToOwners(planText(p));
  return json({ ok: true, sent });
}

// ---- 3. Telegram tells us: an owner tapped a button (or sent /start) ----
async function fromTelegram(update: any) {
  const msg = update.message;
  if (msg && typeof msg.text === 'string' && msg.text.startsWith('/start')) {
    await telegram('sendMessage', {
      chat_id: msg.chat.id,
      text: `Your Telegram chat ID is ${msg.chat.id}\n\nAdd it to TELEGRAM_OWNER_CHAT_IDS in Supabase (Edge Functions → Secrets) to receive login and owner approval requests.`,
    });
    return json({ ok: true });
  }

  const cq = update.callback_query;
  if (!cq) return json({ ok: true });
  if (!owners().includes(String(cq.from.id))) {
    await telegram('answerCallbackQuery', { callback_query_id: cq.id, text: 'Only an owner can approve.' });
    return json({ ok: true });
  }
  const [act, sid] = String(cq.data || '').split(':');
  if (!isUuid(sid || '') || !['a', 'd', 'ua', 'ud', 'la', 'ld'].includes(act)) return json({ ok: true });

  const yes = act === 'a' || act === 'ua' || act === 'la';
  const status = yes ? 'approved' : 'denied';
  const by = [cq.from.first_name, cq.from.last_name].filter(Boolean).join(' ') || 'Owner';
  const now = new Date();
  let res;
  if (act === 'la' || act === 'ld') {
    // Leave: no time limit; approved days become L in attendance (the database does it)
    res = await rest(`leave_requests?id=eq.${sid}&status=eq.pending`, {
      method: 'PATCH',
      body: JSON.stringify({ status: yes ? 'approved' : 'rejected', decided_at: now.toISOString(), decided_by: `${by} (Telegram)` }),
    });
  } else if (act === 'a' || act === 'd') {
    res = await rest(`login_requests?session_id=eq.${sid}&status=eq.pending`, {
      method: 'PATCH',
      body: JSON.stringify({ status, decided_at: now.toISOString(), decided_by: `${by} (Telegram)` }),
    });
  } else {
    // Owner approvals: valid for 10 minutes; a request older than 15 minutes can no longer be approved
    const since = new Date(now.getTime() - 15 * 60000).toISOString();
    res = await rest(`owner_grants?id=eq.${sid}&status=eq.pending&created_at=gte.${encodeURIComponent(since)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status, method: 'telegram', decided_at: now.toISOString(), decided_by: `${by} (Telegram)`,
        expires_at: yes ? new Date(now.getTime() + 10 * 60000).toISOString() : null,
      }),
    });
  }
  const changed = res.ok ? await res.json() : [];
  const note = changed.length ? (yes ? `Approved by ${by}` : `Denied by ${by}`) : 'This request was already answered or has expired.';

  await telegram('answerCallbackQuery', { callback_query_id: cq.id, text: note });
  if (cq.message) {
    await telegram('editMessageText', { chat_id: cq.message.chat.id, message_id: cq.message.message_id, text: `${cq.message.text}\n\n${note}` });
  }
  // leave approved that starts within a week: what to plan, now
  if (act === 'la' && changed.length) await sendPlan(sid);
  return json({ ok: true });
}

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const secret = req.headers.get('X-Telegram-Bot-Api-Secret-Token');
  if (secret !== null) {
    if (!env('TELEGRAM_WEBHOOK_SECRET') || secret !== env('TELEGRAM_WEBHOOK_SECRET')) return json({ error: 'Wrong secret' }, 401);
    return fromTelegram(await req.json());
  }
  let body: any = {};
  try { body = await req.clone().json(); } catch { /* no body */ }
  if (body && body.action === 'unlock') return notifyUnlock(req, String(body.id || ''));
  if (body && body.action === 'finished') return notifyFinished(req, String(body.id || ''));
  if (body && body.action === 'booking') return notifyBooking(String(body.id || ''));
  if (body && body.action === 'enquiry') return notifyEnquiry(String(body.id || ''));
  if (body && body.action === 'unit') return notifyUnit(req, String(body.id || ''));
  if (body && body.action === 'bill') return notifyBill(req, String(body.id || ''));
  if (body && body.action === 'free_use') return notifyFreeUse(req, String(body.id || ''));
  if (body && body.action === 'unit_end') return notifyUnitEnd(req, String(body.id || ''));
  if (body && body.action === 'leave') return notifyLeave(req, String(body.id || ''));
  if (body && body.action === 'cash_close') return notifyCashClose(req, String(body.id || ''));
  if (body && body.action === 'day') return notifyDay(req);
  if (body && body.action === 'leave_plan') return notifyLeavePlan(req, String(body.id || ''));
  return notifyOwners(req);
}

Deno.serve(handler);
