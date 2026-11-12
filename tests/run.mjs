// npm test — runs the money tests. Run it after every change to the bill maths, offers, payroll or the database.
//   tests/maths.test.mjs    bill maths, GST, discounts, offers, rounding, the save-time check (millions of random bills)
//   tests/payroll.test.mjs  salary, joins and leaves, half days, leap years, commission, advances
//   tests/stock.test.mjs    Bottle check: how many services each bottle lasted, normal, finished early, by person
//   tests/telegram.test.mjs the Telegram approval function, with fake Telegram and Supabase
//   tests/loyalty.test.mjs  loyalty points: earning, using, cancelling, expiry, who may change them (demo = real database)
//   tests/whatsapp.test.mjs WhatsApp, one tap: reading a booking pasted from WhatsApp, the daily stock message to staff
//   tests/wa-api.test.mjs  WhatsApp bills through the WhatsApp Business Platform: sending, limits, Meta's webhook
//   tests/staff.test.mjs    face check-in, leave and paid days off, and their database rules (demo = real database)
//   tests/menu.test.mjs     one menu for the app and the website: categories, approvals for every change, the website's
//                           public API, bookings, products marked finished, upgrading the October database
//   tests/db.test.mjs       the real database (supabase/01_schema.sql) in memory: bill numbers, stock,
//                           customers, cancelling, offline uploads, refused wrong bills, read-only bills,
//                           give-outs and the Bottle check (database and app count the same), stock alerts
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const suites = ['maths', 'payroll', 'stock', 'db', 'menu', 'staff', 'loyalty', 'telegram', 'whatsapp', 'wa-api', 'wa-bot'].filter((s) => !process.env.ONLY || process.env.ONLY.split(',').includes(s));
mkdirSync('tests/.out', { recursive: true });
let failed = 0;
for (const s of suites) {
  await build({
    entryPoints: [`tests/${s}.test.mjs`], bundle: true, platform: 'node', format: 'esm',
    outfile: `tests/.out/${s}.mjs`, external: ['@electric-sql/pglite', '@vladmandic/face-api'], logLevel: 'warning',
  });
  console.log(`\n— ${s} —`);
  const r = spawnSync(process.execPath, [`tests/.out/${s}.mjs`], { stdio: 'inherit', env: { N: '20000', ...process.env } });
  if (r.status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) FAILED` : '\nAll money tests passed');
process.exit(failed ? 1 : 0);
