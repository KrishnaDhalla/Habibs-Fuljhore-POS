// Display on this device: dark mode and bigger text (top bar → Display). Anyone at the counter can change it.
import { useState } from 'react';
import { Modal, Field, Seg } from './ui';
import { THEMES, SIZES, readDisplay, saveDisplay } from '../lib/display';

export function DisplayModal({ onClose }) {
  const [d, setD] = useState(readDisplay());
  const set = (patch) => {
    const next = { ...d, ...patch };
    setD(next);
    saveDisplay(next); // changes straight away, so you can see it behind this window
  };
  return (
    <Modal title="Display on this tablet" onClose={onClose} foot={<button className="btn primary" id="display-done" onClick={onClose}>Done</button>}>
      <div className="stack">
        <Field label="Colours">
          <Seg full options={THEMES} value={d.theme} onChange={(v) => set({ theme: v })} />
        </Field>
        <Field label="Text size">
          <Seg full options={SIZES} value={d.size} onChange={(v) => set({ size: v })} />
        </Field>
        <div className="display-sample" aria-hidden="true">
          <div className="row between"><span>Fruit Facial</span><b className="money">₹2,500</b></div>
          <div className="small muted">by Amit Das · 98300 31676</div>
        </div>
        <p className="small muted">
          Dark uses soft off-white text on dark grey, not pure white on black, which glares and blurs for many eyes. Every
          text colour is at least 7 times as bright as its background, and the grey text is brighter than usual. Saved on this
          tablet only.
        </p>
      </div>
    </Modal>
  );
}
