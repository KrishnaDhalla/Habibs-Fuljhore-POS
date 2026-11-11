import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Download, LogOut, RotateCcw, History, FolderPlus, Pencil, Lock } from 'lucide-react';
import { db, getDb, IS_DEMO } from '../lib/db';
import { useApp } from '../store';
import { rupee, istDay, downloadFile, canDownload, NO_DOWNLOAD, fmtDateTime, uid } from '../lib/format';
import { parseVariants, variantsToText, parseExtra, extraToText, SECTIONS, sectionLabel, webPageOf, WEB_PAGES, WEB_TABS, WEB_TYPES } from '../data/menu';
import { Field, Modal, MoneyInput, SearchBox, Seg, Confirm, Empty, Loading } from '../components/ui';
import { Receipt, getPrintMethod, setPrintMethod, printBill } from '../components/Receipt';
import { loyaltyRules, earnPoints } from '../lib/loyalty';
import { getDeviceLetter, setDeviceLetter } from '../lib/offline';
import { LoginSettings } from '../components/Logins';
import { OfferSettings } from '../components/Offers';
import { OwnerSettings } from '../components/OwnerSettings';
import { calcBill } from '../lib/calc';

const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export default function Settings({ onSignOut }) {
  const [tab, setTab] = useState('salon');
  return (
    <div className="page">
      <div className="page-head"><h1>Settings</h1></div>
      <div className="tabs">
        {[['salon', 'Salon & bill'], ['services', 'Services & prices'], ['offers', 'Offers'], ['pin', 'Owner unlock'], ...(IS_DEMO ? [] : [['logins', 'Logins']]), ['data', 'Data & backup']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'salon' && <SalonSettings />}
      {tab === 'services' && <ServiceSettings />}
      {tab === 'pin' && <OwnerSettings />}
      {tab === 'offers' && <OfferSettings />}
      {tab === 'logins' && <LoginSettings />}
      {tab === 'data' && <DataSettings onSignOut={onSignOut} />}
    </div>
  );
}

const WEEK = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

function SalonSettings() {
  const { settings, saveSetting, toast, services } = useApp();
  const [f, setF] = useState(() => ({ ...settings }));
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  // staff rules: days with no days off, tabs free for staff
  const blocked = Array.isArray(f.leave_blocked_days) ? f.leave_blocked_days.map(Number) : [5, 6, 0];
  const alerts = Array.isArray(f.leave_alert_days) ? f.leave_alert_days.map(Number) : [7, 3, 1];
  const free = Array.isArray(f.staff_free_sections) ? f.staff_free_sections : ['Hair', 'Threading', 'Waxing'];
  const tabs = SECTIONS.filter((x) => free.includes(x) || (services || []).some((v) => v.active !== false && v.section === x));
  const toggle = (k, list, v) => setF({ ...f, [k]: list.includes(v) ? list.filter((x) => x !== v) : [...list, v] });
  // WhatsApp bills: is the WhatsApp Business number connected?
  const [waInfo, setWaInfo] = useState(null);
  const checkWa = async () => {
    setWaInfo({ text: 'Checking…' });
    try {
      const r = await db.whatsapp({ action: 'status' });
      if (r.demo) return setWaInfo({ ok: true, text: 'Demo: nothing is really sent. A bill is marked sent, then delivered, to show how it works.' });
      if (!r.configured) return setWaInfo({ text: `Not set up yet: add ${r.missing.join(', ')} in Supabase → Edge Functions → Secrets (README, WhatsApp bills).` });
      if (r.error) return setWaInfo({ text: `Set up, but: ${r.error}` });
      const hooks = r.missing.length ? ` Delivery ticks need ${r.missing.join(' and ')} too.` : '';
      setWaInfo({ ok: !r.missing.length, text: `Connected: ${r.number || '?'} · ${r.name || ''}${r.quality ? ' · quality ' + String(r.quality).toLowerCase() : ''}. Template ${r.template} (${r.lang}).${hooks}` });
    } catch (e) {
      setWaInfo({ text: 'Could not check: ' + e.message + ' (is the whatsapp function deployed?)' });
    }
  };
  const keys = ['salon_name', 'branch', 'address', 'phone', 'instagram', 'gstin', 'prices_include_gst', 'bill_prefix', 'bill_footer', 'max_discount_pct', 'upi_id', 'receipt_width', 'opening_hours', 'whatsapp', 'maps_url', 'paid_offs_per_month',
    'leave_blocked_days', 'leave_notice_days', 'leave_one_at_a_time', 'leave_alert_days', 'staff_free_sections', 'staff_discount_pct', 'wa_bills_on', 'wa_slips_on',
    'wa_feedback_on', 'wa_feedback_after_hours', 'google_review_url', 'wa_review_all', 'wa_reminders_on', 'wa_remind_hours', 'wa_winback_on', 'wa_winback_days', 'wa_winback_text', 'wa_winback_per_day', 'cash_tolerance',
    'loyalty_on', 'loyalty_earn_pct', 'loyalty_min_use', 'loyalty_max_use_pct', 'loyalty_expiry_months', 'loyalty_products'];

  const save = async () => {
    const gstin = String(f.gstin || '').trim().toUpperCase();
    if (gstin && !GSTIN_RE.test(gstin)) return setErr('That GSTIN does not look right. It has 15 characters, like 19ABCDE1234F1Z5.');
    if (!/^[A-Z0-9]{1,6}$/i.test(String(f.bill_prefix || ''))) return setErr('Bill prefix: 1 to 6 letters or numbers.');
    setErr('');
    const num = (k, d, max) => (f[k] === '' || f[k] == null || isNaN(Number(f[k])) ? d : Math.min(max, Math.max(0, Number(f[k]))));
    if (num('loyalty_earn_pct', 5, 100) > 20) return setErr('Points earned: at most 20% of the bill.');
    const next = { ...f, gstin, bill_prefix: String(f.bill_prefix).toUpperCase(), max_discount_pct: Number(f.max_discount_pct) || 0, receipt_width: Number(f.receipt_width) || 80,
      paid_offs_per_month: f.paid_offs_per_month === '' || f.paid_offs_per_month == null ? 4 : Math.min(31, Number(f.paid_offs_per_month) || 0),
      loyalty_on: f.loyalty_on !== false, loyalty_products: f.loyalty_products === true,
      loyalty_earn_pct: num('loyalty_earn_pct', 5, 20), loyalty_min_use: Math.round(num('loyalty_min_use', 100, 100000)),
      loyalty_max_use_pct: num('loyalty_max_use_pct', 20, 100), loyalty_expiry_months: Math.max(1, Math.round(num('loyalty_expiry_months', 12, 120))),
      leave_blocked_days: blocked, leave_notice_days: Math.round(num('leave_notice_days', 14, 60)), leave_one_at_a_time: f.leave_one_at_a_time !== false,
      leave_alert_days: [...alerts].sort((a, b) => b - a),
      staff_free_sections: free, staff_discount_pct: Math.round(num('staff_discount_pct', 50, 100)), wa_bills_on: f.wa_bills_on === true, wa_slips_on: f.wa_slips_on !== false,
      wa_feedback_on: f.wa_feedback_on === true, wa_feedback_after_hours: Math.round(num('wa_feedback_after_hours', 2, 47)), google_review_url: String(f.google_review_url || '').trim(),
      wa_review_all: f.wa_review_all !== false, wa_reminders_on: f.wa_reminders_on === true, wa_remind_hours: Math.max(1, Math.round(num('wa_remind_hours', 3, 48))),
      wa_winback_on: f.wa_winback_on === true, wa_winback_days: Math.max(14, Math.round(num('wa_winback_days', 45, 300))),
      wa_winback_text: String(f.wa_winback_text || '').trim().slice(0, 160) || 'We would love to see you again.', wa_winback_per_day: Math.round(num('wa_winback_per_day', 20, 200)),
      cash_tolerance: Math.round(num('cash_tolerance', 10, 1000)) };
    if (next.google_review_url && !/^https:\/\/\S+$/.test(next.google_review_url)) { setErr('The Google review link must start with https://'); return; }
    try {
      for (const k of keys) if (JSON.stringify(next[k]) !== JSON.stringify(settings[k])) await saveSetting(k, next[k]);
      setF(next);
      toast('Settings saved', 'ok');
    } catch (e) { setErr(e.message); }
  };

  // Sample receipt, worked out with the same maths as a real bill
  const sampleCalc = calcBill([
    { id: 1, name: 'Men Cut and Styling', qty: 1, unit_price: 600, staff_name: 'Stylist', gst_pct: 5 },
    { id: 2, name: 'Beard Styling', qty: 1, unit_price: 250, staff_name: 'Stylist', gst_pct: 5 },
    { id: 3, name: 'Head Massage Habibs Oil', qty: 1, unit_price: 550, staff_name: 'Stylist', gst_pct: 5 },
  ], { gstOn: !!f.gstin, inclusive: f.prices_include_gst !== false });
  const sample = {
    bill_no: (String(f.bill_prefix || 'HF').toUpperCase()) + '2627-0001', created_at: new Date().toISOString(), customer_name: 'Sample Customer', customer_phone: '9876543210',
    subtotal: sampleCalc.subtotal, offer_discount: 0, discount: 0, taxable: sampleCalc.taxable, cgst: sampleCalc.cgst, sgst: sampleCalc.sgst,
    round_off: sampleCalc.round_off, total: sampleCalc.total, pay_mode: 'UPI', paid_upi: sampleCalc.total, status: 'paid',
    points_earned: f.loyalty_on === false ? 0 : earnPoints({ total: sampleCalc.total, paid_upi: sampleCalc.total, items: sampleCalc.items.map((i) => ({ ...i, item_type: 'service' })) }, loyaltyRules(f), { phone: '9876543210' }),
    points_balance: f.loyalty_on === false ? null : 120,
  };
  const sampleItems = sampleCalc.items;

  return (
    <div className="grid2" style={{ alignItems: 'start' }}>
      <div className="card card-pad stack loose">
        <div className="form-grid">
          <Field label="Salon name"><input className="input" id="st-name" value={f.salon_name || ''} onChange={set('salon_name')} /></Field>
          <Field label="Branch"><input className="input" id="st-branch" value={f.branch || ''} onChange={set('branch')} /></Field>
          <Field label="Address" className="span2"><input className="input" id="st-addr" value={f.address || ''} onChange={set('address')} /></Field>
          <Field label="Phone on bill"><input className="input" id="st-phone" value={f.phone || ''} onChange={set('phone')} /></Field>
          <Field label="Instagram"><input className="input" id="st-ig" value={f.instagram || ''} onChange={set('instagram')} /></Field>
          <Field label="Line at the bottom of the bill" className="span2"><input className="input" id="st-foot" value={f.bill_footer || ''} onChange={set('bill_footer')} /></Field>
          <Field label="Opening hours (website)"><input className="input" id="st-hours" value={f.opening_hours || ''} onChange={set('opening_hours')} placeholder="10:00 AM – 9:00 PM, all 7 days" /></Field>
          <Field label="WhatsApp number (website)" hint="Empty = the phone number"><input className="input" id="st-wa" value={f.whatsapp || ''} onChange={set('whatsapp')} /></Field>
          <Field label="Google Maps link (website)" className="span2"><input className="input" id="st-maps" value={f.maps_url || ''} onChange={set('maps_url')} placeholder="https://maps.app.goo.gl/…" /></Field>
        </div>
        <div className="form-grid">
          <Field label="GSTIN" hint="Leave empty if the salon is not GST registered. Then no GST is charged."><input className="input" id="st-gstin" value={f.gstin || ''} onChange={(e) => setF({ ...f, gstin: e.target.value.toUpperCase() })} placeholder="19XXXXX0000X1Z5" /></Field>
          <Field label="Menu prices" hint="Salon services are taxed at 5% GST.">
            <Seg full options={[[true, 'Include GST'], [false, 'GST extra']]} value={f.prices_include_gst !== false} onChange={(v) => setF({ ...f, prices_include_gst: v })} />
          </Field>
          <Field label="Bill number prefix" hint="Change only at the start of a financial year (April)."><input className="input" id="st-prefix" value={f.bill_prefix || ''} onChange={set('bill_prefix')} /></Field>
          <Field label="Max discount without the owner (%)"><input className="input" id="st-maxd" inputMode="numeric" value={f.max_discount_pct ?? ''} onChange={(e) => setF({ ...f, max_discount_pct: e.target.value.replace(/\D/g, '') })} /></Field>
          <Field label="UPI ID for QR code" hint="The QR on the bill screen fills in the amount for the customer."><input className="input" id="st-upi" value={f.upi_id || ''} onChange={set('upi_id')} placeholder="habibsfuljhore@okicici" /></Field>
          <Field label="Receipt printer paper"><Seg full options={[[80, '80 mm'], [58, '58 mm']]} value={Number(f.receipt_width) || 80} onChange={(v) => setF({ ...f, receipt_width: v })} /></Field>
        </div>
        <div className="stack tight" id="staff-rules">
          <div className="sec-title">Staff: days off and their own services</div>
          <div className="form-grid">
            <Field label="Paid days off a month" hint="Week offs and leave together. Not taken: paid. More: unpaid. No carry-over."><input className="input" id="st-offs" inputMode="numeric" value={f.paid_offs_per_month ?? 4} onChange={(e) => setF({ ...f, paid_offs_per_month: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="One person off a day"><Seg full options={[[true, 'Yes'], [false, 'No']]} value={f.leave_one_at_a_time !== false} onChange={(v) => setF({ ...f, leave_one_at_a_time: v })} /></Field>
            <Field label="Busy days: leave only if the owner agrees" className="span2" hint="Leave on these days can still be asked; you see 'busy day' on it and decide. Medical leave isn't flagged.">
              <div className="chips" id="st-blocked">{WEEK.map(([n, l]) => <button key={n} type="button" className={'chip sm' + (blocked.includes(n) ? ' on' : '')} aria-pressed={blocked.includes(n)} onClick={() => toggle('leave_blocked_days', blocked, n)}>{l}</button>)}</div>
            </Field>
            <Field label="2+ days off in the last week (from the 22nd): ask this many days before" className="span2"><input className="input" id="st-notice" inputMode="numeric" style={{ maxWidth: 120 }} value={f.leave_notice_days ?? 14} onChange={(e) => setF({ ...f, leave_notice_days: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Telegram before someone's leave (to plan bookings and cover): days before" className="span2" hint="Who is off, their bookings on those days, who else is off, how many are in. Each goes once.">
              <div className="chips" id="st-alerts">{[14, 7, 5, 3, 2, 1].map((n) => <button key={n} type="button" className={'chip sm' + (alerts.includes(n) ? ' on' : '')} aria-pressed={alerts.includes(n)} onClick={() => toggle('leave_alert_days', alerts, n)}>{n === 1 ? '1 day' : `${n} days`}</button>)}</div>
            </Field>
            <Field label="Free for staff (their own services)" className="span2" hint="Staff's own bills: found by their mobile number. The person doing the service still earns incentive on the full price.">
              <div className="chips" id="st-free">{tabs.map((x) => <button key={x} type="button" className={'chip sm' + (free.includes(x) ? ' on' : '')} aria-pressed={free.includes(x)} onClick={() => toggle('staff_free_sections', free, x)}>{sectionLabel(x)}</button>)}</div>
            </Field>
            <Field label="Other services for staff (% off)"><input className="input" id="st-staff-pct" inputMode="numeric" value={f.staff_discount_pct ?? 50} onChange={(e) => setF({ ...f, staff_discount_pct: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
        <div className="stack tight" id="wa-settings">
          <div className="sec-title">WhatsApp bills (WhatsApp Business API)</div>
          <Field label="Send each bill on WhatsApp by itself" hint="With the bill picture, from the salon's WhatsApp Business number, to the customer's mobile number. About ₹0.15 + GST a bill (Meta's price in India). The counter can untick it for a customer who doesn't want it.">
            <Seg full options={[[false, 'Off'], [true, 'On']]} value={f.wa_bills_on === true} onChange={(v) => setF({ ...f, wa_bills_on: v })} />
          </Field>
          <Field label="Send the salary slip to staff when salary is marked paid" hint="Staff → Payroll → Mark paid: the full breakup (days, day rate, commission, advances, net pay) goes as a picture to that person's own mobile number. Needs the salary_slip template (README).">
            <Seg full options={[[false, 'Off'], [true, 'On']]} value={f.wa_slips_on !== false} onChange={(v) => setF({ ...f, wa_slips_on: v })} />
          </Field>
          <div className="row wrap" style={{ gap: 10 }}>
            <button type="button" className="btn line sm" id="wa-check" onClick={checkWa}>Check the WhatsApp setup</button>
            {waInfo && <span id="wa-info" className={'small' + (waInfo.ok ? '' : ' muted')}>{waInfo.text}</span>}
          </div>
        </div>
        <div className="stack tight" id="wa-auto-settings">
          <div className="sec-title">WhatsApp: automatic messages</div>
          <p className="small muted" style={{ margin: 0 }}>Sent by themselves from the salon's WhatsApp Business number, between 9 am and 9 pm. Each needs its message template approved in WhatsApp Manager (README, section 2f). A customer who replies STOP gets no more.</p>
          <div className="form-grid">
            <Field label="Ask “How was your visit?” after a bill" hint="They tap Loved it, It was okay or Not happy. Not happy comes to you on Telegram at once. One request a customer in 30 days.">
              <Seg full options={[[false, 'Off'], [true, 'On']]} value={f.wa_feedback_on === true} onChange={(v) => setF({ ...f, wa_feedback_on: v })} />
            </Field>
            <Field label="Hours after the bill"><input className="input" id="st-fb-hours" inputMode="numeric" value={f.wa_feedback_after_hours ?? 2} onChange={(e) => setF({ ...f, wa_feedback_after_hours: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Google review link" className="span2" hint="Google Business Profile → Ask for reviews → copy the link. It goes in the thank-you after they answer.">
              <input className="input" id="st-review-url" value={f.google_review_url || ''} onChange={set('google_review_url')} placeholder="https://g.page/r/…/review" />
            </Field>
            <Field label="Send the review link to" className="span2" hint="Google's rule is to ask every customer, not only the happy ones.">
              <Seg full options={[[true, 'Everyone who answers'], [false, 'Only “Loved it”']]} value={f.wa_review_all !== false} onChange={(v) => setF({ ...f, wa_review_all: v })} />
            </Field>
            <Field label="Remind customers of a confirmed booking">
              <Seg full options={[[false, 'Off'], [true, 'On']]} value={f.wa_reminders_on === true} onChange={(v) => setF({ ...f, wa_reminders_on: v })} />
            </Field>
            <Field label="Hours before the booking"><input className="input" id="st-rem-hours" inputMode="numeric" value={f.wa_remind_hours ?? 3} onChange={(e) => setF({ ...f, wa_remind_hours: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="“We miss you” to customers who haven't come" hint="Only customers who agreed to offers on WhatsApp, with no booking coming. Once each time they stay away.">
              <Seg full options={[[false, 'Off'], [true, 'On']]} value={f.wa_winback_on === true} onChange={(v) => setF({ ...f, wa_winback_on: v })} />
            </Field>
            <Field label="Days since the last visit"><input className="input" id="st-win-days" inputMode="numeric" value={f.wa_winback_days ?? 45} onChange={(e) => setF({ ...f, wa_winback_days: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="The line in that message" className="span2" hint="An offer, if you like. Their loyalty points are added by the app.">
              <input className="input" id="st-win-text" maxLength={160} value={f.wa_winback_text ?? 'We would love to see you again.'} onChange={set('wa_winback_text')} />
            </Field>
            <Field label="At most a day" hint="A marketing message costs more than a bill (Meta's price); this keeps the cost known."><input className="input" id="st-win-cap" inputMode="numeric" value={f.wa_winback_per_day ?? 20} onChange={(e) => setF({ ...f, wa_winback_per_day: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
        <div className="stack tight" id="cash-settings">
          <div className="sec-title">Cash close</div>
          <div className="form-grid">
            <Field label="A difference above this needs a note (₹)"><input className="input" id="st-cash-tol" inputMode="numeric" value={f.cash_tolerance ?? 10} onChange={(e) => setF({ ...f, cash_tolerance: e.target.value.replace(/\D/g, '') })} /></Field>
          </div>
        </div>
        <div className="stack tight" id="loyalty-settings">
          <div className="sec-title">Loyalty points (1 point = ₹1)</div>
          <div className="form-grid">
            <Field label="Loyalty points"><Seg full options={[[true, 'On'], [false, 'Off']]} value={f.loyalty_on !== false} onChange={(v) => setF({ ...f, loyalty_on: v })} /></Field>
            <Field label="Earned (% of what is paid)" hint="Services at their normal price; not offer prices or what points pay"><input className="input" id="st-lp-pct" inputMode="decimal" value={f.loyalty_earn_pct ?? 5} onChange={(e) => setF({ ...f, loyalty_earn_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
            <Field label="Can be used from (points)"><input className="input" id="st-lp-min" inputMode="numeric" value={f.loyalty_min_use ?? 100} onChange={(e) => setF({ ...f, loyalty_min_use: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Points pay at most (% of a bill)"><input className="input" id="st-lp-max" inputMode="numeric" value={f.loyalty_max_use_pct ?? 20} onChange={(e) => setF({ ...f, loyalty_max_use_pct: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Expire after no visit for (months)"><input className="input" id="st-lp-exp" inputMode="numeric" value={f.loyalty_expiry_months ?? 12} onChange={(e) => setF({ ...f, loyalty_expiry_months: e.target.value.replace(/\D/g, '') })} /></Field>
            <Field label="Products earn points too"><Seg full options={[[false, 'No'], [true, 'Yes']]} value={f.loyalty_products === true} onChange={(v) => setF({ ...f, loyalty_products: v })} /></Field>
          </div>
        </div>
        {err && <p className="err-text">{err}</p>}
        <div><button className="btn primary" onClick={save}>Save settings</button></div>
      </div>
      <div className="stack">
        <div className="eyebrow">Bill preview</div>
        <Receipt bill={sample} items={sampleItems} settings={f} />
      </div>
    </div>
  );
}

function ServiceSettings() {
  const { services, categories, loadServices, loadCategories, askOwner, ownerHere } = useApp();
  const [q, setQ] = useState('');
  const [section, setSection] = useState('Hair');
  const [edit, setEdit] = useState(null);
  const [editCat, setEditCat] = useState(null);
  const [history, setHistory] = useState(false);
  const list = useMemo(() => services.filter((s) => (q ? (s.name + ' ' + s.category).toLowerCase().includes(q.toLowerCase()) : s.section === section)), [services, q, section]);
  const catByName = Object.fromEntries(categories.map((c) => [c.name, c]));
  const cats = [...new Set(list.map((s) => s.category))];
  const reload = () => { loadServices(); loadCategories(); };
  return (
    <div className="stack">
      <div className="row between wrap">
        <div className="chips">{SECTIONS.filter((s) => s === section || categories.some((c) => c.section === s) || services.some((x) => x.section === s)).map((s) => <button key={s} className={'chip sm' + (!q && section === s ? ' on' : '')} onClick={() => { setQ(''); setSection(s); }}>{sectionLabel(s)}</button>)}</div>
        <div className="row wrap">
          <button className="btn line sm" onClick={() => setHistory(true)}><History size={15} /> Change history</button>
          {/* Adding to the menu: the owner only (owner login, or the owner's code here; not Telegram) */}
          {categories.length > 0 && <button className="btn line sm" id="add-category" onClick={async () => { if (await askOwner('Only the owner can add a category.', { codeOnly: true })) setEditCat({ section }); }}><FolderPlus size={15} /> Add category{!ownerHere && <Lock size={12} />}</button>}
          <button className="btn primary sm" id="add-service" onClick={async () => { if (await askOwner('Only the owner can add a service.', { codeOnly: true })) setEdit({ section }); }}><Plus size={15} /> Add service{!ownerHere && <Lock size={12} />}</button>
        </div>
      </div>
      <SearchBox value={q} onChange={setQ} placeholder="Search all services" />
      <p className="muted small">
        Your website shows these same services and prices, so a change here is on the website straight away. Every change needs the owner's OK.
        Price changes apply to new bills only; old bills keep the price they were billed at.
      </p>
      {cats.map((c) => {
        const cat = catByName[c];
        return (
          <div className="card" key={c}>
            <div className="card-head">
              <div>
                <h3>{c}</h3>
                {cat && <div className="tiny muted">{cat.show_on_website ? `Website: ${webPlace(cat)}` : 'Not on the website'}</div>}
              </div>
              {cat && <button className="icon-btn plain sm" aria-label={'Edit category ' + c} onClick={() => setEditCat(cat)}><Pencil size={15} /></button>}
            </div>
            <div className="table-wrap">
              <table>
                <tbody>
                  {list.filter((s) => s.category === c).map((s) => (
                    <tr key={s.id} className="click" onClick={() => setEdit(s)}>
                      <td>
                        {s.name} {!s.active && <span className="pill">Hidden</span>} {s.active && s.show_on_website === false && <span className="pill">Not on website</span>}
                        {s.web_name && s.web_name !== s.name && <div className="tiny muted">Website: {s.web_name}</div>}
                      </td>
                      <td className="small muted">
                        {s.variants ? variantsToText(s.variants) : s.open_price ? `From ${rupee(s.price)} (typed at billing)` : ''}
                        {s.extra_options && s.extra_options.choices && <div className="tiny">{s.extra_options.title}: {s.extra_options.choices.map((c) => `${c.label} +${rupee(c.price)}`).join(', ')}</div>}
                      </td>
                      <td className="r nowrap">{rupee(s.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
      {edit && <ServiceModal service={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {editCat && <CategoryModal category={editCat} onClose={() => setEditCat(null)} onSaved={() => { setEditCat(null); reload(); }} />}
      {history && <ChangeHistory onClose={() => setHistory(false)} />}
    </div>
  );
}

const pageLabel = (k) => (WEB_PAGES.find((x) => x[0] === k) || [k, k])[1];
const webPlace = (c) => [pageLabel(c.web_page || webPageOf(c.section)), c.web_tab].filter(Boolean).join(' › ');
const listText = (a) => (Array.isArray(a) ? a.join(', ') : '');
const textList = (t) => { const a = String(t || '').split(',').map((x) => x.trim()).filter(Boolean); return a.length ? a : null; };

// "Men Cut and Styling: price ₹600 → ₹549 · hidden" — what the owner sees before approving
export function describeService(old, row, catName) {
  if (!old || !old.id) return `Add service ${row.name} at ${rupee(row.price)}${row.variants ? ' (options ' + variantsToText(row.variants) + ')' : ''} · ${catName || row.category || ''}`;
  const parts = [];
  if (row.name !== old.name) parts.push(`name → ${row.name}`);
  const oldP = old.variants ? variantsToText(old.variants) : rupee(old.price);
  const newP = row.variants ? variantsToText(row.variants) : rupee(row.price);
  if (oldP !== newP) parts.push(`price ${oldP} → ${newP}`);
  if ((row.category_id && row.category_id !== old.category_id) || (!row.category_id && row.category !== old.category)) parts.push(`moved to ${catName || row.category}`);
  if (!!row.open_price !== !!old.open_price) parts.push(row.open_price ? 'price typed at billing' : 'fixed price');
  if (Number(row.gst_pct) !== Number(old.gst_pct)) parts.push(`GST ${Number(old.gst_pct)}% → ${Number(row.gst_pct)}%`);
  if (row.active !== (old.active !== false)) parts.push(row.active ? 'shown in billing again' : 'hidden from billing');
  if (row.show_on_website !== (old.show_on_website !== false)) parts.push(row.show_on_website ? 'shown on the website' : 'removed from the website');
  const web = ['web_name', 'subtitle', 'description', 'duration_min', 'for_gender', 'book_online'].filter((k) => JSON.stringify(row[k] ?? null) !== JSON.stringify(old[k] ?? null))
    .concat(JSON.stringify(row.includes || null) !== JSON.stringify(old.includes || null) ? ['includes'] : []);
  if (web.length) parts.push('website details');
  if (JSON.stringify(row.extra_options || null) !== JSON.stringify(old.extra_options || null)) parts.push(row.extra_options ? `${row.extra_options.title}: ${extraToText(row.extra_options)}` : 'extra choice removed');
  if (row.sac !== (old.sac || null)) parts.push('SAC code');
  return `Change ${old.name}: ${parts.join(' · ') || 'no change'}`;
}

function ServiceModal({ service, onClose, onSaved }) {
  const { services, categories, toast, askOwner } = useApp();
  const isNew = !service.id;
  const id = useRef(service.id || uid());
  const firstCat = categories.find((c) => c.section === service.section) || categories[0];
  const [f, setF] = useState({
    name: service.name || '', category_id: service.category_id || (isNew && firstCat ? firstCat.id : ''), category: service.category || '',
    price: service.price != null ? String(Number(service.price)) : '', options: variantsToText(service.variants),
    open_price: !!service.open_price, gst_pct: service.gst_pct != null ? String(Number(service.gst_pct)) : '5',
    sac: service.sac || '', active: service.active !== false,
    show_on_website: service.show_on_website !== false, book_online: service.book_online !== false,
    web_name: service.web_name || '', subtitle: service.subtitle || '', includes: listText(service.includes),
    duration_min: service.duration_min ? String(service.duration_min) : '', for_gender: service.for_gender || 'any', description: service.description || '',
    extra_title: (service.extra_options && service.extra_options.title) || '', extra: extraToText(service.extra_options),
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  const oldCats = [...new Set(services.map((s) => s.category))];
  const variants = parseVariants(f.options);
  const catName = (categories.find((c) => c.id === f.category_id) || {}).name || f.category;

  const save = async () => {
    setErr('');
    if (!f.name.trim() || !(categories.length ? f.category_id : f.category.trim())) return setErr('Enter a name and choose a category.');
    if (f.options.trim() && !variants) return setErr('Options need at least two prices, like  S:2500, M:3000, L:3500');
    const extra = f.extra.trim() ? parseExtra(f.extra) : null;
    if (f.extra.trim() && !extra) return setErr('Extra choice: name and price, like  Thick:500  (up to 5, separated by commas).');
    if (extra && !f.extra_title.trim()) return setErr('Give the extra choice a title, e.g. Hair thickness.');
    const dur = f.duration_min ? Number(f.duration_min) : null;
    if (dur != null && !(dur >= 5 && dur <= 720)) return setErr('Time taken: 5 to 720 minutes, or leave it empty.');
    const row = {
      name: f.name.trim(), variants: variants || null,
      price: variants ? Math.min(...variants.map((v) => v.price)) : Number(f.price) || 0,
      open_price: f.open_price, gst_pct: Number(f.gst_pct) || 0, sac: f.sac.trim() || null, active: f.active,
      show_on_website: f.show_on_website, book_online: f.book_online, web_name: f.web_name.trim() || null, subtitle: f.subtitle.trim() || null,
      includes: textList(f.includes), duration_min: dur, for_gender: f.for_gender, description: f.description.trim() || null,
      extra_options: extra ? { title: f.extra_title.trim(), choices: extra } : null,
      ...(categories.length ? { category_id: f.category_id } : { category: f.category.trim(), section: service.section || 'Hair' }),
    };
    const detail = describeService(isNew ? null : service, row, catName);
    if (!isNew && /: no change$/.test(detail)) return onClose();
    const g = isNew
      ? await askOwner('Only the owner can add a service.', { codeOnly: true, detail })
      : await askOwner('Changing services and prices needs the owner. This is also what the website shows.', { action: 'service', ref: id.current, detail, fresh: true });
    if (!g) return;
    setBusy(true);
    try {
      await db.rpc('save_service', { p: { id: id.current, ...row, owner_grant_id: typeof g === 'string' ? g : '' } });
      toast(isNew ? 'Service added' : 'Service saved', 'ok');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={isNew ? 'Add service' : f.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack loose">
        <div className="form-grid">
          <Field label="Service name (on the bill)" className="span2"><input className="input" id="sv-name" value={f.name} onChange={set('name')} /></Field>
          {categories.length ? (
            <Field label="Category" className="span2">
              <select className="select" id="sv-cat" value={f.category_id} onChange={set('category_id')}>
                {SECTIONS.map((sec) => (
                  <optgroup key={sec} label={sectionLabel(sec)}>
                    {categories.filter((c) => c.section === sec).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Category" className="span2">
              <input className="input" id="sv-cat" list="sv-cats" value={f.category} onChange={set('category')} />
              <datalist id="sv-cats">{oldCats.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
          )}
          <Field label="Price options" className="span2" hint="For services with sizes or lengths, e.g.  S:2500, M:3000, L:3500  or  Oriental:900, Deluxe:1000. Leave empty for one price.">
            <input className="input" id="sv-opts" value={f.options} onChange={set('options')} />
          </Field>
          {!variants && <Field label={f.open_price ? 'Starting price' : 'Price'}><MoneyInput id="sv-price" value={f.price} onChange={set('price')} /></Field>}
          {!variants && (
            <label className="check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={f.open_price} onChange={(e) => setF({ ...f, open_price: e.target.checked })} /> Price is typed at billing ("onwards")
            </label>
          )}
          <Field label="Extra choice at billing" hint="Optional, e.g. Hair thickness">
            <input className="input" id="sv-extra-title" value={f.extra_title} onChange={set('extra_title')} placeholder="Hair thickness" />
          </Field>
          <Field label="Its prices (added to the price)" hint="Normal is free. e.g.  Thick:500  or  Thick:500, Extra thick:1000">
            <input className="input" id="sv-extra" value={f.extra} onChange={set('extra')} placeholder="Thick:500" />
          </Field>
          <Field label="GST %"><input className="input" id="sv-gst" inputMode="decimal" value={f.gst_pct} onChange={(e) => setF({ ...f, gst_pct: e.target.value.replace(/[^\d.]/g, '') })} /></Field>
          <Field label="SAC code"><input className="input" id="sv-sac" value={f.sac} onChange={set('sac')} /></Field>
          <label className="check span2"><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> Hide from billing and the website (service stopped)</label>
        </div>
        <div className="sub-card stack">
          <div className="row between wrap">
            <b className="small">On the website</b>
            <label className="check"><input type="checkbox" id="sv-web" checked={f.show_on_website} onChange={(e) => setF({ ...f, show_on_website: e.target.checked })} /> Show on the website</label>
          </div>
          {f.show_on_website && (
            <div className="form-grid">
              <Field label="Name on the website" hint="Leave empty to use the bill name"><input className="input" id="sv-webname" value={f.web_name} onChange={set('web_name')} placeholder={f.name} /></Field>
              <Field label="One line under the name"><input className="input" id="sv-sub" value={f.subtitle} onChange={set('subtitle')} placeholder="e.g. With wash and blow-dry" /></Field>
              <Field label="What's included" className="span2" hint="Separate with commas"><input className="input" id="sv-inc" value={f.includes} onChange={set('includes')} placeholder="e.g. Consultation, Wash, Blow-dry" /></Field>
              <Field label="Time taken (minutes)"><input className="input" id="sv-dur" inputMode="numeric" value={f.duration_min} onChange={(e) => setF({ ...f, duration_min: e.target.value.replace(/\D/g, '') })} /></Field>
              <Field label="For"><Seg full options={[['any', 'Everyone'], ['women', 'Women'], ['men', 'Men']]} value={f.for_gender} onChange={set('for_gender')} /></Field>
              <Field label="Description" className="span2"><textarea className="textarea" id="sv-desc" value={f.description} onChange={set('description')} /></Field>
              <label className="check span2"><input type="checkbox" checked={f.book_online} onChange={(e) => setF({ ...f, book_online: e.target.checked })} /> Customers can book it online</label>
            </div>
          )}
        </div>
      </div>
      {err && <p className="err-text" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

function describeCategory(old, row) {
  if (!old || !old.id) return `Add category ${row.name} (${row.section})`;
  const parts = [];
  if (row.name !== old.name) parts.push(`rename to ${row.name}`);
  if (row.section !== old.section) parts.push(`move to ${row.section}`);
  if (row.show_on_website !== (old.show_on_website !== false)) parts.push(row.show_on_website ? 'show on the website' : 'remove from the website');
  if (['web_page', 'web_tab', 'web_type', 'description', 'note', 'image', 'consult_only', 'sort'].some((k) => JSON.stringify(row[k] ?? null) !== JSON.stringify(old[k] ?? null))) parts.push('website details');
  return `Change category ${old.name}: ${parts.join(' · ') || 'no change'}`;
}

function CategoryModal({ category, onClose, onSaved }) {
  const { categories, toast, askOwner } = useApp();
  const isNew = !category.id;
  const id = useRef(category.id || uid());
  const [f, setF] = useState({
    name: category.name || '', section: category.section || 'Hair', sort: category.sort != null ? String(category.sort) : '',
    web_page: category.web_page || webPageOf(category.section || 'Hair'), web_tab: category.web_tab || '', web_type: category.web_type || '',
    description: category.description || '', note: category.note || '', image: category.image || '',
    consult_only: !!category.consult_only, show_on_website: category.show_on_website !== false,
  });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e && e.target ? e.target.value : e });
  const tabs = WEB_TABS[f.web_page] || [];
  const save = async () => {
    setErr('');
    if (!f.name.trim()) return setErr('Enter the category name.');
    if (categories.some((c) => c.id !== id.current && c.name.toLowerCase() === f.name.trim().toLowerCase())) return setErr('There is already a category with that name.');
    const row = {
      name: f.name.trim(), section: f.section, ...(f.sort !== '' ? { sort: Number(f.sort) || 0 } : {}),
      web_page: f.web_page || null, web_tab: f.web_tab.trim() || null, web_type: f.web_type || null, description: f.description.trim() || null,
      note: f.note.trim() || null, image: f.image.trim() || null, consult_only: f.consult_only, show_on_website: f.show_on_website,
    };
    const detail = describeCategory(isNew ? null : category, row);
    if (!isNew && /: no change$/.test(detail)) return onClose();
    const g = isNew
      ? await askOwner('Only the owner can add a category.', { codeOnly: true, detail })
      : await askOwner('Changing the menu needs the owner. This is also what the website shows.', { action: 'service', ref: id.current, detail, fresh: true });
    if (!g) return;
    setBusy(true);
    try {
      await db.rpc('save_service_category', { p: { id: id.current, ...row, owner_grant_id: typeof g === 'string' ? g : '' } });
      toast(isNew ? 'Category added' : 'Category saved', 'ok');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal wide title={isNew ? 'Add category' : f.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Close</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack loose">
        <div className="form-grid">
          <Field label="Category name" hint="On bills, reports and the website"><input className="input" id="ct-name" value={f.name} onChange={set('name')} /></Field>
          <Field label="Billing screen tab">
            <select className="select" id="ct-tab" value={f.section} onChange={set('section')}>
              {SECTIONS.map((x) => <option key={x} value={x}>{sectionLabel(x)}</option>)}
            </select>
          </Field>
          <Field label="Order" hint="Smaller numbers come first"><input className="input" id="ct-sort" inputMode="numeric" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value.replace(/\D/g, '') })} /></Field>
        </div>
        <div className="sub-card stack">
          <div className="row between wrap">
            <b className="small">On the website</b>
            <label className="check"><input type="checkbox" id="ct-web" checked={f.show_on_website} onChange={(e) => setF({ ...f, show_on_website: e.target.checked })} /> Show on the website</label>
          </div>
          {f.show_on_website && (
            <div className="form-grid">
              <Field label="Page">
                <select className="select" id="ct-page" value={f.web_page} onChange={(e) => setF({ ...f, web_page: e.target.value, web_tab: (WEB_TABS[e.target.value] || []).includes(f.web_tab) ? f.web_tab : '' })}>
                  {WEB_PAGES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
              <Field label="Tab on that page">
                <input className="input" id="ct-tab" list="ct-tabs" value={f.web_tab} onChange={set('web_tab')} placeholder={tabs[0] || 'None'} />
                <datalist id="ct-tabs">{tabs.map((t) => <option key={t} value={t} />)}</datalist>
              </Field>
              <Field label="Type (filter on the Services page)">
                <select className="select" id="ct-type" value={f.web_type} onChange={set('web_type')}>
                  <option value="">None</option>
                  {WEB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Picture" hint="Image name or link"><input className="input" id="ct-img" value={f.image} onChange={set('image')} placeholder="e.g. cat-hair" /></Field>
              <Field label="Description" className="span2"><textarea className="textarea" id="ct-desc" value={f.description} onChange={set('description')} /></Field>
              <Field label="Small print" className="span2"><input className="input" id="ct-note" value={f.note} onChange={set('note')} placeholder="e.g. Patch test 48 hours before any first colour" /></Field>
              <label className="check span2"><input type="checkbox" checked={f.consult_only} onChange={(e) => setF({ ...f, consult_only: e.target.checked })} /> Show "Book consultation" (prices depend on the person)</label>
            </div>
          )}
        </div>
      </div>
      {err && <p className="err-text" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

const FIELD_LABEL = {
  name: 'Name', price: 'Price', variants: 'Options', open_price: 'Price typed at billing', gst_pct: 'GST %', sac: 'SAC', active: 'In billing',
  category_id: 'Category', sort: 'Order', web_name: 'Website name', subtitle: 'Line under the name', includes: "What's included",
  description: 'Description', duration_min: 'Minutes', for_gender: 'For', show_on_website: 'On the website', book_online: 'Online booking',
  featured: 'Featured', section: 'Tab', web_page: 'Website page', web_tab: 'Website tab', web_type: 'Website type', note: 'Small print',
  image: 'Picture', consult_only: 'Book consultation', extra_options: 'Extra choice',
};

function ChangeHistory({ onClose }) {
  const { categories } = useApp();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    db.list('service_changes', { order: ['created_at', 'desc'], limit: 200 }).then(setRows).catch(() => setRows([]));
  }, []);
  const catName = (cid) => (categories.find((c) => c.id === cid) || {}).name || '–';
  const show = (k, v) => {
    if (v == null || v === '') return '–';
    if (k === 'price') return rupee(v);
    if (k === 'variants') return variantsToText(v);
    if (k === 'extra_options') return `${v.title}: ${extraToText(v)}`;
    if (k === 'category_id') return catName(v);
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (Array.isArray(v)) return v.join(', ');
    return String(v).length > 60 ? String(v).slice(0, 57) + '…' : String(v);
  };
  return (
    <Modal wide title="Change history: services and prices" onClose={onClose}>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty title="No changes yet">Every change to a service or category is listed here, with who made it and who approved it.</Empty> : (
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>When</th><th>What</th><th>Change</th><th>Approved by</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap small">{fmtDateTime(r.created_at)}</td>
                  <td><div className="strong">{r.item}</div><div className="tiny muted">{r.action === 'add' ? 'Added' : 'Changed'} {r.kind === 'category' ? 'category' : 'service'} · {r.changed_by}</div></td>
                  <td className="small">
                    {Object.entries(r.changes || {}).map(([k, [a, b]]) => (
                      <div key={k}>{FIELD_LABEL[k] || k}: {r.action === 'add' ? show(k, b) : `${show(k, a)} → ${show(k, b)}`}</div>
                    ))}
                  </td>
                  <td className="small">{r.approved_by || '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

function DataSettings({ onSignOut }) {
  const { toast, user, reloadAll, settings } = useApp();
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [letter, setLetter] = useState(getDeviceLetter());
  const [printMethod, setPm] = useState(getPrintMethod());
  const testPrint = () => {
    if (window.self !== window.top) return toast('Printing works in the installed app. This preview cannot print.');
    printBill(
      { bill_no: 'TEST-0001', created_at: new Date().toISOString(), customer_name: 'Test print', subtotal: 600, discount: 0, taxable: 600, cgst: 0, sgst: 0, round_off: 0, total: 600, pay_mode: 'Cash', status: 'paid' },
      [{ id: 1, name: 'Men Cut and Styling', qty: 1, amount: 600, staff_name: 'Stylist', gst_pct: 0, gst: 0, taxable: 600 }],
      settings
    );
  };
  const saveLetter = () => {
    if (!/^[A-Z]$/.test(letter)) return toast('Use one letter, A to Z', 'bad');
    setDeviceLetter(letter);
    toast('Offline bills on this device will be numbered like HF2627-' + letter + '0001', 'ok');
  };
  const signOut = async () => {
    try { await onSignOut(); } catch (e) { toast(e.message, 'bad'); }
  };
  const backup = async () => {
    if (!canDownload()) return toast(NO_DOWNLOAD);
    setBusy(true);
    try {
      const tables = ['settings', 'service_categories', 'services', 'offers', 'service_usage', 'service_changes', 'customers', 'bookings', 'booking_items',
        'staff', 'attendance', 'staff_advances', 'payslips', 'products', 'stock_moves', 'bills', 'bill_items', 'counters'];
      const out = { exported_at: new Date().toISOString() };
      for (const t of tables) {
        // tables added later may be missing on an older database
        try { out[t] = await db.list(t, { order: [t === 'settings' || t === 'counters' ? 'key' : t === 'attendance' ? 'day' : t === 'booking_items' ? 'id' : 'created_at', 'asc'] }); } catch (e) { if (['bills', 'bill_items', 'customers'].includes(t)) throw e; }
      }
      downloadFile(`habibs-pos-backup-${istDay()}.json`, JSON.stringify(out, null, 1), 'application/json');
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="stack loose" style={{ maxWidth: 640 }}>
      <div className="card card-pad stack">
        <h3>Where the data lives</h3>
        {IS_DEMO ? (
          <p className="small">Demo mode. Everything is saved only in this browser on this device, and the sample bills, staff and products are made up. Connect a Supabase database (see the README) before the salon uses it for real.</p>
        ) : (
          <p className="small">Live database on Supabase. Signed in as <b>{user && user.email}</b>. Every device that signs in sees the same data.</p>
        )}
      </div>
      <div className="card card-pad stack">
        <h3>Backup</h3>
        <p className="small muted">Downloads every table as one file. Keep a copy every week on Google Drive. (The automatic daily backup is set up separately, see the README.)</p>
        <div><button className="btn line" disabled={busy} onClick={backup}><Download size={15} /> {busy ? 'Preparing…' : 'Download full backup'}</button></div>
      </div>
      <div className="card card-pad stack">
        <h3>Receipt printing on this device</h3>
        <Seg full options={[['browser', 'Print window'], ['rawbt', 'RawBT app (Android)']]} value={printMethod} onChange={(v) => { setPm(v); setPrintMethod(v); }} />
        <p className="small muted">
          {printMethod === 'rawbt'
            ? 'One tap prints the bill. Install "RawBT" from the Play Store, connect the thermal printer in RawBT (Bluetooth or USB), and turn on auto-cut there if your printer has a cutter.'
            : 'Opens the print window. Best on a Windows laptop with a USB thermal printer set as the default printer.'}
        </p>
        <div><button className="btn line" onClick={testPrint}>Print a test receipt</button></div>
      </div>
      {IS_DEMO ? (
        <div className="card card-pad stack">
          <h3>Start the demo again</h3>
          <p className="small muted">Deletes everything you entered in the demo and loads fresh sample data.</p>
          <div><button className="btn danger" onClick={() => setReset(true)}><RotateCcw size={15} /> Reset demo data</button></div>
        </div>
      ) : (
        <>
          <div className="card card-pad stack">
            <h3>This device</h3>
            <p className="small muted">
              When the internet is down, bills made on this device get their own numbers with this letter, like HF2627-{letter || 'A'}0001.
              If you bill on two devices, give each one a different letter.
            </p>
            <div className="row">
              <input className="input" id="dev-letter" style={{ width: 70, textAlign: 'center' }} maxLength={1} value={letter} onChange={(e) => setLetter(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} aria-label="Device letter" />
              <button className="btn line" onClick={saveLetter}>Save letter</button>
            </div>
          </div>
          <div><button className="btn line" onClick={signOut}><LogOut size={15} /> Sign out of this device</button></div>
        </>
      )}
      {reset && (
        <Confirm title="Reset demo data?" text="Everything entered in this demo will be replaced with fresh sample data." okLabel="Reset" danger onClose={() => setReset(false)}
          onOk={async () => {
            const d = await getDb();
            await d.resetDemo();
            try { localStorage.removeItem('habibs-pos-draft'); } catch { /* ignore */ }
            setReset(false);
            await reloadAll();
            toast('Demo data reset', 'ok');
          }} />
      )}
    </div>
  );
}
