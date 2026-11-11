# Deployment: from this folder to the salon counter

Everything in order, once. The README has the detail for each step (section numbers given); this page is the route, the checks between steps, and what to do later for updates and when something goes wrong.

**What runs where**

| Piece | Where it lives | Cost |
|---|---|---|
| The app (static files) | Cloudflare Pages, built from your private GitHub repo | Free |
| The database, logins, the two functions | Supabase, region Mumbai | Free plan to start |
| Owner approvals, alerts | A Telegram bot | Free |
| Bills, slips and automatic messages on WhatsApp (optional) | Meta WhatsApp Business Platform | Per message |
| Nightly backup | GitHub Actions | Free |

**Two copies: Test and Live.** Make two Supabase projects, `habibs-test` and `habibs`. Bills can never be deleted (only cancelled), so every practice bill belongs in Test, and Live starts clean at bill `0001`. Updates are tried on Test first, always.

**Time:** about 3 hours for steps 1 to 9, without WhatsApp. WhatsApp adds an hour plus Meta's approval wait; do it after the salon is running on the app.

---

## Before you start

- [ ] A computer with **Node.js 20 or newer** and **Git** (`node -v`, `git --version`)
- [ ] Accounts: **GitHub**, **Supabase**, **Cloudflare**, **Telegram** (each owner)
- [ ] The Xiaomi Pad 5, charged, with Chrome updated
- [ ] An 80 mm Bluetooth thermal printer (optional on day one; WhatsApp bills work without it)
- [ ] The owners' email addresses, and a password manager or notebook for the passwords and keys below

## Step 1. The code, on your computer and on GitHub (15 min)

```bash
unzip habibs-pos.zip && cd habibs-pos
npm install
npm test              # about 2 minutes; the last line must say "All money tests passed"
npm run dev           # http://localhost:5173 opens in demo mode; look around, then Ctrl+C
```

Then make a **private** repo on GitHub (`habibs-pos`) and push:

```bash
git init && git add . && git commit -m "Habibs billing"
git branch -M main
git remote add origin https://github.com/<you>/habibs-pos.git
git push -u origin main
git checkout -b test && git push -u origin test      # the Test copy is built from this branch
git checkout main
```

`.env` is in `.gitignore`, so keys never go to GitHub. Check on GitHub that the repo says **Private**.

## Step 2. The two databases (30 min) — README section 2

Do all of this **twice**: first for `habibs-test`, then for `habibs`.

1. supabase.com → **New project**, region **South Asia (Mumbai)**. Save the database password.
2. **SQL Editor**: run `supabase/01_schema.sql`, then `supabase/02_seed_services.sql`.
3. **Authentication → Sign In / Providers**: turn **off** "Allow new users to sign up". *Do not skip this.*
4. **Authentication → Users → Add user** (tick Auto confirm): one login per owner, and one for the counter tablet (e.g. `counter@…`). Use long passwords.
5. Put the owners' emails in `supabase/03_owners.sql` and run it.
6. Run `supabase/04_check.sql`. **Every line's "found" must equal "should be"** (19 categories, 143 services, 10 tabs, 44 settings, 0 tables without row level security, 1 or more owners).
7. **Project Settings → API Keys**: note the **Project URL** and the **publishable / anon** key of each project.

> **The one rule about keys.** Only the publishable / anon key ever goes into the app, `.env`, GitHub or Cloudflare. The `service_role` / secret key is never copied anywhere: Supabase gives it to the two functions by itself.

## Step 3. Telegram approvals (20 min) — README section 2b

1. @BotFather → `/newbot` → copy the token. (One bot serves both projects only one at a time, so make **two bots**: *Habibs Billing* and *Habibs Billing Test*.)
2. In each Supabase project: **Edge Functions → Deploy a new function**, name `login-approval`, paste `supabase/functions/login-approval/index.ts`, Deploy, and turn **off** "Verify JWT".
3. **Edge Functions → Secrets**: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (long random text).
4. Open the `setWebhook` link from the README (it must answer *Webhook was set*).
5. Each owner sends `/start` to the bot; put the chat IDs in `TELEGRAM_OWNER_CHAT_IDS`.

## Step 4. Check on your computer against Test (10 min)

```bash
cp .env.example .env        # then paste the TEST project's URL and publishable key into .env
npm run preflight
```

`npm run preflight` is the gate. It checks that the address and key are right and that the key is the **public** one, runs every test, builds the app, and looks through the built files for anything secret. It must end with **"Ready to deploy"**. If a line shows ✗, it says what to do; don't go on until it is fixed.

Then `npm run dev`, sign in with the counter login, and approve it on Telegram: the first real end-to-end check.

## Step 5. Put it online (20 min) — README section 3

1. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → the repo.
2. Production branch `main`. Framework preset **Vite**: build command `npm run build`, output folder `dist`.
3. **Settings → Environment variables**:

   | Variable | Production (branch `main`) | Preview (branch `test`) |
   |---|---|---|
   | `VITE_SUPABASE_URL` | the `habibs` URL | the `habibs-test` URL |
   | `VITE_SUPABASE_ANON_KEY` | the `habibs` publishable key | the `habibs-test` publishable key |
   | `NODE_VERSION` | `20` | `20` |

4. **Save and Deploy.** You now have two links: the live one (`habibs-pos.pages.dev`) and the test one (`test.habibs-pos.pages.dev`).
5. **Custom domains** → add e.g. `billing.habibsfuljhore.in` to Production.

Open the live link in a private window and check: it shows the **login** screen (not the demo banner), and the address bar shows the padlock.

## Step 6. The go-live test, on the Test link (45 min)

Do this on the Pad 5 with the **Test** link, counter login. Tick each line. This is the part no automatic test can do for you: your real tablet, printer, network and phones.

**Login and owner**
- [ ] Sign in at the counter → "Waiting for the owner" → Telegram message with the same 4-letter code → Approve → the tablet opens
- [ ] A wrong password is refused; a login you Deny stays out
- [ ] Each owner: sign in on your own phone → Settings → Owner unlock → set up Google Authenticator (README 2c)
- [ ] At the counter: open Reports → the code from your phone opens it; **Owner → Lock** closes it

**A bill, start to finish**
- [ ] New bill: your own mobile number, 2 services with different staff, 1 product → Cash → Save → bill `HF2627-0001`
- [ ] Print (if the printer is set up, README section 6) and the WhatsApp button
- [ ] A second bill with a discount above 20% → asks the owner → approve on Telegram
- [ ] A split payment (part cash, part UPI): the UPI QR shows your UPI ID
- [ ] Cancel the first bill → needs the owner → it shows Cancelled; stock and points go back
- [ ] Bills → Expenses: add one. Bills → Cash close: count the drawer and close the day → Telegram message

**Offline**
- [ ] Turn the tablet's Wi-Fi off → red "No internet" bar → make a bill (number `…-A0001`)
- [ ] Wi-Fi on → "1 to upload" clears by itself within 30 seconds; the bill is in Bills

**Staff**
- [ ] Staff list: add one person with your number; set up their face; check in with the camera
- [ ] Ask for leave on a Friday → "busy day" shown, it can still be sent → Telegram says "Busy day" → Approve → L in attendance
- [ ] Payroll (last month) → Mark paid → the slip prints

**The rest**
- [ ] Bookings: New booking → Start bill → the booking turns to Came
- [ ] Stock: Add product, Stock in, a give-out
- [ ] Reports: today's figures equal the bills you made
- [ ] Display → Dark, and Large text; turn the tablet upright and back: nothing off the screen
- [ ] Chrome menu → **Add to home screen → Install**; open it from the icon

Anything that fails: note the screen and the red message, fix it, run the list again from that section. **Don't go live with a line unticked.**

## Step 7. Backups, before any real bill (15 min) — README section 8

- [ ] GitHub repo → Settings → Secrets and variables → Actions → `SUPABASE_DB_URL` = the **Live** project's Session pooler connection string
- [ ] Actions → *Daily database backup* → **Run workflow** → green tick, and a `.dump` file under Artifacts
- [ ] In the app (owner): **Settings → Data & backup → Nightly backup** shows that backup; download it, tap **I downloaded it**
- [ ] In the app: Settings → Data & backup → Download full backup works

## Step 8. Fill in Live (1–2 hours) — README section 4

On the **live** link, owner login:

- [ ] Settings → Salon & bill: name, address, GSTIN (if registered), UPI ID, bill footer; look at the bill preview. Have your CA see one bill.
- [ ] Settings → Services & prices: glance through the rate chart
- [ ] Staff list: everyone, with mobile number, salary, commission %; face set-up on the counter tablet; documents
- [ ] Stock: products with opening stock; **Used in** for salon-use items
- [ ] Settings → Offers, Loyalty points, Staff rules, Cash close: as you want them
- [ ] Each owner: Google Authenticator on Live too (it is a separate project)

## Step 9. The counter tablet (15 min) — README section 6

- [ ] Open the **live** link in Chrome, sign in with the **counter** login (never an owner login), approve on Telegram
- [ ] Add to home screen → Install; allow the camera when asked
- [ ] Tablet settings: screen timeout 10 minutes or more, charger connected, auto-rotate as you prefer
- [ ] Printer: RawBT, then Settings → Data & backup → Receipt printing → Print a test receipt
- [ ] Remove the Test link's icon from the tablet, so nobody bills into Test by mistake

**You are live.** Make the first real bill with a real customer.

## Step 10. Later, when billing is settled: WhatsApp and the schedule

In this order, each on Test first:

1. **WhatsApp bills** (README 2e): the Meta app, the number, the `bill_receipt` template, the `whatsapp` function and its 4 secrets, the webhook. Settings → Check the WhatsApp setup.
2. **Salary slips** (README 2f-2): the `salary_slip` template.
3. **Automatic messages** (README 2f): the Google review link, the three templates, then switch on one at a time. Check Meta's price for "We miss you" first.
4. **The 9:00 message and the 30-minute WhatsApp schedule** (README 2g): `supabase/05_daily_schedule.sql`.
5. **The website** (README 2d, `docs/WEBSITE.md`).

One WhatsApp number can't serve Test and Live at once. Try WhatsApp on Test with Meta's free test number (the Meta app → WhatsApp → API Setup gives one), then point the real number at Live.

---

## Where every secret lives

| Secret | Where it is typed | Never in |
|---|---|---|
| Supabase publishable / anon key, Project URL | `.env` on your computer; Cloudflare environment variables | (public by design) |
| Supabase `service_role` / secret key | Nowhere. Supabase hands it to the functions itself | The app, `.env`, GitHub, Cloudflare, chats |
| Database password / connection string | GitHub Actions secret `SUPABASE_DB_URL`; your password manager | The repo's files |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_OWNER_CHAT_IDS` | Supabase → Edge Functions → Secrets | The app, GitHub |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | Supabase → Edge Functions → Secrets | The app, GitHub |
| `CRON_SECRET` | Supabase secrets, and inside `05_daily_schedule.sql` when you run it (don't commit the filled-in file) | GitHub |
| Owner and counter passwords, Authenticator | Each person's own phone / password manager | Shared notes, WhatsApp |

If a secret is ever pasted somewhere it shouldn't be: make a new one in the same place (BotFather `/revoke`, Meta → System users → new token, Supabase → API Keys → rotate) and replace it in Supabase secrets. `npm run preflight` refuses to pass if the secret Supabase key, a Telegram bot token or a Meta token is in the built app.

## Updating the app later

Always the same order, **database → functions → app**, and **Test before Live**. The schema file only adds (tables, columns, settings); it never drops data, and it is safe to run again. An older app keeps working on a newer database, so nothing breaks in between.

1. Put the new files in your folder. `npm install`, then `npm test`.
2. **Test:** SQL Editor → run `supabase/01_schema.sql` (and `02_seed_services.sql` only if the rate chart changed) → `04_check.sql`. Redeploy a function if its file changed (paste the new `index.ts`, Deploy; "Verify JWT" stays off).
3. `git checkout test`, `git add . && git commit -m "what changed"`, `git push`. Cloudflare builds the Test link in about 2 minutes. Try the changed feature there, plus one bill start to finish.
4. **Live, outside salon hours:** download a backup first (Settings → Data & backup). Then the same SQL and functions on `habibs`, and `git checkout main && git merge test && git push`.
5. On the counter tablet an **Update** button appears; tap it (not in the middle of a bill).
6. Make one real bill and watch it through.

## Going back

| Problem | What to do |
|---|---|
| The new version of the app misbehaves | Cloudflare → the project → **Deployments** → the previous one → **Rollback to this deployment**. Takes a minute; the tablet shows Update again. The database doesn't need undoing. |
| A function misbehaves after redeploying | Paste the previous `index.ts` (from GitHub history) and Deploy. The app keeps billing meanwhile; approvals by Google Authenticator code still work without Telegram. |
| Data was damaged or lost | Stop billing on the app (write bills on paper). Restore last night's backup into a **new** Supabase project: `pg_restore --clean --no-owner -d "<connection string>" habibs-YYYY-MM-DD.dump`. Check it, then change the two Cloudflare variables to the new project and redeploy. Enter the paper bills as past bills (owner only). |
| The tablet is lost or broken | Settings → Logins → **Remove access** for it, from your phone. Sign in on another device with the counter login and approve it. Nothing is stored only on the tablet except bills waiting to upload. |
| Supabase says the project is paused | Free projects pause after 7 days with no use. Supabase dashboard → **Restore**. A salon open daily never hits this; a long closure can. |

## When something doesn't work

| What you see | Usual reason |
|---|---|
| The live link shows "Demo with sample data" | The two Cloudflare variables are missing or misspelt (they must start with `VITE_`). Fix, then **Retry deployment**: variables are read when building. |
| Login says invalid, for a correct password | The user was made in the other project (Test vs Live), or "Auto confirm" wasn't ticked. |
| "Waiting for the owner" and no Telegram message | The webhook wasn't set (open the `setWebhook` link again), `TELEGRAM_OWNER_CHAT_IDS` is empty, or "Verify JWT" is still on for the function. Meanwhile: owner signs in on a phone → **1 to approve**. |
| "This login is not approved yet" on every screen | The approval was denied or removed. Sign out and in again, and approve. |
| Blank page after an update | An old copy is cached: close the app fully and open it again; if still blank, Chrome → Site settings → Clear & reset for the link (**only when "to upload" is empty**). |
| `04_check.sql` shows a different number of settings | An older `01_schema.sql` was run. Run the current one again. |
| Face check-in: no camera | Chrome → Site settings → Camera → Allow for the link. The link must be `https`. |
| WhatsApp: "The bill template … isn't approved yet" | The template is still in review in WhatsApp Manager, or its language is *English (US)*: add the secret `WHATSAPP_TEMPLATE_LANG` = `en_US`. |
| WhatsApp ticks never change from Sent | The webhook isn't connected or not subscribed to `messages` (README 2e, step 7), or the Meta app isn't Live. |

## Every month

- [ ] GitHub → Actions: the nightly backup has green ticks
- [ ] Settings → Data & backup → Download full backup → Google Drive (weekly is better)
- [ ] Settings → Logins: remove devices and people that shouldn't be there
- [ ] Supabase → Reports: database size (the free plan has 500 MB; this app uses a few MB a year, staff documents and check-in photos more)
- [ ] WhatsApp Manager: the number's quality is green, and the month's cost
