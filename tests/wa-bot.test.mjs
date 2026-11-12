// The WhatsApp booking bot (supabase/functions/whatsapp: botReply, the webhook with the bot on, booking_confirm).
// The conversation is driven tap by tap on the real menu; WhatsApp's limits on lists and buttons are checked on
// every message it makes. Fake Meta, fake Supabase, fake Telegram.
const ENV = {
  SUPABASE_URL: 'https://proj.supabase.co', SUPABASE_ANON_KEY: 'anon', SUPABASE_SERVICE_ROLE_KEY: 'service',
  WHATSAPP_TOKEN: 'WTOKEN', WHATSAPP_PHONE_ID: '1098765', WHATSAPP_APP_SECRET: 'appsecret', WHATSAPP_VERIFY_TOKEN: 'verify-me',
  TELEGRAM_BOT_TOKEN: 'BOT', TELEGRAM_OWNER_CHAT_IDS: '111',
};
globalThis.Deno = { env: { get: (k) => ENV[k] }, serve: () => {} };
import { createHmac, randomUUID } from 'node:crypto';
let checks = 0, fails = 0;
const ok = (n, c, d = '') => { checks++; if (!c) { fails++; console.log('✗', n, typeof d === 'function' ? d() : d); } };

const { menuToServices } = await import('../src/data/menu.js');
const { botReply, waPayload, openHours, slotsFor, pricesText, confirmText, handler } = await import('../supabase/functions/whatsapp/index.ts');
const services = menuToServices().map((s) => ({ ...s, id: randomUUID() }));
const SETTINGS = { salon_name: 'Habibs Hair & Beauty', branch: 'Fuljhore, Durgapur', phone: '+91 89275 63835', opening_hours: '10:00 AM – 9:00 PM, all 7 days', address: 'B-1 More, Durgapur', wa_bot_on: true };
// 11:20 am in India on a Wednesday
const NOW = new Date('2026-11-11T05:50:00Z');
const ctx = (more = {}) => ({ services, offers: [], settings: SETTINGS, now: NOW, customerName: null, profileName: 'Riya Sen', ...more });

// every message within WhatsApp's limits
function limitsOk(m) {
  if (m.type === 'text') return m.body.length <= 4096;
  if (m.type === 'buttons') return m.buttons.length >= 1 && m.buttons.length <= 3 && m.buttons.every((b) => b.title.length <= 20 && b.id.length <= 256) && m.body.length <= 1024
    && new Set(m.buttons.map((b) => b.title)).size === m.buttons.length;
  return m.rows.length >= 1 && m.rows.length <= 10 && m.button.length <= 20 && m.body.length <= 1024 && m.title.length <= 24
    && m.rows.every((r) => r.title.length <= 24 && (!r.description || r.description.length <= 72) && r.id.length <= 200) && new Set(m.rows.map((r) => r.id)).size === m.rows.length;
}
let allMsgs = [];
function step(state, input, c = ctx()) {
  const r = botReply(state, input, c);
  allMsgs.push(...r.out);
  return r;
}
const pick = (id) => ({ kind: 'pick', id });
const say = (text) => ({ kind: 'text', text });
const ids = (m) => (m.type === 'list' ? m.rows.map((r) => r.id) : m.type === 'buttons' ? m.buttons.map((b) => b.id) : []);

// ---------- opening hours and times ----------
ok('opening hours read from the setting', JSON.stringify(openHours('10:00 AM – 9:00 PM, all 7 days')) === '[600,1260]' && JSON.stringify(openHours('9.30am-8pm')) === '[570,1200]' && JSON.stringify(openHours('')) === '[600,1260]');
ok('today: only times an hour from now (11:20 → from 1 PM), to 8 PM', JSON.stringify(slotsFor('2026-11-11', ctx())) === JSON.stringify(['13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00']), slotsFor('2026-11-11', ctx()));
ok('another day: 10 AM to 8 PM (11 times)', slotsFor('2026-11-12', ctx()).length === 11 && slotsFor('2026-11-12', ctx())[0] === '10:00');
ok('late at night: no times left today', slotsFor('2026-11-11', ctx({ now: new Date('2026-11-11T14:00:00Z') })).length === 0);

// ---------- hello ----------
let r = step(null, say('Hi'));
ok('"Hi": a welcome with the name and 3 buttons', r.out.length === 1 && r.out[0].type === 'buttons' && /^Hi Riya! Welcome to Habibs Hair & Beauty Fuljhore/.test(r.out[0].body)
  && JSON.stringify(ids(r.out[0])) === '["m:book","m:prices","m:talk"]', JSON.stringify(r.out));
ok('a known customer is greeted by the salon\'s name for them', /^Hi Ananya!/.test(step(null, say('hello'), ctx({ customerName: 'Ananya Paul' })).out[0].body));
ok('any first message gets the welcome', step(null, say('do you do keratin?')).out[0].type === 'buttons');

// ---------- a whole booking ----------
r = step(r.state, pick('m:book'));
const secList = r.out[0];
const secCount = new Set(services.map((s) => s.section)).size;
ok('Book: the sections in the billing order', secList.type === 'list' && secList.rows.length === Math.min(secCount, 10) && secList.rows[0].title === 'Hair' && secList.rows[1].title === 'Colour', JSON.stringify(secList.rows));
{
  // more sections than a list holds: 9 and More…
  const extra = ['A', 'B', 'C'].map((x) => ({ ...services[0], id: randomUUID(), section: 'Zone ' + x, category: 'Cat ' + x }));
  const c = ctx({ services: [...services, ...extra] });
  const l1 = step(null, pick('m:book'), c);
  ok('more than 10 sections: 9 + More…', l1.out[0].rows.length === 10 && l1.out[0].rows[9].id === 'more:sec:1');
  const l2 = step(l1.state, pick('more:sec:1'), c);
  ok('…More: the rest', l2.out[0].rows.length === secCount + 3 - 9 && l2.out[0].rows[l2.out[0].rows.length - 1].title === 'Zone C', JSON.stringify(l2.out[0].rows));
}
r = step(r.state, pick('sec:1'));   // Colour
ok('a section: its categories', r.out[0].type === 'list' && r.out[0].rows.some((x) => /Women's Colour/.test(x.title)), JSON.stringify(r.out[0]));
const wcol = r.out[0].rows.find((x) => /Women's Colour/.test(x.title)).id;
r = step(r.state, pick(wcol));
const svcList = r.out[0];
ok('a category: its services with prices', svcList.type === 'list' && svcList.rows.every((x) => /^svc:/.test(x.id) || x.id.startsWith('more:svc')) && svcList.rows.some((x) => /₹/.test(x.description || '')), JSON.stringify(svcList));
const gc = services.find((s) => s.name === "Women's Global Colour");
r = step(r.state, pick('svc:' + gc.id));
ok('a service with sizes: asks which one, with "Not sure"', r.out[0].type === 'list' && r.out[0].rows.length === gc.variants.length + 1 && r.out[0].rows[r.out[0].rows.length - 1].id === 'opt:x', JSON.stringify(r.out[0]));
r = step(r.state, pick('opt:1'));
ok('size chosen: added with its price; buttons day / add / start over', r.out[0].type === 'buttons' && r.out[0].body.includes(`${gc.web_name || gc.name} (${gc.variants[1].label}): ₹${gc.variants[1].price.toLocaleString('en-IN')}`)
  && JSON.stringify(ids(r.out[0])) === '["b:day","b:add","b:restart"]', JSON.stringify(r.out[0]));
r = step(r.state, pick('b:add'));
ok('Add another: the sections again', r.out[0].type === 'list' && r.out[0].rows[0].id === 'sec:0');
const facial = services.find((s) => s.section === 'Facials' && !s.variants);
r = step(r.state, pick('svc:' + facial.id));   // a tap on a service straight from a list
ok('second service added', r.state.items.length === 2 && r.out[0].body.includes(facial.web_name || facial.name));
r = step(r.state, say('tomorrow 5pm'));
ok('typing instead of tapping: asked to tap (or type MENU)', /tap one of the options/.test(r.out[0].body) && r.state.items.length === 2);
r = step(r.state, pick('b:day'));
const days = r.out[0];
ok('the days: today (times left) first, 8 days', days.type === 'list' && days.rows.length === 8 && days.rows[0].title === 'Today' && days.rows[1].title === 'Tomorrow' && days.rows[0].id === 'day:2026-11-11', JSON.stringify(days.rows));
r = step(r.state, pick('day:2026-11-12'));
ok('a day: its times (11 → 9 + More…)', r.out[0].type === 'list' && r.out[0].rows[0].title === '10:00 AM' && r.out[0].rows[9].id === 'more:time:1', JSON.stringify(r.out[0].rows));
ok('…More: 7 PM and 8 PM', JSON.stringify(step(r.state, pick('more:time:1')).out[0].rows.map((x) => x.title)) === '["7:00 PM","8:00 PM"]');
r = step(r.state, pick('time:17:00'));
ok('a time: "Is the booking for Riya Sen?"', r.out[0].type === 'buttons' && r.out[0].body === 'Is the booking for Riya Sen?' && JSON.stringify(ids(r.out[0])) === '["b:name","b:othername"]');
r = step(r.state, pick('b:othername'));
r = step(r.state, say('R1ya!!'));
ok('a name with numbers: asked again', /just the name/.test(r.out[0].body) && r.state.step === 'name');
r = step(r.state, say('  Riya   Das '));
ok('the summary: services, day, time, name; Send request', r.out[0].type === 'buttons' && /📅 Tomorrow, 5:00 PM\n👤 Riya Das/.test(r.out[0].body) && ids(r.out[0])[0] === 'b:send', JSON.stringify(r.out[0]));
const sent = step(r.state, pick('b:send'));
ok('Send request: the booking for the database (services, options, day, time, name), the steps start again',
  sent.action && sent.action.type === 'book' && sent.action.booking.date === '2026-11-12' && sent.action.booking.time === '17:00' && sent.action.booking.name === 'Riya Das'
  && JSON.stringify(sent.action.booking.items) === JSON.stringify([{ service_id: gc.id, option: gc.variants[1].label }, { service_id: facial.id, option: null }]) && sent.state.step === 'menu' && sent.state.items.length === 0,
  JSON.stringify(sent));
ok('…tapping Send again on the old message books nothing', !step(sent.state, pick('b:send')).action);

// ---------- known customer: no name question; today past times refused ----------
{
  const c = ctx({ customerName: 'Ananya Paul' });
  let s = step(null, pick('m:book'), c).state;
  s = step(s, pick('svc:' + facial.id), c).state;
  s = step(s, pick('b:day'), c).state;
  s = step(s, pick('day:2026-11-11'), c).state;
  const past = step(s, pick('time:11:00'), c);
  ok('a time already gone today is refused, with the times again', /passed/.test(past.out[0].body) && past.out[1].type === 'list');
  const t = step(s, pick('time:13:00'), c);
  ok('a known customer: straight to the summary with their name', t.out[0].type === 'buttons' && /👤 Ananya Paul/.test(t.out[0].body));
  const later = step(t.state, pick('b:send'), { ...c, now: new Date('2026-11-11T07:45:00Z') });
  ok('the time passed while they waited: not sent, choose again', !later.action && /just passed/.test(later.out[0].body));
}
// ---------- 5 services at most ----------
{
  let s = step(null, pick('m:book')).state;
  for (let i = 0; i < 5; i++) s = step(s, pick('svc:' + services.filter((x) => !x.variants)[i].id)).state;
  const last = step(s, pick('svc:' + services.filter((x) => !x.variants)[5].id));
  ok('a 6th service: not added, on to the day', last.state.items.length === 5 && last.out[0].type === 'list' && last.out[0].rows[0].id.startsWith('day:'));
}
// ---------- old or odd taps ----------
ok('a tap on a list from yesterday: the welcome again', step({ step: 'day', items: [{}], at: '2026-11-10T05:00:00Z' }, pick('day:2026-11-12')).out[0].type === 'buttons');
ok('a service taken off the menu: said, and the sections again', /can't be booked/.test(step({ step: 'service', items: [], at: NOW.toISOString() }, pick('svc:' + randomUUID())).out[0].body));
ok('MENU in the middle: back to the welcome', step({ step: 'time', items: [{}], date: '2026-11-12', at: NOW.toISOString() }, say('menu')).out[0].type === 'buttons');
ok('a photo with nothing going on: the welcome', step(null, { kind: 'other' }).out[0].type === 'buttons');
// ---------- prices and talk ----------
{
  const offers = [{ name: 'Diwali Glow 20% off', note: 'On all facials', active: true, show_on_website: true, ends_on: '2026-11-15' },
    { name: 'Weekend only', active: true, show_on_website: true, days: [6, 7] }, { name: 'Staff secret', active: true, show_on_website: false }, { name: 'Over', active: true, ends_on: '2026-11-01' }];
  const p = step(null, pick('m:prices'), ctx({ offers }));
  ok('Prices & offers: the offers running today, "from" prices by section, then Book / Talk', p.out[0].type === 'text' && /🎁 Diwali Glow 20% off – On all facials \(till Sun 15 Nov\)/.test(p.out[0].body)
    && !/Weekend only|Staff secret|Over/.test(p.out[0].body) && /\*Hair\*\n.*: from ₹/.test(p.out[0].body) && JSON.stringify(ids(p.out[1])) === '["m:book","m:talk"]', p.out[0].body.slice(0, 400));
  ok('…kept as an enquiry', p.action && p.action.type === 'enquiry' && /prices/.test(p.action.message));
  ok('the price list fits in one message', pricesText(ctx()).length <= 4096);
  const t = step(null, pick('m:talk'));
  ok('Talk to us: they type, the salon calls back; the hours and the number; an enquiry for the owners', /call you back/.test(t.out[0].body) && /10:00 AM – 9:00 PM/.test(t.out[0].body) && /\+91 89275 63835/.test(t.out[0].body) && t.action.talk === true);
}
ok('every message the bot made is within WhatsApp\'s limits', allMsgs.length > 30 && allMsgs.every(limitsOk), () => JSON.stringify(allMsgs.find((m) => !limitsOk(m))));
{
  const lp = waPayload('919830011111', { type: 'list', body: 'x', button: 'Choose a time please now', title: 'T', rows: [{ id: 'a', title: 'A very long service name that goes on', description: 'd'.repeat(100) }] });
  ok('the API message: a list cut to WhatsApp\'s sizes', lp.type === 'interactive' && lp.interactive.type === 'list' && lp.interactive.action.button.length <= 20 && lp.interactive.action.sections[0].rows[0].title.length === 24 && lp.interactive.action.sections[0].rows[0].description.length === 72);
  const bp = waPayload('919830011111', { type: 'buttons', body: 'x', buttons: [{ id: 'm:book', title: 'Book appointment' }] });
  ok('…buttons as reply buttons', bp.interactive.type === 'button' && bp.interactive.action.buttons[0].reply.id === 'm:book');
}
ok('the confirmation text: day and time, services, ref, address, how to change it',
  confirmText({ name: 'Riya Das', slot_at: '2026-11-12T11:30:00Z', ref: 'AB12CD' }, [{ name: 'Facial', option_label: null }, { name: "Women's Global Colour", option_label: 'M' }], SETTINGS, NOW)
  === "Confirmed ✅\nHi Riya, your appointment at Habibs Hair & Beauty Fuljhore is booked for tomorrow at 5:00 PM.\n• Facial\n• Women's Global Colour (M)\nRef AB12CD\n📍 B-1 More, Durgapur\n\nNeed to change it? Call us on +91 89275 63835.",
  confirmText({ name: 'Riya Das', slot_at: '2026-11-12T11:30:00Z', ref: 'AB12CD' }, [{ name: 'Facial', option_label: null }, { name: "Women's Global Colour", option_label: 'M' }], SETTINGS, NOW));

// ================= the webhook with the bot on (fake Supabase) =================
const chats = new Map(), enquiries = [], bookingsMade = [], tg = [], sentMsgs = [];
let settingsNow = { ...SETTINGS };
const res = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const booking = { id: '00000000-1111-4222-8333-944455556666', phone: '9830011111', name: 'Riya Das', status: 'confirmed', slot_at: '2026-11-20T11:30:00Z', ref: 'AB12CD', source: 'whatsapp', booking_items: [{ name: 'Facial', option_label: null }] };
const patches = [];
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url); const h = init.headers || {}; const m = init.method || 'GET';
  if (u.host === 'api.telegram.org') { tg.push(JSON.parse(init.body)); return res({ ok: true }); }
  if (u.host === 'graph.facebook.com') { sentMsgs.push(JSON.parse(init.body)); return res({ messages: [{ id: 'wamid.x' }] }); }
  if (u.pathname === '/rest/v1/bookings' && m === 'GET') return h.Authorization === 'Bearer USER' && h.apikey === 'anon' ? res([booking]) : res([]);
  if (h.Authorization !== 'Bearer service') return res({ message: 'no' }, 401);
  const phone = (u.searchParams.get('phone') || '').replace(/^eq\./, '');
  if (u.pathname === '/rest/v1/settings') return res(Object.entries(settingsNow).map(([key, value]) => ({ key, value })));
  if (u.pathname === '/rest/v1/wa_chats') {
    if (m === 'GET') return res(chats.has(phone) ? [chats.get(phone)] : []);
    const b = JSON.parse(init.body); chats.set(b.phone, { ...(chats.get(b.phone) || {}), ...b }); return res([], 201);
  }
  if (u.pathname === '/rest/v1/customers') return res(phone === '9830022222' ? [{ name: 'Ananya Paul' }] : []);
  if (u.pathname === '/rest/v1/services') return res(services);
  if (u.pathname === '/rest/v1/offers') return res([]);
  if (u.pathname === '/rest/v1/rpc/wa_enquiry') { const p = JSON.parse(init.body).p; enquiries.push(p); return res({ id: 'e1', ref: 'EQ0001', fresh: enquiries.length === 1 }); }
  if (u.pathname === '/rest/v1/rpc/wa_book') { const p = JSON.parse(init.body).p; bookingsMade.push(p); return bookingsMade.length > 1 && p.name === 'Spam' ? res({ message: 'Too many' }, 400) : res({ id: 'b1', ref: 'XY34ZW' }); }
  if (u.pathname === '/rest/v1/bookings') { patches.push([u.search, JSON.parse(init.body)]); return res([]); }
  if (u.pathname === '/rest/v1/feedback') return res([]);
  return res({ message: 'not found ' + u.pathname }, 404);
};
const hook = async (from, msg, name = 'Riya Sen') => {
  const raw = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: from, profile: { name } }], messages: [{ from, id: 'wamid.' + Math.random(), ...msg }] } }] }] });
  const r = await handler(new Request('https://fn/whatsapp', { method: 'POST', headers: { 'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', 'appsecret').update(raw).digest('hex') }, body: raw }));
  return r.json();
};
const tap = (id) => ({ type: 'interactive', interactive: { type: 'list_reply', list_reply: { id, title: 'x' } } });
const btn = (id) => ({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: 'x' } } });
const text = (body) => ({ type: 'text', text: { body } });
const R = '919830011111';

await hook(R, text('Hi'));
ok('webhook: "Hi" → the welcome buttons to that number, nothing to Telegram', sentMsgs.length === 1 && sentMsgs[0].to === R && sentMsgs[0].interactive.type === 'button' && tg.length === 0, JSON.stringify(sentMsgs));
ok('…the chat remembered: last message time (for the 24 hours) and the step', !!chats.get('9830011111').last_in_at && chats.get('9830011111').state.step === 'menu');
await hook(R, btn('m:book'));
await hook(R, tap('svc:' + facial.id));
await hook(R, btn('b:day'));
const dayIds = sentMsgs[sentMsgs.length - 1].interactive.action.sections[0].rows.map((x) => x.id);
await hook(R, tap(dayIds[1]));
await hook(R, tap('time:12:00'));
await hook(R, btn('b:name'));
sentMsgs.length = 0;
await hook(R, btn('b:send'));
ok('webhook: Send request → the booking saved (wa_book) with the profile name', bookingsMade.length === 1 && bookingsMade[0].phone === '9830011111' && bookingsMade[0].name === 'Riya Sen' && bookingsMade[0].time === '12:00' && bookingsMade[0].items[0].service_id === facial.id, JSON.stringify(bookingsMade));
ok('…the customer gets "Request sent" with the ref', sentMsgs.length === 1 && /^Request sent ✅ \(ref XY34ZW\)/.test(sentMsgs[0].text.body), JSON.stringify(sentMsgs));
ok('…the owners get it on Telegram, to confirm in the app, and it is marked told', tg.length === 1 && /^New WhatsApp booking request XY34ZW\nRiya Sen \(98300 11111\)/.test(tg[0].text) && /Appointments → Requests/.test(tg[0].text)
  && patches.some(([s, b]) => s === '?id=eq.b1' && b.notified_at), JSON.stringify(tg));

// talk to us → quiet, messages go to the owners and the enquiry
tg.length = 0; sentMsgs.length = 0;
await hook(R, btn('m:talk'));
ok('Talk to us: the owners hear at once, the enquiry kept, the bot goes quiet', tg.length === 1 && /wants to talk to the salon/.test(tg[0].text) && enquiries.length === 1 && !!chats.get('9830011111').human_until);
await hook(R, text('Do you have a slot for bridal trial on Sunday?'));
ok('…what they type next: to the owners and into the enquiry, no bot answer', tg.length === 2 && /bridal trial/.test(tg[1].text) && enquiries.length === 2 && /bridal trial/.test(enquiries[1].message) && sentMsgs.length === 1, JSON.stringify(sentMsgs));
await hook(R, text('menu'));
ok('…MENU brings the bot back', sentMsgs.length === 2 && sentMsgs[1].interactive && chats.get('9830011111').human_until === null);

// a reply to the bill, a photo: to the owners, not the bot
tg.length = 0; sentMsgs.length = 0;
await hook('919830033333', { ...text('The facial was ₹2,500 not ₹2,800'), context: { id: 'wamid.bill' } }, 'Moumita');
await hook('919830033333', { type: 'image', image: { id: 'x' } }, 'Moumita');
ok('a reply to a bill, a photo: to the owners (and kept as an enquiry), no bot answer', tg.length === 2 && sentMsgs.length === 0 && /₹2,500/.test(tg[0].text) && /a photo/.test(tg[1].text), JSON.stringify([tg, sentMsgs]));

// bot off: as before (to the owners), but the 24 hours are still recorded
settingsNow = { ...SETTINGS, wa_bot_on: false };
tg.length = 0; sentMsgs.length = 0;
await hook('919830044444', text('Hi'));
ok('bot off: no answer, passed to the owners, the time of the message kept', sentMsgs.length === 0 && tg.length === 1 && !!chats.get('9830044444').last_in_at);
settingsNow = { ...SETTINGS };

// ---------- the counter confirms → the confirmation on WhatsApp ----------
const confirm = async (auth = 'Bearer USER') => (await handler(new Request('https://fn/whatsapp', { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify({ action: 'booking_confirm', id: booking.id }) }))).json();
sentMsgs.length = 0; patches.length = 0;
let c = await confirm();
ok('confirm: sent as a message (they wrote within 24 hours), marked "confirmation sent"', c.ok === true && sentMsgs.length === 1 && sentMsgs[0].to === R && /^Confirmed ✅\nHi Riya/.test(sentMsgs[0].text.body)
  && patches.some(([s, b]) => s === `?id=eq.${booking.id}` && b.confirm_sent_at), JSON.stringify([c, sentMsgs]));
ok('confirm: a login that can\'t see the booking is refused', (await confirm('Bearer OTHER')).error === 'Not allowed');
chats.get('9830011111').last_in_at = new Date(Date.now() - 25 * 3600e3).toISOString();
c = await confirm();
ok('confirm: more than 24 hours since they wrote → not sent; the app uses its WhatsApp button', c.ok === false && c.window === true && sentMsgs.length === 1);
booking.status = 'requested';
ok('confirm: a request without a time is refused', /time first/.test((await confirm()).error || ''));

console.log(`${checks} WhatsApp booking bot checks, ${fails} failed`);
if (fails) process.exit(1);
