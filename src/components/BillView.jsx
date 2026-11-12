import { useEffect, useRef, useState } from 'react';
import { Printer, MessageCircle, Ban, Share2, Copy, Download, Send, RotateCcw, Pencil, Wrench } from 'lucide-react';
import { db, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { Modal, Field, Loading, MoneyInput } from './ui';
import { Receipt, printBill, billWhatsAppText, waUrl } from './Receipt';
import { rupee, fmtPhone, canDownload, NO_DOWNLOAD, fmtDateTime, uid, round2 } from '../lib/format';
import { editChanges, editProblem, editSummary, correctionDraft } from '../lib/billEdit';
import { receiptImage, billFileName } from '../lib/receiptImage';
import { billChatText } from '../lib/receiptRows';
import { waBillsOn, sendBillOnWhatsApp, WA_STATUS } from '../lib/whatsapp';

// Shows one bill with Print / WhatsApp / Cancel, and for the owner Edit / Correct items. Used after saving and from
// the Bills list. onCorrect: the New bill screen opens with the corrected bill (Bills passes it).
export function BillView({ bill: initial, items: initialItems, onClose, onChanged, onCorrect, title, extraFoot, autoWa }) {
  const { settings, askOwner, toast, loadProducts } = useApp();
  const [bill, setBill] = useState(initial);
  const [items, setItems] = useState(initialItems || null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [wa, setWa] = useState(false);
  const [waKick, setWaKick] = useState(0);   // WhatsApp bills on: the button sends through the API, no chat to open
  const [editing, setEditing] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [edits, setEdits] = useState([]);
  const [links, setLinks] = useState({});    // { replaces: 'HF2627-0041', replaced_by: 'HF2627-0050' }

  useEffect(() => {
    if (!initialItems) db.list('bill_items', { eq: { bill_id: initial.id }, order: ['created_at', 'asc'] }).then(setItems);
  }, [initial.id, initialItems]);
  // The change history, and the bills a correction links
  useEffect(() => {
    if (bill._pending) return;
    if (bill.edited_at) db.list('bill_edits', { eq: { bill_id: bill.id }, order: ['edited_at', 'asc'] }).then(setEdits).catch(() => setEdits([]));
    for (const k of ['replaces', 'replaced_by']) {
      if (bill[k]) db.get('bills', bill[k]).then((x) => x && setLinks((l) => ({ ...l, [k]: x.bill_no }))).catch(() => {});
    }
  }, [bill.id, bill.edited_at, bill.replaces, bill.replaced_by]);

  const canFix = bill.status === 'paid' && !bill._pending && !extraFoot;
  const startEdit = async () => {
    if (!(await askOwner('Only the owner can edit a bill.'))) return;
    setEditing(true);
  };
  const startCorrect = async () => {
    if (!(await askOwner('Only the owner can correct a bill.'))) return;
    setReason('');
    setCorrecting(true);
  };
  // Correct items: cancel this bill ("Corrected: …"), then New bill opens with its lines to fix and save
  const doCorrect = async () => {
    if (!reason.trim() || !items) return;
    try {
      const cur = JSON.parse(localStorage.getItem('habibs-pos-draft') || '{}');
      if (cur.lines && cur.lines.length && !window.confirm('A bill is already being made on the New bill screen. Replace it with this correction?')) return;
    } catch { /* ignore */ }
    const ok = await askOwner('Only the owner can correct a bill.', {
      action: 'cancel', ref: bill.id, detail: `Correct bill ${bill.bill_no} · ${rupee(bill.total)} · ${reason.trim()}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = await db.rpc('cancel_bill', { p_id: bill.id, p_reason: 'Corrected: ' + reason.trim() });
      localStorage.setItem('habibs-pos-draft', JSON.stringify(correctionDraft(b, items, uid)));
      loadProducts();
      toast(`Bill ${b.bill_no} cancelled. Fix the new bill and save it.`, 'ok');
      setCorrecting(false);
      if (onCorrect) onCorrect(); else onChanged && onChanged(b);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    if (IS_DEMO && window.self !== window.top) {
      toast('Printing works in the installed app. This preview cannot open the print window.');
      return;
    }
    printBill(bill, items, settings);
  };

  const startCancel = () => {
    if (bill._pending) return toast('This bill is still waiting to upload. Cancel it after it uploads.');
    setCancelling(true);
  };

  // The reason is asked first, so the owner sees it in the approval request
  const doCancel = async () => {
    if (!reason.trim()) return;
    const ok = await askOwner('Only the owner can cancel a bill.', {
      action: 'cancel', ref: bill.id, detail: `Cancel bill ${bill.bill_no} · ${rupee(bill.total)} · reason: ${reason.trim()}`,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = await db.rpc('cancel_bill', { p_id: bill.id, p_reason: reason.trim() });
      setBill(b);
      setCancelling(false);
      toast('Bill ' + b.bill_no + ' cancelled');
      loadProducts();
      onChanged && onChanged(b);
    } catch (e) {
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  if (editing && items) {
    return (
      <EditBill bill={bill} items={items} onClose={() => setEditing(false)}
        onSaved={async (b) => {
          setBill(b);
          setEditing(false);
          setItems(await db.list('bill_items', { eq: { bill_id: b.id }, order: ['created_at', 'asc'] }).catch(() => items));
          toast('Bill ' + b.bill_no + ' changed', 'ok');
          onChanged && onChanged(b, { keepOpen: true });
        }} />
    );
  }

  if (correcting) {
    return (
      <Modal
        title={'Correct items: ' + bill.bill_no}
        onClose={() => setCorrecting(false)}
        foot={
          <>
            <button className="btn line" onClick={() => setCorrecting(false)}>Back</button>
            <button className="btn danger" id="correct-go" disabled={!reason.trim() || busy || !items} onClick={doCorrect}><Wrench size={16} /> Cancel and open the new bill</button>
          </>
        }
      >
        <div className="stack">
          <p>For a wrong service, product, price or quantity. A tax invoice's items can't be changed, so:</p>
          <ol className="small" style={{ margin: 0, paddingLeft: 20 }}>
            <li><b>{bill.bill_no}</b> ({rupee(bill.total)}) is cancelled as "Corrected". It stays in the records; stock and points go back.</li>
            <li><b>New bill</b> opens with the same customer and items. Fix them, choose how it was paid, and save it.</li>
            <li>The new bill gets the next number and says which bill it replaces.</li>
          </ol>
          <p className="small muted" style={{ margin: 0 }}>Only the customer, who did a service, how it was paid or the note wrong? Use <b>Edit</b> instead: the bill keeps its number.</p>
          <Field label="What was wrong">
            <input className="input" id="correct-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Keratin billed as S, it was L" />
          </Field>
        </div>
      </Modal>
    );
  }

  if (cancelling) {
    return (
      <Modal
        title={'Cancel bill ' + bill.bill_no}
        onClose={() => setCancelling(false)}
        foot={
          <>
            <button className="btn line" onClick={() => setCancelling(false)}>Back</button>
            <button className="btn danger" disabled={!reason.trim() || busy} onClick={doCancel}>Cancel this bill</button>
          </>
        }
      >
        <div className="stack">
          <p>The bill of {rupee(bill.total)} stays in the records marked as cancelled. Products on it go back into stock, and loyalty points used on it go back (points it earned come off). To correct a bill, cancel it and make a new one.</p>
          <Field label="Reason">
            <input className="input" id="cancel-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong service added" />
          </Field>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      title={title || 'Bill ' + bill.bill_no}
      onClose={onClose}
      foot={
        <>
          {bill.status === 'paid' && !extraFoot && (
            <button className="btn danger" onClick={startCancel}><Ban size={16} /> Cancel bill</button>
          )}
          {canFix && items && (
            <>
              <button className="btn line" id="bill-edit" onClick={startEdit} title="Owner only"><Pencil size={15} /> Edit</button>
              <button className="btn line" id="bill-correct" onClick={startCorrect} title="Owner only"><Wrench size={15} /> Correct items</button>
            </>
          )}
          <span className="grow" />
          {items && bill.customer_phone && (
            <button className="btn wa" id="bill-wa" onClick={() => (waBillsOn(settings) && bill.status === 'paid' && !bill._pending ? setWaKick((k) => k + 1) : setWa(true))}>
              <MessageCircle size={16} /> {waBillsOn(settings) ? 'Send on WhatsApp' : 'WhatsApp'}
            </button>
          )}
          <button className="btn line" onClick={print} disabled={!items}><Printer size={16} /> Print</button>
          {extraFoot}
        </>
      }
    >
      {bill._pending && (
        <p className="pill warn" style={{ marginBottom: 12 }}>Saved on this device. Uploads when the internet is back.</p>
      )}
      {bill.status === 'cancelled' && (
        <p className="pill bad" style={{ marginBottom: 12 }}>Cancelled{bill.cancel_reason ? ': ' + bill.cancel_reason : ''}{links.replaced_by ? ` · replaced by ${links.replaced_by}` : ''}</p>
      )}
      {bill.replaces && <p className="pill warn" style={{ marginBottom: 12 }}>Corrected bill: replaces {links.replaces || 'a cancelled bill'}</p>}
      {edits.length > 0 && (
        <div className="sub-card small stack tight" id="bill-edits" style={{ marginBottom: 12 }}>
          <b>Changed after saving</b>
          {edits.map((e) => (
            <div key={e.id}>
              <span className="muted">{fmtDateTime(e.edited_at)} · {e.edited_by}:</span> {e.reason}
              <div className="tiny muted">{editSummary(e.changes)}</div>
            </div>
          ))}
        </div>
      )}
      {items && bill.customer_phone && <WaApi bill={bill} items={items} settings={settings} auto={autoWa} kick={waKick} onTwoTaps={() => setWa(true)} />}
      {items ? <Receipt bill={bill} items={items} settings={settings} /> : <Loading />}
      {wa && items && <WaBill bill={bill} items={items} settings={settings} onClose={() => setWa(false)} />}
    </Modal>
  );
}

// WhatsApp: the bill as a picture, like the printed one. WhatsApp links can carry only text, so it takes two taps:
// 1. open the chat with the customer's number (a short message with the total and points), 2. send the picture
// (the phone's Share, then WhatsApp: that chat is at the top). Where Share can't send pictures (a laptop): copy or save it.
function WaBill({ bill, items, settings, onClose }) {
  const { toast } = useApp();
  const [img, setImg] = useState(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState(1);
  useEffect(() => {
    let url = null;
    let dead = false;
    receiptImage(bill, items, settings)
      .then((blob) => {
        if (dead) return;
        url = URL.createObjectURL(blob);
        setImg({ blob, url, file: new File([blob], billFileName(bill), { type: 'image/png' }) });
      })
      .catch((e) => !dead && setErr(e.message));
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [bill.id, bill.status, bill.points_balance]);
  let canShare = false;
  try { canShare = !!(img && navigator.canShare && navigator.canShare({ files: [img.file] })); } catch { canShare = false; }
  const canCopy = typeof window !== 'undefined' && !!window.ClipboardItem && !!(navigator.clipboard && navigator.clipboard.write);
  const first = (bill.customer_name || '').trim().split(/\s+/)[0] || 'the customer';
  const share = async () => {
    try {
      await navigator.share({ files: [img.file], text: `${(settings && settings.salon_name) || 'Habibs'} · Bill ${bill.bill_no}` });
      toast('Bill picture shared');
    } catch (e) {
      if (e && e.name !== 'AbortError') toast('Could not open Share: ' + e.message, 'bad');
    }
  };
  const copy = async () => {
    try {
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': img.blob })]);
      toast('Bill picture copied. Paste it in the WhatsApp chat.');
    } catch {
      toast('This browser cannot copy a picture. Use Save picture.', 'bad');
    }
  };
  const save = () => {
    if (!canDownload()) return toast(NO_DOWNLOAD);
    const a = document.createElement('a');
    a.href = img.url;
    a.download = billFileName(bill);
    document.body.appendChild(a);
    a.click();
    a.remove();
  };
  return (
    <Modal title={'WhatsApp the bill to ' + fmtPhone(bill.customer_phone)} onClose={onClose}
      foot={<>
        <a className="link small" id="wa-text" href={waUrl(bill.customer_phone, billWhatsAppText(bill, items, settings))} target="_blank" rel="noopener noreferrer">Send as text instead</a>
        <span className="grow" />
        <button className="btn line" onClick={onClose}>Close</button>
      </>}>
      <div className="wa-bill">
        <ol className="wa-steps">
          <li className={step > 1 ? 'done' : ''}>
            <a className="btn wa" id="wa-open" href={waUrl(bill.customer_phone, billChatText(bill, settings))} target="_blank" rel="noopener noreferrer" onClick={() => setStep(2)}>
              <MessageCircle size={16} /> 1. Open {first}'s chat
            </a>
            <span className="small muted">Send the short message (total and points). The chat is then at the top in WhatsApp.</span>
          </li>
          <li>
            {canShare ? (
              <button className="btn primary" id="wa-share" disabled={!img} onClick={share}><Share2 size={16} /> 2. Send the bill picture</button>
            ) : (
              <span className="row wrap" style={{ gap: 8 }}>
                {canCopy && <button className="btn primary" id="wa-copy" disabled={!img} onClick={copy}><Copy size={16} /> 2. Copy the bill picture</button>}
                <button className={'btn ' + (canCopy ? 'line' : 'primary')} id="wa-save" disabled={!img} onClick={save}><Download size={16} /> {canCopy ? 'Save picture' : '2. Save the bill picture'}</button>
              </span>
            )}
            <span className="small muted">
              {canShare ? `Choose WhatsApp, then ${first}'s chat at the top, and Send.` : canCopy ? 'Then paste it in the chat (Ctrl+V on WhatsApp Web or Desktop, or long-press → Paste) and Send.' : 'Then attach it in the chat.'}
            </span>
          </li>
        </ol>
        <div className="bill-pic">
          {img ? <img src={img.url} alt={'Bill ' + bill.bill_no} id="wa-pic" /> : err ? <p className="err-text">{err}</p> : <Loading />}
        </div>
      </div>
    </Modal>
  );
}

// WhatsApp bills (WhatsApp Business Platform): sent by itself after saving when ticked, or by hand here. Shows how it went:
// sending → sent ✓ → delivered ✓✓ → read, or why it wasn't sent (then the WhatsApp button, 2 taps, still works).
function WaApi({ bill, items, settings, auto, kick, onTwoTaps }) {
  const { toast } = useApp();
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const started = useRef(false);
  const on = waBillsOn(settings);
  const load = () => db.list('wa_messages', { eq: { bill_id: bill.id }, order: ['created_at', 'desc'] }).then(setRows).catch(() => setRows([]));
  const send = async (again) => {
    setBusy(true);
    setErr('');
    try {
      const r = await sendBillOnWhatsApp(bill, items, settings, { again });
      if (r && r.ok === false) { setErr(r.error || 'Not sent'); toast('Not sent on WhatsApp: ' + (r.error || 'try again'), 'bad'); }
      else if (r && r.already) toast('Already sent on WhatsApp to ' + fmtPhone(bill.customer_phone) + (again ? '. Wait a minute to send again.' : ''));
      else toast('Bill sent on WhatsApp to ' + fmtPhone(bill.customer_phone) + ' ✓');
    } catch (e) {
      setErr(e.message);
      toast('Not sent on WhatsApp: ' + e.message, 'bad');
    }
    setBusy(false);
    load();
  };
  useEffect(() => {
    if (bill._pending) { setRows([]); return; }
    load();
    if (auto && !started.current && bill.status === 'paid') { started.current = true; send(false); }
  }, [bill.id]);
  // follow the delivery for 2 minutes while the bill is open
  const last = rows && rows[0];
  // the WhatsApp button on the bill: send now (again, if it went before)
  useEffect(() => { if (kick && !busy && rows) send(rows.length > 0 && rows[0].status !== 'failed'); }, [kick]);
  // tell the counter when it reaches the customer's phone, or doesn't
  const seen = useRef(null);
  useEffect(() => {
    if (!last) return;
    const was = seen.current;
    seen.current = last.id + last.status;
    if (was === null || was === seen.current) return;
    if (last.status === 'delivered') toast('Delivered on WhatsApp ✓✓');
    if (last.status === 'read') toast('Read on WhatsApp');
    if (last.status === 'failed' && !busy) toast('Not delivered on WhatsApp: ' + (last.error || ''), 'bad');
  }, [last && last.id, last && last.status]);
  useEffect(() => {
    if (!last || !['sending', 'sent', 'delivered'].includes(last.status)) return;
    const t0 = Date.now();
    const t = setInterval(() => { if (Date.now() - t0 > 120000) clearInterval(t); else load(); }, 3000);
    return () => clearInterval(t);
  }, [last && last.id, last && last.status]);
  if (bill._pending) return auto ? <p className="small muted wa-api" id="wa-api">WhatsApp: the bill goes when it uploads.</p> : null;
  if (!rows || (!on && !rows.length)) return null;
  const st = busy ? 'sending' : last ? last.status : null;
  const tries = rows.length;
  return (
    <div className={'wa-api ' + (st || 'none')} id="wa-api">
      <MessageCircle size={16} />
      <span className="grow">
        {st ? <b>{WA_STATUS[st]}</b> : <span>Not sent on WhatsApp yet</span>}
        {st === 'failed' && (err || (last && last.error)) && <span className="small">: {err || last.error}</span>}
        {st !== 'failed' && err && <span className="small err-text"> {err}</span>}
        {(st === 'failed' || err) && <> <button className="link small" id="wa-api-2taps" onClick={onTwoTaps}>Send it the other way (2 taps)</button></>}
      </span>
      {on && bill.status === 'paid' && !busy && (!st || st === 'failed' || (tries < 3 && last && Date.now() - new Date(last.created_at).getTime() > 60000)) && tries < 3 && (
        <button className="btn line sm" id="wa-api-send" onClick={() => send(!!st)}>
          {st ? <><RotateCcw size={14} /> Send again</> : <><Send size={14} /> Send on WhatsApp</>}
        </button>
      )}
    </div>
  );
}

// Edit a saved bill (owner only): the customer, who did each service, how it was paid, the note. The money on it
// (items, prices, total) doesn't change: for that, Correct items. The database checks it all again (edit_bill).
function EditBill({ bill, items, onClose, onSaved }) {
  const { staff, toast } = useApp();
  const [f, setF] = useState({
    name: bill.customer_name || '', phone: bill.customer_phone || '',
    staff: Object.fromEntries(items.map((l) => [l.id, l.staff_id || ''])),
    cash: String(Number(bill.paid_cash) || ''), upi: String(Number(bill.paid_upi) || ''), card: String(Number(bill.paid_card) || ''),
    note: bill.note || '', reason: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // what was paid in money then: the total less points and less what was left as due (the due stays as it is)
  const due = round2(Number(bill.total) - Number(bill.paid_points || 0) - Number(bill.paid_due || 0));
  const paid = round2((Number(f.cash) || 0) + (Number(f.upi) || 0) + (Number(f.card) || 0));
  const problem = editProblem(bill, items, f);
  const pick = (l) => [...staff.filter((s) => s.active || s.id === l.staff_id)];
  const save = async () => {
    if (problem) return setErr(problem);
    setBusy(true);
    setErr('');
    try {
      const b = await db.rpc('edit_bill', { p_id: bill.id, p: editChanges(bill, items, f) });
      await onSaved(b);
    } catch (e) {
      setErr(e.message);
      toast(e.message, 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal wide title={'Edit bill ' + bill.bill_no} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><span className="grow" /><button className="btn primary" id="edit-save" disabled={busy || !!problem} onClick={save}>Save changes</button></>}>
      <div className="stack">
        <p className="small muted" style={{ margin: 0 }}>
          The items, prices and total stay as they are (a tax invoice). Every change is kept on the bill with your reason.
          Wrong items or prices? Go back and use <b>Correct items</b>.
        </p>
        <div className="form-grid">
          <Field label="Customer name"><input className="input" id="edit-name" value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} /></Field>
          <Field label="Mobile" hint={Number(bill.paid_points) > 0 ? "Points were used: the number can't change" : 'The visit and the points it earned move with it'}>
            <input className="input" id="edit-phone" inputMode="numeric" value={f.phone} disabled={Number(bill.paid_points) > 0 || !!bill.for_staff}
              onChange={(e) => set('phone', e.target.value.replace(/\D/g, '').slice(0, 10))} />
          </Field>
        </div>
        <div className="stack tight">
          <div className="sec-title">Who did it</div>
          {items.map((l) => (
            <div key={l.id} className="row between wrap" style={{ gap: 8 }}>
              <span className="small grow">{l.name}{Number(l.qty) > 1 ? ` × ${Number(l.qty)}` : ''}</span>
              <select className="input" style={{ maxWidth: 240, height: 40 }} data-line={l.name} value={f.staff[l.id]} onChange={(e) => setF((x) => ({ ...x, staff: { ...x.staff, [l.id]: e.target.value } }))}>
                <option value="">Nobody</option>
                {pick(l).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          ))}
          <span className="tiny muted">Commission follows. Not once that month's salary is paid to either person.</span>
        </div>
        {due > 0 && (
          <div className="stack tight">
            <div className="sec-title">How it was paid {Number(bill.paid_points) > 0 ? `(₹${Number(bill.paid_points)} with points stays)` : ''}</div>
            <div className="form-grid">
              <Field label="Cash"><MoneyInput id="edit-cash" value={f.cash} onChange={(v) => set('cash', v)} placeholder="0" /></Field>
              <Field label="UPI"><MoneyInput id="edit-upi" value={f.upi} onChange={(v) => set('upi', v)} placeholder="0" /></Field>
              <Field label="Card"><MoneyInput id="edit-card" value={f.card} onChange={(v) => set('card', v)} placeholder="0" /></Field>
            </div>
            <span className={'tiny ' + (paid === due ? 'muted' : 'warn-text')}>Must add up to {rupee(due)}{paid !== due ? ` (now ${rupee(paid)})` : ''}. Not once that time's cash is closed.</span>
          </div>
        )}
        <Field label="Note"><input className="input" id="edit-note" value={f.note} maxLength={300} onChange={(e) => set('note', e.target.value)} /></Field>
        <Field label="Why the change (kept on the bill)"><input className="input" id="edit-reason" value={f.reason} maxLength={200} onChange={(e) => set('reason', e.target.value)} placeholder="e.g. Wrong number typed; paid by UPI, not cash" /></Field>
        {(err || (problem && problem !== 'Nothing is changed yet.' && problem !== 'Write why the bill is being changed.')) && <p className="err-text small">{err || problem}</p>}
      </div>
    </Modal>
  );
}