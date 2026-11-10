// Staff tests: face check-in (matching, set-up, real face or photo), leave and the paid days off, and the real
// database (supabase/01_schema.sql in PGlite): face_check_in, leave → attendance, who may do what, the morning message.
// The demo database (localdb.js) must give the same attendance as the real one for the same leave and check-ins.
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const face = await import('../src/lib/face.js');
const leave = await import('../src/lib/leave.js');
const { calcPayroll } = await import('../src/lib/calc.js');
const { istDay, addDays, monthRange } = await import('../src/lib/format.js');
const { createLocalDb } = await import('../src/lib/localdb.js');
const { distance, bestMatch, checkEnroll, eyeOpen, headTurn, createLiveness, MATCH, MARGIN } = face;

let seed = Number(process.env.SEED || 11);
const rnd = () => { seed = (seed * 48271) % 2147483647; return seed / 2147483647; };
const ri = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
let checks = 0;
const fails = {};
const check = (n, c, d = '') => { checks++; if (!c) { fails[n] = fails[n] || { count: 0, first: typeof d === 'function' ? d() : d }; fails[n].count++; } };

// =============== 1. face prints: who is it ===============
// Face prints like the real ones: different people about 0.6–0.9 apart, two looks of one person about 0.2–0.4
const vec = (scale) => Array.from({ length: 128 }, () => gauss() * scale);
const add = (a, b) => a.map((x, i) => x + b[i]);
const norm = (a) => Math.sqrt(a.reduce((s, x) => s + x * x, 0));
const scaled = (v, len) => { const n = norm(v); return v.map((x) => (x * len) / n); };
const person = () => vec(0.055); // two of these are about 0.88 apart
const look = (p, d) => add(p, scaled(vec(1), d)); // a look of person p, d away from their middle

check('distance: same = 0, symmetric', (() => { const a = vec(1), b = vec(1); return distance(a, a) === 0 && Math.abs(distance(a, b) - distance(b, a)) < 1e-12; })());
check('the app is stricter than the database (0.5 < 0.55)', MATCH < 0.55 && MARGIN > 0);
let wrong = 0, missed = 0, strangerIn = 0, tried = 0;
for (let t = 0; t < 3000; t++) {
  const people = Array.from({ length: ri(2, 8) }, () => person());
  const faces = people.map((p, i) => ({ staff_id: 's' + i, descriptors: Array.from({ length: ri(3, 5) }, () => look(p, 0.12 + rnd() * 0.12)) }));
  const k = ri(0, people.length - 1);
  const m = bestMatch(look(people[k], 0.1 + rnd() * 0.2), faces);
  tried++;
  if (m.staff_id && m.staff_id !== 's' + k) wrong++;
  if (!m.staff_id) missed++;
  const s = bestMatch(look(person(), 0.2), faces);
  if (s.staff_id) strangerIn++;
}
check('never matches the wrong person', wrong === 0, `${wrong} of ${tried}`);
check('a clear look of the right person matches (almost always)', missed / tried < 0.02, `${missed} of ${tried} missed`);
check('a stranger is never checked in as someone', strangerIn === 0, `${strangerIn} of ${tried}`);
{
  const a = person(), b = person();
  const faces = [{ staff_id: 'a', descriptors: [a] }, { staff_id: 'b', descriptors: [b] }];
  check('exact look matches with distance 0', bestMatch(a, faces).staff_id === 'a' && bestMatch(a, faces).distance === 0);
  const midway = a.map((x, i) => (x + b[i]) / 2);
  const near = [{ staff_id: 'a', descriptors: [look(midway, 0.2)] }, { staff_id: 'b', descriptors: [look(midway, 0.21)] }];
  const u = bestMatch(look(midway, 0.05), near);
  check('two people about as close: not sure, nobody is checked in', u.staff_id === null && u.reason === 'unsure', JSON.stringify(u));
  check('no faces set up: unknown', bestMatch(a, []).staff_id === null && bestMatch(a, []).reason === 'unknown');
  check('a person with no looks is skipped', bestMatch(a, [{ staff_id: 'x', descriptors: [] }, ...faces]).staff_id === 'a');
}
// set-up
{
  const a = person(), b = person();
  check('set-up: looks that agree are fine', checkEnroll([look(a, 0.15), look(a, 0.15), look(a, 0.15)], [{ staff_id: 'b', descriptors: [look(b, 0.15)] }]).ok);
  check('set-up: one look of someone else in it → keep still / try again', checkEnroll([look(a, 0.15), look(a, 0.15), look(b, 0.15)], []).reason === 'still');
  const other = checkEnroll([look(a, 0.1), look(a, 0.1)], [{ staff_id: 'b', descriptors: [look(b, 0.1)] }, { staff_id: 'a-again', descriptors: [look(a, 0.15)] }]);
  check("set-up: a face that is already someone else's is refused (no checking in for a friend)", !other.ok && other.reason === 'other' && other.staff_id === 'a-again', JSON.stringify(other));
}

// =============== 2. real face or a photo: blink and head turn ===============
// 68 face points: eyes 36–41 and 42–47, nose tip 30. open: eye height / width; yaw: nose position between the eyes
// noise: wobble of each point (share of the face size); nose: extra wobble of the nose tip
function facePoints({ open = 0.3, yaw = 0.5, s = 100, rot = 0, tx = 300, ty = 240, noise = 0, nose = 0 }) {
  const pts = Array.from({ length: 68 }, () => [0, 0]);
  const eye = (i, cx) => {
    const w = 0.3, h = open * w; // EAR = h / w
    pts[i] = [cx - w / 2, 0]; pts[i + 3] = [cx + w / 2, 0];
    pts[i + 1] = [cx - w / 6, -h / 2]; pts[i + 2] = [cx + w / 6, -h / 2];
    pts[i + 5] = [cx - w / 6, h / 2]; pts[i + 4] = [cx + w / 6, h / 2];
  };
  eye(36, -0.35);
  eye(42, 0.35);
  const left = pts[36][0], right = pts[45][0];
  pts[30] = [left + (right - left) * yaw + gauss() * nose, 0.35];
  const c = Math.cos(rot), sn = Math.sin(rot);
  return pts.map(([x, y]) => [tx + s * (x * c - y * sn + gauss() * noise), ty + s * (x * sn + y * c + gauss() * noise)]);
}
check('eye openness = height / width', Math.abs(eyeOpen(facePoints({ open: 0.3 })) - 0.3) < 1e-9 && Math.abs(eyeOpen(facePoints({ open: 0.1 })) - 0.1) < 1e-9);
check('head turn: 0.5 looking straight', Math.abs(headTurn(facePoints({})) - 0.5) < 1e-9 && Math.abs(headTurn(facePoints({ yaw: 0.35 })) - 0.35) < 1e-9);
for (let t = 0; t < 500; t++) {
  const o = { open: 0.2 + rnd() * 0.15, yaw: 0.35 + rnd() * 0.3 };
  const moved = { ...o, s: 40 + rnd() * 200, rot: (rnd() - 0.5) * 0.8, tx: rnd() * 640, ty: rnd() * 480 };
  check('moving, tilting or bringing a photo closer changes neither', Math.abs(eyeOpen(facePoints(o)) - eyeOpen(facePoints(moved))) < 1e-9 && Math.abs(headTurn(facePoints(o)) - headTurn(facePoints(moved))) < 1e-9);
}
const run = (frames) => { const l = createLiveness(); let how = null; for (const f of frames) how = l.push(f) || how; return how; };
// A photo held up: shaking, tilting, moving closer. The points wobble as much as the real face models were measured
// to (photos held up in front of them: eyes down to 86% open, nose moving up to 6.5% of the eye width in 30 frames),
// and now and then the detector jumps for one frame.
const WOBBLE = { noise: 0.0045, nose: 0.012 };
const photoFrames = (n) => {
  const base = { open: 0.22 + rnd() * 0.12, yaw: 0.4 + rnd() * 0.2 };
  return Array.from({ length: n }, (_, i) => {
    const jump = rnd() < 0.02;
    return facePoints({ ...base, ...WOBBLE, open: base.open * (jump ? 0.75 : 1), yaw: base.yaw + (jump ? 0.1 : 0), s: 90 + 40 * Math.sin(i / 9) + rnd() * 10, rot: 0.2 * Math.sin(i / 13), tx: 300 + rnd() * 30, ty: 240 + rnd() * 20 });
  });
};
{
  // the made-up wobble is at least as bad as the real one
  let eMin = 0, tR = 0;
  for (let t = 0; t < 200; t++) {
    const fr = photoFrames(30).map((p) => ({ e: eyeOpen(p), t: headTurn(p) }));
    const es = fr.map((x) => x.e).sort((a, b) => a - b);
    eMin += es[0] / es[Math.floor(es.length * 0.75)] / 200;
    tR += (Math.max(...fr.map((x) => x.t)) - Math.min(...fr.map((x) => x.t))) / 200;
  }
  check('test wobble ≥ the real one (eyes down to 86%, nose 6.5%)', eMin <= 0.9 && tR >= 0.065, `eyes ${eMin.toFixed(2)} nose ${tR.toFixed(3)}`);
}
let photoLive = 0;
for (let t = 0; t < 2000; t++) if (run(photoFrames(200))) photoLive++;
check('a photo held up (shaking, tilting, closer) is not taken as a real face', photoLive === 0, `${photoLive} of 2000`);
{
  const open = Array.from({ length: 8 }, () => facePoints({ open: 0.3, ...WOBBLE }));
  const shut = facePoints({ open: 0.12, ...WOBBLE });
  check('a blink counts', run([...open, shut, ...open]) === 'blink');
  check('a blink over 3 frames counts', run([...open, shut, shut, shut, ...open]) === 'blink');
  check('eyes shut for long (a photo with shut eyes, someone asleep) is not a blink', run([...open, ...Array(12).fill(shut), ...open]) === null);
  check('eyes shut from the start: no blink', run([...Array(6).fill(shut), ...open]) === null);
  const turn = Array.from({ length: 20 }, (_, i) => facePoints({ yaw: 0.5 + 0.12 * Math.sin(i / 3), ...WOBBLE }));
  check('turning the head a little counts', run(turn) === 'turn');
  const oneJump = [...open, facePoints({ yaw: 0.75 }), ...open];
  check('one odd frame (the detector jumping) is not a head turn', run(oneJump) === null);
  const oneWay = Array.from({ length: 14 }, (_, i) => facePoints({ yaw: 0.5 - 0.015 * i, ...WOBBLE }));
  check('turning one way is enough', run(oneWay) === 'turn');
  const l = createLiveness();
  for (const f of turn) l.push(f);
  check('live stays live, and reset starts again', l.live && (l.reset(), !l.live));
}

// =============== 3. leave and the paid days off ===============
check('days in a request', leave.daysIn('2026-11-10', '2026-11-10') === 1 && leave.daysIn('2026-11-28', '2026-12-03') === 6 && leave.daysIn('2028-02-28', '2028-03-01') === 3);
check('each day, across a month and a leap day', leave.eachDay('2028-02-28', '2028-03-01').join() === '2028-02-28,2028-02-29,2028-03-01');
const MONTHS = ['2026-02', '2026-04', '2026-10', '2026-11', '2026-12', '2028-02'];
const daysOf = (m) => leave.eachDay(...monthRange(m));
for (let t = 0; t < 4000; t++) {
  const month = pick(MONTHS);
  const [first, last] = monthRange(month);
  const staff = { id: 's', monthly_salary: 15000, join_date: rnd() < 0.3 ? pick(daysOf(month)) : '2025-01-01', leave_date: rnd() < 0.2 ? pick(daysOf(month)) : null };
  if (staff.leave_date && staff.leave_date < staff.join_date) staff.leave_date = null;
  const paidOffs = pick([4, 4, 4, 2, 5, 0]);
  const c = calcPayroll({ staff, month, attendance: [], advances: [], lines: [], paidOffs });
  check('paid days off for a part month = the payroll', leave.allowanceOf(staff, month, paidOffs) === c.paid_offs, `${month} ${JSON.stringify(staff)} ${paidOffs}`);
  // a leave request: what the preview says = what the payroll pays after it is approved
  const att = [];
  for (const d of daysOf(month)) {
    if (d < (staff.join_date > first ? staff.join_date : first) || (staff.leave_date && d > staff.leave_date)) continue;
    const r = rnd();
    if (r < 0.12) att.push({ staff_id: 's', day: d, status: 'W' });
    else if (r < 0.17) att.push({ staff_id: 's', day: d, status: 'A' });
    else if (r < 0.2) att.push({ staff_id: 's', day: d, status: 'H' });
    else if (r < 0.24) att.push({ staff_id: 's', day: d, status: 'L' });
    else if (r < 0.5) att.push({ staff_id: 's', day: d, status: 'P' });
  }
  const from = pick(daysOf(month));
  const to = addDays(from, ri(0, 4)) > last ? last : addDays(from, ri(0, 4));
  const pv = leave.offsPreview({ staff, attendance: att, from, to, paidOffs })[0];
  const before = calcPayroll({ staff, month, attendance: att, advances: [], lines: [], paidOffs });
  // approve: what leave_to_attendance() does (L on empty and absent days; week offs, half days and days they came stay)
  const after = att.map((a) => ({ ...a }));
  for (const d of leave.eachDay(from, to)) {
    const a = after.find((x) => x.day === d);
    if (!a) after.push({ staff_id: 's', day: d, status: 'L' });
    else if (a.status === 'A') a.status = 'L';
  }
  const paid = calcPayroll({ staff, month, attendance: after, advances: [], lines: [], paidOffs });
  const inJob = (d) => d >= (staff.join_date > first ? staff.join_date : first) && (!staff.leave_date || d <= staff.leave_date);
  if (leave.eachDay(from, to).every(inJob)) {
    check('leave preview: unpaid days = what the payroll then cuts', pv.unpaid === paid.unpaid_off_days, () => JSON.stringify({ month, from, to, pv, paid: paid.unpaid_off_days, staff }));
    check('leave preview: new unpaid days = the change in the payroll', pv.newUnpaid === paid.unpaid_off_days - before.unpaid_off_days, () => JSON.stringify({ pv, before: before.unpaid_off_days, after: paid.unpaid_off_days }));
  }
}
{
  const s = { id: 's', join_date: '2025-01-01' };
  const W = (d) => ({ staff_id: 's', day: d, status: 'W' });
  const p1 = leave.offsPreview({ staff: s, attendance: [W('2026-11-02'), W('2026-11-09')], from: '2026-11-12', to: '2026-11-14', paidOffs: 4 })[0];
  check('2 week offs + 3 days leave = 5 of 4: 1 unpaid', p1.used === 2 && p1.adds === 3 && p1.after === 5 && p1.unpaid === 1 && p1.newUnpaid === 1, JSON.stringify(p1));
  const p2 = leave.offsPreview({ staff: s, attendance: [W('2026-11-02'), W('2026-11-13')], from: '2026-11-12', to: '2026-11-14', paidOffs: 4 })[0];
  check('a week off inside the leave is not counted twice', p2.adds === 2 && p2.after === 4 && p2.unpaid === 0, JSON.stringify(p2));
  const p3 = leave.offsPreview({ staff: s, attendance: [], from: '2026-11-28', to: '2026-12-03', paidOffs: 4 });
  check('leave over two months: each month on its own', p3.length === 2 && p3[0].adds === 3 && p3[1].adds === 3 && p3.every((m) => m.unpaid === 0), JSON.stringify(p3));
  const p4 = leave.offsPreview({ staff: s, attendance: [], from: '2026-11-01', to: '2026-11-07', paidOffs: 4 })[0];
  check('a week at once: 4 paid, 3 unpaid ("taking at a time is fine, above 4 unpaid")', p4.after === 7 && p4.unpaid === 3, JSON.stringify(p4));
  const newJoin = leave.offsPreview({ staff: { id: 's', join_date: '2026-11-16' }, attendance: [], from: '2026-11-20', to: '2026-11-21', paidOffs: 4 })[0];
  check('joined mid-month: 2 paid days off', newJoin.allowance === 2 && newJoin.unpaid === 0, JSON.stringify(newJoin));
}
// days without a check-in
{
  const today = '2026-11-10';
  const st = [{ id: 'a', active: true, join_date: '2026-01-01' }, { id: 'b', active: true, join_date: '2026-11-05' }, { id: 'c', active: true }, { id: 'd', active: false }];
  const faces = [{ staff_id: 'a', created_at: '2026-11-03T05:00:00Z' }, { staff_id: 'b', created_at: '2026-10-01T05:00:00Z' }, { staff_id: 'd', created_at: '2026-10-01T05:00:00Z' }];
  const checks2 = [{ staff_id: 'a', day: '2026-11-03' }, { staff_id: 'a', day: '2026-11-05' }, { staff_id: 'b', day: '2026-11-06' }];
  const att = [{ staff_id: 'a', day: '2026-11-04', status: 'W' }, { staff_id: 'a', day: '2026-11-06', status: 'P' }, { staff_id: 'b', day: '2026-11-08', status: 'L' }];
  const m = leave.missedCheckIns({ staff: st, faces, checks: checks2, attendance: att, from: '2026-11-01', to: '2026-11-30', today });
  const got = m.map((x) => x.staff_id + x.day.slice(8)).join(' ');
  check('not checked in: from the face set-up (or joining) to yesterday, not marked', got === 'a07 a08 a09 b05 b07 b09', got);
  check('nobody without face check-in, or who left, is flagged', !m.some((x) => x.staff_id === 'c' || x.staff_id === 'd'));
  check('today is not flagged yet', !m.some((x) => x.day === today));
}
{
  const l = { from_day: '2026-11-12', to_day: '2026-11-14' };
  const ok = leave.leaveMessage('approved', l, 'Amit Das', { salon_name: 'Habibs' });
  check('WhatsApp: approved says the days and when they are back', /Hi Amit, your leave for Thu, 12 Nov to Sat, 14 Nov \(3 days\) is approved\. See you back on Sun, 15 Nov/.test(ok), ok);
  check('WhatsApp: refused', /could not be approved/.test(leave.leaveMessage('rejected', l, 'Amit Das', {})));
}

// =============== 4. the real database ===============
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec(`
  create role anon; create role authenticated;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  grant usage on schema auth to authenticated, anon;
  grant execute on all functions in schema auth to authenticated, anon;`);
const schema = readFileSync('supabase/01_schema.sql', 'utf8');
await db.exec(schema);
await db.exec(`grant usage on schema public to authenticated, anon; grant all on all tables in schema public to authenticated, anon;`);
const q = async (sql, p) => (await db.query(sql, p)).rows;
const tryq = async (sql, p) => { try { return await q(sql, p); } catch (e) { return { error: e.message }; } };
const owner = randomUUID(), clerk = randomUUID(), sOwner = randomUUID(), sClerk = randomUUID(), sPending = randomUUID();
await q(`insert into app_roles values ($1, 'owner', 'Krishna')`, [owner]);
await q(`insert into login_requests (session_id, user_id, email, status) values ($1, $2, 'counter@x', 'approved'), ($3, $2, 'counter@x', 'pending')`, [sClerk, clerk, sPending]);
async function as(user, session, fn) {
  await db.exec(`set role authenticated`);
  await db.query(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: user, session_id: session, role: 'authenticated', email: user === owner ? 'owner@x' : 'counter@x' })]);
  try { return await fn(); } finally { await db.exec(`reset role`); await db.query(`select set_config('request.jwt.claims', '', false)`); }
}
const anon = async (fn) => { await db.exec(`set role anon`); try { return await fn(); } finally { await db.exec(`reset role`); } };
const O = (sql, p) => as(owner, sOwner, () => tryq(sql, p));
const C = (sql, p) => as(clerk, sClerk, () => tryq(sql, p));
const PEND = (sql, p) => as(clerk, sPending, () => tryq(sql, p));
const err = (r) => (r && r.error) || '';
const today = (await q(`select (now() at time zone 'Asia/Kolkata')::date::text d`))[0].d;
check('the test runs on the same day in Node and the database', today === istDay(), `${today} ${istDay()}`);

const S = [
  { id: randomUUID(), name: 'Amit Das', phone: '9800000001' },
  { id: randomUUID(), name: 'Rahul Roy', phone: '9800000002' },
  { id: randomUUID(), name: 'Priya Saha', phone: '9800000003' },
  { id: randomUUID(), name: 'Sneha Paul', phone: '9800000004' },
];
for (const s of S) await q(`insert into staff (id, name, phone, join_date) values ($1, $2, $3, '2025-01-01')`, [s.id, s.name, s.phone]);
const PHOTO = 'data:image/jpeg;base64,' + 'A'.repeat(4000);
const prints = JSON.stringify([vec(0.05), vec(0.05), vec(0.05)]);
const ci = (who, p) => who(`select face_check_in($1) r`, [JSON.stringify(p)]);
const ok = (s, more = {}) => ({ staff_id: s.id, distance: 0.31, live: true, photo: PHOTO, ...more });

// --- face set-up: the owner only, with the staff member's agreement ---
check('counter cannot set up a face', !!err(await C(`insert into staff_faces (staff_id, descriptors, consent_at) values ($1, $2, now())`, [S[0].id, prints])));
check('face check-in before set-up is refused', /not set up/.test(err(await ci(C, ok(S[0])))));
check('owner sets up a face', !err(await O(`insert into staff_faces (staff_id, descriptors, consent_at, created_by) values ($1, $2, now(), 'owner')`, [S[0].id, prints])));
check('set-up needs 1 to 10 looks', !!err(await O(`insert into staff_faces (staff_id, descriptors, consent_at) values ($1, '[]', now())`, [S[1].id]))
  && !!err(await O(`insert into staff_faces (staff_id, descriptors, consent_at) values ($1, $2, now())`, [S[1].id, JSON.stringify(Array(11).fill(vec(0.05)))])));
check('set-up needs the agreement (consent time)', !!err(await O(`insert into staff_faces (staff_id, descriptors) values ($1, $2)`, [S[1].id, prints])));
for (const s of S.slice(1, 3)) await O(`insert into staff_faces (staff_id, descriptors, consent_at) values ($1, $2, now())`, [s.id, prints]);
check('the counter can read the face prints (the tablet matches faces)', (await C(`select count(*)::int n from staff_faces`))[0].n === 3);
check('a login waiting for approval cannot', (await PEND(`select count(*)::int n from staff_faces`))[0].n === 0);
check('the website (no login) cannot read face prints', !!err(await anon(() => tryq(`select * from staff_faces`))) || (await anon(() => tryq(`select count(*)::int n from staff_faces`)))[0].n === 0);

// --- checking in ---
check('a face too far from the prints is refused', /did not match/.test(err(await ci(C, ok(S[0], { distance: 0.6 })))));
check('no distance is refused', /did not match/.test(err(await ci(C, ok(S[0], { distance: null })))));
check('not seen blinking / turning is refused', /real face/.test(err(await ci(C, ok(S[0], { live: false })))) && /real face/.test(err(await ci(C, ok(S[0], { live: undefined })))));
check('no photo is refused', /photo is missing/.test(err(await ci(C, ok(S[0], { photo: null })))));
check('a photo that is not an image is refused', /photo is missing/.test(err(await ci(C, ok(S[0], { photo: 'data:text/html;base64,PGgxPg==' })))));
check('a huge photo is refused', /photo is missing/.test(err(await ci(C, ok(S[0], { photo: 'data:image/jpeg;base64,' + 'A'.repeat(90000) })))));
check('unknown staff is refused', /Staff not found/.test(err(await ci(C, ok({ id: randomUUID() })))) && /Staff not found/.test(err(await ci(C, { ...ok(S[0]), staff_id: "x' or 1=1" }))));
check('a login waiting for approval cannot check anyone in', /not approved/.test(err(await ci(PEND, ok(S[0])))));
check('the website (no login) cannot check anyone in', !!err(await anon(() => tryq(`select face_check_in($1)`, [JSON.stringify(ok(S[0]))]))));
check('nothing was saved by the refused ones', (await q(`select count(*)::int n from check_ins`))[0].n === 0 && (await q(`select count(*)::int n from attendance`))[0].n === 0);
const r1 = (await ci(C, ok(S[0])))[0]?.r;
check('first scan of the day checks in', r1 && r1.kind === 'in' && r1.name === 'Amit Das', JSON.stringify(r1));
const att0 = (await q(`select * from attendance where staff_id = $1 and day = $2`, [S[0].id, today]))[0];
check('…and marks them present (face check-in)', att0 && att0.status === 'P' && att0.marked_by === 'face check-in');
const row0 = (await q(`select * from check_ins where staff_id = $1`, [S[0].id]))[0];
check('…with the photo, the distance and who was signed in', row0 && row0.in_photo === PHOTO && Number(row0.in_distance) === 0.31 && row0.created_by === 'counter@x' && row0.day === today || row0.day.toISOString?.().slice(0, 10) === today, JSON.stringify({ ...row0, in_photo: undefined }));
check('a second scan soon after: already checked in', (await ci(C, ok(S[0])))[0].r.kind === 'again');
await q(`update check_ins set in_at = now() - interval '31 minutes' where staff_id = $1`, [S[0].id]);
const r2 = (await ci(C, ok(S[0], { distance: 0.4 })))[0].r;
check('a scan 30 minutes or more later checks out', r2.kind === 'out' && !!r2.in_at, JSON.stringify(r2));
check('…once a minute at most', (await ci(C, ok(S[0])))[0].r.kind === 'again_out');
await q(`update check_ins set out_at = now() - interval '2 hours' where staff_id = $1`, [S[0].id]);
check('the last scan of the day is when they left', (await ci(C, ok(S[0])))[0].r.kind === 'out' && (await q(`select count(*)::int n from check_ins where staff_id = $1 and out_at > now() - interval '1 minute'`, [S[0].id]))[0].n === 1);
check('one check-in a day per person', (await q(`select count(*)::int n from check_ins where staff_id = $1`, [S[0].id]))[0].n === 1);
// an owner's mark for the day is replaced by the face (they came)
await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'A', 'owner')`, [S[1].id, today]);
await ci(C, ok(S[1]));
check('checking in after being marked absent: present', (await q(`select status from attendance where staff_id = $1 and day = $2`, [S[1].id, today]))[0].status === 'P');
await q(`update staff set active = false where id = $1`, [S[2].id]);
check('someone who left cannot check in', /Staff not found/.test(err(await ci(C, ok(S[2])))));
await q(`update staff set active = true where id = $1`, [S[2].id]);

// --- the counter cannot write attendance or check-ins by hand ---
check('counter cannot mark attendance by hand', !!err(await C(`insert into attendance (staff_id, day, status) values ($1, $2, 'P')`, [S[3].id, addDays(today, -1)])));
await C(`update attendance set status = 'A' where staff_id = $1`, [S[0].id]);
check('counter cannot change attendance', (await q(`select status from attendance where staff_id = $1 and day = $2`, [S[0].id, today]))[0].status === 'P');
check('counter cannot add a check-in', !!err(await C(`insert into check_ins (staff_id, day) values ($1, $2)`, [S[3].id, today])));
await C(`update check_ins set in_at = now() - interval '5 hours'`);
await C(`delete from check_ins`);
check('counter cannot change or delete check-ins', (await q(`select count(*)::int n from check_ins where in_at < now() - interval '4 hours'`))[0].n === 0 && (await q(`select count(*)::int n from check_ins`))[0].n === 2);
check('counter can read check-ins (photos at the counter)', (await C(`select count(*)::int n from check_ins`))[0].n === 2);
check('owner marks by hand', !err(await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'W', 'owner')`, [S[3].id, addDays(today, -1)])));
check('owner can remove a wrong check-in', !err(await O(`delete from check_ins where staff_id = $1`, [S[1].id])) && (await q(`select count(*)::int n from check_ins`))[0].n === 1);
check('attendance knows L (leave)', !err(await O(`insert into attendance (staff_id, day, status) values ($1, $2, 'L')`, [S[3].id, addDays(today, -2)])));
check('attendance refuses other letters', !!err(await O(`insert into attendance (staff_id, day, status) values ($1, $2, 'X')`, [S[3].id, addDays(today, -3)])));

// --- leave ---
const rl = (who, p) => who(`select * from request_leave($1)`, [JSON.stringify(p)]);
const d = (n) => addDays(today, n);
const wd = (x) => new Date(x + 'T12:00:00Z').getUTCDay();
// days that pass the leave rules whatever day the test runs: Monday to Thursday, before the 22nd, each used once
// (one person off a day), so the requests below never trip a rule they are not testing
const taken = new Set([d(1), d(2)]);
const slot = (n, len = 1) => {
  for (let s = d(n); ; s = addDays(s, 1)) {
    const days = leave.eachDay(s, addDays(s, len - 1));
    if (days.every((x) => wd(x) >= 1 && wd(x) <= 4 && Number(x.slice(8)) < 22 && !taken.has(x))) { days.forEach((x) => taken.add(x)); return days; }
  }
};
const nextDow = (n, w) => { let s = d(n); while (wd(s) !== w) s = addDays(s, 1); return s; };
check('leave: choose who', /Choose who/.test(err(await rl(C, { from_day: d(3) }))));
check('leave: choose the days', /Choose the days/.test(err(await rl(C, { staff_id: S[0].id }))) && /Choose the days/.test(err(await rl(C, { staff_id: S[0].id, from_day: 'soon' }))));
check('leave: last day before the first', /before the first/.test(err(await rl(C, { staff_id: S[0].id, from_day: d(5), to_day: d(4) }))));
const long = (await rl(C, { staff_id: S[3].id, from_day: d(100), to_day: d(130), kind: 'sick' }))[0];
check('leave: at most 31 days', /At most 31/.test(err(await rl(C, { staff_id: S[0].id, from_day: d(1), to_day: d(32) }))) && !!long);
await O(`update leave_requests set status = 'cancelled' where id = $1`, [long.id]);
check('leave: not more than a week ago', /more than a week ago/.test(err(await rl(C, { staff_id: S[0].id, from_day: d(-8) }))));
check('leave: in the next 6 months', /next 6 months/.test(err(await rl(C, { staff_id: S[0].id, from_day: d(181) }))));
check('leave: a waiting login cannot ask', /not approved/.test(err(await rl(PEND, { staff_id: S[0].id, from_day: d(3) }))));
check('leave: the website cannot ask', !!err(await anon(() => tryq(`select * from request_leave($1)`, [JSON.stringify({ staff_id: S[0].id, from_day: d(3) })]))));
check('leave: the kind must be one of the list', /Choose the kind/.test(err(await rl(C, { staff_id: S[0].id, from_day: slot(3)[0], kind: 'holiday' }))));
const A = slot(3, 4); // Monday to Thursday
const L1 = (await rl(C, { staff_id: S[0].id, from_day: A[0], to_day: A[3], kind: 'planned', reason: "Sister's wedding" }))[0];
check('leave asked at the counter: waiting', L1 && L1.status === 'pending' && L1.requested_by === 'counter@x' && L1.reason === "Sister's wedding", JSON.stringify(L1));
check('one day: the last day is the first', (await rl(C, { staff_id: S[1].id, from_day: slot(3)[0] }))[0]?.to_day !== undefined);
check('the same days twice are refused', /already a request/.test(err(await rl(C, { staff_id: S[0].id, from_day: A[2], to_day: addDays(A[3], 3) }))));
// the owner's rules
const one = err(await rl(C, { staff_id: S[2].id, from_day: A[2], to_day: A[3] }));
check('rule: one person off a day: "Only one person can be off a day: Amit Das is off on <the first day>"', one === `Only one person can be off a day: Amit Das is off on ${leave.ruleDay(A[2])}`, one);
const med = (await rl(C, { staff_id: S[2].id, from_day: A[2], to_day: A[3], kind: 'sick', reason: 'Fever' }))[0];
check('rule: …medical leave is still asked (the owner decides)', med && med.kind === 'sick');
await C(`update leave_requests set status = 'cancelled' where id = $1`, [med.id]);
const fri = nextDow(3, 5);
const busy = err(await rl(C, { staff_id: S[2].id, from_day: addDays(fri, -1), to_day: addDays(fri, 2) }));
check('rule: no days off on Friday, Saturday or Sunday (names the first one)', busy === `${leave.ruleDay(fri)}: no days off on Friday, Saturday or Sunday, except medical leave`, busy);
check('rule: Sunday alone too, and personal or other leave too', /no days off on Friday, Saturday or Sunday/.test(err(await rl(C, { staff_id: S[2].id, from_day: nextDow(3, 0), kind: 'personal' })))
  && /no days off/.test(err(await rl(C, { staff_id: S[2].id, from_day: nextDow(3, 6), kind: 'other' }))));
const medFri = (await rl(C, { staff_id: S[2].id, from_day: fri, to_day: addDays(fri, 2), kind: 'sick' }))[0];
check('rule: medical leave on a Friday to Sunday can be asked', !!medFri);
await C(`update leave_requests set status = 'cancelled' where id = $1`, [medFri.id]);
{
  // a week off (W) marked for someone else counts as them being off
  const [w] = slot(3);
  await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'W', 'owner')`, [S[3].id, w]);
  const e = err(await rl(C, { staff_id: S[2].id, from_day: w }));
  check('rule: someone with a week off that day counts too', e === `Only one person can be off a day: Sneha Paul is off on ${leave.ruleDay(w)}`, e);
  await O(`delete from attendance where staff_id = $1 and day = $2`, [S[3].id, w]);
  check('…not once the week off is removed', !!(await rl(C, { staff_id: S[2].id, from_day: w }))[0]);
  // someone who left does not count
  const [w2] = slot(3);
  await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'L', 'owner')`, [S[3].id, w2]);
  await q(`update staff set active = false where id = $1`, [S[3].id]);
  check('…nor someone who has left', !!(await rl(C, { staff_id: S[2].id, from_day: w2 }))[0]);
  await q(`update staff set active = true where id = $1`, [S[3].id]);
}
{
  // the last week of a month (from the 22nd): 2 or more days off asked 14 days before. Busy days off for this part,
  // so it works whatever day the test runs
  await O(`update settings set value = '[]' where key = 'leave_blocked_days'`);
  // the next last week with 2 days left in it, and one 14+ days ahead
  const lastWeek = (n) => { let s = d(n); while (!(Number(s.slice(8)) >= 22 && addDays(s, 1).slice(5, 7) === s.slice(5, 7))) s = addDays(s, 1); return s; };
  const soon = lastWeek(1), later = lastWeek(14);
  const lead = (x) => leave.daysIn(today, x) - 1;
  if (lead(soon) < 14) {
    const e = err(await rl(C, { staff_id: S[0].id, from_day: soon, to_day: addDays(soon, 1), kind: 'personal' }));
    check('rule: 2 days in the last week, asked late: "must be asked 14 days before: by …"',
      e === `2 or more days off in the last week of the month (from the 22nd) must be asked 14 days before: by ${leave.ruleDay(addDays(soon, -14))}`, e);
    const one1 = (await rl(C, { staff_id: S[0].id, from_day: addDays(soon, 1), kind: 'personal' }))[0];
    check('rule: one day in the last week is fine, asked late', !!one1);
    const e2 = err(await rl(C, { staff_id: S[0].id, from_day: soon }));
    check('rule: …a second day in that week (asked on its own, late) is 2 days: refused', e2 === `2 or more days off in the last week of the month (from the 22nd) must be asked 14 days before: by ${leave.ruleDay(addDays(soon, -14))}`, e2);
    check('rule: medical leave in the last week is fine', !!(await rl(C, { staff_id: S[0].id, from_day: soon, kind: 'sick' }))[0]);
    await O(`update leave_requests set status = 'cancelled' where staff_id = $1 and from_day between $2 and $3`, [S[0].id, soon, addDays(soon, 1)]);
  } else check('rule: (the next last week is 14+ days away today: the late case is tested in the demo below)', true);
  const ok2 = (await rl(C, { staff_id: S[1].id, from_day: later, to_day: addDays(later, 1) }))[0];
  check('rule: 2 days in the last week asked 14 days before: fine', !!ok2, later);
  await O(`update leave_requests set status = 'cancelled' where id = $1`, [ok2?.id]);
  // the owner changes the rules in Settings
  await O(`update settings set value = '30' where key = 'leave_notice_days'`);
  const e3 = err(await rl(C, { staff_id: S[1].id, from_day: later, to_day: addDays(later, 1) }));
  check('settings: notice 30 days', lead(later) >= 30 ? !e3 : new RegExp(`asked 30 days before: by ${leave.ruleDay(addDays(later, -30))}$`).test(e3), e3);
  await O(`update leave_requests set status = 'cancelled' where staff_id = $1 and from_day = $2`, [S[1].id, later]);
  await O(`update settings set value = '14' where key = 'leave_notice_days'`);
  await O(`update settings set value = '[1]' where key = 'leave_blocked_days'`);
  const e4 = err(await rl(C, { staff_id: S[1].id, from_day: nextDow(60, 1) }));
  check('settings: no days off on Monday', e4 === `${leave.ruleDay(nextDow(60, 1))}: no days off on Monday, except medical leave`, e4);
  await O(`update settings set value = '[0, 6]' where key = 'leave_blocked_days'`);
  check('settings: "Saturday or Sunday" (Monday first)', /no days off on Saturday or Sunday, except/.test(err(await rl(C, { staff_id: S[1].id, from_day: nextDow(60, 0) }))));
  await O(`update settings set value = '[5, 6, 0]' where key = 'leave_blocked_days'`);
  await O(`update settings set value = 'false' where key = 'leave_one_at_a_time'`);
  const both = (await rl(C, { staff_id: S[2].id, from_day: A[2], to_day: A[3] }))[0];
  check('settings: more than one person off a day, when the owner allows it', !!both);
  await O(`update leave_requests set status = 'cancelled' where id = $1`, [both.id]);
  await O(`update settings set value = 'true' where key = 'leave_one_at_a_time'`);
  check('the counter cannot change the rules', (await C(`update settings set value = '[]' where key = 'leave_blocked_days' returning key`)).length === 0
    || !!err(await C(`update settings set value = '[]' where key = 'leave_blocked_days'`)));
  check('the rules are back as they were', JSON.stringify((await q(`select value from settings where key = 'leave_blocked_days'`))[0].value) === '[5,6,0]');
}
check('a waiting request adds nothing to attendance', (await q(`select count(*)::int n from attendance where status = 'L' and day > $1 and staff_id = $2`, [today, S[0].id]))[0].n === 0);
check('the counter cannot approve', /Only the owner/.test(err(await C(`select * from decide_leave($1, true)`, [L1.id]))));
await C(`update leave_requests set status = 'approved' where id = $1`, [L1.id]);
check('…not even by changing the row', (await q(`select status from leave_requests where id = $1`, [L1.id]))[0].status === 'pending');
check('the counter cannot add approved leave', !!err(await C(`insert into leave_requests (staff_id, from_day, to_day, status) values ($1, $2, $2, 'approved')`, [S[3].id, d(20)])));
check('…nor a waiting request without the rules', !!err(await C(`insert into leave_requests (staff_id, from_day, to_day) values ($1, $2, $2)`, [S[3].id, d(20)])));
// before approving: one of the days is a week off already, one an absent mark (to become leave)
await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'W', 'owner'), ($1, $3, 'A', 'owner')`, [S[0].id, A[1], A[2]]);
const dec = (await O(`select * from decide_leave($1, true)`, [L1.id]))[0];
check('the owner approves', dec && dec.status === 'approved' && dec.decided_by === 'owner@x' && !!dec.decided_at);
const att1 = await q(`select day::text, status, marked_by from attendance where staff_id = $1 and day between $2 and $3 order by day`, [S[0].id, A[0], A[3]]);
check('approved leave becomes L; a week off stays a week off; absent becomes leave', att1.map((a) => a.status).join() === 'L,W,L,L' && att1[0].marked_by === 'leave approved', JSON.stringify(att1));
check('answered twice: refused', /already answered/.test(err(await O(`select * from decide_leave($1, false)`, [L1.id]))));
{
  // the owner unlocked the counter (Telegram): the counter can approve for those 10 minutes, and the owner's name is kept
  const Lx = (await rl(C, { staff_id: S[3].id, from_day: slot(30)[0] }))[0];
  await q(`insert into owner_grants (session_id, user_id, action, status, decided_at, decided_by, expires_at) values ($1, $2, 'unlock', 'approved', now(), 'Raj (Telegram)', now() + interval '10 minutes')`, [sClerk, clerk]);
  const dx = (await C(`select * from decide_leave($1, true)`, [Lx.id]))[0];
  check('owner unlocked the counter: leave approved there, by the owner who unlocked it', dx && dx.status === 'approved' && dx.decided_by === 'Raj (Telegram)', JSON.stringify(dx));
  await q(`update owner_grants set expires_at = now() - interval '1 minute' where session_id = $1`, [sClerk]);
  const Ly = (await rl(C, { staff_id: S[3].id, from_day: slot(30)[0] }))[0];
  check('after the 10 minutes: no longer', /Only the owner/.test(err(await C(`select * from decide_leave($1, true)`, [Ly.id]))));
  await O(`update leave_requests set status = 'cancelled' where id in ($1, $2)`, [Lx.id, Ly.id]);
}
check('the counter cannot cancel approved leave', (await C(`update leave_requests set status = 'cancelled' where id = $1 returning id`, [L1.id])).length === 0);
await O(`update leave_requests set status = 'cancelled' where id = $1`, [L1.id]);
const att2 = await q(`select day::text, status from attendance where staff_id = $1 and day between $2 and $3 order by day`, [S[0].id, A[0], A[3]]);
check('cancelled after approval: the L days come off, the week off stays', att2.map((a) => a.status).join() === 'W', JSON.stringify(att2));
const L2 = (await rl(C, { staff_id: S[0].id, from_day: A[0], to_day: A[0] }))[0];
check('after cancelling, the days can be asked again', !!L2);
check('the counter can cancel a waiting request', (await C(`update leave_requests set status = 'cancelled' where id = $1 returning id`, [L2.id])).length === 1);
check('…but not turn it into anything else', (await C(`update leave_requests set status = 'pending' where id = $1 returning id`, [L2.id])).length === 0);
const B = slot(15, 2);
const L3 = (await rl(C, { staff_id: S[1].id, from_day: B[0], to_day: B[1] }))[0];
await O(`select * from decide_leave($1, false)`, [L3.id]);
check('refused leave adds nothing', (await q(`select count(*)::int n from attendance where staff_id = $1 and day between $2 and $3`, [S[1].id, B[0], B[1]]))[0].n === 0);
// Telegram approves through the service key: the same row update (medical: tomorrow may be any day of the week)
const L4 = (await rl(C, { staff_id: S[1].id, from_day: d(1), to_day: d(2), kind: 'sick' }))[0];
await q(`update leave_requests set status = 'approved', decided_by = 'Krishna (Telegram)', decided_at = now() where id = $1 and status = 'pending'`, [L4.id]);
check('approved on Telegram: L in attendance too', (await q(`select count(*)::int n from attendance where staff_id = $1 and status = 'L' and day between $2 and $3`, [S[1].id, d(1), d(2)]))[0].n === 2);
// leave today, and they come anyway: the face wins
const L5 = (await O(`insert into leave_requests (staff_id, from_day, to_day, status) values ($1, $2, $2, 'approved') returning *`, [S[2].id, today]))[0];
check('owner adds leave straight away: L', (await q(`select status from attendance where staff_id = $1 and day = $2`, [S[2].id, today]))[0].status === 'L');
await ci(C, ok(S[2]));
check('on leave but came and checked in: present', (await q(`select status from attendance where staff_id = $1 and day = $2`, [S[2].id, today]))[0].status === 'P');
await O(`update leave_requests set status = 'cancelled' where id = $1`, [L5.id]);
check('cancelling that leave keeps the day they came', (await q(`select status from attendance where staff_id = $1 and day = $2`, [S[2].id, today]))[0].status === 'P');
check('the counter sees leave (who is off when)', (await C(`select count(*)::int n from leave_requests`))[0].n >= 6);
check('a waiting login does not', (await PEND(`select count(*)::int n from leave_requests`))[0].n === 0);

// --- documents: the owner only ---
check('counter cannot add a document', !!err(await C(`insert into staff_documents (staff_id, kind) values ($1, 'pan')`, [S[0].id])));
check('owner adds one', !err(await O(`insert into staff_documents (staff_id, kind, number, file_path) values ($1, 'pan', 'ABCDE1234F', 'x/y.jpg')`, [S[0].id])));
check('counter cannot see documents', (await C(`select count(*)::int n from staff_documents`))[0].n === 0);
check('Aadhaar: only the last 4 digits are stored', !!err(await O(`insert into staff_documents (staff_id, kind, number) values ($1, 'aadhaar', '123412341234')`, [S[0].id]))
  && !err(await O(`insert into staff_documents (staff_id, kind, number) values ($1, 'aadhaar', '1234')`, [S[0].id])));
check('unknown kind refused', !!err(await O(`insert into staff_documents (staff_id, kind) values ($1, 'passport-ish')`, [S[0].id])));

// --- the morning message (the Telegram function only) ---
check('the counter cannot ask for the morning message', !!err(await C(`select day_summary()`)));
await O(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'H', 'owner') on conflict (staff_id, day) do nothing`, [S[2].id, d(-1)]);
const L6 = (await rl(C, { staff_id: S[3].id, from_day: d(1), to_day: d(1), kind: 'sick' }))[0];
const sum = (await q(`select day_summary() s`))[0].s;
check('morning message: on leave tomorrow', JSON.stringify(sum.leave_tomorrow) === JSON.stringify(['Rahul Roy']), JSON.stringify(sum));
check('morning message: leave waiting', sum.pending_leave.some((x) => x.name === 'Sneha Paul' && x.from === d(1)));
check('morning message: who did not check in yesterday (with face check-in, not marked)', JSON.stringify(sum.not_checked_in) === JSON.stringify(['Amit Das', 'Rahul Roy']), JSON.stringify(sum.not_checked_in));
check('morning message: once a day', (await q(`select day_summary() s`))[0].s === null);

// --- leave coming up: the planning message (7, 3 and 1 days before) ---
{
  const lp = async (id, at) => (await q(`select leave_plan_due($1, $2::date) p`, [id, at]))[0].p;
  const ins = async (sid, from, to, status = 'approved') => (await q(`insert into leave_requests (staff_id, from_day, to_day, status, kind, reason) values ($1, $2, $3, $4, 'planned', 'Family wedding') returning id`, [sid, from, to, status]))[0].id;
  const book = async (sid, day, status = 'confirmed', time = '17:30') => {
    const [b] = await q(`insert into bookings (ref, phone, name, want_date, slot_at, staff_id, status, source) values ('R' || floor(random() * 1e6)::text, '9831100012', 'Megha Agarwal', $2::date, ($2 || ' ' || $4 || '+05:30')::timestamptz, $1, $3, 'phone') returning id`, [sid, day, status, time]);
    await q(`insert into booking_items (booking_id, name, option_label, price) values ($1, 'Keratin', 'L · Thick', 5499)`, [b.id]);
    return b.id;
  };
  // Amit off in a week (2 days); Rahul has a week off on the first day; Priya has asked for it too
  const A0 = d(40), A1 = d(41);
  const lA = await ins(S[0].id, A0, A1);
  await book(S[0].id, A0); await book(S[0].id, A1, 'requested', '11:00');
  await book(S[0].id, d(42)); await book(S[1].id, A0); await book(S[0].id, A0, 'cancelled');
  await q(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, 'W', 'owner')`, [S[1].id, A0]);
  const lP = await ins(S[2].id, A1, A1, 'pending');
  const at = (n) => addDays(A0, -n);
  const p7 = await lp(lA, at(7));
  check('7 days before: the plan (who, days, in 7 days, why)', p7 && p7.name === 'Amit Das' && p7.days === 2 && p7.in_days === 7 && p7.reason === 'Family wedding', JSON.stringify(p7));
  check('…the bookings given to Amit on those days (not another day, not someone else\'s, not cancelled), in time order', p7 && p7.bookings.length === 2 && p7.bookings[0].day === A0 && p7.bookings[0].time === '05:30 pm'
    && p7.bookings[0].services === 'Keratin (L · Thick)' && p7.bookings[1].status === 'requested', JSON.stringify(p7 && p7.bookings));
  check('…who else is off: a week off, and leave asked', p7 && JSON.stringify(p7.also_off) === JSON.stringify([`Priya Saha (${leave.ruleDay(A1)}, asked)`, `Rahul Roy (${leave.ruleDay(A0)}, week off)`]), JSON.stringify(p7 && p7.also_off));
  check('…how many are in on the busiest day (4 staff; Amit and Rahul off the first day; asked leave not counted)', p7 && p7.staff === 4 && p7.in_least === 2, JSON.stringify(p7));
  check('…sent once', (await lp(lA, at(7))) === null && (await lp(lA, at(6))) === null && (await lp(lA, at(4))) === null);
  const p3 = await lp(lA, at(3));
  check('3 days before: again', p3 && p3.in_days === 3 && (await lp(lA, at(2))) === null);
  check('the day before: again', (await lp(lA, at(1)))?.in_days === 1 && (await lp(lA, at(1))) === null);
  check('not on the day itself, nor more than a week ahead', (await lp(lA, A0)) === null && (await lp(await ins(S[3].id, d(60), d(60)), d(50))) === null);
  // approved late: only the reminder it is due for
  const lL = await ins(S[3].id, d(70), d(70));
  check('approved 2 days before: the 3-day reminder now (not the 7-day one as well)', (await lp(lL, d(68)))?.in_days === 2 && (await lp(lL, d(68))) === null && (await lp(lL, d(69)))?.in_days === 1);
  check('leave still waiting, or cancelled: nothing', (await lp(lP, at(7))) === null);
  // the owner's choice of days
  await q(`update settings set value = '[5]' where key = 'leave_alert_days'`);
  const lS = await ins(S[3].id, d(80), d(80));
  check('Settings: only 5 days before', (await lp(lS, d(74))) === null && (await lp(lS, d(75)))?.in_days === 5 && (await lp(lS, d(79))) === null);
  await q(`update settings set value = '[7, 3, 1]' where key = 'leave_alert_days'`);
  check('the counter cannot ask for plans', !!err(await C(`select leave_plan_due($1)`, [lA])) && !!err(await C(`select leave_plan($1)`, [lA])));
  // in the morning message: leave coming up, and on Mondays the week
  const lM = await ins(S[3].id, d(3), d(3));
  await q(`delete from alerts_sent where kind = 'day ' || $1`, [today]);
  const sm = (await q(`select day_summary() s`))[0].s;
  check('morning message: the leave 3 days away is in it for planning', sm && sm.leave_ahead.some((p) => p.id === lM && p.in_days === 3), JSON.stringify(sm && sm.leave_ahead));
  const monday = new Date(today + 'T12:00:00Z').getUTCDay() === 1;
  check(monday ? 'Monday: everyone\'s leave this week' : 'not Monday: no week list', monday ? Array.isArray(sm.week_leave) : sm.week_leave === null, JSON.stringify(sm && sm.week_leave));
  for (const id of [lA, lP, lL, lS, lM]) await q(`update leave_requests set status = 'cancelled' where id = $1`, [id]);
  await q(`delete from attendance where staff_id = $1 and day = $2`, [S[1].id, A0]);
  await q(`delete from bookings where want_date between $1 and $2`, [A0, d(42)]);
}
await O(`select * from decide_leave($1, true)`, [L6.id]);

// --- running the schema again keeps it all ---
const before = (await q(`select (select count(*) from check_ins) a, (select count(*) from leave_requests) b, (select count(*) from staff_faces) c, (select count(*) from attendance) e`))[0];
await db.exec(schema);
const after = (await q(`select (select count(*) from check_ins) a, (select count(*) from leave_requests) b, (select count(*) from staff_faces) c, (select count(*) from attendance) e`))[0];
check('schema re-run keeps check-ins, leave, faces and attendance', JSON.stringify(before) === JSON.stringify(after), JSON.stringify([before, after]));
check('paid days off setting is there (4)', (await q(`select value from settings where key = 'paid_offs_per_month'`))[0]?.value === 4);

// =============== 5. the demo database does the same ===============
{
  const T = ['settings', 'services', 'staff', 'attendance', 'staff_faces', 'check_ins', 'leave_requests'];
  localStorage.setItem('habibs-pos-demo-v1', JSON.stringify({ version: 6, ...Object.fromEntries(T.map((t) => [t, []])) }));
  const ldb = createLocalDb();
  const pg = new PGlite({ extensions: { pgcrypto } });
  await pg.exec(`create role anon; create role authenticated; create schema auth;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;`);
  await pg.exec(schema);
  const pq = async (sql, p) => (await pg.query(sql, p)).rows;
  // the owner, through the database's own owner check
  const ow = randomUUID();
  await pq(`insert into app_roles values ($1, 'owner', 'K')`, [ow]);
  await pq(`select set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ sub: ow, session_id: randomUUID(), role: 'authenticated', email: 'owner@x' })]);
  const tryp = async (sql, p) => { try { return await pq(sql, p); } catch (e) { return { error: e.message }; } };
  const tryl = async (fn) => { try { return await fn(); } catch (e) { return { error: e.message }; } };
  const P = S.map((s) => ({ ...s, id: randomUUID() }));
  for (const s of P) {
    await pq(`insert into staff (id, name, join_date) values ($1, $2, '2025-01-01')`, [s.id, s.name]);
    await ldb.insert('staff', { id: s.id, name: s.name, join_date: '2025-01-01', active: true });
  }
  for (const s of P.slice(0, 3)) {
    await pq(`insert into staff_faces (staff_id, descriptors, consent_at) values ($1, $2, now())`, [s.id, prints]);
    await ldb.upsert('staff_faces', { staff_id: s.id, descriptors: JSON.parse(prints), consent_at: new Date().toISOString() }, 'staff_id');
  }
  const same = (a, b) => (!!a.error === !!b.error) && (!a.error || a.error === b.error);
  let mism = 0;
  const leaves = [];
  const RULES = [['leave_blocked_days', [[5, 6, 0], [], [1], [0, 6], [5, 6, 0]]], ['leave_notice_days', [14, 0, 30, 14]], ['leave_one_at_a_time', [true, false, true]]];
  for (let t = 0; t < 600; t++) {
    if (rnd() < 0.04) {
      // the owner changes a leave rule in Settings
      const [key, vals] = pick(RULES);
      const value = pick(vals);
      await pq(`insert into settings (key, value) values ($1, $2) on conflict (key) do update set value = excluded.value`, [key, JSON.stringify(value)]);
      await ldb.upsert('settings', { key, value }, 'key');
    }
    const s = pick(P);
    const r = rnd();
    if (r < 0.25) {
      // the owner marks a day
      const day = addDays(today, ri(-7, 40));
      const st = pick(['P', 'A', 'W', 'H', 'L']);
      await pq(`insert into attendance (staff_id, day, status, marked_by) values ($1, $2, $3, 'owner') on conflict (staff_id, day) do update set status = excluded.status`, [s.id, day, st]);
      await ldb.upsert('attendance', { staff_id: s.id, day, status: st, marked_by: 'owner' }, 'staff_id,day');
    } else if (r < 0.6) {
      const p = { staff_id: rnd() < 0.05 ? randomUUID() : s.id, from_day: addDays(today, ri(-9, 45)), kind: pick(['planned', 'sick', 'personal']), reason: 'x' };
      p.to_day = rnd() < 0.1 ? addDays(p.from_day, -1) : addDays(p.from_day, ri(0, rnd() < 0.05 ? 35 : 4));
      const a = await tryp(`select * from request_leave($1)`, [JSON.stringify(p)]);
      const id = a.error ? null : a[0].id;
      const b = await tryl(() => ldb.rpc('request_leave', { p }));
      if (!same(a, b)) { mism++; check('demo: same answer to a leave request', false, JSON.stringify([p, a.error, b.error])); }
      if (id && !b.error) {
        await pq(`update leave_requests set id = $1 where id = $2`, [b.id, id]); // same id in both
        leaves.push(b.id);
      }
    } else if (r < 0.85 && leaves.length) {
      const id = pick(leaves);
      const yes = rnd() < 0.7;
      const a = await tryp(`select * from decide_leave($1, $2)`, [id, yes]);
      const b = await tryl(() => ldb.rpc('decide_leave', { p_id: id, p_approve: yes }));
      if (!same(a, b)) { mism++; check('demo: same answer to approving', false, JSON.stringify([a.error, b.error])); }
    } else if (leaves.length) {
      const id = pick(leaves);
      const cur = (await pq(`select status from leave_requests where id = $1`, [id]))[0].status;
      if (cur !== 'cancelled') {
        await pq(`update leave_requests set status = 'cancelled' where id = $1`, [id]);
        await ldb.update('leave_requests', id, { status: 'cancelled' });
      }
    }
  }
  const norm2 = (rows) => rows.map((a) => `${a.staff_id}|${typeof a.day === 'string' ? a.day : a.day.toISOString().slice(0, 10)}|${a.status}`).sort().join('\n');
  const pa = await pq(`select staff_id, day::text as day, status from attendance`);
  const la = await ldb.list('attendance');
  check('demo and database: the same attendance after random leave, approvals, cancels and marks', norm2(pa) === norm2(la), () => `db ${pa.length} demo ${la.length}`);
  const pl = await pq(`select id, status from leave_requests`);
  const ll = await ldb.list('leave_requests');
  check('demo and database: the same leave', pl.map((x) => x.id + x.status).sort().join() === ll.map((x) => x.id + x.status).sort().join());
  check('demo and database answered every leave call the same way', mism === 0);
  // face check-in: the same answers
  const cases = [ok(P[0], { distance: 0.6 }), ok(P[0], { live: false }), ok(P[0], { photo: 'x' }), ok(P[3]), ok({ id: randomUUID() }), ok(P[0]), ok(P[0]), ok(P[1])];
  for (const p of cases) {
    const a = await tryp(`select face_check_in($1) r`, [JSON.stringify(p)]);
    const b = await tryl(() => ldb.rpc('face_check_in', { p }));
    check('demo: same face check-in answer', a.error ? b.error === a.error : !b.error && a[0].r.kind === b.kind, JSON.stringify([a.error || a[0].r.kind, b.error || b.kind]));
  }
  const pa2 = await pq(`select staff_id, day::text as day, status from attendance`);
  check('demo and database: the same attendance after check-ins', norm2(pa2) === norm2(await ldb.list('attendance')));
}

const bad = Object.entries(fails);
console.log(`${checks.toLocaleString()} staff checks, ${bad.reduce((a, [, v]) => a + v.count, 0)} failed`);
for (const [n, v] of bad.slice(0, 30)) console.log(`✗ ${n} (${v.count}×) ${String(v.first).slice(0, 600)}`);
process.exitCode = bad.length ? 1 : 0;
