import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Phone, PhoneCall, MessageCircle, Pencil, ReceiptText, X, CalendarClock, MessageSquarePlus, Check, AlertTriangle, ClipboardPaste } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, istDay, addDays, uid, fmtDateTime } from '../lib/format';
import { Modal, Field, Seg, Empty, Loading, SearchBox, DateNav, Stat } from '../components/ui';
import {
  SOURCES, SOURCE_LABEL, STATUS_LABEL, ENQ_STATUS, CLOSE_REASONS, cleanPhone, bookingItem, durationOf, clashes,
  slotTime, slotDay, slotIso, timeOf, waLink, bookingMessage, enquiryMessage, billDraft, CALL_TIMES, callList, callOutcome,
} from '../lib/bookings';

const DRAFT_KEY = 'habibs-pos-draft';
const EMPTY_NEW = { name: '', gender: '', whatsapp_ok: false };
const firstName = (s) => String(s || '').split(' ')[0];
const fmtPhone = (p) => (p ? `${p.slice(0, 5)} ${p.slice(5)}` : '');
const STATUS_PILL = { requested: 'warn', confirmed: 'ok', came: '', no_show: 'bad', cancelled: '' };
const ENQ_PILL = { new: 'warn', replied: '', follow_up: 'warn', booked: 'ok', came: 'ok', closed: '' };
const hm = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
const openWa = (href) => { try { window.open(href, '_blank', 'noopener'); } catch { /* blocked */ } };

// Counts for the menu badge: booking requests and enquiries waiting
export async function appointmentCounts() {
  const today = istDay();
  const [req, enq] = await Promise.all([
    db.list('bookings', { eq: { status: 'requested' }, gte: { want_date: addDays(today, -1) } }),
    db.list('enquiries', { in: { status: ['new', 'follow_up'] } }),
  ]);
  return req.length + enq.filter((e) => e.status === 'new' || (e.follow_up_on && e.follow_up_on <= today)).length;
}

export default function Appointments({ onOpenBill, onCounts, startTab }) {
  const { staff, services, settings, toast } = useApp();
  const today = istDay();
  const [tab, setTab] = useState(startTab || 'day');
  const [day, setDay] = useState(today);
  const [who, setWho] = useState('');
  const [data, setData] = useState(null);
  const [edit, setEdit] = useState(null);     // booking being added / changed
  const [enq, setEnq] = useState(null);       // enquiry being added / changed
  const [bill, setBill] = useState(null);     // booking to start a bill from
  const [after, setAfter] = useState(null);   // { booking, kind }: offer the WhatsApp message after a change
  const [cancel, setCancel] = useState(null);
  const [showDone, setShowDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const [dayRows, req, enqs, leave] = await Promise.all([
        db.list('bookings', { eq: { want_date: day } }),
        db.list('bookings', { eq: { status: 'requested' }, gte: { want_date: addDays(today, -1) }, order: ['want_date', 'asc'] }),
        db.list('enquiries', { gte: { created_at: new Date(Date.now() - 45 * 86400000).toISOString() }, order: ['created_at', 'desc'] }),
        db.list('leave_requests', { eq: { status: 'approved' }, lte: { from_day: day }, gte: { to_day: day } }).catch(() => []),
      ]);
      const ids = [...new Set([...dayRows, ...req].map((b) => b.id))];
      const items = ids.length ? await db.list('booking_items', { in: { booking_id: ids } }) : [];
      setData({ day: dayRows, req, enqs, items, leave });
      if (onCounts) onCounts(req.length + enqs.filter((e) => e.status === 'new' || (e.status === 'follow_up' && e.follow_up_on && e.follow_up_on <= today)).length);
    } catch (e) {
      toast(e.message, 'bad');
      setData((d) => d || { day: [], req: [], enqs: [], items: [], leave: [] });
    }
  }, [day, today, toast, onCounts]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { const t = setInterval(load, 60000); return () => clearInterval(t); }, [load]);

  const itemsOf = (b) => (data ? data.items.filter((i) => i.booking_id === b.id) : []);
  const nameOf = (id) => (staff.find((s) => s.id === id) || {}).name || '';
  const send = async (b, kind) => {
    openWa(waLink(b.phone, bookingMessage(kind, b, itemsOf(b), settings, rupee)));
    const patch = kind === 'confirm' ? { confirm_sent_at: new Date().toISOString() } : kind === 'remind' ? { reminded_at: new Date().toISOString() } : null;
    if (patch) { try { await db.update('bookings', b.id, patch); } catch { /* still sent */ } load(); }
  };
  const setStatus = async (b, status, extra = {}) => {
    try {
      await db.update('bookings', b.id, { status, ...extra });
      toast(STATUS_LABEL[status], 'ok');
      load();
      if (status === 'no_show' || status === 'cancelled') setAfter({ booking: { ...b, status }, kind: status === 'no_show' ? 'no_show' : 'cancel' });
    } catch (e) { toast(e.message, 'bad'); }
  };

  const dayList = useMemo(() => {
    if (!data) return [];
    return data.day.filter((b) => !who || b.staff_id === who)
      .sort((a, b) => (a.status === 'cancelled') - (b.status === 'cancelled') || String(a.slot_at || '~' + (a.want_time || '')).localeCompare(String(b.slot_at || '~' + (b.want_time || ''))));
  }, [data, who]);
  const openEnq = data ? data.enqs.filter((e) => ['new', 'replied', 'follow_up'].includes(e.status)) : [];
  const doneEnq = data ? data.enqs.filter((e) => !['new', 'replied', 'follow_up'].includes(e.status)) : [];
  const dueEnq = openEnq.filter((e) => e.status === 'new' || (e.follow_up_on && e.follow_up_on <= today));
  const calls = useMemo(() => callList(data ? data.enqs : [], today), [data, today]);
  const stats = useMemo(() => {
    if (!data) return null;
    const live = data.day.filter((b) => b.status !== 'cancelled');
    return { total: live.length, came: live.filter((b) => b.status === 'came').length, noShow: live.filter((b) => b.status === 'no_show').length, toConfirm: live.filter((b) => b.status === 'requested').length };
  }, [data]);

  const startBill = (b) => setBill({ booking: b, items: itemsOf(b) });

  return (
    <div className="page">
      <div className="page-head row between wrap">
        <h1>Bookings</h1>
        <div className="row wrap">
          <button className="btn line sm" id="call-enquiry" onClick={() => setEnq({ source: 'phone', follow_up_on: today })}><PhoneCall size={15} /> Call enquiry</button>
          <button className="btn line sm" onClick={() => setEnq({})}><MessageSquarePlus size={15} /> New enquiry</button>
          <button className="btn primary sm" onClick={() => setEdit({ want_date: tab === 'day' ? day : today })}><Plus size={15} /> New booking</button>
        </div>
      </div>
      <div className="tabs">
        <button className={tab === 'day' ? 'on' : ''} onClick={() => setTab('day')}>Day</button>
        <button className={tab === 'req' ? 'on' : ''} onClick={() => setTab('req')}>Requests{data && data.req.length ? <span className="count">{data.req.length}</span> : null}</button>
        <button className={tab === 'enq' ? 'on' : ''} onClick={() => setTab('enq')}>Enquiries{dueEnq.length ? <span className="count">{dueEnq.length}</span> : null}</button>
        <button className={tab === 'call' ? 'on' : ''} id="tab-call" onClick={() => setTab('call')}>Call back{calls.due.length ? <span className="count">{calls.due.length}</span> : null}</button>
      </div>
      {!data ? <Loading /> : tab === 'day' ? (
        <div className="stack loose">
          <div className="row between wrap">
            <DateNav day={day} onChange={setDay} max={addDays(today, 180)} />
            <div className="chips scroll">
              <button className={'chip sm' + (!who ? ' on' : '')} onClick={() => setWho('')}>Everyone</button>
              {staff.filter((s) => s.active).map((s) => <button key={s.id} className={'chip sm' + (who === s.id ? ' on' : '')} onClick={() => setWho(s.id)}>{firstName(s.name)}</button>)}
            </div>
          </div>
          {stats && (
            <div className="stats four">
              <Stat k="Booked" v={stats.total} s={day === today ? 'Today' : slotDay(day)} />
              <Stat k="To confirm" v={stats.toConfirm} s="Requests for this day" accent={stats.toConfirm > 0} />
              <Stat k="Came" v={stats.came} s="Billed" />
              <Stat k="No-show" v={stats.noShow} s="Didn't come" />
            </div>
          )}
          {data.leave && data.leave.length > 0 && (() => {
            const off = [...new Set(data.leave.map((l) => l.staff_id))];
            const hit = data.day.filter((b) => off.includes(b.staff_id) && ['requested', 'confirmed'].includes(b.status));
            return (
              <div className={'notice' + (hit.length ? ' warn' : '')} id="leave-note">
                On leave: <b>{off.map(nameOf).filter(Boolean).join(', ')}</b>
                {hit.length > 0 && <> · {hit.length} {hit.length === 1 ? 'booking is' : 'bookings are'} with them: {hit.map((b) => b.name).join(', ')}. Change the stylist.</>}
              </div>
            );
          })()}
          {dayList.length === 0 ? (
            <div className="card"><Empty title="No bookings for this day">Add WhatsApp, phone and walk-in bookings with <b>New booking</b>. Website bookings come in by themselves.</Empty></div>
          ) : (
            <div className="appt-list">
              {dayList.map((b) => (
                <BookingCard key={b.id} b={b} items={itemsOf(b)} staffName={nameOf(b.staff_id) + ((data.leave || []).some((l) => l.staff_id === b.staff_id) ? ' (on leave)' : '')} all={data.day}
                  onEdit={() => setEdit(b)} onBill={() => startBill(b)} onSend={(k) => send(b, k)}
                  onNoShow={() => setStatus(b, 'no_show')} onCancel={() => setCancel(b)} onCame={() => setStatus(b, 'came')} />
              ))}
            </div>
          )}
        </div>
      ) : tab === 'req' ? (
        <div className="stack loose">
          <p className="small muted">Booking requests from the website and Instagram, and ones taken without a time. Call or WhatsApp them, then <b>Confirm</b> with a time and stylist.</p>
          {data.req.length === 0 ? <div className="card"><Empty title="No requests waiting" /></div> : (
            <div className="appt-list">
              {data.req.map((b) => (
                <BookingCard key={b.id} b={b} items={itemsOf(b)} staffName={nameOf(b.staff_id)} all={[]} showDay
                  onEdit={() => setEdit(b)} onBill={() => startBill(b)} onSend={(k) => send(b, k)}
                  onNoShow={() => setStatus(b, 'no_show')} onCancel={() => setCancel(b)} onCame={() => setStatus(b, 'came')} />
              ))}
            </div>
          )}
        </div>
      ) : tab === 'call' ? (
        <div className="stack loose" id="call-back">
          <p className="small muted">People to phone: someone who called and asked (<b>Call enquiry</b>), and any enquiry with a day to follow up. Tap <b>Call</b>, then say how it went: it comes back on the right day by itself.</p>
          <div className="eyebrow">To call today{calls.due.length ? ` (${calls.due.length})` : ''}</div>
          {calls.due.length === 0 ? <div className="card"><Empty title="Nobody to call today">Add one with <b>Call enquiry</b> when someone phones and asks.</Empty></div> : (
            <div className="appt-list">
              {calls.due.map((e) => <CallCard key={e.id} e={e} onChanged={load} onEdit={() => setEnq(e)}
                onBook={() => setEdit({ enquiry: e, phone: e.phone, name: e.name, source: e.source, want_date: today, items: (e.service_ids || []).map((id) => ({ service_id: id })) })} />)}
            </div>
          )}
          {calls.later.length > 0 && (
            <>
              <div className="eyebrow">Later</div>
              <div className="appt-list">
                {calls.later.map((e) => <CallCard key={e.id} e={e} later onChanged={load} onEdit={() => setEnq(e)}
                  onBook={() => setEdit({ enquiry: e, phone: e.phone, name: e.name, source: e.source, want_date: today, items: (e.service_ids || []).map((id) => ({ service_id: id })) })} />)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="stack loose">
          <p className="small muted">Questions from WhatsApp, calls, Instagram and the website. Reply, book, or set a day to follow up. Someone who comes in and is billed within 30 days is marked <b>Came</b> by itself.</p>
          {openEnq.length === 0 ? <div className="card"><Empty title="No open enquiries">Add one with <b>New enquiry</b> when someone asks on WhatsApp or calls.</Empty></div> : (
            <div className="appt-list">
              {[...openEnq].sort((a, b) => (dueEnq.includes(b) ? 1 : 0) - (dueEnq.includes(a) ? 1 : 0)).map((e) => (
                <EnquiryCard key={e.id} e={e} due={dueEnq.includes(e)} onEdit={() => setEnq(e)}
                  onBook={() => setEdit({ enquiry: e, phone: e.phone, name: e.name, source: e.source, want_date: today, items: (e.service_ids || []).map((id) => ({ service_id: id })) })}
                  onChanged={load} />
              ))}
            </div>
          )}
          <button className="link small" onClick={() => setShowDone((x) => !x)}>{showDone ? 'Hide' : 'Show'} booked, came and closed ({doneEnq.length})</button>
          {showDone && doneEnq.length > 0 && (
            <div className="appt-list">{doneEnq.map((e) => <EnquiryCard key={e.id} e={e} onEdit={() => setEnq(e)} onChanged={load} done />)}</div>
          )}
        </div>
      )}
      {edit && (
        <BookingModal booking={edit} onClose={() => setEdit(null)}
          onSaved={(b, wasNew) => {
            setEdit(null);
            if (b.want_date !== day && tab === 'day') setDay(b.want_date);
            load();
            if (b.status === 'confirmed' && !b.confirm_sent_at) setAfter({ booking: b, kind: 'confirm', isNew: wasNew });
          }} />
      )}
      {enq && <EnquiryModal enquiry={enq} onClose={() => setEnq(null)} onSaved={(r) => { setEnq(null); setTab(r && (r.source === 'phone' || r.follow) ? 'call' : 'enq'); load(); }} />}
      {bill && <StartBillModal booking={bill.booking} items={bill.items} onClose={() => setBill(null)} onOpen={() => { setBill(null); onOpenBill(); }} />}
      {cancel && <CancelModal booking={cancel} onClose={() => setCancel(null)} onDone={(reason) => { const b = cancel; setCancel(null); setStatus(b, 'cancelled', { cancel_reason: reason }); }} />}
      {after && (
        <Modal title="Send it on WhatsApp?" onClose={() => setAfter(null)}
          foot={<><button className="btn line" onClick={() => setAfter(null)}>Not now</button>
            <button className="btn primary" onClick={async () => { const a = after; setAfter(null); await send(a.booking, a.kind); }}><MessageCircle size={16} /> Open WhatsApp</button></>}>
          <p className="small">{after.kind === 'confirm' ? `Send ${firstName(after.booking.name)} the confirmation for ${slotDay(after.booking.want_date)}, ${after.booking.slot_at ? slotTime(after.booking.slot_at) : ''}?`
            : after.kind === 'cancel' ? `Tell ${firstName(after.booking.name)} it is cancelled?` : `Ask ${firstName(after.booking.name)} for a new time?`}</p>
          <p className="tiny muted">WhatsApp opens with the message typed; tap Send there.</p>
        </Modal>
      )}
    </div>
  );
}

function BookingCard({ b, items, staffName, all, showDay, onEdit, onBill, onSend, onNoShow, onCancel, onCame }) {
  const [more, setMore] = useState(false);
  const moreRef = useRef(null);
  // close the More menu on a tap anywhere else
  useEffect(() => {
    if (!more) return undefined;
    const off = (e) => { if (moreRef.current && !moreRef.current.contains(e.target)) setMore(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [more]);
  const total = items.reduce((a, i) => a + (Number(i.price) || 0), 0);
  const clash = clashes(b, all);
  const live = ['requested', 'confirmed'].includes(b.status);
  const today = istDay();
  const soon = b.want_date === today || b.want_date === addDays(today, 1);
  return (
    <div className={'appt card' + (b.status === 'cancelled' ? ' faded' : '')}>
      <div className="appt-time">
        <b>{b.slot_at ? slotTime(b.slot_at) : b.want_time || 'Any time'}</b>
        {showDay && <span className="tiny muted">{slotDay(b.want_date)}</span>}
        {b.duration_min && <span className="tiny muted">~{hm(b.duration_min)}</span>}
      </div>
      <div className="appt-main">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="strong">{b.name}</span>
          <a className="tiny muted" href={'tel:+91' + b.phone}>{fmtPhone(b.phone)}</a>
          <span className={'pill ' + (STATUS_PILL[b.status] || '')}>{STATUS_LABEL[b.status]}</span>
          <span className="pill">{SOURCE_LABEL[b.source] || b.source}</span>
        </div>
        <div className="small">{items.map((i) => `${i.name}${i.option_label ? ` (${i.option_label})` : ''}`).join(', ') || 'No services'}{total ? <span className="muted"> · {items.some((i) => i.price_from) ? 'from ' : ''}{rupee(total)}</span> : null}</div>
        <div className="tiny muted">{[staffName ? 'With ' + firstName(staffName) : 'No stylist yet', b.note, b.status === 'cancelled' && b.cancel_reason ? 'Cancelled: ' + b.cancel_reason : '',
          b.status === 'confirmed' ? (b.confirm_sent_at ? 'confirmation sent' : 'confirmation not sent') : '', b.reminded_at ? 'reminder sent' : ''].filter(Boolean).join(' · ')}</div>
        {clash.length > 0 && <div className="tiny" style={{ color: 'var(--warn)' }}><AlertTriangle size={12} /> {firstName(staffName)} also has {clash.map((c) => `${c.name} at ${slotTime(c.slot_at)}`).join(', ')}</div>}
      </div>
      <div className="appt-acts">
        {live && b.status === 'requested' && <button className="btn primary sm" onClick={onEdit}><Check size={15} /> Confirm</button>}
        {live && b.status === 'confirmed' && b.want_date <= today && <button className="btn primary sm" onClick={onBill}><ReceiptText size={15} /> Start bill</button>}
        {live && b.status === 'confirmed' && !b.confirm_sent_at && <button className="btn sm wa" onClick={() => onSend('confirm')}><MessageCircle size={15} /> Send confirmation</button>}
        {live && b.status === 'confirmed' && b.confirm_sent_at && soon && !b.reminded_at && b.want_date >= today && <button className="btn sm wa" onClick={() => onSend('remind')}><MessageCircle size={15} /> Send reminder</button>}
        {live && b.status === 'requested' && <a className="btn sm wa" href={waLink(b.phone, `Hi ${firstName(b.name)}, this is Habibs about your booking request for ${slotDay(b.want_date)}${b.want_time ? ' (' + b.want_time + ')' : ''}. What time suits you?`)} target="_blank" rel="noreferrer"><MessageCircle size={15} /> WhatsApp</a>}
        {live && <button className="icon-btn plain sm" aria-label="Change" onClick={onEdit}><Pencil size={15} /></button>}
        {live && (
          <span className="more" ref={moreRef}>
            <button className="btn ghost sm" onClick={() => setMore((x) => !x)}>More</button>
            {more && (
              <span className="more-menu">
                <button onClick={() => { setMore(false); onCame(); }}>Came (billed another way)</button>
                <button onClick={() => { setMore(false); onNoShow(); }}>No-show</button>
                <button onClick={() => { setMore(false); onCancel(); }}>Cancel booking</button>
                <a href={'tel:+91' + b.phone}><Phone size={14} /> Call</a>
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}

// Pick services for a booking: search, then the option (hair length) and thick hair if the service has them
function ServicePicker({ items, setItems }) {
  const { services } = useApp();
  const [q, setQ] = useState('');
  const [pick, setPick] = useState(null);
  const [opt, setOpt] = useState('');
  const [extra, setExtra] = useState('');
  const active = services.filter((s) => s.active);
  const found = q.trim().length >= 2 ? active.filter((s) => (s.name + ' ' + s.category).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const byId = Object.fromEntries(services.map((s) => [s.id, s]));
  const labels = pick && Array.isArray(pick.variants) ? pick.variants.map((v) => v.label).filter(Boolean) : [];
  const choices = pick && pick.extra_options && Array.isArray(pick.extra_options.choices) ? pick.extra_options.choices : [];
  const add = (s, o, e) => { setItems([...items, { service_id: s.id, option: o || '', extra: e || '' }]); setPick(null); setQ(''); setOpt(''); setExtra(''); };
  const choose = (s) => {
    const ls = Array.isArray(s.variants) ? s.variants.map((v) => v.label).filter(Boolean) : [];
    if (!ls.length && !(s.extra_options && s.extra_options.choices)) return add(s);
    setPick(s);
  };
  return (
    <div className="stack tight">
      {items.length > 0 && (
        <div className="picked">
          {items.map((it, i) => {
            const s = byId[it.service_id];
            const line = s ? bookingItem(s, it.option, it.extra) : null;
            return (
              <span key={i} className="picked-item">
                {s ? s.name : 'Service removed'}{line && line.option_label ? ` (${line.option_label})` : ''}
                {line && <span className="muted"> {line.price_from ? 'from ' : ''}{rupee(line.price)}</span>}
                <button aria-label="Remove" onClick={() => setItems(items.filter((_, j) => j !== i))}><X size={13} /></button>
              </span>
            );
          })}
        </div>
      )}
      {!pick ? (
        <>
          <SearchBox value={q} onChange={setQ} placeholder="Add a service: type 2 letters, e.g. kera, facial" />
          {found.length > 0 && <div className="chips">{found.map((s) => <button key={s.id} className="chip sm" onClick={() => choose(s)}>{s.name}</button>)}</div>}
        </>
      ) : (
        <div className="sub-card stack tight">
          <b className="small">{pick.name}</b>
          {labels.length > 0 && <div className="chips">{labels.map((l) => <button key={l} className={'chip sm' + (opt === l ? ' on' : '')} onClick={() => setOpt(l)}>{l}</button>)}<button className={'chip sm' + (!opt ? ' on' : '')} onClick={() => setOpt('')}>Not sure</button></div>}
          {choices.length > 0 && <Seg options={[['', 'Normal'], ...choices.map((c) => [c.label, `${c.label} +${rupee(c.price)}`])]} value={extra} onChange={setExtra} />}
          <div className="row"><button className="btn line sm" onClick={() => setPick(null)}>Back</button><button className="btn primary sm" onClick={() => add(pick, opt, extra)}>Add</button></div>
        </div>
      )}
    </div>
  );
}

const splitOption = (s, label) => {
  const parts = String(label || '').split(' · ').filter(Boolean);
  const labels = s && Array.isArray(s.variants) ? s.variants.map((v) => v.label) : [];
  const ex = s && s.extra_options && s.extra_options.choices ? s.extra_options.choices.map((c) => c.label) : [];
  return { option: parts.find((x) => labels.includes(x)) || '', extra: parts.find((x) => ex.includes(x)) || '' };
};

function BookingModal({ booking, onClose, onSaved }) {
  const { staff, services, toast } = useApp();
  const isNew = !booking.id;
  const today = istDay();
  const [phone, setPhone] = useState(booking.phone ? fmtPhone(booking.phone) : '');
  const [name, setName] = useState(booking.name || '');
  const [source, setSource] = useState(booking.source || 'whatsapp');
  const [date, setDate] = useState(booking.want_date || today);
  const [time, setTime] = useState(booking.slot_at ? timeOf(booking.slot_at) : '');
  const [who, setWho] = useState(booking.staff_id || '');
  const [note, setNote] = useState(booking.note || '');
  const [items, setItems] = useState(booking.items || []);
  const [known, setKnown] = useState(null);
  const [dayRows, setDayRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const loadedItems = useRef(false);

  // the booked services of an existing booking
  useEffect(() => {
    if (isNew || loadedItems.current) return;
    loadedItems.current = true;
    db.list('booking_items', { eq: { booking_id: booking.id } }).then((rows) => setItems(rows.map((r) => {
      const s = services.find((x) => x.id === r.service_id);
      return { service_id: r.service_id, ...splitOption(s, r.option_label) };
    }))).catch(() => {});
  }, [isNew, booking.id, services]);
  // a customer we know: fill the name
  const p10 = cleanPhone(phone);
  useEffect(() => {
    if (!p10) { setKnown(null); return; }
    db.list('customers', { eq: { phone: p10 }, limit: 1 }).then((r) => { setKnown(r[0] || null); if (r[0] && !name.trim()) setName(r[0].name || ''); }).catch(() => {});
  }, [p10]);
  useEffect(() => { db.list('bookings', { eq: { want_date: date } }).then(setDayRows).catch(() => setDayRows([])); }, [date]);
  const [offIds, setOffIds] = useState([]);
  useEffect(() => {
    if (!date) return;
    db.list('leave_requests', { eq: { status: 'approved' }, lte: { from_day: date }, gte: { to_day: date } }).then((r) => setOffIds(r.map((l) => l.staff_id))).catch(() => setOffIds([]));
  }, [date]);

  const dur = durationOf(items, services);
  const slot = time ? slotIso(date, time) : null;
  const clash = clashes({ id: booking.id, staff_id: who, slot_at: slot, duration_min: dur }, dayRows);
  const people = staff.filter((s) => s.active);

  const save = async () => {
    setErr('');
    if (!p10) return setErr('Enter a 10-digit mobile number.');
    if (name.trim().length < 2) return setErr('Enter the name.');
    if (!items.length) return setErr('Add at least one service.');
    setBusy(true);
    try {
      const b = await db.rpc('save_booking', { p: {
        id: booking.id || undefined, phone: p10, name: name.trim(), source, date, slot_at: slot, time: booking.want_time || '',
        staff_id: who || null, note: note.trim(), items, enquiry_id: booking.enquiry ? booking.enquiry.id : undefined,
        status: booking.status && !['requested', 'confirmed'].includes(booking.status) ? booking.status : undefined,
      } });
      toast(b.status === 'confirmed' ? `Booked: ${slotDay(b.want_date)}, ${slotTime(b.slot_at)}` : 'Saved as a request (no time yet)', 'ok');
      onSaved(b, isNew);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal wide title={isNew ? (booking.enquiry ? `Book: ${booking.enquiry.name || fmtPhone(booking.enquiry.phone)}` : 'New booking') : booking.status === 'requested' ? `Confirm: ${booking.name}` : `Booking: ${booking.name}`} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>{time ? 'Book' : 'Save request'}</button></>}>
      <div className="form-grid">
        <Field label="Mobile number" hint={known ? `Known customer · ${known.visits || 0} visits` : p10 ? 'New customer' : ''}>
          <input className="input" id="bk-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98300 12345" />
        </Field>
        <Field label="Name"><input className="input" id="bk-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Booked by" className="span2">
          {booking.source === 'website' ? <span className="pill">Website{booking.utm && booking.utm.campaign ? ` · ${booking.utm.campaign}` : ''}</span> : (
            <div className="chips">{SOURCES.filter(([k]) => k !== 'website').map(([k, l]) => <button key={k} className={'chip sm' + (source === k ? ' on' : '')} onClick={() => setSource(k)}>{l}</button>)}</div>
          )}
        </Field>
        <Field label="Services" className="span2" hint={items.length ? `About ${hm(dur)}` : ''}><ServicePicker items={items} setItems={setItems} /></Field>
        <Field label="Day"><input className="input" id="bk-date" type="date" value={date} min={isNew ? today : undefined} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Time" hint={booking.want_time && !booking.slot_at ? `They asked for: ${booking.want_time}` : 'Leave empty to keep it as a request'}>
          <input className="input" id="bk-time" type="time" step="900" value={time} onChange={(e) => setTime(e.target.value)} />
        </Field>
        <Field label="Stylist" className="span2">
          <div className="chips">
            <button className={'chip sm' + (!who ? ' on' : '')} onClick={() => setWho('')}>Any</button>
            {people.map((s) => <button key={s.id} className={'chip sm red' + (who === s.id ? ' on' : '')} onClick={() => setWho(s.id)}>{firstName(s.name)}{offIds.includes(s.id) ? ' · leave' : ''}</button>)}
          </div>
        </Field>
        {who && offIds.includes(who) && <p className="small span2" id="bk-leave" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> {firstName((people.find((s) => s.id === who) || {}).name)} is on approved leave that day. Choose another stylist.</p>}
        {clash.length > 0 && <p className="small span2" style={{ color: 'var(--warn)' }}><AlertTriangle size={14} /> {firstName((people.find((s) => s.id === who) || {}).name)} already has {clash.map((c) => `${c.name} at ${slotTime(c.slot_at)}`).join(', ')} then.</p>}
        <Field label="Note" className="span2"><input className="input" id="bk-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. wants Amit only, coming with her sister" /></Field>
      </div>
      {err && <p className="err-text" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

// Start the bill from a booking: the services done (choose the hair length if it wasn't known), then the normal bill
function StartBillModal({ booking, items, onClose, onOpen }) {
  const { services, staff, toast } = useApp();
  const [rows, setRows] = useState(() => items.map((i) => {
    const s = services.find((x) => x.id === i.service_id);
    return { ...i, s, on: !!s, ...splitOption(s, i.option_label) };
  }));
  const [who, setWho] = useState(booking.staff_id || '');
  const [err, setErr] = useState('');
  const set = (k, patch) => setRows((rs) => rs.map((r, j) => (j === k ? { ...r, ...patch } : r)));
  const open = () => {
    const chosen = rows.filter((r) => r.on && r.s);
    if (!chosen.length) return setErr('Tick at least one service.');
    const missing = chosen.find((r) => Array.isArray(r.s.variants) && r.s.variants.some((v) => v.label) && !r.option);
    if (missing) return setErr(`Choose the option for ${missing.s.name}.`);
    const lines = chosen.map((r) => {
      const it = bookingItem(r.s, r.option, r.extra);
      return { key: uid(), qty: 1, staff_id: who || '', item_type: 'service', service_id: r.s.id, category: r.s.category, hsn_sac: r.s.sac || '',
        name: r.s.name + (it.option_label ? ` (${it.option_label})` : ''), unit_price: it.price, gst_pct: Number(r.s.gst_pct) || 0 };
    });
    try {
      const cur = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
      if (cur.lines && cur.lines.length && !window.confirm('A bill is already being made on the New bill screen. Replace it with this booking?')) return;
      localStorage.setItem(DRAFT_KEY, JSON.stringify(billDraft(booking, lines, EMPTY_NEW)));
    } catch { return toast('Could not open the bill here', 'bad'); }
    onOpen();
  };
  return (
    <Modal title={'Start bill: ' + booking.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" onClick={open}><ReceiptText size={16} /> Open bill</button></>}>
      <div className="stack">
        <p className="small muted">The bill opens with {firstName(booking.name)}'s number and these services. Add or change anything there as usual. When it's saved, this booking is marked <b>Came</b>.</p>
        {rows.map((r, k) => {
          const labels = r.s && Array.isArray(r.s.variants) ? r.s.variants.map((v) => v.label).filter(Boolean) : [];
          const choices = r.s && r.s.extra_options && Array.isArray(r.s.extra_options.choices) ? r.s.extra_options.choices : [];
          return (
            <div key={k} className="sub-card stack tight">
              <label className="check"><input type="checkbox" checked={r.on} disabled={!r.s} onChange={(e) => set(k, { on: e.target.checked })} /> <span className="grow">{r.name}</span>
                {r.s && <span className="small muted">{rupee(bookingItem(r.s, r.option, r.extra).price)}</span>}</label>
              {r.on && labels.length > 0 && <div className="chips">{labels.map((l) => <button key={l} className={'chip sm' + (r.option === l ? ' on' : '')} onClick={() => set(k, { option: l })}>{l}</button>)}</div>}
              {r.on && choices.length > 0 && <Seg options={[['', 'Normal'], ...choices.map((c) => [c.label, c.label])]} value={r.extra} onChange={(v) => set(k, { extra: v })} />}
            </div>
          );
        })}
        <Field label="Done by">
          <div className="chips">{staff.filter((s) => s.active).map((s) => <button key={s.id} className={'chip sm red' + (who === s.id ? ' on' : '')} onClick={() => setWho(s.id)}>{firstName(s.name)}</button>)}</div>
        </Field>
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function CancelModal({ booking, onClose, onDone }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={'Cancel: ' + booking.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn danger" onClick={() => onDone(reason.trim())}>Cancel booking</button></>}>
      <Field label="Why"><div className="chips">{['Customer cancelled', 'Salon busy', 'Stylist on leave', 'Wrong booking'].map((r) => <button key={r} className={'chip sm' + (reason === r ? ' on' : '')} onClick={() => setReason(r)}>{r}</button>)}</div>
        <input className="input" style={{ marginTop: 8 }} id="cn-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Or type it" /></Field>
    </Modal>
  );
}

function EnquiryCard({ e, due, done, onEdit, onBook, onChanged }) {
  const { services, settings, toast } = useApp();
  const [follow, setFollow] = useState(false);
  const [close, setClose] = useState(false);
  const asked = services.filter((s) => (e.service_ids || []).includes(s.id));
  const upd = async (patch, msg) => { try { await db.update('enquiries', e.id, patch); if (msg) toast(msg, 'ok'); onChanged(); } catch (x) { toast(x.message, 'bad'); } };
  const reply = () => { openWa(waLink(e.phone, enquiryMessage(e, services, settings, rupee))); if (e.status === 'new') upd({ status: 'replied' }); };
  const today = istDay();
  return (
    <div className={'appt card' + (done ? ' faded' : '')}>
      <div className="appt-time"><b>{SOURCE_LABEL[e.source] || e.source}</b><span className="tiny muted">{fmtDateTime(e.created_at)}</span></div>
      <div className="appt-main">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="strong">{e.name || 'No name'}</span>
          <a className="tiny muted" href={'tel:+91' + e.phone}>{fmtPhone(e.phone)}</a>
          <span className={'pill ' + (ENQ_PILL[e.status] || '')}>{ENQ_STATUS[e.status]}{e.status === 'follow_up' && e.follow_up_on ? ` ${e.follow_up_on <= today ? 'today' : slotDay(e.follow_up_on)}` : ''}</span>
          {due && e.status === 'follow_up' && <span className="pill warn">Due</span>}
        </div>
        {e.message && <div className="small">"{e.message}"</div>}
        {asked.length > 0 && <div className="tiny muted">About: {asked.map((s) => s.name).join(', ')}</div>}
        {e.close_reason && <div className="tiny muted">Closed: {e.close_reason}</div>}
        {follow && (
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {[[1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']].map(([d, l]) => <button key={d} className="chip sm" onClick={() => { setFollow(false); upd({ status: 'follow_up', follow_up_on: addDays(today, d) }, 'Follow-up set'); }}>{l}</button>)}
          </div>
        )}
        {close && (
          <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
            {CLOSE_REASONS.map((r) => <button key={r} className="chip sm" onClick={() => { setClose(false); upd({ status: 'closed', close_reason: r }, 'Closed'); }}>{r}</button>)}
          </div>
        )}
      </div>
      {!done && (
        <div className="appt-acts">
          <button className="btn primary sm" onClick={onBook}><CalendarClock size={15} /> Book</button>
          <button className="btn sm wa" onClick={reply}><MessageCircle size={15} /> Reply{asked.length ? ' with prices' : ''}</button>
          <button className="btn ghost sm" onClick={() => { setClose(false); setFollow((x) => !x); }}>Follow up</button>
          <button className="btn ghost sm" onClick={() => { setFollow(false); setClose((x) => !x); }}>Close</button>
          <button className="icon-btn plain sm" aria-label="Change" onClick={onEdit}><Pencil size={15} /></button>
        </div>
      )}
    </div>
  );
}

// One person to phone back: what they asked, when to call, how the last calls went; after a call, say how it went
function CallCard({ e, later, onEdit, onBook, onChanged }) {
  const { services, toast } = useApp();
  const [open, setOpen] = useState(false);   // the "how did it go?" buttons (after tapping Call)
  const [more, setMore] = useState('');      // 'again' | 'close'
  const [note, setNote] = useState('');
  const today = istDay();
  const asked = services.filter((s) => (e.service_ids || []).includes(s.id));
  const done = async (kind, o = {}) => {
    try {
      await db.update('enquiries', e.id, callOutcome(e, kind, { today, note, ...o }));
      toast(kind === 'no_answer' ? 'No answer: on the list again tomorrow' : kind === 'again' ? 'Call again set' : kind === 'closed' ? 'Closed' : 'Saved', 'ok');
      setOpen(false); setMore(''); setNote('');
      if (kind === 'booked') onBook(); else onChanged();
    } catch (x) { toast(x.message, 'bad'); }
  };
  const when = e.follow_up_on ? (e.follow_up_on < today ? `was due ${slotDay(e.follow_up_on)}` : e.follow_up_on === today ? 'today' : slotDay(e.follow_up_on)) : 'today';
  return (
    <div className={'appt card' + (later ? ' faded' : '')} data-call={e.phone}>
      <div className="appt-time"><b>{when}</b><span className="tiny muted">{e.call_time || SOURCE_LABEL[e.source] || ''}</span></div>
      <div className="appt-main">
        <div className="row wrap" style={{ gap: 8 }}>
          <span className="strong">{e.name || 'No name'}</span>
          <a className="strong" href={'tel:+91' + e.phone}>{fmtPhone(e.phone)}</a>
          {e.follow_up_on && e.follow_up_on < today && <span className="pill bad">Overdue</span>}
        </div>
        {e.message && <div className="small">"{e.message}"</div>}
        {asked.length > 0 && <div className="tiny muted">About: {asked.map((s) => s.name).join(', ')}</div>}
        <div className="tiny muted">
          Asked {fmtDateTime(e.created_at)} ({SOURCE_LABEL[e.source] || e.source})
          {Number(e.calls) > 0 ? ` · called ${e.calls} ${Number(e.calls) === 1 ? 'time' : 'times'}, last ${fmtDateTime(e.last_call_at)}: ${e.last_call_note || ''}` : ' · not called yet'}
        </div>
        {open && (
          <div className="stack tight" style={{ marginTop: 8 }}>
            <input className="input" value={note} onChange={(x) => setNote(x.target.value)} maxLength={300} placeholder="What they said (optional), e.g. will come after her exams" />
            <div className="row wrap" style={{ gap: 6 }}>
              <button className="btn primary sm" onClick={() => done('booked')}><CalendarClock size={15} /> Booked</button>
              <button className="btn line sm" onClick={() => done('no_answer')}>No answer</button>
              <button className={'btn line sm' + (more === 'again' ? ' on' : '')} onClick={() => setMore(more === 'again' ? '' : 'again')}>Call again…</button>
              <button className={'btn ghost sm' + (more === 'close' ? ' on' : '')} onClick={() => setMore(more === 'close' ? '' : 'close')}>Not interested…</button>
            </div>
            {more === 'again' && <div className="row wrap" style={{ gap: 6 }}>{[[0, 'Later today'], [1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week'], [30, 'Next month']].map(([d, l]) => <button key={d} className="chip sm" onClick={() => done('again', { days: d })}>{l}</button>)}</div>}
            {more === 'close' && <div className="row wrap" style={{ gap: 6 }}>{CLOSE_REASONS.map((r) => <button key={r} className="chip sm" onClick={() => done('closed', { reason: r })}>{r}</button>)}</div>}
          </div>
        )}
      </div>
      <div className="appt-acts">
        <a className="btn primary sm" href={'tel:+91' + e.phone} onClick={() => setOpen(true)}><PhoneCall size={15} /> Call</a>
        <button className="btn line sm" onClick={() => setOpen((x) => !x)}>{open ? 'Hide' : 'How did it go?'}</button>
        <button className="icon-btn plain sm" aria-label="Change" onClick={onEdit}><Pencil size={15} /></button>
      </div>
    </div>
  );
}

function EnquiryModal({ enquiry, onClose, onSaved }) {
  const { services, toast } = useApp();
  const isNew = !enquiry.id;
  const [phone, setPhone] = useState(enquiry.phone ? fmtPhone(enquiry.phone) : '');
  const [name, setName] = useState(enquiry.name || '');
  const [source, setSource] = useState(enquiry.source || 'whatsapp');
  const [message, setMessage] = useState(enquiry.message || '');
  const [ids, setIds] = useState(enquiry.service_ids || []);
  const [q, setQ] = useState('');
  const [follow, setFollow] = useState(enquiry.follow_up_on || '');
  const [callTime, setCallTime] = useState(enquiry.call_time || '');
  const isCall = source === 'phone';
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const p10 = cleanPhone(phone);
  useEffect(() => {
    if (!p10 || name.trim()) return;
    db.list('customers', { eq: { phone: p10 }, limit: 1 }).then((r) => { if (r[0]) setName(r[0].name || ''); }).catch(() => {});
  }, [p10]);
  const found = q.trim().length >= 2 ? services.filter((s) => s.active && !ids.includes(s.id) && (s.name + ' ' + s.category).toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : [];
  const save = async () => {
    setErr('');
    if (!p10) return setErr('Enter a 10-digit mobile number.');
    if (!message.trim() && !ids.length) return setErr('Write what they asked, or pick the service.');
    setBusy(true);
    const row = { phone: p10, name: name.trim() || null, source, message: message.trim() || null, service_ids: ids.length ? ids : null,
      follow_up_on: follow || null, call_time: callTime.trim() || null, ...(follow && (isNew || enquiry.status === 'new') ? { status: 'follow_up' } : {}) };
    try {
      if (isNew) await db.insert('enquiries', row);
      else await db.update('enquiries', enquiry.id, row);
      toast(follow ? `Saved: on the Call back list for ${follow === istDay() ? 'today' : slotDay(follow)}` : 'Enquiry saved', 'ok');
      onSaved({ source, follow });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={isNew ? (isCall ? 'Call enquiry' : 'New enquiry') : 'Enquiry: ' + (enquiry.name || fmtPhone(enquiry.phone))} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Mobile number"><input className="input" id="eq-phone" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98300 12345" /></Field>
        <Field label="Name"><input className="input" id="eq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Came by" className="span2">
          <div className="chips">{SOURCES.filter(([k]) => k !== 'website' || enquiry.source === 'website').map(([k, l]) => <button key={k} className={'chip sm' + (source === k ? ' on' : '')} onClick={() => setSource(k)}>{l}</button>)}</div>
        </Field>
        <Field label="What they asked" className="span2"><textarea className="textarea" id="eq-msg" value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. Keratin price for shoulder-length hair? Free on Sunday?" /></Field>
        <Field label="About (services)" className="span2" hint="Their prices go in the WhatsApp reply">
          <div className="stack tight">
            {ids.length > 0 && <div className="picked">{ids.map((id) => <span key={id} className="picked-item">{(services.find((s) => s.id === id) || {}).name || 'Service removed'}<button aria-label="Remove" onClick={() => setIds(ids.filter((x) => x !== id))}><X size={13} /></button></span>)}</div>}
            <SearchBox value={q} onChange={setQ} placeholder="Type 2 letters, e.g. nano" />
            {found.length > 0 && <div className="chips">{found.map((s) => <button key={s.id} className="chip sm" onClick={() => { setIds([...ids, s.id]); setQ(''); }}>{s.name}</button>)}</div>}
          </div>
        </Field>
        <Field label={isCall ? 'Call back on' : 'Follow up on'} hint={isCall ? 'They show on Bookings → Call back that day' : 'Optional: when to message them again (shows on Call back)'}>
          <div className="stack tight">
            <input className="input" id="eq-follow" type="date" value={follow} onChange={(e) => setFollow(e.target.value)} />
            <div className="chips">{[[0, 'Today'], [1, 'Tomorrow'], [3, 'In 3 days'], [7, 'Next week']].map(([d, l]) => <button key={d} className={'chip sm' + (follow === addDays(istDay(), d) ? ' on' : '')} onClick={() => setFollow(addDays(istDay(), d))}>{l}</button>)}
              {follow && <button className="chip sm" onClick={() => setFollow('')}>No day</button>}</div>
          </div>
        </Field>
        <Field label="Best time to call" hint="Optional">
          <div className="stack tight">
            <div className="chips">{CALL_TIMES.map((t) => <button key={t} className={'chip sm' + (callTime === t ? ' on' : '')} onClick={() => setCallTime(callTime === t ? '' : t)}>{t}</button>)}</div>
            <input className="input" id="eq-calltime" value={callTime} maxLength={40} onChange={(e) => setCallTime(e.target.value)} placeholder="or type, e.g. after 5 pm" />
          </div>
        </Field>
      </div>
      {err && <p className="err-text" role="alert" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}
