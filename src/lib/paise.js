// Exact money maths in whole paise (integers). No floating-point rounding slips.
// BigInt is used inside, so even a ₹10 crore bill multiplied by a rate stays exact.

// round(a × b ÷ d), half away from zero. a, b, d are integers, d > 0.
export function mulDivRound(a, b, d) {
  const n = BigInt(Math.round(a)) * BigInt(Math.round(b));
  const D = BigInt(Math.round(d));
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const q = (2n * abs + D) / (2n * D);
  return Number(neg ? -q : q);
}

// Split `total` paise across lines in proportion to `weights` (paise), largest remainder first.
// The parts always add up to exactly `total`, and no part is bigger than its weight.
export function allocate(total, weights) {
  const W = weights.reduce((a, w) => a + Math.max(0, w), 0);
  const t = Math.max(0, Math.min(Math.round(total), W));
  if (!W || !t) return weights.map(() => 0);
  const T = BigInt(t);
  const WB = BigInt(W);
  const parts = weights.map((w, i) => {
    const num = T * BigInt(Math.max(0, w));
    return { i, q: num / WB, r: num % WB };
  });
  const out = parts.map((p) => Number(p.q));
  let left = t - out.reduce((a, x) => a + x, 0);
  const order = parts.filter((p) => p.r > 0n).sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const p of order) {
    if (left <= 0) break;
    out[p.i] += 1;
    left -= 1;
  }
  return out;
}

// GST for one rate → [CGST, SGST]. An odd paisa goes to CGST. The receipt and the database both use this.
export function splitGst(gstPaise) {
  const g = Math.round(gstPaise);
  const c = g >= 0 ? Math.ceil(g / 2) : -Math.ceil(-g / 2);
  return [c, g - c];
}
