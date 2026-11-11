// Supabase Edge Function: whatsapp
//
// Sends a bill to the customer on WhatsApp through the WhatsApp Business Platform (Cloud API, Meta), with the bill
// picture (the same as the printed bill), and takes Meta's webhook: delivery updates (sent, delivered, read, failed)
// and customers' replies (passed on to the owners on Telegram).
//
// The app calls it (signed in, approved login):
//   { action: 'bill', id, image, again }  image = the bill picture, PNG in base64. Sent once by itself after saving;
//                                         `again` sends it again (at most 3 times a bill, not twice within a minute).
//   { action: 'slip', id, image, again }  a salary slip (the breakup as a picture) to the staff member's own number,
//                                         when the owner marks the salary paid. id = the payslip. Owner only: the
//                                         payslip must be readable by the caller's login, and only the owner's is.
//   { action: 'status' }                  is WhatsApp set up, and which number sends (Settings → Check)
//   { action: 'auto' }                    send the automatic messages due now: feedback after a visit, booking
//                                         reminders, "we miss you". The app asks every 20 minutes while it is open;
//                                         with supabase/05_daily_schedule.sql the database asks every 30 minutes
//                                         (header x-cron-secret = CRON_SECRET), so they go with the app closed too.
// Meta calls it:
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…   once, when the webhook is connected
//   POST signed with the app secret (X-Hub-Signature-256)          delivery updates and customers' messages
//
// Secrets (Supabase → Edge Functions → Secrets), see README "WhatsApp bills":
//   WHATSAPP_TOKEN          permanent access token (Meta Business settings → System users → Generate token,
//                           permission whatsapp_business_messaging)
//   WHATSAPP_PHONE_ID       Phone number ID (WhatsApp Manager / the Meta app → WhatsApp → API setup)
//   WHATSAPP_APP_SECRET     the Meta app's secret (App settings → Basic): proves webhook calls come from Meta
//   WHATSAPP_VERIFY_TOKEN   any long random text, typed again when connecting the webhook in Meta
//   WHATSAPP_TEMPLATE       optional, default bill_receipt;  WHATSAPP_TEMPLATE_LANG optional, default en
//   WHATSAPP_API_VERSION    optional, default v23.0
//   TELEGRAM_BOT_TOKEN, TELEGRAM_OWNER_CHAT_IDS (already there for login-approval): customers' replies go to the owners
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. The service key stays here.
//
// Deploy with "Verify JWT" turned OFF (Meta can't send a Supabase login token); this function checks every caller:
// the app's calls with the user's own login (the bill must be readable by that login), Meta's with the signature.
//
// The template (WhatsApp Manager → Message templates → Create; category Utility, language English, name bill_receipt):
//   Header: Image
//   Body:   Hi {{1}}, thank you for visiting Habibs Hair & Beauty Fuljhore. Your bill {{2}} for ₹{{3}} is in the
//           picture above. {{4}} Reply here if anything on the bill is not right.
//   Footer: Habibs Hair & Beauty · Fuljhore, Durgapur
// {{1}} first name, {{2}} bill number, {{3}} total (e.g. 3,300), {{4}} the loyalty points line.
//
// The automatic messages (Settings → Salon & bill → WhatsApp: automatic messages) need three more templates, English:
//   visit_feedback (category Utility; Meta may file it under Marketing)
//     Body:    Hi {{1}}, thank you for visiting Habibs Hair & Beauty Fuljhore. How was your visit? Tap an answer below.
//     Buttons: Quick reply ×3: "Loved it" · "It was okay" · "Not happy"
//   booking_reminder (Utility)
//     Body:    Hi {{1}}, a reminder of your appointment at Habibs Hair & Beauty Fuljhore: {{2}}, for {{3}}. Reply here if you need to change the time.
//   we_miss_you (Marketing)
//     Body:    Hi {{1}}, it has been a while since your last visit to Habibs Hair & Beauty Fuljhore. {{2}} Reply here to book your slot. Reply STOP to stop these messages.
//   salary_slip (Utility)
//     Header:  Image
//     Body:    Hi {{1}}, your salary for {{2}} at Habibs Hair & Beauty Fuljhore has been paid: ₹{{3}} by {{4}} on {{5}}. The full breakup is in the picture above. Tell the owner if anything is not right.
//     {{1}} first name, {{2}} the month (October 2026), {{3}} net pay, {{4}} how it was paid, {{5}} the date.
// Other names: secrets WHATSAPP_TEMPLATE_SLIP, WHATSAPP_TEMPLATE_FEEDBACK, WHATSAPP_TEMPLATE_REMINDER, WHATSAPP_TEMPLATE_WINBACK.
// A customer's answer to visit_feedback comes back through the webhook: it is saved (table feedback), they get a
// thank-you with the Google review link (free inside WhatsApp's 24-hour reply window), and "Not happy" goes to the
// owners on Telegram at once. A customer who replies STOP gets no more automatic messages.

const env = (k: string) => Deno.env.get(k) || '';
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const graph = (path: string) => `https://graph.facebook.com/${env('WHATSAPP_API_VERSION') || 'v23.0'}/${path}`;
const configured = () => !!(env('WHATSAPP_TOKEN') && env('WHATSAPP_PHONE_ID'));
const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const MAX_SENDS = 3;
const MAX_DAYS = 30;
const MAX_IMAGE = 4_500_000; // bytes (WhatsApp takes pictures up to 5 MB)

// Database with the service key (only inside this function)
function rest(path: string, init: RequestInit = {}) {
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  return fetch(`${env('SUPABASE_URL')}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
}
// The bill as the signed-in user may see it (row level security: approved logins only), or null
async function billAsUser(req: Request, id: string) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/bills?id=eq.${id}&select=*`, {
    headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const rows = await r.json();
  return Array.isArray(rows) && rows[0] ? { bill: rows[0], email: emailOf(token) } : null;
}
function emailOf(token: string) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).email || null;
  } catch { return null; }
}
async function signedIn(req: Request) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const r = await fetch(`${env('SUPABASE_URL')}/auth/v1/user`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` } });
  return r.ok;
}

// What went wrong, in plain words (Meta's error codes)
export function errorText(e: any) {
  const code = Number(e && (e.code ?? e.error_code));
  const tpl = env('WHATSAPP_TEMPLATE') || 'bill_receipt';
  if (code === 131026) return "This number can't get WhatsApp messages (not on WhatsApp, or a very old WhatsApp). Send the bill the other way.";
  if (code === 132001) return `The bill template "${tpl}" isn't approved yet (or not in this language) in WhatsApp Manager.`;
  if (code === 132000 || code === 132012 || code === 132018) return `The bill template "${tpl}" doesn't match what the app sends: a picture and 4 values (see README).`;
  if (code === 190 || code === 10 || code === 200) return 'The WhatsApp access token is wrong or has expired. Make a new one (README, WhatsApp bills).';
  if (code === 131056 || code === 4 || code === 80007 || code === 130429) return 'Too many messages just now. Try again in a minute.';
  if (code === 131031 || code === 368) return 'The WhatsApp account is blocked or restricted. Check WhatsApp Manager.';
  if (code === 131042) return 'WhatsApp payment problem: add or fix the payment method in WhatsApp Manager.';
  if (code === 131053 || code === 131052) return "WhatsApp couldn't take the bill picture. Try again.";
  if (code === 133010) return "The WhatsApp number isn't registered yet (WhatsApp Manager → Phone numbers).";
  const msg = (e && (e.error_data && e.error_data.details)) || (e && (e.message || e.title)) || 'unknown error';
  return `WhatsApp said: ${msg}${code ? ` (code ${code})` : ''}`;
}

const inr = (n: number) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
// Template values can't have new lines, tabs or more than 4 spaces in a row
const clean = (s: string) => String(s || '').replace(/[\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 200);
export function billValues(b: any) {
  const first = clean(String(b.customer_name || '').trim().split(/\s+/)[0]) || 'there';
  const earned = Number(b.points_earned) || 0;
  const used = Number(b.paid_points) || 0;
  const bal = b.points_balance == null ? null : Number(b.points_balance);
  let pts = 'Thank you for choosing us.';
  if (!b.for_staff) {
    if (earned > 0) pts = `You earned ${earned} loyalty points${bal != null ? `, balance ${bal} = ₹${inr(bal)} off your next visit` : ''}.`;
    else if (used > 0) pts = `You paid ₹${inr(used)} with loyalty points${bal != null ? `, balance ${bal}` : ''}.`;
    else if (bal) pts = `Your loyalty points: ${bal} = ₹${inr(bal)} off your next visit.`;
  }
  return [first, clean(b.bill_no), inr(b.total), clean(pts)];
}

function pngBytes(b64: string) {
  if (typeof b64 !== 'string' || !b64) return null;
  const s = b64.replace(/^data:image\/png;base64,/, '');
  if (s.length > (MAX_IMAGE * 4) / 3 + 4) return 'big';
  let bin: string;
  try { bin = atob(s); } catch { return null; }
  const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  // a PNG starts with 89 50 4E 47
  if (u.length < 8 || u[0] !== 0x89 || u[1] !== 0x50 || u[2] !== 0x4e || u[3] !== 0x47) return null;
  return u;
}

// ---- the app: send a bill ----
async function sendBill(req: Request, body: any) {
  const id = String(body.id || '');
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const who = await billAsUser(req, id);
  if (!who) return json({ error: 'Not allowed' }, 401);
  const b = who.bill;
  if (!configured()) return json({ ok: false, error: 'WhatsApp is not set up yet (README, WhatsApp bills).' });
  if (b.status !== 'paid') return json({ ok: false, error: 'This bill is cancelled.' });
  if (!/^[6-9]\d{9}$/.test(String(b.customer_phone || ''))) return json({ ok: false, error: 'There is no mobile number on this bill.' });
  if (Date.now() - new Date(b.created_at).getTime() > MAX_DAYS * 86400000) return json({ ok: false, error: `Bills older than ${MAX_DAYS} days aren't sent.` });
  const png = pngBytes(body.image);
  if (png === 'big') return json({ ok: false, error: 'The bill picture is too big.' });
  if (!png) return json({ ok: false, error: 'The bill picture is missing.' });

  // once by itself; again by hand, at most 3 times, never twice within a minute (a double tap)
  const pr = await rest(`wa_messages?bill_id=eq.${id}&select=id,status,created_at&order=created_at.desc`);
  const prev = pr.ok ? await pr.json() : [];
  const sent = (Array.isArray(prev) ? prev : []).filter((m: any) => m.status !== 'failed');
  if (prev.length && Date.now() - new Date(prev[0].created_at).getTime() < 60000 && prev[0].status !== 'failed') {
    return json({ ok: true, status: prev[0].status, already: true });
  }
  if (sent.length && !body.again) return json({ ok: true, status: sent[0].status, already: true });
  if (prev.length >= MAX_SENDS) return json({ ok: false, error: `Sent ${MAX_SENDS} times already. Use the WhatsApp button (2 taps) instead.` });

  const ins = await rest('wa_messages', {
    method: 'POST',
    body: JSON.stringify({ bill_id: id, phone: b.customer_phone, kind: 'bill', status: 'sending', created_by: who.email }),
  });
  const row = ins.ok ? (await ins.json())[0] : null;
  if (!row) return json({ ok: false, error: 'The database is not ready for WhatsApp bills: run supabase/01_schema.sql again.' });
  const fail = async (e: any) => {
    const text = errorText(e);
    if (row) await rest(`wa_messages?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: text, updated_at: new Date().toISOString() }) });
    // the counter sees it on the screen; the owners hear of it too (the bill didn't reach the customer)
    await telegramOwners(`WhatsApp bill ${b.bill_no} not sent to ${phone10(b.customer_phone)}\n${text}\nSend it the other way from Bills (WhatsApp, 2 taps).`).catch(() => 0);
    return json({ ok: false, status: 'failed', error: text });
  };
  try {
    const out = await sendPicture(b.customer_phone, env('WHATSAPP_TEMPLATE') || 'bill_receipt', png, `Bill ${b.bill_no}.png`, billValues(b));
    if (out.error) return fail(out.error);
    await rest(`wa_messages?id=eq.${row.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', wamid: out.wamid, updated_at: new Date().toISOString() }) });
    return json({ ok: true, status: 'sent' });
  } catch (e) {
    return fail({ message: (e as Error).message });
  }
}

// The picture goes up to WhatsApp, then the template with the picture on top
async function sendPicture(to: string, template: string, png: Uint8Array, fileName: string, values: string[]) {
  const auth = { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` };
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([png], { type: 'image/png' }), fileName);
  const up = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}/media`), { method: 'POST', headers: auth, body: form });
  const upj = await up.json().catch(() => ({}));
  if (!up.ok || !upj.id) return { error: upj.error || { message: 'the picture could not be uploaded' } };
  const msg = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}/messages`), {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '91' + to,
      type: 'template',
      template: {
        name: template,
        language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'en' },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { id: upj.id } }] },
          { type: 'body', parameters: values.map((text) => ({ type: 'text', text })) },
        ],
      },
    }),
  });
  const mj = await msg.json().catch(() => ({}));
  const wamid = mj && mj.messages && mj.messages[0] && mj.messages[0].id;
  return msg.ok && wamid ? { wamid } : { error: mj.error || { message: 'no message id' } };
}

// ---- the app: send a salary slip to the staff member (owner only) ----
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthText = (m: string) => { const [y, mo] = String(m || '').split('-').map(Number); return MONTHS[mo - 1] ? `${MONTHS[mo - 1]} ${y}` : String(m || ''); };
const dayText = (d: string) => { const [y, mo, dd] = String(d || '').slice(0, 10).split('-').map(Number); return MONTHS[mo - 1] ? `${dd} ${MONTHS[mo - 1].slice(0, 3)} ${y}` : String(d || ''); };
export function slipValues(p: any, staff: any) {
  return [firstName(staff.name), monthText(p.month), inr(p.net_pay), clean(p.paid_mode || 'cash'), dayText(p.paid_on)];
}
const slipError = (text: string) => text.replace(/Send the bill the other way\./, 'Give them the printed slip.').replace(/bill picture/g, 'slip picture')
  .replace(/The bill template "[^"]*"/, `The salary slip template "${env('WHATSAPP_TEMPLATE_SLIP') || 'salary_slip'}"`).replace(/a picture and 4 values/, 'a picture and 5 values');
async function sendSlip(req: Request, body: any) {
  const id = String(body.id || '');
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  // payslips are the owner's: anyone else's login reads nothing here
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not allowed' }, 401);
  const pr = await fetch(`${env('SUPABASE_URL')}/rest/v1/payslips?id=eq.${id}&select=*`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` } });
  const prow = pr.ok ? await pr.json() : null;
  const p = Array.isArray(prow) ? prow[0] : null;
  if (!p) return json({ error: 'Not allowed' }, 401);
  if (!configured()) return json({ ok: false, setup: true, error: 'WhatsApp is not set up yet (README, WhatsApp bills).' });
  if (p.status !== 'paid') return json({ ok: false, error: 'This salary is not marked paid yet.' });
  const sr = await rest(`staff?id=eq.${p.staff_id}&select=id,name,phone`);
  const st = sr.ok ? (await sr.json())[0] : null;
  if (!st) return json({ ok: false, error: 'This staff member is not in the staff list any more.' });
  const phone = String(st.phone || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return json({ ok: false, error: `${firstName(st.name)} has no mobile number in Staff. Add it, then send the slip.` });
  const png = pngBytes(body.image);
  if (png === 'big') return json({ ok: false, error: 'The slip picture is too big.' });
  if (!png) return json({ ok: false, error: 'The slip picture is missing.' });

  // once by itself; again by hand, at most 3 times, never twice within a minute
  const wr = await rest(`wa_messages?payslip_id=eq.${id}&select=id,status,created_at&order=created_at.desc`);
  if (!wr.ok) return json({ ok: false, error: 'The database is not ready for salary slips on WhatsApp: run supabase/01_schema.sql again.' });
  const prev = await wr.json();
  const sent = prev.filter((m: any) => m.status !== 'failed');
  if (prev.length && Date.now() - new Date(prev[0].created_at).getTime() < 60000 && prev[0].status !== 'failed') return json({ ok: true, status: prev[0].status, already: true });
  if (sent.length && !body.again) return json({ ok: true, status: sent[0].status, already: true });
  if (prev.length >= MAX_SENDS) return json({ ok: false, error: `Sent ${MAX_SENDS} times already. Print the slip instead.` });

  const ins = await rest('wa_messages', { method: 'POST', body: JSON.stringify({ payslip_id: id, phone, kind: 'slip', status: 'sending', created_by: emailOf(token) }) });
  const row = ins.ok ? (await ins.json())[0] : null;
  if (!row) return json({ ok: false, error: 'The database is not ready for salary slips on WhatsApp: run supabase/01_schema.sql again.' });
  const fail = async (e: any) => {
    const text = slipError(errorText(e));
    await rest(`wa_messages?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: text, updated_at: new Date().toISOString() }) });
    return json({ ok: false, status: 'failed', error: text });
  };
  try {
    const out = await sendPicture(phone, env('WHATSAPP_TEMPLATE_SLIP') || 'salary_slip', png, `Salary slip ${p.month}.png`, slipValues(p, st));
    if (out.error) return fail(out.error);
    await rest(`wa_messages?id=eq.${row.id}&status=eq.sending`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', wamid: out.wamid, updated_at: new Date().toISOString() }) });
    return json({ ok: true, status: 'sent', name: firstName(st.name) });
  } catch (e) {
    return fail({ message: (e as Error).message });
  }
}

// ---- the app: is it set up? ----
async function status(req: Request) {
  if (!(await signedIn(req))) return json({ error: 'Not signed in' }, 401);
  const missing = ['WHATSAPP_TOKEN', 'WHATSAPP_PHONE_ID', 'WHATSAPP_APP_SECRET', 'WHATSAPP_VERIFY_TOKEN'].filter((k) => !env(k));
  const out: any = { configured: configured(), missing, template: env('WHATSAPP_TEMPLATE') || 'bill_receipt', lang: env('WHATSAPP_TEMPLATE_LANG') || 'en' };
  if (configured()) {
    const r = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}?fields=display_phone_number,verified_name,quality_rating`), { headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}` } });
    const j = await r.json().catch(() => ({}));
    if (r.ok) Object.assign(out, { number: j.display_phone_number, name: j.verified_name, quality: j.quality_rating });
    else out.error = errorText(j.error || {});
  }
  return json(out);
}

// ---- Meta: the webhook ----
async function validSignature(req: Request, raw: string) {
  const sig = req.headers.get('X-Hub-Signature-256') || '';
  const secret = env('WHATSAPP_APP_SECRET');
  if (!secret || !sig.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (x) => x.toString(16).padStart(2, '0')).join('');
  const got = sig.slice(7).toLowerCase();
  if (got.length !== hex.length) return false;
  let d = 0;
  for (let i = 0; i < hex.length; i++) d |= hex.charCodeAt(i) ^ got.charCodeAt(i);
  return d === 0;
}
// A status only moves forward: sending → sent → delivered → read. Failed replaces sending or sent.
const BEFORE: Record<string, string> = { sent: 'sending', delivered: 'sending,sent,failed', read: 'sending,sent,delivered,failed', failed: 'sending,sent' };
async function telegramOwners(text: string) {
  const chats = env('TELEGRAM_OWNER_CHAT_IDS').split(',').map((s) => s.trim()).filter(Boolean);
  if (!env('TELEGRAM_BOT_TOKEN')) return 0;
  let n = 0;
  for (const chat_id of chats) {
    const r = await fetch(`https://api.telegram.org/bot${env('TELEGRAM_BOT_TOKEN')}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id, text }),
    });
    if (r.ok) n++;
  }
  return n;
}
const phone10 = (p: string) => { const d = String(p || '').replace(/\D/g, '').slice(-10); return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : p; };
function messageText(m: any) {
  if (m.type === 'text') return m.text && m.text.body;
  if (m.type === 'button') return m.button && m.button.text;
  if (m.type === 'interactive') return (m.interactive && (m.interactive.button_reply || m.interactive.list_reply) || {}).title;
  if (m.type === 'reaction') return `reacted ${m.reaction && m.reaction.emoji ? m.reaction.emoji : ''} to the bill`;
  return `[${m.type === 'image' ? 'a photo' : m.type === 'audio' ? 'a voice message' : m.type === 'document' ? 'a document' : m.type === 'sticker' ? 'a sticker' : m.type}]`;
}
async function fromMeta(req: Request) {
  const raw = await req.text();
  if (!(await validSignature(req, raw))) return json({ error: 'Wrong signature' }, 401);
  let body: any = {};
  try { body = JSON.parse(raw); } catch { return json({ ok: true }); }
  let updated = 0, forwarded = 0;
  for (const entry of body.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      for (const st of v.statuses || []) {
        if (!st.id || !BEFORE[st.status]) continue;
        const patch: any = { status: st.status, updated_at: new Date().toISOString() };
        if (st.status === 'failed') patch.error = errorText((st.errors || [])[0] || {});
        const r = await rest(`wa_messages?wamid=eq.${encodeURIComponent(st.id)}&status=in.(${BEFORE[st.status]})`, { method: 'PATCH', body: JSON.stringify(patch) });
        if (r.ok) {
          const rows = await r.json();
          updated += rows.length;
          // a bill that didn't reach the customer: the owners hear of it
          if (st.status === 'failed') for (const w of rows) if (w.kind === 'slip') forwarded += await telegramOwners(`Salary slip not delivered on WhatsApp to ${phone10(w.phone)}\n${slipError(patch.error)}\nPrint it from Staff → Payroll.`);
          if (st.status === 'failed') {
            for (const w of rows) {
              if ((w.kind || 'bill') !== 'bill') continue;
              const bn = w.bill_id ? await rest(`bills?id=eq.${w.bill_id}&select=bill_no`).then((x) => (x.ok ? x.json() : [])).then((x) => (x[0] && x[0].bill_no) || '').catch(() => '') : '';
              forwarded += await telegramOwners(`WhatsApp bill ${bn ? bn + ' ' : ''}not delivered to ${phone10(w.phone)}\n${patch.error}\nSend it the other way from Bills (WhatsApp, 2 taps).`);
            }
          }
        }
      }
      for (const m of v.messages || []) {
        const name = ((v.contacts || []).find((c: any) => c.wa_id === m.from) || (v.contacts || [])[0] || {}).profile?.name;
        // an answer to "How was your visit?", STOP / START, or what they wrote after answering
        const handled = await customerAnswer(m, name);
        if (handled === 'quiet') continue;
        const text = `WhatsApp message from ${name ? name + ' ' : ''}(${phone10(m.from)}):\n${messageText(m) || ''}\n\nReply in the WhatsApp Business app: https://wa.me/${String(m.from).replace(/\D/g, '')}`;
        forwarded += await telegramOwners(text);
      }
    }
  }
  return json({ ok: true, updated, forwarded });
}

// ---- the automatic messages ----
const TPL = {
  feedback: () => env('WHATSAPP_TEMPLATE_FEEDBACK') || 'visit_feedback',
  reminder: () => env('WHATSAPP_TEMPLATE_REMINDER') || 'booking_reminder',
  winback: () => env('WHATSAPP_TEMPLATE_WINBACK') || 'we_miss_you',
};
const firstName = (n: string) => clean(String(n || '').trim().split(/\s+/)[0]) || 'there';
const dayKey = (d: Date) => d.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
// "today at 5:30 PM", "tomorrow at 11:00 AM", "Sat 14 Nov at 5:30 PM"
export function slotText(slot: string, now = new Date()) {
  const d = new Date(slot);
  const time = d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }).toUpperCase();
  const k = dayKey(d);
  const day = k === dayKey(now) ? 'today' : k === dayKey(new Date(now.getTime() + 86400000)) ? 'tomorrow'
    : d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).replace(',', '');
  return `${day} at ${time}`;
}
// The values each template takes
export function autoValues(d: any, settings: Record<string, any>, now = new Date()) {
  if (d.kind === 'feedback') return [firstName(d.name)];
  if (d.kind === 'reminder') return [firstName(d.name), slotText(d.slot_at, now), clean(d.services || 'your appointment')];
  const pts = Number(d.points) || 0;
  const line = clean(String(settings.wa_winback_text || 'We would love to see you again.'));
  return [firstName(d.name), clean(`${line}${/[.!?]$/.test(line) ? '' : '.'}${pts >= 100 ? ` You have ${pts} loyalty points = ₹${inr(pts)} off.` : ''}`)];
}
// Errors that are about our set-up, not about one customer: stop and try again later, don't mark every customer failed
const SETUP_ERRORS = new Set([132001, 132000, 132012, 132018, 190, 10, 200, 131056, 4, 80007, 130429, 131031, 368, 131042, 133010]);
async function settingsMap() {
  const r = await rest('settings?select=key,value');
  const rows = r.ok ? await r.json() : [];
  return Object.fromEntries((Array.isArray(rows) ? rows : []).map((x: any) => [x.key, x.value]));
}
async function sendTemplate(to: string, name: string, values: string[]) {
  const msg = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp', recipient_type: 'individual', to: '91' + to, type: 'template',
      template: { name, language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'en' }, components: [{ type: 'body', parameters: values.map((text) => ({ type: 'text', text })) }] },
    }),
  });
  const mj = await msg.json().catch(() => ({}));
  const wamid = mj && mj.messages && mj.messages[0] && mj.messages[0].id;
  return msg.ok && wamid ? { wamid } : { error: mj.error || { message: 'no message id' } };
}
async function sendText(toFull: string, body: string) {
  if (!configured()) return false;
  const r = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}/messages`), {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: toFull, type: 'text', text: { preview_url: false, body } }),
  });
  return r.ok;
}
async function auto(req: Request) {
  const cron = !!env('CRON_SECRET') && req.headers.get('x-cron-secret') === env('CRON_SECRET');
  if (!cron && !(await signedIn(req))) return json({ error: 'Not signed in' }, 401);
  if (!configured()) return json({ ok: false, error: 'WhatsApp is not set up yet (README, WhatsApp bills).' });
  const dr = await rest('rpc/wa_due', { method: 'POST', body: '{}' });
  if (!dr.ok) return json({ ok: false, error: 'The database is not ready for automatic messages: run supabase/01_schema.sql again.' });
  const due = await dr.json();
  const settings = await settingsMap();
  const sent: Record<string, number> = { feedback: 0, reminder: 0, winback: 0 };
  const errors: Record<string, string> = {};
  let failed = 0;
  for (const d of Array.isArray(due) ? due : []) {
    if (errors[d.kind] || !TPL[d.kind as keyof typeof TPL]) continue;     // this kind's template has a problem: later
    // the row first (one per bill / booking / lapse): if another run got there, skip
    const ins = await rest('wa_messages?on_conflict=dedupe', {
      method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify({ kind: d.kind, dedupe: d.dedupe, phone: d.phone, bill_id: d.bill_id || null, booking_id: d.booking_id || null, customer_id: d.customer_id || null, status: 'sending', created_by: 'auto' }),
    });
    const row = ins.ok ? (await ins.json())[0] : null;
    if (!row) continue;
    let res: any;
    try { res = await sendTemplate(d.phone, TPL[d.kind as keyof typeof TPL](), autoValues(d, settings)); } catch (e) { res = { error: { message: (e as Error).message, code: 4 } }; }
    if (res.wamid) {
      await rest(`wa_messages?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'sent', wamid: res.wamid, updated_at: new Date().toISOString() }) });
      if (d.kind === 'reminder') await rest(`bookings?id=eq.${d.booking_id}`, { method: 'PATCH', body: JSON.stringify({ reminded_at: new Date().toISOString() }) });
      sent[d.kind]++;
    } else if (SETUP_ERRORS.has(Number(res.error && res.error.code))) {
      await rest(`wa_messages?id=eq.${row.id}`, { method: 'DELETE' });
      errors[d.kind] = errorText(res.error).replace('The bill template', 'The template').replace(/"[^"]*"/, `"${TPL[d.kind as keyof typeof TPL]()}"`).replace(': a picture and 4 values (see README)', ' (see README)');
    } else {
      await rest(`wa_messages?id=eq.${row.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'failed', error: errorText(res.error), updated_at: new Date().toISOString() }) });
      failed++;
    }
  }
  return json({ ok: true, sent, failed, errors });
}

// A customer's message: an answer to the feedback request (a button), STOP / START, or words after answering.
// Returns 'quiet' when the owners don't need it on Telegram.
const RATE: Record<string, string> = { 'loved it': 'good', 'it was okay': 'ok', 'not happy': 'bad' };
async function customerAnswer(m: any, name: string | undefined) {
  const phone = String(m.from || '').replace(/\D/g, '').slice(-10);
  const said = String(messageText(m) || '').trim();
  const low = said.toLowerCase();
  if (m.type === 'text' && /^(stop|unsubscribe)\.?$/.test(low)) {
    await rest(`customers?phone=eq.${phone}`, { method: 'PATCH', body: JSON.stringify({ wa_stop: true, whatsapp_ok: false }) });
    await sendText(m.from, 'Done. You will not get reminders or offers from us on WhatsApp. Your bills still come here. Reply START to get them again.');
    return 'quiet';
  }
  if (m.type === 'text' && /^start\.?$/.test(low)) {
    await rest(`customers?phone=eq.${phone}`, { method: 'PATCH', body: JSON.stringify({ wa_stop: false }) });
    await sendText(m.from, 'Thank you. You will get our reminders again.');
    return 'quiet';
  }
  const rating = (m.type === 'button' || m.type === 'interactive') ? RATE[low] : undefined;
  const ctx = m.context && m.context.id;
  if (rating && ctx) {
    const w = (await (await rest(`wa_messages?wamid=eq.${encodeURIComponent(ctx)}&kind=eq.feedback&select=id,bill_id,customer_id,phone`)).json())[0];
    if (!w || !w.bill_id) return '';
    const b = (await (await rest(`bills?id=eq.${w.bill_id}&select=bill_no,customer_name,total,created_at,bill_items(name,staff_name,item_type)`)).json())[0] || {};
    const ins = await rest('feedback?on_conflict=bill_id', {
      method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
      body: JSON.stringify({ bill_id: w.bill_id, customer_id: w.customer_id, phone: w.phone, name: b.customer_name || name || null, rating }),
    });
    const fresh = ins.ok ? (await ins.json())[0] : null;
    if (!fresh) return 'quiet';                                   // answered already: tapping again changes nothing
    const settings = await settingsMap();
    const link = String(settings.google_review_url || '').trim();
    const first = firstName(b.customer_name || name || '');
    const all = settings.wa_review_all !== false && settings.wa_review_all !== 'false';
    const ask = link ? ` It would mean a lot if you shared it on Google: ${link}` : '';
    if (rating === 'good') await sendText(m.from, `Thank you, ${first}! We are so glad.${ask}`);
    else if (rating === 'ok') await sendText(m.from, `Thank you for telling us, ${first}. What could we do better? Just reply here.${link && all ? ` You can also review us on Google: ${link}` : ''}`);
    else {
      await sendText(m.from, `We are sorry, ${first}. Please tell us here what went wrong, and we will call you to put it right.${link && all ? ` You can also review us on Google: ${link}` : ''}`);
      const svc = (b.bill_items || []).filter((i: any) => i.item_type === 'service').map((i: any) => `${i.name}${i.staff_name ? ` (${i.staff_name})` : ''}`).join(', ');
      await telegramOwners(`Unhappy customer: ${b.customer_name || name || 'No name'} (${phone10(phone)})\nBill ${b.bill_no || ''}, ₹${inr(b.total)}${svc ? `\n${svc}` : ''}\n\nThey tapped "Not happy" on WhatsApp. Call them today: https://wa.me/${String(m.from).replace(/\D/g, '')}\nThen mark it in the app: Customers → Feedback.`);
    }
    return 'quiet';
  }
  // words within a day of answering: kept as their comment (and still passed on to the owners)
  if (m.type === 'text' && said) {
    const since = new Date(Date.now() - 86400000).toISOString();
    const f = (await (await rest(`feedback?phone=eq.${phone}&comment=is.null&created_at=gte.${encodeURIComponent(since)}&select=id&order=created_at.desc&limit=1`)).json())[0];
    if (f) await rest(`feedback?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ comment: said.slice(0, 1000) }) });
  }
  return '';
}

export async function handler(req: Request) {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method === 'GET') {
    // Meta checks the webhook once, when it is connected
    const u = new URL(req.url);
    const ok = u.searchParams.get('hub.mode') === 'subscribe' && !!env('WHATSAPP_VERIFY_TOKEN') && u.searchParams.get('hub.verify_token') === env('WHATSAPP_VERIFY_TOKEN');
    return ok ? new Response(u.searchParams.get('hub.challenge') || '', { status: 200 }) : new Response('Forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (req.headers.get('X-Hub-Signature-256') !== null) return fromMeta(req);
  let body: any = {};
  try { body = await req.json(); } catch { return json({ error: 'Bad request' }, 400); }
  if (body.action === 'bill') return sendBill(req, body);
  if (body.action === 'slip') return sendSlip(req, body);
  if (body.action === 'status') return status(req);
  if (body.action === 'auto') return auto(req);
  return json({ error: 'Bad request' }, 400);
}

Deno.serve(handler);
