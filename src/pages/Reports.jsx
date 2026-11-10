import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { db } from '../lib/db';
import { useApp } from '../store';
import { rupee, round2, istDay, addDays, dayRangeISO, istMonth, addMonths, monthRange, fmtDate, weekdayShort, toCSV, downloadFile, fmtTime, canDownload, NO_DOWNLOAD } from '../lib/format';
import { Stat, Loading, Empty } from '../components/ui';

function periodRange(p, custom) {
  const t = istDay();
  if (p === 'today') return [t, t];
  if (p === 'yesterday') return [addDays(t, -1), addDays(t, -1)];
  if (p === '7d') return [addDays(t, -6), t];
  if (p === 'month') return [istMonth() + '-01', t];
  if (p === 'lastmonth') return monthRange(addMonths(istMonth(), -1));
  return [custom.from, custom.to];
}

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};
const compact = (v) => (v >= 100000 ? round2(v / 100000) + 'L' : v >= 1000 ? round2(v / 1000) + 'k' : String(v));

// Single-series column chart: one hue, thin columns, clean ticks, hover tooltip
function Columns({ data, money, label }) {
  const max = niceMax(Math.max(0, ...data.map((d) => d.value)));
  const every = Math.ceil(data.length / 12);
  return (
    <figure className="cols" aria-label={label}>
      <div className="cols-plot">
        {[1, 0.5, 0].map((f) => (
          <div key={f} className="cols-grid" style={{ bottom: f * 100 + '%' }}>
            <span>{money ? '₹' + compact(max * f) : compact(max * f)}</span>
          </div>
        ))}
        <div className="cols-bars">
          {data.map((d, i) => (
            <div key={i} className="cols-slot" tabIndex={0} aria-label={`${d.label}: ${money ? rupee(d.value) : d.value}`}>
              <i style={{ height: (d.value / max) * 100 + '%' }} />
              <span className="cols-tip">{d.tip || d.label}<b>{money ? rupee(d.value) : d.value}</b></span>
            </div>
          ))}
        </div>
      </div>
      <div className="cols-x">
        {data.map((d, i) => <span key={i}>{i % every === 0 ? d.short || d.label : ''}</span>)}
      </div>
    </figure>
  );
}

export default function Reports() {
  const { toast, products } = useApp();
  const [period, setPeriod] = useState('7d');
  const [custom, setCustom] = useState({ from: addDays(istDay(), -29), to: istDay() });
  const [data, setData] = useState(null);
  const [from, to] = periodRange(period, custom);

  useEffect(() => {
    let live = true;
    setData(null);
    const [a, b] = dayRangeISO(from, to);
    Promise.all([
      db.list('bills', { gte: { created_at: a }, lt: { created_at: b }, order: ['created_at', 'asc'] }),
      db.list('bill_items', { gte: { created_at: a }, lt: { created_at: b } }),
      db.list('expenses', { gte: { day: from }, lte: { day: to } }).catch(() => []),
    ]).then(([bills, items, expenses]) => {
      if (!live) return;
      const paidIds = new Set(bills.filter((x) => x.status === 'paid').map((x) => x.id));
      setData({ bills: bills.filter((x) => x.status === 'paid'), cancelled: bills.filter((x) => x.status !== 'paid'), items: items.filter((i) => paidIds.has(i.bill_id)), expenses: expenses.filter((e) => !e.cancelled_at) });
    }).catch((e) => { toast(e.message, 'bad'); setData({ bills: [], cancelled: [], items: [], expenses: [] }); });
    return () => { live = false; };
  }, [from, to, toast]);

  const expTotal = round2(((data && data.expenses) || []).reduce((a, e) => a + Number(e.amount), 0));
  const expTop = (() => {
    const m = {};
    for (const e of (data && data.expenses) || []) m[e.category] = (m[e.category] || 0) + Number(e.amount);
    return Object.entries(m).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([c, v]) => `${c} ${rupee(Math.round(v))}`).join(' · ');
  })();
  const r = useMemo(() => {
    if (!data) return null;
    const { bills, items } = data;
    const sum = (arr, f) => round2(arr.reduce((a, x) => a + Number(typeof f === 'function' ? f(x) : x[f] || 0), 0));
    const revenue = sum(bills, 'total');
    const newC = bills.filter((b) => b.is_new_customer).length;
    const retC = bills.filter((b) => !b.is_new_customer && b.customer_id).length;
    const walkin = bills.filter((b) => !b.customer_id).length;

    const days = [];
    for (let d = from; d <= to; d = addDays(d, 1)) days.push(d);
    const byDay = Object.fromEntries(days.map((d) => [d, { bills: 0, revenue: 0, newC: 0 }]));
    for (const b of bills) {
      const d = istDay(b.created_at);
      if (!byDay[d]) continue;
      byDay[d].bills += 1;
      byDay[d].revenue = round2(byDay[d].revenue + Number(b.total));
      if (b.is_new_customer) byDay[d].newC += 1;
    }

    // Busy hours: 10 am – 9 pm, widened to include any bill made earlier or later
    const hourOf = (t) => (new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes() + 330) % 1440 / 60 | 0; // IST hour
    const hs = bills.map((b) => hourOf(b.created_at));
    const h0 = Math.min(10, ...hs);
    const h1 = Math.max(21, ...hs);
    const hours = Array.from({ length: h1 - h0 + 1 }, (_, i) => ({ h: h0 + i, bills: 0 }));
    for (const h of hs) hours[h - h0].bills += 1;

    const net = (i) => Number(i.amount) - Number(i.discount);
    // Staff sales after discount and without GST: the same figure their commission is worked out on
    const staff = {};
    for (const i of items) {
      const k = i.staff_name || 'Not set';
      staff[k] = staff[k] || { name: k, services: 0, svc: 0, prod: 0 };
      if (i.item_type === 'service') { staff[k].services += 1; staff[k].svc = round2(staff[k].svc + Number(i.taxable)); }
      else staff[k].prod = round2(staff[k].prod + Number(i.taxable));
    }
    const services = {};
    const cats = {};
    for (const i of items) {
      services[i.name] = services[i.name] || { name: i.name, count: 0, value: 0 };
      services[i.name].count += Number(i.qty);
      services[i.name].value = round2(services[i.name].value + net(i));
      const c = i.category || 'Other';
      cats[c] = round2((cats[c] || 0) + net(i));
    }
    const offerMap = {};
    for (const i of items) {
      if (!Number(i.offer_discount)) continue;
      const k = i.offer_name || 'Offer';
      const o = (offerMap[k] = offerMap[k] || { name: k, bills: new Set(), sales: 0, given: 0 });
      o.bills.add(i.bill_id);
      o.sales = round2(o.sales + net(i));
      o.given = round2(o.given + Number(i.offer_discount));
    }
    return {
      offers: Object.values(offerMap).map((o) => ({ ...o, bills: o.bills.size })).sort((a, b) => b.sales - a.sales),
      revenue, count: bills.length, avg: bills.length ? Math.round(revenue / bills.length) : 0, newC, retC, walkin,
      discount: sum(bills, 'discount'), gst: sum(bills, (b) => Number(b.cgst) + Number(b.sgst)),
      cash: sum(bills, 'paid_cash'), upi: sum(bills, 'paid_upi'), card: sum(bills, 'paid_card'),
      ptsUsed: sum(bills, 'paid_points'), ptsEarned: sum(bills, 'points_earned'),
      days: days.map((d) => ({ d, ...byDay[d] })), hours,
      staff: Object.values(staff).sort((a, b) => b.svc + b.prod - (a.svc + a.prod)),
      services: Object.values(services).sort((a, b) => b.value - a.value).slice(0, 10),
      cats: Object.entries(cats).sort((a, b) => b[1] - a[1]),
    };
  }, [data, from, to]);

  const exportBills = () => {
    if (!canDownload()) return toast(NO_DOWNLOAD);
    const csv = toCSV([...data.bills, ...data.cancelled], [
      ['bill_no', 'Bill no'], [(b) => istDay(b.created_at), 'Date'], [(b) => fmtTime(b.created_at), 'Time'], ['customer_name', 'Customer'],
      ['customer_phone', 'Mobile'], ['subtotal', 'Subtotal'], ['offer_discount', 'Offer discount'], ['discount', 'Total discount'], ['taxable', 'Taxable value'], ['cgst', 'CGST'],
      ['sgst', 'SGST'], ['round_off', 'Round off'], ['total', 'Total'], ['pay_mode', 'Paid by'], ['paid_cash', 'Cash'], ['paid_upi', 'UPI'],
      ['paid_card', 'Card'], ['paid_points', 'Paid with points'], ['points_earned', 'Points earned'], ['status', 'Status'], ['cancel_reason', 'Cancel reason'],
    ]);
    downloadFile(`bills-${from}-to-${to}.csv`, csv);
  };
  const exportItems = () => {
    if (!canDownload()) return toast(NO_DOWNLOAD);
    const billNo = Object.fromEntries(data.bills.map((b) => [b.id, b.bill_no]));
    const csv = toCSV(data.items, [
      [(i) => billNo[i.bill_id], 'Bill no'], [(i) => istDay(i.created_at), 'Date'], ['item_type', 'Type'], ['name', 'Item'], ['category', 'Category'],
      ['hsn_sac', 'HSN/SAC'], ['staff_name', 'Staff'], ['qty', 'Qty'], ['unit_price', 'Rate'], ['amount', 'Amount'], ['offer_name', 'Offer'], ['offer_discount', 'Offer discount'], ['discount', 'Total discount'],
      ['taxable', 'Taxable value'], ['gst_pct', 'GST %'], ['gst', 'GST'],
    ]);
    downloadFile(`bill-items-${from}-to-${to}.csv`, csv);
  };

  const lowStock = products.filter((p) => p.active && Number(p.stock) <= Number(p.low_stock));
  const maxStaff = r ? Math.max(1, ...r.staff.map((s) => s.svc + s.prod)) : 1;
  const maxCat = r && r.cats.length ? r.cats[0][1] : 1;

  return (
    <div className="page">
      <div className="page-head">
        <h1>Reports</h1>
        {data && (data.bills.length > 0) && (
          <div className="row">
            <button className="btn line sm" onClick={exportBills}><Download size={15} /> Bills CSV</button>
            <button className="btn line sm" onClick={exportItems}><Download size={15} /> Items CSV</button>
          </div>
        )}
      </div>
      <div className="row wrap" style={{ marginBottom: 16 }}>
        <div className="chips">
          {[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['lastmonth', 'Last month'], ['custom', 'Pick dates']].map(([k, l]) => (
            <button key={k} className={'chip sm' + (period === k ? ' on' : '')} onClick={() => setPeriod(k)}>{l}</button>
          ))}
        </div>
        {period === 'custom' && (
          <div className="row">
            <input className="input" type="date" id="r-from" style={{ height: 34, width: 'auto' }} value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <span className="muted">to</span>
            <input className="input" type="date" id="r-to" style={{ height: 34, width: 'auto' }} value={custom.to} min={custom.from} max={istDay()} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
      </div>

      {!r ? <Loading /> : (
        <div className="stack loose">
          <div className="stats four">
            <Stat k="Sales" v={rupee(r.revenue)} s={from === to ? fmtDate(from) : `${fmtDate(from, false)} – ${fmtDate(to, false)}`} accent />
            <Stat k="Bills" v={r.count} s={data.cancelled.length ? `${data.cancelled.length} cancelled` : 'No cancelled bills'} />
            <Stat k="Average bill" v={rupee(r.avg)} />
            <Stat k="New customers" v={r.newC} s="First visit" />
            <Stat k="Returning" v={r.retC} s={r.walkin ? `${r.walkin} walk-ins without a number` : 'Came before'} />
            <Stat k="Discount given" v={rupee(Math.round(r.discount))} s={r.revenue ? Math.round((r.discount / (r.revenue + r.discount)) * 100) + '% of sales' : ''} />
            <Stat k="Paid by UPI" v={Math.round((r.upi / (r.revenue || 1)) * 100) + '%'} s={`Cash ${rupee(Math.round(r.cash))} · UPI ${rupee(Math.round(r.upi))} · Card ${rupee(Math.round(r.card))}${r.ptsUsed ? ` · Points ${rupee(r.ptsUsed)}` : ''}`} />
            <Stat k="GST collected" v={rupee(r.gst, { paise: true })} />
            <Stat k="Expenses" v={rupee(expTotal)} s={expTop || 'Bills → Expenses'} />
            <Stat k="Sales less expenses" v={rupee(round2(r.revenue - expTotal))} s="Before stock, salaries and GST" />
          </div>

          {(r.ptsEarned > 0 || r.ptsUsed > 0) && (
            <p className="small muted" id="points-report" style={{ margin: 0 }}>
              Loyalty points: {r.ptsEarned} earned on these bills ({rupee(r.ptsEarned)} to come off later visits) · {rupee(r.ptsUsed)} paid with points
              {r.revenue ? ` (${Math.round((r.ptsUsed / r.revenue) * 1000) / 10}% of sales)` : ''}. Customers → Points not yet used shows what is still owed.
            </p>
          )}
          {r.count === 0 ? (
            <div className="card"><Empty title="No sales in this period">Pick another period above.</Empty></div>
          ) : (
            <>
              <div className="grid2">
                {r.days.length > 1 && (
                  <div className="card">
                    <div className="card-head"><h3>Sales by day</h3></div>
                    <div className="card-pad">
                      <Columns money label="Sales by day" data={r.days.map((d) => ({ label: d.d, short: d.d.slice(8), tip: `${weekdayShort(d.d)}, ${fmtDate(d.d, false)} · ${d.bills} bills`, value: d.revenue }))} />
                    </div>
                  </div>
                )}
                <div className="card">
                  <div className="card-head"><h3>Busy hours</h3><span className="tiny muted">Bills started per hour</span></div>
                  <div className="card-pad">
                    <Columns label="Bills per hour" data={r.hours.map((h) => ({ label: `${h.h % 12 || 12}${h.h >= 12 ? 'pm' : 'am'}`, tip: `${h.h % 12 || 12}:00 ${h.h >= 12 ? 'pm' : 'am'}`, value: h.bills }))} />
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card">
                  <div className="card-head"><h3>Staff performance</h3><span className="tiny muted">After discount, without GST</span></div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Staff</th><th className="r">Services</th><th className="r">Service sales</th><th className="r">Products</th><th /></tr></thead>
                      <tbody>
                        {r.staff.map((s) => (
                          <tr key={s.name}>
                            <td>{s.name}</td><td className="r">{s.services}</td><td className="r">{rupee(Math.round(s.svc))}</td><td className="r">{rupee(Math.round(s.prod))}</td>
                            <td style={{ width: '22%' }}><div className="bar"><i style={{ width: ((s.svc + s.prod) / maxStaff) * 100 + '%' }} /></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card">
                  <div className="card-head"><h3>Top services</h3></div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Service</th><th className="r">Times</th><th className="r">Sales</th></tr></thead>
                      <tbody>
                        {r.services.map((s) => (
                          <tr key={s.name}><td>{s.name}</td><td className="r">{s.count}</td><td className="r">{rupee(Math.round(s.value))}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="grid2">
                <div className="card">
                  <div className="card-head"><h3>Sales by category</h3></div>
                  <div className="table-wrap">
                    <table>
                      <tbody>
                        {r.cats.map(([c, v]) => (
                          <tr key={c}>
                            <td>{c}</td><td className="r nowrap">{rupee(Math.round(v))}</td>
                            <td style={{ width: '35%' }}><div className="bar"><i style={{ width: (v / maxCat) * 100 + '%' }} /></div></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="card">
                  <div className="card-head"><h3>Day by day</h3></div>
                  <div className="table-wrap" style={{ maxHeight: 360, overflowY: 'auto' }}>
                    <table>
                      <thead><tr><th>Date</th><th className="r">Bills</th><th className="r">New</th><th className="r">Sales</th></tr></thead>
                      <tbody>
                        {[...r.days].reverse().map((d) => (
                          <tr key={d.d}><td className="nowrap">{weekdayShort(d.d)}, {fmtDate(d.d, false)}</td><td className="r">{d.bills}</td><td className="r">{d.newC}</td><td className="r">{rupee(d.revenue)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </>
          )}

          {r.offers.length > 0 && (
            <div className="card">
              <div className="card-head"><h3>Offers</h3><span className="tiny muted">Sales after discount, on the lines the offer covered</span></div>
              <div className="table-wrap">
                <table className="rtable">
                  <thead><tr><th>Offer</th><th className="r">Bills</th><th className="r">Sales</th><th className="r">Discount given</th></tr></thead>
                  <tbody>
                    {r.offers.map((o) => (
                      <tr key={o.name}><td>{o.name}</td><td className="r">{o.bills}</td><td className="r">{rupee(Math.round(o.sales))}</td><td className="r">{rupee(Math.round(o.given))}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="card">
            <div className="card-head"><h3>Stock running low</h3><span className={'pill ' + (lowStock.length ? 'warn' : 'ok')}>{lowStock.length ? lowStock.length + ' to order' : 'All fine'}</span></div>
            {lowStock.length > 0 && (
              <div className="table-wrap">
                <table>
                  <tbody>
                    {lowStock.map((p) => <tr key={p.id}><td>{p.name}</td><td className="small muted">{p.brand}</td><td className="r">{Number(p.stock)} {p.unit} left</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
