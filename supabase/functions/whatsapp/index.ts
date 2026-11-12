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
//   { action: 'booking_confirm', id }     a WhatsApp booking confirmed at the counter: the confirmation to the customer
//                                         (free text, inside the 24 hours after their last message)
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
//   Body:   Hi {{1}}, here is your bill {{2}} from Habibs Hair & Beauty Fuljhore for ₹{{3}}. The bill is in the
//           picture above. {{4}} Reply to this message if anything on the bill is not right.
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
  // plain account facts only: promotional words ("off your next visit") make Meta treat the template as Marketing
  let pts = 'Please keep it for your records.';
  if (!b.for_staff) {
    if (earned > 0) pts = `Loyalty points: ${earned} added${bal != null ? `, balance ${bal}` : ''}.`;
    else if (used > 0) pts = `Loyalty points: ${inr(used)} used on this bill${bal != null ? `, balance ${bal}` : ''}.`;
    else if (bal) pts = `Loyalty points balance: ${bal}.`;
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
  let settings: Record<string, any> | null = null;
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
        // the booking bot (when on) answers it; a comment after "How was your visit?" goes straight to the owners
        if (handled !== 'comment') {
          settings = settings || await settingsMap().catch(() => ({}));
          if (await botTurn(m, name, settings).catch(() => false)) continue;
        }
        const text = `WhatsApp message from ${name ? name + ' ' : ''}(${phone10(m.from)}):\n${messageText(m) || ''}\n\nCall them, or WhatsApp them from your phone: https://wa.me/${String(m.from).replace(/\D/g, '')}`;
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
    if (f) {
      await rest(`feedback?id=eq.${f.id}`, { method: 'PATCH', body: JSON.stringify({ comment: said.slice(0, 1000) }) });
      return 'comment';
    }
  }
  return '';
}

// ---- the booking bot (Settings → WhatsApp → Booking bot) ----
// A customer writes to the salon's number: buttons Book an appointment · Prices & offers · Talk to us. Booking goes
// section → category → service (→ size) → more services or a day → a time → the name → Send request. The request
// lands in Appointments → Requests (wa_book); the counter confirms it from there and the confirmation comes back
// here ({ action: 'booking_confirm' }). Everything inside WhatsApp's 24-hour reply window, so it costs nothing.
// botReply() is the conversation alone (no database, no Meta): the tests drive it step by step.
const SECTIONS = ['Hair', 'Colour', 'Hair Spa', 'Hair Treatments', 'Facials', 'D-Tan', 'Threading', 'Waxing', 'Nails', 'Beauty', 'Makeup'];
const MAX_ITEMS = 5;
const STATE_HOURS = 3;     // an unfinished booking is forgotten after this
const HUMAN_HOURS = 12;    // after "Talk to us" the bot stays quiet this long (type MENU to bring it back)
const MENU_WORDS = /^(hi+|hii+|hello|hey|hlo|helo|menu|start over|restart|book|booking|appointment|namaste|namaskar)[\s.!]*$/i;
type Msg = { type: 'text'; body: string } | { type: 'buttons'; body: string; buttons: { id: string; title: string }[] }
  | { type: 'list'; body: string; button: string; title: string; rows: { id: string; title: string; description?: string }[] };
type BotIn = { kind: 'text'; text: string } | { kind: 'pick'; id: string } | { kind: 'other' };
export type BotCtx = { services: any[]; offers?: any[]; settings: Record<string, any>; now: Date; customerName?: string | null; profileName?: string | null };
export type BotOut = { state: any; out: Msg[]; action?: { type: 'book'; booking: any } | { type: 'enquiry'; message: string; talk?: boolean } };

const cut = (s: string, n: number) => { const t = String(s || '').trim(); return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…'; };
const salonOf = (st: Record<string, any>) => `${st.salon_name || 'Habibs Hair & Beauty'}${st.branch ? ' ' + String(st.branch).split(',')[0] : ''}`;
const svcName = (s: any) => String(s.web_name || s.name || '');
function priceOf(s: any, option?: string | null) {
  const vs = Array.isArray(s.variants) ? s.variants : null;
  if (vs && option) { const v = vs.find((x: any) => x.label === option); if (v) return { price: Number(v.price), from: false }; }
  if (vs && vs.length) return { price: Math.min(...vs.map((x: any) => Number(x.price) || 0)), from: true };
  return { price: Number(s.price) || 0, from: !!s.open_price };
}
const priceText = (p: { price: number; from: boolean }) => (p.price > 0 ? `${p.from ? 'from ' : ''}₹${inr(p.price)}` : 'price at the salon');
const istParts = (d: Date) => { const x = new Date(d.getTime() + 5.5 * 3600e3); return { day: x.toISOString().slice(0, 10), min: x.getUTCHours() * 60 + x.getUTCMinutes() }; };
const addDay = (day: string, n: number) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400e3).toISOString().slice(0, 10);
const shortDay = (day: string) => new Date(day + 'T12:00:00+05:30').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).replace(',', '');
const dayLabel = (day: string, today: string) => day === today ? 'Today' : day === addDay(today, 1) ? 'Tomorrow' : shortDay(day);
const timeLabel = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
// "10:00 AM – 9:00 PM, all 7 days" → [600, 1260] (minutes); 10 am to 9 pm when it can't be read
export function openHours(text: string): [number, number] {
  const t = [...String(text || '').matchAll(/(\d{1,2})(?:[:.](\d{2}))?\s*([ap])\.?m/gi)].map((m) => ((Number(m[1]) % 12) + (m[3].toLowerCase() === 'p' ? 12 : 0)) * 60 + Number(m[2] || 0));
  return t.length >= 2 && t[1] > t[0] ? [t[0], t[1]] : [600, 1260];
}
// Start times on a day: on the hour, from opening to an hour before closing; today only from an hour from now
export function slotsFor(day: string, ctx: BotCtx) {
  const [open, close] = openHours(ctx.settings.opening_hours);
  const now = istParts(ctx.now);
  const out: string[] = [];
  for (let m = Math.ceil(open / 60) * 60; m <= close - 60; m += 60) {
    if (day === now.day && m < now.min + 60) continue;
    out.push(`${String(m / 60).padStart(2, '0')}:00`);
  }
  return out;
}
function sectionsOf(services: any[]) {
  const have = [...new Set(services.map((s) => s.section))];
  return have.sort((a, b) => ((SECTIONS.indexOf(a) + 1 || 99) - (SECTIONS.indexOf(b) + 1 || 99)) || String(a).localeCompare(String(b)));
}
function categoriesOf(services: any[], section: string) {
  const m = new Map<string, number>();
  for (const s of services) if (s.section === section) m.set(s.category, Math.min(m.get(s.category) ?? 1e9, Number(s.sort) || 0));
  return [...m.entries()].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([c]) => c);
}
// 10 rows at most in a WhatsApp list: 9 and "More…"
function page(rows: { id: string; title: string; description?: string }[], n: number, moreId: string) {
  if (rows.length <= 10) return rows;
  const part = rows.slice(n * 9, n * 9 + 9);
  return n * 9 + 9 < rows.length ? [...part, { id: `${moreId}:${n + 1}`, title: 'More…', description: 'See the rest' }] : part;
}
const mainMenu = (body: string): Msg => ({ type: 'buttons', body, buttons: [{ id: 'm:book', title: 'Book appointment' }, { id: 'm:prices', title: 'Prices & offers' }, { id: 'm:talk', title: 'Talk to us' }] });
const tapAbove = (): Msg => ({ type: 'text', body: 'Please tap one of the options above, or type MENU to start again.' });
const itemLine = (it: any) => `• ${it.name}${it.option ? ` (${it.option})` : ''}: ${priceText({ price: Number(it.price) || 0, from: !!it.from })}`;

function sectionMsg(ctx: BotCtx, n = 0): Msg {
  const rows = sectionsOf(ctx.services).map((s, i) => ({ id: `sec:${i}`, title: cut(s, 24) }));
  return { type: 'list', body: 'What would you like to book?', button: 'Choose', title: 'Services', rows: page(rows, n, 'more:sec') };
}
function categoryMsg(ctx: BotCtx, section: string, n = 0): Msg {
  const rows = categoriesOf(ctx.services, section).map((c, i) => ({ id: `cat:${i}`, title: cut(c, 24), description: c.length > 24 ? cut(c, 72) : undefined }));
  return { type: 'list', body: `${section}: which one?`, button: 'Choose', title: cut(section, 24), rows: page(rows, n, 'more:cat') };
}
function serviceMsg(ctx: BotCtx, category: string, n = 0): Msg {
  const rows = ctx.services.filter((s) => s.category === category)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || svcName(a).localeCompare(svcName(b)))
    .map((s) => { const nm = svcName(s); return { id: `svc:${s.id}`, title: cut(nm, 24), description: cut(`${nm.length > 24 ? nm + ' · ' : ''}${priceText(priceOf(s))}`, 72) }; });
  return { type: 'list', body: `${category}: choose a service. Prices are from the salon's menu.`, button: 'Choose', title: cut(category, 24), rows: page(rows, n, 'more:svc') };
}
function dayMsg(ctx: BotCtx): Msg {
  const today = istParts(ctx.now).day;
  const rows = [];
  for (let i = 0; rows.length < 8 && i < 14; i++) {
    const d = addDay(today, i);
    if (!slotsFor(d, ctx).length) continue;
    rows.push({ id: `day:${d}`, title: dayLabel(d, today), description: new Date(d + 'T12:00:00+05:30').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' }) });
  }
  return { type: 'list', body: 'Which day would you like to come?', button: 'Choose a day', title: 'Days', rows };
}
function timeMsg(ctx: BotCtx, day: string, n = 0): Msg {
  const rows = slotsFor(day, ctx).map((t) => ({ id: `time:${t}`, title: timeLabel(t) }));
  return { type: 'list', body: `${dayLabel(day, istParts(ctx.now).day)}: what time suits you?`, button: 'Choose a time', title: 'Times', rows: page(rows, n, 'more:time') };
}
function afterAdd(st: any): Msg {
  const lines = st.items.map(itemLine).join('\n');
  const buttons = [{ id: 'b:day', title: 'Choose day & time' }];
  if (st.items.length < MAX_ITEMS) buttons.push({ id: 'b:add', title: 'Add another service' });
  buttons.push({ id: 'b:restart', title: 'Start over' });
  return { type: 'buttons', body: `Added.\n${lines}\n\nAnything else, or choose the day?`, buttons };
}
function confirmMsg(st: any, ctx: BotCtx): Msg {
  const lines = st.items.map(itemLine).join('\n');
  return { type: 'buttons', body: `Your booking request:\n${lines}\n\n📅 ${dayLabel(st.date, istParts(ctx.now).day)}, ${timeLabel(st.time)}\n👤 ${st.name}\n\nTap Send request and the salon will confirm it here.`,
    buttons: [{ id: 'b:send', title: 'Send request' }, { id: 'b:restart', title: 'Start over' }] };
}
export function bookedText(ref: string, st: any, ctx: BotCtx) {
  const s = ctx.settings;
  return `Request sent ✅ (ref ${ref})\n${st.items.map(itemLine).join('\n')}\n📅 ${dayLabel(st.date, istParts(ctx.now).day)}, ${timeLabel(st.time)}\n\nThe salon will confirm the time here soon.${s.phone ? ` Questions? Call ${s.phone}.` : ''}`;
}
export function pricesText(ctx: BotCtx) {
  const today = istParts(ctx.now).day;
  const dow = ((new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7) + 1; // 1 Monday … 7 Sunday
  const offers = (ctx.offers || []).filter((o) => o.active !== false && o.show_on_website !== false
    && (!o.starts_on || o.starts_on <= today) && (!o.ends_on || o.ends_on >= today) && (!Array.isArray(o.days) || !o.days.length || o.days.includes(dow)));
  const parts: string[] = [];
  if (offers.length) parts.push('*Offers now*\n' + offers.slice(0, 8).map((o) => `🎁 ${o.name}${o.note ? ` – ${cut(o.note, 80)}` : ''}${o.ends_on ? ` (till ${shortDay(o.ends_on)})` : ''}`).join('\n'));
  for (const sec of sectionsOf(ctx.services)) {
    const rows = categoriesOf(ctx.services, sec).map((c) => {
      const min = Math.min(...ctx.services.filter((s) => s.section === sec && s.category === c).map((s) => priceOf(s).price).filter((p) => p > 0));
      return Number.isFinite(min) ? `${c}: from ₹${inr(min)}` : c;
    });
    parts.push(`*${sec}*\n${rows.join('\n')}`);
  }
  return cut(`${parts.join('\n\n')}\n\nTap Book appointment to choose a service and see its exact price.`, 4000);
}

export function botReply(prev: any, input: BotIn, ctx: BotCtx): BotOut {
  const fresh = !prev || !prev.step || !prev.at || ctx.now.getTime() - Date.parse(prev.at) > STATE_HOURS * 3600e3;
  const st: any = fresh ? { step: 'menu', items: [] } : { ...prev, items: [...(prev.items || [])] };
  const at = ctx.now.toISOString();
  const done = (out: Msg[], extra: Partial<BotOut> = {}): BotOut => ({ state: { ...st, at }, out, ...extra });
  const hello = () => {
    const first = String(ctx.customerName || ctx.profileName || '').trim().split(/\s+/)[0];
    return mainMenu(`${first ? `Hi ${cut(first, 30)}! ` : 'Hi! '}Welcome to ${salonOf(ctx.settings)} 💇\nHow can we help you?`);
  };
  const startBooking = () => { st.step = 'section'; st.items = []; st.date = st.time = undefined;
    const secs = sectionsOf(ctx.services);
    if (!secs.length) { st.step = 'menu'; return done([{ type: 'text', body: `Online booking isn't open just now. Please call us${ctx.settings.phone ? ` on ${ctx.settings.phone}` : ''}.` }]); }
    if (secs.length === 1) return pickSection(secs[0]);
    return done([sectionMsg(ctx)]); };
  const pickSection = (sec: string) => { st.section = sec; st.step = 'category';
    const cats = categoriesOf(ctx.services, sec);
    return cats.length === 1 ? pickCategory(cats[0]) : done([categoryMsg(ctx, sec)]); };
  const pickCategory = (cat: string) => { st.category = cat; st.step = 'service'; return done([serviceMsg(ctx, cat)]); };
  const askDay = () => { st.step = 'day'; return done([dayMsg(ctx)]); };
  const askName = () => {
    if (ctx.customerName && String(ctx.customerName).trim().length >= 2) { st.name = cut(String(ctx.customerName).trim(), 60); st.step = 'confirm'; return done([confirmMsg(st, ctx)]); }
    st.step = 'name';
    const pn = String(ctx.profileName || '').trim();
    if (pn.length >= 2 && pn.length <= 20) return done([{ type: 'buttons', body: `Is the booking for ${pn}?`, buttons: [{ id: 'b:name', title: cut(pn, 20) }, { id: 'b:othername', title: 'Another name' }] }]);
    return done([{ type: 'text', body: 'Please type the name for the booking.' }]);
  };

  if (input.kind === 'text') {
    const text = input.text.trim();
    if (st.step === 'name' && !MENU_WORDS.test(text)) {
      if (!/^[\p{L}][\p{L} .'-]{1,59}$/u.test(text)) return done([{ type: 'text', body: 'Please type just the name (letters only).' }]);
      st.name = text.replace(/\s+/g, ' '); st.step = 'confirm';
      return done([confirmMsg(st, ctx)]);
    }
    if (fresh || st.step === 'menu' || MENU_WORDS.test(text)) { st.step = 'menu'; st.items = []; return done([hello()]); }
    return done([tapAbove()]);
  }
  if (input.kind === 'other') {
    if (fresh || st.step === 'menu') { st.step = 'menu'; return done([hello()]); }
    return done([tapAbove()]);
  }

  const [kind, val, more] = input.id.split(':');
  if (input.id === 'm:book' || input.id === 'b:restart') return startBooking();
  if (input.id === 'm:prices') { st.step = 'menu';
    return done([{ type: 'text', body: pricesText(ctx) }, { type: 'buttons', body: 'Would you like to book?', buttons: [{ id: 'm:book', title: 'Book appointment' }, { id: 'm:talk', title: 'Talk to us' }] }],
      { action: { type: 'enquiry', message: 'Asked for prices & offers on WhatsApp' } }); }
  if (input.id === 'm:talk') { st.step = 'menu'; st.items = [];
    const [o, c] = openHours(ctx.settings.opening_hours);
    return done([{ type: 'text', body: `Sure! Type your question here, and someone from the salon will call you back on this number (we are open ${timeLabel(`${String(Math.floor(o / 60)).padStart(2, '0')}:${String(o % 60).padStart(2, '0')}`)} – ${timeLabel(`${String(Math.floor(c / 60)).padStart(2, '0')}:${String(c % 60).padStart(2, '0')}`)}).${ctx.settings.phone ? ` Or call us: ${ctx.settings.phone}` : ''}\n\nType MENU any time to book.` }],
      { action: { type: 'enquiry', message: 'Asked to talk to the salon on WhatsApp', talk: true } }); }
  if (fresh) { st.step = 'menu'; return done([hello()]); }   // a tap on an old message: start again
  if (kind === 'more') {
    const n = Number(more) || 0;
    if (val === 'sec') return done([sectionMsg(ctx, n)]);
    if (val === 'cat' && st.section) return done([categoryMsg(ctx, st.section, n)]);
    if (val === 'svc' && st.category) return done([serviceMsg(ctx, st.category, n)]);
    if (val === 'time' && st.date) return done([timeMsg(ctx, st.date, n)]);
    return done([tapAbove()]);
  }
  if (kind === 'sec') { const s = sectionsOf(ctx.services)[Number(val)]; return s ? pickSection(s) : startBooking(); }
  if (kind === 'cat' && st.section) { const c = categoriesOf(ctx.services, st.section)[Number(val)]; return c ? pickCategory(c) : done([categoryMsg(ctx, st.section)]); }
  if (kind === 'svc') {
    const s = ctx.services.find((x) => x.id === val);
    if (!s) return done([{ type: 'text', body: "That service can't be booked here any more. Please choose another." }, sectionMsg(ctx)]);
    const vs = Array.isArray(s.variants) ? s.variants : [];
    if (vs.length > 1) {
      st.pending = s.id; st.step = 'option';
      return done([{ type: 'list', body: `${svcName(s)}: which one? (for hair, the length)`, button: 'Choose', title: cut(svcName(s), 24),
        rows: vs.slice(0, 9).map((v: any, i: number) => ({ id: `opt:${i}`, title: cut(String(v.label), 24), description: `₹${inr(Number(v.price))}` }))
          .concat([{ id: 'opt:x', title: 'Not sure', description: 'The salon will check at your visit' }]) }]);
    }
    return add(s, vs.length === 1 ? vs[0].label : null);
  }
  if (kind === 'opt' && st.pending) {
    const s = ctx.services.find((x) => x.id === st.pending);
    if (!s) return startBooking();
    const v = val === 'x' ? null : (s.variants || [])[Number(val)];
    return add(s, v ? v.label : null);
  }
  if (input.id === 'b:add') { if (st.items.length >= MAX_ITEMS) return askDay(); st.step = 'section'; return done([sectionMsg(ctx)]); }
  if (input.id === 'b:day') return st.items.length ? askDay() : startBooking();
  if (kind === 'day' && st.items.length) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(val) || !slotsFor(val, ctx).length) return done([{ type: 'text', body: 'That day is full or gone. Please choose another.' }, dayMsg(ctx)]);
    st.date = val; st.time = undefined; st.step = 'time';
    return done([timeMsg(ctx, val)]);
  }
  if (kind === 'time' && st.date) {
    const t = `${val}:${more}`;
    if (!slotsFor(st.date, ctx).includes(t)) return done([{ type: 'text', body: 'That time has passed. Please choose another.' }, timeMsg(ctx, st.date)]);
    st.time = t;
    return st.name ? (st.step = 'confirm', done([confirmMsg(st, ctx)])) : askName();
  }
  if (input.id === 'b:name' && st.step === 'name' && ctx.profileName) { st.name = cut(String(ctx.profileName).trim(), 60); st.step = 'confirm'; return done([confirmMsg(st, ctx)]); }
  if (input.id === 'b:othername' && st.step === 'name') return done([{ type: 'text', body: 'Please type the name for the booking.' }]);
  if (input.id === 'b:send' && st.step === 'confirm' && st.items.length && st.date && st.time && st.name) {
    if (!slotsFor(st.date, ctx).includes(st.time)) { st.step = 'time'; return done([{ type: 'text', body: 'That time has just passed. Please choose another.' }, timeMsg(ctx, st.date)]); }
    const booking = { date: st.date, time: st.time, name: st.name, items: st.items.map((it: any) => ({ service_id: it.service_id, option: it.option || null })) };
    return { state: { step: 'menu', items: [], name: st.name, at }, out: [], action: { type: 'book', booking: { ...booking, summary: { items: st.items, date: st.date, time: st.time, name: st.name } } } };
  }
  return done([tapAbove()]);

  function add(s: any, option: string | null) {
    st.pending = undefined;
    if (st.items.length >= MAX_ITEMS) return askDay();
    const p = priceOf(s, option);
    st.items.push({ service_id: s.id, name: svcName(s), option, price: p.price, from: p.from });
    st.step = 'added';
    return done([afterAdd(st)]);
  }
}

// One message as WhatsApp's API wants it
export function waPayload(to: string, m: Msg) {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to };
  if (m.type === 'text') return { ...base, type: 'text', text: { preview_url: false, body: m.body } };
  if (m.type === 'buttons') return { ...base, type: 'interactive', interactive: { type: 'button', body: { text: cut(m.body, 1024) },
    action: { buttons: m.buttons.slice(0, 3).map((b) => ({ type: 'reply', reply: { id: b.id, title: cut(b.title, 20) } })) } } };
  return { ...base, type: 'interactive', interactive: { type: 'list', body: { text: cut(m.body, 1024) },
    action: { button: cut(m.button, 20), sections: [{ title: cut(m.title, 24), rows: m.rows.slice(0, 10).map((r) => ({ id: r.id, title: cut(r.title, 24), ...(r.description ? { description: cut(r.description, 72) } : {}) })) }] } } };
}
async function sendMsg(to: string, m: Msg) {
  const r = await fetch(graph(`${env('WHATSAPP_PHONE_ID')}/messages`), {
    method: 'POST', headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(waPayload(to, m)),
  });
  return r.ok;
}
const botOn = (st: Record<string, any>) => st.wa_bot_on === true || st.wa_bot_on === 'true';
const rows = async (r: Response) => { if (!r.ok) return []; const j = await r.json().catch(() => []); return Array.isArray(j) ? j : []; };
function botInput(m: any): BotIn {
  if (m.type === 'text') return { kind: 'text', text: String((m.text && m.text.body) || '') };
  if (m.type === 'interactive') { const r = (m.interactive && (m.interactive.button_reply || m.interactive.list_reply)) || {}; return r.id ? { kind: 'pick', id: String(r.id) } : { kind: 'other' }; }
  return { kind: 'other' };
}
// A customer's message with the bot on. Returns true when it was dealt with here (no plain forward to Telegram).
async function botTurn(m: any, name: string | undefined, settings: Record<string, any>) {
  const phone = String(m.from || '').replace(/\D/g, '').slice(-10);
  if (!/^[6-9]\d{9}$/.test(phone)) return false;
  const now = new Date();
  const chat = (await rows(await rest(`wa_chats?phone=eq.${phone}&select=*`)))[0] || null;
  const save = (patch: any) => rest('wa_chats?on_conflict=phone', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ phone, name: name || (chat && chat.name) || null, last_in_at: now.toISOString(), updated_at: now.toISOString(), ...patch }) }).catch(() => null);
  if (!botOn(settings)) { await save({}); return false; }
  const input = botInput(m);
  const said = input.kind === 'text' ? input.text.trim() : '';
  const media = input.kind === 'other';
  // after "Talk to us", or a reply to one of our messages (a bill), or a photo: a person deals with it
  const human = chat && chat.human_until && Date.parse(chat.human_until) > now.getTime() && !MENU_WORDS.test(said);
  const replyToUs = m.context && m.context.id && input.kind === 'text' && !MENU_WORDS.test(said);
  if (human || replyToUs || (media && m.type !== 'interactive')) {
    await save({});
    const words = messageText(m) || '';
    await rpc('wa_enquiry', { phone, name, message: words }).catch(() => null);
    await telegramOwners(`WhatsApp message from ${name ? name + ' ' : ''}(${phone10(phone)}):\n${words}\n\nCall them, or WhatsApp them from your phone: https://wa.me/91${phone}\nIt is under Appointments → Enquiries.`);
    return true;
  }
  const customer = (await rows(await rest(`customers?phone=eq.${phone}&select=name`)))[0];
  const services = await rows(await rest('services?select=id,section,category,name,web_name,price,variants,open_price,sort&active=is.true&show_on_website=is.true&book_online=is.true&order=sort.asc'));
  const offers = input.kind === 'pick' && input.id === 'm:prices' ? await rows(await rest('offers?select=name,note,active,starts_on,ends_on,days,show_on_website&active=is.true')) : [];
  const ctx: BotCtx = { services, offers, settings, now, customerName: customer && customer.name, profileName: name || null };
  const r = botReply(chat && chat.state, input, ctx);
  const to = '91' + phone;
  for (const msg of r.out) await sendMsg(to, msg);
  let human_until: string | null = null;
  if (r.action && r.action.type === 'enquiry') {
    const e = await rpc('wa_enquiry', { phone, name: (customer && customer.name) || name, message: r.action.message }).catch(() => null);
    if (r.action.talk) {
      human_until = new Date(now.getTime() + HUMAN_HOURS * 3600e3).toISOString();
      await telegramOwners(`${(customer && customer.name) || name || 'A customer'} (${phone10(phone)}) wants to talk to the salon on WhatsApp.\nCall them, or WhatsApp them from your phone: https://wa.me/91${phone}${e && e.ref ? `\nEnquiry ${e.ref} in Appointments → Enquiries.` : ''}`);
    }
  }
  if (r.action && r.action.type === 'book') {
    const b = r.action.booking;
    const res = await rpc('wa_book', { phone, name: b.name, date: b.date, time: b.time, items: b.items }).catch((e) => ({ error: String(e && e.message || e) }));
    if (res && res.ref) {
      await sendMsg(to, { type: 'text', body: bookedText(res.ref, b.summary, ctx) });
      const n = await telegramOwners(`New WhatsApp booking request ${res.ref}\n${b.name} (${phone10(phone)})\n${dayLabel(b.date, istParts(now).day)}, ${timeLabel(b.time)}\n${b.summary.items.map(itemLine).join('\n')}\n\nConfirm it in the app: Appointments → Requests.`);
      if (n) await rest(`bookings?id=eq.${res.id}`, { method: 'PATCH', body: JSON.stringify({ notified_at: now.toISOString() }) }).catch(() => null);
    } else {
      const busy = /Too many/.test(String(res && res.error));
      await sendMsg(to, { type: 'text', body: busy ? `We already have your booking requests for today. The salon will confirm them soon${settings.phone ? `, or call ${settings.phone}` : ''}.`
        : `Sorry, the booking didn't go through. Please try again (type MENU)${settings.phone ? ` or call ${settings.phone}` : ''}.` });
    }
  }
  await save({ state: r.state, ...(human_until ? { human_until } : MENU_WORDS.test(said) ? { human_until: null } : {}) });
  return true;
}
async function rpc(fn: string, p: any) {
  const r = await rest(`rpc/${fn}`, { method: 'POST', body: JSON.stringify({ p }) });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error((j && (j.message || j.error)) || `rpc ${fn} failed`);
  return j;
}

// ---- the app: a WhatsApp booking confirmed at the counter → the confirmation to the customer ----
// Free text only inside WhatsApp's 24 hours after the customer's last message; after that the app's own
// "Send confirmation" button (WhatsApp on the device) is used instead.
export function confirmText(b: any, items: any[], settings: Record<string, any>, now = new Date()) {
  const first = String(b.name || '').trim().split(/\s+/)[0] || 'there';
  const svc = (items || []).map((i: any) => `• ${i.name}${i.option_label ? ` (${i.option_label})` : ''}`).join('\n');
  return `Confirmed ✅\nHi ${first}, your appointment at ${salonOf(settings)} is booked for ${slotText(b.slot_at, now)}.${svc ? `\n${svc}` : ''}\nRef ${b.ref}${settings.address ? `\n📍 ${settings.address}` : ''}${settings.maps_url ? `\n${settings.maps_url}` : ''}\n\nNeed to change it? ${settings.phone ? `Call us on ${settings.phone}.` : 'Type MENU and tap Talk to us.'}`;
}
async function bookingConfirm(req: Request, body: any) {
  const id = String(body.id || '');
  if (!isUuid(id)) return json({ error: 'Bad request' }, 400);
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not allowed' }, 401);
  // the booking as the signed-in user may see it (approved logins only)
  const r = await fetch(`${env('SUPABASE_URL')}/rest/v1/bookings?id=eq.${id}&select=*,booking_items(name,option_label)`, { headers: { apikey: env('SUPABASE_ANON_KEY'), Authorization: `Bearer ${token}` } });
  const b = (await rows(r))[0];
  if (!b) return json({ error: 'Not allowed' }, 401);
  if (!configured()) return json({ ok: false, error: 'WhatsApp is not set up yet.' });
  if (b.status !== 'confirmed' || !b.slot_at) return json({ ok: false, error: 'Confirm the booking with a time first.' });
  const chat = (await rows(await rest(`wa_chats?phone=eq.${b.phone}&select=last_in_at`)))[0];
  if (!chat || !chat.last_in_at || Date.now() - Date.parse(chat.last_in_at) > 23.5 * 3600e3) return json({ ok: false, window: true, error: 'More than 24 hours since the customer last wrote: send it with the WhatsApp button.' });
  const settings = await settingsMap();
  const ok = await sendMsg('91' + b.phone, { type: 'text', body: confirmText(b, b.booking_items || [], settings) });
  if (!ok) return json({ ok: false, error: "WhatsApp didn't take the message. Send it with the WhatsApp button." });
  await rest(`bookings?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify({ confirm_sent_at: new Date().toISOString() }) });
  return json({ ok: true });
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
  if (body.action === 'booking_confirm') return bookingConfirm(req, body);
  if (body.action === 'auto') return auto(req);
  return json({ error: 'Bad request' }, 400);
}

Deno.serve(handler);
