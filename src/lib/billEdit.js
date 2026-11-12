// Editing a saved bill (owner only) and correcting its items. No browser code, so tests run it in Node.
// The database (edit_bill) checks everything again; this only sends what was changed.

const amt = (v) => Math.round((Number(v) || 0) * 100) / 100;

// The form → what edit_bill() gets: only what changed, plus the reason.
//   form: { name, phone, staff: { [line id]: staff id }, cash, upi, card, note, reason }
export function editChanges(bill, items, form) {
  const p = { reason: String(form.reason || '').trim() };
  const phone = String(form.phone || '').replace(/\D/g, '');
  if (phone !== String(bill.customer_phone || '')) p.customer_phone = phone;
  const name = String(form.name || '').trim();
  if (name !== String(bill.customer_name || '')) p.customer_name = name;
  const lines = (items || []).filter((l) => (form.staff || {})[l.id] !== undefined && (form.staff[l.id] || '') !== (l.staff_id || ''))
    .map((l) => ({ id: l.id, staff_id: form.staff[l.id] || '' }));
  if (lines.length) p.items = lines;
  const pay = { paid_cash: amt(form.cash), paid_upi: amt(form.upi), paid_card: amt(form.card) };
  if (pay.paid_cash !== amt(bill.paid_cash) || pay.paid_upi !== amt(bill.paid_upi) || pay.paid_card !== amt(bill.paid_card)) Object.assign(p, pay);
  const note = String(form.note || '').trim();
  if (note !== String(bill.note || '')) p.note = note;
  return p;
}

// Is the form ready to save? Returns the first problem, or ''.
export function editProblem(bill, items, form) {
  const p = editChanges(bill, items, form);
  if (Object.keys(p).length === 1) return 'Nothing is changed yet.';
  if ('customer_phone' in p && p.customer_phone && !/^[6-9]\d{9}$/.test(p.customer_phone)) return 'The mobile number must be 10 digits.';
  if ('paid_cash' in p) {
    // the money paid then: the total less points and less what was left as due (the due stays)
    const due = amt(Number(bill.total) - Number(bill.paid_points || 0) - Number(bill.paid_due || 0));
    if (amt(p.paid_cash + p.paid_upi + p.paid_card) !== due) return `Cash, UPI and card must add up to ${'₹' + due.toLocaleString('en-IN')}.`;
  }
  if (!p.reason) return 'Write why the bill is being changed.';
  return '';
}

// One line for the history: "Mobile 98300 12345 → 98300 12354 · Haircut: Amit → Priya · Paid Cash → UPI"
export function editSummary(c) {
  if (!c) return '';
  const v = (x) => (x == null || x === '' ? 'none' : String(x));
  const out = [];
  if (c.customer_phone) out.push(`Mobile ${v(c.customer_phone[0])} → ${v(c.customer_phone[1])}`);
  if (c.customer_name) out.push(`Name ${v(c.customer_name[0])} → ${v(c.customer_name[1])}`);
  for (const s of c.staff || []) out.push(`${s.line}: ${v(s.from)} → ${v(s.to)}`);
  if (c.payment) {
    const t = (x) => (x.mode === 'Split' ? ['cash', 'upi', 'card'].filter((k) => Number(x[k]) > 0).map((k) => `${k === 'upi' ? 'UPI' : k[0].toUpperCase() + k.slice(1)} ₹${Number(x[k])}`).join(' + ') : x.mode);
    out.push(`Paid ${t(c.payment[0])} → ${t(c.payment[1])}`);
  }
  if (c.note) out.push(`Note ${v(c.note[0])} → ${v(c.note[1])}`);
  return out.join(' · ');
}

// Correct items: the draft the New bill screen opens with (the same shape it saves itself), from the cancelled bill.
// Lines at the prices they were billed at (the menu and offers apply again as usual when it is saved).
export function correctionDraft(bill, items, uid) {
  const lines = (items || []).map((l) => ({
    key: uid(), qty: Number(l.qty) || 1, staff_id: l.staff_id || '', item_type: l.item_type,
    ...(l.item_type === 'product' ? { product_id: l.product_id } : { service_id: l.service_id }),
    category: l.category || '', hsn_sac: l.hsn_sac || '', name: l.name, unit_price: Number(l.unit_price), gst_pct: Number(l.gst_pct) || 0,
  })).filter((l) => l.service_id || l.product_id);
  return {
    section: 'Hair', phone: bill.customer_phone || '', skip: !bill.customer_phone,
    newCust: { name: bill.customer_name || '', gender: '', whatsapp_ok: false }, curStaff: '',
    lines, discType: 'pct', discVal: '', payMode: '', billId: undefined,
    replaces: { id: bill.id, bill_no: bill.bill_no, total: Number(bill.total) },
  };
}
