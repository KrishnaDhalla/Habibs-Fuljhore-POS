import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Minus, X, Smartphone, Banknote, CreditCard, Split, ReceiptText, UserRound, RotateCcw, Tag, Star, History, Lock, Percent, BadgeCheck, MessageCircle } from 'lucide-react';
import QRCode from 'qrcode';
import { db } from '../lib/db';
import { useApp } from '../store';
import { calcBill, checkBill } from '../lib/calc';
import { applyOffers, istNow, offerLive, offerCovers, offerSaving } from '../lib/offers';
import { SIZE_HINT, SECTIONS, sectionLabel } from '../data/menu';
import { rupee, round2, cleanPhone, validPhone, fmtPhone, fmtDate, daysSince, uid, istDay, addDays, dayRangeISO } from '../lib/format';
import { Modal, Field, SearchBox, MoneyInput, cleanMoney } from '../components/ui';
import { BillView } from '../components/BillView';
import { loyaltyRules, earnPoints, maxPointsUse, liveBalance, expiresAt, isStaffPhone } from '../lib/loyalty';
import { staffOfPhone, staffPriceRules, staffPctOf } from '../lib/staffPrice';
import { waBillsOn } from '../lib/whatsapp';

const DRAFT_KEY = 'habibs-pos-draft';
const EMPTY_NEW = { name: '', gender: '', whatsapp_ok: false };

function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY)) || {}; } catch { return {}; }
}

const norm = (s) => String(s).toLowerCase().replace(/colour/g, 'color').replace(/make-?up/g, 'makeup').replace(/[^a-z0-9 ]/g, ' ');

function priceLabel(s) {
  if (s.variants && s.variants.length) {
    const ps = s.variants.map((v) => v.price);
    const lo = Math.min(...ps), hi = Math.max(...ps);
    return lo === hi ? rupee(lo) : `${rupee(lo)} – ${rupee(hi).slice(1)}`;
  }
  if (s.open_price) return Number(s.price) ? `From ${rupee(s.price)}` : 'Enter price';
  return rupee(s.price);
}

const toTop = () => {
  window.scrollTo(0, 0);
  const m = document.querySelector('.main');
  if (m) m.scrollTo(0, 0);
};

// The service tiles. Redrawn only when the menu, the search or the bill items change.
const MenuTiles = memo(function MenuTiles({ shown, inCart, q, onService, onProduct, tags = {} }) {
  return (
    <>
      {shown.groups.map(([title, list, short]) => (
        <div key={title}>
          <div className="cat-title">{title}</div>
          {list.length ? (
            <div className="tiles">
              {list.map((s) => (
                // Under its heading a tile can use the shorter name ("Full Arms" under Raaga D-Tan); the bill has the full one
                <button key={s.id} className="tile" title={s.name} onClick={() => onService(s)}>
                  <span className="n">{short && s.web_name ? s.web_name : s.name}</span>
                  <span className="p">{priceLabel(s)}</span>
                  {tags[s.id] ? <span className="offer-tag" title={tags[s.id].name}>{tags[s.id].label}</span> : null}
                  {inCart[s.id] ? <span key={inCart[s.id]} className="badge">{inCart[s.id]}</span> : null}
                </button>
              ))}
            </div>
          ) : (
            <p className="muted small">No service matches “{q}”. Check the spelling or try one word.</p>
          )}
        </div>
      ))}
      {shown.products.length > 0 && (
        <div>
          <div className="cat-title">Products for sale</div>
          <div className="tiles">
            {shown.products.map((p) => (
              <button key={p.id} className={'tile' + (Number(p.stock) <= 0 ? ' out' : '')} onClick={() => onProduct(p)}>
                <span className="n">{p.name}</span>
                <span className="p">{rupee(p.sell_price)} · {Number(p.stock) <= 0 ? 'out of stock' : `${Number(p.stock)} left`}</span>
                {inCart[p.id] ? <span key={inCart[p.id]} className="badge">{inCart[p.id]}</span> : null}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
});

export default function Billing({ hasBanner }) {
  const { services, staff, products, offers, settings, gstOn, toast, askOwner, ownerHere, loadProducts, user } = useApp();
  const draft = useRef(loadDraft()).current;

  const [q, setQ] = useState('');
  const [section, setSection] = useState(draft.section || 'Hair');
  const [phone, setPhone] = useState(draft.phone || '');
  const [skip, setSkip] = useState(!!draft.skip);
  const [cust, setCust] = useState(null);
  const [lookup, setLookup] = useState('idle');
  const [suggest, setSuggest] = useState([]); // customers whose number starts with the digits typed so far
  const [findName, setFindName] = useState(false);
  const [staffPick, setStaffPick] = useState(false);
  const [lastVisit, setLastVisit] = useState(null);
  const [newCust, setNewCust] = useState(draft.newCust || EMPTY_NEW);
  const [editName, setEditName] = useState('');
  const [curStaff, setCurStaff] = useState(draft.curStaff || '');
  const [lines, setLines] = useState(draft.lines || []);
  const [discType, setDiscType] = useState(draft.discType || 'pct');
  const [discVal, setDiscVal] = useState(draft.discVal || '');
  const [payMode, setPayMode] = useState(draft.payMode || '');
  const [cashGiven, setCashGiven] = useState('');
  const [split, setSplit] = useState({ cash: '', upi: '', card: '' });
  const [note, setNote] = useState('');
  // A discount on one line: the key of the line whose discount is open
  const [lineEdit, setLineEdit] = useState(null);
  // A past bill (owner only): { date, time, paper } while the owner types in a bill from before
  const [past, setPast] = useState(draft.past || null);
  const [picker, setPicker] = useState(null); // {service, mode:'variant'|'price'}
  const [openPrice, setOpenPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const [waSend, setWaSend] = useState(true); // send this bill on WhatsApp (when WhatsApp bills are on in Settings)
  const [showBill, setShowBill] = useState(false);
  const [popular, setPopular] = useState([]);
  const [qr, setQr] = useState('');
  const [tried, setTried] = useState(false);
  // Loyalty points used on this bill: on/off and how many (empty = as many as allowed)
  const [ptsOn, setPtsOn] = useState(false);
  const [ptsVal, setPtsVal] = useState('');
  const [netOn, setNetOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setNetOn(true);
    const off = () => setNetOn(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const searchRef = useRef();
  const billScroll = useRef();
  const savingRef = useRef(false);
  const approvedDisc = useRef(null); // the owner's approval for this bill's discount
  // This bill's id, kept with the draft: saving it again (double tap, retry, page reload) returns the same bill
  const billId = useRef(draft.billId || uid());

  // Bring the payment details (QR, cash return) into view when a payment mode is picked
  useEffect(() => {
    if (payMode && billScroll.current) billScroll.current.scrollTo({ top: billScroll.current.scrollHeight, behavior: 'smooth' });
  }, [payMode, qr]);

  const activeStaff = useMemo(() => staff.filter((s) => s.active), [staff]);
  const activeServices = useMemo(() => services.filter((s) => s.active), [services]);
  const retail = useMemo(() => products.filter((p) => p.active && p.kind === 'retail'), [products]);

  // Keep the bill if the page is refreshed
  useEffect(() => {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ section, phone, skip, newCust, curStaff, lines, discType, discVal, payMode, billId: billId.current, past }));
    } catch { /* ignore */ }
  }, [section, phone, skip, newCust, curStaff, lines, discType, discVal, payMode, past]);

  // Only one staff member? Pick them automatically.
  useEffect(() => {
    if (!curStaff && activeStaff.length === 1) setCurStaff(activeStaff[0].id);
  }, [activeStaff, curStaff]);

  // Most-billed services in the last 30 days
  const loadPopular = async () => {
    try {
      const [from] = dayRangeISO(addDays(istDay(), -30));
      const rows = await db.list('bill_items', { eq: { item_type: 'service' }, gte: { created_at: from } });
      const count = {};
      for (const r of rows) if (r.service_id) count[r.service_id] = (count[r.service_id] || 0) + 1;
      let ids = Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([id]) => id);
      // Keep the last list on this device, so "Popular" still works without internet
      try {
        if (ids.length) localStorage.setItem('pos-popular', JSON.stringify(ids));
        else ids = JSON.parse(localStorage.getItem('pos-popular') || '[]');
      } catch { /* ignore */ }
      setPopular(ids);
    } catch { /* not important */ }
  };
  useEffect(() => { loadPopular(); }, []);
  useEffect(() => {
    if (popular.length && !draft.section) setSection('Popular');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [popular.length > 0]);

  // Customer lookup when 10 digits are typed
  useEffect(() => {
    let live = true;
    setCust(null);
    setLastVisit(null);
    setPtsOn(false);
    setPtsVal('');
    if (!validPhone(phone)) { setLookup(phone.length === 10 ? 'invalid' : 'idle'); return; }
    setLookup('loading');
    (async () => {
      try {
        const [c] = await db.list('customers', { eq: { phone }, limit: 1 });
        if (!live) return;
        if (c) {
          setCust(c);
          setEditName(c.name || '');
          setLookup('found');
          const [b] = await db.list('bills', { eq: { customer_id: c.id, status: 'paid' }, order: ['created_at', 'desc'], limit: 1 });
          if (b && live) {
            const its = await db.list('bill_items', { eq: { bill_id: b.id } });
            if (live) setLastVisit({ bill: b, items: its });
          }
        } else {
          setLookup('new');
        }
      } catch (e) {
        if (live) { setLookup('error'); toast(e.message, 'bad'); }
      }
    })();
    return () => { live = false; };
  }, [phone, toast]);

  // While the number is being typed (4–9 digits): show saved customers whose number starts with it
  useEffect(() => {
    if (skip || phone.length < 4 || phone.length >= 10) { setSuggest([]); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const rows = await db.list('customers', { like: { phone: phone + '%' }, order: ['last_visit', 'desc'], limit: 5 });
        if (live) setSuggest(rows);
      } catch { if (live) setSuggest([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [phone, skip]);

  const staffName = (id) => (staff.find((s) => s.id === id) || {}).name || '';

  // ---------- offers ----------
  // The clock is checked every 30 seconds, so an offer starts and stops on time by itself
  const [now, setNow] = useState(istNow);
  useEffect(() => {
    const t = setInterval(() => setNow((n) => { const x = istNow(); return x.time === n.time && x.day === n.day ? n : x; }), 30000);
    return () => clearInterval(t);
  }, []);
  const [offersOn, setOffersOn] = useState(true);
  const servicesById = useMemo(() => Object.fromEntries(services.map((s) => [s.id, s])), [services]);
  // A staff member's own bill (their mobile number): services free or 50% off (Settings), no offers, no points.
  // Whoever does the service still earns commission on the full price.
  const staffFor = useMemo(() => staffOfPhone(!skip && validPhone(phone) ? phone : '', staff), [phone, skip, staff]);
  const sRules = useMemo(() => staffPriceRules(settings || {}), [settings]);
  const withStaff = (ls) => (staffFor
    ? ls.map((l) => (l.item_type === 'service'
      ? { ...l, staff: true, disc_type: 'pct', disc_value: String(staffPctOf((servicesById[l.service_id] || {}).section, sRules)), offer_discount: 0, offer_id: '', offer_name: '' }
      : l))
    : ls);
  const liveOffers = useMemo(() => (offers || []).filter((o) => offerLive(o, now)), [offers, now]);
  // A staff member's number billed for the first time: their name is filled in
  useEffect(() => {
    if (staffFor && lookup === 'new' && !newCust.name) setNewCust((c) => ({ ...c, name: staffFor.name }));
  }, [staffFor, lookup]);
  // "First visit only" offers: a new number, or a saved customer who has never paid a bill
  const newForOffers = !skip && (lookup === 'new' || (lookup === 'found' && !!cust && !Number(cust.visits)));
  const offerResult = useMemo(
    () => applyOffers(lines, liveOffers, { now, servicesById, isNew: newForOffers, enabled: offersOn && !past && !staffFor }),
    [lines, liveOffers, now, servicesById, newForOffers, offersOn, past, staffFor]
  );
  // Small tag on each tile that has an offer running right now
  const tileTags = useMemo(() => {
    const tags = {};
    if (!liveOffers.length) return tags;
    for (const s of services) {
      let best = null;
      let bestSaving = 0;
      for (const o of liveOffers) {
        if (!offerCovers(o, { item_type: 'service', service_id: s.id }, s)) continue;
        const saving = offerSaving(o, s.price || 1000, 1);
        if (saving > bestSaving) { best = o; bestSaving = saving; }
      }
      if (best) {
        const label = best.kind === 'percent' ? `−${Number(best.value)}%` : best.kind === 'amount' ? `−₹${Number(best.value)}` : `₹${Number(best.value)}`;
        tags[s.id] = { label: label + (Number(best.min_bill) || best.new_customers_only ? '*' : ''), name: best.name };
      }
    }
    return tags;
  }, [liveOffers, services]);

  const bill = useMemo(
    () => calcBill(withStaff(offerResult.lines), { discountType: discType, discountValue: Number(discVal) || 0, gstOn, inclusive: settings ? settings.prices_include_gst !== false : true }),
    [offerResult, discType, discVal, gstOn, settings, staffFor, sRules, servicesById]
  );

  // ---------- loyalty points ----------
  const rules = useMemo(() => loyaltyRules(settings), [settings]);
  const custPhone = !skip && validPhone(phone) ? phone : null;
  const staffNumber = isStaffPhone(custPhone, staff);
  const balance = lookup === 'found' && cust ? liveBalance(cust, rules) : 0;
  // Points need the internet (the balance must be the latest, so the same points can't be used twice)
  const maxUse = netOn && !staffNumber && !past ? maxPointsUse(balance, bill.total, rules) : 0;
  const pointsUsed = ptsOn && maxUse > 0 ? Math.max(0, Math.min(maxUse, ptsVal === '' ? maxUse : Math.trunc(Number(ptsVal) || 0))) : 0;
  const toPay = round2(bill.total - pointsUsed);
  const earnPreview = lines.length && custPhone ? earnPoints({ total: bill.total, paid_cash: toPay, items: bill.items }, rules, { phone: custPhone, staff }) : 0;

  // UPI QR for the exact amount
  useEffect(() => {
    const upi = settings && settings.upi_id;
    const amt = payMode === 'UPI' ? toPay : payMode === 'Split' ? Number(split.upi) || 0 : 0;
    if (!upi || !amt) { setQr(''); return; }
    const link = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(settings.salon_name || 'Habibs')}&am=${amt.toFixed(2)}&cu=INR&tn=${encodeURIComponent('Salon bill')}`;
    QRCode.toDataURL(link, { margin: 1, width: 264 }).then(setQr).catch(() => setQr(''));
  }, [payMode, toPay, split.upi, settings]);

  // ---------- adding items ----------
  const addLine = (l) => {
    setLines((ls) => [...ls, { key: uid(), qty: 1, staff_id: curStaff || '', ...l }]);
  };
  const tapService = (s) => {
    if ((s.variants && s.variants.length) || (s.extra_options && s.extra_options.choices)) return setPicker({ service: s, mode: 'variant', extra: -1 });
    if (s.open_price) { setOpenPrice(Number(s.price) ? String(s.price) : ''); return setPicker({ service: s, mode: 'price' }); }
    addService(s, Number(s.price));
  };
  // variant: the option (S, M, L, XL…); extra: the second choice, e.g. thick hair +₹500 → "Keratin / Cysteine (L · Thick)"
  const addService = (s, price, variant, extra) => {
    const tags = [variant && variant.label, extra && extra.label].filter(Boolean);
    addLine({
      item_type: 'service', service_id: s.id, category: s.category, hsn_sac: s.sac || '',
      name: s.name + (tags.length ? ` (${tags.join(' · ')})` : ''),
      unit_price: round2(Number(price) + (extra ? Number(extra.price) || 0 : 0)), gst_pct: Number(s.gst_pct) || 0,
    });
    setPicker(null);
  };
  const tapProduct = (p) => {
    const existing = lines.find((l) => l.product_id === p.id);
    if (existing) return setLines((ls) => ls.map((l) => (l === existing ? { ...l, qty: l.qty + 1 } : l)));
    addLine({ item_type: 'product', product_id: p.id, category: 'Products', hsn_sac: p.hsn || '', name: p.name, unit_price: Number(p.sell_price), gst_pct: Number(p.gst_pct) || 0 });
  };
  const chooseStaff = (id) => {
    setCurStaff(id);
    // Lines without a staff member get this one
    setLines((ls) => ls.map((l) => (l.staff_id ? l : { ...l, staff_id: id })));
  };

  const inCart = useMemo(() => {
    const m = {};
    for (const l of lines) {
      const k = l.service_id || l.product_id;
      m[k] = (m[k] || 0) + (l.product_id ? l.qty : 1);
    }
    return m;
  }, [lines]);

  // ---------- menu filtering ----------
  // Typing stays instant; the tile list catches up a moment later
  const dq = useDeferredValue(q);
  // Stable tap handlers, so typing a phone number doesn't redraw 130 tiles
  const handlers = useRef();
  handlers.current = { tapService, tapProduct };
  const onService = useCallback((sv) => handlers.current.tapService(sv), []);
  const onProduct = useCallback((p) => handlers.current.tapProduct(p), []);
  // Only tabs with services in billing (a tab the owner empties disappears; one they fill appears).
  // "Popular" needs some billing history; until then (or for a tab that has gone) the first tab shows.
  const usedTabs = SECTIONS.filter((x) => activeServices.some((s) => s.section === x));
  const sectionTabs = [...(popular.length ? ['Popular'] : []), ...(usedTabs.length ? usedTabs : ['Hair']), ...(retail.length ? ['Products'] : [])];
  const activeSection = sectionTabs.includes(section) ? section : sectionTabs[popular.length ? 1 : 0];
  const groupSection = (sec) => {
    const groups = [];
    for (const s of activeServices.filter((x) => x.section === sec)) {
      const g = groups.find((x) => x[0] === s.category);
      if (g) g[1].push(s); else groups.push([s.category, [s], true]);
    }
    return groups;
  };
  const shown = useMemo(() => {
    const words = norm(dq).split(/\s+/).filter(Boolean);
    if (words.length) {
      const svc = activeServices.filter((s) => words.every((w) => norm(s.name + ' ' + s.category).includes(w)));
      const prod = retail.filter((p) => words.every((w) => norm(p.name + ' ' + (p.brand || '')).includes(w)));
      return { groups: [['Results', svc]], products: prod };
    }
    if (activeSection === 'Products') return { groups: [], products: retail };
    if (activeSection === 'Popular') {
      const byId = Object.fromEntries(activeServices.map((s) => [s.id, s]));
      return { groups: [['Most billed in the last 30 days', popular.map((id) => byId[id]).filter(Boolean)]], products: [] };
    }
    return { groups: groupSection(activeSection), products: [] };
  }, [dq, activeSection, activeServices, retail, popular]);

  // ---------- payment & validation ----------
  const splitSum = round2((Number(split.cash) || 0) + (Number(split.upi) || 0) + (Number(split.card) || 0));
  const maxDisc = Number(settings && settings.max_discount_pct) || 0;
  const problems = [];
  if (!lines.length) problems.push('Add a service or product');
  if (!skip && !validPhone(phone)) problems.push("Enter the customer's 10-digit mobile number, or tap Skip");
  if (!skip && lookup === 'new' && !newCust.name.trim()) problems.push("Enter the new customer's name");
  if (lines.some((l) => l.item_type === 'service' && !l.staff_id)) problems.push('Choose who did each service');
  if (!payMode) problems.push('Choose how the customer paid');
  if (payMode === 'Split' && Math.abs(splitSum - toPay) > 0.009) problems.push(`Split amounts must add up to ${rupee(toPay)}`);
  // A past bill: the day and time it was made (before now), and the internet
  const pastAt = past && past.date && /^\d\d:\d\d$/.test(past.time || '') ? `${past.date}T${past.time}:00+05:30` : '';
  if (past && !pastAt) problems.push('Past bill: enter the day and time of the bill');
  else if (past && new Date(pastAt).getTime() > Date.now()) problems.push('Past bill: the day and time must be before now');
  if (past && !netOn) problems.push('Past bills need the internet');

  const reset = () => {
    setPhone(''); setSkip(false); setCust(null); setLookup('idle'); setNewCust(EMPTY_NEW); setEditName('');
    setLines([]); setDiscVal(''); setDiscType('pct'); setPayMode(''); setCashGiven(''); setSplit({ cash: '', upi: '', card: '' });
    setNote(''); setTried(false); setShowBill(false); setLastVisit(null); setOffersOn(true); setPtsOn(false); setPtsVal('');
    setLineEdit(null); setPast(null); setWaSend(true);
  };
  // Start a past bill: the owner only, here at the counter
  const startPast = async () => {
    if (!(await askOwner('Only the owner can add a past bill.', { codeOnly: true, detail: 'Add a past bill' }))) return;
    const y = new Date(Date.now() + 5.5 * 3600e3 - 86400e3).toISOString().slice(0, 10);
    setPast({ date: y, time: '', paper: '' });
    setPtsOn(false);
  };
  // One line's own discount: % or ₹, and its price on a past bill
  const setLine = (key, patch) => setLines((ls) => ls.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  // Not a past bill after all: menu prices back on the lines
  const endPast = () => {
    setLines((ls) => ls.map(({ _menuPrice, _priceText, ...x }) => (_menuPrice != null ? { ...x, unit_price: _menuPrice } : x)));
    setPast(null);
  };

  const save = async () => {
    setTried(true);
    if (problems.length || saving || savingRef.current) return;
    // An offer may have just started or ended (happy hours): check the clock again before saving
    const fresh = istNow();
    if (!past && (fresh.day !== now.day || fresh.time !== now.time)) {
      const again = calcBill(
        withStaff(applyOffers(lines, (offers || []).filter((o) => offerLive(o, fresh)), { now: fresh, servicesById, isNew: newForOffers, enabled: offersOn && !staffFor }).lines),
        { discountType: discType, discountValue: Number(discVal) || 0, gstOn, inclusive: settings ? settings.prices_include_gst !== false : true }
      );
      setNow(fresh);
      if (again.total !== bill.total || again.discount !== bill.discount) {
        toast(`An offer just ${again.discount < bill.discount ? 'ended' : 'started'}. The total is now ${rupee(again.total)}. Check it and save again.`, 'bad');
        return;
      }
    }
    // Above the limit: the owner approves this discount (Telegram), or unlocks with the code
    let grantId = '';
    // A past bill is the owner's own: the owner is here (checked again when it is saved)
    if (past && !(await askOwner('Only the owner can add a past bill.', { codeOnly: true, detail: 'Add a past bill' }))) return;
    if (!past && bill.discountPct > maxDisc + 0.001) {
      const ok0 = approvedDisc.current;
      if (ok0 && ok0.billId === billId.current && bill.manualDiscount <= ok0.amount) {
        grantId = ok0.grantId;
      } else {
        const g = await askOwner(`The discount is above the ${maxDisc}% limit.`, {
          action: 'discount', ref: billId.current, amount: bill.manualDiscount,
          detail: `Discount ${bill.discountPct}% (−${rupee(bill.manualDiscount)}) on a ${rupee(round2(bill.subtotal - bill.offerDiscount))} bill${bill.offerDiscount ? ' (after offers)' : ''}. Customer pays ${rupee(bill.total)}.`,
        });
        if (!g) return;
        grantId = typeof g === 'string' ? g : '';
        approvedDisc.current = { billId: billId.current, grantId, amount: bill.manualDiscount };
      }
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const isNew = !skip && lookup === 'new';
      const name = skip ? '' : isNew ? newCust.name.trim() : editName.trim() || (cust && cust.name) || '';
      // What the customer pays with money; points pay the rest
      const pay = {
        paid_cash: payMode === 'Cash' ? toPay : payMode === 'Split' ? round2(Number(split.cash) || 0) : 0,
        paid_upi: payMode === 'UPI' ? toPay : payMode === 'Split' ? round2(Number(split.upi) || 0) : 0,
        paid_card: payMode === 'Card' ? toPay : payMode === 'Split' ? round2(Number(split.card) || 0) : 0,
        paid_points: pointsUsed,
      };
      const payload = {
        customer_phone: skip ? '' : phone,
        customer_name: name,
        ...(isNew ? { gender: newCust.gender, whatsapp_ok: newCust.whatsapp_ok } : {}),
        subtotal: bill.subtotal, offer_discount: bill.offerDiscount, discount: bill.discount, taxable: bill.taxable, cgst: bill.cgst, sgst: bill.sgst,
        round_off: bill.round_off, total: bill.total, pay_mode: payMode, ...pay, note: note.trim(),
        created_by: user && user.email ? user.email : '',
        owner_grant_id: grantId,
        ...(past ? { past: true, created_at: new Date(pastAt).toISOString(), paper_no: (past.paper || '').trim() } : {}),
        // WhatsApp bills: a bill saved offline goes on WhatsApp when it uploads
        ...(waBillsOn(settings) && waSend && custPhone && !past ? { wa_send: true } : {}),
        items: bill.items.map((l) => ({
          item_type: l.item_type, service_id: l.service_id || '', product_id: l.product_id || '', name: l.name, category: l.category,
          hsn_sac: l.hsn_sac || '', staff_id: l.staff_id || '', staff_name: staffName(l.staff_id), qty: l.qty, unit_price: l.unit_price,
          amount: l.amount, offer_id: l.offer_id || '', offer_name: l.offer_name || '', offer_discount: l.offer_discount || 0,
          line_discount: l.line_discount || 0, staff_discount: l.staff_discount || 0, commission_base: l.commission_base,
          discount: l.discount, taxable: l.taxable, gst_pct: l.gst_pct, gst: l.gst,
        })),
      };
      // Last line of defence: every figure must add up exactly (the database checks this again)
      const errs = checkBill(payload);
      if (errs.length) throw new Error(errs[0]);
      // The same id for every try of this bill, so a double tap or a retry can never save it twice
      const b = await db.rpc('create_bill', { p: { ...payload, id: billId.current } });
      let items = b._items;
      if (!items) {
        // The bill is saved; if the lines can't be read back right now, show the ones just sent
        try { items = await db.list('bill_items', { eq: { bill_id: b.id }, order: ['created_at', 'asc'] }); } catch { items = []; }
        if (!items.length) items = payload.items.map((it, i) => ({ ...it, id: `${b.id}-${i}`, bill_id: b.id }));
      }
      // Saved on this device (no internet): the points it earns are worked out here, and added when it uploads
      setSaved({ bill: b._pending ? { ...b, _points_preview: earnPreview } : b, items, autoWa: !!payload.wa_send });
      // Telegram to the owner if a bottle these services use is almost finished with none left in the store.
      // Not waited for: the counter carries on at once.
      if (!b._pending && !past && lines.some((l) => l.item_type === 'service')) db.notify('bill', b.id);
      reset();
      billId.current = uid();
      approvedDisc.current = null;
      if (lines.some((l) => l.item_type === 'product')) loadProducts();
      loadPopular();
    } catch (e) {
      toast('Could not save the bill: ' + e.message, 'bad');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const cashReturn = round2((Number(cashGiven) || 0) - toPay);

  return (
    <div className={'billing' + (hasBanner ? ' with-banner' : '') + (showBill ? ' show-bill' : '')}>
      {/* ================= Menu ================= */}
      <section className="menu-pane" aria-label="Services">
        <div className="menu-search">
          <SearchBox inputRef={searchRef} value={q} onChange={setQ} placeholder="Search service, e.g. hair spa, facial, wax" />
          {!q && (
            <div className="chips scroll" role="tablist">
              {sectionTabs.map((s) => (
                <button key={s} role="tab" aria-selected={activeSection === s} className={'chip' + (activeSection === s ? ' on' : '')} onClick={() => setSection(s)}>
                  {sectionLabel(s)}
                </button>
              ))}
            </div>
          )}
        </div>

        {liveOffers.length > 0 && (
          <div className="offer-strip" aria-label="Offers running now">
            <Tag size={15} />
            <span className="small"><b>Offers on now:</b> {liveOffers.map((o) => o.name).join(' · ')}</span>
          </div>
        )}
        <MenuTiles shown={shown} inCart={inCart} q={dq} onService={onService} onProduct={onProduct} tags={tileTags} />

        <div className="mobile-switch">
          <button className="btn primary block lg" onClick={() => { setShowBill(true); toTop(); }}>
            <ReceiptText size={18} /> Bill · <span key={lines.length} className="pop-on-change">{lines.length}</span> {lines.length === 1 ? 'item' : 'items'} · {rupee(toPay)}
          </button>
        </div>
      </section>

      {/* ================= Bill ================= */}
      <section className="bill-pane" aria-label="Current bill">
        <div className="bill-scroll" ref={billScroll}>
          <div className="row between wrap" style={{ rowGap: 4 }}>
            <button className="btn ghost sm mobile-only" style={{ display: showBill ? undefined : 'none' }} onClick={() => { setShowBill(false); toTop(); }}>← Add more services</button>
            {!showBill && <span className="eyebrow">{past ? 'Past bill' : 'New bill'}</span>}
            <span className="row" style={{ gap: 6, marginLeft: 'auto' }}>
              {!past && (
                <button className="btn ghost sm" id="past-start" onClick={startPast} title="Type in a bill from before (owner only)">
                  <History size={14} /> Past bill{!ownerHere && <Lock size={11} />}
                </button>
              )}
              {(lines.length > 0 || phone || past) && (
                <button className="btn ghost sm" onClick={reset}><RotateCcw size={14} /> Clear</button>
              )}
            </span>
          </div>

          {/* ---- A past bill (owner only) ---- */}
          {past && (
            <div className="sub-card stack tight past-card" id="past-card">
              <div className="row between">
                <b><History size={15} /> Past bill</b>
                <button className="link small" onClick={endPast}>Not a past bill</button>
              </div>
              <div className="row wrap" style={{ gap: 10 }}>
                <label className="row small" style={{ gap: 6 }}>Day
                  <input className={'input' + (tried && !past.date ? ' err' : '')} type="date" id="past-date" style={{ height: 40, width: 'auto' }}
                    max={istDay()} value={past.date} onChange={(e) => setPast({ ...past, date: e.target.value })} />
                </label>
                <label className="row small" style={{ gap: 6 }}>Time
                  <input className={'input' + (tried && !past.time ? ' err' : '')} type="time" id="past-time" style={{ height: 40, width: 'auto' }}
                    value={past.time} onChange={(e) => setPast({ ...past, time: e.target.value })} />
                </label>
              </div>
              <input className="input" id="past-paper" placeholder="Paper bill number (if there is one)" value={past.paper} maxLength={40}
                onChange={(e) => setPast({ ...past, paper: e.target.value })} />
              <p className="small muted" style={{ margin: 0 }}>
                It gets its own number (like HF2627-P0001), so today's numbers stay in order. Type each price as the paper bill says.
                No offers or points. It counts in that day's sales, payroll and stock.
              </p>
            </div>
          )}

          {/* ---- Customer ---- */}
          <div className="stack tight">
            <div className="sec-title">Customer mobile</div>
            {skip ? (
              <div className="cust-card">
                <div className="row between">
                  <span>Walk-in customer (no number)</span>
                  <button className="link" onClick={() => setSkip(false)}>Add number</button>
                </div>
              </div>
            ) : (
              <>
                <div className="row">
                  <div className="input-wrap grow">
                    <Smartphone size={19} />
                    <input
                      id="cust-phone"
                      className={'input big' + (tried && !validPhone(phone) ? ' err' : '')}
                      inputMode="numeric"
                      autoComplete="off"
                      placeholder="98765 43210"
                      value={fmtPhone(phone)}
                      onChange={(e) => setPhone(cleanPhone(e.target.value))}
                    />
                  </div>
                  <button className="btn line" onClick={() => { setSkip(true); setPhone(''); }}>Skip</button>
                </div>
                {suggest.length > 0 && (
                  <div className="cust-suggest" role="listbox" aria-label="Saved customers">
                    {suggest.map((c) => (
                      <button key={c.id || c.phone} role="option" onClick={() => { setPhone(c.phone); setSuggest([]); }}>
                        <span className="strong">{c.name || 'No name'}</span>
                        <span className="muted">{fmtPhone(c.phone)} · {c.visits || 0} {Number(c.visits) === 1 ? 'visit' : 'visits'}</span>
                      </button>
                    ))}
                  </div>
                )}
                {!phone && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setFindName(true)}>Customer doesn't remember the number? Find by name</button>}
                {!phone && activeStaff.some((s) => validPhone(cleanPhone(s.phone || ''))) && (
                  <button className="link small" id="staff-own" style={{ alignSelf: 'flex-start' }} onClick={() => setStaffPick(!staffPick)}>Staff's own service? Choose who</button>
                )}
                {!phone && staffPick && (
                  <div className="chips" id="staff-pick">
                    {activeStaff.filter((s) => validPhone(cleanPhone(s.phone || ''))).map((s) => (
                      <button key={s.id} className="chip sm" onClick={() => { setPhone(cleanPhone(s.phone)); setStaffPick(false); }}>{s.name}</button>
                    ))}
                  </div>
                )}
                {staffFor && (
                  <div className="cust-card staff-bill" id="staff-banner">
                    <div className="row between"><b>Staff's own bill: {staffFor.name}</b><span className="pill ok">Staff price</span></div>
                    <div className="small">
                      {sRules.free.length ? `${sRules.free.map(sectionLabel).join(', ')}: free. ` : ''}Other services: {sRules.pct}% off. Products at the normal price. No offers or points.
                    </div>
                    <div className="tiny muted">Choose who does each service: they earn their commission on the full price.</div>
                  </div>
                )}
                {lookup === 'invalid' && <span className="err-text">A mobile number starts with 6, 7, 8 or 9.</span>}
                {lookup === 'loading' && <span className="muted small">Looking up…</span>}
                {lookup === 'found' && cust && (
                  <div className="cust-card">
                    <div className="row between top">
                      <div className="grow">
                        <input className="input" id="cust-name" value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Customer name" aria-label="Customer name" />
                      </div>
                      <span className={'pill ' + (cust.visits >= 3 ? 'red' : 'ok')}>{cust.visits >= 3 ? 'Regular' : 'Returning'}</span>
                    </div>
                    <div className="small muted">
                      {cust.visits} {cust.visits === 1 ? 'visit' : 'visits'} · spent {rupee(cust.total_spent)}
                      {cust.last_visit ? ` · last came ${daysSince(cust.last_visit) === 0 ? 'today' : fmtDate(cust.last_visit)}` : ''}
                    </div>
                    {rules.on && !staffNumber && (Number(cust.points) > 0 || balance !== 0) && (
                      <div className="small points-line" id="cust-points">
                        <Star size={13} /> <b>{balance} {balance === 1 ? 'point' : 'points'}</b>
                        {balance > 0 && balance < rules.minUse && <span className="muted"> · can be used from {rules.minUse}</span>}
                        {balance >= rules.minUse && <span className="muted"> · ₹{balance} off, up to {rules.maxPct}% of a bill</span>}
                        {balance > 0 && cust.last_visit && <span className="muted"> · valid till {fmtDate(expiresAt(cust.last_visit, rules))}</span>}
                        {balance === 0 && Number(cust.points) > 0 && <span className="muted"> · {cust.points} expired (no visit for {rules.months} months)</span>}
                      </div>
                    )}
                    {lastVisit && (
                      <div className="small">
                        <span className="muted">Last time: </span>
                        {lastVisit.items.map((i) => i.name + (i.staff_name ? ` (${i.staff_name.split(' ')[0]})` : '')).join(', ')}
                      </div>
                    )}
                  </div>
                )}
                {lookup === 'new' && (
                  <div className="cust-card">
                    <div className="row between"><b>New customer</b><span className="pill warn">First visit</span></div>
                    <input className={'input' + (tried && !newCust.name.trim() ? ' err' : '')} id="new-name" placeholder="Full name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} />
                    <div className="chips new-cust-row">
                      {[['F', 'Female'], ['M', 'Male']].map(([v, l]) => (
                        <button key={v} className={'chip sm' + (newCust.gender === v ? ' on' : '')} onClick={() => setNewCust({ ...newCust, gender: newCust.gender === v ? '' : v })}>{l}</button>
                      ))}
                      <label className="check">
                        <input type="checkbox" checked={newCust.whatsapp_ok} onChange={(e) => setNewCust({ ...newCust, whatsapp_ok: e.target.checked })} />
                        Offers on WhatsApp OK
                      </label>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* ---- Staff ---- */}
          <div className="stack tight">
            <div className="sec-title">Service done by</div>
            {activeStaff.length ? (
              <div className="chips">
                {activeStaff.map((s) => (
                  <button key={s.id} className={'chip sm red' + (curStaff === s.id ? ' on' : '')} onClick={() => chooseStaff(s.id)}>
                    {s.name.split(' ')[0]}
                  </button>
                ))}
              </div>
            ) : (
              <p className="small muted">No staff added yet. Add them in Staff → Staff list.</p>
            )}
          </div>

          {/* ---- Items ---- */}
          <div className="stack tight">
            <div className="sec-title">Items {lines.length ? `(${lines.length})` : ''}</div>
            {lines.length === 0 ? (
              <p className="muted small">Tap a service on the left to add it.</p>
            ) : (
              <div className="lines">
                {lines.map((l, idx) => (
                  <div className="cart-line" key={l.key}>
                    <div className="ln">{l.name}</div>
                    <div className="la">
                      {past ? (
                        // Past bill: the price the paper bill says
                        <input className="input price-in" inputMode="decimal" aria-label={'Price of ' + l.name} id={'line-price-' + idx}
                          value={l._priceText ?? String(l.unit_price)}
                          onChange={(e) => { const t = cleanMoney(e.target.value); setLine(l.key, { _priceText: t, unit_price: Number(t) || 0, _menuPrice: l._menuPrice ?? l.unit_price }); }} />
                      ) : bill.items[idx] && (bill.items[idx].offer_discount > 0 || bill.items[idx].line_discount > 0) ? (
                        <>
                          <s className="was">{rupee(l.unit_price * l.qty)}</s> {rupee(round2(l.unit_price * l.qty - bill.items[idx].offer_discount - bill.items[idx].line_discount))}
                        </>
                      ) : rupee(l.unit_price * l.qty)}
                    </div>
                    <button className="icon-btn plain sm" aria-label={'Remove ' + l.name} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><X size={16} /></button>
                    <div className="meta">
                      <select
                        aria-label="Done by"
                        className={tried && l.item_type === 'service' && !l.staff_id ? 'need' : ''}
                        value={l.staff_id}
                        onChange={(e) => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, staff_id: e.target.value } : x)))}
                      >
                        <option value="">{l.item_type === 'service' ? 'Who did it?' : 'Sold by (optional)'}</option>
                        {activeStaff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                      {l.item_type === 'product' && (
                        <span className="qty">
                          <button aria-label="One less" onClick={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))}><Minus size={14} /></button>
                          <span>{l.qty}</span>
                          <button aria-label="One more" onClick={() => setLines((ls) => ls.map((x) => (x.key === l.key ? { ...x, qty: x.qty + 1 } : x)))}><Plus size={14} /></button>
                        </span>
                      )}
                      {l.qty > 1 && <span className="lv">{rupee(l.unit_price)} each</span>}
                      {offerResult.lines[idx] && offerResult.lines[idx].offer_discount > 0 && (
                        <span className="offer-note"><Tag size={12} /> {offerResult.lines[idx].offer_name}</span>
                      )}
                      {bill.items[idx] && bill.items[idx].staff_discount > 0 ? (
                        <span className="staff-price" id={'staff-price-' + idx}>
                          <BadgeCheck size={12} /> Staff price{bill.items[idx].staff_discount >= bill.items[idx].amount ? ': free' : ` −${Number(bill.items[idx].disc_value)}%`}
                        </span>
                      ) : (
                      <button className={'link small line-disc-btn' + (bill.items[idx] && bill.items[idx].line_discount > 0 ? ' on' : '')} id={'disc-btn-' + idx}
                        onClick={() => setLineEdit(lineEdit === l.key ? null : l.key)}>
                        <Percent size={12} /> {bill.items[idx] && bill.items[idx].line_discount > 0
                          ? `Discount −${rupee(bill.items[idx].line_discount)}${l.disc_type !== 'amt' ? ` (${Number(l.disc_value)}%)` : ''}`
                          : 'Discount'}
                      </button>
                      )}
                    </div>
                    {lineEdit === l.key && !(bill.items[idx] && bill.items[idx].staff_discount > 0) && (
                      <div className="line-disc" id={'line-disc-' + idx}>
                        <span className="small">Discount on this item</span>
                        <div className="row wrap" style={{ gap: 6 }}>
                          {[5, 10, 20].map((p) => (
                            <button key={p} className={'chip sm' + (l.disc_type !== 'amt' && Number(l.disc_value) === p ? ' on' : '')}
                              onClick={() => setLine(l.key, { disc_type: 'pct', disc_value: String(p) })}>{p}%</button>
                          ))}
                          <input className="input" style={{ width: 80, height: 34 }} inputMode="decimal" placeholder="Other" id={'line-disc-val-' + idx}
                            aria-label={'Discount on ' + l.name} value={l.disc_value || ''} onChange={(e) => setLine(l.key, { disc_value: cleanMoney(e.target.value) })} />
                          <div className="seg">
                            <button className={l.disc_type !== 'amt' ? 'on' : ''} style={{ height: 34 }} onClick={() => setLine(l.key, { disc_type: 'pct' })}>%</button>
                            <button className={l.disc_type === 'amt' ? 'on' : ''} style={{ height: 34 }} onClick={() => setLine(l.key, { disc_type: 'amt' })}>₹</button>
                          </div>
                          {Number(l.disc_value) > 0 && <button className="link small" onClick={() => setLine(l.key, { disc_value: '' })}>Remove</button>}
                          <button className="btn line sm" onClick={() => setLineEdit(null)}>Done</button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ---- Discount ---- */}
          {lines.length > 0 && (
            <div className="stack tight">
              <div className="sec-title">Discount on the whole bill</div>
              <div className="row wrap">
                {[0, 5, 10, 20].map((p) => (
                  <button key={p} className={'chip sm' + (discType === 'pct' && Number(discVal || 0) === p ? ' on' : '')} onClick={() => { setDiscType('pct'); setDiscVal(p ? String(p) : ''); }}>
                    {p ? p + '%' : 'None'}
                  </button>
                ))}
                <div className="row bill-disc" style={{ gap: 6 }}>
                  <input
                    className="input" id="disc-val" style={{ width: 90 }} inputMode="decimal" placeholder="Other"
                    value={discVal} onChange={(e) => setDiscVal(cleanMoney(e.target.value))} aria-label="Discount value"
                  />
                  <div className="seg">
                    <button className={discType === 'pct' ? 'on' : ''} onClick={() => setDiscType('pct')}>%</button>
                    <button className={discType === 'amt' ? 'on' : ''} onClick={() => setDiscType('amt')}>₹</button>
                  </div>
                </div>
              </div>
              {!past && bill.discountPct > maxDisc && <span className="small" style={{ color: 'var(--warn)' }}>Discounts above {maxDisc}% of the bill (items and whole bill together): the owner must approve before saving.</span>}
            </div>
          )}

          {/* ---- Totals ---- */}
          {lines.length > 0 && (
            <div className="sums">
              <div className="row"><span>Subtotal</span><span className="money">{rupee(bill.subtotal)}</span></div>
              {offerResult.applied.map((a) => (
                <div className="row offer-row" key={a.id}><span><Tag size={13} /> {a.name}</span><span className="money">−{rupee(a.discount)}</span></div>
              ))}
              {bill.staffDiscount > 0 && <div className="row" id="sum-staff-disc"><span>Staff price{staffFor ? ` (${staffFor.name.split(' ')[0]})` : ''}</span><span className="money">−{rupee(bill.staffDiscount)}</span></div>}
              {bill.lineDiscount > 0 && <div className="row" id="sum-line-disc"><span>Discounts on items</span><span className="money">−{rupee(bill.lineDiscount)}</span></div>}
              {bill.billDiscount > 0 && (
                <div className="row" id="sum-bill-disc">
                  <span>Discount{discType === 'pct' && Number(discVal) > 0 && Number(discVal) <= 100 ? ` (${Number(discVal)}%)` : ''}</span>
                  <span className="money">−{rupee(bill.billDiscount)}</span>
                </div>
              )}
              {gstOn && bill.taxRates.map((t) => (
                <div className="row muted" key={t.rate}>
                  <span>{settings.prices_include_gst !== false ? 'Includes ' : ''}GST {t.rate}% (CGST {t.rate / 2}% + SGST {t.rate / 2}%)</span>
                  <span className="money">{rupee(t.gst, { paise: true })}</span>
                </div>
              ))}
              {bill.round_off !== 0 && <div className="row muted"><span>Round off</span><span className="money">{rupee(bill.round_off, { paise: true })}</span></div>}
              <div className="row tot"><span>Total</span><span className="money">{rupee(bill.total)}</span></div>
              {maxUse > 0 && (
                <div className="points-use">
                  <label className="check">
                    <input type="checkbox" id="use-points" checked={ptsOn} onChange={(e) => { setPtsOn(e.target.checked); setPtsVal(''); }} />
                    <span><Star size={13} /> Pay with points: up to <b>{maxUse}</b> (balance {balance})</span>
                  </label>
                  {ptsOn && (
                    <input className="input" id="points-amt" style={{ width: 86, height: 34 }} inputMode="numeric" aria-label="Points to use"
                      value={ptsVal === '' ? String(maxUse) : ptsVal} onChange={(e) => setPtsVal(e.target.value.replace(/\D/g, '').slice(0, 6))} />
                  )}
                </div>
              )}
              {!netOn && balance >= rules.minUse && lookup === 'found' && <div className="small muted">Points can be used when the internet is back.</div>}
              {pointsUsed > 0 && (
                <>
                  <div className="row"><span>Paid with points</span><span className="money">−{rupee(pointsUsed)}</span></div>
                  <div className="row tot"><span>To pay</span><span className="money" id="to-pay">{rupee(toPay)}</span></div>
                </>
              )}
              {earnPreview > 0 && <div className="small earn-note" id="earn-note"><Star size={12} /> Earns {earnPreview} points{lookup === 'new' ? ' (first visit)' : ''}</div>}
              {offerResult.missed.filter((m) => m.reason === 'min').map((m) => (
                <div className="small offer-hint" key={m.offer.id}>Add {rupee(m.short)} more to get “{m.offer.name}”</div>
              ))}
              {offerResult.applied.length > 0 && (
                <button className="link small" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOffersOn(false)}>Don't apply offers to this bill</button>
              )}
              {!offersOn && liveOffers.length > 0 && (
                <button className="link small" style={{ alignSelf: 'flex-start', marginTop: 4 }} onClick={() => setOffersOn(true)}>Offers removed from this bill · apply again</button>
              )}

            </div>
          )}

          {/* ---- Payment ---- */}
          {lines.length > 0 && (
            <div className="stack tight">
              {waBillsOn(settings) && custPhone && !past && (
                <label className="check wa-tick" id="wa-tick">
                  <input type="checkbox" checked={waSend} onChange={(e) => setWaSend(e.target.checked)} />
                  <span><MessageCircle size={14} /> Send the bill on WhatsApp to {fmtPhone(custPhone)}</span>
                </label>
              )}
              <div className="sec-title">Paid by</div>
              <div className="pay-modes">
                {[['Cash', Banknote], ['UPI', Smartphone], ['Card', CreditCard], ['Split', Split]].map(([m, Icon]) => (
                  <button key={m} className={payMode === m ? 'on' : ''} onClick={() => setPayMode(m)}><Icon size={17} /> {m}</button>
                ))}
              </div>
              {payMode === 'Cash' && (
                <div className="row">
                  <div className="grow"><MoneyInput id="cash-given" value={cashGiven} onChange={setCashGiven} placeholder="Cash received" /></div>
                  {Number(cashGiven) > 0 && (
                    <span className={'strong nowrap ' + (cashReturn < 0 ? 'err-text' : '')}>
                      {cashReturn >= 0 ? `Return ${rupee(cashReturn)}` : `${rupee(-cashReturn)} short`}
                    </span>
                  )}
                </div>
              )}
              {payMode === 'Split' && (
                <div className="stack tight">
                  {[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card']].map(([k, l]) => (
                    <div className="row" key={k}>
                      <span style={{ width: 52 }}>{l}</span>
                      <div className="grow"><MoneyInput id={'split-' + k} value={split[k]} onChange={(v) => setSplit({ ...split, [k]: v })} /></div>
                    </div>
                  ))}
                  <span className={'small ' + (Math.abs(splitSum - toPay) > 0.009 ? 'err-text' : 'muted')}>
                    Entered {rupee(splitSum)} of {rupee(toPay)}
                    {toPay - splitSum > 0.009 ? ` · ${rupee(round2(toPay - splitSum))} left` : ''}
                  </span>
                </div>
              )}
              {(payMode === 'UPI' || (payMode === 'Split' && Number(split.upi) > 0)) && (
                qr ? (
                  <div className="qr-box">
                    <img src={qr} alt="UPI QR code" />
                    <div className="small">
                      <b>Customer scans to pay {rupee(payMode === 'UPI' ? toPay : Number(split.upi))}</b>
                      <div className="muted">Check the payment reached {settings.upi_id} before saving.</div>
                    </div>
                  </div>
                ) : (
                  <p className="small muted">Add your UPI ID in Settings to show a QR code with the amount filled in.</p>
                )
              )}
              <input className="input" id="bill-note" style={{ height: 40, fontSize: 14 }} placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
          )}
        </div>

        <div className="bill-foot">
          <button className="btn primary block lg" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : `Save bill · ${rupee(toPay)}${pointsUsed ? ' + points' : ''}`}
          </button>
          <div className="hint" aria-live="polite">{tried && problems[0] ? problems[0] : ''}</div>
        </div>
      </section>

      {findName && <FindCustomer onPick={(c) => { setPhone(c.phone); setSkip(false); setFindName(false); }} onClose={() => setFindName(false)} />}

      {/* ================= Pickers ================= */}
      {picker && picker.mode === 'variant' && (() => {
        const sv = picker.service;
        const ex = sv.extra_options && sv.extra_options.choices ? sv.extra_options : null;
        const pick = ex && picker.extra >= 0 ? ex.choices[picker.extra] : null;
        const add = pick ? Number(pick.price) || 0 : 0;
        const opts = sv.variants && sv.variants.length ? sv.variants : [{ label: '', price: Number(sv.price) }];
        return (
          <Modal title={sv.name} onClose={() => setPicker(null)}>
            {ex && (
              <div className="extra-pick">
                <span className="small muted">{ex.title}</span>
                <div className="seg full">
                  <button type="button" className={picker.extra < 0 ? 'on' : ''} onClick={() => setPicker({ ...picker, extra: -1 })}>Normal</button>
                  {ex.choices.map((c, i) => (
                    <button type="button" key={i} className={picker.extra === i ? 'on' : ''} onClick={() => setPicker({ ...picker, extra: i })}>
                      {c.label} {Number(c.price) ? `+${rupee(c.price)}` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="variant-grid">
              {opts.map((v, i) => (
                <button key={i} onClick={() => addService(sv, v.price, v, pick)}>
                  {v.label ? <b>{v.label}</b> : <b>Add</b>}
                  {SIZE_HINT[v.label] && <span>{SIZE_HINT[v.label]}</span>}
                  <em>{rupee(round2(Number(v.price) + add))}</em>
                </button>
              ))}
            </div>
          </Modal>
        );
      })()}
      {picker && picker.mode === 'price' && (
        <Modal
          title={picker.service.name}
          onClose={() => setPicker(null)}
          foot={
            <button
              className="btn primary block"
              disabled={!(Number(openPrice) > 0) || Number(openPrice) < Number(picker.service.price)}
              onClick={() => addService(picker.service, Number(openPrice))}
            >
              Add {Number(openPrice) > 0 ? rupee(Number(openPrice)) : ''}
            </button>
          }
        >
          <Field label="Price for this customer" hint={Number(picker.service.price) ? `Menu price starts at ${rupee(picker.service.price)}` : 'Type the price agreed with the customer'}>
            <MoneyInput id="open-price" className="big" value={openPrice} onChange={setOpenPrice} autoFocus />
          </Field>
        </Modal>
      )}

      {saved && (
        <BillView
          bill={saved.bill}
          items={saved.items}
          title={(saved.bill._pending ? 'Saved on this device · ' : 'Saved · ') + saved.bill.bill_no}
          onClose={() => setSaved(null)}
          autoWa={saved.autoWa}
          extraFoot={<button className="btn primary" onClick={() => { setSaved(null); setTimeout(() => document.getElementById('cust-phone')?.focus(), 50); }}><UserRound size={16} /> Next customer</button>}
        />
      )}
    </div>
  );
}

// Find a saved customer by name (or part of the number), for when they don't remember which number they gave
function FindCustomer({ onPick, onClose }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) { setRows(null); return; }
    let live = true;
    const t = setTimeout(async () => {
      try {
        const r = await db.list('customers', { search: { q: text, cols: ['name', 'phone'] }, order: ['last_visit', 'desc'], limit: 20 });
        if (live) setRows(r);
      } catch { if (live) setRows([]); }
    }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q]);
  return (
    <Modal title="Find customer" onClose={onClose}>
      <div className="stack">
        <SearchBox value={q} onChange={setQ} placeholder="Type the name, e.g. Riya" autoFocus />
        {rows === null ? <p className="small muted">Type at least 2 letters.</p> : rows.length === 0 ? <p className="small muted">No saved customer with that name. Ask for the number and add them as new.</p> : (
          <div className="cust-suggest">
            {rows.map((c) => (
              <button key={c.id || c.phone} onClick={() => onPick(c)}>
                <span className="strong">{c.name || 'No name'}</span>
                <span className="muted">{fmtPhone(c.phone)} · {c.visits || 0} {Number(c.visits) === 1 ? 'visit' : 'visits'}{c.last_visit ? ' · last ' + fmtDate(c.last_visit) : ''}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
