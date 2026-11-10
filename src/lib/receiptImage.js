// The bill (and the salary slip) as a picture (PNG), drawn from the same lines as the printed one, for WhatsApp.
// Drawn straight onto a canvas (no screenshot library), so it looks the same on every device.
import { receiptRows } from './receiptRows';

const W = 600; // drawing width (the picture is twice this, for sharp text on phones)
const PAD = 30;
const INK = '#141210';
const MUTED = '#55504a';
const SIZE = { normal: 19, big: 25, sub: 15.5 };
const FONT = "Jost, 'Segoe UI', Roboto, Arial, sans-serif";
const font = (o) => `${o.bold ? 600 : 500} ${o.big ? SIZE.big : o.t === 'sub' ? SIZE.sub : SIZE.normal}px ${FONT}`;

function wrap(g, text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? cur + ' ' + w : w;
    if (!cur || g.measureText(next).width <= width) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

// Lays the rows out: [{ kind, y, lines | text, right, font }] and the height
function layout(g, rows) {
  const inner = W - PAD * 2;
  let y = PAD;
  const out = [];
  for (const r of rows) {
    if (r.t === 'hr') { y += 10; out.push({ kind: 'hr', y }); y += 12; continue; }
    g.font = font(r);
    const lh = Math.round((r.big ? SIZE.big : r.t === 'sub' ? SIZE.sub : SIZE.normal) * 1.42);
    if (r.t === 'lr') {
      const rw = g.measureText(r.right).width;
      if (rw > inner * 0.62) {
        // a long right side (e.g. "Points ₹100 + Cash ₹2,400") goes on its own line
        const left = wrap(g, r.text, inner);
        const right = wrap(g, r.right, inner);
        out.push({ kind: 'lr', y, left, right: null, rightLines: right, lh, font: g.font });
        y += lh * (left.length + right.length);
      } else {
        const left = wrap(g, r.text, inner - rw - 16);
        out.push({ kind: 'lr', y, left, right: r.right, lh, font: g.font });
        y += lh * left.length;
      }
    } else {
      const lines = wrap(g, r.text, r.t === 'sub' ? inner - 16 : inner);
      out.push({ kind: r.t, y, lines, lh, font: g.font });
      y += lh * lines.length;
    }
  }
  return { out, height: Math.ceil(y + PAD) };
}

// Any rows (see receiptRows.js, slipRows.js) as a PNG
export async function rowsImage(rows, { scale = 2 } = {}) {
  try {
    await Promise.all([document.fonts.load(`500 ${SIZE.normal}px Jost`), document.fonts.load(`600 ${SIZE.big}px Jost`)]);
  } catch { /* the fallback font is fine */ }
  const probe = document.createElement('canvas').getContext('2d');
  const { out, height } = layout(probe, rows);
  const c = document.createElement('canvas');
  c.width = W * scale;
  c.height = height * scale;
  const g = c.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, height);
  g.textBaseline = 'top';
  for (const e of out) {
    if (e.kind === 'hr') {
      g.strokeStyle = '#8a837b';
      g.lineWidth = 1.2;
      g.setLineDash([6, 5]);
      g.beginPath();
      g.moveTo(PAD, e.y + 0.5);
      g.lineTo(W - PAD, e.y + 0.5);
      g.stroke();
      g.setLineDash([]);
      continue;
    }
    g.font = e.font;
    g.fillStyle = e.kind === 'sub' ? MUTED : INK;
    const top = (i) => e.y + i * e.lh + (e.lh - parseFloat(e.font.split(' ')[1])) / 2;
    if (e.kind === 'center') {
      g.textAlign = 'center';
      e.lines.forEach((l, i) => g.fillText(l, W / 2, top(i)));
    } else if (e.kind === 'left' || e.kind === 'sub') {
      g.textAlign = 'left';
      e.lines.forEach((l, i) => g.fillText(l, PAD + (e.kind === 'sub' ? 16 : 0), top(i)));
    } else {
      g.textAlign = 'left';
      e.left.forEach((l, i) => g.fillText(l, PAD, top(i)));
      g.textAlign = 'right';
      if (e.right != null) g.fillText(e.right, W - PAD, top(e.left.length - 1));
      else e.rightLines.forEach((l, i) => g.fillText(l, W - PAD, top(e.left.length + i)));
    }
  }
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  if (!blob) throw new Error('Could not make the picture');
  return blob;
}

export const receiptImage = (bill, items, settings, opts) => rowsImage(receiptRows(bill, items, settings), opts);

export const billFileName = (bill) => `Bill ${bill.bill_no}.png`;
