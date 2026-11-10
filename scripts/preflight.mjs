// npm run preflight — the last check before putting the app online (docs/DEPLOY.md, step 7).
//   1. .env: the two values are there, the address is a Supabase project, the key is the public one (never the secret)
//   2. npm test: every money, database and message test
//   3. npm run build: the real app (not the demo)
//   4. the built files: the database address is in them, no secret is, the security headers and the offline worker are there
// "npm run preflight -- --no-tests" skips step 2 (when the tests have just been run).
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

let bad = 0;
const ok = (name, pass, fix = '') => { console.log(`${pass ? '✓' : '✗'} ${name}${pass || !fix ? '' : `\n    → ${fix}`}`); if (!pass) bad++; return pass; };
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;

// ---- 1. .env (on Cloudflare Pages the same two values are typed under Environment variables) ----
const env = { ...process.env };
if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split(/\r?\n/)) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/); if (m && !(m[1] in process.env)) env[m[1]] = m[2].replace(/^["']|["']$/g, ''); }
const url = env.VITE_SUPABASE_URL || '', key = env.VITE_SUPABASE_ANON_KEY || '';
console.log('\n1. The database address and key');
ok('VITE_SUPABASE_URL is set', !!url, 'Copy .env.example to .env and paste the Project URL (README, section 2, step 6).');
ok('…and is a Supabase project address (https://xxxx.supabase.co, nothing after it)', /^https:\/\/[a-z0-9]{15,}\.supabase\.co$/.test(url), `It is "${url}". Copy the Project URL exactly, without a / at the end.`);
ok('VITE_SUPABASE_ANON_KEY is set', !!key, 'Paste the publishable / anon public key.');
export function keyRole(k) {
  if (/^sb_secret_/.test(k)) return 'service_role';
  if (/^sb_publishable_/.test(k)) return 'anon';
  try { return JSON.parse(Buffer.from(k.split('.')[1], 'base64url').toString()).role || '?'; } catch { return '?'; }
}
const role = keyRole(key);
ok('…and is the PUBLIC key (anon / publishable), not the secret one', role === 'anon', role === 'service_role'
  ? 'STOP: this is the service_role / secret key. Anyone opening the app could read and change everything. Use the anon / publishable key, and make a new secret key in Supabase (this one has been on this computer in a file the app reads).'
  : 'This does not look like a Supabase key. Copy it again from Project Settings → API Keys.');
if (key.split('.').length === 3 && url) {
  let ref = ''; try { ref = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).ref || ''; } catch { /* checked above */ }
  if (ref) ok('…of the same project as the address', url.includes(ref), 'The key and the address are from two different Supabase projects.');
}
ok('.env is not going to GitHub (.gitignore has it)', existsSync('.gitignore') && /^\.env$/m.test(readFileSync('.gitignore', 'utf8')), 'Add a line ".env" to .gitignore.');

// ---- 2. the tests ----
if (!process.argv.includes('--no-tests')) {
  console.log('\n2. The tests (about 2 minutes)');
  ok('npm test: everything passes', run('npm', ['test']), 'Do not deploy. Send the lines marked ✗ to whoever looks after the app.');
} else console.log('\n2. The tests: skipped (--no-tests)');

// ---- 3. the build ----
console.log('\n3. Building the app');
const built = bad === 0 && ok('npm run build', run('npm', ['run', 'build']));
if (bad && !built) console.log('  (not built: fix the lines above first)');

// ---- 4. what was built ----
if (built) {
  console.log('\n4. The built files (dist/)');
  const files = [];
  const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else files.push(p); } };
  walk('dist');
  const text = files.filter((f) => /\.(js|html|css|json|webmanifest|txt)$/.test(f) || /_headers$|_redirects$/.test(f)).map((f) => [f, readFileSync(f, 'utf8')]);
  const all = text.map(([, t]) => t).join('\n');
  ok('the app is connected to your database (not the demo)', all.includes(url));
  const secrets = [
    [/sb_secret_[A-Za-z0-9_-]{8,}/, 'a Supabase secret key'],
    [/\b\d{8,10}:AA[A-Za-z0-9_-]{30,}/, 'a Telegram bot token'],
    [/\bEAA[A-Za-z0-9]{60,}/, 'a WhatsApp (Meta) access token'],
  ];
  const jwts = all.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g) || [];
  const found = secrets.filter(([re]) => re.test(all)).map(([, n]) => n);
  if (jwts.some((j) => keyRole(j) === 'service_role')) found.push('the Supabase service_role key');
  ok('no secret key or token is in the files the browser gets', found.length === 0, 'Found: ' + found.join(', ') + '. Do not deploy; take it out of .env and the code, and make new ones.');
  const headers = existsSync('dist/_headers') ? readFileSync('dist/_headers', 'utf8') : '';
  ok('security headers are there (dist/_headers: no framing, scripts only from the app, connections only to Supabase)', /Content-Security-Policy:.*script-src 'self'.*connect-src 'self' https:\/\/\*\.supabase\.co/.test(headers) && /X-Frame-Options: DENY/.test(headers));
  ok('Google will not list the billing app (noindex)', /noindex/.test(readFileSync('dist/index.html', 'utf8')) && /X-Robots-Tag: noindex/.test(headers));
  ok('works without internet (sw.js) and installs on the tablet (manifest, icons)', ['sw.js', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png'].every((f) => existsSync(join('dist', f))));
  ok('page links work after a reload (dist/_redirects)', existsSync('dist/_redirects'));
  const size = files.reduce((a, f) => a + statSync(f).size, 0);
  console.log(`  ${files.length} files, ${(size / 1048576).toFixed(1)} MB`);
}

console.log(bad ? `\n${bad} thing(s) to fix before deploying.` : '\nReady to deploy: push to GitHub (Cloudflare Pages builds it), or upload the dist/ folder.');
process.exit(bad ? 1 : 0);
