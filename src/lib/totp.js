// Google Authenticator codes (TOTP, RFC 6238: HMAC-SHA1, 30 seconds, 6 digits).
// The owner's phone makes the code; the database checks it (see owner_unlock_with_code in 01_schema.sql).
// This file makes the secret for the setup QR code, and checks codes in the demo.

// The demo's owner code. On the real database only the owner's Google Authenticator code works.
export const DEMO_OWNER_CODE = '123456';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text) {
  const clean = String(text).toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export const toHex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

export function newSecret() {
  const b = new Uint8Array(20);
  crypto.getRandomValues(b);
  return b;
}

// The 6-digit code for a 30-second step
export async function totp(secretBytes, step) {
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[19] & 15;
  const bin = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(bin % 1000000).padStart(6, '0');
}

export const stepNow = (ms = Date.now()) => Math.floor(ms / 30000);

// Accepts the code for now, 30 seconds before or after (phone clocks drift a little).
// Returns the matching step, or null.
export async function checkTotp(secretBytes, code, afterStep = 0, ms = Date.now()) {
  if (!/^\d{6}$/.test(String(code))) return null;
  const now = stepNow(ms);
  for (const s of [now - 1, now, now + 1]) {
    if (s > afterStep && (await totp(secretBytes, s)) === String(code)) return s;
  }
  return null;
}

// What the Authenticator app scans
export function otpauthUrl(secretBytes, account, issuer = 'Habibs POS') {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${base32(secretBytes)}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}
