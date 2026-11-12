// WhatsApp bills through the WhatsApp Business Platform (supabase/functions/whatsapp): sending a bill with its picture,
// the limits, Meta's errors in plain words, the webhook (check, signature, delivery updates, customers' replies).
// Fake Meta (Graph API), fake Supabase and fake Telegram.
import { createHmac } from 'node:crypto';

const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  WHATSAPP_TOKEN: 'WTOKEN', WHATSAPP_PHONE_ID: '1098765', WHATSAPP_APP_SECRET: 'appsecret', WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TELEGRAM_BOT_TOKEN: 'BOT', TELEGRAM_OWNER_CHAT_IDS: '111,222', CRON_SECRET: 'CRON',
};
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: () => {} };
let checks = 0, fails = 0;
const ok = (n, c, d = '') => { checks++; if (!c) { fails++; console.log('✗', n, typeof d === 'function' ? d() : d); } };

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const TOKEN = 'x.' + b64({ sub: 'u1', email: 'counter@habibs' }) + '.sig';      // approved login
const PENDING = 'x.' + b64({ sub: 'u2', email: 'new@habibs' }) + '.sig';        // signed in, waiting for approval (sees no bills)
const OWNER = 'x.' + b64({ sub: 'u0', email: 'owner@habibs' }) + '.sig';        // the owner (only this login reads payslips)
const id = (n) => `${String(n).padStart(8, '0')}-1111-4222-8333-944455556666`;
const now = Date.now();
const bills = [
  { id: id(1), bill_no: 'HF2627-0042', status: 'paid', customer_phone: '9831100021', customer_name: 'Ananya Paul', total: 3300, paid_points: 100, points_earned: 120, points_balance: 270, created_at: new Date(now - 60000).toISOString() },
  { id: id(2), bill_no: 'HF2627-0043', status: 'cancelled', customer_phone: '9831100022', customer_name: 'X', total: 500, created_at: new Date(now).toISOString() },
  { id: id(3), bill_no: 'HF2627-0044', status: 'paid', customer_phone: null, customer_name: null, total: 500, created_at: new Date(now).toISOString() },
  { id: id(4), bill_no: 'HF2627-0001', status: 'paid', customer_phone: '9831100023', customer_name: 'Old', total: 500, created_at: new Date(now - 40 * 86400000).toISOString() },
  { id: id(5), bill_no: 'HF2627-0045', status: 'paid', customer_phone: '9831100024', customer_name: '', total: 1234.5, paid_points: 0, points_earned: 0, points_balance: 0, created_at: new Date(now).toISOString() },
  { id: id(6), bill_no: 'HF2627-0046', status: 'paid', customer_phone: '9800000002', customer_name: 'Rahul Roy', total: 1100, points_earned: 0, points_balance: 0, for_staff: 'staff-2', created_at: new Date(now).toISOString() },
  { id: id(7), bill_no: 'HF2627-0047', status: 'paid', customer_phone: '9831100025', customer_name: 'Notonwa Sen', total: 700, created_at: new Date(now).toISOString() },
];
const wa = [];
const graphCalls = [];
const tg = [];
let metaMode = 'ok';
let mediaN = 0, msgN = 0;
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const filt = (rows, sp) => rows.filter((r) => [...sp.entries()].every(([k, v]) => {
  if (['select', 'order'].includes(k)) return true;
  if (v.startsWith('eq.')) return String(r[k]) === decodeURIComponent(v.slice(3));
  if (v.startsWith('in.(')) return v.slice(4, -1).split(',').includes(String(r[k]));
  return true;
}));
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url);
  const h = init.headers || {};
  if (u.host === 'api.telegram.org') { tg.push(JSON.parse(init.body)); return res({ ok: true }); }
  if (u.host === 'graph.facebook.com') {
    graphCalls.push({ path: u.pathname, init, search: u.search });
    if (h.Authorization !== 'Bearer WTOKEN') return res({ error: { code: 190, message: 'Invalid OAuth access token' } }, 401);
    if (u.pathname === '/v23.0/1098765' && (init.method || 'GET') === 'GET') return res({ display_phone_number: '+91 89275 63835', verified_name: 'Habibs Hair & Beauty', quality_rating: 'GREEN', id: '1098765' });
    if (u.pathname === '/v23.0/1098765/media') {
      if (metaMode === 'media-fail') return res({ error: { code: 131053, message: 'Media upload error' } }, 400);
      return res({ id: 'media-' + ++mediaN });
    }
    if (u.pathname === '/v23.0/1098765/messages') {
      const p = JSON.parse(init.body);
      if (p.to === '919831100025') return res({ error: { code: 131026, message: 'Message undeliverable' } }, 400);
      if (metaMode === 'no-template') return res({ error: { code: 132001, message: 'Template name does not exist in the translation' } }, 404);
      return res({ messaging_product: 'whatsapp', contacts: [{ input: p.to, wa_id: p.to }], messages: [{ id: 'wamid.' + ++msgN }] });
    }
    return res({ error: { message: 'unknown' } }, 404);
  }
  if (u.pathname === '/rest/v1/payslips') {
    // row level security: payslips are the owner's; the service key is not used to read them
    if (h.apikey !== 'anon' || h.Authorization === 'Bearer service') return res({ message: 'wrong key' }, 401);
    return res(h.Authorization === 'Bearer ' + OWNER ? filt(payslips, u.searchParams) : []);
  }
  if (u.pathname === '/rest/v1/staff') return h.Authorization === 'Bearer service' ? res(filt(staffRows, u.searchParams)) : res([], 401);
  if (u.pathname === '/auth/v1/user') return [TOKEN, PENDING, OWNER].some((t) => h.Authorization === 'Bearer ' + t) ? res({ id: 'u' }) : res({}, 401);
  if (u.pathname === '/rest/v1/bills') {
    // row level security: an approved login sees bills, a waiting one sees nothing; the service key is not used here
    if (h.Authorization === 'Bearer service') return res(filt(bills, u.searchParams).map((b) => ({ ...b, bill_items: [{ name: 'Global Colour', staff_name: 'Priya', item_type: 'service' }, { name: 'Shampoo 250 ml', staff_name: 'Priya', item_type: 'product' }] })));
    if (h.apikey !== 'anon') return res([], 401);
    if (h.Authorization === 'Bearer ' + PENDING) return res([]);
    if (h.Authorization !== 'Bearer ' + TOKEN) return res({ message: 'JWT expired' }, 401);
    return res(filt(bills, u.searchParams));
  }
  if (u.pathname === '/rest/v1/wa_messages') {
    if (h.Authorization !== 'Bearer service') return res([], 401);
    const m = init.method || 'GET';
    if (m === 'POST') {
      const body = JSON.parse(init.body);
      if (body.dedupe && wa.some((r) => r.dedupe === body.dedupe)) return res([], 201);   // on_conflict=dedupe, ignore duplicates
      const row = { id: 'w' + (waN = waN + 1), wamid: null, error: null, created_at: new Date().toISOString(), ...body }; wa.push(row); return res([row], 201);
    }
    if (m === 'DELETE') { const hit = filt(wa, u.searchParams); hit.forEach((r) => wa.splice(wa.indexOf(r), 1)); return res(hit); }
    const hit = filt(wa, u.searchParams);
    if (m === 'PATCH') { hit.forEach((r) => Object.assign(r, JSON.parse(init.body))); return res(hit); }
    return res([...hit].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)));
  }
  // the rest: only with the service key
  if (h.Authorization !== 'Bearer service') return res({ message: 'not allowed ' + u.pathname }, 401);
  const m = init.method || 'GET';
  if (u.pathname === '/rest/v1/rpc/wa_due') return dueMode === 'old-db' ? res({ message: 'no function' }, 404) : res(due);
  if (u.pathname === '/rest/v1/settings') return res(Object.entries(SETTINGS).map(([key, value]) => ({ key, value })));
  if (u.pathname === '/rest/v1/bills') return res(filt(bills, u.searchParams).map((b) => ({ ...b, bill_items: [{ name: 'Global Colour', staff_name: 'Priya', item_type: 'service' }, { name: 'Shampoo 250 ml', staff_name: 'Priya', item_type: 'product' }] })));
  if (u.pathname === '/rest/v1/customers') { patches.push(['customers', u.search, JSON.parse(init.body)]); return res([]); }
  if (u.pathname === '/rest/v1/bookings') { patches.push(['bookings', u.search, JSON.parse(init.body)]); return res([]); }
  if (u.pathname === '/rest/v1/feedback') {
    if (m === 'POST') { const body = JSON.parse(init.body); if (fb.some((f) => f.bill_id === body.bill_id)) return res([], 201); const row = { id: 'f' + (fb.length + 1), comment: null, created_at: new Date().toISOString(), ...body }; fb.push(row); return res([row], 201); }
    const sp = new URLSearchParams(u.search); const phone = (sp.get('phone') || '').slice(3), fid = (sp.get('id') || '').slice(3);
    const hit = fb.filter((f) => (fid ? f.id === fid : f.phone === phone && f.comment === null));
    if (m === 'PATCH') { hit.forEach((f) => Object.assign(f, JSON.parse(init.body))); return res(hit); }
    return res(hit.slice(-1));
  }
  return res({ message: 'not found ' + u.pathname }, 404);
};
let waN = 0, due = [], dueMode = 'ok';
const staffRows = [
  { id: 'st1', name: 'Priya Das', phone: '9800000001' }, { id: 'st2', name: 'Rahul Roy', phone: '' },
  { id: 'st3', name: 'Sima Bauri', phone: '+91 98311 00025' },   // WhatsApp can't deliver to this number (see the fake above)
];
const payslips = [
  { id: id(21), staff_id: 'st1', month: '2026-10', status: 'paid', net_pay: 18450, paid_mode: 'UPI', paid_on: '2026-11-01' },
  { id: id(22), staff_id: 'st2', month: '2026-10', status: 'paid', net_pay: 12000, paid_mode: 'Cash', paid_on: '2026-11-01' },
  { id: id(23), staff_id: 'st1', month: '2026-09', status: 'draft', net_pay: 17000, paid_mode: null, paid_on: null },
  { id: id(24), staff_id: 'gone', month: '2026-10', status: 'paid', net_pay: 9000, paid_mode: 'Bank', paid_on: '2026-11-02' },
  { id: id(25), staff_id: 'st3', month: '2026-10', status: 'paid', net_pay: 15000.5, paid_mode: 'Bank', paid_on: '2026-11-02' },
];
const SETTINGS = { google_review_url: 'https://g.page/r/HABIBS/review', wa_review_all: true, wa_winback_text: 'Show this message for 10% off this week' };
const patches = [], fb = [];

const { handler, errorText, billValues, slotText, autoValues, slipValues } = await import('../supabase/functions/whatsapp/index.ts');
const call = async (headers, body) => { const r = await handler(new Request('https://fn/whatsapp', { method: 'POST', headers, body: JSON.stringify(body) })); return [r.status, await r.json()]; };
const A = { Authorization: 'Bearer ' + TOKEN };
// a small real PNG (1×1)
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64').toString('base64');
const send = (bid, more = {}, who = A) => call(who, { action: 'bill', id: bid, image: PNG, ...more });

// ---------- who may send ----------
ok('not signed in → refused', (await send(id(1), {}, {}))[0] === 401 && graphCalls.length === 0);
ok('a login waiting for approval (it can\'t see the bill) → refused', (await send(id(1), {}, { Authorization: 'Bearer ' + PENDING }))[0] === 401 && graphCalls.length === 0);
ok('a made-up id → refused', (await send('x'))[0] === 400);
// ---------- what is refused, in plain words ----------
for (const [why, bid, more, re] of [
  ['a cancelled bill', id(2), {}, /cancelled/],
  ['no mobile number', id(3), {}, /no mobile number/],
  ['more than 30 days old', id(4), {}, /older than 30 days/],
  ['no picture', id(1), { image: '' }, /picture is missing/],
  ['not a PNG', id(1), { image: Buffer.from('<svg>').toString('base64') }, /picture is missing/],
  ['a picture too big', id(1), { image: 'A'.repeat(6_100_000) }, /too big/],
]) {
  const [st, r] = await send(bid, more);
  ok(`refused: ${why}`, st === 200 && r.ok === false && re.test(r.error), JSON.stringify(r));
}
ok('…and nothing went to Meta, nothing was recorded', graphCalls.length === 0 && wa.length === 0);

// ---------- sending ----------
const [s1, r1] = await send(id(1));
ok('a bill: sent', s1 === 200 && r1.ok && r1.status === 'sent', JSON.stringify(r1));
const up = graphCalls.find((c) => c.path.endsWith('/media'));
const form = up && up.init.body;
const file = form && form.get('file');
ok('1. the bill picture goes up to WhatsApp as a PNG, with the access token', up && up.init.headers.Authorization === 'Bearer WTOKEN' && form.get('messaging_product') === 'whatsapp' && form.get('type') === 'image/png'
  && file && file.type === 'image/png' && file.size === Buffer.from(PNG, 'base64').length && file.name === 'Bill HF2627-0042.png');
const mc = graphCalls.find((c) => c.path.endsWith('/messages'));
const m = mc && JSON.parse(mc.init.body);
ok('2. the template message: to 91 + the number, bill_receipt, English', m && m.to === '919831100021' && m.type === 'template' && m.template.name === 'bill_receipt' && m.template.language.code === 'en', JSON.stringify(m));
ok('…the picture on top (the uploaded one)', m && m.template.components[0].type === 'header' && m.template.components[0].parameters[0].image.id === 'media-1');
ok('…4 values: first name, bill number, total, points (earned and the balance)', m && JSON.stringify(m.template.components[1].parameters.map((p) => p.text)) === JSON.stringify(['Ananya', 'HF2627-0042', '3,300', 'Loyalty points: 120 added, balance 270.']), JSON.stringify(m && m.template.components[1]));
ok('recorded: sending, then sent with WhatsApp\'s id, by whom', wa.length === 1 && wa[0].status === 'sent' && wa[0].wamid === 'wamid.1' && wa[0].phone === '9831100021' && wa[0].created_by === 'counter@habibs' && wa[0].bill_id === id(1), JSON.stringify(wa));
// once by itself
graphCalls.length = 0;
ok('a double tap (or the bill opened again): not sent twice', (await send(id(1)))[1].already === true && (await send(id(1), { again: true }))[1].already === true && graphCalls.length === 0 && wa.length === 1);
wa[0].created_at = new Date(now - 120000).toISOString();
ok('sent by itself once: opening the bill later doesn\'t send it again', (await send(id(1)))[1].already === true && graphCalls.length === 0);
const again = await send(id(1), { again: true });
ok('Send again (a minute later): sent again', again[1].ok && again[1].status === 'sent' && wa.length === 2, JSON.stringify(again));
wa.forEach((r) => { r.created_at = new Date(now - 120000).toISOString(); });
await send(id(1), { again: true });
wa.forEach((r) => { r.created_at = new Date(now - 120000).toISOString(); });
const fourth = await send(id(1), { again: true });
ok('at most 3 sends a bill', fourth[1].ok === false && /3 times/.test(fourth[1].error) && wa.length === 3, JSON.stringify(fourth));
// the values for other bills
ok('values: no name → "there"; ₹1,234.5; no points → "Please keep it for your records."', JSON.stringify(billValues(bills[4])) === JSON.stringify(['there', 'HF2627-0045', '1,234.5', 'Please keep it for your records.']), JSON.stringify(billValues(bills[4])));
ok('values: a staff member\'s own bill says nothing about points', billValues(bills[5])[3] === 'Please keep it for your records.');
ok('values: paid with points, no new points', billValues({ ...bills[0], points_earned: 0 })[3] === 'Loyalty points: 100 used on this bill, balance 270.');
ok('values: never a new line, a tab or 4 spaces (WhatsApp refuses them)', !/[\n\t]| {4}/.test(billValues({ ...bills[0], customer_name: 'A\tB', bill_no: 'X\nY' }).join('|')));
// Meta's errors
tg.length = 0;
const nw = await send(id(7));
ok('a number not on WhatsApp: failed, in plain words, recorded', nw[1].ok === false && /can't get WhatsApp messages/.test(nw[1].error) && wa.some((r) => r.bill_id === id(7) && r.status === 'failed' && /can't get WhatsApp/.test(r.error)), JSON.stringify(nw));
ok('…and both owners are told on Telegram at once: the bill number, the number, why', tg.length === 2 && /^WhatsApp bill HF2627-\d{4} not sent to \d{5} \d{5}\n.*can't get WhatsApp.*\nSend it the other way from Bills/s.test(tg[0].text), JSON.stringify(tg));
metaMode = 'no-template';
const nt = await send(id(5));
ok('the template not approved yet: says so', /template "bill_receipt" isn't approved yet/.test(nt[1].error || ''), JSON.stringify(nt));
metaMode = 'media-fail';
wa.filter((r) => r.bill_id === id(5)).forEach((r) => { r.created_at = new Date(now - 120000).toISOString(); });
const mf = await send(id(5));
ok('the picture refused by WhatsApp: says so; a failed send can be tried again by itself', /couldn't take the bill picture/.test(mf[1].error || '') && wa.filter((r) => r.bill_id === id(5)).length === 2, JSON.stringify(mf));
metaMode = 'ok';
ENV.WHATSAPP_TOKEN = 'wrong';
wa.filter((r) => r.bill_id === id(5)).forEach((r) => { r.created_at = new Date(now - 120000).toISOString(); });
ok('a wrong or expired token: says so', /access token is wrong or has expired/.test((await send(id(5)))[1].error || ''));
ENV.WHATSAPP_TOKEN = 'WTOKEN';
for (const [code, re] of [[131056, /Too many/], [131031, /blocked or restricted/], [131042, /payment/], [133010, /isn't registered/], [999, /WhatsApp said: odd \(code 999\)/]]) {
  ok(`error ${code} in plain words`, re.test(errorText({ code, message: 'odd' })), errorText({ code, message: 'odd' }));
}
ENV.WHATSAPP_PHONE_ID = '';
ok('not set up: says so, nothing sent', /not set up yet/.test((await send(id(6)))[1].error || ''));
ENV.WHATSAPP_PHONE_ID = '1098765';

// ---------- Settings: is it set up? ----------
const [ss, st] = await call(A, { action: 'status' });
ok('status: set up, the number, its name and quality, the template', ss === 200 && st.configured && st.number === '+91 89275 63835' && st.name === 'Habibs Hair & Beauty' && st.quality === 'GREEN' && st.template === 'bill_receipt' && st.missing.length === 0, JSON.stringify(st));
ok('status: not signed in → refused', (await call({}, { action: 'status' }))[0] === 401);
delete ENV.WHATSAPP_APP_SECRET;
ok('status: lists what is missing', JSON.stringify((await call(A, { action: 'status' }))[1].missing) === JSON.stringify(['WHATSAPP_APP_SECRET']));
ENV.WHATSAPP_APP_SECRET = 'appsecret';

// ---------- Meta's webhook ----------
const get = (q) => handler(new Request('https://fn/whatsapp?' + q, { method: 'GET' }));
const g1 = await get('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
ok('webhook check: the right verify token → the challenge back', g1.status === 200 && (await g1.text()) === '12345');
ok('webhook check: a wrong token → refused', (await get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1')).status === 403);
const hook = (obj, secret = 'appsecret') => {
  const raw = JSON.stringify(obj);
  const sig = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
  return handler(new Request('https://fn/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': sig, 'Content-Type': 'application/json' }, body: raw })).then(async (r) => [r.status, await r.json()]);
};
const statusUpdate = (wamid, status, errors) => ({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: '1098765' }, statuses: [{ id: wamid, status, timestamp: String(Math.floor(now / 1000)), recipient_id: '919831100021', ...(errors ? { errors } : {}) }] } }] }] });
const row1 = () => wa.find((r) => r.wamid === 'wamid.1');
ok('webhook: a wrong signature → refused, nothing changed', (await hook(statusUpdate('wamid.1', 'read'), 'not-the-secret'))[0] === 401 && row1().status === 'sent');
const noSig = await handler(new Request('https://fn/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=00' }, body: JSON.stringify(statusUpdate('wamid.1', 'read')) }));
ok('webhook: a made-up signature → refused', noSig.status === 401 && row1().status === 'sent');
ok('delivered', (await hook(statusUpdate('wamid.1', 'delivered')))[1].updated === 1 && row1().status === 'delivered');
ok('read', (await hook(statusUpdate('wamid.1', 'read')))[1].updated === 1 && row1().status === 'read');
ok('a late "delivered" after "read" doesn\'t go back', (await hook(statusUpdate('wamid.1', 'delivered')))[1].updated === 0 && row1().status === 'read');
ok('a late "sent" doesn\'t go back either', (await hook(statusUpdate('wamid.1', 'sent')))[1].updated === 0 && row1().status === 'read');
const row2 = wa.find((r) => r.wamid === 'wamid.2');
tg.length = 0;
await hook(statusUpdate('wamid.2', 'failed', [{ code: 131026, title: 'Message undeliverable' }]));
ok('…and both owners are told on Telegram that the bill was not delivered', tg.length === 2 && /WhatsApp bill HF2627-0042 not delivered to \d{5} \d{5}\n.*can't get WhatsApp/.test(tg[0].text), JSON.stringify(tg));
ok('failed later (by Meta): failed, with the reason in plain words', row2.status === 'failed' && /can't get WhatsApp/.test(row2.error), JSON.stringify(row2));
ok('an update for a message that isn\'t ours: nothing', (await hook(statusUpdate('wamid.other', 'read')))[1].updated === 0);
// customers' replies → the owners on Telegram
tg.length = 0;
const reply = { object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: '919831100021', profile: { name: 'Ananya' } }],
  messages: [{ from: '919831100021', id: 'wamid.in1', type: 'text', text: { body: 'The facial was ₹2,500, not ₹2,800?' } }, { from: '919831100021', id: 'wamid.in2', type: 'image', image: { id: 'x' } }] } }] }] };
const [rs, rr] = await hook(reply);
ok('a customer\'s reply goes to both owners on Telegram, with the name, number and a link to reply', rs === 200 && rr.forwarded === 4 && tg.length === 4
  && tg[0].text === 'WhatsApp message from Ananya (98311 00021):\nThe facial was ₹2,500, not ₹2,800?\n\nCall them, or WhatsApp them from your phone: https://wa.me/919831100021'
  && /\[a photo\]/.test(tg[2].text) && JSON.stringify(tg.map((t) => t.chat_id)) === JSON.stringify(['111', '222', '111', '222']), JSON.stringify(tg));
ok('the app\'s own call with no action → refused', (await call(A, {}))[0] === 400);
ok('anything but GET and POST → refused', (await handler(new Request('https://fn/whatsapp', { method: 'PUT' }))).status === 405);

// ---------- automatic messages: feedback, reminders, "we miss you" ----------
{
  const at = new Date('2026-11-12T08:00:00Z');   // 1:30 pm in India
  ok('reminder time in words: today / tomorrow / the day', slotText('2026-11-12T12:00:00Z', at) === 'today at 5:30 PM' && slotText('2026-11-13T05:30:00Z', at) === 'tomorrow at 11:00 AM' && slotText('2026-11-14T12:00:00Z', at) === 'Sat 14 Nov at 5:30 PM',
    [slotText('2026-11-12T12:00:00Z', at), slotText('2026-11-13T05:30:00Z', at), slotText('2026-11-14T12:00:00Z', at)].join(' | '));
  ok('values: feedback = first name; reminder = name, when, services; we miss you = name, the owner\'s line + points from 100',
    JSON.stringify(autoValues({ kind: 'feedback', name: 'Ananya Paul' }, {})) === '["Ananya"]'
    && JSON.stringify(autoValues({ kind: 'reminder', name: 'megha agarwal', slot_at: '2026-11-12T12:00:00Z', services: 'Keratin, Hair Spa' }, {}, at)) === '["megha","today at 5:30 PM","Keratin, Hair Spa"]'
    && JSON.stringify(autoValues({ kind: 'winback', name: '', points: 250 }, SETTINGS)) === '["there","Show this message for 10% off this week. You have 250 loyalty points = ₹250 off."]'
    && autoValues({ kind: 'winback', name: 'Riya', points: 40 }, {})[1] === 'We would love to see you again.', JSON.stringify(autoValues({ kind: 'winback', name: '', points: 250 }, SETTINGS)));
  ok('auto: not signed in and no cron secret → refused', (await call({}, { action: 'auto' }))[0] === 401 && (await call({ 'x-cron-secret': 'guess' }, { action: 'auto' }))[0] === 401);
  due = [
    { kind: 'feedback', dedupe: 'feedback:' + id(1), phone: '9831100021', name: 'Ananya Paul', bill_id: id(1), customer_id: 'c1', bill_no: 'HF2627-0042' },
    { kind: 'reminder', dedupe: 'reminder:k1:1', phone: '9831100030', name: 'Megha Agarwal', booking_id: 'k1', customer_id: null, slot_at: new Date(Date.now() + 2 * 3600e3).toISOString(), services: 'Keratin' },
    { kind: 'winback', dedupe: 'winback:c9:2026-09-01', phone: '9831100031', name: 'Riya Sen', customer_id: 'c9', points: 120 },
    { kind: 'winback', dedupe: 'winback:c8:2026-09-02', phone: '9831100025', name: 'Notonwa Sen', customer_id: 'c8', points: 0 },
  ];
  const g0 = graphCalls.length; wa.length = 0; patches.length = 0;
  const [as, ar] = await call(A, { action: 'auto' });
  const sentTo = graphCalls.slice(g0).map((c) => JSON.parse(c.init.body));
  ok('auto (the app, signed in): 1 feedback, 1 reminder, 1 "we miss you" sent; the number not on WhatsApp failed', as === 200 && ar.ok && JSON.stringify(ar.sent) === '{"feedback":1,"reminder":1,"winback":1}' && ar.failed === 1, JSON.stringify(ar));
  ok('each with its own template and values, no picture', sentTo.length === 4 && sentTo.map((x) => x.template.name).join() === 'visit_feedback,booking_reminder,we_miss_you,we_miss_you'
    && sentTo[0].to === '919831100021' && JSON.stringify(sentTo[0].template.components) === '[{"type":"body","parameters":[{"type":"text","text":"Ananya"}]}]'
    && sentTo[1].template.components[0].parameters.length === 3 && /^(today|tomorrow) at \d{1,2}:\d\d [AP]M$/.test(sentTo[1].template.components[0].parameters[1].text)
    && sentTo[2].template.components[0].parameters[1].text === 'Show this message for 10% off this week. You have 120 loyalty points = ₹120 off.', JSON.stringify(sentTo));
  ok('recorded: one row each, with what it is for', wa.length === 4 && wa.map((r) => `${r.kind}:${r.status}`).join() === 'feedback:sent,reminder:sent,winback:sent,winback:failed' && wa[0].bill_id === id(1) && wa[1].booking_id === 'k1' && wa[2].customer_id === 'c9' && /can't get WhatsApp/.test(wa[3].error), JSON.stringify(wa));
  ok('the booking is marked reminded', patches.length === 1 && patches[0][0] === 'bookings' && /id=eq\.k1/.test(patches[0][1]) && !!patches[0][2].reminded_at, JSON.stringify(patches));
  const g1 = graphCalls.length;
  const [, ar2] = await call({ 'x-cron-secret': 'CRON' }, { action: 'auto' });
  ok('asked again (the 30-minute schedule, with the cron secret): nothing goes twice', ar2.ok && JSON.stringify(ar2.sent) === '{"feedback":0,"reminder":0,"winback":0}' && graphCalls.length === g1 && wa.length === 4, JSON.stringify(ar2));
  // a template not approved yet: nobody is marked failed, it is tried again later
  metaMode = 'no-template';
  due = [{ kind: 'winback', dedupe: 'winback:c7:2026-09-03', phone: '9831100032', name: 'A', customer_id: 'c7' }, { kind: 'winback', dedupe: 'winback:c6:2026-09-03', phone: '9831100033', name: 'B', customer_id: 'c6' }];
  const g2 = graphCalls.length;
  const [, ar3] = await call(A, { action: 'auto' });
  ok('template not approved: says so, stops after the first, nobody marked failed (tried again next time)', ar3.ok && /"we_miss_you" isn't approved/.test(ar3.errors.winback || '') && graphCalls.length === g2 + 1 && wa.length === 4, JSON.stringify(ar3));
  metaMode = 'ok';
  ok('…and goes once it is approved', JSON.stringify((await call(A, { action: 'auto' }))[1].sent) === '{"feedback":0,"reminder":0,"winback":2}' && wa.length === 6);
  dueMode = 'old-db';
  ok('a database without the new functions: says to run the schema', /run supabase\/01_schema.sql again/.test((await call(A, { action: 'auto' }))[1].error || ''));
  dueMode = 'ok'; due = [];

  // the customer answers "How was your visit?"
  const fbWamid = wa[0].wamid;
  const answer = (text, from = '919831100021', ctx = fbWamid, type = 'button') => ({ object: 'whatsapp_business_account', entry: [{ changes: [{ field: 'messages', value: { contacts: [{ wa_id: from, profile: { name: 'Ananya' } }],
    messages: [type === 'button' ? { from, id: 'wamid.a' + Math.random(), type: 'button', button: { text, payload: text }, context: { id: ctx } } : { from, id: 'wamid.t' + Math.random(), type: 'text', text: { body: text } }] } }] }] });
  tg.length = 0;
  const g3 = graphCalls.length;
  await hook(answer('Loved it'));
  const thanks = JSON.parse(graphCalls[graphCalls.length - 1].init.body);
  ok('"Loved it": saved as feedback for that bill', fb.length === 1 && fb[0].rating === 'good' && fb[0].bill_id === id(1) && fb[0].phone === '9831100021' && fb[0].name === 'Ananya Paul', JSON.stringify(fb));
  ok('…a thank-you with the Google review link goes back as a plain message (free in the 24-hour window), nothing to Telegram',
    graphCalls.length === g3 + 1 && thanks.type === 'text' && thanks.to === '919831100021' && thanks.text.body === 'Thank you, Ananya! We are so glad. It would mean a lot if you shared it on Google: https://g.page/r/HABIBS/review' && tg.length === 0, JSON.stringify([thanks, tg]));
  await hook(answer('Not happy'));
  ok('tapping another answer later changes nothing and sends nothing', fb.length === 1 && fb[0].rating === 'good' && graphCalls.length === g3 + 1 && tg.length === 0);
  await hook(answer('The colour came out really well', '919831100021', null, 'text'));
  ok('what they write after answering is kept as their comment (and still goes to the owners)', fb[0].comment === 'The colour came out really well' && tg.length === 2);
  // an unhappy customer
  wa.push({ id: 'wx', kind: 'feedback', wamid: 'wamid.fb2', bill_id: id(5), customer_id: 'c5', phone: '9831100024', status: 'delivered', created_at: new Date().toISOString() });
  tg.length = 0;
  await hook(answer('Not happy', '919831100024', 'wamid.fb2'));
  const sorry = JSON.parse(graphCalls[graphCalls.length - 1].init.body);
  ok('"Not happy": saved, an apology goes back', fb.length === 2 && fb[1].rating === 'bad' && /^We are sorry, Ananya\. Please tell us here what went wrong, and we will call you to put it right\./.test(sorry.text.body), JSON.stringify([fb[1], sorry]));
  ok('…with the review link too (Google\'s rule: ask everyone), unless Settings says only happy customers', /You can also review us on Google: https:\/\/g\.page/.test(sorry.text.body));
  ok('…and both owners hear at once on Telegram: who, the bill, the service and who did it, a link to reply', tg.length === 2
    && /^Unhappy customer: Ananya \(98311 00024\)\nBill HF2627-0045, ₹1,234\.5\nGlobal Colour \(Priya\)\n\nThey tapped "Not happy" on WhatsApp\. Call them today: https:\/\/wa\.me\/919831100024/.test(tg[0].text) && !/Shampoo/.test(tg[0].text), JSON.stringify(tg));
  SETTINGS.wa_review_all = false; SETTINGS.google_review_url = '';
  wa.push({ id: 'wy', kind: 'feedback', wamid: 'wamid.fb3', bill_id: id(7), customer_id: 'c7', phone: '9831100025', status: 'delivered', created_at: new Date().toISOString() });
  await hook(answer('It was okay', '919831100025', 'wamid.fb3'));
  ok('"It was okay" with no review link in Settings: asks what to do better, no link', fb.length === 3 && fb[2].rating === 'ok' && JSON.parse(graphCalls[graphCalls.length - 1].init.body).text.body === 'Thank you for telling us, Notonwa. What could we do better? Just reply here.');
  ok('a button on a message that isn\'t ours: not saved, passed on to the owners like any message', (await hook(answer('Loved it', '919831100040', 'wamid.unknown')))[1].forwarded === 2 && fb.length === 3);
  // STOP and START
  patches.length = 0; tg.length = 0;
  await hook(answer('STOP', '919831100021', null, 'text'));
  ok('STOP: no more automatic messages or offers for that number, a confirmation goes back, nothing to Telegram', patches.length === 1 && patches[0][0] === 'customers' && /phone=eq\.9831100021/.test(patches[0][1]) && patches[0][2].wa_stop === true && patches[0][2].whatsapp_ok === false
    && /You will not get reminders or offers/.test(JSON.parse(graphCalls[graphCalls.length - 1].init.body).text.body) && tg.length === 0, JSON.stringify(patches));
  await hook(answer('start', '919831100021', null, 'text'));
  ok('START: on again', patches.length === 2 && patches[1][2].wa_stop === false);
  ok('"Stop sending the wrong bill" is a message, not STOP', (await hook(answer('Stop sending the wrong bill', '919831100021', null, 'text')))[1].forwarded === 2 && patches.length === 2);
  // a failed feedback request isn't the owners' problem
  tg.length = 0;
  await hook(statusUpdate(wa.find((r) => r.kind === 'reminder').wamid, 'failed', [{ code: 131026, title: 'x' }]));
  ok('a reminder that couldn\'t be delivered: marked failed, no Telegram', wa.find((r) => r.kind === 'reminder').status === 'failed' && tg.length === 0);
}

// ---------- the salary slip to the staff member, when the salary is marked paid ----------
{
  const O = { Authorization: 'Bearer ' + OWNER };
  const slip = (pid, more = {}, who = O) => call(who, { action: 'slip', id: pid, image: PNG, ...more });
  const g0 = graphCalls.length, w0 = wa.length;
  ok('slip: not signed in → refused', (await slip(id(21), {}, {}))[0] === 401);
  ok('slip: the counter\'s login (it can\'t read payslips) → refused', (await slip(id(21), {}, A))[0] === 401);
  ok('slip: a login waiting for approval → refused', (await slip(id(21), {}, { Authorization: 'Bearer ' + PENDING }))[0] === 401);
  ok('slip: a made-up id → refused', (await slip('1 or 1=1'))[0] === 400);
  for (const [why, pid, more, re] of [
    ['salary not marked paid', id(23), {}, /not marked paid/],
    ['no mobile number in Staff', id(22), {}, /^Rahul has no mobile number in Staff/],
    ['staff member deleted', id(24), {}, /not in the staff list/],
    ['no picture', id(21), { image: '' }, /slip picture is missing/],
    ['a picture too big', id(21), { image: 'A'.repeat(6_100_000) }, /slip picture is too big/],
  ]) {
    const [st, r] = await slip(pid, more);
    ok(`slip refused: ${why}`, st === 200 && r.ok === false && re.test(r.error), JSON.stringify(r));
  }
  ok('…and nothing went to WhatsApp, nothing was recorded', graphCalls.length === g0 && wa.length === w0);
  ok('the values: first name, month in words, net pay, how and when it was paid', JSON.stringify(slipValues(payslips[0], staffRows[0])) === JSON.stringify(['Priya', 'October 2026', '18,450', 'UPI', '1 Nov 2026']), JSON.stringify(slipValues(payslips[0], staffRows[0])));

  const [s1, r1] = await slip(id(21));
  ok('slip: sent', s1 === 200 && r1.ok && r1.status === 'sent' && r1.name === 'Priya', JSON.stringify(r1));
  const calls = graphCalls.slice(g0);
  const file = calls[0].init.body.get('file');
  ok('1. the slip picture goes up as a PNG', calls[0].path.endsWith('/media') && file.type === 'image/png' && file.name === 'Salary slip 2026-10.png' && file.size === Buffer.from(PNG, 'base64').length);
  const m = JSON.parse(calls[1].init.body);
  ok('2. the salary_slip template to the staff member\'s own number, the picture on top, 5 values', calls.length === 2 && m.to === '919800000001' && m.template.name === 'salary_slip' && m.template.components[0].parameters[0].image.id
    && JSON.stringify(m.template.components[1].parameters.map((x) => x.text)) === JSON.stringify(['Priya', 'October 2026', '18,450', 'UPI', '1 Nov 2026']), JSON.stringify(m));
  const row = wa[wa.length - 1];
  ok('3. recorded: the payslip, the number, kind slip, sent, who sent it', wa.length === w0 + 1 && row.payslip_id === id(21) && row.phone === '9800000001' && row.kind === 'slip' && row.status === 'sent' && /^wamid\./.test(row.wamid) && row.created_by === 'owner@habibs' && !row.bill_id, JSON.stringify(row));
  // limits
  const [, r2] = await slip(id(21));
  ok('marked paid twice / a double tap: not sent again', r2.ok && r2.already && wa.length === w0 + 1 && graphCalls.length === g0 + 2);
  row.created_at = new Date(Date.now() - 120000).toISOString();
  ok('without "again": still once', (await slip(id(21)))[1].already === true && wa.length === w0 + 1);
  ok('again by hand: sent', (await slip(id(21), { again: true }))[1].status === 'sent' && wa.length === w0 + 2);
  wa[wa.length - 1].created_at = new Date(Date.now() - 120000).toISOString();
  await slip(id(21), { again: true });
  wa[wa.length - 1].created_at = new Date(Date.now() - 120000).toISOString();
  const [, r5] = await slip(id(21), { again: true });
  ok('at most 3 times', r5.ok === false && /Sent 3 times already\. Print the slip instead\./.test(r5.error) && wa.filter((x) => x.payslip_id === id(21)).length === 3, JSON.stringify(r5));
  // failures, in words about the slip
  const [, f1] = await slip(id(25));
  ok('a number that isn\'t on WhatsApp: failed, said plainly, recorded', f1.ok === false && f1.status === 'failed' && /can't get WhatsApp messages.*Give them the printed slip\./.test(f1.error) && wa[wa.length - 1].status === 'failed' && wa[wa.length - 1].phone === '9831100025', JSON.stringify(f1));
  metaMode = 'no-template';
  payslips.push({ id: id(27), staff_id: 'st1', month: '2026-08', status: 'paid', net_pay: 100, paid_mode: 'Cash', paid_on: '2026-09-01' });
  const [, f2] = await slip(id(27));
  ok('the template not made yet: says which one', f2.ok === false && /^The salary slip template "salary_slip" isn't approved yet/.test(f2.error), JSON.stringify(f2));
  metaMode = 'ok';
  ENV.WHATSAPP_TEMPLATE_SLIP = 'pay_slip_v2';
  payslips.push({ id: id(26), staff_id: 'st1', month: '2026-11', status: 'paid', net_pay: 100, paid_mode: 'Cash', paid_on: '2026-12-01' });
  await slip(id(26));
  ok('another template name from the secrets', JSON.parse(graphCalls[graphCalls.length - 1].init.body).template.name === 'pay_slip_v2');
  delete ENV.WHATSAPP_TEMPLATE_SLIP;
  // delivery updates
  const sig = (raw) => 'sha256=' + createHmac('sha256', 'appsecret').update(raw).digest('hex');
  const hookRaw = async (o) => { const raw = JSON.stringify(o); const r = await handler(new Request('https://fn/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': sig(raw) }, body: raw })); return r.json(); };
  const upd = (wamid, status, errors) => ({ entry: [{ changes: [{ value: { statuses: [{ id: wamid, status, errors }] } }] }] });
  const last = wa[wa.length - 1];
  await hookRaw(upd(last.wamid, 'delivered'));
  ok('delivered: the slip row says so', last.status === 'delivered');
  tg.length = 0;
  const one = wa.find((x) => x.payslip_id === id(21) && x.status === 'sent');
  await hookRaw(upd(one.wamid, 'failed', [{ code: 131026, title: 'x' }]));
  ok('a slip that didn\'t reach the phone: both owners hear on Telegram, with what to do', one.status === 'failed' && tg.length === 2 && /^Salary slip not delivered on WhatsApp to 98000 00001\n.*Give them the printed slip\.\nPrint it from Staff → Payroll\.$/.test(tg[0].text), JSON.stringify(tg));
  // not set up
  const keep = ENV.WHATSAPP_TOKEN; ENV.WHATSAPP_TOKEN = '';
  const [, ns] = await slip(id(22));
  ok('WhatsApp not set up: says so (the app then offers the slip as a message)', ns.ok === false && ns.setup === true);
  ENV.WHATSAPP_TOKEN = keep;
}

console.log(`${checks} WhatsApp Business checks, ${fails} failed`);
process.exitCode = fails ? 1 : 0;
