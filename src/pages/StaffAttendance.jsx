// Staff → Attendance and Leave.
// Staff check in with their face (present); the owner marks the rest by hand. Someone with face check-in who
// didn't check in is flagged for the owner: they count as present until the owner marks the day.
// Leave is asked for at the counter and approved by the owner (Telegram or here); approved days become L.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ScanFace, CalendarPlus, Check, X, MessageCircle, Lock, AlertTriangle, LogIn, LogOut } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { istDay, addDays, monthRange, fmtMonth, fmtDate, fmtTime } from '../lib/format';
import { DateNav, Seg, Modal, Field, Empty, Loading, Confirm } from '../components/ui';
import { loadFace, findFaces, openCamera, facePhoto, bestMatch, createLiveness, MIN_FACE } from '../lib/face';
import { LEAVE_KINDS, LEAVE_KIND, daysIn, leaveOn, leaveDays, offsPreview, missedCheckIns, leaveMessage, allowanceOf, leaveRuleError, leaveRules, blockedText, othersOff, ruleDay, eachDay, busyDays, busyNote } from '../lib/leave';
import { waLink } from '../lib/bookings';

export const paidOffsOf = (settings) => (settings && settings.paid_offs_per_month != null && settings.paid_offs_per_month !== '' ? Number(settings.paid_offs_per_month) : 4);
const STATUS = [['P', 'Present'], ['H', 'Half day'], ['A', 'Absent'], ['W', 'Week off'], ['L', 'Leave']];
const STATUS_LABEL = Object.fromEntries(STATUS);
const CHECK_COLS = 'id,staff_id,day,in_at,out_at,in_distance,out_distance';

// Leave waiting for the owner (the Staff badge)
export async function staffCounts() {
  const rows = await db.list('leave_requests', { eq: { status: 'pending' }, gte: { to_day: istDay() } });
  return { leave: rows.length };
}

// ---------------- Attendance ----------------
export function Attendance({ onLeave, onCounts }) {
  const { staff, toast, isOwner, askOwner, settings, user } = useApp();
  const today = istDay();
  const [day, setDay] = useState(today);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [scan, setScan] = useState(false);
  const [marking, setMarking] = useState(false);
  const [photo, setPhoto] = useState(null);
  const active = staff.filter((s) => s.active);
  const month = day.slice(0, 7);

  const load = async () => {
    const [a, b] = monthRange(month);
    try {
      setErr('');
      const [att, checks, dayChecks, faces, leave] = await Promise.all([
        db.list('attendance', { gte: { day: a }, lte: { day: b } }),
        db.list('check_ins', { gte: { day: a }, lte: { day: b }, select: CHECK_COLS }),
        db.list('check_ins', { eq: { day } }),
        db.list('staff_faces', { select: 'staff_id,created_at,consent_at' }),
        db.list('leave_requests', { in: { status: ['pending', 'approved'] }, gte: { to_day: addDays(today, -1) } }),
      ]);
      setData({ att, checks, dayChecks, faces, leave });
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => { load(); }, [day]);
  useEffect(() => { if (!isOwner) setMarking(false); }, [isOwner]);

  const missed = useMemo(() => {
    if (!data) return [];
    const [a, b] = monthRange(month);
    return missedCheckIns({ staff: active, faces: data.faces, checks: data.checks, attendance: data.att, from: a, to: b, today });
  }, [data, staff]);

  const startMarking = async () => {
    if (await askOwner('Marking attendance by hand is for the owner. Staff check in with their face.')) setMarking(true);
  };
  const mark = async (sid, status) => {
    const prev = data.att;
    const others = prev.filter((r) => !(r.staff_id === sid && r.day === day));
    setData({ ...data, att: [...others, { staff_id: sid, day, status }] });
    try {
      await db.upsert('attendance', { staff_id: sid, day, status, marked_by: (user && user.email) || 'owner' }, 'staff_id,day');
    } catch (e) {
      setData({ ...data, att: prev });
      toast(e.message, 'bad');
    }
  };

  if (!active.length) return <Empty title="No staff yet">The owner can add staff in the Staff list tab.</Empty>;
  if (err) return <div className="card"><Empty title="Attendance could not load">{err}</Empty></div>;

  const offToday = data ? leaveOn(data.leave, today) : [];
  const offTomorrow = data ? leaveOn(data.leave, addDays(today, 1)).filter((l) => !offToday.includes(l)) : [];
  const pending = data ? data.leave.filter((l) => l.status === 'pending') : [];
  const nameOf = (id) => (staff.find((s) => s.id === id) || {}).name || 'Staff';
  const names = (ls) => [...new Set(ls.map((l) => nameOf(l.staff_id)))].join(', ');
  const paidOffs = paidOffsOf(settings);

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <DateNav day={day} onChange={setDay} />
        <div className="row wrap" style={{ gap: 8 }}>
          {day === today && <button className="btn primary" id="face-check-in" onClick={() => setScan(true)}><ScanFace size={18} /> Face check-in</button>}
          {marking && isOwner
            ? <button className="btn line sm" onClick={() => setMarking(false)}><Check size={15} /> Done marking</button>
            : <button className="btn line sm" id="mark-by-hand" onClick={startMarking}>{!isOwner && <Lock size={13} />} Mark by hand</button>}
        </div>
      </div>

      {data && (offToday.length > 0 || offTomorrow.length > 0 || pending.length > 0 || missed.length > 0) && (
        <div className="notice-list">
          {offToday.length > 0 && <div className="notice">On leave today: <b>{names(offToday)}</b></div>}
          {offTomorrow.length > 0 && <div className="notice">On leave tomorrow: <b>{names(offTomorrow)}</b></div>}
          {pending.length > 0 && (
            <div className="notice warn">
              {pending.length} leave {pending.length === 1 ? 'request' : 'requests'} waiting for the owner
              <button className="btn line sm" onClick={onLeave}>See leave</button>
            </div>
          )}
          {missed.length > 0 && (
            <div className="notice warn" id="missed-note">
              <AlertTriangle size={15} /> {missed.length} {missed.length === 1 ? 'day' : 'days'} this month without a check-in:{' '}
              {[...new Set(missed.map((m) => m.staff_id))].map((id) => `${nameOf(id)} (${missed.filter((m) => m.staff_id === id).map((m) => fmtDate(m.day, false)).join(', ')})`).join('; ')}.
              {' '}They count as present until the owner marks the day.
            </div>
          )}
        </div>
      )}

      <div className="card">
        {data === null ? <Loading /> : active.map((s) => (
          <AttRow key={s.id} s={s} day={day} today={today} data={data} marking={marking && isOwner} onMark={(v) => mark(s.id, v)} onPhoto={setPhoto} />
        ))}
      </div>

      {data && (
        <div className="card">
          <div className="card-head"><h3>{fmtMonth(month)} so far</h3></div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Name</th><th className="r">Face check-ins</th><th className="r">Not checked in</th><th className="r">Absent</th><th className="r">Half days</th><th className="r">Days off</th></tr>
              </thead>
              <tbody>
                {active.map((s) => {
                  const mine = data.att.filter((r) => r.staff_id === s.id);
                  const n = (st) => mine.filter((r) => r.status === st).length;
                  const off = n('W') + n('L');
                  const allow = allowanceOf(s, month, paidOffs);
                  return (
                    <tr key={s.id}>
                      <td>{s.name}</td>
                      <td className="r">{data.checks.filter((c) => c.staff_id === s.id).length}</td>
                      <td className="r">{missed.filter((m) => m.staff_id === s.id).length || '–'}</td>
                      <td className="r">{n('A')}</td>
                      <td className="r">{n('H')}</td>
                      <td className="r">
                        {off} of {allow} paid{off > allow && <b style={{ color: 'var(--warn)' }}> · {off - allow} unpaid</b>}
                        <div className="tiny muted">{n('W')} week off, {n('L')} leave</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <p className="muted small">
        Staff check in with their face when they come, and scan again when they leave. Week offs and leave share {paidOffs} paid days off a month; more are unpaid (Payroll).
        Someone without face check-in counts as present unless the owner marks the day.
      </p>
      {scan && <FaceScanner onClose={() => { setScan(false); load(); }} onDone={() => load()} />}
      {photo && (
        <Modal title={photo.title} onClose={() => setPhoto(null)}>
          <div className="ci-photos">
            {photo.list.map((p) => <figure key={p.label}><img src={p.src} alt={p.label} /><figcaption>{p.label}</figcaption></figure>)}
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>Taken by the tablet at check-in, so the owner can see it was really them.</p>
        </Modal>
      )}
    </div>
  );
}

function AttRow({ s, day, today, data, marking, onMark, onPhoto }) {
  const att = data.att.find((r) => r.staff_id === s.id && r.day === day);
  const ci = data.dayChecks.find((r) => r.staff_id === s.id) || data.checks.find((r) => r.staff_id === s.id && r.day === day);
  const face = data.faces.find((f) => f.staff_id === s.id);
  const lv = leaveOn(data.leave, day, s.id)[0];
  const enrolledFrom = face ? istDay(new Date(face.created_at || face.consent_at)) : null;
  let line;
  if (att && att.status !== 'P') {
    line = <span className={'pill ' + (att.status === 'A' ? 'bad' : att.status === 'H' ? 'warn' : '')}>{STATUS_LABEL[att.status]}</span>;
  } else if (ci) {
    line = (
      <span className="pill ok">
        <LogIn size={12} /> {fmtTime(ci.in_at)}{ci.out_at && <> · <LogOut size={12} /> {fmtTime(ci.out_at)}</>}
      </span>
    );
  } else if (att) {
    line = <span className="pill ok">Present</span>;
  } else if (lv) {
    line = <span className="pill">On leave</span>;
  } else if (face && day >= enrolledFrom && day < today) {
    line = <span className="pill warn" title="Counts as present until the owner marks the day"><AlertTriangle size={12} /> Not checked in</span>;
  } else if (face && day === today) {
    line = <span className="pill">Not checked in yet</span>;
  } else {
    line = <span className="small muted">Present (not marked)</span>;
  }
  const photos = ci && ci.in_photo ? [{ label: 'In ' + fmtTime(ci.in_at), src: ci.in_photo }, ...(ci.out_photo ? [{ label: 'Out ' + fmtTime(ci.out_at), src: ci.out_photo }] : [])] : [];
  return (
    <div className="att-row" data-staff={s.name}>
      <div className="row" style={{ gap: 12, alignItems: 'center', minWidth: 0 }}>
        {photos.length > 0
          ? <button className="ci-thumb" onClick={() => onPhoto({ title: `${s.name}, ${fmtDate(day)}`, list: photos })} aria-label={'Check-in photo of ' + s.name}><img src={photos[0].src} alt="" /></button>
          : <span className="ci-thumb empty" aria-hidden="true" />}
        <div style={{ minWidth: 0 }}>
          <div className="strong">{s.name}</div>
          <div className="small muted">{s.role || 'Staff'}{!face && ' · no face check-in'}{att && att.marked_by && att.marked_by !== 'face check-in' ? ` · marked by ${att.marked_by === 'leave approved' ? 'leave' : 'owner'}` : ''}</div>
        </div>
      </div>
      {marking ? <Seg className="att-seg" options={STATUS} value={att ? att.status : 'P'} onChange={onMark} /> : <div className="att-state">{line}</div>}
    </div>
  );
}

// ---------------- Face check-in (camera) ----------------
// Stays open for the next person. Closes by itself after 90 seconds with no one in front of it.
const IDLE_MS = 90000;
export function FaceScanner({ onClose, onDone }) {
  const { staff } = useApp();
  const video = useRef(null);
  const [phase, setPhase] = useState('loading'); // loading | look | busy | result | error
  const [msg, setMsg] = useState('Getting the camera ready…');
  const [result, setResult] = useState(null);
  const [err, setErr] = useState('');
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let dead = false;
    let timer = null;
    let stop = null;
    let paused = false;
    let live = createLiveness();
    let who = null;
    let seen = 0;
    let unknownSince = 0;
    let lastFace = Date.now();
    let recent = {}; // staff_id → time of their last result, so standing there doesn't repeat it
    const firstName = (id) => String((staff.find((s) => s.id === id) || {}).name || '').split(' ')[0];

    const finish = (r) => {
      setResult(r);
      setPhase('result');
      paused = true;
      setTimeout(() => {
        if (dead) return;
        live.reset();
        who = null;
        seen = 0;
        paused = false;
        setResult(null);
        setPhase('look');
        setMsg('Next person: look at the camera');
      }, r.kind === 'error' ? 5000 : 3500);
    };

    const tick = async (faces) => {
      if (dead) return;
      if (paused) { timer = setTimeout(() => tick(faces), 250); return; }
      if (Date.now() - lastFace > IDLE_MS) { closeRef.current(); return; }
      const v = video.current;
      let found = [];
      try { found = v && v.videoWidth ? await findFaces(v) : []; } catch { found = []; }
      if (dead) return;
      if (!found.length) {
        who = null;
        live.reset();
        unknownSince = 0;
        setMsg('Look at the camera');
      } else {
        lastFace = Date.now();
        const f = found[0];
        if (found.length > 1 && found[1].box.width > f.box.width * 0.6) {
          who = null;
          live.reset();
          setMsg('One person at a time, please');
        } else if (f.box.width < v.videoWidth * MIN_FACE) {
          setMsg('Come a little closer');
        } else {
          const m = bestMatch(f.descriptor, faces);
          if (!m.staff_id) {
            who = null;
            live.reset();
            unknownSince = unknownSince || Date.now();
            setMsg(Date.now() - unknownSince > 4000
              ? (m.reason === 'unsure' ? 'Not sure who this is. Look straight at the camera in good light.' : 'Face not recognised. The owner can set up face check-in in Staff list, or mark the day by hand.')
              : 'Looking…');
          } else if (recent[m.staff_id] && Date.now() - recent[m.staff_id] < 20000) {
            setMsg(`Done, ${firstName(m.staff_id)}. Next person`);
          } else {
            unknownSince = 0;
            if (who !== m.staff_id) { who = m.staff_id; seen = 0; live.reset(); }
            seen += 1;
            const how = live.push(f.points);
            if (!how) setMsg(`${firstName(who)}: turn your head slowly left and right`);
            else if (seen >= 3) {
              paused = true;
              setPhase('busy');
              setMsg('Saving…');
              const shot = facePhoto(v, f.box);
              try {
                const r = await db.rpc('face_check_in', { p: { staff_id: who, distance: Math.round(m.distance * 1000) / 1000, live: true, photo: shot } });
                recent[who] = Date.now();
                finish({ ...r, photo: shot });
                if (onDone) onDone(r);
              } catch (e) {
                finish({ kind: 'error', text: e.message, photo: shot });
              }
              timer = setTimeout(() => tick(faces), 250);
              return;
            }
          }
        }
      }
      timer = setTimeout(() => tick(faces), 120);
    };

    (async () => {
      try {
        const [faces] = await Promise.all([db.list('staff_faces', {}), loadFace()]);
        const mine = faces.filter((f) => staff.some((s) => s.id === f.staff_id && s.active));
        if (!mine.length) throw new Error('No one has face check-in yet. The owner sets it up in Staff list: open a person, then Face check-in.');
        if (dead) return;
        stop = await openCamera(video.current);
        if (dead) { stop(); return; }
        setPhase('look');
        setMsg('Look at the camera');
        tick(mine);
      } catch (e) {
        if (!dead) { setErr(e.message); setPhase('error'); }
      }
    })();
    return () => {
      dead = true;
      clearTimeout(timer);
      if (stop) stop();
    };
  }, []);

  return (
    <Modal title="Face check-in" onClose={onClose} foot={<button className="btn line" onClick={onClose}>Close</button>}>
      <div className="face-cam">
        <video ref={video} playsInline muted autoPlay className={phase === 'error' ? 'hidden' : ''} />
        {phase === 'loading' && <div className="face-msg"><div className="spinner" /> {msg}</div>}
        {(phase === 'look' || phase === 'busy') && <div className="face-msg" role="status" aria-live="polite">{msg}</div>}
        {phase === 'result' && result && (
          <div className={'face-result ' + (result.kind === 'error' ? 'bad' : 'ok')} role="status" id="face-result">
            {result.photo && <img src={result.photo} alt="" />}
            {result.kind === 'in' && <><b>{result.name}</b><span>Checked in at {fmtTime(result.at)}</span></>}
            {result.kind === 'again' && <><b>{result.name}</b><span>Already checked in at {fmtTime(result.at)}. Scan again when you leave.</span></>}
            {result.kind === 'out' && <><b>{result.name}</b><span>Checked out at {fmtTime(result.at)} (in at {fmtTime(result.in_at)})</span></>}
            {result.kind === 'again_out' && <><b>{result.name}</b><span>Checked out at {fmtTime(result.at)}</span></>}
            {result.kind === 'error' && <><b>Not saved</b><span>{result.text}</span></>}
          </div>
        )}
        {phase === 'error' && <div className="face-error"><AlertTriangle size={20} /><p>{err}</p></div>}
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        One person at a time, face in the frame. Turn your head a little (or blink) so the app knows it is a real face, not a photo. The first scan of the day checks in; a scan 30 minutes or more later checks out.
      </p>
    </Modal>
  );
}

// ---------------- Leave ----------------
export function Leave({ onCounts }) {
  const { staff, toast, isOwner, askOwner, settings } = useApp();
  const today = istDay();
  const [rows, setRows] = useState(null);
  const [att, setAtt] = useState([]);
  const [err, setErr] = useState('');
  const [ask, setAsk] = useState(false);       // false, true, or the first day picked on the calendar
  const [cancel, setCancel] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try {
      setErr('');
      const [r, a] = await Promise.all([
        db.list('leave_requests', { gte: { to_day: addDays(today, -60) }, order: ['from_day', 'asc'] }),
        db.list('attendance', { gte: { day: addDays(today, -62) }, lte: { day: addDays(today, 190) } }),
      ]);
      setRows(r);
      setAtt(a);
      if (onCounts) onCounts({ leave: r.filter((x) => x.status === 'pending' && x.to_day >= today).length });
    } catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const person = (id) => staff.find((s) => s.id === id) || { name: 'Staff' };
  const decide = async (l, approve) => {
    if (!(await askOwner('Approving leave is for the owner. They can also tap Approve on Telegram.'))) return;
    setBusy(l.id);
    try {
      await db.rpc('decide_leave', { p_id: l.id, p_approve: approve });
      // starts within a week: the planning message (bookings to move, who else is off) goes to Telegram now
      if (approve) db.notify('leave_plan', l.id);
      toast(approve ? `Leave approved for ${person(l.staff_id).name}` : 'Leave refused');
      await load();
    } catch (e) { toast(e.message, 'bad'); }
    setBusy('');
  };
  const doCancel = async (l) => {
    if (l.status === 'approved' && !(await askOwner('Cancelling approved leave is for the owner.'))) return;
    try {
      await db.update('leave_requests', l.id, { status: 'cancelled' });
      toast('Leave cancelled');
      setCancel(null);
      await load();
    } catch (e) { toast(e.message, 'bad'); }
  };

  if (err) return <div className="card"><Empty title="Leave could not load">{err}</Empty></div>;
  if (!rows) return <Loading />;
  const pending = rows.filter((l) => l.status === 'pending' && l.to_day >= today);
  const coming = rows.filter((l) => l.status === 'approved' && l.to_day >= today);
  const past = rows.filter((l) => !pending.includes(l) && !coming.includes(l)).reverse();
  const paidOffs = paidOffsOf(settings);
  const rules = leaveRules(settings);
  const first = (id) => person(id).name.split(' ')[0];

  const card = (l, actions) => {
    const s = person(l.staff_id);
    const n = daysIn(l.from_day, l.to_day);
    const pv = l.status === 'pending' ? offsPreview({ staff: s, attendance: att, from: l.from_day, to: l.to_day, paidOffs }) : [];
    // medical leave skips the rules: the owner sees who else is off those days
    const also = l.status === 'pending' && l.kind === 'sick' ? othersOff({ staffId: l.staff_id, from: l.from_day, to: l.to_day, leaves: rows.filter((x) => x.id !== l.id), attendance: att, staff }) : [];
    // busy days (Fri, Sat, Sun): allowed only if the owner agrees
    const busyOn = l.status === 'pending' ? busyDays({ from: l.from_day, to: l.to_day, kind: l.kind, settings }) : [];
    const starts = l.from_day === today ? 'today' : l.from_day === addDays(today, 1) ? 'tomorrow' : l.from_day < today ? 'on now' : `in ${daysIn(today, l.from_day) - 1} days`;
    return (
      <div className="card leave-card" key={l.id} data-leave={s.name}>
        <div className="leave-main">
          <div className="row wrap" style={{ gap: 8 }}>
            <b>{s.name}</b>
            <span className={'pill ' + (l.status === 'approved' ? 'ok' : l.status === 'pending' ? 'warn' : '')}>{l.status === 'pending' ? 'Waiting' : l.status === 'approved' ? 'Approved' : l.status === 'rejected' ? 'Refused' : 'Cancelled'}</span>
            {l.status === 'approved' && l.to_day >= today && <span className="small muted">{starts}</span>}
          </div>
          <div>{leaveDays(l)} · {n} {n === 1 ? 'day' : 'days'} · {LEAVE_KIND[l.kind] || l.kind}</div>
          {l.reason && <div className="small muted">{l.reason}</div>}
          {pv.map((m) => (
            <div key={m.month} className={'small' + (m.newUnpaid > 0 ? ' warn-text' : ' muted')}>
              {fmtMonth(m.month)}: {m.used} {m.used === 1 ? 'day' : 'days'} off so far{m.adds ? ` + ${m.adds}` : ''} = {m.after} of {m.allowance} paid
              {m.newUnpaid > 0 ? ` → ${m.newUnpaid} unpaid` : ''}
            </div>
          ))}
          {also.length > 0 && <div className="small warn-text leave-also">Also off: {also.map((o) => `${o.name} (${ruleDay(o.day)})`).join(', ')}</div>}
          {busyOn.length > 0 && <div className="small warn-text leave-busy">{busyNote(busyOn, settings)}</div>}
          <div className="tiny muted">Asked {fmtDate(l.created_at, false)}{l.decided_by ? ` · ${l.status === 'approved' ? 'approved' : l.status === 'rejected' ? 'refused' : 'answered'} by ${l.decided_by}` : ''}</div>
        </div>
        <div className="appt-acts">{actions}</div>
      </div>
    );
  };
  const wa = (l, kind) => {
    const s = person(l.staff_id);
    return s.phone ? <a className="btn sm wa" target="_blank" rel="noreferrer" href={waLink(s.phone, leaveMessage(kind, l, s.name, settings))}><MessageCircle size={14} /> {kind === 'remind' ? 'Remind' : 'Tell'} {s.name.split(' ')[0]}</a> : null;
  };

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <p className="muted small" style={{ margin: 0 }}>Ask here at least a few days before. The owner gets it on Telegram with Approve / Deny.</p>
        <button className="btn primary" id="ask-leave" onClick={() => setAsk(true)}><CalendarPlus size={17} /> Ask for leave</button>
      </div>
      <section className="stack">
        <h3 className="sec-title">Waiting for the owner</h3>
        {pending.length === 0 ? <p className="muted small">No leave waiting.</p> : pending.map((l) => card(l, <>
          <button className="btn primary sm" disabled={busy === l.id} onClick={() => decide(l, true)}>{!isOwner && <Lock size={12} />} <Check size={14} /> Approve</button>
          <button className="btn line sm" disabled={busy === l.id} onClick={() => decide(l, false)}><X size={14} /> Refuse</button>
          <button className="btn line sm" onClick={() => setCancel(l)}>Cancel request</button>
        </>))}
      </section>
      <section className="stack">
        <h3 className="sec-title">Coming up</h3>
        {coming.length === 0 ? <p className="muted small">No approved leave coming up.</p> : coming.map((l) => card(l, <>
          {wa(l, l.from_day > today ? 'remind' : 'approved')}
          <button className="btn line sm" onClick={() => setCancel(l)}>{!isOwner && <Lock size={12} />} Cancel leave</button>
        </>))}
      </section>
      {past.length > 0 && (
        <section className="stack">
          <h3 className="sec-title">Last 60 days</h3>
          {past.map((l) => card(l, l.status === 'rejected' && l.to_day >= today ? wa(l, 'rejected') : null))}
        </section>
      )}
      <p className="muted small">Approved leave shows as L in attendance. Week offs and leave share {paidOffs} paid days off a month; more are unpaid.</p>
      {ask && <LeaveModal attendance={att} rows={rows} startDay={typeof ask === 'string' ? ask : null} onClose={() => setAsk(false)} onSaved={() => { setAsk(false); load(); }} />}
      {cancel && (
        <Confirm title={cancel.status === 'approved' ? 'Cancel this leave?' : 'Cancel this request?'} okLabel="Cancel it" danger onClose={() => setCancel(null)} onOk={() => doCancel(cancel)}
          text={`${person(cancel.staff_id).name}: ${leaveDays(cancel)}.${cancel.status === 'approved' ? ' The leave days come off attendance.' : ''}`} />
      )}
    </div>
  );
}

function LeaveModal({ attendance, rows, startDay, onClose, onSaved }) {
  const { staff, toast, settings } = useApp();
  const today = istDay();
  const active = staff.filter((s) => s.active);
  const [who, setWho] = useState('');
  const [from, setFrom] = useState(startDay || addDays(today, 1));
  const [to, setTo] = useState(startDay || addDays(today, 1));
  const [kind, setKind] = useState('planned');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const s = active.find((x) => x.id === who);
  const ok = from && to && to >= from;
  const pv = s && ok ? offsPreview({ staff: s, attendance, from, to, paidOffs: paidOffsOf(settings) }) : [];
  const overlap = s && ok ? rows.find((l) => l.staff_id === s.id && ['pending', 'approved'].includes(l.status) && l.from_day <= to && l.to_day >= from) : null;
  // the owner's rules (the database checks them again when it is sent)
  const rules = leaveRules(settings);
  const rule = s && ok && !overlap ? leaveRuleError({ staffId: s.id, from, to, kind, today, leaves: rows, attendance, staff, settings }) : null;
  const alsoOff = s && ok && kind === 'sick' ? othersOff({ staffId: s.id, from, to, leaves: rows, attendance, staff }) : [];
  const busyOn = ok ? busyDays({ from, to, kind, settings }) : [];
  const save = async () => {
    if (!s) return setErr('Choose who is asking.');
    if (!ok) return setErr('The last day is before the first.');
    setBusy(true);
    setErr('');
    try {
      const r = await db.rpc('request_leave', { p: { staff_id: s.id, from_day: from, to_day: to, kind, reason: reason.trim() } });
      db.notify('leave', r.id);
      toast('Leave asked. The owner will answer.');
      onSaved();
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };
  return (
    <Modal title="Ask for leave" onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" id="leave-send" disabled={busy || !!rule} onClick={save}>Send to the owner</button></>}>
      <div className="stack">
        <Field label="Who">
          <div className="chips">{active.map((x) => <button key={x.id} type="button" className={'chip sm' + (who === x.id ? ' on' : '')} onClick={() => setWho(x.id)}>{x.name}</button>)}</div>
        </Field>
        <div className="form-grid">
          <Field label="From"><input className="input" id="leave-from" type="date" value={from} min={addDays(today, -7)} onChange={(e) => { setFrom(e.target.value); if (!to || to < e.target.value) setTo(e.target.value); }} /></Field>
          <Field label="To (last day off)"><input className="input" id="leave-to" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} /></Field>
        </div>
        <Field label="Kind"><Seg full options={LEAVE_KINDS} value={kind} onChange={setKind} /></Field>
        <ul className="leave-rules tiny muted" id="leave-rules">
          {rules.blocked.length > 0 && <li>{blockedText(rules.blocked)} are busy days: leave then only if the owner agrees (medical leave is fine)</li>}
          {rules.oneAtATime && <li>One person off a day</li>}
          <li>2 or more days off in the last week of the month (from the 22nd): ask {rules.notice} days before</li>
          <li>{paidOffsOf(settings)} paid days off a month. Days off not taken are paid; they don't carry over to next month.</li>
        </ul>
        <Field label="Reason (optional)"><input className="input" id="leave-reason" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="e.g. sister's wedding" /></Field>
        {s && ok && (
          <div className="sub-card small" id="leave-preview">
            <b>{daysIn(from, to)} {daysIn(from, to) === 1 ? 'day' : 'days'}</b>
            {pv.map((m) => (
              <div key={m.month} className={m.newUnpaid > 0 ? 'warn-text' : ''}>
                {fmtMonth(m.month)}: {m.used} off so far{m.adds !== daysIn(from, to) || pv.length > 1 ? `, ${m.adds} more` : ''} → {m.after} of {m.allowance} paid days off
                {m.newUnpaid > 0 ? `. ${m.newUnpaid} ${m.newUnpaid === 1 ? 'day' : 'days'} unpaid.` : m.after < m.allowance ? `. ${m.allowance - m.after} left: paid as a working day if not taken.` : '.'}
              </div>
            ))}
            <div className="muted tiny">Week offs and leave share the paid days off. Week offs not marked yet are not counted.</div>
          </div>
        )}
        {overlap && <p className="warn-text small">There is already a request for {leaveDays(overlap)}.</p>}
        {rule && <p className="err-text small" id="leave-rule">{rule}</p>}
        {!rule && busyOn.length > 0 && <p className="warn-text small" id="leave-busy">{busyNote(busyOn, settings)} You can still send it; the owner decides.</p>}
        {alsoOff.length > 0 && <p className="warn-text small" id="leave-also-off">Medical leave can be asked. Also off: {alsoOff.map((o) => `${o.name} (${ruleDay(o.day)})`).join(', ')}. The owner will see this.</p>}
        {err && <p className="err-text">{err}</p>}
      </div>
    </Modal>
  );
}

