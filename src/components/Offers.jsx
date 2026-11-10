import { useMemo, useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { DOW, describeOffer, istNow, offerStatus } from '../lib/offers';
import { SECTIONS, sectionLabel } from '../data/menu';
import { istDay, addDays } from '../lib/format';
import { Modal, Field, Seg, MoneyInput, SearchBox, Empty, Confirm } from './ui';

const STATUS = {
  running: ['ok', 'Running now'],
  waiting: ['warn', 'Not running at this hour or day'],
  upcoming: ['', 'Upcoming'],
  off: ['', 'Switched off'],
  ended: ['', 'Ended'],
};
const ORDER = ['running', 'waiting', 'upcoming', 'off', 'ended'];

const BLANK = {
  name: '', active: true, starts_on: '', ends_on: '', days: [], start_time: '', end_time: '',
  applies_to: 'all', sections: [], categories: [], service_ids: [], include_products: false,
  kind: 'percent', value: '', min_bill: '', max_discount: '', new_customers_only: false, note: '',
};

// Ready-made starting points
function templates() {
  const t = istDay();
  return [
    ['Festival dates', { name: 'Pujo Ready 20% off', starts_on: '2026-10-16', ends_on: '2026-10-21', kind: 'percent', value: '20' }],
    ['Weekly offer day', { name: 'Tuesday Treat 15% off', days: [2], kind: 'percent', value: '15' }],
    ['Happy hours', { name: 'Happy hours 10% off', start_time: '11:00', end_time: '15:00', days: [1, 2, 3, 4], kind: 'percent', value: '10' }],
    ['First visit', { name: 'First visit ₹200 off', new_customers_only: true, kind: 'amount', applies_to: 'all', value: '200', starts_on: t, ends_on: addDays(t, 30), max_discount: '200' }],
  ];
}

export function OfferSettings() {
  const { offers, services, loadOffers, toast } = useApp();
  const [edit, setEdit] = useState(null);
  const now = istNow();
  const groups = useMemo(() => {
    const g = {};
    for (const o of offers || []) (g[offerStatus(o, now)] = g[offerStatus(o, now)] || []).push(o);
    return g;
  }, [offers, now.day, now.time]);

  const toggle = async (o) => {
    try {
      await db.update('offers', o.id, { active: !o.active });
      await loadOffers();
      toast(o.active ? `“${o.name}” switched off` : `“${o.name}” switched on`, o.active ? '' : 'ok');
    } catch (e) {
      toast(e.message, 'bad');
    }
  };

  return (
    <div className="stack loose">
      <div className="row between wrap">
        <p className="small muted" style={{ maxWidth: 640 }}>
          An offer applies by itself at checkout while it is running: on its dates, on its weekdays and in its hours.
          If two offers cover the same service, the customer gets the bigger saving. The counter can still give its own discount on top.
        </p>
        <button className="btn primary sm" onClick={() => setEdit({ ...BLANK })}><Plus size={15} /> New offer</button>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="small muted">Start from:</span>
        {templates().map(([label, t]) => (
          <button key={label} className="chip sm" onClick={() => setEdit({ ...BLANK, ...t })}>{label}</button>
        ))}
      </div>
      {(offers || []).length === 0 ? (
        <div className="card"><Empty title="No offers yet">Create one for Durga Puja, Diwali or a weekly offer day.</Empty></div>
      ) : (
        ORDER.filter((k) => groups[k]).map((k) => (
          <div className="card" key={k}>
            <div className="card-head"><h3>{STATUS[k][1]}</h3><span className="tiny muted">{groups[k].length}</span></div>
            {groups[k].map((o) => (
              <div className="login-row" key={o.id}>
                <div className="grow">
                  <div className="strong"><Tag size={14} style={{ verticalAlign: '-2px', color: 'var(--red)' }} /> {o.name}</div>
                  <div className="small muted">{describeOffer(o, services)}</div>
                </div>
                <span className={'pill ' + STATUS[k][0]}>{k === 'waiting' ? 'Waiting' : STATUS[k][1]}</span>
                <div className="row login-actions">
                  <button className="btn line sm" onClick={() => toggle(o)}>{o.active ? 'Switch off' : 'Switch on'}</button>
                  <button className="btn line sm" onClick={() => setEdit({ ...BLANK, ...clean(o) })}>Edit</button>
                </div>
              </div>
            ))}
          </div>
        ))
      )}
      {edit && <OfferModal offer={edit} onClose={() => setEdit(null)} onSaved={async () => { setEdit(null); await loadOffers(); }} />}
    </div>
  );
}

// Database values → form values
function clean(o) {
  const t = (x) => (x ? String(x).slice(0, 5) : '');
  return {
    ...o,
    starts_on: o.starts_on || '', ends_on: o.ends_on || '', start_time: t(o.start_time), end_time: t(o.end_time),
    days: (o.days || []).map(Number), sections: o.sections || [], categories: o.categories || [], service_ids: o.service_ids || [],
    value: o.value != null ? String(Number(o.value)) : '', min_bill: Number(o.min_bill) ? String(Number(o.min_bill)) : '',
    max_discount: Number(o.max_discount) ? String(Number(o.max_discount)) : '', note: o.note || '',
  };
}

function OfferModal({ offer, onClose, onSaved }) {
  const { services, toast } = useApp();
  const [f, setF] = useState(offer);
  const [q, setQ] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [del, setDel] = useState(false);
  const isNew = !offer.id;
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const flip = (k, v) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));

  const active = services.filter((s) => s.active);
  const categories = [...new Set(active.map((s) => s.category))];
  const pickList = active.filter((s) => !q || (s.name + ' ' + s.category).toLowerCase().includes(q.toLowerCase()));

  const save = async () => {
    const value = Number(f.value);
    if (!f.name.trim()) return setErr('Give the offer a name. It is printed on the bill.');
    if (!(value > 0)) return setErr('Enter the offer value.');
    if (f.kind === 'percent' && value > 100) return setErr('A percentage offer can be at most 100%.');
    if (f.starts_on && f.ends_on && f.ends_on < f.starts_on) return setErr('The last day is before the first day.');
    if (f.start_time && f.end_time && f.end_time <= f.start_time) return setErr('The end time must be after the start time.');
    if (f.applies_to === 'section' && !f.sections.length) return setErr('Choose at least one tab.');
    if (f.applies_to === 'category' && !f.categories.length) return setErr('Choose at least one category.');
    if (f.applies_to === 'services' && !f.service_ids.length) return setErr('Choose at least one service.');
    const row = {
      name: f.name.trim(), active: f.active, starts_on: f.starts_on || null, ends_on: f.ends_on || null,
      days: f.days.length && f.days.length < 7 ? [...f.days].sort() : null,
      start_time: f.start_time || null, end_time: f.end_time || null, applies_to: f.applies_to,
      sections: f.applies_to === 'section' ? f.sections : null, categories: f.applies_to === 'category' ? f.categories : null,
      service_ids: f.applies_to === 'services' ? f.service_ids : null, include_products: f.applies_to === 'all' && f.include_products,
      kind: f.kind, value, min_bill: Number(f.min_bill) || 0, max_discount: Number(f.max_discount) || null,
      new_customers_only: !!f.new_customers_only, note: f.note.trim() || null,
    };
    setBusy(true);
    try {
      if (isNew) await db.insert('offers', row);
      else await db.update('offers', offer.id, row);
      toast(`Offer “${row.name}” saved`, 'ok');
      await onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (del) {
    return (
      <Confirm title={`Delete “${f.name}”?`} danger okLabel="Delete offer" onClose={() => setDel(false)}
        text="Bills already made with this offer keep its name and discount. To pause an offer instead, switch it off."
        onOk={async () => { await db.remove('offers', offer.id); toast('Offer deleted'); await onSaved(); }} />
    );
  }

  const preview = { ...f, value: Number(f.value) || 0, min_bill: Number(f.min_bill) || 0, max_discount: Number(f.max_discount) || 0 };
  return (
    <Modal wide title={isNew ? 'New offer' : f.name} onClose={onClose}
      foot={
        <>
          {!isNew && <button className="btn danger" onClick={() => setDel(true)}><Trash2 size={15} /> Delete</button>}
          <span className="grow" />
          <button className="btn line" onClick={onClose}>Close</button>
          <button className="btn primary" disabled={busy} onClick={save}>Save offer</button>
        </>
      }>
      <div className="stack loose">
        <div className="offer-strip"><Tag size={15} /><span className="small">{Number(f.value) > 0 ? describeOffer(preview, services) : 'Fill in the offer below.'}</span></div>

        <Field label="Offer name" hint="Printed on the bill and the WhatsApp message">
          <input className="input" id="of-name" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Pujo Ready 20% off" />
        </Field>

        <div className="form-grid">
          <Field label="Offer type">
            <Seg full options={[['percent', '% off'], ['amount', '₹ off each'], ['price', 'Special price']]} value={f.kind} onChange={(v) => set('kind', v)} />
          </Field>
          <Field label={f.kind === 'percent' ? 'Percent off' : f.kind === 'amount' ? 'Rupees off each service' : 'Special price for each service'}>
            {f.kind === 'percent' ? (
              <input className="input" id="of-value" inputMode="decimal" value={f.value} onChange={(e) => set('value', e.target.value.replace(/[^\d.]/g, ''))} placeholder="20" />
            ) : (
              <MoneyInput id="of-value" value={f.value} onChange={(v) => set('value', v)} />
            )}
          </Field>
        </div>

        <div className="stack tight">
          <div className="sec-title">Which services</div>
          <Seg full options={[['all', 'Everything'], ['section', 'Tab'], ['category', 'Category'], ['services', 'Pick services']]} value={f.applies_to} onChange={(v) => set('applies_to', v)} />
          {f.applies_to === 'all' && (
            <label className="check"><input type="checkbox" checked={f.include_products} onChange={(e) => set('include_products', e.target.checked)} /> Also on products for sale (shampoo, serum…)</label>
          )}
          {f.applies_to === 'section' && (
            <div className="chips">{SECTIONS.map((x) => <button key={x} className={'chip sm' + (f.sections.includes(x) ? ' on' : '')} onClick={() => flip('sections', x)}>{sectionLabel(x)}</button>)}</div>
          )}
          {f.applies_to === 'category' && (
            <div className="chips">{categories.map((x) => <button key={x} className={'chip sm' + (f.categories.includes(x) ? ' on' : '')} onClick={() => flip('categories', x)}>{x}</button>)}</div>
          )}
          {f.applies_to === 'services' && (
            <div className="stack tight">
              <SearchBox value={q} onChange={setQ} placeholder="Search services" />
              <div className="pick-list">
                {pickList.map((s) => (
                  <label key={s.id} className="check pick">
                    <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => flip('service_ids', s.id)} />
                    <span className="grow">{s.name}</span><span className="tiny muted">{s.category}</span>
                  </label>
                ))}
              </div>
              <span className="small muted">{f.service_ids.length} chosen</span>
            </div>
          )}
        </div>

        <div className="stack tight">
          <div className="sec-title">When</div>
          <div className="form-grid">
            <Field label="First day" hint="Empty = starts now"><input className="input" type="date" id="of-from" value={f.starts_on} onChange={(e) => set('starts_on', e.target.value)} /></Field>
            <Field label="Last day" hint="Empty = no end date"><input className="input" type="date" id="of-to" value={f.ends_on} min={f.starts_on || undefined} onChange={(e) => set('ends_on', e.target.value)} /></Field>
          </div>
          <span className="small muted">Only on these days (none chosen = every day)</span>
          <div className="chips">{DOW.map((d, i) => <button key={d} className={'chip sm' + (f.days.includes(i + 1) ? ' on' : '')} onClick={() => flip('days', i + 1)}>{d}</button>)}</div>
          <div className="form-grid">
            <Field label="From time" hint="Empty = from opening"><input className="input" type="time" id="of-t1" value={f.start_time} onChange={(e) => set('start_time', e.target.value)} /></Field>
            <Field label="Till time" hint="Empty = till closing"><input className="input" type="time" id="of-t2" value={f.end_time} onChange={(e) => set('end_time', e.target.value)} /></Field>
          </div>
        </div>

        <div className="stack tight">
          <div className="sec-title">Conditions (optional)</div>
          <div className="form-grid">
            <Field label="Only on bills of at least"><MoneyInput id="of-min" value={f.min_bill} onChange={(v) => set('min_bill', v)} placeholder="Any bill" /></Field>
            <Field label="Most it can take off one bill"><MoneyInput id="of-cap" value={f.max_discount} onChange={(v) => set('max_discount', v)} placeholder="No limit" /></Field>
          </div>
          <label className="check"><input type="checkbox" checked={f.new_customers_only} onChange={(e) => set('new_customers_only', e.target.checked)} /> Only for a customer's first visit</label>
          <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => set('active', e.target.checked)} /> Offer is switched on</label>
        </div>
        {err && <p className="err-text">{err}</p>}
      </div>
    </Modal>
  );
}
