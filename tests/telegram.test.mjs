// Telegram function (supabase/functions/login-approval): owner approval requests, with fake Telegram and fake Supabase
const ENV = { SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  TELEGRAM_BOT_TOKEN: 'BOT', TELEGRAM_OWNER_CHAT_IDS: '111, 222', TELEGRAM_WEBHOOK_SECRET: 's3cret', CRON_SECRET: 'cr0n' };
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: () => {} };
const gid = 'c1e4c3a2-1111-4222-8333-944455556666';
const old = 'd2e4c3a2-1111-4222-8333-944455556666';
const grants = [
  { id: gid, user_id: 'u1', email: 'counter@habibsfuljhore.in', device: 'Android tablet · Chrome', action: 'cancel', detail: 'Cancel bill HF2627-0042 · ₹2,400 · reason: wrong service', status: 'pending', created_at: new Date().toISOString(), notified_at: null },
  { id: old, user_id: 'u1', action: 'unlock', status: 'pending', created_at: new Date(Date.now() - 20 * 60000).toISOString(), notified_at: null },
];
const tg = [];
let checks = 0, fails = 0;
const ok = (n, c, d = '') => { checks++; if (!c) { fails++; console.log('✗', n, d); } };
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  if (u.host === 'api.telegram.org') { tg.push([u.pathname.split('/').pop(), JSON.parse(init.body)]); return res({ ok: true }); }
  if (u.pathname === '/auth/v1/user') return init.headers.Authorization === 'Bearer ' + TOKEN ? res({ id: 'u1' }) : init.headers.Authorization === 'Bearer ' + OTHER ? res({ id: 'u2' }) : res({}, 401);
  if (u.pathname === '/rest/v1/owner_grants') {
    if (init.headers.Authorization !== 'Bearer service') return res([], 401);
    const id = (u.searchParams.get('id') || '').replace('eq.', '');
    const st = (u.searchParams.get('status') || '').replace('eq.', '');
    const since = (u.searchParams.get('created_at') || '').replace('gte.', '');
    const hit = grants.filter((r) => r.id === id && (!st || r.status === st) && (!since || r.created_at >= since));
    if ((init.method || 'GET') === 'PATCH') hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
    return res(hit);
  }
  // database functions for the stock alerts: only with the service key
  if (u.pathname.startsWith('/rest/v1/rpc/')) {
    if (init.headers.Authorization !== 'Bearer service') return res({ message: 'permission denied' }, 401);
    rpcCalls.push([u.pathname.split('/').pop(), JSON.parse(init.body)]);
    const fn = RPC[u.pathname.split('/').pop()];
    return res(fn ? fn(JSON.parse(init.body)) : null);
  }
  if (u.pathname === '/rest/v1/cash_closes') {
    const cid = (u.searchParams.get('id') || '').replace('eq.', '');
    const hit = closes.filter((c) => c.id === cid);
    if ((init.method || 'GET') === 'PATCH') { hit.forEach((c) => Object.assign(c, JSON.parse(init.body))); return res(hit); }
    return res(hit);
  }
  // leave: the request (with the staff name), days off this month, the setting
  if (u.pathname === '/rest/v1/leave_requests') {
    if (init.headers.Authorization !== 'Bearer service') return res([], 401);
    const id = (u.searchParams.get('id') || '').replace('eq.', '');
    const st = (u.searchParams.get('status') || '').replace('eq.', '');
    // someone else's leave on those days
    const not = (u.searchParams.get('staff_id') || '').startsWith('neq.') ? u.searchParams.get('staff_id').slice(4) : null;
    if (not) {
      const sts = st.replace(/^in\.\(|\)$/g, '').split(',');
      const to = (u.searchParams.get('from_day') || '').replace('lte.', ''), from = (u.searchParams.get('to_day') || '').replace('gte.', '');
      return res(leaves.filter((r) => r.staff_id !== not && sts.includes(r.status) && r.from_day <= to && r.to_day >= from).map((r) => ({ from_day: r.from_day, to_day: r.to_day, staff: { ...r.staff, active: r.staff.active !== false } })));
    }
    const hit = leaves.filter((r) => r.id === id && (!st || r.status === st));
    if ((init.method || 'GET') === 'PATCH') hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
    return res(hit);
  }
  if (u.pathname === '/rest/v1/attendance') {
    const sq = u.searchParams.get('staff_id') || '';
    const sid = sq.replace(/^n?eq\./, ''), neq = sq.startsWith('neq.');
    const days = u.searchParams.getAll('day');
    const from = (days.find((x) => x.startsWith('gte.')) || '').slice(4), to = (days.find((x) => x.startsWith('lte.')) || '').slice(4);
    const sts = (u.searchParams.get('status') || '').replace(/^in\.\(|\)$/g, '').split(',');
    return res(attendance.filter((a) => (neq ? a.staff_id !== sid : a.staff_id === sid) && a.day >= from && a.day <= to && sts.includes(a.status))
      .map((a) => ({ ...a, staff: STAFF_NAMES[a.staff_id] })));
  }
  if (u.pathname === '/rest/v1/settings') return res([{ value: 4 }]);
  // products, stock_moves and bookings for the "finished" and "booking" messages
  const table = { '/rest/v1/products': products, '/rest/v1/stock_moves': moves, '/rest/v1/bookings': bookings, '/rest/v1/enquiries': enquiries, '/rest/v1/services': svcRows }[u.pathname];
  if (table) {
    if (init.headers.Authorization !== 'Bearer service') return res([], 401);
    const idq = u.searchParams.get('id') || '';
    if (idq.startsWith('in.(')) return res(table.filter((r) => idq.slice(4, -1).split(',').includes(r.id)));
    const id = idq.replace('eq.', '');
    const pid = (u.searchParams.get('product_id') || '').replace('eq.', '');
    const hit = table.filter((r) => (!id || r.id === id) && (!pid || r.product_id === pid));
    if ((init.method || 'GET') === 'PATCH') hit.forEach((r) => Object.assign(r, JSON.parse(init.body)));
    return res(hit);
  }
  return res({}, 404);
};
const rpcCalls = [];
const mEarly = '01e4c3a2-1111-4222-8333-944455556666', mLow = '02e4c3a2-1111-4222-8333-944455556666', mNone = '03e4c3a2-1111-4222-8333-944455556666';
const ended = { given_to: 'Rahul Roy', started_at: '2026-11-02T06:30:00Z', how: 'no_empty', uses: 4, clients: 3, first: false, normal: 10, normal_source: 'set', early: true, value: 270 };
let daySummary = null;
// leave coming up: what the database gives for planning
const PLAN = { id: 'p1', name: 'Amit Das', from: '2026-11-19', to: '2026-11-20', days: 2, in_days: 7, kind: 'planned', reason: "Sister's wedding",
  bookings: [{ day: '2026-11-19', time: '05:00 pm', name: 'Megha Agarwal', phone: '9831100012', status: 'confirmed', services: 'Keratin (L · Thick)' },
    { day: '2026-11-20', time: 'Evening', name: 'Riya Sen', phone: '9830012345', status: 'requested', services: null }],
  also_off: ['Priya Saha (Thu 19 Nov)'], staff: 4, in_least: 2 };
const PLAN1 = { id: 'p2', name: 'Sneha Paul', from: '2026-11-08', to: '2026-11-08', days: 1, in_days: 1, kind: 'sick', reason: null, bookings: [], also_off: [], staff: 4, in_least: 3 };
const planCalls = [];
const RPC = {
  day_summary: () => daySummary,
  leave_plan_due: ({ p_id }) => { planCalls.push(p_id); return planCalls.filter((x) => x === p_id).length === 1 && p_id === PLAN_FOR ? PLAN : null; },
  unit_alert: ({ p_move }) => (p_move === mEarly ? { product: 'Developer 1 L', brand: "L'Oreal", unit: 'bottle', taker: 'Amit Das', stock: 0, low_stock: 1, before: 1, ended }
    : p_move === mLow ? { product: 'Spa cream', unit: 'jar', taker: 'Amit Das', stock: 1, low_stock: 1, before: 2, ended: { ...ended, early: false } }
      : p_move === mNone ? { product: 'Spa cream', unit: 'jar', stock: 4, low_stock: 1, before: 5, ended: null } : null),
  bill_stock_alert: ({ p_bill }) => (p_bill === mEarly ? [{ kind: 'almost', product: 'Developer 1 L', brand: "L'Oreal", unit: 'bottle', uses: 9.5, normal: 10, given_to: 'Amit Das', started_at: '2026-11-04T06:30:00Z' }]
    : p_bill === mLow ? [{ kind: 'gap', product: 'Hair Spa Cream', unit: 'jar', stock: 0, service: "L'Oreal Hair Spa Women" }] : []),
  free_use_alert: ({ p_id }) => (p_id === mEarly ? { service: 'Global Colour Women', option: 'L', extra: 'Thick', qty: 1, staff: 'Rahul Roy', reason: 'redo', note: 'uneven colour', by: 'counter@habibsfuljhore.in', at: '2026-11-06T08:00:00Z', this_month: 3 } : null),
  unit_end_alert: ({ p_move }) => (p_move === mEarly ? { product: 'Developer 1 L', unit: 'bottle', ended: { ...ended, early_before: 2, early_same_person: 1 } } : p_move === mLow ? { product: 'Developer 1 L', unit: 'bottle', ended: { ...ended, early: false } } : null),
};
const pid = 'a1e4c3a2-1111-4222-8333-944455556666', pid2 = 'b1e4c3a2-1111-4222-8333-944455556666';
const bid = 'e1e4c3a2-1111-4222-8333-944455556666', bid2 = 'f1e4c3a2-1111-4222-8333-944455556666';
const products = [
  { id: pid, name: 'Hair Spa Cream 500 g', brand: 'Raaga', unit: 'jar', cost_price: 900, finished_at: new Date().toISOString(), finished_by: 'counter@habibsfuljhore.in', finished_notified_at: null, note: 'Order 3 from Sample distributor' },
  { id: pid2, name: 'Shampoo', unit: 'pcs', cost_price: 300, finished_at: null },
];
const moves = [{ product_id: pid, type: 'adjust', qty: -2, unit_cost: 900, created_at: new Date().toISOString() }];
const bookings = [
  { id: bid, ref: '7F3A2C', phone: '9830012345', name: 'Riya Sen', source: 'website', want_date: '2026-11-08', want_time: 'Evening', note: 'First visit', created_at: new Date().toISOString(), notified_at: null,
    booking_items: [{ name: 'Global Colour Women', option_label: 'M', price: 3500, price_from: false }, { name: 'Bridal Makeup', option_label: null, price: 10000, price_from: true }] },
  { id: bid2, ref: 'OLD111', phone: '9830099999', name: 'Old', source: 'website', created_at: new Date(Date.now() - 30 * 60000).toISOString(), notified_at: null, booking_items: [] },
];
const eid = '11e4c3a2-1111-4222-8333-944455556666', eid2 = '12e4c3a2-1111-4222-8333-944455556666', sNano = '13e4c3a2-1111-4222-8333-944455556666';
const svcRows = [{ id: sNano, name: 'Nano-Active / Plastia' }];
const enquiries = [
  { id: eid, ref: 'AB12CD', phone: '9831100021', name: 'Ananya', source: 'website', message: 'Price for waist-length hair?', service_ids: [sNano], created_at: new Date().toISOString(), notified_at: null },
  { id: eid2, ref: 'ZZ99ZZ', phone: '9831100022', name: 'Counter one', source: 'whatsapp', message: 'x', service_ids: null, created_at: new Date().toISOString(), notified_at: null },
];
const lid = '21e4c3a2-1111-4222-8333-944455556666', lid2 = '22e4c3a2-1111-4222-8333-944455556666', lid3 = '23e4c3a2-1111-4222-8333-944455556666', sAmit = '31e4c3a2-1111-4222-8333-944455556666';
const leaves = [
  { id: lid, staff_id: sAmit, staff: { name: 'Amit Das' }, from_day: '2026-11-12', to_day: '2026-11-14', kind: 'planned', reason: "Sister's wedding", status: 'pending', requested_by: 'counter@habibsfuljhore.in', created_at: new Date().toISOString(), notified_at: null },
  { id: lid2, staff_id: sAmit, staff: { name: 'Amit Das' }, from_day: '2026-11-20', to_day: '2026-11-20', kind: 'sick', status: 'pending', created_at: new Date(Date.now() - 30 * 60000).toISOString(), notified_at: null },
  { id: lid3, staff_id: sAmit, staff: { name: 'Amit Das' }, from_day: '2026-11-19', to_day: '2026-11-21', kind: 'sick', reason: 'Fever', status: 'pending', created_at: new Date().toISOString(), notified_at: null },
  { id: 'x4', staff_id: 's4', staff: { name: 'Sneha Paul' }, from_day: '2026-11-18', to_day: '2026-11-19', kind: 'planned', status: 'approved', created_at: new Date().toISOString() },
  { id: 'x5', staff_id: 's5', staff: { name: 'Old Leave' }, from_day: '2026-11-19', to_day: '2026-11-19', kind: 'planned', status: 'cancelled', created_at: new Date().toISOString() },
];
let PLAN_FOR = null;
const closes = [
  { id: '31e4c3a2-1111-4222-8333-944455556666', day: '2026-11-10', closed_at: new Date().toISOString(), opening_cash: 2000, cash_sales: 4200, cash_refunds: 500, cash_expenses: 150, expected: 5550, counted: 5500, difference: -50,
    taken_out: 3500, closing_cash: 2000, note: 'Gave ₹50 change too much', bills: 18, total_sales: 12340, upi_sales: 7140, card_sales: 1000, expenses_total: 350, closed_by: 'counter@habibs', notified_at: null },
  { id: '32e4c3a2-1111-4222-8333-944455556666', day: '2026-11-11', closed_at: new Date().toISOString(), opening_cash: 2000, cash_sales: 0, cash_refunds: 0, cash_expenses: 0, expected: 2000, counted: 2000, difference: 0,
    taken_out: 0, closing_cash: 2000, note: null, bills: 1, total_sales: 800, upi_sales: 800, card_sales: 0, expenses_total: 0, closed_by: null, notified_at: null },
  { id: '33e4c3a2-1111-4222-8333-944455556666', day: '2026-11-01', closed_at: new Date(Date.now() - 3600e3).toISOString(), opening_cash: 0, cash_sales: 0, cash_refunds: 0, cash_expenses: 0, expected: 0, counted: 0, difference: 0, taken_out: 0, closing_cash: 0, bills: 0, total_sales: 0, upi_sales: 0, card_sales: 0, expenses_total: 0, notified_at: null },
];
const STAFF_NAMES = { [sAmit]: { name: 'Amit Das', active: true }, s2: { name: 'Priya Saha', active: true }, s3: { name: 'Rahul Roy', active: false } };
const attendance = [{ staff_id: 's2', day: '2026-11-20', status: 'W' }, { staff_id: 's3', day: '2026-11-20', status: 'L' }, { staff_id: sAmit, day: '2026-11-02', status: 'W' }, { staff_id: sAmit, day: '2026-11-09', status: 'W' }, { staff_id: sAmit, day: '2026-11-05', status: 'A' }, { staff_id: sAmit, day: '2026-10-30', status: 'L' }];
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'x.' + b64({ sub: 'u1', session_id: gid }) + '.sig';
const OTHER = 'x.' + b64({ sub: 'u2', session_id: gid }) + '.sig';
const { handler } = await import('../supabase/functions/login-approval/index.ts');
const call = async (headers, body) => { const r = await handler(new Request('https://fn', { method: 'POST', headers, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const tgcall = (data, from = { id: 111, first_name: 'Krishna' }) => call({ 'X-Telegram-Bot-Api-Secret-Token': 's3cret' }, { callback_query: { id: 'q', from, data, message: { chat: { id: from.id }, message_id: 9, text: 'Owner approval…' } } });

ok('not signed in → refused', (await call({}, { action: 'unlock', id: gid }))[0] === 401);
ok('another user cannot send my request', (await call({ Authorization: 'Bearer ' + OTHER }, { action: 'unlock', id: gid }))[1].sent === 0 && tg.length === 0);
const r = await call({ Authorization: 'Bearer ' + TOKEN }, { action: 'unlock', id: gid });
ok('request sent to both owners', r[1].sent === 2 && tg.length === 2, JSON.stringify(r));
ok('message says exactly what is asked', /Cancel bill HF2627-0042 · ₹2,400 · reason: wrong service/.test(tg[0][1].text) && /only this, once/.test(tg[0][1].text), tg[0][1].text);
ok('buttons Approve/Deny', JSON.stringify(tg[0][1].reply_markup.inline_keyboard[0].map((b) => b.callback_data)) === JSON.stringify(['ua:' + gid, 'ud:' + gid]));
tg.length = 0;
ok('sent only once', (await call({ Authorization: 'Bearer ' + TOKEN }, { action: 'unlock', id: gid }))[1].sent === 0 && tg.length === 0);
await tgcall('ua:' + gid, { id: 999, first_name: 'Stranger' });
ok('stranger cannot approve', grants[0].status === 'pending' && /Only an owner/.test(tg.pop()[1].text));
tg.length = 0;
await tgcall('ua:' + gid, { id: 222, first_name: 'Raj' });
ok('owner approves → approved for 10 minutes', grants[0].status === 'approved' && grants[0].decided_by === 'Raj (Telegram)' && Math.abs(new Date(grants[0].expires_at) - Date.now() - 600000) < 5000, JSON.stringify(grants[0]));
ok('owner told and message updated', tg.some(([m, p]) => m === 'answerCallbackQuery' && /Approved by Raj/.test(p.text)) && tg.some(([m]) => m === 'editMessageText'));
tg.length = 0;
await tgcall('ud:' + gid);
ok('second owner taps Deny later → no change', grants[0].status === 'approved' && /already answered/.test(tg[0][1].text));
await tgcall('ua:' + old);
ok('request older than 15 minutes cannot be approved', grants[1].status === 'pending');

// a product marked finished
tg.length = 0;
ok('finished: not signed in → refused', (await call({}, { action: 'finished', id: pid }))[0] === 401);
const f1 = await call({ Authorization: 'Bearer ' + TOKEN }, { action: 'finished', id: pid });
ok('finished: both owners told what to buy', f1[1].sent === 2 && /Finished: Hair Spa Cream 500 g \(Raaga\)/.test(tg[0][1].text) && !tg[0][1].reply_markup, JSON.stringify(f1) + (tg[0] && tg[0][1].text));
ok('finished: says what was written off, and the note', /still showed 2 jar: saved as missing \(₹1,800\)/.test(tg[0][1].text) && /Order 3 from Sample distributor/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('finished: told only once', (await call({ Authorization: 'Bearer ' + TOKEN }, { action: 'finished', id: pid }))[1].sent === 0 && tg.length === 0);
ok('finished: a product that is not finished sends nothing', (await call({ Authorization: 'Bearer ' + TOKEN }, { action: 'finished', id: pid2 }))[1].sent === 0 && tg.length === 0);
// a booking from the website (no login)
const b1 = await call({}, { action: 'booking', id: bid });
ok('booking: owners get name, phone, day, services and prices', b1[1].sent === 2 && /Riya Sen\n9830012345/.test(tg[0][1].text) && /Global Colour Women \(M\): ₹3,500/.test(tg[0][1].text)
  && /Bridal Makeup: from ₹10,000/.test(tg[0][1].text) && /Ref 7F3A2C/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('booking: sent only once', (await call({}, { action: 'booking', id: bid }))[1].sent === 0 && tg.length === 0);
ok('booking: an old booking is not sent again', (await call({}, { action: 'booking', id: bid2 }))[1].sent === 0 && tg.length === 0);
ok('booking: a made-up id sends nothing', (await call({}, { action: 'booking', id: 'abc' }))[0] === 400);
// stock alerts: the database decides what to say; the app sends only the id
tg.length = 0;
const A = { Authorization: 'Bearer ' + TOKEN };
for (const action of ['unit', 'bill', 'free_use', 'unit_end']) {
  ok(`${action}: not signed in → refused`, (await call({}, { action, id: mEarly }))[0] === 401 && tg.length === 0);
  ok(`${action}: a made-up id → refused`, (await call(A, { action, id: 'x' }))[0] === 400);
}
const u1 = await call(A, { action: 'unit', id: mEarly });
const t1 = tg[0] && tg[0][1].text;
ok('unit: owners told it finished early, with uses, normal, who and the value', u1[1].sent === 2 && /Finished early: Developer 1 L \(L'Oreal\)/.test(t1) && /given to Rahul Roy on 02 Nov ended today after 4 uses \(3 clients\)/.test(t1)
  && /Normal: about 10 \(your number\)/.test(t1) && /About ₹270 of it is not explained by bills/.test(t1) && /empty was not handed back/.test(t1), t1);
ok('unit: the first early one in 90 days says one bottle can vary', /first time in 90 days: one bottle can fairly vary/.test(t1), t1);
ok('unit: …and to order now (last sealed one given out), in the same message', /Order now: Developer 1 L/.test(t1) && /last sealed bottle was just given out to Amit Das. None left in the store/.test(t1) && tg.length === 2);
ok('unit: the database function is called with the service key and only the id', rpcCalls.some(([n, b]) => n === 'unit_alert' && b.p_move === mEarly && Object.keys(b).length === 1));
tg.length = 0;
const u2 = await call(A, { action: 'unit', id: mLow });
ok('unit: not early, stock just crossed the alert → running low', u2[1].sent === 2 && /Running low: Spa cream/.test(tg[0][1].text) && /1 jar left in the store \(alert at 1\)/.test(tg[0][1].text) && !/Finished early/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('unit: nothing to say → nothing sent', (await call(A, { action: 'unit', id: mNone }))[1].sent === 0 && tg.length === 0);
ok('unit: already sent (database says null) → nothing', (await call(A, { action: 'unit', id: pid }))[1].sent === 0 && tg.length === 0);
const b3 = await call(A, { action: 'bill', id: mEarly });
ok('bill: almost finished with none in the store → order now', b3[1].sent === 2 && /Almost finished: Developer 1 L/.test(tg[0][1].text) && /has done 9.5 of about 10 uses, and none is left in the store. Order now/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('bill: nothing almost finished → nothing sent', (await call(A, { action: 'bill', id: pid }))[1].sent === 0 && tg.length === 0);
const g3 = await call(A, { action: 'bill', id: mLow });
ok('bill: a service billed with none in use → "Not given out?"', g3[1].sent === 2 && /Not given out\? Hair Spa Cream/.test(tg[0][1].text) && /L'Oreal Hair Spa Women that uses it was just billed, but no jar of it is in use/.test(tg[0][1].text)
  && /store shows none left/.test(tg[0][1].text) && /once a day/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
const f3 = await call(A, { action: 'free_use', id: mEarly });
ok('free use: service, option, who, why, note, count this month', f3[1].sent === 2 && /Used without a bill: Global Colour Women \(L · Thick\)/.test(tg[0][1].text) && /Done by Rahul Roy · Redo \/ complaint/.test(tg[0][1].text)
  && /Note: uneven colour/.test(tg[0][1].text) && /3 this month/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('free use: already sent → nothing', (await call(A, { action: 'free_use', id: pid }))[1].sent === 0 && tg.length === 0);
ok('one is empty: finished early → told', (await call(A, { action: 'unit_end', id: mEarly }))[1].sent === 2 && /Finished early: Developer 1 L/.test(tg[0][1].text));
ok('repeats: "finished early 3 times in 90 days (2 of them given to Rahul Roy)"', /finished early 3 times in 90 days \(2 of them given to Rahul Roy\)\. Time to talk to the team/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('one is empty: not early → nothing', (await call(A, { action: 'unit_end', id: mLow }))[1].sent === 0 && tg.length === 0);
// a question from the website's "Ask us" form (no login)
tg.length = 0;
const q1 = await call({}, { action: 'enquiry', id: eid });
ok('enquiry: owners get the name, number, services, question and a WhatsApp link', q1[1].sent === 2 && /New question from the website/.test(tg[0][1].text) && /Ananya\n9831100021/.test(tg[0][1].text)
  && /About: Nano-Active \/ Plastia/.test(tg[0][1].text) && /"Price for waist-length hair\?"/.test(tg[0][1].text) && /wa\.me\/919831100021/.test(tg[0][1].text) && /Ref AB12CD/.test(tg[0][1].text), tg[0] && tg[0][1].text);
tg.length = 0;
ok('enquiry: sent only once', (await call({}, { action: 'enquiry', id: eid }))[1].sent === 0 && tg.length === 0);
ok('enquiry: one typed in at the counter is not sent', (await call({}, { action: 'enquiry', id: eid2 }))[1].sent === 0 && tg.length === 0);
ok('enquiry: a made-up id → refused', (await call({}, { action: 'enquiry', id: 'x' }))[0] === 400);
// leave asked at the counter
tg.length = 0;
ok('leave: not signed in → refused', (await call({}, { action: 'leave', id: lid }))[0] === 401 && tg.length === 0);
ok('leave: a made-up id → refused', (await call(A, { action: 'leave', id: 'x' }))[0] === 400);
const l1 = await call(A, { action: 'leave', id: lid });
const lt = tg[0] && tg[0][1].text;
ok('leave: owners get who, which days, how many, why', l1[1].sent === 2 && /Leave request: Amit Das/.test(lt) && /Thu, 12 Nov to Sat, 14 Nov \(3 days\)/.test(lt) && /Planned leave: Sister's wedding/.test(lt), lt);
ok('leave: says the days off this month so far (week offs and leave; 4 paid)', /Days off in November so far: 2 \(4 paid a month; more are unpaid\)/.test(lt), lt);
ok('leave: nobody else off those days: no "Also off" line', !/Also off/.test(lt), lt);
ok('leave: Approve / Deny buttons', JSON.stringify(tg[0][1].reply_markup.inline_keyboard[0].map((b) => b.callback_data)) === JSON.stringify(['la:' + lid, 'ld:' + lid]));
tg.length = 0;
ok('leave: sent only once', (await call(A, { action: 'leave', id: lid }))[1].sent === 0 && tg.length === 0);
ok('leave: an old request is not sent', (await call(A, { action: 'leave', id: lid2 }))[1].sent === 0 && tg.length === 0);
await tgcall('la:' + lid, { id: 999, first_name: 'Stranger' });
ok('leave: a stranger cannot approve', leaves[0].status === 'pending');
tg.length = 0;
PLAN_FOR = lid;
await tgcall('la:' + lid, { id: 222, first_name: 'Raj' });
ok('leave: an owner approves on Telegram', leaves[0].status === 'approved' && leaves[0].decided_by === 'Raj (Telegram)' && tg.some(([m, p]) => m === 'answerCallbackQuery' && /Approved by Raj/.test(p.text)), JSON.stringify(leaves[0]));
{
  const pt = tg.filter(([m, p]) => m === 'sendMessage' && /Leave coming up/.test(p.text));
  const t = pt[0] && pt[0][1].text;
  ok('approved on Telegram: the planning message goes to both owners at once (it starts within a week)', pt.length === 2 && planCalls.includes(lid), JSON.stringify(tg.map(([m]) => m)));
  ok('planning: who, the days, when, why', /^Leave coming up: Amit Das\nThu, 19 Nov to Fri, 20 Nov \(2 days\) · in 7 days\nPlanned leave: Sister's wedding/.test(t), t);
  ok('planning: the bookings given to them, with time, customer, number, services; one not confirmed yet', /Bookings with Amit on those days \(2\): give them to someone else\n• Thu, 19 Nov 05:00 pm: Megha Agarwal 98311 00012 \(Keratin \(L · Thick\)\)\n• Fri, 20 Nov Evening: Riya Sen 98300 12345, not confirmed yet\nIn the app: Bookings → the day → the booking → Stylist\./.test(t), t);
  ok('planning: who else is off, how many are in', /Also off then: Priya Saha \(Thu 19 Nov\)\nIn on those days: 2 of 4 staff \(fewest on one day\)\./.test(t), t);
}
tg.length = 0;
await tgcall('ld:' + lid);
ok('leave: the other owner taps Deny later → no change', leaves[0].status === 'approved' && /already answered/.test(tg[0][1].text));
tg.length = 0;
await call(A, { action: 'leave', id: lid3 });
const mt = tg[0] && tg[0][1].text;
ok('medical leave: says "Medical leave: Fever"', /Medical leave: Fever/.test(mt), mt);
ok('medical leave: who else is off those days (asked or approved leave, a week off; not someone who left or cancelled leave)',
  /Also off on these days: Sneha Paul \(Wed, 18 Nov to Thu, 19 Nov\), Priya Saha \(Fri, 20 Nov\)\n/.test(mt) && !/Rahul|Old Leave/.test(mt), mt);
await tgcall('ld:' + lid2);
ok('leave: no time limit to answer (an older request can be refused)', leaves[1].status === 'rejected');
// the morning message
tg.length = 0;
ok('morning: not signed in → refused', (await call({}, { action: 'day' }))[0] === 401);
daySummary = { day: '2026-11-07', leave_today: ['Priya Saha'], leave_tomorrow: ['Amit Das'], pending_leave: [{ name: 'Rahul Roy', from: '2026-11-12', to: '2026-11-13' }], bookings_today: 3, requests: 2, not_checked_in: ['Rahul Roy'] };
const d1 = await call(A, { action: 'day' });
const dt = tg[0] && tg[0][1].text;
ok('morning: leave today and tomorrow, waiting, bookings, not checked in', d1[1].sent === 2 && /Good morning: Sat, 07 Nov/.test(dt) && /On leave today: Priya Saha/.test(dt) && /On leave tomorrow: Amit Das/.test(dt)
  && /• Rahul Roy: Thu, 12 Nov to Fri, 13 Nov/.test(dt) && /Bookings today: 3 · 2 booking requests to confirm/.test(dt) && /Didn't check in yesterday: Rahul Roy/.test(dt) && /count as present until you mark/.test(dt) && !tg[0][1].reply_markup, dt);
ok('morning: the database is asked once, with the service key', rpcCalls.some(([n]) => n === 'day_summary'));
tg.length = 0;
daySummary = null;
ok('morning: already sent today (database says null) → nothing', (await call(A, { action: 'day' }))[1].sent === 0 && tg.length === 0);
daySummary = { day: '2026-11-07', leave_today: [], leave_tomorrow: [], pending_leave: [], bookings_today: 0, requests: 0, not_checked_in: [] };
ok('morning: nothing to say → nothing sent', (await call(A, { action: 'day' }))[1].sent === 0 && tg.length === 0);
// planning messages in the morning, and Mondays: everyone's leave this week
tg.length = 0;
daySummary = { day: '2026-11-09', leave_today: [], leave_tomorrow: [], pending_leave: [], bookings_today: 0, requests: 0, not_checked_in: [], leave_ahead: [PLAN, PLAN1],
  week_leave: [{ name: 'Priya Saha', from: '2026-11-10', to: '2026-11-10', status: 'approved' }, { name: 'Rahul Roy', from: '2026-11-12', to: '2026-11-13', status: 'pending' }] };
const d2 = await call(A, { action: 'day' });
const texts = tg.filter(([m]) => m === 'sendMessage').map(([, p]) => p.text);
ok('Monday: the morning message lists everyone\'s leave this week (waiting ones marked)', /Good morning: Mon, 09 Nov\n\nLeave this week:\n• Priya Saha: Tue, 10 Nov\n• Rahul Roy: Thu, 12 Nov to Fri, 13 Nov \(waiting for your answer\)/.test(texts[0] || ''), texts[0]);
ok('then one planning message per leave coming up (2 leaves × 2 owners)', d2[1].sent === 6 && texts.filter((t) => /^Leave coming up/.test(t)).length === 4, JSON.stringify(d2));
const tS = texts.find((t) => /Sneha Paul/.test(t)) || '';
ok('planning, tomorrow, medical, no bookings: "tomorrow", "No bookings with Sneha on those days yet."', /Sun, 08 Nov \(1 day\) · tomorrow\nMedical leave\n\nNo bookings with Sneha on those days yet\.\n\nIn on those days: 3 of 4 staff\./.test(tS), tS);
daySummary = { day: '2026-11-10', leave_today: [], leave_tomorrow: [], pending_leave: [], bookings_today: 0, requests: 0, not_checked_in: [], leave_ahead: [], week_leave: [] };
tg.length = 0;
const d3 = await call(A, { action: 'day' });
ok('Monday with nobody on leave: "Leave this week: nobody."', d3[1].sent === 2 && /Leave this week: nobody\./.test(tg[0][1].text), tg[0] && tg[0][1].text);
// the daily 9:00 schedule: the cron secret instead of a login
tg.length = 0;
daySummary = { day: '2026-11-11', leave_today: ['Amit Das'], leave_tomorrow: [], pending_leave: [], bookings_today: 0, requests: 0, not_checked_in: [], leave_ahead: [] };
ok('daily schedule: the cron secret works without a login', (await call({ 'x-cron-secret': 'cr0n' }, { action: 'day' }))[1].sent === 2);
ok('daily schedule: a wrong secret is refused', (await call({ 'x-cron-secret': 'nope' }, { action: 'day' }))[0] === 401);
// leave approved in the app: the planning message
tg.length = 0;
ok('approved in the app: not signed in → refused; a made-up id → refused', (await call({}, { action: 'leave_plan', id: lid3 }))[0] === 401 && (await call(A, { action: 'leave_plan', id: 'x' }))[0] === 400);
PLAN_FOR = lid3;
const lp = await call(A, { action: 'leave_plan', id: lid3 });
ok('approved in the app: the planning message goes (once: the database marks it sent)', lp[1].sent === 2 && /Leave coming up: Amit Das/.test(tg[0][1].text) && (await call(A, { action: 'leave_plan', id: lid3 }))[1].sent === 0, JSON.stringify(lp));
// the daily cash close
tg.length = 0;
ok('cash close: not signed in → refused; a made-up id → refused', (await call({}, { action: 'cash_close', id: closes[0].id }))[0] === 401 && (await call(A, { action: 'cash_close', id: 'x' }))[0] === 400 && tg.length === 0);
const cc = await call(A, { action: 'cash_close', id: closes[0].id });
const ct = tg[0] && tg[0][1].text;
ok('cash close: sales by way of paying, expenses, the drawer sum, SHORT, the note, taken out and left', cc[1].sent === 2
  && /^Cash close: Tue, 10 Nov\n\nSales ₹12,340 \(18 bills\): cash ₹4,200, UPI ₹7,140, card ₹1,000\nExpenses ₹350 \(₹150 from the drawer\)\n\nDrawer: ₹2,000 at the start \+ ₹4,200 cash − ₹500 cancelled bills − ₹150 expenses = ₹5,550\nCounted: ₹5,500 → ₹50 SHORT\nNote: Gave ₹50 change too much\nTaken out ₹3,500, left in the drawer ₹2,000\n\nClosed by counter@habibs/.test(ct), ct);
ok('cash close: once', (await call(A, { action: 'cash_close', id: closes[0].id }))[1].sent === 0);
tg.length = 0;
await call(A, { action: 'cash_close', id: closes[1].id });
ok('cash close: "matches ✓" when the count is right; an old close isn\'t sent', /Counted: ₹2,000 → matches ✓/.test(tg[0][1].text) && !/Note:|cancelled bills|from the drawer/.test(tg[0][1].text)
  && (await call(A, { action: 'cash_close', id: closes[2].id }))[1].sent === 0, tg[0] && tg[0][1].text);
console.log(`${checks} Telegram function checks, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
