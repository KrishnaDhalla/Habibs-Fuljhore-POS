// Demo database: same tables and functions as the Supabase schema, kept in this browser only.
// Used when no Supabase URL/key is configured, so the app can be tried without any setup.
import { round2, uid, istDay, addDays, dayRangeISO } from './format';
import { menuToServices, menuToCategories, slugify, SECTIONS, HAIR_SECTIONS, OLD_CATEGORIES, OLD_SECTIONS, CHART_CATEGORIES } from '../data/menu';
import { calcBill, checkBill } from './calc';
import { checkTotp, DEMO_OWNER_CODE } from './totp';
import { suggestTags } from '../data/usage';
import { unitReport, openUnits, unitToEnd } from './units';
import { bookingItem, durationOf, linkVisit, unlinkVisit, cleanPhone } from './bookings';
import { matches, orderAndLimit } from './query';
import { loyaltyRules, earnPoints, expiresAt } from './loyalty';
import { leaveRuleError } from './leave';
import { staffPriceCheck } from './staffPrice';
import { cashNow, checkExpense, checkClose, DEFAULT_CATEGORIES } from './cash';
import { dueMessages } from './waAuto';

const KEY = 'habibs-pos-demo-v1';
const TABLES = ['settings', 'services', 'customers', 'staff', 'attendance', 'staff_advances', 'payslips',
  'products', 'stock_moves', 'bills', 'bill_items', 'counters', 'offers', 'owner_grants', 'owner_secrets', 'service_usage',
  'service_categories', 'service_changes', 'bookings', 'booking_items', 'unit_ends', 'free_uses', 'unit_checks', 'enquiries',
  'staff_faces', 'check_ins', 'staff_documents', 'leave_requests', 'doc_files', 'loyalty_points', 'wa_messages', 'expenses', 'cash_closes', 'feedback', 'bill_edits', 'due_payments'];
const VERSION = 8;
const DEMO_FILES_MAX = 4500000; // the browser keeps about 5 MB for the demo, files included
// A grey face shape: the photo of the example check-ins
const DEMO_PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCABAAEADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDuaKKKgoKKR2CIzscKoyTWNcatK5xABGvqeSaANqisOHVbhG/e4kX0Iwf0rZhlWeJZUztb1oAfRRRQAUUUUAZutSFYY4xn5zk8+nb9f0rHra1iEyW6yKCTGeceh6n9BWLSGFaeiyESSRc4I3den+c/pWZWrosJBedgQCNqnsfX+QoA1aKKKYgooqG6uFtoTI4J7ADuaAJiAwIYAg8EHvWFd29or/uLlRnnacsB+IqK6vJbpvnOEByqjoP8ar0hlq3t7Z5MTXSgf7IIz+JHFb0SxpEqxABAPlx0rl6lt7mW2fdE2M9QehoA6Wiq9ldrdoSFKsvVetWKYgrA1OczXbDnbH8oH86365WgYUUUUgCiiigCa0nNvcLIM4HDD1FdJXK10tp/x6Q/9c1/lTQM/9k=';
const SERVICE_KEYS = ['name', 'category_id', 'category', 'price', 'variants', 'open_price', 'gst_pct', 'sac', 'sort', 'active',
  'web_name', 'subtitle', 'includes', 'description', 'duration_min', 'for_gender', 'show_on_website', 'book_online', 'featured', 'extra_options'];
const CATEGORY_KEYS = ['name', 'section', 'sort', 'web_page', 'web_tab', 'web_type', 'description', 'note', 'image', 'consult_only', 'show_on_website'];
const SECTIONS_OK = SECTIONS;


const DEFAULTS = {
  services: { variants: null, open_price: false, gst_pct: 5, sort: 0, active: true, web_name: null, subtitle: null, includes: null, description: null,
    duration_min: null, for_gender: 'any', show_on_website: true, book_online: true, featured: false, extra_options: null },
  service_categories: { section: 'Hair', sort: 0, web_page: null, web_tab: null, web_type: null, description: null, note: null, image: null, consult_only: false, show_on_website: true },
  customers: { whatsapp_ok: false, visits: 0, total_spent: 0, first_visit: null, last_visit: null, points: 0, wa_stop: false },
  expenses: { note: null, paid_from: 'cash', created_by: 'demo', cancelled_at: null, cancelled_by: null, cancel_reason: null },
  feedback: { comment: null, handled_at: null, handled_by: null, handled_note: null },
  staff: { monthly_salary: 0, service_commission_pct: 0, product_commission_pct: 0, active: true },
  products: { kind: 'retail', unit: 'pcs', stock: 0, low_stock: 2, cost_price: 0, sell_price: 0, gst_pct: 18, active: true, mrp: null, supplier_discount_pct: null, note: null, finished_at: null, uses_per_unit: null },
  service_usage: { amount: 0, amounts: null, weight: 1 },
  free_uses: { qty: 1, option_label: null, extra_label: null, note: null },
  bookings: { status: 'requested', source: 'whatsapp', slot_at: null, staff_id: null, note: null, bill_id: null, confirmed_at: null, reminded_at: null, confirm_sent_at: null, cancel_reason: null, enquiry_id: null },
  enquiries: { status: 'new', source: 'whatsapp', service_ids: null, follow_up_on: null, close_reason: null, booking_id: null, message: null },
  bills: { status: 'paid', discount: 0, cgst: 0, sgst: 0, round_off: 0, paid_cash: 0, paid_upi: 0, paid_card: 0, paid_points: 0, points_earned: 0, points_balance: null, paid_due: 0, change_upi: 0, due_cleared: 0, due_left: 0 },
  loyalty_points: { bill_id: null, note: null, created_by: null },
  payslips: { status: 'paid' },
  attendance: { note: null, marked_by: null },
  leave_requests: { status: 'pending', kind: 'planned', reason: null, decided_by: null, decided_at: null, requested_by: 'demo', notified_at: null },
  staff_documents: { number: null, file_path: null, file_name: null, mime: null, size_bytes: null, note: null },
  offers: { active: true, applies_to: 'all', include_products: false, kind: 'percent', min_bill: 0, new_customers_only: false, show_on_website: false, web_sort: 0 },
};

export const DEFAULT_SETTINGS = {
  salon_name: 'Habibs Hair & Beauty',
  branch: 'Fuljhore, Durgapur',
  address: 'Girija Niketan, 1st Floor, B-1 More, Durgapur, West Bengal',
  phone: '+91 89275 63835',
  instagram: '@habibsfuljhore',
  gstin: '',
  prices_include_gst: true,
  bill_prefix: 'HF',
  bill_footer: 'Thank you for visiting Habibs Fuljhore!',
  max_discount_pct: 20,
  upi_id: '',
  receipt_width: 80,
  stock_approval: 'expensive',
  stock_approval_above: 500,
  opening_hours: '10:00 AM – 9:00 PM, all 7 days',
  whatsapp: '',
  maps_url: '',
  paid_offs_per_month: 4,
  leave_blocked_days: [5, 6, 0],
  leave_notice_days: 14,
  leave_one_at_a_time: true,
  staff_free_sections: ['Hair', 'Threading', 'Waxing'],
  staff_discount_pct: 50,
  leave_alert_days: [7, 3, 1],
  wa_bills_on: false, wa_slips_on: true,
  wa_feedback_on: false, wa_feedback_after_hours: 2, google_review_url: '', wa_review_all: true,
  wa_reminders_on: false, wa_remind_hours: 3, wa_bot_on: false,
  wa_winback_on: false, wa_winback_days: 45, wa_winback_text: 'We would love to see you again.', wa_winback_per_day: 20,
  cash_tolerance: 10, due_max_counter: 200, expense_categories: DEFAULT_CATEGORIES,
  loyalty_on: true,
  loyalty_earn_pct: 5,
  loyalty_min_use: 100,
  loyalty_max_use_pct: 20,
  loyalty_expiry_months: 12,
  loyalty_products: false,
};

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* storage blocked: fall back to memory */ }
  return null;
}

let saveTimer;
function persist(state) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, 150);
}

const clone = (x) => JSON.parse(JSON.stringify(x));

export function createLocalDb() {
  let state = load();

  const T = (t) => state[t];
  const withDefaults = (t, row) => ({
    id: uid(),
    created_at: new Date().toISOString(),
    ...(DEFAULTS[t] || {}),
    ...row,
  });

  function afterInsert(t, row) {
    if (t === 'stock_moves') {
      const p = T('products').find((x) => x.id === row.product_id);
      if (p) {
        p.stock = round2(Number(p.stock) + Number(row.qty));
        // "finished" ends when there is stock again (same as the database)
        if (p.stock > 0 && p.finished_at) Object.assign(p, { finished_at: null, finished_by: null });
      }
    }
  }

  // ----- the menu (mirrors service_fill / service_category_fill in the database) -----
  const freeSlug = (t, base, id) => {
    const b = base || 'item';
    for (let n = 1; ; n++) {
      const v = n > 1 ? `${b}-${n}` : b;
      if (!T(t).some((x) => x.slug === v && x.id !== id)) return v;
    }
  };
  function fillCategory(c, old) {
    c.name = String(c.name || '').trim();
    if (!c.name) throw new Error('Enter a category name');
    if (!SECTIONS_OK.includes(c.section)) c.section = 'Hair';
    for (const k of ['web_page', 'web_tab', 'web_type']) c[k] = String(c[k] || '').trim() || null;
    if (old && old.slug) c.slug = old.slug;
    if (!c.slug) c.slug = freeSlug('service_categories', slugify(c.name), c.id);
    c.updated_at = new Date().toISOString();
  }
  function fillService(s, old) {
    if (s.variants === undefined) s.variants = null;
    if (s.extra_options === undefined) s.extra_options = null;
    const e = s.extra_options;
    if (e && !(e.title && Array.isArray(e.choices) && e.choices.length >= 1 && e.choices.length <= 5 && e.choices.every((c) => String(c.label || '').trim() && Number(c.price) >= 0))) {
      throw new Error('Extra choice needs a title and choices like Thick:500');
    }
    let c = null;
    const byName = old && s.category_id === old.category_id && s.category !== old.category;
    if (s.category_id && !byName) c = T('service_categories').find((x) => x.id === s.category_id);
    else if (String(s.category || '').trim()) {
      c = T('service_categories').find((x) => x.name.toLowerCase() === String(s.category).trim().toLowerCase());
      if (!c) {
        c = withDefaults('service_categories', { section: SECTIONS_OK.includes(s.section) ? s.section : 'Hair', name: String(s.category).trim(), sort: s.sort || 0 });
        fillCategory(c);
        T('service_categories').push(c);
      }
    }
    if (!c) throw new Error('Choose a category for the service');
    Object.assign(s, { category_id: c.id, category: c.name, section: c.section });
    s.name = String(s.name || '').trim();
    if (!s.name) throw new Error('Enter the service name');
    s.web_name = String(s.web_name || '').trim() || null;
    s.subtitle = String(s.subtitle || '').trim() || null;
    if (s.variants) {
      if (!Array.isArray(s.variants) || s.variants.length < 2 || s.variants.some((v) => !(Number(v.price) >= 0))) throw new Error('Price options need at least two prices, like S:2500, M:3000');
      s.price = Math.min(...s.variants.map((v) => Number(v.price)));
    }
    if (old && old.slug) s.slug = old.slug;
    if (!s.slug) s.slug = freeSlug('services', slugify(s.name), s.id);
    s.updated_at = new Date().toISOString();
  }
  // The printed rate chart (src/data/menu.js), the same steps as supabase/02_seed_services.sql: categories by name;
  // a service with the chart's name or its October name keeps its row; the rest of the chart's categories hidden;
  // offers on October categories and tabs moved (first time only); October categories emptied into the nearest one.
  function applyRateChart() {
    const lc = (x) => String(x || '').toLowerCase();
    const first = T('service_categories').some((c) => OLD_CATEGORIES[c.name]);
    for (const c of menuToCategories()) {
      const cur = T('service_categories').find((x) => lc(x.name) === lc(c.name));
      if (cur) {
        const old = clone(cur);
        Object.assign(cur, { section: c.section, sort: c.sort, web_page: c.web_page, web_tab: c.web_tab, web_type: c.web_type, consult_only: c.consult_only, note: cur.note ?? c.note });
        fillCategory(cur, old);
        for (const s of T('services').filter((x) => x.category_id === cur.id)) Object.assign(s, { category: cur.name, section: cur.section });
      } else {
        const row = withDefaults('service_categories', { ...c, slug: T('service_categories').some((x) => x.slug === c.slug) ? null : c.slug });
        fillCategory(row);
        T('service_categories').push(row);
      }
    }
    const done = new Set();
    for (const { was, ...r } of menuToServices()) {
      const chart = CHART_CATEGORIES.includes(r.category); // Nails and Makeup are not on the printed pages: kept as they are
      const cur = T('services')
        .filter((s) => !done.has(s.id) && (lc(s.name) === lc(r.name) || was.some((w) => lc(w) === lc(s.name))))
        .sort((a, b) => (lc(b.name) === lc(r.name)) - (lc(a.name) === lc(r.name)) || (b.active !== false) - (a.active !== false)
          || (a.sort || 0) - (b.sort || 0) || String(a.created_at || '').localeCompare(String(b.created_at || '')))[0];
      const cat = T('service_categories').find((x) => lc(x.name) === lc(r.category));
      const fields = { category_id: cat.id, category: cat.name, name: r.name, web_name: r.web_name, price: r.price, variants: r.variants,
        extra_options: r.extra_options, open_price: r.open_price, sac: r.sac, gst_pct: r.gst_pct, sort: r.sort, active: true, for_gender: r.for_gender };
      if (cur) {
        if (chart) {
          const old = clone(cur);
          Object.assign(cur, fields);
          fillService(cur, old);
        }
        done.add(cur.id);
      } else {
        const row = withDefaults('services', { id: uid(), created_at: new Date().toISOString(), ...fields });
        fillService(row);
        T('services').push(row);
        done.add(row.id);
      }
    }
    for (const s of T('services')) if (s.active !== false && !done.has(s.id) && CHART_CATEGORIES.includes(s.category)) s.active = false;
    if (first) {
      const spread = (list, map) => [...new Set((list || []).flatMap((x) => (map[x] ? (map[x].now || map[x]) : [x])))].sort();
      for (const o of T('offers')) {
        if ((o.categories || []).some((x) => OLD_CATEGORIES[x])) o.categories = spread(o.categories, OLD_CATEGORIES);
        if ((o.sections || []).some((x) => OLD_SECTIONS[x])) o.sections = spread(o.sections, OLD_SECTIONS);
      }
    }
    for (const [name, { home }] of Object.entries(OLD_CATEGORIES)) {
      const to = T('service_categories').find((x) => x.name === home);
      for (const s of T('services').filter((x) => x.category === name)) Object.assign(s, { category_id: to.id, category: to.name, section: to.section });
      const c = T('service_categories').find((x) => x.name === name);
      if (c && !T('services').some((x) => x.category_id === c.id)) state.service_categories = T('service_categories').filter((x) => x !== c);
    }
  }
  // Same as owner_here() in the database: the owner typed the code here (not an unlock approved on Telegram)
  function ownerHere() {
    const now = new Date().toISOString();
    return T('owner_grants').some((x) => x.action === 'unlock' && x.method === 'code' && x.status === 'approved' && x.expires_at > now);
  }
  // Same rule as menu_change_grant(): the owner's code unlock is on, or a one-time approval of exactly this change
  function menuGrant(grantId, ref) {
    const now = new Date().toISOString();
    const code = T('owner_grants').find((x) => x.action === 'unlock' && x.method === 'code' && x.status === 'approved' && x.expires_at > now);
    if (code) return code;
    const g = T('owner_grants').find((x) => x.id === grantId && x.action === 'service' && x.ref === ref && x.status === 'approved' && !x.used_at && x.expires_at > now);
    if (g) g.used_at = now;
    return g || null;
  }
  function logChange(kind, row, old, grant) {
    const skip = ['id', 'created_at', 'updated_at', 'section', 'category', 'slug'];
    const changes = {};
    for (const k of Object.keys(row)) {
      if (skip.includes(k)) continue;
      const a = old ? old[k] ?? null : null;
      const b = row[k] ?? null;
      if (!old && b === null) continue;
      if (JSON.stringify(a) !== JSON.stringify(b)) changes[k] = [a, b];
    }
    if (!Object.keys(changes).length) return;
    insertRow('service_changes', {
      service_id: kind === 'service' ? row.id : null, category_id: kind === 'category' ? row.id : row.category_id, item: row.name, kind,
      action: old ? 'edit' : 'add', changes, changed_by: 'counter (demo)', approved_by: grant.decided_by || 'Owner', owner_grant_id: grant.id,
    });
  }
  const pickKeys = (p, keys) => Object.fromEntries(Object.entries(p).filter(([k]) => keys.includes(k)));
  function saveService(p) {
    const id = p.id || uid();
    const grant = menuGrant(p.owner_grant_id, id);
    if (!grant) throw new Error('Owner approval needed to add or change a service');
    const input = pickKeys(p, SERVICE_KEYS);
    const cur = T('services').find((x) => x.id === id);
    if (!cur && !ownerHere()) throw new Error('Only the owner can add a service: sign in as the owner, or the owner types the code');
    if (cur) {
      const old = clone(cur);
      const next = { ...cur, ...input };
      fillService(next, old);
      Object.assign(cur, next);
      logChange('service', cur, old, grant);
      return cur;
    }
    const row = withDefaults('services', { id, sort: Math.max(0, ...T('services').map((x) => x.sort || 0)) + 10, ...input });
    fillService(row);
    T('services').push(row);
    logChange('service', row, null, grant);
    return row;
  }
  function saveCategory(p) {
    const id = p.id || uid();
    const grant = menuGrant(p.owner_grant_id, id);
    if (!grant) throw new Error('Owner approval needed to add or change a category');
    const input = pickKeys(p, CATEGORY_KEYS);
    if (input.name && T('service_categories').some((x) => x.id !== id && x.name.toLowerCase() === String(input.name).trim().toLowerCase())) throw new Error('There is already a category with that name');
    const cur = T('service_categories').find((x) => x.id === id);
    if (!cur && !ownerHere()) throw new Error('Only the owner can add a category: sign in as the owner, or the owner types the code');
    if (cur) {
      const old = clone(cur);
      Object.assign(cur, input);
      fillCategory(cur, old);
      if (cur.name !== old.name || cur.section !== old.section) {
        for (const s of T('services').filter((x) => x.category_id === id)) Object.assign(s, { category: cur.name, section: cur.section });
        if (cur.name !== old.name) for (const o of T('offers')) if ((o.categories || []).includes(old.name)) o.categories = o.categories.map((c) => (c === old.name ? cur.name : c));
      }
      logChange('category', cur, old, grant);
      return cur;
    }
    const row = withDefaults('service_categories', { id, sort: Math.max(0, ...T('service_categories').map((x) => x.sort || 0)) + 10, ...input });
    fillCategory(row);
    T('service_categories').push(row);
    logChange('category', row, null, grant);
    return row;
  }
  // Mirrors mark_finished() in the database
  function markFinished(p) {
    const prod = T('products').find((x) => x.id === p.product_id);
    if (!prod) throw new Error('Product not found');
    const id = p.id || uid();
    if (T('stock_moves').some((m) => m.id === id)) return prod;
    const left = Math.max(0, Number(prod.stock));
    if (left > 0) {
      const now = new Date().toISOString();
      // like use_owner_grant(): any owner unlock that is on, or a one-time approval for this
      const g = T('owner_grants').find((x) => x.action === 'unlock' && x.status === 'approved' && x.expires_at > now)
        || T('owner_grants').find((x) => x.id === p.owner_grant_id && x.status === 'approved' && x.expires_at > now && x.action === 'stock' && x.ref === id && !x.used_at);
      if (!g) throw new Error(`Owner approval needed: the app still shows ${left} ${prod.unit} in stock`);
      if (g.action === 'stock') g.used_at = now;
      const note = String(p.note || '').trim();
      insertRow('stock_moves', { id, product_id: prod.id, type: 'adjust', qty: -left, unit_cost: prod.cost_price, created_by: 'demo', owner_grant_id: g.id,
        note: `Marked finished with ${left} ${prod.unit} still in the app${note ? ' · ' + note : ''}` });
    }
    const note = String(p.note || '').trim();
    Object.assign(prod, {
      finished_at: prod.finished_at || new Date().toISOString(), finished_by: prod.finished_by || 'counter (demo)',
      ...(note ? { note: [prod.note, `${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}: ${note}`].filter(Boolean).join('\n').slice(0, 1000) } : {}),
    });
    // the one(s) in use are used up too
    const at = new Date().toISOString();
    for (const m of openUnits(T('stock_moves'), T('unit_ends'), prod.id)) T('unit_ends').push({ move_id: m.id, product_id: prod.id, ended_at: at, how: 'finished', by_move: null, created_by: 'demo' });
    return prod;
  }
  // Mirrors end_unit() in the database: one of two in use is empty, no new one needed
  function endUnit(p) {
    const m = T('stock_moves').find((x) => x.id === p.move_id && x.type === 'use' && Number(x.qty) < 0);
    if (!m) throw new Error('Not found');
    const done = T('unit_ends').find((e) => e.move_id === m.id);
    if (done) return done;
    const how = p.how || 'empty';
    if (!['empty', 'no_empty'].includes(how)) throw new Error('Empty handed back: yes or no');
    if (openUnits(T('stock_moves'), T('unit_ends'), m.product_id).filter((x) => x.id !== m.id).length === 0) {
      throw new Error('This is the only one in use. Give out the next one, or mark the product Finished.');
    }
    const row = { move_id: m.id, product_id: m.product_id, ended_at: new Date().toISOString(), how, by_move: null, created_by: 'demo' };
    T('unit_ends').push(row);
    return row;
  }
  // Mirrors record_free_use() in the database
  function recordFreeUse(p) {
    const done = T('free_uses').find((x) => x.id === p.id);
    if (done) return done;
    const svc = T('services').find((x) => x.id === p.service_id);
    if (!svc) throw new Error('Choose the service');
    const opt = String(p.option || '').trim() || null;
    const ext = String(p.extra || '').trim() || null;
    if (opt && !(Array.isArray(svc.variants) && svc.variants.some((v) => v.label === opt))) throw new Error('Choose an option of this service from the menu');
    if (ext && !(svc.extra_options && Array.isArray(svc.extra_options.choices) && svc.extra_options.choices.some((c) => c.label === ext))) throw new Error('Choose an option of this service from the menu');
    if (!['redo', 'staff', 'family', 'training', 'other'].includes(p.reason)) throw new Error('Choose why there was no bill');
    const note = String(p.note || '').trim();
    if (p.reason === 'other' && !note) throw new Error('Write what it was for');
    const qty = p.qty == null || p.qty === '' ? 1 : Number(p.qty);
    if (!(qty > 0 && qty <= 20)) throw new Error('How many? 1 to 20.');
    return insertRow('free_uses', {
      id: p.id || uid(), service_id: svc.id, option_label: opt, extra_label: ext, qty, staff_id: T('staff').some((x) => x.id === p.staff_id) ? p.staff_id : null,
      reason: p.reason, note: note.slice(0, 200) || null, created_by: 'demo',
    });
  }
  function afterDelete(t, row) {
    if (t === 'stock_moves') {
      const p = T('products').find((x) => x.id === row.product_id);
      if (p) p.stock = round2(Number(p.stock) - Number(row.qty));
    }
  }

  function insertRow(t, row) {
    const r = withDefaults(t, row);
    T(t).push(r);
    afterInsert(t, r);
    return r;
  }

  function refreshCustomer(cid) {
    const c = T('customers').find((x) => x.id === cid);
    if (!c) return;
    const bills = T('bills').filter((b) => b.customer_id === cid && b.status === 'paid');
    c.visits = bills.length;
    c.total_spent = round2(bills.reduce((a, b) => a + Number(b.total), 0));
    const times = bills.map((b) => b.created_at).sort();
    c.first_visit = times[0] || null;
    c.last_visit = times[times.length - 1] || null;
    // The first paid bill is the "new customer" visit (same as the database)
    const first = [...bills].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1))[0];
    if (first) for (const b of bills) b.is_new_customer = b.id === first.id;
  }

  // ----- loyalty points (mirror loyalty_balance, expire_points, bill_points in the database) -----
  const settingsObj = () => Object.fromEntries(T('settings').map((x) => [x.key, x.value]));
  function addPoints(row) {
    insertRow('loyalty_points', row);
    const c = T('customers').find((x) => x.id === row.customer_id);
    if (c) c.points = T('loyalty_points').filter((x) => x.customer_id === c.id).reduce((a, x) => a + Number(x.points), 0);
  }
  function expirePoints(cid, at = new Date().toISOString()) {
    const rules = loyaltyRules(settingsObj());
    let n = 0;
    for (const c of T('customers').filter((x) => (!cid || x.id === cid) && Number(x.points) > 0 && x.last_visit)) {
      const exp = expiresAt(c.last_visit, rules);
      if (exp <= at) {
        addPoints({ customer_id: c.id, kind: 'expire', points: -Number(c.points), note: `No visit for ${rules.months} months`, created_at: exp });
        n += 1;
      }
    }
    return n;
  }

  // Mirrors create_bill() in supabase/01_schema.sql
  function createBill(p) {
    if (!p.items || !p.items.length) throw new Error('A bill needs at least one item');
    // Same bill sent twice → return the saved one (mirrors the database function)
    const already = p.id && T('bills').find((b) => b.id === p.id);
    if (already) {
      const tag = 'Also printed offline as ' + p.bill_no;
      if (p.bill_no && already.bill_no !== p.bill_no && !(already.note || '').includes(tag)) already.note = [already.note, tag].filter(Boolean).join(' | ');
      return already;
    }
    // Every figure must add up (the database runs the same check)
    const errs = checkBill(p);
    if (errs.length) throw new Error('Bill check failed: ' + errs[0]);
    if (p.customer_phone && !/^[6-9]\d{9}$/.test(p.customer_phone)) throw new Error('Bill check failed: mobile number must be 10 digits');
    let when = p.created_at || p._created_at || new Date().toISOString();
    let note = p.note || null;
    // A past bill (owner only): its own day and time and number series, like create_bill() in the database
    const past = !!p.past;
    if (past) {
      if (!ownerHere()) throw new Error('Only the owner can add a past bill: sign in as the owner, or the owner types the code');
      if (!p.created_at) throw new Error('Past bill: choose the day and time of the bill');
      if (new Date(when).getTime() > Date.now()) throw new Error('Past bill: the day and time must be before now');
      if (new Date(when).getTime() < Date.now() - 400 * 86400000) throw new Error('Past bill: that is more than 400 days ago');
      if (p.bill_no) throw new Error('Past bills need the internet');
      if (Number(p.paid_points) > 0) throw new Error("Past bill: points can't be used on a past bill");
      const paper = String(p.paper_no || '').trim().slice(0, 40);
      const typed = new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).replace(',', '');
      note = ['Past bill' + (paper ? ', paper bill no. ' + paper : '') + ', typed in ' + typed + (p.created_by ? ' by ' + p.created_by : ''), note].filter(Boolean).join(' | ');
    }
    // A staff member's own services at the staff price (a bill made offline is saved anyway, with a CHECK note)
    const sp = staffPriceCheck(p, { staff: T('staff'), services: T('services'), settings: settingsObj() });
    if (sp.err) {
      if (!p.bill_no) throw new Error(sp.err);
      note = [note, 'CHECK: ' + sp.err].filter(Boolean).join(' | ');
    }
    // A device with a wrong clock can't put a bill in the future
    if (new Date(when).getTime() > Date.now() + 10 * 60000) {
      note = [note, 'Device clock was ahead: ' + when].filter(Boolean).join(' | ');
      when = new Date().toISOString();
    }
    // Loyalty points: the balance after any expiry, then the checks for paying with points. A refused bill
    // changes nothing (like the database, where the whole bill is undone). Offline bills are saved with a note.
    const rules = loyaltyRules(settingsObj());
    const use = Number(p.paid_points) || 0;
    let cust = p.customer_phone ? T('customers').find((c) => c.phone === p.customer_phone) || null : null;
    const expiring = !!cust && Number(cust.points) > 0 && !!cust.last_visit && expiresAt(cust.last_visit, rules) <= when;
    const bal = cust ? (expiring ? 0 : Number(cust.points) || 0) : 0;
    if (use > 0) {
      const cap = Math.floor((Number(p.total) * rules.maxPct) / 100 + 1e-9);
      const perr = !rules.on ? 'points are switched off'
        : !p.customer_phone ? "points need the customer's mobile number"
          : bal < rules.minUse ? `points can be used from ${rules.minUse} points (balance ${bal})`
            : use > bal ? `only ${bal} points left`
              : use > cap ? `points can pay at most ${rules.maxPct}% of a bill (₹${cap} here)` : null;
      if (perr) {
        if (!p.bill_no) throw new Error('Points: ' + perr);
        note = [note, `CHECK: ${use} points used offline, but ${perr}`].filter(Boolean).join(' | ');
      }
    }
    if (p.customer_phone) {
      if (!cust) {
        cust = insertRow('customers', {
          phone: p.customer_phone, name: p.customer_name || null, gender: p.gender || null,
          birthday: p.birthday || null, source: p.source || null, whatsapp_ok: !!p.whatsapp_ok,
          created_at: p._created_at || new Date().toISOString(),
        });
      } else if (p.customer_name && cust.name !== p.customer_name) {
        cust.name = p.customer_name;
      }
    }
    if (expiring) expirePoints(cust.id, when);
    const isNew = cust ? !T('bills').some((b) => b.customer_id === cust.id && b.status === 'paid' && b.created_at < when) : false;
    const earn = earnPoints(p, rules, { phone: p.customer_phone || null, staff: T('staff') });
    // A due (pay later): with the customer's number; above the limit (Settings, ₹200) the owner. Offline: a CHECK note.
    const due = Number(p.paid_due) || 0;
    const chg = Number(p.change_upi) || 0;
    if (due > 0) {
      const max = Number(settingsObj().due_max_counter ?? 200);
      const derr = !p.customer_phone ? "a due needs the customer's mobile number" : due > max && !ownerHere() ? `a due above ₹${max} needs the owner` : null;
      if (derr) {
        if (!p.bill_no) throw new Error('Due: ' + derr);
        note = [note, `CHECK: ₹${due} due offline, but ${derr}`].filter(Boolean).join(' | ');
      }
    }
    if (chg > 0) note = [note, `Change ₹${chg} given by UPI`].filter(Boolean).join(' | ');
    // the financial year in the number: a past bill's own date; every other bill, the day it is saved (like the database)
    const day = past ? istDay(when) : istDay(new Date());
    let y = Number(day.slice(0, 4));
    if (Number(day.slice(5, 7)) < 4) y -= 1;
    const fy = String(y % 100).padStart(2, '0') + String((y + 1) % 100).padStart(2, '0');
    const prefix = (T('settings').find((s) => s.key === 'bill_prefix') || {}).value ?? 'HF';
    let billNo = p.bill_no;
    if (!billNo && past) {
      let ctr = T('counters').find((c) => c.key === 'bill-P-' + fy);
      if (!ctr) { ctr = { key: 'bill-P-' + fy, value: 0 }; T('counters').push(ctr); }
      ctr.value += 1;
      billNo = prefix + fy + '-P' + String(ctr.value).padStart(4, '0');
    } else if (!billNo) {
      let ctr = T('counters').find((c) => c.key === 'bill-' + fy);
      if (!ctr) { ctr = { key: 'bill-' + fy, value: 0 }; T('counters').push(ctr); }
      ctr.value += 1;
      billNo = prefix + fy + '-' + String(ctr.value).padStart(4, '0');
    } else if (T('bills').some((b) => b.bill_no === billNo)) {
      note = [note, 'Number clash: printed as ' + billNo].filter(Boolean).join(' | ');
      let k = 2;
      while (T('bills').some((b) => b.bill_no === billNo + '-' + k)) k += 1;
      billNo += '-' + k;
    }

    const bill = insertRow('bills', {
      ...(p.id ? { id: p.id } : {}),
      bill_no: billNo,
      created_at: when,
      customer_id: cust ? cust.id : null,
      customer_name: p.customer_name || (cust && cust.name) || null,
      customer_phone: p.customer_phone || null,
      is_new_customer: isNew,
      subtotal: p.subtotal, offer_discount: p.offer_discount || 0, discount: p.discount || 0, taxable: p.taxable,
      cgst: p.cgst || 0, sgst: p.sgst || 0, round_off: p.round_off || 0, total: p.total,
      pay_mode: p.pay_mode, paid_cash: p.paid_cash || 0, paid_upi: p.paid_upi || 0, paid_card: p.paid_card || 0,
      paid_points: use, points_earned: earn, paid_due: due, change_upi: chg, due_cleared: 0, due_left: due,
      note, created_by: p.created_by || null, for_staff: sp.for_staff,
    });
    for (const it of p.items) {
      insertRow('bill_items', {
        bill_id: bill.id, created_at: when, item_type: it.item_type,
        service_id: it.service_id || null, product_id: it.product_id || null,
        name: it.name, category: it.category || null, hsn_sac: it.hsn_sac || null,
        staff_id: it.staff_id || null, staff_name: it.staff_name || null,
        qty: it.qty, unit_price: it.unit_price, amount: it.amount,
        offer_id: it.offer_id || null, offer_name: it.offer_name || null, offer_discount: it.offer_discount || 0, line_discount: it.line_discount || 0,
        staff_discount: it.staff_discount || 0, commission_base: it.commission_base != null && it.commission_base !== '' ? it.commission_base : it.taxable,
        discount: it.discount || 0, taxable: it.taxable, gst_pct: it.gst_pct || 0, gst: it.gst || 0,
      });
      if (it.item_type === 'product' && it.product_id) {
        insertRow('stock_moves', { product_id: it.product_id, type: 'sale', qty: -Number(it.qty), bill_id: bill.id, note: bill.bill_no, created_at: when });
      }
    }
    if (cust) {
      if (use > 0) addPoints({ customer_id: cust.id, bill_id: bill.id, kind: 'use', points: -use, created_at: when, created_by: p.created_by || null });
      if (earn > 0) addPoints({ customer_id: cust.id, bill_id: bill.id, kind: 'earn', points: earn, created_at: when, created_by: p.created_by || null });
      bill.points_balance = Number(cust.points) || 0;
      refreshCustomer(cust.id);
    }
    linkVisit(T, bill); // a booking that day for this phone: they came (same as link_visit() in the database)
    // A corrected bill: it replaces a bill the owner just cancelled (same as create_bill() in the database)
    const old = p.replaces ? T('bills').find((x) => x.id === p.replaces && x.status === 'cancelled' && !x.replaced_by) : null;
    if (old) { old.replaced_by = bill.id; bill.replaces = old.id; }
    return bill;
  }

  // Edit a saved bill: the owner only; what doesn't change the money, with a history (same rules as edit_bill() in
  // the database)
  function editBill(id, p) {
    if (!ownerHere()) throw new Error('Only the owner can edit a bill');
    const b = T('bills').find((x) => x.id === id);
    if (!b) throw new Error('Bill not found');
    if (b.status !== 'paid') throw new Error("A cancelled bill can't be edited");
    const reason = String(p.reason || '').trim().slice(0, 200);
    if (!reason) throw new Error('Write why the bill is being changed');
    const ch = {};
    const staffNo = (ph) => T('staff').some((s) => s.active && String(s.phone || '').replace(/\D/g, '').slice(-10) === ph);
    if ('customer_phone' in p) {
      const ph = String(p.customer_phone || '').replace(/\D/g, '') || null;
      if (ph !== (b.customer_phone || null)) {
        if (ph && !/^[6-9]\d{9}$/.test(ph)) throw new Error('The mobile number must be 10 digits');
        if (b.for_staff) throw new Error("This is a staff member's own bill (staff prices). Use Correct items instead.");
        if (ph && staffNo(ph)) throw new Error("That is a staff member's number: their own bills have staff prices. Use Correct items instead.");
        if (Number(b.paid_points) > 0) throw new Error("Points were used on this bill, so its number can't change. Use Correct items instead.");
        const earned = Number(b.points_earned) || 0;
        if (earned > 0 && !ph) throw new Error('This bill earned points, so it needs a mobile number');
        const oldC = b.customer_id ? T('customers').find((c) => c.id === b.customer_id) : null;
        if (earned > 0 && oldC && Number(oldC.points) < earned) throw new Error('The points this bill earned were already used by that customer. Use Correct items instead.');
        let nc = ph ? T('customers').find((c) => c.phone === ph) : null;
        if (ph && !nc) nc = insertRow('customers', { phone: ph, name: String(p.customer_name || '').trim() || null });
        if (earned > 0) {
          addPoints({ customer_id: oldC.id, bill_id: b.id, kind: 'adjust', points: -earned, note: `Bill ${b.bill_no} moved to ${ph}` });
          addPoints({ customer_id: nc.id, bill_id: b.id, kind: 'adjust', points: earned, note: `Bill ${b.bill_no} moved from ${b.customer_phone || 'no number'}` });
        }
        ch.customer_phone = [b.customer_phone || null, ph];
        Object.assign(b, { customer_id: nc ? nc.id : null, customer_phone: ph, points_balance: null });
        if (oldC) refreshCustomer(oldC.id);
        if (nc) refreshCustomer(nc.id);
      }
    }
    if ('customer_name' in p) {
      const nm = String(p.customer_name || '').trim().slice(0, 80) || null;
      if (nm !== (b.customer_name || null)) {
        ch.customer_name = [b.customer_name || null, nm];
        b.customer_name = nm;
        const c = b.customer_id && T('customers').find((x) => x.id === b.customer_id);
        if (c && nm) c.name = nm;
      }
    }
    if (Array.isArray(p.items)) {
      const month = istDay(b.created_at).slice(0, 7);
      const moves = [];
      for (const it of p.items) {
        const li = T('bill_items').find((x) => x.id === it.id && x.bill_id === b.id);
        if (!li) throw new Error('That line is not on this bill');
        const st = it.staff_id ? T('staff').find((s) => s.id === it.staff_id) : null;
        if (it.staff_id && !st) throw new Error('Choose a staff member on the list');
        if ((st ? st.id : null) === (li.staff_id || null)) continue;
        if (T('payslips').some((x) => x.month === month && x.status === 'paid' && [li.staff_id, st && st.id].includes(x.staff_id))) {
          const mn = new Date(b.created_at).toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', month: 'long', year: 'numeric' });
          throw new Error(`The salary for ${mn} is already paid, so who did ${li.name} can't change now`);
        }
        moves.push({ li, st });
      }
      if (moves.length) {
        ch.staff = moves.map(({ li, st }) => ({ line: li.name, from: li.staff_name || null, to: st ? st.name : null }));
        for (const { li, st } of moves) Object.assign(li, { staff_id: st ? st.id : null, staff_name: st ? st.name : null });
      }
    }
    if ('paid_cash' in p || 'paid_upi' in p || 'paid_card' in p) {
      const amt = (k) => { const v = String(p[k] ?? '0'); if (!/^\d+(\.\d{1,2})?$/.test(v)) throw new Error('Type the amounts paid'); return Number(v); };
      const c = amt('paid_cash'), u = amt('paid_upi'), k = amt('paid_card');
      if (c !== Number(b.paid_cash) || u !== Number(b.paid_upi) || k !== Number(b.paid_card)) {
        if (Number(b.change_upi) > 0) throw new Error('Change was given by UPI on this bill. Use Correct items instead.');
        const due = Math.round((Number(b.total) - Number(b.paid_points || 0) - Number(b.paid_due || 0)) * 100);
        if (Math.round((c + u + k) * 100) !== due) throw new Error(`Cash, UPI and card must add up to ₹${due / 100}`);
        if (T('cash_closes').some((x) => x.closed_at >= b.created_at)) throw new Error("The cash for that time is already closed, so how this bill was paid can't change now");
        const mode = (c > 0) + (u > 0) + (k > 0) > 1 ? 'Split' : u > 0 ? 'UPI' : k > 0 ? 'Card' : 'Cash';
        ch.payment = [{ mode: b.pay_mode, cash: b.paid_cash, upi: b.paid_upi, card: b.paid_card }, { mode, cash: c, upi: u, card: k }];
        Object.assign(b, { paid_cash: c, paid_upi: u, paid_card: k, pay_mode: mode });
      }
    }
    if ('note' in p) {
      const nt = String(p.note || '').trim().slice(0, 300) || null;
      if (nt !== (b.note || null)) { ch.note = [b.note || null, nt]; b.note = nt; }
    }
    if (!Object.keys(ch).length) throw new Error('Nothing was changed');
    b.edited_at = new Date().toISOString();
    insertRow('bill_edits', { bill_id: b.id, edited_by: 'demo owner', reason, changes: ch, edited_at: b.edited_at });
    return b;
  }

  // A due collected at the counter (same rules as collect_due() in the database)
  function collectDue(p) {
    const b = T('bills').find((x) => x.id === p.bill_id);
    if (!b) throw new Error('Bill not found');
    if (b.status !== 'paid') throw new Error('This bill is cancelled: nothing is due');
    const v = String(p.amount ?? '');
    if (!/^\d+(\.\d{1,2})?$/.test(v) || Number(v) <= 0) throw new Error('Type the amount paid');
    const left = round2((Number(b.paid_due) || 0) - (Number(b.due_cleared) || 0));
    if (Number(v) > left) throw new Error(`Only ₹${left} is due on ${b.bill_no}`);
    const mode = p.mode || 'cash';
    if (!['cash', 'upi', 'card'].includes(mode)) throw new Error('Choose how it was paid');
    const r = insertRow('due_payments', { bill_id: b.id, customer_id: b.customer_id || null, amount: Number(v), mode, note: String(p.note || '').trim() || null, created_by: 'demo' });
    b.due_cleared = round2((Number(b.due_cleared) || 0) + Number(v));
    b.due_left = round2(Number(b.paid_due) - b.due_cleared);
    return r;
  }

  function cancelBill({ p_id, p_reason }) {
    const b = T('bills').find((x) => x.id === p_id && x.status === 'paid');
    if (!b) throw new Error('Bill not found or already cancelled');
    Object.assign(b, { status: 'cancelled', cancel_reason: p_reason, cancelled_at: new Date().toISOString() });
    for (const m of T('stock_moves').filter((x) => x.bill_id === p_id && x.type === 'sale')) {
      insertRow('stock_moves', { product_id: m.product_id, type: 'return', qty: -Number(m.qty), bill_id: p_id, note: 'Cancelled ' + b.bill_no });
    }
    // Points: the ones used go back, the ones earned come off. Points from before they expired stay expired.
    const back = Math.trunc(Number(b.paid_points) || 0) - (Number(b.points_earned) || 0);
    if (b.customer_id) {
      expirePoints(b.customer_id);
      const expiredSince = T('loyalty_points').some((x) => x.customer_id === b.customer_id && x.kind === 'expire' && x.created_at > b.created_at);
      if (back !== 0 && !expiredSince) addPoints({ customer_id: b.customer_id, bill_id: b.id, kind: 'cancel', points: back, note: 'Cancelled ' + b.bill_no });
    }
    if (b.customer_id) refreshCustomer(b.customer_id);
    unlinkVisit(T, b);
    return b;
  }

  // Mirrors save_booking() in the database: a booking added or changed at the counter, priced from the menu
  function saveBooking(p) {
    const old = p.id ? T('bookings').find((x) => x.id === p.id) : null;
    if (p.id && !old) throw new Error('Booking not found');
    const phone = cleanPhone(p.phone);
    if (!phone) throw new Error('Enter a 10-digit mobile number');
    const name = String(p.name || '').trim().slice(0, 80);
    if (name.length < 2) throw new Error('Enter the name');
    const slot = p.slot_at || null;
    if (slot && isNaN(new Date(slot))) throw new Error('Choose a time');
    const day = p.date || (slot ? istDay(new Date(slot)) : null);
    if (!day) throw new Error('Choose a day');
    if (slot && istDay(new Date(slot)) !== day) throw new Error('The time is on another day');
    if (!old && day < istDay()) throw new Error('Choose today or a later day');
    if (day > addDays(istDay(), 180)) throw new Error('Choose a day in the next 6 months');
    const status = p.status || (slot ? 'confirmed' : 'requested');
    if (!['requested', 'confirmed', 'came', 'no_show', 'cancelled'].includes(status)) throw new Error('Unknown status');
    if (status === 'confirmed' && !slot) throw new Error('Choose the time to confirm it');
    const source = old && old.source === 'website' ? 'website' : p.source || (old && old.source) || 'whatsapp';
    const staffId = T('staff').some((x) => x.id === p.staff_id) ? p.staff_id : null;
    const withItems = !!p.items || !old;
    if (withItems && !(Array.isArray(p.items) && p.items.length >= 1 && p.items.length <= 10)) throw new Error('Choose 1 to 10 services');
    let items = null;
    if (withItems) {
      items = p.items.map((it) => {
        const svc = T('services').find((x) => x.id === it.service_id && x.active);
        if (!svc) throw new Error('A service is not on the menu any more');
        return bookingItem(svc, it.option, it.extra);
      });
    }
    const time = slot ? new Date(slot).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : null;
    const cust = T('customers').find((c) => c.phone === phone);
    const enquiry = p.enquiry_id ? T('enquiries').find((e) => e.id === p.enquiry_id) : null;
    let b;
    if (!old) {
      b = insertRow('bookings', {
        ref: uid().replace(/-/g, '').slice(0, 6).toUpperCase(), phone, name, customer_id: cust ? cust.id : null, want_date: day,
        want_time: time || String(p.time || '').trim().slice(0, 40) || null, slot_at: slot, staff_id: staffId, source, status,
        note: String(p.note || '').trim().slice(0, 500) || null, created_by: 'demo', confirmed_at: status === 'confirmed' ? new Date().toISOString() : null,
        enquiry_id: enquiry ? enquiry.id : null, updated_at: new Date().toISOString(),
      });
    } else {
      const moved = old.slot_at !== slot;
      Object.assign(old, {
        phone, name, customer_id: old.customer_id || (cust ? cust.id : null), want_date: day,
        want_time: time || String(p.time || '').trim().slice(0, 40) || old.want_time, slot_at: slot, staff_id: staffId, source, status,
        note: 'note' in p ? String(p.note || '').trim().slice(0, 500) || null : old.note,
        confirmed_at: status === 'confirmed' && (old.status !== 'confirmed' || moved) ? new Date().toISOString() : old.confirmed_at,
        reminded_at: moved ? null : old.reminded_at, confirm_sent_at: moved ? null : old.confirm_sent_at,
        cancel_reason: status === 'cancelled' ? String(p.cancel_reason || '').trim().slice(0, 200) || null : null, updated_at: new Date().toISOString(),
      });
      b = old;
    }
    if (items) {
      state.booking_items = T('booking_items').filter((x) => x.booking_id !== b.id);
      for (const it of items) insertRow('booking_items', { booking_id: b.id, ...it });
      b.duration_min = durationOf(items, T('services'));
    }
    if (b.enquiry_id) {
      const e = T('enquiries').find((x) => x.id === b.enquiry_id);
      if (e && e.status !== 'came') Object.assign(e, { status: 'booked', booking_id: b.id });
    }
    return b;
  }

  // ----- staff: face check-in and leave (mirror face_check_in, leave_to_attendance, request_leave, decide_leave) -----
  function setAttendance(staffId, day, status, markedBy, note, onlyIf) {
    const a = T('attendance').find((x) => x.staff_id === staffId && x.day === day);
    if (!a) return insertRow('attendance', { staff_id: staffId, day, status, marked_by: markedBy, note: note ?? null });
    if (onlyIf && !onlyIf.includes(a.status)) return a;
    return Object.assign(a, { status, marked_by: markedBy, ...(note !== undefined ? { note } : {}) });
  }
  function leaveToAttendance(op, n, o) {
    if (n.status === 'approved' && (op === 'insert' || o.status !== 'approved')) {
      const note = String(n.reason || n.kind || '').slice(0, 200);
      for (let d = n.from_day; d <= n.to_day; d = addDays(d, 1)) setAttendance(n.staff_id, d, 'L', 'leave approved', note, ['A', 'L']);
    } else if (op === 'update' && o.status === 'approved' && n.status !== 'approved') {
      state.attendance = T('attendance').filter((x) => !(x.staff_id === o.staff_id && x.day >= o.from_day && x.day <= o.to_day && x.status === 'L'));
    }
  }
  function faceCheckIn(p) {
    const s = T('staff').find((x) => x.id === p.staff_id && x.active);
    if (!s) throw new Error('Staff not found');
    if (!T('staff_faces').some((f) => f.staff_id === s.id)) throw new Error('Face check-in is not set up for this person');
    const dist = p.distance === '' || p.distance == null ? NaN : Number(p.distance);
    if (!(dist >= 0 && dist <= 0.55)) throw new Error('The face did not match. Try again in better light.');
    if (p.live !== true) throw new Error('Blink or turn your head a little, so the app knows it is a real face');
    if (!/^data:image\/(jpeg|png|webp);base64,/.test(p.photo || '') || p.photo.length > 90000) throw new Error('The check-in photo is missing');
    const day = istDay();
    const now = new Date();
    const row = T('check_ins').find((x) => x.staff_id === s.id && x.day === day);
    if (!row) {
      const r = insertRow('check_ins', { staff_id: s.id, day, in_at: now.toISOString(), out_at: null, in_photo: p.photo, out_photo: null, in_distance: Math.round(dist * 1000) / 1000, out_distance: null, created_by: 'demo' });
      setAttendance(s.id, day, 'P', 'face check-in');
      return { kind: 'in', at: r.in_at, name: s.name };
    }
    if (now < new Date(new Date(row.in_at).getTime() + 30 * 60000)) return { kind: 'again', at: row.in_at, name: s.name };
    if (row.out_at && now < new Date(new Date(row.out_at).getTime() + 60000)) return { kind: 'again_out', at: row.out_at, name: s.name };
    Object.assign(row, { out_at: now.toISOString(), out_photo: p.photo, out_distance: Math.round(dist * 1000) / 1000 });
    return { kind: 'out', at: row.out_at, in_at: row.in_at, name: s.name };
  }
  function requestLeave(p) {
    const s = T('staff').find((x) => x.id === p.staff_id && x.active);
    if (!s) throw new Error('Choose who is asking');
    const from = p.from_day;
    const to = p.to_day || from;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw new Error('Choose the days');
    if (to < from) throw new Error('The last day is before the first');
    if (to > addDays(from, 30)) throw new Error('At most 31 days at a time');
    const today = istDay();
    if (from < addDays(today, -7)) throw new Error('That is more than a week ago. The owner can mark past days.');
    if (from > addDays(today, 180)) throw new Error('Choose days in the next 6 months');
    if (T('leave_requests').some((x) => x.staff_id === s.id && ['pending', 'approved'].includes(x.status) && x.from_day <= to && x.to_day >= from)) {
      throw new Error('There is already a request for some of these days');
    }
    const kind = p.kind || 'planned';
    if (!['planned', 'sick', 'personal', 'other'].includes(kind)) throw new Error('Choose the kind of leave');
    const rule = leaveRuleError({ staffId: s.id, from, to, kind, today, leaves: T('leave_requests'), attendance: T('attendance'), staff: T('staff'), settings: settingsObj() });
    if (rule) throw new Error(rule);
    const r = insertRow('leave_requests', { staff_id: s.id, from_day: from, to_day: to, kind, reason: String(p.reason || '').trim().slice(0, 300) || null, requested_by: 'demo' });
    leaveToAttendance('insert', r);
    return r;
  }
  // Expenses and the cash close: the same checks as add_expense(), cancel_expense() and close_day() in the database.
  // The demo is the owner (the screens ask for the owner's code where the database would).
  function addExpense(p) {
    const old = p.id && T('expenses').find((x) => x.id === p.id);
    if (old) return old;
    const row = checkExpense(p, { owner: true });
    return insertRow('expenses', { ...(p.id ? { id: p.id } : {}), ...row });
  }
  function cancelExpense({ p_id, p_reason }) {
    const r = T('expenses').find((x) => x.id === p_id);
    if (!r) throw new Error('Expense not found');
    if (!r.cancelled_at) Object.assign(r, { cancelled_at: new Date().toISOString(), cancelled_by: 'Owner (demo)', cancel_reason: String(p_reason || '').trim().slice(0, 200) || null });
    return r;
  }
  function closeDay(p) {
    const today = istDay();
    // check the typed figures first, as the database does, then count again from the close before
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(String(p.counted ?? ''))) throw new Error('Type the cash counted');
    if (Number(p.counted) > 10000000) throw new Error('Type the cash counted');
    if (!/^[0-9]+(\.[0-9]{1,2})?$/.test(String(p.taken_out ?? '0'))) throw new Error('Type the cash taken out');
    if (Number(p.taken_out ?? 0) > Number(p.counted)) throw new Error("Cash taken out can't be more than the cash counted");
    const rest = T('cash_closes').filter((c) => c.day !== today);
    const row = checkClose(p, cashNow({ bills: T('bills'), expenses: T('expenses'), closes: rest, dues: T('due_payments') }), settingsObj());
    state.cash_closes = rest;
    return insertRow('cash_closes', { day: today, closed_at: new Date().toISOString(), closed_by: 'demo', notified_at: null, ...row });
  }
  function handleFeedback({ p_id, p_note }) {
    const r = T('feedback').find((x) => x.id === p_id);
    if (!r) throw new Error('Feedback not found');
    Object.assign(r, { handled_at: new Date().toISOString(), handled_by: 'Owner (demo)', handled_note: String(p_note || '').trim().slice(0, 300) || null });
    return r;
  }

  function decideLeave({ p_id, p_approve }) {
    const r = T('leave_requests').find((x) => x.id === p_id && x.status === 'pending');
    if (!r) throw new Error('This request was already answered');
    const old = clone(r);
    Object.assign(r, { status: p_approve ? 'approved' : 'rejected', decided_by: 'Owner (demo)', decided_at: new Date().toISOString() });
    leaveToAttendance('update', r, old);
    return r;
  }

  // Mirrors issue_stock() in supabase/01_schema.sql: taking stock out, with who took it, what happened to
  // the one in use now, and the owner's approval
  function issueStock(p, at) {
    const done = T('stock_moves').find((m) => m.id === p.id);
    if (done) return done;
    const prod = T('products').find((x) => x.id === p.product_id);
    if (!prod) throw new Error('Product not found');
    const qty = Number(p.qty);
    if (!(qty > 0) || qty > 100) throw new Error('How many? Enter 1 to 100.');
    if (qty > Number(prod.stock)) throw new Error(`Only ${Number(prod.stock)} ${prod.unit} in stock. Ask the owner to correct the count first.`);
    const last = p.last || (p.empty_returned ? 'empty' : 'no_empty');
    if (!['empty', 'no_empty', 'in_use'].includes(last)) throw new Error('Say what happened to the one in use now');
    const staffId = T('staff').some((x) => x.id === p.staff_id) ? p.staff_id : null;
    const size = p.unit_size != null && p.unit_size !== '' ? Number(p.unit_size) : prod.size != null ? Number(prod.size) : null;
    if (size != null && !(size > 0 && size <= 100000)) throw new Error('Size of one: more than 0');
    const open = unitToEnd(openUnits(T('stock_moves'), T('unit_ends'), prod.id), staffId);
    const emptyOk = !open || last === 'empty';
    const set = (k) => (T('settings').find((x) => x.key === k) || {}).value;
    const rule = set('stock_approval') || 'expensive';
    const above = Number(set('stock_approval_above') ?? 500);
    const needs = !at && (rule === 'always' || (rule === 'expensive' && (Number(prod.cost_price) * qty >= above || !emptyOk)));
    if (needs) {
      const now = new Date().toISOString();
      const g = T('owner_grants').find((x) => x.id === p.owner_grant_id && x.status === 'approved' && x.expires_at > now
        && (x.action === 'unlock' || (x.action === 'stock' && x.ref === p.id && !x.used_at)));
      if (!g) throw new Error('Owner approval needed to take this out');
      if (g.action === 'stock') g.used_at = now;
    }
    const when = at || new Date().toISOString();
    const move = insertRow('stock_moves', {
      id: p.id || uid(), product_id: prod.id, type: 'use', qty: -qty, unit_cost: prod.cost_price, staff_id: staffId,
      empty_returned: open ? last === 'empty' : null, note: p.note || null, created_by: 'demo', owner_grant_id: p.owner_grant_id || null, created_at: when,
      unit_size: size,
    });
    if (open && last !== 'in_use') T('unit_ends').push({ move_id: open.id, product_id: prod.id, ended_at: when, how: last, by_move: move.id, created_by: 'demo' });
    return move;
  }

  const api = {
    mode: 'demo',
    async list(t, o = {}) {
      return clone(orderAndLimit(T(t).filter((r) => matches(r, o)), o));
    },
    async get(t, id) {
      const r = T(t).find((x) => x.id === id);
      return r ? clone(r) : null;
    },
    async insert(t, rows) {
      const many = Array.isArray(rows);
      const out = (many ? rows : [rows]).map((r) => insertRow(t, r));
      persist(state);
      return clone(many ? out : out[0]);
    },
    async update(t, id, patch) {
      const r = T(t).find((x) => x.id === id);
      if (!r) throw new Error('Not found');
      const old = clone(r);
      Object.assign(r, patch);
      if (t === 'leave_requests') leaveToAttendance('update', r, old);
      persist(state);
      return clone(r);
    },
    async upsert(t, row, onConflict) {
      const keys = onConflict.split(',').map((s) => s.trim());
      const r = T(t).find((x) => keys.every((k) => x[k] === row[k]));
      if (t === 'staff_faces' && !(Array.isArray(row.descriptors) && row.descriptors.length >= 1 && row.descriptors.length <= 10)) throw new Error('Face set-up needs 1 to 10 looks');
      let out;
      if (r) { Object.assign(r, row); out = r; } else { out = insertRow(t, row); }
      persist(state);
      return clone(out);
    },
    async remove(t, id) {
      const i = T(t).findIndex((x) => x.id === id);
      if (i >= 0) {
        const [r] = T(t).splice(i, 1);
        afterDelete(t, r);
        persist(state);
      }
    },
    async removeWhere(t, match) {
      if (!match || !Object.keys(match).length) throw new Error('Nothing to delete');
      state[t] = T(t).filter((r) => !Object.entries(match).every(([k, v]) => r[k] === v));
      persist(state);
    },
    async rpc(name, args) {
      let out;
      if (name === 'create_bill') out = createBill(args.p);
      else if (name === 'cancel_bill') out = cancelBill(args);
      else if (name === 'issue_stock') out = issueStock(args.p);
      else if (name === 'save_service') out = saveService(args.p);
      else if (name === 'save_service_category') out = saveCategory(args.p);
      else if (name === 'mark_finished') out = markFinished(args.p);
      else if (name === 'record_free_use') out = recordFreeUse(args.p);
      else if (name === 'end_unit') out = endUnit(args.p);
      else if (name === 'save_booking') out = saveBooking(args.p);
      else if (name === 'unit_report') out = unitReport(T, { since: args && args.p_since });
      else if (name === 'face_check_in') out = faceCheckIn(args.p);
      else if (name === 'request_leave') out = requestLeave(args.p);
      else if (name === 'decide_leave') out = decideLeave(args);
      else if (name === 'add_expense') out = addExpense(args.p);
      else if (name === 'cancel_expense') out = cancelExpense(args);
      else if (name === 'cash_now') out = cashNow({ bills: T('bills'), expenses: T('expenses'), closes: T('cash_closes'), dues: T('due_payments') });
      else if (name === 'close_day') out = closeDay(args.p);
      else if (name === 'handle_feedback') out = handleFeedback(args);
      else if (name === 'edit_bill') out = editBill(args.p_id, args.p || {});
      else if (name === 'collect_due') out = collectDue(args.p || {});
      else throw new Error('Unknown function ' + name);
      persist(state);
      return clone(out);
    },
    async ping() {
      return true;
    },
    // Staff documents: in the demo the files stay in this browser (in the cloud: private Supabase storage)
    files: {
      async upload(path, blob) {
        const data = await new Promise((ok, bad) => {
          const fr = new FileReader();
          fr.onload = () => ok(fr.result);
          fr.onerror = () => bad(new Error('Could not read the file'));
          fr.readAsDataURL(blob);
        });
        if (JSON.stringify(state).length + data.length > DEMO_FILES_MAX) throw new Error('The demo keeps files in this browser, and it is full. Delete a file or use a smaller one.');
        state.doc_files = T('doc_files').filter((f) => f.id !== path);
        T('doc_files').push({ id: path, data, created_at: new Date().toISOString() });
        persist(state);
        return { path };
      },
      async download(path) {
        const f = T('doc_files').find((x) => x.id === path);
        if (!f) throw new Error('File not found');
        // data URL → file, without fetch (the app's security rules allow fetching only the database)
        const [head, b64] = f.data.split(',');
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new Blob([bytes], { type: (head.match(/^data:([^;]+)/) || [])[1] || 'application/octet-stream' });
      },
      async remove(paths) {
        state.doc_files = T('doc_files').filter((f) => !paths.includes(f.id));
        persist(state);
      },
    },
    async notify() {
      return null; // no Telegram in the demo
    },
    // WhatsApp bills: the demo sends nothing. It checks the bill like the whatsapp Edge Function, records the send and
    // marks it delivered a moment later, to show how the screens work.
    async whatsapp(body) {
      if (body.action === 'status') return { configured: false, demo: true, missing: [], template: 'bill_receipt', lang: 'en' };
      // the booking bot lives in the Edge Function only: the demo has no WhatsApp chats, so the app's own button is used
      if (body.action === 'booking_confirm') return { ok: false, demo: true, window: true, error: 'Demo: WhatsApp is not connected.' };
      if (body.action === 'auto') {
        // the demo sends nothing: it records what would go, marks reminders, and "answers" a feedback request
        const due = dueMessages({ bills: T('bills'), bookings: T('bookings'), booking_items: T('booking_items'), customers: T('customers'), staff: T('staff'), wa_messages: T('wa_messages') }, settingsObj(), body.now ? new Date(body.now) : new Date());
        const sent = { feedback: 0, reminder: 0, winback: 0 };
        for (const d of due) {
          insertRow('wa_messages', { bill_id: d.bill_id || null, booking_id: d.booking_id || null, customer_id: d.customer_id || null, phone: d.phone, kind: d.kind, dedupe: d.dedupe, status: 'delivered', wamid: 'demo.' + uid(), error: null, created_by: 'auto', updated_at: new Date().toISOString() });
          sent[d.kind]++;
          if (d.kind === 'reminder') { const k = T('bookings').find((x) => x.id === d.booking_id); if (k) k.reminded_at = new Date().toISOString(); }
          if (d.kind === 'feedback' && !T('feedback').some((f) => f.bill_id === d.bill_id)) insertRow('feedback', { bill_id: d.bill_id, customer_id: d.customer_id, phone: d.phone, name: d.name, rating: 'good' });
        }
        persist(state);
        return { ok: true, demo: true, sent };
      }
      if (body.action === 'slip') {
        // like the Edge Function: a paid payslip, to the staff member's own number, at most 3 times
        const p = T('payslips').find((x) => x.id === body.id);
        if (!p) throw new Error('Not allowed');
        if (p.status !== 'paid') return { ok: false, error: 'This salary is not marked paid yet.' };
        const st = T('staff').find((x) => x.id === p.staff_id);
        if (!st) return { ok: false, error: 'This staff member is not in the staff list any more.' };
        const first = String(st.name || '').trim().split(/\s+/)[0] || 'there';
        const phone = String(st.phone || '').replace(/\D/g, '').slice(-10);
        if (!/^[6-9]\d{9}$/.test(phone)) return { ok: false, error: `${first} has no mobile number in Staff. Add it, then send the slip.` };
        if (!body.image) return { ok: false, error: 'The slip picture is missing.' };
        const prev = T('wa_messages').filter((m) => m.payslip_id === p.id).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
        const sent = prev.filter((m) => m.status !== 'failed');
        if (prev.length && Date.now() - new Date(prev[0].created_at).getTime() < 60000 && prev[0].status !== 'failed') return { ok: true, status: prev[0].status, already: true };
        if (sent.length && !body.again) return { ok: true, status: sent[0].status, already: true };
        if (prev.length >= 3) return { ok: false, error: 'Sent 3 times already. Print the slip instead.' };
        const row = insertRow('wa_messages', { payslip_id: p.id, phone, kind: 'slip', status: 'sent', wamid: 'demo.' + uid(), error: null, created_by: 'demo', updated_at: new Date().toISOString() });
        persist(state);
        setTimeout(() => {
          const r = T('wa_messages').find((x) => x.id === row.id);
          if (r && r.status === 'sent') { r.status = 'delivered'; r.updated_at = new Date().toISOString(); persist(state); }
        }, 2500);
        return { ok: true, status: 'sent', demo: true, name: first };
      }
      if (body.action !== 'bill') throw new Error('Bad request');
      const b = T('bills').find((x) => x.id === body.id);
      if (!b) throw new Error('Not allowed');
      if (b.status !== 'paid') return { ok: false, error: 'This bill is cancelled.' };
      if (!/^[6-9]\d{9}$/.test(b.customer_phone || '')) return { ok: false, error: 'There is no mobile number on this bill.' };
      if (Date.now() - new Date(b.created_at).getTime() > 30 * 86400000) return { ok: false, error: "Bills older than 30 days aren't sent." };
      if (!body.image) return { ok: false, error: 'The bill picture is missing.' };
      const prev = T('wa_messages').filter((m) => m.bill_id === b.id).sort((x, y) => (x.created_at < y.created_at ? 1 : -1));
      const sent = prev.filter((m) => m.status !== 'failed');
      if (prev.length && Date.now() - new Date(prev[0].created_at).getTime() < 60000 && prev[0].status !== 'failed') return { ok: true, status: prev[0].status, already: true };
      if (sent.length && !body.again) return { ok: true, status: sent[0].status, already: true };
      if (prev.length >= 3) return { ok: false, error: 'Sent 3 times already. Use the WhatsApp button (2 taps) instead.' };
      const row = insertRow('wa_messages', { bill_id: b.id, phone: b.customer_phone, kind: 'bill', status: 'sent', wamid: 'demo.' + uid(), error: null, created_by: 'demo', updated_at: new Date().toISOString() });
      persist(state);
      setTimeout(() => {
        const r = T('wa_messages').find((x) => x.id === row.id);
        if (r && r.status === 'sent') { r.status = 'delivered'; r.updated_at = new Date().toISOString(); persist(state); }
      }, 2500);
      return { ok: true, status: 'sent', demo: true };
    },
    // Demo has no logins: always "owner". For testing the approval screens, set
    // localStorage "demo-login-status" to none / pending / approved / denied.
    async loginStatus() {
      try { return localStorage.getItem('demo-login-status') || 'owner'; } catch { return 'owner'; }
    },
    async requestLogin() {
      const st = await api.loginStatus();
      if (st !== 'none') return st;
      try { localStorage.setItem('demo-login-status', 'pending'); } catch { /* ignore */ }
      return 'pending';
    },
    async listLogins() {
      try { return JSON.parse(localStorage.getItem('demo-logins') || '[]'); } catch { return []; }
    },
    async decideLogin(id, approve) {
      const rows = await api.listLogins();
      const r = rows.find((x) => x.session_id === id);
      if (r) Object.assign(r, { status: approve ? 'approved' : 'denied', decided_at: new Date().toISOString(), decided_by: 'Owner' });
      try { localStorage.setItem('demo-logins', JSON.stringify(rows)); } catch { /* ignore */ }
      return r;
    },
    // ----- owner approval (demo copy of the database functions) -----
    // In the demo nobody is on Telegram, so a request is approved by itself after 3 seconds
    // (set localStorage "demo-owner-auto" to "0" to try waiting / denying).
    async ownerRequest({ action, ref, detail, device, amount }) {
      const g = insertRow('owner_grants', {
        session_id: 'demo', user_id: 'demo', email: 'counter (demo)', device: device || '', action, ref: ref || null,
        amount: action === 'discount' ? amount ?? null : null, detail: detail || '', method: 'telegram', status: 'pending',
      });
      persist(state);
      let auto = true;
      try { auto = localStorage.getItem('demo-owner-auto') !== '0'; } catch { /* ignore */ }
      if (auto) {
        setTimeout(() => {
          if (g.status !== 'pending') return;
          Object.assign(g, { status: 'approved', decided_at: new Date().toISOString(), decided_by: 'Owner (demo)', expires_at: new Date(Date.now() + 600000).toISOString() });
          persist(state);
        }, 3000);
      }
      return clone(g);
    },
    async ownerStatus(id) {
      const g = T('owner_grants').find((x) => x.id === id);
      return g ? clone(g) : null;
    },
    async ownerCode({ code, detail, device }) {
      const since = new Date(Date.now() - 15 * 60000).toISOString();
      if (T('owner_grants').filter((x) => x.status === 'wrong_code' && x.created_at > since).length >= 5) {
        throw new Error('Too many wrong codes. Wait 15 minutes, or ask the owner on Telegram.');
      }
      let ok = String(code) === DEMO_OWNER_CODE;
      for (const sct of T('owner_secrets')) {
        if (ok) break;
        const step = await checkTotp(Uint8Array.from(sct.secret.match(/../g).map((h) => parseInt(h, 16))), code, sct.last_step);
        if (step) { sct.last_step = step; ok = true; }
      }
      const g = insertRow('owner_grants', {
        session_id: 'demo', user_id: 'demo', email: 'counter (demo)', device: device || '', action: 'unlock', detail: detail || '', method: 'code',
        ...(ok
          ? { status: 'approved', decided_at: new Date().toISOString(), decided_by: 'Owner (code)', expires_at: new Date(Date.now() + 600000).toISOString() }
          : { status: 'wrong_code' }),
      });
      persist(state);
      return clone(g);
    },
    async ownerCurrent() {
      const now = new Date().toISOString();
      const g = T('owner_grants').filter((x) => x.action === 'unlock' && x.status === 'approved' && x.expires_at > now).sort((a, b) => (a.expires_at < b.expires_at ? 1 : -1))[0];
      return g ? clone(g) : null;
    },
    async ownerLock() {
      const now = new Date().toISOString();
      for (const g of T('owner_grants')) if (g.action === 'unlock' && g.status === 'approved' && g.expires_at > now) g.expires_at = now;
      persist(state);
      return true;
    },
    async ownerTotpStatus() {
      return { owners: T('owner_secrets').length, mine: T('owner_secrets').some((x) => x.user_id === 'demo') };
    },
    async ownerTotpSet(hex, code) {
      const step = await checkTotp(Uint8Array.from(hex.match(/../g).map((h) => parseInt(h, 16))), code, 0);
      if (!step) throw new Error("That code doesn't match. Check that the phone's time is set automatically, and try the newest code.");
      state.owner_secrets = T('owner_secrets').filter((x) => x.user_id !== 'demo');
      state.owner_secrets.push({ user_id: 'demo', secret: hex, last_step: 0, created_at: new Date().toISOString() });
      persist(state);
      return true;
    },
    async ownerTotpRemove() {
      state.owner_secrets = T('owner_secrets').filter((x) => x.user_id !== 'demo');
      persist(state);
      return true;
    },
    async ownerList() {
      return clone([...T('owner_grants')].sort((a, b) => (a.created_at < b.created_at ? 1 : -1)).slice(0, 100));
    },
    async ownerDecide(id, approve) {
      const g = T('owner_grants').find((x) => x.id === id && x.status === 'pending');
      if (!g) throw new Error('This request was already answered or has expired');
      Object.assign(g, { status: approve ? 'approved' : 'denied', method: 'app', decided_at: new Date().toISOString(), decided_by: 'Owner (app)', expires_at: approve ? new Date(Date.now() + 600000).toISOString() : null });
      persist(state);
      return clone(g);
    },
    async resetDemo() {
      state = seedDemo();
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
    },
    auth: {
      async session() { return { user: { email: 'demo@habibs' } }; },
      async signIn() { return { user: { email: 'demo@habibs' } }; },
      async signOut() {},
      onChange() { return () => {}; },
    },
  };

  // ---------------- Demo data ----------------
  function seedDemo() {
    state = { version: VERSION };
    for (const t of TABLES) state[t] = [];
    state.settings = Object.entries(DEFAULT_SETTINGS).map(([key, value]) => ({ key, value }));
    for (const c of menuToCategories()) insertRow('service_categories', c);
    for (const { was, ...s } of menuToServices()) { const r = withDefaults('services', s); fillService(r); T('services').push(r); }

    const today = istDay();
    const staff = [
      { name: 'Amit Das', role: 'Senior Stylist', monthly_salary: 18000, service_commission_pct: 10, product_commission_pct: 5, phone: '9800000001', join_date: addDays(today, -40) },
      { name: 'Rahul Roy', role: 'Stylist', monthly_salary: 15000, service_commission_pct: 8, product_commission_pct: 5, phone: '9800000002', join_date: addDays(today, -40) },
      { name: 'Priya Saha', role: 'Beautician', monthly_salary: 14000, service_commission_pct: 8, product_commission_pct: 5, phone: '9800000003', join_date: addDays(today, -40) },
      { name: 'Sneha Paul', role: 'Receptionist', monthly_salary: 10000, service_commission_pct: 0, product_commission_pct: 2, phone: '9800000004', join_date: addDays(today, -40) },
    ].map((s) => insertRow('staff', s));

    const products = [
      { name: 'Shampoo 250 ml', brand: 'Sample brand', kind: 'retail', unit: 'pcs', low_stock: 3, cost_price: 320, sell_price: 450, gst_pct: 5, hsn: '3305' },
      { name: 'Hair Serum 100 ml', brand: 'Sample brand', kind: 'retail', unit: 'pcs', low_stock: 2, cost_price: 380, sell_price: 550, gst_pct: 18, hsn: '3305' },
      { name: 'Hair Mask 200 g', brand: 'Sample brand', kind: 'retail', unit: 'pcs', low_stock: 2, cost_price: 420, sell_price: 650, gst_pct: 18, hsn: '3305' },
      { name: 'Hair Spa Cream 500 g', brand: 'Sample brand', kind: 'salon', unit: 'jar', low_stock: 2, mrp: 1500, supplier_discount_pct: 40, cost_price: 900, sell_price: 0, gst_pct: 18, use_type: 'spa', size: 500, size_unit: 'g' },
      { name: 'Hair Colour Tube', brand: 'Sample brand', kind: 'salon', unit: 'tube', low_stock: 6, cost_price: 260, sell_price: 0, gst_pct: 18, use_type: 'colour', size: 60, size_unit: 'g' },
      { name: 'Rica Wax 800 ml', brand: 'Sample brand', kind: 'salon', unit: 'tin', low_stock: 1, cost_price: 1400, sell_price: 0, gst_pct: 18, use_type: 'rica', size: 800, size_unit: 'g' },
    ].map((p) => insertRow('products', p));
    const stockIn = [12, 6, 2, 4, 40, 3];
    products.forEach((p, i) => insertRow('stock_moves', { product_id: p.id, type: 'in', qty: stockIn[i], unit_cost: p.cost_price, supplier: 'Sample distributor', created_at: dayRangeISO(addDays(today, -12))[0] }));

    // Example bills over the last 10 days
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const pick = (a) => a[Math.floor(rnd() * a.length)];
    const names = [['Riya Sen', 'F'], ['Ananya Ghosh', 'F'], ['Sourav Mondal', 'M'], ['Puja Banerjee', 'F'], ['Arijit Pal', 'M'],
      ['Tania Dutta', 'F'], ['Rohit Sharma', 'M'], ['Moumita Roy', 'F'], ['Debjit Saha', 'M'], ['Shreya Chatterjee', 'F'],
      ['Kunal Gupta', 'M'], ['Sayani Mitra', 'F'], ['Abhishek Singh', 'M'], ['Payel Das', 'F'], ['Nikhil Jha', 'M'],
      ['Ishita Bose', 'F'], ['Ayan Chakraborty', 'M'], ['Rupsa Kar', 'F'], ['Sagnik Dey', 'M'], ['Trisha Mukherjee', 'F']];
    const customers = names.map(([n, g], i) => ({ name: n, phone: '9' + String(830000000 + i * 7919).slice(0, 9), gender: g }));
    const svc = T('services');
    const byName = (n) => svc.find((s) => s.name === n);
    const femaleSvc = ["Women's Haircut & Styling", "Women's L'Oreal Classic Hair Spa", 'Threading Eyebrows', 'Threading Upper Lip', 'Lotus Clean-up',
      'Lotus Hydravitals Facial (Dry Skin)', 'Rica Full Arms', 'Spa Pedicure', 'Root Touch-up', "Women's Hair Wash & Blow-dry", "Women's Global Colour"];
    const maleSvc = ["Men's Haircut & Styling", 'Beard Trim / Shape', "Men's Streax Classic Hair Spa", "Men's L'Oreal Classic Hair Spa", "Men's Global Colour",
      "Men's Hair Wash & Blow-dry", "Men's Head Massage, 30 min", 'Raaga D-Tan Face & Neck'];
    const hairStaff = staff.slice(0, 2);
    const sources = ['Instagram', 'Google', 'Friend / Family', 'Walk-in', 'Instagram', 'Facebook'];
    for (let d = 9; d >= 0; d--) {
      const day = addDays(today, -d);
      const n = d === 0 ? 4 : 3 + Math.floor(rnd() * 4);
      for (let k = 0; k < n; k++) {
        const hour = 10 + Math.floor(rnd() * 10);
        const at = new Date(day + 'T' + String(hour).padStart(2, '0') + ':' + String(Math.floor(rnd() * 60)).padStart(2, '0') + ':00+05:30');
        if (at > new Date()) continue;
        const c = pick(customers);
        const pool = c.gender === 'F' ? femaleSvc : maleSvc;
        const lines = [];
        const count = 1 + Math.floor(rnd() * 2.4);
        for (let j = 0; j < count; j++) {
          const s = byName(pick(pool));
          if (!s || lines.some((l) => l.service_id === s.id)) continue;
          const isBeauty = !HAIR_SECTIONS.includes(s.section);
          const st = isBeauty ? staff[2] : pick(hairStaff);
          const price = s.variants ? pick(s.variants).price : s.price;
          lines.push({ item_type: 'service', service_id: s.id, name: s.name, category: s.category, hsn_sac: s.sac, staff_id: st.id, staff_name: st.name, qty: 1, unit_price: price, gst_pct: s.gst_pct });
        }
        if (rnd() < 0.15) {
          const p = products[Math.floor(rnd() * 3)];
          lines.push({ item_type: 'product', product_id: p.id, name: p.name, category: 'Products', hsn_sac: p.hsn, staff_id: staff[3].id, staff_name: staff[3].name, qty: 1, unit_price: p.sell_price, gst_pct: p.gst_pct });
        }
        const disc = rnd() < 0.25 ? 10 : 0;
        const r = calcBill(lines, { discountType: 'pct', discountValue: disc, gstOn: false, inclusive: true });
        const mode = pick(['UPI', 'UPI', 'UPI', 'Cash', 'Cash', 'Card']);
        createBill({
          _created_at: at.toISOString(),
          customer_phone: c.phone, customer_name: c.name, gender: c.gender, _src: pick(sources) /* not saved: keeps the demo's random draws as before */, whatsapp_ok: rnd() < 0.7,
          subtotal: r.subtotal, discount: r.discount, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, round_off: r.round_off, total: r.total,
          pay_mode: mode, paid_cash: mode === 'Cash' ? r.total : 0, paid_upi: mode === 'UPI' ? r.total : 0, paid_card: mode === 'Card' ? r.total : 0,
          items: r.items,
        });
      }
    }
    // Which services use each salon product, and the bottles given out (Stock → Bottle check)
    for (const [pi, type] of [[3, 'spa'], [4, 'colour'], [5, 'rica']]) {
      // the demo spa cream is a L'Oreal jar: its services are the L'Oreal spas
      for (const r of suggestTags(type, T('services')).filter((x) => (type === 'spa' ? /L'Oreal/.test(x.service.name) : x.ticked))) {
        insertRow('service_usage', { service_id: r.service.id, product_id: products[pi].id, weight: r.weight });
      }
    }
    Object.assign(products[3], { uses_per_unit: 10 }); // a 500 g jar: about 10 spas
    Object.assign(products[5], { uses_per_unit: 20 }); // an 800 ml tin: about 20 rica services
    const billAt = Object.fromEntries(T('bills').map((b) => [b.id, b.created_at]));
    const linesOf = (pi) => {
      const ids = new Set(T('service_usage').filter((x) => x.product_id === products[pi].id).map((x) => x.service_id));
      return T('bill_items').filter((x) => ids.has(x.service_id)).map((x) => billAt[x.bill_id]).sort();
    };
    const before = (iso, minutes) => new Date(new Date(iso).getTime() - minutes * 60000).toISOString();
    const ago = (days) => new Date(Date.now() - days * 86400000).toISOString();
    const give = (pi, st, at, last = 'empty') => issueStock({ id: uid(), product_id: products[pi].id, qty: 1, staff_id: staff[st].id, last }, at);
    // spa cream: the first jar ended after a few spas, the second is in use
    const spa = linesOf(3);
    give(3, 1, ago(11));
    if (spa.length > 3) give(3, 0, before(spa[Math.floor(spa.length / 2)], 30));
    // colour: a tube every two colour services, and one tube that ended without any (shows "Finished early")
    const col = linesOf(4);
    give(4, 0, before(col[0] || ago(9), 20));
    for (let k = 2; k < col.length; k += 2) {
      if (k === 4) give(4, 1, before(col[k], 90));
      give(4, k === 4 ? 1 : 0, before(col[k], 20));
    }
    // rica wax: one tin in use
    give(5, 2, ago(9));
    // a root touch-up done without a bill (the stylist's own colour)
    const rtu = T('services').find((x) => x.name === 'Root Touch-up');
    if (rtu) insertRow('free_uses', { service_id: rtu.id, staff_id: staff[1].id, reason: 'staff', note: "Rahul's own roots", created_by: 'demo', created_at: ago(2) });
    insertRow('attendance', { staff_id: staff[1].id, day: addDays(today, -3), status: 'A', marked_by: 'owner (demo)' });
    insertRow('attendance', { staff_id: staff[2].id, day: addDays(today, -5), status: 'H', marked_by: 'owner (demo)' });
    insertRow('attendance', { staff_id: staff[0].id, day: addDays(today, -6), status: 'W', marked_by: 'owner (demo)' });
    // Face check-in for the first three (example face prints; set up real ones in Staff list → a person → Face check-in).
    // Rahul didn't check in yesterday: the app shows it for the owner to decide.
    const fakePrint = (k) => Array.from({ length: 3 }, (_, j) => Array.from({ length: 128 }, (_, i) => Math.round(Math.sin(k * 97 + i * 13 + j) * 1000) / 10000));
    staff.slice(0, 3).forEach((st, k) => insertRow('staff_faces', { staff_id: st.id, descriptors: fakePrint(k + 1), photo: DEMO_PHOTO, consent_at: ago(30), created_at: ago(30), created_by: 'demo' }));
    const ist = (d, hm) => new Date(`${addDays(today, d)}T${hm}:00+05:30`).toISOString();
    for (let d = -9; d <= 0; d++) {
      staff.slice(0, 3).forEach((st, k) => {
        const day = addDays(today, d);
        if (T('attendance').some((a) => a.staff_id === st.id && a.day === day) && !(k === 2 && d === -5)) return; // absent / week off
        if (k === 1 && d === -1) return; // no check-in, not marked
        const inAt = ist(d, ['09:52', '10:04', '10:11'][k]);
        if (new Date(inAt) > new Date()) return;
        const outAt = d === 0 ? null : ist(d, k === 2 && d === -5 ? '14:30' : ['21:05', '21:12', '20:48'][k]);
        insertRow('check_ins', { staff_id: st.id, day, in_at: inAt, out_at: outAt, in_photo: DEMO_PHOTO, out_photo: outAt ? DEMO_PHOTO : null, in_distance: 0.31 + k * 0.03, out_distance: outAt ? 0.34 : null, created_by: 'demo' });
        if (!(k === 2 && d === -5)) setAttendance(st.id, day, 'P', 'face check-in');
      });
    }
    // Leave: Priya off on the next weekday (approved), Rahul asking for two days the week after; on days the
    // owner's rules allow (Monday to Thursday, one person a day, the last week of a month asked 14 days before)
    const okFrom = (n, len) => {
      for (let s = addDays(today, n); ; s = addDays(s, 1)) {
        const days = Array.from({ length: len }, (_, i) => addDays(s, i));
        const lead = Math.round((new Date(s + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000);
        if (days.every((d) => [1, 2, 3, 4].includes(new Date(d + 'T12:00:00Z').getUTCDay()) && (Number(d.slice(8)) < 22 || lead >= 14))) return s;
      }
    };
    const pDay = okFrom(1, 1);
    const lv = insertRow('leave_requests', { staff_id: staff[2].id, from_day: pDay, to_day: pDay, kind: 'personal', reason: 'Family function', status: 'approved', decided_by: 'Owner (demo)', decided_at: ago(2), created_at: ago(3) });
    leaveToAttendance('insert', lv);
    const rDay = okFrom(Math.max(5, Math.round((new Date(pDay + 'T12:00:00Z') - new Date(today + 'T12:00:00Z')) / 86400000) + 1), 2);
    insertRow('leave_requests', { staff_id: staff[1].id, from_day: rDay, to_day: addDays(rDay, 1), kind: 'planned', reason: "Sister's wedding", created_at: ago(0.1) });
    insertRow('staff_advances', { staff_id: staff[1].id, day: addDays(today, -2), amount: 1000, note: 'Advance' });
    // Example offers (edit or delete them in Settings → Offers)
    insertRow('offers', { name: 'Opening week 10% off', starts_on: addDays(today, -3), ends_on: addDays(today, 6), applies_to: 'all', kind: 'percent', value: 10, note: 'Example offer' });
    insertRow('offers', { name: 'Pujo Ready 20% off hair', starts_on: '2026-10-16', ends_on: '2026-10-21', applies_to: 'section', sections: OLD_SECTIONS.Hair, kind: 'percent', value: 20, max_discount: 1000, note: 'Example offer' });
    insertRow('offers', { name: 'Tuesday facial ₹300 off', days: [2], applies_to: 'category', categories: ['Lotus Professional Facials', 'O3+ Facials'], kind: 'amount', value: 300, note: 'Example offer' });
    insertRow('offers', { name: 'Happy hours 15% (11 am – 3 pm)', days: [1, 2, 3, 4], start_time: '11:00', end_time: '15:00', applies_to: 'all', kind: 'percent', value: 15, min_bill: 1000, max_discount: 500, active: false, note: 'Example offer, switched off' });
    // Example appointments and enquiries (Appointments page)
    const sv = (n) => T('services').find((x) => x.name === n);
    const at = (d, t) => `${addDays(today, d)}T${t}:00+05:30`;
    const book = (p) => { try { return saveBooking(p); } catch { return null; } };
    book({ phone: '9831100011', name: 'Sayantika Ghosh', source: 'website', date: addDays(today, 1), time: 'Evening', items: [{ service_id: sv("Women's Global Colour").id, option: 'M' }], note: 'First time colour' });
    book({ phone: '9831100012', name: 'Megha Agarwal', source: 'whatsapp', date: today, slot_at: at(0, '17:00'), staff_id: staff[1].id, items: [{ service_id: sv('Keratin').id, option: 'L', extra: 'Thick' }] });
    book({ phone: customers[3].phone, name: customers[3].name, source: 'phone', date: today, slot_at: at(0, '19:30'), staff_id: staff[2].id, items: [{ service_id: sv('Lotus Hydravitals Facial (Dry Skin)').id }, { service_id: sv('Threading Eyebrows').id }] });
    book({ phone: '9831100014', name: 'Ritika Jain', source: 'instagram', date: addDays(today, 2), time: 'Morning', items: [{ service_id: sv("Women's L'Oreal Classic Hair Spa").id }] });
    insertRow('enquiries', { phone: '9831100021', name: 'Ananya Paul', source: 'whatsapp', message: 'Nanoplastia price for waist-length hair?', service_ids: [sv('Nanoplastia').id], created_by: 'demo', created_at: new Date(Date.now() - 2 * 3600000).toISOString() });
    insertRow('enquiries', { phone: '9831100022', name: 'Shreya Das', source: 'website', message: 'Do you do a bridal makeup trial? Wedding in February.', service_ids: null, created_by: 'website', created_at: new Date(Date.now() - 5 * 3600000).toISOString() });
    insertRow('enquiries', { phone: '9831100023', name: 'Tanmoy Sen', source: 'instagram', message: 'Asked about keratin, deciding after Diwali', service_ids: [sv('Keratin').id], status: 'follow_up', follow_up_on: today, created_by: 'demo', created_at: new Date(Date.now() - 6 * 86400000).toISOString() });
    // Expenses, yesterday's cash close, feedback and automatic messages (Bills → Expenses, Cash close; Customers → Feedback)
    const yAt = (t) => `${addDays(today, -1)}T${t}:00+05:30`;
    insertRow('expenses', { day: addDays(today, -1), amount: 120, category: 'Tea & snacks', note: 'Milk and biscuits', paid_from: 'cash', created_at: new Date(yAt('12:10')).toISOString() });
    insertRow('expenses', { day: addDays(today, -1), amount: 300, category: 'Laundry', note: 'Towels', paid_from: 'upi', created_at: new Date(yAt('16:40')).toISOString() });
    {
      const yEnd = new Date(yAt('21:05'));
      const fig = cashNow({ bills: T('bills'), expenses: T('expenses'), closes: [], now: yEnd });
      const should = round2(2000 + fig.cash_sales - fig.cash_expenses);
      const row = checkClose({ counted: String(should), opening_cash: '2000', taken_out: String(Math.max(0, round2(should - 2000))) }, fig, {});
      insertRow('cash_closes', { day: addDays(today, -1), closed_at: yEnd.toISOString(), closed_by: 'demo', notified_at: yEnd.toISOString(), ...row });
    }
    if (new Date().getTime() - new Date(`${today}T11:00:00+05:30`).getTime() > 0) insertRow('expenses', { day: today, amount: 90, category: 'Tea & snacks', note: 'Tea for staff', paid_from: 'cash', created_at: new Date(`${today}T11:00:00+05:30`).toISOString() });
    const fbBills = T('bills').filter((b) => b.status === 'paid' && b.customer_phone && new Date(b.created_at).getTime() < Date.now() - 20 * 3600000).sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    [['good', 'The colour came out really well, thank you!'], ['bad', 'Waited 40 minutes even with a booking.'], ['ok', null], ['good', null]].forEach(([rating, comment], k) => {
      const b = fbBills[k * 2];
      if (!b || T('feedback').some((f) => f.phone === b.customer_phone)) return;
      const asked = new Date(new Date(b.created_at).getTime() + 2 * 3600000).toISOString();
      insertRow('wa_messages', { bill_id: b.id, customer_id: b.customer_id, phone: b.customer_phone, kind: 'feedback', dedupe: 'feedback:' + b.id, status: 'read', wamid: 'demo.' + uid(), error: null, created_by: 'auto', created_at: asked, updated_at: asked });
      insertRow('feedback', { bill_id: b.id, customer_id: b.customer_id, phone: b.customer_phone, name: b.customer_name, rating, comment, created_at: new Date(new Date(asked).getTime() + 25 * 60000).toISOString() });
    });
    return state;
  }

  // Demo data from before categories: keep it, and make the categories from the services
  if (state && state.version === 3) {
    for (const t of TABLES) state[t] = state[t] || [];
    const cats = menuToCategories();
    for (const s of [...T('services')].sort((a, b) => (a.sort || 0) - (b.sort || 0))) {
      if (!T('service_categories').some((c) => c.name === s.category)) {
        const w = cats.find((c) => c.name === s.category) || { name: s.category, section: s.section, slug: null, sort: s.sort || 0 };
        const c = withDefaults('service_categories', w);
        fillCategory(c);
        T('service_categories').push(c);
      }
      Object.assign(s, { ...DEFAULTS.services, ...s });
      fillService(s, null);
    }
    state.settings.push(...['opening_hours', 'whatsapp', 'maps_url'].filter((k) => !state.settings.some((x) => x.key === k)).map((key) => ({ key, value: DEFAULT_SETTINGS[key] })));
    state.version = 4;
  }
  // Demo data from before the Bottle check: keep it; each give-out ended the one before it (same as the database upgrade)
  if (state && state.version === 4) {
    for (const t of TABLES) state[t] = state[t] || [];
    for (const u of T('service_usage')) if (u.weight == null) u.weight = 1;
    const moves = T('stock_moves').filter((m) => m.type === 'use' && Number(m.qty) < 0)
      .sort((x, y) => new Date(x.created_at) - new Date(y.created_at) || (x.id < y.id ? -1 : 1));
    moves.forEach((r, i) => {
      const open = unitToEnd(openUnits(moves.slice(0, i), T('unit_ends'), r.product_id), r.staff_id || null);
      if (open) T('unit_ends').push({ move_id: open.id, product_id: r.product_id, ended_at: r.created_at, how: r.empty_returned ? 'empty' : 'no_empty', by_move: r.id, created_by: 'upgrade' });
    });
    state.version = 5;
  }
  // Demo data from before face check-in and leave: keep it, the new tables start empty
  if (state && state.version === 5) {
    for (const t of TABLES) state[t] = state[t] || [];
    state.version = 6;
  }
  // Demo data from before loyalty points: everyone starts at 0 points
  if (state && state.version === 6) {
    for (const t of TABLES) state[t] = state[t] || [];
    for (const c of state.customers) c.points = c.points || 0;
    state.version = 7;
  }
  // Demo data from before the printed rate chart (November 2026): the same upgrade as 02_seed_services.sql
  if (state && state.version === 7) {
    for (const t of TABLES) state[t] = state[t] || [];
    applyRateChart();
    state.version = 8;
  }
  if (!state || state.version !== VERSION) state = seedDemo();
  for (const t of TABLES) state[t] = state[t] || [];
  // New settings get their default
  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) if (!state.settings.some((x) => x.key === key)) state.settings.push({ key, value });
  persist(state);
  return api;
}
