import { useEffect, useRef, useState } from 'react';
import { X, Search, ChevronLeft, ChevronRight, Delete } from 'lucide-react';
import { addDays, istDay, fmtDate, weekdayShort } from '../lib/format';

// Open modals, newest last: Escape closes only the top one (e.g. a photo opened from a staff member's page)
const openModals = [];
export function Modal({ title, onClose, children, foot, wide }) {
  const me = useRef({});
  useEffect(() => {
    openModals.push(me.current);
    return () => { const i = openModals.indexOf(me.current); if (i >= 0) openModals.splice(i, 1); };
  }, []);
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose && openModals[openModals.length - 1] === me.current && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          {onClose && (
            <button className="icon-btn plain" onClick={onClose} aria-label="Close">
              <X size={20} />
            </button>
          )}
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className = '' }) {
  return (
    <label className={'field ' + className}>
      {label && <span>{label}</span>}
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function SearchBox({ value, onChange, placeholder, autoFocus, inputRef }) {
  return (
    <div className="input-wrap">
      <Search size={19} />
      <input
        ref={inputRef}
        className="input"
        type="search"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      {value && (
        <button className="icon-btn plain sm clear" onClick={() => onChange('')} aria-label="Clear search">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

// Digits and one decimal point, at most 2 digits after it (paise)
export function cleanMoney(s) {
  let v = String(s || '').replace(/[^\d.]/g, '');
  const i = v.indexOf('.');
  if (i >= 0) v = v.slice(0, i + 1) + v.slice(i + 1).replace(/\./g, '').slice(0, 2);
  return v;
}

export function MoneyInput({ value, onChange, placeholder = '0', autoFocus, id, className = '' }) {
  return (
    <div className="input-wrap">
      <span className="prefix">₹</span>
      <input
        id={id}
        className={'input ' + className}
        inputMode="decimal"
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(e) => onChange(cleanMoney(e.target.value))}
      />
    </div>
  );
}

export function Seg({ options, value, onChange, full, className = '' }) {
  return (
    <div className={'seg ' + (full ? 'full ' : '') + className}>
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" className={(value === v ? 'on ' : '') + v} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function Stat({ k, v, s, accent }) {
  return (
    <div className={'stat' + (accent ? ' accent' : '')}>
      <div className="k">{k}</div>
      <div className="v" title={typeof v === 'string' ? v : undefined}>{v}</div>
      {s && <div className="s">{s}</div>}
    </div>
  );
}

export function Empty({ title, children }) {
  return (
    <div className="empty">
      <b>{title}</b>
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="center-load">
      <div className="spinner" />
    </div>
  );
}

export function DateNav({ day, onChange, max = istDay() }) {
  return (
    <div className="date-nav">
      <button className="icon-btn" onClick={() => onChange(addDays(day, -1))} aria-label="Previous day">
        <ChevronLeft size={18} />
      </button>
      <input className="input" type="date" value={day} max={max} onChange={(e) => e.target.value && onChange(e.target.value)} />
      <button className="icon-btn" onClick={() => onChange(addDays(day, 1))} disabled={day >= max} aria-label="Next day">
        <ChevronRight size={18} />
      </button>
      <span className="muted small nowrap">{day === istDay() ? 'Today' : weekdayShort(day) + ', ' + fmtDate(day, false)}</span>
    </div>
  );
}

export function Confirm({ title, text, okLabel = 'Yes', danger, onOk, onClose, children }) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title={title}
      onClose={onClose}
      foot={
        <>
          <button className="btn line" onClick={onClose}>Back</button>
          <button
            className={'btn ' + (danger ? 'danger' : 'primary')}
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onOk(); } finally { setBusy(false); }
            }}
          >
            {okLabel}
          </button>
        </>
      }
    >
      <div className="stack">
        {text && <p>{text}</p>}
        {children}
      </div>
    </Modal>
  );
}

// Number pad for the owner's 6-digit Authenticator code. Calls onComplete(code) when all digits are in.
export function CodePad({ length = 6, onComplete, busy = false, err = '', resetKey = 0 }) {
  const [code, setCode] = useState('');
  const cur = useRef('');
  const put = (v) => { cur.current = v; setCode(v); };
  useEffect(() => { put(''); }, [resetKey]);
  const press = (d) => {
    if (busy || cur.current.length >= length) return;
    const next = cur.current + d;
    put(next);
    if (next.length === length) onComplete(next);
  };
  const back = () => !busy && put(cur.current.slice(0, -1));
  useEffect(() => {
    const onKey = (e) => {
      if (/^\d$/.test(e.key)) press(e.key);
      if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  return (
    <div>
      <div className="pin-dots" aria-label={code.length + ' of ' + length + ' digits entered'}>
        {Array.from({ length }, (_, i) => <i key={i} className={i < code.length ? 'on' : ''} />)}
      </div>
      <div className="err-text" style={{ textAlign: 'center', minHeight: 20, marginBottom: 6 }} role="alert">{err}</div>
      <div className="pin-pad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <span />
        <button onClick={() => press('0')} disabled={busy}>0</button>
        <button onClick={back} aria-label="Delete" disabled={busy}><Delete size={22} /></button>
      </div>
    </div>
  );
}
