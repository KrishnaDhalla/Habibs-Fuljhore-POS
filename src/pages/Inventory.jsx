import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PackagePlus, PackageMinus, PackageX, History, Pencil, Lock, Send, Copy, Scissors, AlertTriangle } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, round2, fmtDateTime, fmtDate, uid, istDay, addDays, dayRangeISO } from '../lib/format';
import { SearchBox, Stat, Empty, Modal, Field, MoneyInput, Loading, Seg } from '../components/ui';
import { PRODUCT_TYPES, TYPE_LABEL, TYPE_UNIT, suggestTags, typicalUses, parseSize, sizeText } from '../data/usage';
import { SIZE_HINT, HAIR_SECTIONS } from '../data/menu';
import { bottleCheck, openInfo, levelResult, EARLY, ALMOST, LEARN_MIN } from '../lib/stockcheck';
import { openUnits, unitToEnd, sizesInStore } from '../lib/units';

const MOVE_LABEL = { in: 'Stock in', use: 'Taken out for use', sale: 'Sold', adjust: 'Count corrected', return: 'Bill cancelled' };
const num = (v) => String(v ?? '').replace(/[^\d.]/g, '');
const fmtQty = (n) => (n == null ? '–' : String(round2(n)));
// "1 jar", "3 jars", "2 pcs"
export const unitWord = (unit, n) => (!unit || Number(n) === 1 || /s$/.test(unit) ? unit || '' : unit + 's');
const firstName = (s) => String(s || '').split(' ')[0];
export const FREE_REASON = { redo: 'Redo / complaint', staff: "Staff's own", family: 'Owner / family', training: 'Training / model', other: 'Other' };
// what happened to the one in use now, at Give out (values sent to issue_stock)
const LAST = [['returned', 'Finished, empty back'], ['no_empty', 'Finished, no empty'], ['in_use', 'Still in use']];
const LAST_DB = { returned: 'empty', no_empty: 'no_empty', in_use: 'in_use' };
const HOW = { empty: 'empty handed back', no_empty: 'finished, no empty', finished: 'marked Finished' };
const SIZE_CHIPS = { ml: ['100 ml', '250 ml', '500 ml', '800 ml', '1 L', '1.5 L'], g: ['60 g', '100 g', '250 g', '500 g', '800 g', '1 kg'], uses: ['1 use', '5 uses', '10 uses'] };
// Size of one bottle / tube / jar, typed the way it's printed ("1 L", "800 ml"), with quick picks
function SizeField({ id, label, value, onChange, unit, hint }) {
  const parsed = parseSize(value, unit);
  return (
    <Field label={label} hint={value && !parsed ? 'Type it like 1 L, 800 ml, 60 g or 5 uses' : parsed ? `${sizeText(parsed.size, parsed.unit)} = ${parsed.size} ${parsed.unit}` : hint}>
      <input className="input" id={id} value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. 1 L, 800 ml, 60 g" />
      <div className="chips size-chips">{(SIZE_CHIPS[unit] || SIZE_CHIPS.ml).map((c) => <button key={c} type="button" className={'chip sm' + (value === c ? ' on' : '')} onClick={() => onChange(c)}>{c}</button>)}</div>
    </Field>
  );
}

// Does taking this out need the owner? (Settings → Owner unlock → Taking stock out). The database checks the same.
// emptyOk: the finished one was handed back, or nothing was in use.
export function stockNeedsOwner(p, qty, emptyOk, settings) {
  const rule = (settings && settings.stock_approval) || 'expensive';
  const above = Number(settings && settings.stock_approval_above != null ? settings.stock_approval_above : 500);
  return rule === 'always' || (rule === 'expensive' && (Number(p.cost_price) * qty >= above || !emptyOk));
}

// "6 of ~10 uses" for the one in use now
function UnitLine({ info, onEnd }) {
  if (!info) return null;
  const pct = info.normal ? Math.min(100, Math.round(((info.by === 'uses' ? info.uses : info.days) / info.normal) * 100)) : null;
  const text = info.by === 'uses'
    ? `In use: ${fmtQty(info.uses)}${info.normal ? ` of ~${fmtQty(info.normal)}` : ''} uses`
    : `In use ${Math.floor(info.days)} days${info.normal ? ` of ~${Math.round(info.normal)}` : ''}`;
  return (
    <div className={'tiny unit-line' + (info.fast ? ' bad' : info.almost ? ' warn' : '')}>
      {pct != null && <span className="meter" aria-hidden="true"><i style={{ width: pct + '%' }} /></span>}
      <span>{text}{info.fast ? ' · running fast' : info.almost ? ' · almost finished' : ''}{info.count > 1 ? ` · ${info.count} in use` : ''}</span>
      {onEnd && info.count > 1 && <button className="link tiny" onClick={onEnd}>One is empty</button>}
    </div>
  );
}

export default function Inventory() {
  const { askOwner, isOwner } = useApp();
  const [tab, setTab] = useState('stock');
  const [focus, setFocus] = useState('');
  const go = async (t, pid = '') => {
    if (t !== 'stock' && !(await askOwner('Bottle check, Used in and stock counts are for the owner.'))) return;
    setFocus(pid);
    setTab(t);
  };
  useEffect(() => { if (!isOwner && tab !== 'stock') setTab('stock'); }, [isOwner, tab]);
  return (
    <div className="page">
      <div className="page-head"><h1>Stock</h1></div>
      <div className="tabs">
        {[['stock', 'Stock'], ['check', 'Bottle check'], ['usage', 'Used in'], ['count', 'Count stock']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>
            {l} {k !== 'stock' && !isOwner && <Lock size={12} />}
          </button>
        ))}
      </div>
      {tab === 'stock' && <StockList />}
      {tab === 'check' && <BottleCheck onUsedIn={(pid) => go('usage', pid)} />}
      {tab === 'usage' && <UsedInTab focus={focus} />}
      {tab === 'count' && <CountTab />}
    </div>
  );
}

// ---------------- Stock list ----------------
function StockList() {
  const { products, staff, loadProducts, toast } = useApp();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');
  const [edit, setEdit] = useState(null);
  const [move, setMove] = useState(null);
  const [give, setGive] = useState(null);
  const [hist, setHist] = useState(null);
  const [fin, setFin] = useState(null);
  const [free, setFree] = useState(false);
  const [endOf, setEndOf] = useState(null);
  const [report, setReport] = useState(null);

  // the one in use of each product (from the bills, see Bottle check). Offline or not set up: just not shown.
  const loadUnits = useCallback(() => db.rpc('unit_report', {}).then(setReport).catch(() => setReport(null)), []);
  useEffect(() => { loadProducts(); loadUnits(); }, [loadProducts, loadUnits]);
  const units = useMemo(() => {
    if (!report) return {};
    return Object.fromEntries(bottleCheck({ report, products, staff }).rows.map((r) => [r.product.id, r]));
  }, [report, products, staff]);
  const reload = () => { loadProducts(); loadUnits(); };

  const low = (p) => Number(p.stock) <= Number(p.low_stock);
  const toBuy = (p) => !!p.finished_at || low(p);
  const list = useMemo(() => products.filter((p) => {
    if (!p.active && filter !== 'hidden') return false;
    if (filter === 'hidden' && p.active) return false;
    if (filter === 'buy' && !toBuy(p)) return false;
    if (filter === 'retail' && p.kind !== 'retail') return false;
    if (filter === 'salon' && p.kind !== 'salon') return false;
    if (q && !(p.name + ' ' + (p.brand || '') + ' ' + (p.note || '')).toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }).sort((a, b) => (filter === 'buy' ? (b.finished_at ? 1 : 0) - (a.finished_at ? 1 : 0) || (units[b.id]?.almost ? 1 : 0) - (units[a.id]?.almost ? 1 : 0) : 0)), [products, q, filter, units]);

  const active = products.filter((p) => p.active);
  const value = round2(active.reduce((a, p) => a + Math.max(0, Number(p.stock)) * Number(p.cost_price), 0));
  const buyList = active.filter(toBuy);
  const finCount = active.filter((p) => p.finished_at).length;
  const buyText = () => 'To buy (Habibs Fuljhore):\n' + buyList.map((p) => `• ${p.name}${p.brand ? ' (' + p.brand + ')' : ''}: ${p.finished_at ? 'finished' : Number(p.stock) + ' ' + unitWord(p.unit, p.stock) + ' left'}${units[p.id]?.almost ? ', the one in use is almost finished' : ''}`).join('\n');

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <div className="stats" style={{ flex: 1 }}>
          <Stat k="Products" v={active.length} />
          <Stat k="To buy" v={buyList.length} s={buyList.length ? `${finCount ? finCount + ' finished, ' : ''}${buyList.length - finCount} running low` : 'All fine'} accent={buyList.length > 0} />
          <Stat k="Stock value" v={rupee(value)} s="At cost price" />
        </div>
      </div>
      <div className="card">
        <div className="card-pad stack" style={{ paddingBottom: 6 }}>
          <div className="row wrap">
            <div className="grow"><SearchBox value={q} onChange={setQ} placeholder="Search product or brand" /></div>
            <button className="btn line sm" onClick={() => setFree(true)}><Scissors size={15} /> Used without a bill</button>
            <button className="btn primary sm" onClick={() => setEdit({})}><Plus size={15} /> Add product</button>
          </div>
          <div className="chips scroll">
            {[['all', 'All'], ['buy', 'To buy'], ['retail', 'For sale'], ['salon', 'Salon use'], ['hidden', 'Hidden']].map(([k, l]) => (
              <button key={k} className={'chip sm' + (filter === k ? ' on' : '')} onClick={() => setFilter(k)}>{l}{k === 'buy' && buyList.length ? ` (${buyList.length})` : ''}</button>
            ))}
          </div>
          {filter === 'buy' && buyList.length > 0 && (
            <div className="row wrap">
              <a className="btn line sm" href={'https://wa.me/?text=' + encodeURIComponent(buyText())} target="_blank" rel="noreferrer"><Send size={15} /> Send list on WhatsApp</a>
              <button className="btn line sm" onClick={async () => { try { await navigator.clipboard.writeText(buyText()); toast('List copied', 'ok'); } catch { toast('Could not copy here', 'bad'); } }}><Copy size={15} /> Copy list</button>
            </div>
          )}
        </div>
        {list.length === 0 ? (
          <Empty title={products.length ? 'No product matches' : 'No products yet'}>
            {products.length ? 'Try another search or filter.' : 'Add the products you sell and the ones you use for services, like spa cream, colour and wax.'}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Product</th><th>Type</th><th className="r">In stock</th><th className="r">Cost</th><th className="r">Selling price</th><th /></tr></thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="strong">{p.name} {p.finished_at && <span className="finished-tag">Finished {fmtDate(p.finished_at, false)}</span>}</div>
                      <div className="tiny muted">{[p.brand, p.size ? `${sizeText(p.size, p.size_unit)} per ${p.unit}` : p.kind === 'salon' ? 'size not set' : ''].filter(Boolean).join(' · ')}</div>
                      {p.kind === 'salon' && <UnitLine info={openInfo(units[p.id])} onEnd={() => setEndOf(units[p.id])} />}
                      {p.note && <div className="tiny muted note-line">{String(p.note).split('\n').slice(-1)[0]}</div>}
                    </td>
                    <td className="small">{p.kind === 'retail' ? 'For sale' : (TYPE_LABEL[p.use_type] || 'Salon use')}</td>
                    <td className="r nowrap">
                      <span className={low(p) ? 'strong' : ''} style={low(p) ? { color: Number(p.stock) <= 0 ? 'var(--bad)' : 'var(--warn)' } : null}>
                        {Number(p.stock)} {p.unit}
                      </span>
                      {low(p) && <div className="tiny" style={{ color: 'var(--warn)' }}>low (alert at {Number(p.low_stock)})</div>}
                    </td>
                    <td className="r">{rupee(p.cost_price)}{Number(p.mrp) > 0 && <div className="tiny muted nowrap">MRP {rupee(p.mrp)}{Number(p.supplier_discount_pct) ? ` − ${Number(p.supplier_discount_pct)}%` : ''}</div>}</td>
                    <td className="r">{p.kind === 'retail' ? rupee(p.sell_price) : '–'}</td>
                    <td className="r act-cell">
                      <span className="acts">
                        <button className="btn line sm" onClick={() => setMove(p)}><PackagePlus size={15} /> In</button>
                        <button className="btn line sm" onClick={() => setGive(p)}><PackageMinus size={15} /> Give out</button>
                        {!p.finished_at && <button className="btn line sm" onClick={() => setFin(p)}><PackageX size={15} /> Finished</button>}
                        <button className="icon-btn plain sm" aria-label="History" onClick={() => setHist(p)}><History size={16} /></button>
                        <button className="icon-btn plain sm" aria-label="Edit" onClick={() => setEdit(p)}><Pencil size={15} /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="small muted">
        <b>Give out</b> each time a new tube, jar, bottle or kit leaves the store, and ask for the finished one back. The app counts the services billed
        while each one was in use, so you see how many services it lasted. Services done without a bill (a redo, staff's own colour): <b>Used without a bill</b>.
      </p>
      {edit && <ProductModal product={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />}
      {move && <StockInModal p={move} onClose={() => setMove(null)} onSaved={() => { setMove(null); reload(); }} />}
      {give && <GiveOutModal p={give} onClose={() => setGive(null)} onSaved={() => { setGive(null); reload(); }} />}
      {hist && <HistoryModal product={hist} onClose={() => setHist(null)} />}
      {fin && <FinishedModal p={fin} onClose={() => setFin(null)} onSaved={() => { setFin(null); reload(); }} />}
      {free && <FreeUseModal onClose={() => setFree(false)} onSaved={() => { setFree(false); loadUnits(); }} />}
      {endOf && <EndUnitModal row={endOf} onClose={() => setEndOf(null)} onSaved={() => { setEndOf(null); loadUnits(); }} />}
    </div>
  );
}

// Buying price from the printed MRP and the supplier's discount: MRP ₹1,500 − 40% = ₹900
export const costFrom = (mrp, pct) => round2(Number(mrp) * (1 - Number(pct) / 100));
export const pctFrom = (mrp, cost) => (Number(mrp) > 0 && cost !== '' ? round2((1 - Number(cost) / Number(mrp)) * 100) : '');
// Keeps MRP, discount and cost in step: change one, the others follow
function priceFields(f, k, v) {
  const n = { ...f, [k]: v };
  if ((k === 'mrp' || k === 'disc') && Number(n.mrp) > 0 && n.disc !== '') n.cost_price = String(costFrom(n.mrp, n.disc));
  if (k === 'cost_price' && Number(n.mrp) > 0 && v !== '') n.disc = String(pctFrom(n.mrp, v));
  if (k === 'mrp' && n.kind === 'retail' && (f.sell_price === '' || f.sell_price === f.mrp)) n.sell_price = v; // selling price follows the MRP until changed
  return n;
}

function ProductModal({ product, onClose, onSaved }) {
  const { toast, askOwner } = useApp();
  const isNew = !product.id;
  const [f, setF] = useState({
    name: product.name || '', brand: product.brand || '', kind: product.kind || 'retail', unit: product.unit || 'pcs',
    low_stock: product.low_stock != null ? String(Number(product.low_stock)) : '2',
    mrp: product.mrp != null ? String(Number(product.mrp)) : '',
    disc: product.supplier_discount_pct != null ? String(Number(product.supplier_discount_pct)) : '',
    cost_price: product.cost_price != null ? String(Number(product.cost_price)) : '',
    sell_price: product.sell_price != null ? String(Number(product.sell_price)) : '',
    hsn: product.hsn || '', gst_pct: product.gst_pct != null ? String(Number(product.gst_pct)) : '18', active: product.active !== false,
    use_type: product.use_type || '', size: product.size != null ? sizeText(product.size, product.size_unit) : '',
    note: product.note || '', opening: '', count: product.stock != null ? String(Number(product.stock)) : '',
    uses: product.uses_per_unit != null ? String(Number(product.uses_per_unit)) : '',
  });
  const sizeUnit = TYPE_UNIT[f.use_type] || (product.size_unit || 'ml');
  const parsed = parseSize(f.size, sizeUnit);
  const typical = parsed ? typicalUses(f.use_type, parsed.size, parsed.unit) : null;
  const [err, setErr] = useState('');
  const n = (k) => (e) => setF({ ...f, [k]: num(e.target.value) });
  const money = (k) => (v) => setF(priceFields(f, k, v));

  const save = async () => {
    if (!f.name.trim()) return setErr('Enter the product name.');
    if (f.kind === 'salon' && !parsed) return setErr(`Size of one ${f.unit || 'unit'}: e.g. 1 L, 800 ml, 60 g or 5 uses.`);
    if (f.size.trim() && !parsed) return setErr('Size of one: type it like 1 L, 800 ml, 60 g or 5 uses.');
    if (f.uses !== '' && !(Number(f.uses) > 0)) return setErr('How many services one lasts: a number, or leave it empty.');
    if (f.disc !== '' && !(Number(f.disc) >= 0 && Number(f.disc) < 100)) return setErr('Supplier discount: 0 to 99%.');
    if (f.kind === 'retail' && Number(f.mrp) > 0 && Number(f.sell_price) > Number(f.mrp)) return setErr('The selling price can\'t be more than the MRP printed on the pack.');
    const row = {
      name: f.name.trim(), brand: f.brand.trim() || null, kind: f.kind, unit: f.unit.trim() || 'pcs', low_stock: Number(f.low_stock) || 0,
      mrp: Number(f.mrp) > 0 ? Number(f.mrp) : null, supplier_discount_pct: f.disc !== '' && Number(f.mrp) > 0 ? Number(f.disc) : null,
      cost_price: Number(f.cost_price) || 0, sell_price: f.kind === 'retail' ? Number(f.sell_price) || 0 : 0,
      hsn: f.hsn.trim() || null, gst_pct: Number(f.gst_pct) || 0, active: f.active,
      use_type: f.kind === 'salon' ? f.use_type || null : null,
      size: parsed ? parsed.size : null,
      size_unit: parsed ? parsed.unit : null,
      uses_per_unit: f.kind === 'salon' && Number(f.uses) > 0 ? Number(f.uses) : null,
      note: f.note.trim() || null,
    };
    // A new product, a changed name / MRP / price / GST / size, or a corrected stock count needs the owner.
    // (Cost price, supplier discount and the note can be updated by the counter.)
    const keys = ['name', 'brand', 'kind', 'unit', 'low_stock', 'mrp', 'sell_price', 'hsn', 'gst_pct', 'active', 'use_type', 'size', 'size_unit', 'uses_per_unit'];
    const numeric = ['low_stock', 'mrp', 'sell_price', 'gst_pct', 'size', 'uses_per_unit'];
    const same = (k) => (numeric.includes(k) ? Number(product[k] || 0) === Number(row[k] || 0) : (product[k] ?? null) === (row[k] ?? null));
    const detailsChanged = isNew || keys.some((k) => !same(k));
    const diff = isNew ? 0 : round2((Number(f.count) || 0) - Number(product.stock));
    const countChanged = !isNew && f.count !== '' && diff !== 0;
    if (detailsChanged || countChanged) {
      const what = isNew ? `Add product ${row.name}${row.kind === 'retail' ? ` at ${rupee(row.sell_price)}` : ''}${row.mrp ? ` (MRP ${rupee(row.mrp)})` : ''}`
        : countChanged && !detailsChanged ? `Stock count of ${row.name}: ${Number(product.stock)} → ${f.count}`
          : `Change product ${row.name}${Number(product.sell_price) !== row.sell_price ? ` (price ${rupee(product.sell_price)} → ${rupee(row.sell_price)})` : ''}${Number(product.mrp || 0) !== Number(row.mrp || 0) ? ` (MRP ${rupee(product.mrp || 0)} → ${rupee(row.mrp || 0)})` : ''}`;
      if (!(await askOwner('Adding or changing a product, or correcting stock, needs the owner.', { detail: what }))) return;
    }
    try {
      if (isNew) {
        const p = await db.insert('products', row);
        if (Number(f.opening) > 0) await db.insert('stock_moves', { product_id: p.id, type: 'in', qty: Number(f.opening), unit_cost: row.cost_price, note: 'Opening stock' });
      } else {
        await db.update('products', product.id, row);
        if (countChanged) await db.insert('stock_moves', { product_id: product.id, type: 'adjust', qty: diff, unit_cost: row.cost_price, note: 'Counted: ' + f.count });
      }
      toast('Saved');
      onSaved();
    } catch (e) { setErr(e.message); }
  };

  return (
    <Modal wide title={isNew ? 'Add product' : f.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Close</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="form-grid">
        <Field label="Product name" className="span2"><input className="input" id="p-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Majirel 6.0 or Hair Spa Cream" /></Field>
        <Field label="Brand"><input className="input" id="p-brand" value={f.brand} onChange={(e) => setF({ ...f, brand: e.target.value })} /></Field>
        <Field label="Type"><Seg full options={[['retail', 'For sale'], ['salon', 'Salon use']]} value={f.kind} onChange={(v) => setF({ ...f, kind: v })} /></Field>
        {f.kind === 'salon' && (
          <Field label="What is it" hint="Lets the app suggest which services use it">
            <select className="select" id="p-type" value={f.use_type} onChange={(e) => setF({ ...f, use_type: e.target.value })}>
              <option value="">Choose</option>
              {PRODUCT_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
        )}
        <Field label="Counted as" hint="pcs, tube, jar, tin, bottle, kit…"><input className="input" id="p-unit" value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
        <SizeField id="p-size" label={`Size of one ${f.unit || 'unit'}${f.kind === 'salon' ? '' : ' (optional)'}`} value={f.size} unit={sizeUnit}
          onChange={(v) => setF({ ...f, size: v })} hint={(PRODUCT_TYPES.find((t) => t[0] === f.use_type) || [])[3] || 'As printed on the pack'} />
        {f.kind === 'salon' && (
          <Field label={`One ${f.unit || 'unit'} lasts about (services)`} hint={`${typical ? `Typical: about ${typical}. ` : ''}Leave empty and the app learns it from your first ${LEARN_MIN}.`}>
            <input className="input" id="p-uses" inputMode="decimal" value={f.uses} onChange={n('uses')} placeholder={typical ? `e.g. ${typical}` : 'Learn it'} />
          </Field>
        )}
        <Field label="Alert me when stock is at or below"><input className="input" id="p-low" inputMode="decimal" value={f.low_stock} onChange={n('low_stock')} /></Field>
        <Field label="MRP (printed on the pack, per unit)"><MoneyInput id="p-mrp" value={f.mrp} onChange={money('mrp')} placeholder="Optional" /></Field>
        <Field label="Supplier discount on MRP (%)" hint={Number(f.mrp) > 0 && f.disc !== '' ? `${rupee(f.mrp)} − ${Number(f.disc)}% = ${rupee(costFrom(f.mrp, f.disc))}` : 'e.g. 40 if you buy at 40% off MRP'}>
          <input className="input" id="p-disc" inputMode="decimal" value={f.disc} disabled={!(Number(f.mrp) > 0)} onChange={(e) => setF(priceFields(f, 'disc', num(e.target.value)))} placeholder={Number(f.mrp) > 0 ? '0' : 'Enter the MRP first'} />
        </Field>
        <Field label="Cost price (what you pay, per unit)"><MoneyInput id="p-cost" value={f.cost_price} onChange={money('cost_price')} /></Field>
        {f.kind === 'retail' && <Field label="Selling price" hint={Number(f.mrp) > 0 ? 'Not more than the MRP' : ''}><MoneyInput id="p-sell" value={f.sell_price} onChange={(v) => setF({ ...f, sell_price: v })} /></Field>}
        {f.kind === 'retail' && <Field label="HSN code"><input className="input" id="p-hsn" value={f.hsn} onChange={(e) => setF({ ...f, hsn: e.target.value })} placeholder="e.g. 3305" /></Field>}
        {f.kind === 'retail' && <Field label="GST %" hint="Shampoo and hair oil are 5%, most cosmetics 18%. Check with your CA."><input className="input" id="p-gst" inputMode="decimal" value={f.gst_pct} onChange={n('gst_pct')} /></Field>}
        {isNew ? (
          <Field label="Opening stock" hint="How many you have right now"><input className="input" id="p-open" inputMode="decimal" value={f.opening} onChange={n('opening')} /></Field>
        ) : (
          <Field label="Actual count on shelf" hint="Change only after counting. Needs the owner."><input className="input" id="p-count" inputMode="decimal" value={f.count} onChange={n('count')} /></Field>
        )}
        <Field label="Note" className="span2" hint="Anything to remember: supplier, shade, where it's kept, reorder details"><textarea className="textarea" id="p-note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        {!isNew && <label className="check span2"><input type="checkbox" checked={!f.active} onChange={(e) => setF({ ...f, active: !e.target.checked })} /> Hide this product (no longer used)</label>}
      </div>
      {err && <p className="err-text" style={{ marginTop: 10 }}>{err}</p>}
    </Modal>
  );
}

function StockInModal({ p, onClose, onSaved }) {
  const { toast } = useApp();
  const [qty, setQty] = useState('');
  const [mrp] = useState(Number(p.mrp) > 0 ? String(Number(p.mrp)) : '');
  const [disc, setDisc] = useState(p.supplier_discount_pct != null ? String(Number(p.supplier_discount_pct)) : '');
  const [cost, setCost] = useState(String(Number(p.cost_price) || ''));
  const [supplier, setSupplier] = useState('');
  const [note, setNote] = useState('');
  const usualText = p.size ? sizeText(p.size, p.size_unit) : '';
  const [size, setSize] = useState(usualText);
  const sizeUnit = p.size_unit || TYPE_UNIT[p.use_type] || 'ml';
  const parsed = parseSize(size, sizeUnit);
  const differs = parsed && p.size && Number(parsed.size) !== Number(p.size);
  const save = async () => {
    const n = Number(qty);
    if (!(n > 0)) return toast('Enter how many', 'bad');
    if (p.kind === 'salon' && !parsed) return toast(`Size of one ${p.unit}: e.g. 1 L, 800 ml, 60 g`, 'bad');
    if (size.trim() && !parsed) return toast('Size of one: type it like 1 L, 800 ml or 60 g', 'bad');
    if (parsed && p.size_unit && parsed.unit !== p.size_unit) return toast(`${p.name} is measured in ${p.size_unit}. Type the size in ${p.size_unit === 'ml' ? 'ml or L' : p.size_unit === 'g' ? 'g or kg' : p.size_unit}.`, 'bad');
    if (disc !== '' && !(Number(disc) >= 0 && Number(disc) < 100)) return toast('Supplier discount: 0 to 99%', 'bad');
    // a different pack size from the usual one is kept on this delivery, so its bottles are counted at their size
    const unitSize = parsed && (differs || !p.size) ? parsed.size : null;
    try {
      await db.insert('stock_moves', { product_id: p.id, type: 'in', qty: n, unit_cost: Number(cost) || null, supplier: supplier.trim() || null, unit_size: unitSize,
        note: [note.trim(), differs ? `${sizeText(parsed.size, parsed.unit)} each (usual ${usualText})` : '', mrp && disc !== '' ? `MRP ${rupee(mrp)} − ${Number(disc)}%` : ''].filter(Boolean).join(' · ') || null });
      const patch = {};
      if (Number(cost) && Number(cost) !== Number(p.cost_price)) patch.cost_price = Number(cost);
      if (mrp && disc !== '' && Number(disc) !== Number(p.supplier_discount_pct)) patch.supplier_discount_pct = Number(disc);
      if (Object.keys(patch).length) await db.update('products', p.id, patch);
      toast(`Added ${n} ${unitWord(p.unit, n)}`);
      onSaved();
    } catch (e) { toast(e.message, 'bad'); }
  };
  return (
    <Modal title={'Stock in: ' + p.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" onClick={save}>Save</button></>}>
      <div className="stack">
        <p className="muted small">Now in stock: {Number(p.stock)} {p.unit}{p.finished_at ? ' (marked finished)' : ''}. Count what arrived against the supplier's bill before saving.</p>
        <Field label="How many came in">
          <input className="input big" id="mv-qty" inputMode="decimal" autoFocus value={qty} onChange={(e) => setQty(num(e.target.value))} />
        </Field>
        <SizeField id="mv-size" label={`Size of one ${p.unit}${p.kind === 'salon' ? '' : ' (optional)'}`} value={size} onChange={setSize} unit={sizeUnit} hint="As printed on the pack" />
        {differs && <p className="small" style={{ color: 'var(--warn)' }}>Not the usual {usualText}. These are kept as {sizeText(parsed.size, parsed.unit)} each, so the Bottle check expects {Number(parsed.size) < Number(p.size) ? 'fewer' : 'more'} services from them. If the supplier changed the size for good, the owner can change it on the product.</p>}
        {parsed && !p.size && <p className="small muted">The product has no size yet. This delivery is kept as {sizeText(parsed.size, parsed.unit)}; the owner can set it on the product (Edit).</p>}
        {mrp && (
          <Field label={`Supplier discount on MRP ${rupee(mrp)} (%)`} hint={disc !== '' ? `${rupee(mrp)} − ${Number(disc)}% = ${rupee(costFrom(mrp, disc))}` : ''}>
            <input className="input" id="mv-disc" inputMode="decimal" value={disc} onChange={(e) => { const v = num(e.target.value); setDisc(v); if (v !== '') setCost(String(costFrom(mrp, v))); }} />
          </Field>
        )}
        <Field label="Cost price per unit"><MoneyInput id="mv-cost" value={cost} onChange={(v) => { setCost(v); if (mrp && v !== '') setDisc(String(pctFrom(mrp, v))); }} /></Field>
        <Field label="Supplier"><input className="input" id="mv-sup" value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="Optional" /></Field>
        <Field label="Note"><input className="input" id="mv-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Invoice number" /></Field>
      </div>
    </Modal>
  );
}

// "Finished": the product is used up and must be bought again. If the app still shows some in stock,
// those are written off as missing, with the owner's approval.
function FinishedModal({ p, onClose, onSaved }) {
  const { toast, askOwner } = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = useRef(uid());
  const left = Math.max(0, Number(p.stock));
  const lossValue = round2(left * Number(p.cost_price));
  const save = async () => {
    setErr('');
    let grant = '';
    if (left > 0) {
      const g = await askOwner('Marking this finished writes off what the app still shows.', {
        action: 'stock', ref: id.current,
        detail: `Finished: ${p.name}. The app still shows ${left} ${unitWord(p.unit, left)} (${rupee(lossValue)}), to be saved as missing`,
      });
      if (!g) return;
      grant = typeof g === 'string' ? g : '';
    }
    setBusy(true);
    try {
      await db.rpc('mark_finished', { p: { id: id.current, product_id: p.id, note: note.trim(), owner_grant_id: grant } });
      db.notify('finished', p.id); // Telegram message to the owner (if set up); never holds up the counter
      toast(`${p.name} marked finished. It's on the To buy list.`, 'ok');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={'Finished: ' + p.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>{left > 0 ? 'Ask owner and mark finished' : 'Mark finished'}</button></>}>
      <div className="stack">
        <p className="small">It goes on the <b>To buy</b> list{left > 0 ? '' : ' and the owner is told'}. The next <b>Stock in</b> takes it off again.</p>
        {left > 0 && (
          <p className="small" style={{ color: 'var(--warn)' }}>
            The app still shows <b>{left} {unitWord(p.unit, left)}</b> in the store. If the store is really empty, those are saved as missing
            ({rupee(lossValue)}) and the owner approves it. If there are still some, give them out with <b>Give out</b> instead.
          </p>
        )}
        <Field label="Note"><input className="input" id="fin-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Need 2 more by Saturday, order from Sample distributor" /></Field>
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

// A new tube / jar / bottle / kit leaves the store: who took it, and what happened to the one in use now?
function GiveOutModal({ p, onClose, onSaved }) {
  const { toast, staff, settings, askOwner } = useApp();
  const [qty, setQty] = useState(1);
  const [who, setWho] = useState('');
  const [last, setLast] = useState(null);
  const [open, setOpen] = useState(null); // the ones in use now
  const [sizes, setSizes] = useState([]); // sizes in the store, when a delivery came in another pack size
  const [size, setSize] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = useRef(uid()); // same id on every try, so it is never saved twice
  const people = staff.filter((s) => s.active);
  const nameOf = (sid) => (staff.find((s) => s.id === sid) || {}).name || '';

  useEffect(() => {
    Promise.all([
      db.list('stock_moves', { eq: { product_id: p.id } }),
      db.list('unit_ends', { eq: { product_id: p.id } }),
    ]).then(([m, e]) => {
      const sz = sizesInStore(p, m).filter((x) => x.size);
      setSizes(sz);
      if (sz.length > 1) setSize(sz[0].size); // the oldest delivery first
      setOpen(openUnits(m, e, p.id));
    }).catch(() => setOpen([]));
  }, [p.id]);
  const ending = open ? unitToEnd(open, who || null) : null;
  const emptyOk = !ending || last === 'returned';
  const needs = (!ending || last !== null) && stockNeedsOwner(p, qty, emptyOk, settings);

  const save = async () => {
    setErr('');
    if (!who) return setErr('Choose who is taking it.');
    if (ending && last === null) return setErr(`What happened to the ${p.unit} in use now? Choose one.`);
    if (qty > Number(p.stock)) return setErr(`Only ${Number(p.stock)} ${p.unit} in stock. The owner can correct the count first.`);
    const name = nameOf(who);
    const lastText = ending ? LAST.find(([k]) => k === last)[1].toLowerCase() : 'none in use';
    let grant = '';
    if (needs) {
      const g = await askOwner('Taking this out needs the owner.', {
        action: 'stock', ref: id.current,
        detail: `Give ${qty} × ${p.name} (${rupee(round2(Number(p.cost_price) * qty))}) to ${name} · the one in use: ${lastText}${note.trim() ? ' · ' + note.trim() : ''}`,
      });
      if (!g) return;
      grant = typeof g === 'string' ? g : '';
    }
    setBusy(true);
    try {
      await db.rpc('issue_stock', { p: {
        id: id.current, product_id: p.id, qty, staff_id: who, last: ending ? LAST_DB[last] : 'empty', empty_returned: emptyOk,
        note: note.trim(), owner_grant_id: grant, ...(sizes.length > 1 && size ? { unit_size: size } : {}),
      } });
      db.notify('unit', id.current); // Telegram to the owner if the last one finished early or the store is running out
      toast(`${qty} ${unitWord(p.unit, qty)} given to ${firstName(name)}`, 'ok');
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={'Give out: ' + p.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy || open === null} onClick={save}>{needs ? 'Ask owner and give out' : 'Give out'}</button></>}>
      <div className="stack">
        <p className="muted small">In the store: {Number(p.stock)} {unitWord(p.unit, p.stock)}{p.size ? ` (${sizes.length > 1 ? sizes.map((x) => `${fmtQty(x.qty)} × ${sizeText(x.size, p.size_unit)}`).join(', ') : sizeText(p.size, p.size_unit) + ' each'})` : ''}</p>
        {sizes.length > 1 && (
          <Field label="Which size" hint="The store has two sizes; the older delivery is chosen first">
            <Seg full options={sizes.map((x) => [x.size, sizeText(x.size, p.size_unit)])} value={size} onChange={setSize} />
          </Field>
        )}
        <Field label="How many">
          <span className="qty big-qty">
            <button aria-label="One less" onClick={() => setQty((x) => Math.max(1, x - 1))}>−</button>
            <span>{qty}</span>
            <button aria-label="One more" onClick={() => setQty((x) => Math.min(100, x + 1))}>+</button>
          </span>
        </Field>
        <Field label="Who is taking it">
          <div className="chips">
            {people.map((s) => (
              <button key={s.id} className={'chip sm red' + (who === s.id ? ' on' : '')} onClick={() => setWho(s.id)}>{firstName(s.name)}</button>
            ))}
          </div>
        </Field>
        {open === null ? <Loading /> : ending ? (
          <Field label={`The ${p.unit} in use now`} hint={`Given to ${firstName(nameOf(ending.staff_id)) || 'someone'}, ${fmtDate(ending.created_at, false)}${open.length > 1 ? ` · ${open.length} in use` : ''}. Keep the empties till the owner checks them.`}>
            <Seg full className="last-seg" options={LAST} value={last} onChange={setLast} />
          </Field>
        ) : (
          <p className="small muted">None in use now, so there is no empty to hand back.</p>
        )}
        <Field label="Note">
          <input className="input" id="go-note" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder={last === 'no_empty' ? 'Where is the empty? e.g. spilled, thrown away' : last === 'in_use' ? 'Why a second one? e.g. two colours at once' : 'Optional'} />
        </Field>
        {needs && <p className="small" style={{ color: 'var(--warn)' }}>The owner approves this one {emptyOk ? `(worth ${rupee(round2(Number(p.cost_price) * qty))})` : '(no empty handed back)'}.</p>}
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

function HistoryModal({ product, onClose }) {
  const { staff } = useApp();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    db.list('stock_moves', { eq: { product_id: product.id }, order: ['created_at', 'desc'], limit: 200 }).then(setRows).catch(() => setRows([]));
  }, [product.id]);
  const who = (id) => (staff.find((s) => s.id === id) || {}).name;
  return (
    <Modal wide title={'History: ' + product.name} onClose={onClose}>
      {rows === null ? <Loading /> : rows.length === 0 ? <Empty title="No stock changes yet" /> : (
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>When</th><th>What</th><th>Details</th><th className="r">Qty</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="nowrap small">{fmtDateTime(r.created_at)}</td>
                  <td>{MOVE_LABEL[r.type] || r.type}</td>
                  <td className="small">
                    {[r.staff_id && who(r.staff_id) ? 'to ' + who(r.staff_id) : '', r.type === 'use' && r.empty_returned === true ? 'empty handed back' : '',
                      r.type === 'use' && r.empty_returned === false ? 'no empty' : '', r.owner_grant_id ? 'owner approved' : '',
                      r.supplier, r.note, r.unit_cost && r.type === 'in' ? '@ ' + rupee(r.unit_cost) : ''].filter(Boolean).join(' · ')}
                  </td>
                  <td className="r strong" style={{ color: Number(r.qty) < 0 ? 'var(--bad)' : 'var(--ok)' }}>{Number(r.qty) > 0 ? '+' : ''}{Number(r.qty)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  );
}

// ---------------- Bottle check (owner) ----------------
const RESULT = {
  check: ['bad', 'Check'], almost: ['warn', 'Almost finished'], learning: ['', 'Learning'], fine: ['ok', 'Fine'], none: ['', 'Not given out yet'],
};
const UNIT_RESULT = {
  early: ['bad', 'Finished early'], fine: ['ok', 'Fine'], first: ['', 'First one'], learning: ['', 'Learning'], open: ['', 'In use'], almost: ['warn', 'Almost finished'], fast: ['bad', 'Running fast'],
};
const usesText = (u, by) => (by === 'uses' ? `${fmtQty(u.uses)} uses` : `${Math.round(u.days)} days`);
const normalText = (r) => {
  if (r.normal) return `${by(r)}${r.source === 'set' ? ' (yours)' : ` (learned from ${r.learnedN})`}`;
  return `Learning: ${Math.min(r.learnedN, LEARN_MIN)} of ${LEARN_MIN} finished`;
};
const by = (r) => (r.by === 'uses' ? `~${fmtQty(r.normal)} uses` : `~${Math.round(r.normal)} days`);

function BottleCheck({ onUsedIn }) {
  const { products, services, staff, toast, loadProducts } = useApp();
  const [period, setPeriod] = useState(30);
  const [data, setData] = useState(null);
  const [open, setOpen] = useState(null);
  const from = useMemo(() => dayRangeISO(addDays(istDay(), -(period - 1)))[0], [period]);

  const load = async () => {
    setData(null);
    const [since] = dayRangeISO(addDays(istDay(), -179));
    try {
      const [report, free, counts, checks] = await Promise.all([
        db.rpc('unit_report', {}),
        db.list('free_uses', { gte: { created_at: since }, order: ['created_at', 'desc'] }),
        db.list('stock_moves', { eq: { type: 'adjust' }, gte: { created_at: since } }),
        db.list('unit_checks', { gte: { created_at: since } }),
      ]);
      setData({ report, free, counts, checks });
    } catch (e) {
      toast(e.message, 'bad');
      setData({ report: { now: new Date().toISOString(), products: [] }, free: [], counts: [], checks: [] });
    }
  };
  useEffect(() => { loadProducts(); load(); }, []);

  const r = useMemo(() => data && bottleCheck({ report: data.report, products, staff, freeUses: data.free, checks: data.checks, from }), [data, products, staff, from]);
  const free = data ? data.free.filter((f) => f.created_at >= from) : [];
  const countLoss = data ? round2(-data.counts.filter((m) => m.created_at >= from && Number(m.qty) < 0)
    .reduce((a, m) => a + Number(m.qty) * (Number(m.unit_cost) || Number((products.find((p) => p.id === m.product_id) || {}).cost_price) || 0), 0)) : 0;
  const svcName = (sid) => (services.find((s) => s.id === sid) || {}).name || 'Service removed';

  return (
    <div className="stack loose">
      <div className="chips">
        {[[30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 180 days']].map(([k, l]) => (
          <button key={k} className={'chip sm' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>
        ))}
      </div>
      {!r ? <Loading /> : (
        <>
          <div className="stats four">
            <Stat k="Finished early" v={r.totals.early} s={[r.totals.early ? `About ${rupee(Math.round(r.totals.lost))} not explained by bills` : 'None in this period', r.totals.fast ? `${r.totals.fast} running fast now` : ''].filter(Boolean).join(' · ')} accent={r.totals.early > 0 || r.totals.fast > 0} />
            <Stat k="Almost finished" v={r.totals.almost} s={r.totals.orderNow ? `${r.totals.orderNow} with none left in the store` : 'The next one is in the store'} accent={r.totals.orderNow > 0} />
            <Stat k="Given out without the empty" v={r.totals.noEmpty} s="Ask for the empties" />
            <Stat k="Used without a bill" v={free.length} s={countLoss > 0 ? `Missing at stock counts: ${rupee(Math.round(countLoss))}` : 'Redos, staff, family, training'} />
          </div>
          <div className="card">
            <div className="card-head"><h3>How many services each one lasted</h3><span className="tiny muted">Tap a row for each one and who took it</span></div>
            {r.rows.length === 0 ? (
              <Empty title="Nothing to check yet">Tick which services use each salon product (Used in), and give stock out with the Give out button. <button className="link" onClick={() => onUsedIn('')}>Set Used in</button></Empty>
            ) : (
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Product</th><th>In use now</th><th>Last finished</th><th>Normal</th><th>Result</th></tr></thead>
                  <tbody>
                    {r.rows.map((x) => (
                      <tr key={x.product.id} className="click" onClick={() => setOpen(x)}>
                        <td><div className="strong">{x.product.name}</div><div className="tiny muted">{x.tagged ? `${TYPE_LABEL[x.product.use_type] || 'Salon use'}` : 'Not ticked for any service: by days'}</div></td>
                        <td className="small">{x.open.length ? <UnitLine info={openInfo(x)} /> : <span className="muted">–</span>}{x.open[0] && <div className="tiny muted">{firstName(x.open[0].givenTo) || 'Not recorded'}, {fmtDate(x.open[0].started_at, false)}</div>}</td>
                        <td>
                          <div className="unit-chips">
                            {x.units.filter((u) => !u.open).slice(0, 5).map((u) => (
                              <span key={u.move_id} className={'pill ' + (UNIT_RESULT[u.status] || [''])[0]} title={`${fmtDate(u.ended_at, false)} · ${UNIT_RESULT[u.status][1]}`}>{x.by === 'uses' ? fmtQty(u.uses) : Math.round(u.days) + 'd'}</span>
                            ))}
                            {!x.units.some((u) => !u.open) && <span className="tiny muted">None yet</span>}
                          </div>
                        </td>
                        <td className="small nowrap">{normalText(x)}</td>
                        <td>
                          <span className={'pill ' + RESULT[x.status][0]}>{RESULT[x.status][1]}{x.early > 1 ? ` (${x.early})` : ''}</span>
                          {x.lost > 0 && <div className="tiny" style={{ color: 'var(--bad)' }}>{rupee(Math.round(x.lost))}</div>}
                          {x.gap && <div className="tiny" style={{ color: 'var(--warn)' }}>{fmtQty(x.gap.clients)} done with none given out</div>}
                          {x.fast > 0 && <div className="tiny" style={{ color: 'var(--bad)' }}>The one in use is running fast</div>}
                          {x.lowLearned && <div className="tiny" style={{ color: 'var(--warn)' }}>Lasts less than usual (~{x.lowLearned.typical})</div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {r.staff.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>By person</h3><span className="tiny muted">Who took them out</span></div>
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Staff</th><th className="r">Taken out</th><th className="r">Finished early</th><th className="r">Without the empty</th><th className="r">Used without a bill</th></tr></thead>
                  <tbody>
                    {r.staff.map((s) => (
                      <tr key={s.id || 'none'}>
                        <td>{s.name}{s.repeat && <div className="tiny" style={{ color: 'var(--bad)' }}>{s.early} finished early: talk to them</div>}</td>
                        <td className="r">{fmtQty(s.taken)}</td>
                        <td className="r" style={{ color: s.early ? 'var(--bad)' : undefined }}>{s.early}{s.lost > 0 && <div className="tiny">{rupee(Math.round(s.lost))}</div>}</td>
                        <td className="r" style={{ color: s.noEmpty ? 'var(--bad)' : undefined }}>{s.noEmpty}</td>
                        <td className="r">{fmtQty(s.free)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="tiny muted card-pad">A shared bottle is often taken by one person and used by all, so read this with the services each one lasted.</p>
            </div>
          )}
          <div className="card free-card">
            <div className="card-head"><h3>Used without a bill</h3><span className="tiny muted">Counted in the uses, so the bottle isn't flagged for them</span></div>
            {free.length === 0 ? <Empty title="None in this period" /> : (
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>When</th><th>Service</th><th>Done by</th><th>Why</th><th>Recorded by</th></tr></thead>
                  <tbody>
                    {free.map((f) => (
                      <tr key={f.id}>
                        <td className="nowrap small">{fmtDateTime(f.created_at)}</td>
                        <td>{svcName(f.service_id)}{[f.option_label, f.extra_label].filter(Boolean).length ? ` (${[f.option_label, f.extra_label].filter(Boolean).join(' · ')})` : ''}{Number(f.qty) !== 1 ? ` × ${Number(f.qty)}` : ''}</td>
                        <td>{firstName((staff.find((s) => s.id === f.staff_id) || {}).name) || '–'}</td>
                        <td className="small">{FREE_REASON[f.reason] || f.reason}{f.note ? <div className="tiny muted">{f.note}</div> : null}</td>
                        <td className="small muted">{f.created_by || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="card card-pad stack tight small">
            <b>How to read this</b>
            <span>Each <b>Give out</b> starts one; the empty handed back at the next Give out ends it. The services billed while it was in use are its <b>uses</b>.
              Long hair counts more by itself (S 1, M 1.5, L 2, XL 2.5, thick hair +0.5), and so do services set to count more in <b>Used in</b>.</span>
            <span><b>Normal</b> is your number in Used in, or the middle of the last ones once {LEARN_MIN} have finished. <b>Finished early</b>: below {Math.round(EARLY * 100)}% of normal.
              Ask who used it, check the empties and the appointment book: services done without a bill show up here. A redo or a staff colour is fine: record it with <b>Used without a bill</b>.</span>
            <span><b>Almost finished</b>: the one in use has done {Math.round(ALMOST * 100)}% of normal. With none left in the store, order now (you also get a Telegram message).</span>
            <span><b>Running fast</b>: at the weekly count the one in use looked emptier than its bills explain (Count stock → the one in use). One bottle can fairly vary; act when the same product or person comes up again (<i>talk to them</i>).</span>
            <span>Products not ticked for any service (gloves, cotton, foils) are checked by how many days one lasts. A bottle of a different size (a 500 ml delivery of a 1 L product) is expected to last that much less or more.</span>
          </div>
        </>
      )}
      {open && <BottleDetail row={open} onClose={() => setOpen(null)} onUsedIn={() => { setOpen(null); onUsedIn(open.product.id); }} />}
    </div>
  );
}

function BottleDetail({ row, onClose, onUsedIn }) {
  const p = row.product;
  const { staff } = useApp();
  const nameOf = (id) => (staff.find((s) => s.id === id) || {}).name || '';
  return (
    <Modal wide title={p.name} onClose={onClose} foot={<><button className="btn line" onClick={onClose}>Close</button><button className="btn line" onClick={onUsedIn}>Used in and normal</button></>}>
      <div className="stack">
        <p className="small">
          Normal: <b>{normalText(row)}</b>{row.source === 'set' && row.learnedN >= LEARN_MIN && row.learned ? `. Your last ones did about ${row.by === 'uses' ? fmtQty(row.learned) + ' uses' : Math.round(row.learned) + ' days'}.` : '.'}
          {row.by === 'days' && ' This product isn\'t ticked for any service, so it is checked by days. Tick its services in Used in to check it by services.'}
        </p>
        {row.lowLearned && (
          <div className="owner-ask small"><AlertTriangle size={18} /><span>Your {unitWord(p.unit, 2)} last about <b>{fmtQty(row.normal)}</b> uses, but a {sizeText(p.size, p.size_unit)} {p.unit} usually lasts about <b>{row.lowLearned.typical}</b>. If product has been going from the start, the app learned that as normal. Measure a few services (Used in) and set your own number.</span></div>
        )}
        {row.gap && (
          <div className="owner-ask small"><AlertTriangle size={18} /><span><b>{fmtQty(row.gap.clients)} service{row.gap.clients === 1 ? '' : 's'}</b> that use it were billed while none was given out (last 180 days). Was one taken without Give out?</span></div>
        )}
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Given out</th><th>To</th><th>Ended</th><th className="r">{row.by === 'uses' ? 'Uses' : 'Days'}</th><th className="r">Of normal</th><th>Result</th></tr></thead>
            <tbody>
              {row.units.map((u) => (
                <tr key={u.move_id}>
                  <td className="nowrap small">{fmtDateTime(u.started_at)}{Number(u.n) > 1 ? <div className="tiny muted">{Number(u.n)} together (each)</div> : null}{Number(u.scale) && Number(u.scale) !== 1 ? <div className="tiny muted">{sizeText(u.unit_size, p.size_unit)} (expects {fmtQty(u.expected)})</div> : null}</td>
                  <td>{firstName(u.givenTo) || '–'}{u.empty_returned === false && <div className="tiny" style={{ color: 'var(--bad)' }}>no empty for the last one</div>}</td>
                  <td className="small">{u.open ? <span className="muted">In use{u.level ? <div className="tiny">{`Checked ${fmtDate(u.level.created_at, false)}: ${Math.round(Number(u.level.left_pct))}% left, bills show ${fmtQty(u.level.uses_at)} of ~${fmtQty(u.level.expected_at)}`}</div> : null}</span> : <>{fmtDate(u.ended_at, false)}<div className="tiny muted">{HOW[u.how] || ''}{u.by_move && nameOf(row.units.find((x) => x.move_id === u.by_move)?.staff_id) ? ` · next one to ${firstName(nameOf(row.units.find((x) => x.move_id === u.by_move).staff_id))}` : ''}</div></>}</td>
                  <td className="r">{usesText(u, row.by)}{row.by === 'uses' && <div className="tiny muted">{fmtQty(u.clients)} clients</div>}</td>
                  <td className="r">{u.ratio == null ? '–' : Math.round(u.ratio * 100) + '%'}</td>
                  <td><span className={'pill ' + UNIT_RESULT[u.status][0]}>{UNIT_RESULT[u.status][1]}</span>{u.lost > 0 && <div className="tiny" style={{ color: 'var(--bad)' }}>{rupee(Math.round(u.lost))}</div>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted">A service done while two were in use counts half for each. The first one ever isn't judged: an older one may have been in use with it.</p>
      </div>
    </Modal>
  );
}

// ---------------- Used in (owner): which services use each salon product ----------------
function UsedInTab({ focus }) {
  const { products, services, toast, loadProducts } = useApp();
  const salon = products.filter((p) => p.active && p.kind === 'salon');
  const [pid, setPid] = useState(focus && salon.some((p) => p.id === focus) ? focus : salon[0] ? salon[0].id : '');
  const [rows, setRows] = useState(null); // { id?, service_id, weight, on, suggested }
  const [uses, setUses] = useState('');
  const [addId, setAddId] = useState('');
  const [busy, setBusy] = useState(false);
  const [measured, setMeasured] = useState(['', '', '', '', '']); // amount used in a few real services (normal ones)
  const p = products.find((x) => x.id === pid);
  const svc = Object.fromEntries(services.map((s) => [s.id, s]));
  const typical = p ? typicalUses(p.use_type, p.size, p.size_unit) : null;
  const mVals = measured.map(Number).filter((x) => x > 0);
  const mAvg = mVals.length ? mVals.reduce((a, x) => a + x, 0) / mVals.length : null;
  const fromMeasure = p && Number(p.size) > 0 && mAvg ? Math.max(1, Math.round((Number(p.size) / mAvg) * 10) / 10) : null;

  const load = async () => {
    if (!pid) return setRows([]);
    setRows(null);
    try {
      const tags = await db.list('service_usage', { eq: { product_id: pid } });
      const sugg = p && p.use_type ? suggestTags(p.use_type, services) : [];
      setRows([
        ...tags.map((t) => ({ id: t.id, service_id: t.service_id, weight: String(Number(t.weight ?? 1)), was: Number(t.weight ?? 1), on: true })),
        ...sugg.filter((x) => !tags.some((t) => t.service_id === x.service.id))
          .map((x) => ({ service_id: x.service.id, weight: String(x.weight), on: !tags.length && x.ticked, suggested: true })),
      ]);
      setUses(p && p.uses_per_unit ? String(Number(p.uses_per_unit)) : '');
    } catch (e) { toast(e.message, 'bad'); setRows([]); }
  };
  useEffect(() => { load(); setMeasured(['', '', '', '', '']); }, [pid]);

  const set = (i, patch) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = async () => {
    if (rows.some((r) => r.on && !(Number(r.weight) > 0 && Number(r.weight) <= 50))) return toast('"Counts as" must be more than 0 (e.g. 1, 0.5, 2)', 'bad');
    if (uses !== '' && !(Number(uses) > 0)) return toast('Enter how many services one lasts, or leave it empty', 'bad');
    setBusy(true);
    try {
      for (const r of rows) {
        if (r.id && !r.on) await db.remove('service_usage', r.id);
        else if (r.on && (!r.id || Number(r.weight) !== r.was)) await db.upsert('service_usage', { service_id: r.service_id, product_id: pid, weight: Number(r.weight) }, 'service_id,product_id');
      }
      const n = uses === '' ? null : Number(uses);
      if ((p.uses_per_unit == null ? null : Number(p.uses_per_unit)) !== n) await db.update('products', pid, { uses_per_unit: n });
      toast('Saved', 'ok');
      await loadProducts();
      load();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };

  if (!salon.length) return <div className="card"><Empty title="No salon-use products yet">Add products like developer, colour, spa cream, wax and facial kits in the Stock tab, as "Salon use".</Empty></div>;
  const ticked = rows ? rows.filter((r) => r.on).length : 0;
  return (
    <div className="stack loose">
      <div className="card card-pad stack">
        <Field label="Product">
          <select className="select" id="u-product" value={pid} onChange={(e) => setPid(e.target.value)}>
            {salon.map((x) => <option key={x.id} value={x.id}>{x.name}{x.use_type ? ` · ${TYPE_LABEL[x.use_type]}` : ''}</option>)}
          </select>
        </Field>
        {p && (
          <Field label={`One ${p.unit} lasts about (services)`}
            hint={`${typical ? `Typical${p.size ? ` for ${sizeText(p.size, p.size_unit)}` : ''}: about ${typical}. ` : ''}Leave empty and the app learns it from your first ${LEARN_MIN} ${unitWord(p.unit, 2)}; your own number is safer.`}>
            <input className="input" id="u-uses" inputMode="decimal" value={uses} onChange={(e) => setUses(num(e.target.value))} placeholder={typical ? `e.g. ${typical}` : 'Learn it'} style={{ maxWidth: 160 }} />
          </Field>
        )}
        {p && Number(p.size) > 0 && p.size_unit !== 'uses' && (
          <details className="measure">
            <summary className="small">Measure it once (most accurate)</summary>
            <div className="stack tight" style={{ marginTop: 8 }}>
              <span className="small muted">Weigh or measure what a normal, short-hair service of this product really uses, a few times ({p.size_unit}).</span>
              <div className="row wrap" style={{ gap: 6 }}>
                {measured.map((v, i) => (
                  <input key={i} className="input" style={{ width: 70, height: 34 }} inputMode="decimal" aria-label={`Measured ${i + 1}`} value={v}
                    onChange={(e) => setMeasured((m) => m.map((x, j) => (j === i ? num(e.target.value) : x)))} />
                ))}
              </div>
              {fromMeasure && (
                <div className="row wrap small">
                  <span>Average {fmtQty(mAvg)} {p.size_unit} → one {sizeText(p.size, p.size_unit)} {p.unit} lasts about <b>{fmtQty(fromMeasure)}</b></span>
                  <button className="btn line sm" onClick={() => setUses(String(fromMeasure))}>Use {fmtQty(fromMeasure)}</button>
                </div>
              )}
            </div>
          </details>
        )}
        {p && !Number(p.size) && <p className="small" style={{ color: 'var(--warn)' }}>Set the size of one {p.unit} for this product (Stock → Edit), e.g. 1 L.</p>}
        {p && !p.use_type && <p className="small" style={{ color: 'var(--warn)' }}>Set "What is it" for this product (Stock → Edit) to see the usual services for it.</p>}
      </div>
      {rows === null ? <Loading /> : (
        <div className="card">
          <div className="card-head"><h3>Used in</h3><span className="tiny muted">{ticked} service{ticked === 1 ? '' : 's'} ticked</span></div>
          {rows.length === 0 ? <Empty title="No services yet">Add the services that use it below.</Empty> : (
            <div className="used-list">
              {rows.map((r, i) => (
                <div key={r.service_id} className={'used-row' + (r.on ? ' on' : '')}>
                  <label className="check grow">
                    <input type="checkbox" checked={r.on} onChange={(e) => set(i, { on: e.target.checked })} />
                    <span className="grow">{(svc[r.service_id] || {}).name || 'Service removed'}<span className="tiny muted"> · {(svc[r.service_id] || {}).category || ''}{r.suggested ? ' · suggested' : ''}</span></span>
                  </label>
                  {r.on && (
                    <label className="tiny muted counts-as">counts as
                      <input className="input" inputMode="decimal" aria-label={'Counts as for ' + ((svc[r.service_id] || {}).name || '')} value={r.weight} onChange={(e) => set(i, { weight: num(e.target.value) })} />
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="card-pad row wrap">
            <select className="select grow" id="u-add" value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Add a service…</option>
              {services.filter((s) => s.active && !rows.some((r) => r.service_id === s.id)).map((s) => <option key={s.id} value={s.id}>{s.category} · {s.name}</option>)}
            </select>
            <button className="btn line" disabled={!addId} onClick={() => { setRows((rs) => [...rs, { service_id: addId, weight: '1', on: true }]); setAddId(''); }}><Plus size={15} /> Add</button>
            <button className="btn primary" disabled={busy} onClick={save}>Save</button>
          </div>
        </div>
      )}
      <p className="small muted" style={{ maxWidth: 760 }}>
        Tick every service that uses this product. Nothing changes at billing: the bills already say which service was done, so the app counts how many
        services each {p ? p.unit : 'unit'} lasted. One normal service counts as 1; long hair (M 1.5, L 2, XL 2.5) and thick hair (+0.5) count more by themselves.
        Use <b>counts as</b> only for services that use much more or less, e.g. Full Legs wax 5 and Upper Lip 0.25.
      </p>
    </div>
  );
}

// Two in use and one is empty, with no new one needed: it ends here
function EndUnitModal({ row, onClose, onSaved }) {
  const { toast } = useApp();
  const p = row.product;
  const [pick, setPick] = useState(row.open.length ? row.open[row.open.length - 1].move_id : '');
  const [empty, setEmpty] = useState('back');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    if (!pick) return setErr('Choose which one is empty.');
    setBusy(true);
    try {
      await db.rpc('end_unit', { p: { move_id: pick, how: empty === 'back' ? 'empty' : 'no_empty' } });
      db.notify('unit_end', pick); // Telegram to the owner if it finished early
      toast('Saved', 'ok');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={'One is empty: ' + p.name} onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack">
        <p className="small muted">{row.open.length} are in use. Choose the one that is finished; the other stays in use. When the last one is finished, give out the next one (or mark the product Finished).</p>
        <div className="pick-list">
          {[...row.open].reverse().map((u) => (
            <label key={u.move_id} className="check pick">
              <input type="radio" name="end-unit" checked={pick === u.move_id} onChange={() => setPick(u.move_id)} />
              <span className="grow">Given to {firstName(u.givenTo) || 'someone'}, {fmtDateTime(u.started_at)}</span>
              <span className="small muted">{row.by === 'uses' ? `${fmtQty(u.uses)} uses` : `${Math.floor(u.days)} days`}</span>
            </label>
          ))}
        </div>
        <Field label="Empty handed back?"><Seg full options={[['back', 'Yes'], ['none', 'No']]} value={empty} onChange={setEmpty} /></Field>
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

// ---------------- Used without a bill: a redo, staff's own, family, training ----------------
function FreeUseModal({ onClose, onSaved }) {
  const { services, staff, toast } = useApp();
  const [sid, setSid] = useState('');
  const [opt, setOpt] = useState('');
  const [extra, setExtra] = useState('');
  const [who, setWho] = useState('');
  const [why, setWhy] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const id = useRef(uid());
  const s = services.find((x) => x.id === sid);
  const labels = s && Array.isArray(s.variants) ? s.variants.map((v) => v.label).filter(Boolean) : [];
  const choices = s && s.extra_options && Array.isArray(s.extra_options.choices) ? s.extra_options.choices : [];
  const groups = useMemo(() => {
    const g = {};
    for (const x of services.filter((y) => y.active)) (g[x.category] = g[x.category] || []).push(x);
    return Object.entries(g);
  }, [services]);

  const save = async () => {
    setErr('');
    if (!s) return setErr('Choose the service.');
    if (labels.length && !opt) return setErr('Choose the option (e.g. hair length).');
    if (!who) return setErr('Choose who did it.');
    if (!why) return setErr('Choose why there was no bill.');
    if (why === 'other' && !note.trim()) return setErr('Write what it was for.');
    setBusy(true);
    try {
      await db.rpc('record_free_use', { p: { id: id.current, service_id: sid, option: opt, extra, staff_id: who, reason: why, note: note.trim() } });
      db.notify('free_use', id.current); // the owner is told on Telegram
      toast('Saved. The owner can see it in the Bottle check.', 'ok');
      onSaved();
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Modal title="Used without a bill" onClose={onClose}
      foot={<><button className="btn line" onClick={onClose}>Back</button><button className="btn primary" disabled={busy} onClick={save}>Save</button></>}>
      <div className="stack">
        <p className="small muted">A service done for free still uses product. Record it, so the bottle isn't flagged as finishing early. The owner sees each one.</p>
        <Field label="Service">
          <select className="select" id="fu-service" value={sid} onChange={(e) => { setSid(e.target.value); setOpt(''); setExtra(''); }}>
            <option value="">Choose…</option>
            {groups.map(([cat, list]) => (
              <optgroup key={cat} label={cat}>{list.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</optgroup>
            ))}
          </select>
        </Field>
        {labels.length > 0 && (
          <Field label="Option">
            <div className="chips">{labels.map((l) => <button key={l} className={'chip sm' + (opt === l ? ' on' : '')} onClick={() => setOpt(l)}><b>{l}</b>{SIZE_HINT[l] && HAIR_SECTIONS.includes(s.section) ? <span className="tiny">&nbsp;{SIZE_HINT[l]}</span> : null}</button>)}</div>
          </Field>
        )}
        {choices.length > 0 && (
          <Field label={s.extra_options.title || 'Extra'}>
            <Seg options={[['', 'Normal'], ...choices.map((c) => [c.label, c.label])]} value={extra} onChange={setExtra} />
          </Field>
        )}
        <Field label="Done by">
          <div className="chips">{staff.filter((x) => x.active).map((x) => <button key={x.id} className={'chip sm red' + (who === x.id ? ' on' : '')} onClick={() => setWho(x.id)}>{firstName(x.name)}</button>)}</div>
        </Field>
        <Field label="Why no bill">
          <div className="chips">{Object.entries(FREE_REASON).map(([k, l]) => <button key={k} className={'chip sm' + (why === k ? ' on' : '')} onClick={() => setWhy(k)}>{l}</button>)}</div>
        </Field>
        <Field label="Note"><input className="input" id="fu-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={why === 'redo' ? 'e.g. colour came out uneven, bill HF2627-0123' : 'Optional'} /></Field>
        {err && <p className="err-text" role="alert">{err}</p>}
      </div>
    </Modal>
  );
}

// ---------------- Count stock (owner) ----------------
const LEFT = [['', '–'], ['100', 'Full'], ['75', '¾ left'], ['50', '½ left'], ['25', '¼ left'], ['10', 'Almost empty']];
function CountTab() {
  const { products, staff, loadProducts, toast } = useApp();
  const [counts, setCounts] = useState({});
  const [levels, setLevels] = useState({}); // how much is left in the one in use: { productId: '50' }
  const [results, setResults] = useState(null);
  const [busy, setBusy] = useState(false);
  const [past, setPast] = useState(null);
  const [report, setReport] = useState(null);
  const list = products.filter((p) => p.active).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'salon' ? -1 : 1));
  const loadPast = async () => {
    try {
      const [from] = dayRangeISO(addDays(istDay(), -90));
      const rows = await db.list('stock_moves', { eq: { type: 'adjust' }, gte: { created_at: from }, order: ['created_at', 'desc'] });
      const byDay = {};
      for (const m of rows) {
        const d = istDay(m.created_at);
        const p = products.find((x) => x.id === m.product_id) || {};
        const v = Number(m.qty) * (Number(m.unit_cost) || Number(p.cost_price) || 0);
        byDay[d] = byDay[d] || { day: d, missing: 0, extra: 0, items: 0 };
        byDay[d].items += 1;
        if (v < 0) byDay[d].missing += -v; else byDay[d].extra += v;
      }
      setPast(Object.values(byDay));
    } catch { setPast([]); }
  };
  useEffect(() => { loadProducts(); loadPast(); db.rpc('unit_report', {}).then(setReport).catch(() => setReport(null)); }, []);
  const rows = useMemo(() => (report ? Object.fromEntries(bottleCheck({ report, products, staff }).rows.map((r) => [r.product.id, r])) : {}), [report, products, staff]);
  const diffs = list.map((p) => ({ p, c: counts[p.id], d: counts[p.id] === undefined || counts[p.id] === '' ? null : round2(Number(counts[p.id]) - Number(p.stock)) })).filter((x) => x.d);
  const missing = round2(diffs.reduce((a, x) => a + (x.d < 0 ? -x.d * Number(x.p.cost_price) : 0), 0));
  // the one in use (the newest, when two are) and what its level says it should have served
  const levelOf = (p) => {
    const r = rows[p.id];
    const lv = levels[p.id];
    if (!r || !r.open.length || !lv) return null;
    const u = r.open[0];
    const at = r.by === 'uses' ? Number(u.uses) : Number(u.days);
    const expected = u.expected == null ? null : round2((1 - Number(lv) / 100) * Number(u.expected));
    return { p, r, u, left: Number(lv), at: round2(at), expected, result: levelResult(at, expected) };
  };
  const checksToSave = list.map(levelOf).filter(Boolean);

  const save = async () => {
    setBusy(true);
    try {
      for (const x of diffs) await db.insert('stock_moves', { product_id: x.p.id, type: 'adjust', qty: x.d, unit_cost: Number(x.p.cost_price) || 0, note: `Stock count: ${x.c}` });
      for (const x of checksToSave) await db.insert('unit_checks', { move_id: x.u.move_id, product_id: x.p.id, left_pct: x.left, uses_at: x.at, expected_at: x.expected });
      const fast = checksToSave.filter((x) => x.result === 'fast');
      toast(`Count saved${missing ? `. Missing: ${rupee(missing)}` : ''}${fast.length ? `. ${fast.length} running fast` : ''}`, missing || fast.length ? 'bad' : 'ok');
      setResults(checksToSave);
      setCounts({});
      setLevels({});
      await loadProducts();
      loadPast();
    } catch (e) { toast(e.message, 'bad'); } finally { setBusy(false); }
  };
  const unitsWord = (r, n) => (r.by === 'uses' ? `${fmtQty(n)} uses` : `${Math.round(n)} days`);

  return (
    <div className="stack loose">
      <p className="small muted" style={{ maxWidth: 760 }}>
        Count every sealed tube, jar, bottle and kit in the store, and the retail shelf, once a week (e.g. Sunday after closing). Do it yourself or with a partner, not the person who gives stock out.
        Type only what you counted; leave the rest empty. For the ones in use, look at how much is left: the app checks it against the bills, so a bottle emptying too fast shows up this week, not when it ends.
      </p>
      {results && results.length > 0 && (
        <div className="card">
          <div className="card-head"><h3>The ones in use</h3><span className="tiny muted">How full they are, against the bills</span></div>
          <div className="table-wrap">
            <table className="rtable">
              <tbody>
                {results.map((x) => (
                  <tr key={x.p.id}>
                    <td className="strong">{x.p.name}</td>
                    <td className="small">{LEFT.find(([k]) => Number(k) === x.left)?.[1]} · given to {firstName(x.u.givenTo) || 'someone'} {fmtDate(x.u.started_at, false)}</td>
                    <td className="small">{x.expected == null ? 'No normal yet' : `Looks like ~${unitsWord(x.r, x.expected)}, bills show ${unitsWord(x.r, x.at)}`}</td>
                    <td>{x.result === 'fast' ? <span className="pill bad">Running fast</span> : x.result === 'ok' ? <span className="pill ok">Fine</span> : <span className="pill">–</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      <div className="card">
        <div className="table-wrap">
          <table className="rtable">
            <thead><tr><th>Product</th><th className="r">App says</th><th className="r">Counted</th><th className="r">Difference</th><th>The one in use</th></tr></thead>
            <tbody>
              {list.map((p) => {
                const c = counts[p.id];
                const d = c === undefined || c === '' ? null : round2(Number(c) - Number(p.stock));
                const r = rows[p.id];
                const lv = levelOf(p);
                return (
                  <tr key={p.id}>
                    <td><div className="strong">{p.name}</div><div className="tiny muted">{p.kind === 'retail' ? 'For sale' : 'Salon use'} · {rupee(p.cost_price)} per {p.unit}</div></td>
                    <td className="r">{Number(p.stock)} {p.unit}</td>
                    <td className="r"><input className="input" style={{ width: 84, height: 34, textAlign: 'right' }} inputMode="decimal" aria-label={'Counted ' + p.name} value={c ?? ''} onChange={(e) => setCounts({ ...counts, [p.id]: num(e.target.value) })} /></td>
                    <td className="r nowrap" style={{ color: d < 0 ? 'var(--bad)' : d > 0 ? 'var(--ok)' : undefined }}>
                      {d == null ? '' : d === 0 ? 'Matches' : `${d > 0 ? '+' : ''}${d} (${rupee(Math.round(d * Number(p.cost_price)))})`}
                    </td>
                    <td>
                      {r && r.open.length ? (
                        <>
                          <select className="select level-select" aria-label={'Left in the one in use: ' + p.name} value={levels[p.id] || ''} onChange={(e) => setLevels({ ...levels, [p.id]: e.target.value })}>
                            {LEFT.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                          {lv && lv.result === 'fast' && <div className="tiny" style={{ color: 'var(--bad)' }}>Running fast: bills show {unitsWord(r, lv.at)} of ~{unitsWord(r, lv.expected)}</div>}
                        </>
                      ) : <span className="tiny muted">{p.kind === 'salon' ? 'None in use' : ''}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="card-pad row between wrap">
          <span className="small">{diffs.length || checksToSave.length ? `${diffs.length} different · missing ${rupee(Math.round(missing))}${checksToSave.length ? ` · ${checksToSave.length} in use checked` : ''}` : 'Type the counts above'}</span>
          <button className="btn primary" disabled={!(diffs.length || checksToSave.length) || busy} onClick={save}>Save count</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Past counts</h3><span className="tiny muted">Last 90 days</span></div>
        {past === null ? <Loading /> : past.length === 0 ? <Empty title="No counts yet" /> : (
          <div className="table-wrap">
            <table className="rtable">
              <thead><tr><th>Day</th><th className="r">Products corrected</th><th className="r">Missing</th><th className="r">Extra found</th></tr></thead>
              <tbody>
                {past.map((x) => (
                  <tr key={x.day}><td>{fmtDate(x.day)}</td><td className="r">{x.items}</td><td className="r" style={{ color: x.missing ? 'var(--bad)' : undefined }}>{rupee(Math.round(x.missing))}</td><td className="r">{rupee(Math.round(x.extra))}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
