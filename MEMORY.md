# Habibs Fuljhore POS: changes log (memory)

What was added or changed, why, and where. Newest first. Each entry says which branch it is on and what has to be
done in Supabase for it to work. Keep this file up to date when something changes.

> **Where things stand (12 Nov 2026):** all the changes below are on the **`test` branch** only. `main` (the Live
> link) still has only the first commit. Merge `test` into `main` once they are checked on the tablet, then
> run the same SQL and function updates on the Live Supabase project.

---

## 7. WhatsApp booking bot, and the bill template made plainly "Utility"

**Branch:** `test` · **Date:** 12 Nov 2026

### Why
- Customers who message the salon's WhatsApp number should be able to book there, and every booking or question
  should be **recorded in the POS** (the data). The salon number is on the WhatsApp API, so nobody can answer it in
  the WhatsApp app. The owner chose: a menu bot, the receptionist confirms, **no chat inbox in the POS**.
- Meta filed `bill_receipt` as Marketing (wording "thank you for visiting", "₹270 off your next visit"). The
  template text and the points line are now plain account facts.

### What it does
- **The bot** (Settings → Salon & bill → WhatsApp bills → "Booking bot", off by default, setting `wa_bot_on`;
  46 settings now). Any message → "Hi Riya! Welcome to Habibs Hair & Beauty Fuljhore" with 3 buttons:
  - **Book appointment**: section → category → service (prices from the menu) → size if it has sizes (or "Not
    sure") → Add another (up to 5) or **Choose day & time** → day (next 8 open days) → time (on the hour, opening
    to an hour before closing, from the `opening_hours` setting; today only from an hour from now) → name (the
    customer's name in the POS, else "Is the booking for {WhatsApp name}?", else they type it) → summary →
    **Send request**. Only services that can be booked on the website (`show_on_website`, `book_online`).
  - The request lands in **Appointments → Requests** (source WhatsApp, `created_by = 'whatsapp'`), the customer gets
    "Request sent ✅ (ref …)", the owners get a Telegram message. Limit 3 a number a day.
  - When the counter **confirms** it (picks the time), the confirmation goes from the salon's number by itself
    ("Confirmed ✅ … Ref … address … call us to change"), and it is marked "confirmation sent". If the customer last
    wrote more than ~24 hours ago (WhatsApp's free reply window), the old "Open WhatsApp" box comes instead.
  - **Prices & offers**: today's website offers and "from ₹" prices by category; kept as an enquiry.
  - **Talk to us**: "type your question, someone will call you back"; an enquiry, a Telegram message to the
    owners; the bot stays quiet 12 hours (their messages go to Telegram and into the enquiry). **MENU** brings it back.
  - A reply to a bill, a photo or voice note: to the owners on Telegram and into the enquiry, no bot answer.
  - An enquiry (Prices / Talk to us / their words) is one per customer a week; a booking after it marks it booked.
  - Unfinished steps are forgotten after 3 hours. Everything is inside WhatsApp's 24-hour window: no charge.
- With the bot **off**: as before (messages to the owners on Telegram); the time of their last message is still kept.
- The Telegram text no longer says "reply in the WhatsApp Business app" (impossible on an API number): "Call them,
  or WhatsApp them from your phone".
- **Bill template**: new body (README 2e step 4) and `{{4}}` = "Loyalty points: 120 added, balance 270." /
  "Loyalty points: 100 used on this bill, balance 270." / "Please keep it for your records."

### Files
- `supabase/01_schema.sql`: new section at the end: table `wa_chats` (no policies: service key only), setting
  `wa_bot_on`, `wa_book(jsonb)`, `wa_enquiry(jsonb)` (service role only).
- `supabase/functions/whatsapp/index.ts`: `botReply()` (the conversation, no I/O), `botTurn()` (webhook),
  `waPayload()`, `openHours()`, `slotsFor()`, `pricesText()`, `confirmText()`, action `booking_confirm`;
  `billValues()` plain points line; `customerAnswer()` returns 'comment' for words after feedback.
- `src/pages/Appointments.jsx` (confirm → booking_confirm), `src/pages/Settings.jsx` (switch),
  `src/lib/localdb.js` (demo), `src/lib/supadb.js` (`wa_chats` key), `supabase/04_check.sql` (46), README.
- Tests: `tests/wa-bot.test.mjs` (new, 55: the whole conversation on the real menu, WhatsApp's size limits on every
  message, the webhook, confirm), `tests/menu.test.mjs` (wa_book / wa_enquiry rules), `tests/wa-api.test.mjs`.

### To make it work
1. Supabase SQL Editor: run `supabase/01_schema.sql` again (`04_check.sql` shows 46 settings).
2. Redeploy the `whatsapp` function (Verify JWT off).
3. Meta webhook connected and subscribed to `messages` (README 2e step 7).
4. Settings → Booking bot → On. Message the salon number "Hi" from your phone.

---

## 6. Change given back by UPI, and Dues (pay later)

**Branch:** `test` · **Date:** 12 Nov 2026

### Why
- Bill ₹1,950, the customer gives ₹2,000 and there's no ₹50 note: the salon keeps the note and sends ₹50 back by
  UPI. Before, the cash close showed ₹50 over and the UPI going out was nowhere.
- Bill ₹2,100, the customer has only ₹2,000: the ₹100 is owed ("udhaar"), and must be tracked and collected.

### What it does
**Change by UPI** (New bill → Cash → type the cash received): when there's change to return, a tick box
"No change: give the ₹50 back by UPI". The bill stores `change_upi`; its note says "Change ₹50 given by UPI";
"Paid by" reads "Cash (change ₹50 given by UPI)". The cash close counts the whole note in the drawer
(cash + change) and the UPI that went out (UPI − change). Bills → day totals show the same.

**Due (pay later)**:
- New bill → Cash with less cash than the bill → **"Leave ₹100 as due"** (switches to Split with Cash + Due), or
  Split → the **Due** line. Save button: "Save bill · ₹2,000 + ₹100 due".
- Needs the customer's **mobile number**. Up to **₹200** the counter can; more needs the **owner** (unlock by code or
  Telegram). The limit is in Settings → Salon & bill → "Max due without the owner (₹)" (`due_max_counter`, a new
  setting: 45 settings now). Not on past bills. Offline bills that break a rule are saved with a CHECK note.
- **Points** are earned only on the money paid (as decided), not when the due is collected.
- **The bill shows it** (screen, print, RawBT, WhatsApp): "Paid by Cash ₹2,000 + Due ₹100", "Paid now ₹2,000",
  "DUE (to pay later) ₹100", and later "Due paid since / in full".
- **Bills → Dues** tab: every bill with money still owed (customer, number, bill, how long ago, amount), the total
  owed, a WhatsApp **Remind** button (with the UPI ID), and **Collect** (part or all; cash, UPI or card).
- **New bill**: when a returning customer's number is typed, "₹100 due from before (HF…) · Collect".
- A collection counts in **the day it comes in** (cash close: cash/UPI/card, and "due collected"). If a bill is
  cancelled, its due is gone and any cash collected on it counts as given back.
- Edit bill: the payment split must add up to what was paid then (the due stays); not for a bill whose change went
  by UPI (use Correct items).

### Files
- `supabase/01_schema.sql`: `check_bill()` (due is part of the total; change only on cash), `create_bill()` (due
  rules, stores `paid_due`, `change_upi`), `cash_now()` / `close_day()` (change and collections, `due_collected`),
  `edit_bill()`; new section at the end: `bills.paid_due`, `change_upi`, `due_cleared`, `due_left` (generated),
  `cash_closes.due_collected`, table `due_payments`, `collect_due(jsonb)`; setting `due_max_counter` = 200.
- `src/lib/calc.js` (checkBill), `src/lib/cash.js` (cashNow, checkClose), `src/lib/receiptRows.js` (`payText`,
  `dueLeft`, print rows), `src/components/Receipt.jsx`, `src/pages/Billing.jsx` (tick box, Leave as due, Due line,
  owner OK, earlier dues), `src/pages/Dues.jsx` (new: Dues list, `CollectDue`), `src/pages/Bills.jsx` (Dues tab,
  day totals), `src/pages/Settings.jsx` (the limit), `src/lib/localdb.js` (demo), `supabase/04_check.sql` (45).
- Tests: `tests/db.test.mjs` (app and database checks agree; due needs a number; the limit and the owner; the
  setting; points on money only; change by UPI in the drawer and UPI; collect part, the rest, too much, a waiting
  login; edit with a due; the app's and database's cash close agree; the receipt text), `tests/loyalty.test.mjs` (45).

### To make it work
Supabase SQL Editor: run `supabase/01_schema.sql` again (then `04_check.sql` shows 45 settings). Reload the app.

---

## 5. Edit a saved bill, and Correct items (owner only)

**Branch:** `test` · **Date:** 12 Nov 2026

### Why
A receptionist in a hurry types something wrong and there was no way to fix a saved bill except cancel it.

### What it does
A bill is a tax invoice, so its **items, prices and total never change after saving**. Two owner-only buttons
on a bill (Bills → the bill), next to Cancel:

**Edit** (the bill keeps its number). The owner can change:
- **Customer name**: on the bill and the customer's record.
- **Mobile number**: the visit and the loyalty points the bill earned move to the right customer (both
  customers' visits, spend and points recalculated). Not allowed: when points were used on the bill, on a staff
  member's own bill, to a staff member's number (staff prices), or to no number when the bill earned points, or
  when the old customer already spent the points it earned. → use Correct items.
- **Who did each service**: commission in payroll follows. Not once that month's salary is marked paid to either
  the old or the new person.
- **How it was paid** (cash / UPI / card, must add up to the same total; points stay): pay mode becomes Cash, UPI,
  Card or Split. Not once that time's cash is closed (the drawer count would no longer match).
- **Note**.
- A **reason** is required. Every edit is kept in `bill_edits` (who, when, why, before → after) and shown on the bill
  under "Changed after saving".

**Correct items** (wrong service, product, price or quantity):
1. Asks what was wrong, then cancels the bill as "Corrected: …" (stock and points go back, as with any cancel).
2. New bill opens pre-filled with the same customer and items, with a "Correcting HF…" card.
3. Fix it, choose how it was paid, save: the new bill gets the next number, its note says "Replaces HF…", and
   the two are linked (`bills.replaces` / `replaced_by`); the old one shows "replaced by HF…".
Offers and points work out again as for any new bill (an offer that has ended won't apply).

### Files
- `supabase/01_schema.sql`: new section at the end: `bills.edited_at`, `replaces`, `replaced_by`; table
  `bill_edits` (app users read); `edit_bill(uuid, jsonb)` (owner_ok only). `create_bill()` links `p.replaces`
  (only a cancelled bill not already replaced).
- `src/lib/billEdit.js` (new): `editChanges()` (only what changed), `editProblem()`, `editSummary()` (history line),
  `correctionDraft()` (the New bill draft).
- `src/components/BillView.jsx`: Edit / Correct items buttons, `EditBill` form, the history, the links.
- `src/pages/Billing.jsx`: `replaces` in the draft, the "Correcting" card, `replaces` sent with the bill.
- `src/pages/Bills.jsx`, `src/App.jsx`: Correct items opens New bill.
- `src/lib/localdb.js`: demo `edit_bill`, `bill_edits`, `replaces`.
- Tests: `tests/db.test.mjs` (counter refused, reason needed, name, staff, salary paid, payments add up, split,
  cash closed, number moves visit and points, staff number refused, history, cancelled bill, correction links,
  replaced once, only a cancelled bill).

### To make it work
Supabase SQL Editor: run `supabase/01_schema.sql` again. No function to deploy. Reload the app.

---

## 4. Combo offers and the Combos tab in New bill

**Branch:** `test` · **Date:** 12 Nov 2026 · **From:** the Grand Opening + Diwali flyer (1–15 Nov)

### Why
The owner will run many combos (a set of services for one price), like the flyer's:
- Bhai Phonta Grooming ₹899 (worth ₹1,247) = Men's Haircut & Styling ₹349 + Beard Trim / Shape ₹199 + O3+ D-Tan Face & Neck ₹699
- Diwali Glow ₹1,799 (worth ₹2,248) = a ₹1,499 facial + O3+ D-Tan ₹699 + Threading Eyebrows ₹50
  (the menu has no "Lotus fruit facial": ₹1,499 is Lotus D-Tan Clean-up or O3+ Clean-up; pick or add it)
- Diwali Glow Plus ₹2,999 (worth ₹4,248) = a ₹3,499 O3+ facial + O3+ D-Tan ₹699 + Threading Eyebrows ₹50

The app had offers (% off, ₹ off, special price per service) but nothing for a set of services.

### What it does
- **Owner panel (Settings → Offers):** a new offer type **Combo**, and a "Combo" starting point. Pick the services
  (each once, at least 2), type the combo price; the form shows what they cost together and the saving. Dates,
  weekdays, hours, minimum bill and "first visit only" work as for other offers. Services with sizes, choices or
  their own typed price can't be in a combo (their price isn't fixed). The price must be below what they cost.
- **New bill → Combos tab:** shows while at least one combo is running (right after Popular). Each combo is a card:
  name, its services, the combo price, the worth crossed out and the saving. **One tap adds all its services**, each
  as its own line, so each gets its own staff member (commission, stock use and GST per service as before).
- **The price:** the combo's saving (worth − combo price) is shared across its lines in proportion to their prices,
  as the offer discount, named after the combo on the bill. It also applies by itself if the services are added one
  by one. Two full sets on one bill (two brothers) = twice. Not the whole set = no combo.
- **Best deal for the customer:** a combo is only used when it saves more than the other offers would on those same
  lines (e.g. a "50% off everything" offer beats a combo); a smaller offer still applies to the bill's other lines.
- **Staff's own bills** get staff prices, not combos (as with all offers). Combo lines earn no loyalty points (offer
  prices never do).
- **Checked by the database:** a combo discount is allowed only for whole sets, and no more than the combo price
  allows. Anything else is counted as discount: refused over the 20% limit, otherwise saved with a CHECK note
  ("… combo: not the whole set on the bill" / "… more off than the combo price allows").

### Files
- `src/lib/offers.js`: `isCombo()`, `comboWorth()`; `applyOffers()` takes combos first (whole sets, qty 1 lines,
  only when better than the line offers), `allocate()` shares the saving; `describeOffer()` describes combos.
- `src/pages/Billing.jsx`: `ComboTiles`, the Combos tab, `addCombo()`. `src/styles.css`: combo cards.
- `src/components/Offers.jsx`: Combo type, service picker with worth/saving, checks, the Combo template.
- `supabase/01_schema.sql`: `offers.kind` allows `combo` (constraint `offers_kind_check`), `offers_combo_check`
  (services, 2+), and `bill_menu_check()` checks combos per bill (whole sets, the allowed saving).
- Tests: `tests/db.test.mjs` section 12 (app: the flyer combo, order, partial set, two sets, a better offer wins, a
  smaller one still applies elsewhere, off / ended; database: clean, two sets, too much off, partial set, wrong
  service, switched off).

### To make it work
1. Supabase SQL Editor: run `supabase/01_schema.sql` again ("Run without RLS").
2. No function to deploy. Reload the app (Update).
3. Settings → Offers → Combo: create the flyer's three combos with dates 1–15 Nov (pick the facials you mean).

---

## 3. Backup reminders and WhatsApp bill failure alerts (app and Telegram)

**Branch:** `test`, commit `e6725b1` · **Date:** 12 Nov 2026

### Why
- GitHub deletes each nightly backup file after 30 days. Nobody would notice until a backup was needed.
- A bill that couldn't reach the customer on WhatsApp was only shown briefly while that bill was open, so the owner
  rarely knew.

### What it does

**Backups**
- After saving each file, the nightly GitHub job (`.github/workflows/backup.yml`) records it in a new database table
  `backups`: file name, size, the GitHub run page link, and when GitHub deletes it (made + 30 days).
- The database function `backup_status()` decides what to remind about. The app and Telegram both use it, so they
  always agree:

  | State | When | Telegram (morning message) | App |
  |---|---|---|---|
  | **due** | nothing downloaded in the last 6 days (or ever) | **Mondays only**: "this week's copy to keep" with the link | yellow bar (owner) |
  | **urgent** | nothing downloaded in 25 days **and** a backup is deleted within 5 days | **every morning**: "download one now", with the dates | red bar (owner) |
  | **stale** | the newest backup is more than 2 days old (the nightly job stopped) | every morning: "hasn't run since …, check GitHub → Actions" | red bar (owner) |

- **Settings → Data & backup → Nightly backup (GitHub):** shows the newest backup, how many GitHub still keeps,
  when one was last downloaded, an **Open the newest backup** link, and **I downloaded it**. That button records the
  download, which stops the reminders for a week.
- Only owners can see the table or the reminders. The counter login sees nothing, can't add rows and can't mark a
  backup downloaded. The website (no login) can't read it.
- Dates in Telegram are shown as dates in India (the job runs at 21:30 UTC = 3:00 AM IST the next day).

**WhatsApp bills not delivered** (needs WhatsApp Business, README 2e; the plain WhatsApp button can't be detected)
- **Telegram at once** when a send fails straight away (wrong number, not on WhatsApp, template not approved, token
  expired): "WhatsApp bill HF2627-0042 not sent to 98311 00021, reason, send it the other way from Bills".
- The existing Telegram for a failure Meta reports **later** now includes the **bill number** too.
- **POS:** a red bar for everyone at the counter for 24 hours, for bills whose newest WhatsApp send failed:
  "2 bills didn't reach the customer on WhatsApp (reason)", with **Open Bills…** and **Done** (Done hides them
  on that device). The bar goes away by itself when a bill is sent again successfully.

### Files
- `supabase/01_schema.sql`: new section at the end: table `backups` (row security, owner reads), functions
  `backup_status(timestamptz)` (internal only), `backup_alert()` (owner, for the app), `mark_backup_downloaded(uuid)`
  (owner). `day_summary()` now returns `backup`.
- `.github/workflows/backup.yml`: new step "Record the backup for the reminders" (psql insert;
  `continue-on-error`, so the backup itself is kept even if the table doesn't exist yet).
- `supabase/functions/login-approval/index.ts`: `backupLines()` adds the backup part to the morning message.
- `supabase/functions/whatsapp/index.ts`: Telegram on an immediate send failure; bill number in the later
  "not delivered" message.
- `src/lib/alerts.js` (new): `failedBills()` and `backupAlert()`, pure rules for the bars.
- `src/components/Alerts.jsx` (new): `AlertBars` (under the top bar, shown when online) and `useBackupStatus()`.
- `src/App.jsx`: shows `AlertBars`. `src/pages/Settings.jsx`: `NightlyBackups` card. `src/styles.css`: links in bars.
- Tests: `tests/db.test.mjs` (backups: states, who can see or mark, morning summary; the bar rules),
  `tests/telegram.test.mjs` (Monday / Tuesday / urgent / stale / nothing), `tests/wa-api.test.mjs` (Telegram on
  immediate failure, bill number in the later one).
- Docs: `README.md` section 8, `docs/DEPLOY.md` step 7.

### To make it work
1. Supabase SQL Editor: run `supabase/01_schema.sql` again ("Run without RLS"; `set_config: false` is normal).
2. Deploy the updated `login-approval` and `whatsapp` functions ("Verify JWT" stays off).
3. **GitHub's nightly schedule always uses the job file on `main`.** Until this is merged, recording only happens
   when the job is run by hand on the test branch: Actions → Daily database backup → Run workflow → Branch `test`.

---

## 2. Fix: face check-in (and bottle history) failed on the real database

**Branch:** `test`, commit `e083bc2` · **Date:** 11 Nov 2026

### The problem
On the tablet, face check-in failed with **"column staff_faces.id does not exist"**. The staff card always said
"Not set up", set-up failed after Start camera, and check-in couldn't load anyone's face.

### The cause
The app's list function (`src/lib/supadb.js`, `build()`) always sorted by an `id` column, so reading page by page
never skips or repeats a row. But some tables have no `id`: `staff_faces` is keyed by `staff_id`, and `unit_ends`
by `move_id`. The demo database doesn't check columns, so the tests didn't catch it. The Stock → bottle history
screen had the same hidden bug.

### The fix
- `src/lib/supadb.js`: `KEY_OF` maps each table without an `id` to its own unique key: `settings`/`counters` → `key`,
  `staff_faces` → `staff_id`, `unit_ends` → `move_id`, `app_roles` → `user_id`, `login_requests` → `session_id`,
  `owner_secrets` → `user_id`. Every other table is still sorted by `id`.
- `tests/db.test.mjs`: a check that every table in the schema without an `id` is in `KEY_OF` with a real column
  (`alerts_sent` skipped: the app never lists it). A new table without an `id` will fail this test until added.

### To make it work
App change only: no SQL to run, no function to deploy.

### Also noted: the Start camera button
It stays greyed out until the staff member's **consent box** is ticked (by design). See "How face check-in works"
below.

---

## 1. Leave on busy days (Friday to Sunday) goes to the owner instead of being refused

**Branch:** `test`, commit `12bae6b` · **Date:** 11 Nov 2026

### Why
Before, leave on Friday, Saturday or Sunday was **refused outright** unless it was medical. The owner wants to be
able to allow it (e.g. Chhath Puja) by approving it.

### What it does now
- Fri, Sat and Sun (Settings → Staff rules, `leave_blocked_days`) are **busy days**, not forbidden days.
- **Ask for leave form:** an orange note instead of the red refusal, e.g. "Fri 13 Nov, Sat 14 Nov, Sun 15 Nov: busy
  days (Friday, Saturday or Sunday). Only if the owner agrees. You can still send it; the owner decides."
  **Send to the owner** stays on.
- **Owner's request card** (Staff → Leave) shows the same busy-day note.
- **Telegram leave request** gets a line: "Busy days: Fri, 13 Nov, Sat, 14 Nov. Approve only if you agree to leave then."
- **Medical leave** is never flagged.
- **Unchanged rules** (still refuse): one person off a day; 2+ days in the last week of the month (from the 22nd)
  asked at least 14 days before. Paid days off (4 a month) still show how many days would be unpaid.
- Settings label is now "Busy days: leave only if the owner agrees". The busy days can still be changed there.

### Files
- `src/lib/leave.js`: new `busyDays()` and `busyNote()`; `leaveRuleError()` no longer refuses busy days.
- `supabase/01_schema.sql`: `leave_rule_error()` no longer refuses busy days (rule 1 is a note now); the settings
  comment updated.
- `supabase/functions/login-approval/index.ts`: `notifyLeave()` reads `leave_blocked_days` and adds the busy-day line.
- `src/pages/StaffAttendance.jsx` (form, rules list, owner's card), `src/pages/Settings.jsx` (label and hint).
- Tests: `tests/staff.test.mjs` (Fri–Sun asked, approved → L in attendance, cancel removes it; Sunday alone;
  medical not flagged; settings wording), `tests/telegram.test.mjs` (busy-day line; none for medical).
- Docs: `README.md`, `docs/STAFF.md`, `docs/DATA-MODEL.md`, `docs/TESTING.md`, `docs/DEPLOY.md`.

### To make it work
1. Supabase SQL Editor: run `supabase/01_schema.sql` again. Check with
   `select prosrc like '%not a refusal any more%' from pg_proc where proname = 'leave_rule_error';` → `true`.
2. Deploy the updated `login-approval` function.
3. On the tablet, open the **Test** link and tap **Update** (or reopen the app). The old wording means an old copy.

---

## Setup done so far (not code changes)

- Git installed; the code pushed to the private GitHub repo `KrishnaDhalla/Habibs-Fuljhore-POS`. Branches:
  `main` (Live link) and `test` (Test link).
- **Supabase Test project** (`habibs-test`): schema and seed run, users added, Telegram bot connected
  (`login-approval` deployed, webhook set, owner chat IDs added), login approval on Telegram works.
- **Cloudflare Pages** project `habibs-fuljhore-pos` (Pages, not Workers): build `npm run build`, output `dist`,
  `NODE_VERSION` = 22 (Supabase's library needs 22; the docs said 20).
  - Live: https://habibs-fuljhore-pos.pages.dev (branch `main`)
  - Test: https://test.habibs-fuljhore-pos.pages.dev (branch `test`)
  - **Both currently use the Test database** (Production and Preview variables), until the Live project is set up.
- **Nightly GitHub backup** works (secret `SUPABASE_DB_URL` = the **Session pooler** string; the direct
  `db.…supabase.co` address doesn't work from GitHub, and a password with `@` has to be written `%40`).
- Local `.env` points at the Test project (never committed).

### Still to do
- Set up the **Live** Supabase project `habibs` (schema, users, second Telegram bot), then switch Cloudflare's
  Production variables to it and point the backup secret at it.
- Merge `test` → `main` after checking the changes above on the tablet.
- Go-live checklist on the tablet: `docs/DEPLOY.md` step 6.
- Decided against copying Test data into Live later (logins, triggers, storage files and practice bills make it
  risky). Either start Live clean, or make the Test project the real one and create a new test project.

---

## How face check-in works (reference)

- Library `@vladmandic/face-api` (TensorFlow.js) with 3 small models in `public/models` (about 7 MB, loaded once,
  then kept on the tablet): face detector, 68 face points, and the face print (128 numbers).
- **Everything runs on the tablet.** No outside AI service. Only the match, its distance and a small photo go to the
  database.
- **Set-up:** consent box → 5 looks while turning the head a little → they must agree with each other and not match
  another staff member → the 5 face prints and one small photo are saved (`staff_faces`).
- **Check-in:** live-face check (a blink or a small head turn) → the closest saved person, with distance under 0.5
  (the database refuses above 0.55) and clearly closer than the next person → a check-in with a small photo.
  First scan of the day = in, a scan 30+ minutes later = out.
- **Limits:** a video of the person on a phone could pass (that's why each check-in keeps a photo for the owner).
  Light matters. Very similar faces get "not sure" rather than a wrong match.
- Code: `src/lib/face.js`, `src/components/StaffExtras.jsx` (set-up), `src/pages/StaffAttendance.jsx` (check-in).
