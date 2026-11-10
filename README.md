# Habibs Fuljhore — Billing (POS)

Billing, customers, staff attendance and payroll, and stock for one salon. It runs in a browser on the counter laptop or tablet, and the owner can open the same link on a phone.

- **Frontend:** React + Vite (same stack and colours as the website)
- **Database:** Supabase (PostgreSQL), region Mumbai
- **Hosting:** any free static host (Vercel, Netlify, Cloudflare Pages)
- **Running cost:** ₹0 on free plans. Hardware: an Android tablet (or laptop) and an 80 mm thermal printer.

Without a database configured, the app runs in **demo mode** with sample data saved only in that browser.

---

## 1. Try it on your computer (5 minutes)

```bash
npm install
npm run dev          # opens http://localhost:5173 in demo mode
```

Owner code in the demo: `123456` (or tap **Ask the owner on Telegram**: the demo approves by itself after 3 seconds).

## 2. Create the database (15 minutes, one time)

1. Sign up at [supabase.com](https://supabase.com) → **New project**. Name it `habibs`, region **South Asia (Mumbai)**, and save the database password somewhere safe.
2. Open **SQL Editor → New query**. Paste all of `supabase/01_schema.sql` and press **Run**. Then do the same with `supabase/02_seed_services.sql`: the printed rate chart of November 2026, 143 services in 19 categories on 10 billing tabs, with the website's pages and tabs. It is safe to run again (it puts the chart's prices back).
3. **Authentication → Sign In / Providers:** turn **off** "Allow new users to sign up". **This is important.** If it stays on, anyone who finds the app link can create an account and read your customer list.
4. **Authentication → Users → Add user → Create new user:** make one login for the counter (e.g. `counter@habibsfuljhore.in`) and one for yourself. Tick "Auto confirm user".
   Then put your email in `supabase/03_owners.sql` and run it, and run `supabase/04_check.sql`: every line should match its "should be" column.
5. **Project Settings → API Keys:** copy the **Project URL** and the **publishable / anon public** key. Never use the `service_role` / secret key in this app.
6. In this folder, copy `.env.example` to `.env` and paste the two values:

```
VITE_SUPABASE_URL=https://xxxxxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...   (or sb_publishable_...)
```

Run `npm run dev` again. It now asks for a login and saves to Supabase.

## 2b. Login and owner approval on Telegram (20 minutes, one time)

The same bot handles two things: approving new logins, and approving owner actions at the counter (see 2c).

Owners sign in straight away. Every other login (the counter tablet, any staff) waits on a "Waiting for the owner to approve" screen. The owners get a Telegram message with **Approve** and **Deny** buttons, and the tablet opens by itself after an owner taps Approve. Until then the database gives that login no data at all. Each new sign-in needs a new approval. A tablet that stays signed in stays approved, even offline.

1. **Mark the owners.** In SQL Editor, open `supabase/03_owners.sql`, put your owner emails in it, and Run. It lists the owners at the end. Check yours are there.
2. **Make the bot.** In Telegram, open **@BotFather**, send `/newbot`, name it e.g. *Habibs Billing*, and copy the **token** it gives you.
3. **Add the approval function.** Supabase → **Edge Functions → Deploy a new function → Via editor**. Name it `login-approval`, paste all of `supabase/functions/login-approval/index.ts`, and Deploy. In the function's **Settings**, turn **off** "Verify JWT" (the function checks every caller itself).
   *With the Supabase CLI instead:* `npx supabase functions deploy login-approval --no-verify-jwt`
4. **Add the secrets.** Supabase → **Edge Functions → Secrets**:
   - `TELEGRAM_BOT_TOKEN`: the token from BotFather
   - `TELEGRAM_WEBHOOK_SECRET`: any long random text, using only letters, numbers, `_` and `-`
   - `TELEGRAM_OWNER_CHAT_IDS`: leave for step 6
5. **Connect the bot to the function.** Open this link in a browser, with your values filled in. It should say *Webhook was set*.
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<PROJECT-REF>.supabase.co/functions/v1/login-approval&secret_token=<WEBHOOK_SECRET>
   ```
   `<PROJECT-REF>` is the part before `.supabase.co` in your Project URL.
6. **Each owner sends `/start` to the bot.** The bot replies with that person's chat ID. Put all the owners' IDs in `TELEGRAM_OWNER_CHAT_IDS`, separated by commas (e.g. `123456789,987654321`).
7. **Test it.** Sign in on the tablet with the counter login. Your phone gets the Telegram message with the same 4-letter code shown on the tablet. Tap Approve and the tablet opens.

**No Telegram, or it's down?** An owner can sign in to the app on their phone. A red **"1 to approve"** button appears at the top, for logins and for requests from the counter. **Settings → Logins** lists every login, with **Remove access** to throw a device out straight away.

## 2c. Owner approval: only you can unlock (10 minutes, one time)

Reports, settings, salaries, product prices, stock corrections, cancelling a bill and discounts above the limit need an owner. There is no PIN to share or overhear. Two ways, both need the owner's phone:

- **From anywhere, Telegram:** the counter taps **Ask the owner on Telegram**. You get a message saying exactly what is asked, e.g. *Cancel bill HF2627-0042 · ₹2,400 · reason: wrong service*, and tap **Approve** or **Deny**. A cancel or a discount approved this way works for that one bill only. A request not answered in 15 minutes expires.
- **At the counter, Google Authenticator:** you type the 6-digit code from your phone. Owner screens open on that tablet for 10 minutes (or until **Owner → Lock**). Each code works once and changes every 30 seconds, so seeing it is no use later. 5 wrong codes block codes on that login for 15 minutes.

Set-up for each owner, once:
1. Install **Google Authenticator** on your phone.
2. On your phone, open the billing link and sign in with **your owner login** (not the counter login).
3. **Settings → Owner unlock → Set up Google Authenticator**. Tap **Add to Authenticator** (or scan the QR from another screen), then type the code it shows and tap **Finish set-up**.

Good to know:
- Your own owner login never needs approval. **Don't leave the counter tablet signed in with an owner login.**
- The database checks every approval itself, so going around the app (e.g. through the API) doesn't work either.
- Approval needs internet. Without internet the counter keeps billing, with discounts up to the limit.
- **Settings → Owner unlock** shows every request and unlock: who asked, what, and who approved it.

## 2d. Connect the website (optional)

The website can read the menu, prices, offers and salon details from this database, and send booking requests into it, with only the public key. Change a price here and the website shows it. How: `docs/WEBSITE.md`. The tables and how the two share them: `docs/DATA-MODEL.md`.

## 2e. WhatsApp bills: sent by themselves (optional, about an hour, plus Meta's approval)

With this on, every bill goes to the customer's WhatsApp by itself after saving: the bill picture (the same as the printed bill) and a short message with the total and their points, from the salon's WhatsApp Business number. The bill shows **Sent ✓**, **Delivered ✓✓** or **Read**, and Bills shows the same. If it can't go (a number not on WhatsApp, say), the bill says why and the old **WhatsApp** button (2 taps) still works. Customers' replies come to the owners on Telegram.

**Cost:** Meta charges per bill delivered: a "utility" message, about **₹0.145 + 18% GST** in India (Meta's rate from 1 October 2026; check WhatsApp Manager → Pricing). 1,500 bills a month ≈ ₹260. Nothing else to pay; no provider in between.

**The number.** Use a number just for this (a new SIM is easiest): once it is on the WhatsApp Business Platform it can't also be used in the WhatsApp app on a phone. (Meta's "coexistence" lets an existing WhatsApp Business app number do both, but it is set up through a Meta partner, so this guide uses a separate number.) Customers' replies reach you on Telegram anyway.

1. **Meta app.** Sign in at developers.facebook.com with the Facebook account that runs the salon's Meta Business account. **My Apps → Create app → Business**, then add **WhatsApp**. Pick (or create) the salon's business.
2. **Add the number.** WhatsApp → **API Setup → Add phone number**: the display name *Habibs Hair & Beauty Fuljhore* (Meta checks it), category Beauty, the number, the code by SMS. Copy the **Phone number ID** shown there.
3. **Payment.** WhatsApp Manager (business.facebook.com/wa/manage) → **Payment methods**: add a card.
4. **The bill template.** WhatsApp Manager → **Message templates → Create template**: category **Utility**, name `bill_receipt`, language **English**.
   - Header: **Image** (upload any bill picture as the sample)
   - Body (exactly, with the 4 variables):
     `Hi {{1}}, thank you for visiting Habibs Hair & Beauty Fuljhore. Your bill {{2}} for ₹{{3}} is in the picture above. {{4}} Reply here if anything on the bill is not right.`
   - Samples: {{1}} `Ananya`, {{2}} `HF2627-0042`, {{3}} `3,300`, {{4}} `You earned 120 loyalty points, balance 270 = ₹270 off your next visit.`
   - Footer: `Habibs Hair & Beauty · Fuljhore, Durgapur`
   Submit. It is usually approved within minutes to a few hours. If Meta marks it **Marketing**, it costs more: keep the wording as above (a bill is a utility message).
5. **A token that doesn't expire.** business.facebook.com → **Settings → Users → System users → Add** (admin). **Assign assets**: the app and the WhatsApp account, full control. **Generate token**: the app, permissions `whatsapp_business_messaging` and `whatsapp_business_management`, expiry **Never**. Copy it.
6. **The function.** Supabase → **Edge Functions → Deploy a new function**: name `whatsapp`, paste all of `supabase/functions/whatsapp/index.ts`, Deploy, and turn **off** "Verify JWT" (Meta can't send a Supabase login; the function checks every caller itself). CLI: `npx supabase functions deploy whatsapp --no-verify-jwt`. Then **Edge Functions → Secrets**:
   - `WHATSAPP_TOKEN`: the token from step 5
   - `WHATSAPP_PHONE_ID`: the Phone number ID from step 2
   - `WHATSAPP_APP_SECRET`: the app's **App secret** (App settings → Basic → Show)
   - `WHATSAPP_VERIFY_TOKEN`: any long random text (letters and numbers)
   - only if the template's language shows as *English (US)*: `WHATSAPP_TEMPLATE_LANG` = `en_US`
7. **Delivery ticks and replies (the webhook).** In the Meta app: WhatsApp → **Configuration → Webhook → Edit**: Callback URL `https://<PROJECT-REF>.supabase.co/functions/v1/whatsapp`, Verify token = your `WHATSAPP_VERIFY_TOKEN`, **Verify and save**. Then under Webhook fields, **Subscribe** to `messages`. Switch the app to **Live** (App settings: it asks for a privacy policy link, e.g. a page on your website).
8. **Switch it on.** In the app: **Settings → Salon & bill → WhatsApp bills → On**, Save, and tap **Check the WhatsApp setup**: it shows the number, its name and quality. Make a bill to your own number to try it.

**At the counter** there is one tick on the bill, **Send the bill on WhatsApp to …**, on by itself. Ask the customer ("Shall we WhatsApp you the bill?") and untick it if they don't want it: Meta expects customers to agree to messages. A bill saved without internet goes when it uploads. From **Bills**, a bill can be sent by hand (**Send on WhatsApp**, or **Send again**: at most 3 times a bill). Bills older than 30 days aren't sent.

## 2f. WhatsApp: automatic messages (optional; needs 2e first)

Three messages the app sends by itself from the salon's WhatsApp Business number, each switched on in **Settings → Salon & bill → WhatsApp: automatic messages**:

| Message | When | Who gets it |
|---|---|---|
| **How was your visit?** with three buttons: Loved it · It was okay · Not happy | 2 hours after the bill (Settings) | Every customer with a number on the bill; not staff bills or past bills; one request a customer in 30 days |
| **Booking reminder** | 3 hours before a confirmed booking (Settings) | The customer who booked (booked at least an hour before) |
| **We miss you** | 45 days after the last visit (Settings) | Only customers who agreed to offers on WhatsApp, with no booking coming up; once each time they stay away; at most 20 a day |

Nothing goes between 9 pm and 9 am. A customer who replies **STOP** gets no more of them (bills still go); **START** turns them on again.

**What happens with the answer.** The answer is saved under **Customers → Feedback**. "Loved it" gets a thank-you with your **Google review link**. "It was okay" is asked what could be better. "Not happy" gets an apology, and **you get a Telegram message at once** with the customer, the bill and who did the service; call them, then tap **Dealt with** in the app. By default the review link goes to everyone who answers, because Google's rule is to ask all customers and not only the happy ones; Settings can limit it to "Loved it". What the customer writes after answering is kept with the answer. The replies are free (inside WhatsApp's 24-hour window).

**Set up.**

1. Put your review link in Settings → **Google review link** (Google Business Profile → *Ask for reviews* → copy the link).
2. In WhatsApp Manager → Message templates, create these three (language English) and wait for Meta to approve them:
   - `visit_feedback` (Utility). Body: `Hi {{1}}, thank you for visiting Habibs Hair & Beauty Fuljhore. How was your visit? Tap an answer below.` Buttons: three **Quick reply** buttons with exactly these words: `Loved it`, `It was okay`, `Not happy`.
   - `booking_reminder` (Utility). Body: `Hi {{1}}, a reminder of your appointment at Habibs Hair & Beauty Fuljhore: {{2}}, for {{3}}. Reply here if you need to change the time.`
   - `we_miss_you` (Marketing). Body: `Hi {{1}}, it has been a while since your last visit to Habibs Hair & Beauty Fuljhore. {{2}} Reply here to book your slot. Reply STOP to stop these messages.`
3. Run `supabase/01_schema.sql` again and redeploy the `whatsapp` function.
4. Switch on the ones you want in Settings.

They go while the app is open on any tablet (it asks every 20 minutes). To have them go with the app closed too, run `supabase/05_daily_schedule.sql` (section 2g): the database then asks every 30 minutes. Each message goes once, whichever asks.

**Cost.** Meta charges per message delivered: reminders and feedback requests at the utility rate (like a bill), "We miss you" at the marketing rate, which is several times higher. Check Meta's rate card for India before switching "We miss you" on; the daily limit keeps the cost known. If Meta files `visit_feedback` under Marketing when approving it, it is charged at that rate.

## 2f-2. WhatsApp: the salary slip to staff (optional; needs 2e first)

**Staff → Payroll → Mark paid** sends that person their salary slip on WhatsApp by itself: a picture with the full breakup (monthly salary, day rate, days off taken / not taken / above the allowance, absent and half days, days worked, salary, sales, commission, incentive, advances, deductions, **net pay**, how and when it was paid), to the mobile number in Staff list. The row then shows **Slip sent ✓ / delivered ✓✓ / read**; the paper-plane button sends it again (at most 3 times). If it can't be delivered the owners get a Telegram message. Only an owner login can send a slip, and it only ever goes to that staff member's own number. Switch: Settings → Salon & bill → WhatsApp bills → **Send the salary slip to staff when salary is marked paid** (on to start with).

One more template in WhatsApp Manager (category **Utility**, name `salary_slip`, language English):
- Header: **Image** (upload any slip picture as the sample)
- Body: `Hi {{1}}, your salary for {{2}} at Habibs Hair & Beauty Fuljhore has been paid: ₹{{3}} by {{4}} on {{5}}. The full breakup is in the picture above. Tell the owner if anything is not right.`
- Samples: {{1}} `Priya`, {{2}} `October 2026`, {{3}} `18,450`, {{4}} `UPI`, {{5}} `1 Nov 2026`

Then run `supabase/01_schema.sql` again and redeploy the `whatsapp` function. Another template name: secret `WHATSAPP_TEMPLATE_SLIP`. Until the WhatsApp API is connected, the same button opens WhatsApp on the device with the slip typed as a message (tap Send).

## 2g. The morning message at 9:00 and the WhatsApp schedule (optional, 5 minutes)

The morning Telegram message (leave today and tomorrow, leave waiting, today's bookings, who didn't check in, on Mondays everyone's leave this week, and the planning messages for leave coming up) goes the first time the app is opened each day. To get it at 9:00 every day instead, even when the salon is closed: follow the 3 steps at the top of `supabase/05_daily_schedule.sql` (turn on two extensions, add a `CRON_SECRET`, run the file).

## 3. Put it online (10 minutes, free)

**Going live for the first time? Follow `docs/DEPLOY.md`: every step in order, the check before deploying (`npm run preflight`), the first-day test, updates and going back.**

The app is only static files; your data lives in Supabase. Any static host works.

**Cloudflare Pages** (recommended: free, commercial use allowed, no bandwidth limit):
1. Push this folder to a private GitHub repo.
2. dash.cloudflare.com → **Workers & Pages → Create → Pages → Connect to Git** → pick the repo.
3. Framework preset **Vite** (build command `npm run build`, output folder `dist`).
4. Under **Environment variables** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` → **Save and Deploy**.
5. **Custom domains** → add e.g. `billing.habibsfuljhore.in`. The page has `noindex`, so Google will not list it.

`public/_headers` adds security headers on Cloudflare Pages and Netlify (no framing by other sites; scripts and connections only from the app and Supabase). If you ever connect the app to a database that isn't on `supabase.co`, add its address to `connect-src` there.

Every push to GitHub redeploys by itself, and the counter shows an **Update** button.

Netlify's free plan works the same way. Vercel works too, but its free Hobby plan is for non-commercial use only, so a business would need Vercel Pro. Hostinger or any shared hosting also works: run `npm run build` and upload the contents of `dist/` to the subdomain's folder (repeat for every update).

## 4. First day at the salon

1. Open the link on the counter laptop and sign in with the counter login.
2. **Set up Google Authenticator** for each owner (section 2c).
3. **Settings → Salon & bill:** add the GSTIN (if registered), your UPI ID (for the payment QR), and check the bill preview.
4. **Staff → Staff list:** add every staff member with salary and commission %. Then open each person on the **counter tablet**: **Face check-in → Set up** (tick that they agree, they look at the camera and turn their head slowly, about 5 seconds), and add their **Documents** (Aadhaar, PAN, bank details…). For Aadhaar, upload the **masked Aadhaar** from the UIDAI website (only the last 4 digits show). See `docs/STAFF.md`.
5. **Stock → Add product:** add retail products with opening stock, and every costly salon-use item (colour, developer, spa cream, keratin, wax, facial kits) with its type. Then **Stock → Used in** for each one: the usual services are ticked for you; untick what doesn't use it, Save. Read `docs/STOCK-CONTROL.md` and set up the locked store and the empty-for-full rule.
6. In Chrome, open the menu → **Cast, save and share → Install page as app** so it opens like an app with its own icon.

## 5. When the internet goes down

Billing keeps working. Nothing to switch on.

- The red bar says **No internet**. Keep billing as usual. Returning customers are still recognised, because the counter keeps a copy of the menu, staff and customer list.
- Bills made offline get their own numbers, like `HF2627-A0001` (A = this device), and print normally. GST allows more than one invoice series as long as each one runs in order without gaps. Ask your CA to approve it along with the bill format.
- A **"3 to upload"** button appears at the top. When the connection is back, the bills upload by themselves within 30 seconds, and customer visits and stock update. Tap the button to see the list or upload straight away.
- The app even opens with no internet, as long as it was opened once with internet on that device.
- Bills, Customers and New bill work offline. Staff (face check-in too), Stock, Reports and Settings need internet. If the internet is down when staff arrive, the owner marks the day by hand later.
- **Don't clear browser data or sign out while bills are waiting to upload.** The app blocks sign-out until the list is empty.
- **Two billing devices?** Give each one its own letter in **Settings → Data & backup → This device** (A, B …), so offline numbers never clash.

Prevention is still the best plan: a 4G router with a SIM slot that switches over automatically, or a phone hotspot at the counter.

## 6. Running on a tablet

Use an **Android tablet** (10 inch or bigger, for example a Samsung Galaxy Tab A or Lenovo Tab) with **Chrome**. The app works in landscape and portrait.

1. Open the app link in Chrome and sign in.
2. Chrome menu (⋮) → **Add to home screen → Install**. The app then opens full screen from its own icon, without the address bar.
3. Tablet **Settings → Display → Screen timeout**: set 10 minutes or more, and keep the charger connected at the counter.
4. Turn off **auto-rotate** if the tablet sits on a stand.
5. **Face check-in** uses the tablet's front camera: the first time, Chrome asks to allow the camera. Tap **Allow**. Put the tablet where faces are well lit (not with a window behind the person).

**Printing from the tablet (one tap)**

1. Buy an 80 mm thermal printer with **Bluetooth** (or USB with an OTG cable). Pick one sold as "Android compatible / ESC/POS".
2. Install **RawBT** from the Play Store. In RawBT, connect the printer and print its test page. Turn on auto-cut if the printer has a cutter.
3. In the app: **Settings → Data & backup → Receipt printing on this device → RawBT app**, then **Print a test receipt**.

From then on, **Print** on any bill prints straight away. The tablet receipt is plain text with "Rs." instead of ₹, because most thermal printers can't print the rupee sign.

**iPad?** It works for billing, but cheap Bluetooth thermal printers don't print from an iPad. Use WhatsApp bills, or buy an AirPrint receipt printer (much more expensive). Android is the better choice.

## 7. Receipt printer on a Windows laptop

Any 80 mm USB thermal printer with a Windows driver works.

1. Install the printer driver and make it the **default printer** in Windows.
2. Print a test bill from the app. In Chrome's print window choose the printer, **Margins: None**, untick **Headers and footers**. Chrome remembers this.
3. **One-click printing (optional):** make a Chrome shortcut with `--kiosk-printing` added to the end of its Target. Bills then print straight away without the print window.

## 8. Backups

The free Supabase plan does not include backups, so set up both of these:

- **Daily, automatic:** `.github/workflows/backup.yml` dumps the whole database every night at 3 AM to your private GitHub repo's Actions tab (kept 30 days). Add one secret first: GitHub repo → **Settings → Secrets and variables → Actions → New repository secret**, name `SUPABASE_DB_URL`, value = Supabase **Connect → Session pooler** connection string with your password filled in. Use **Actions → Daily database backup → Run workflow** once to test it.
- **Weekly, by hand:** **Settings → Data & backup → Download full backup** and keep the file on Google Drive.

When the salon is busy enough, the Supabase Pro plan (US$25/month) adds daily backups and removes the free-plan pause after 7 days of no use.

## How things work

| Topic | How it works |
|---|---|
| Bill numbers | `HF2627-0001`: prefix + financial year + running number. Resets every April 1. Made by the database, so two devices can never get the same number. |
| GST | Off until a GSTIN is entered. Salon services are charged at 5% (2.5% CGST + 2.5% SGST, no input tax credit). Products use their own rate. Choose in Settings whether menu prices include GST. Have your CA check the bill once. |
| Offers | **Settings → Offers.** Set an offer once: dates (e.g. Durga Puja 16–21 Oct), weekdays (every Tuesday), hours (11 am–3 pm), which services (everything, a section, a category or chosen services), and % off, ₹ off or a special price. Optional: minimum bill, a cap ("up to ₹500 off"), first visit only. Checkout applies it by itself only while it is running, shows the offer on the tile, the bill, the receipt and WhatsApp, and Reports shows what each offer brought in. Two offers on one service: the customer gets whichever gives the bigger total saving, with caps taken into account. Offers never stack on one line. Switch an offer off any time without deleting it. |
| Discounts | Two kinds, used together or alone. **On one item:** tap **Discount** under the item on the bill: 5%, 10%, 20%, or type a % or ₹ amount (₹ is off that whole line). It shows on the bill, the printed receipt and WhatsApp under that item. **On the whole bill:** the Discount buttons below the items, on what is left after offers and item discounts, spread across the lines so GST and commissions stay correct. Above the limit in Settings (20% to start), counting item and bill discounts together, the owner must approve (section 2c). Loyalty points are earned on what is paid after discounts. |
| Bill maths | Worked out in whole paise, so nothing is lost to rounding. Offers come off first, then each item's own discount, then the discount on the whole bill. GST per line: prices including GST → taxable value = price ÷ 1.05; GST extra → GST = price × 5%. CGST and SGST are the two halves of each GST rate (an odd paisa goes to CGST), exactly as printed. The total is rounded to the nearest rupee (50 paise goes up) and the difference is shown as round off. |
| Bill checks | Before a bill is saved, the app checks that every line and total adds up to the paisa and that the payments equal the total. The database runs the same check again and refuses a bill that doesn't add up, so a wrong bill can never be stored. It also checks every price against the menu and every offer discount against the offer's rules: anything below the menu or more than the offer allows counts as a discount (needs the owner above the limit) and the bill gets a "CHECK:" note. |
| Past bills | **Owner only.** On the bill screen, **Past bill** (the owner signs in or types the Authenticator code at the counter; an unlock on Telegram isn't enough). Enter the day and time, and the paper bill's number if there is one; type each price as the paper bill says. It gets its own number series, **HF2627-P0001, P0002 …** (in the financial year of its date), so today's numbers stay in date order for GST. No offers or points used on it; the customer earns points as usual. It counts in that day's sales, reports, staff commission (payroll for that month) and stock; the note says when and by whom it was typed in, and Bills marks it "Past bill". Up to 400 days back, never in the future, and only with the internet. |
| Mistakes | Bills are never edited or deleted. The owner cancels the bill (with a reason) and a new one is made. Products go back into stock. The database enforces this: a signed-in login can read bills but cannot change or delete a saved bill, its lines, the bill counter or stock history, even through the API. |
| WhatsApp bill | **WhatsApp** on a bill sends it as a **picture**, the same as the printed bill (items, offers, GST, total, points). WhatsApp links can carry only text, so it is two taps: **1. Open the chat** (a short message with the total and points goes to the customer's number, so the chat is at the top) and **2. Send the bill picture** (the tablet's Share → WhatsApp → that chat → Send). On a laptop, where Share can't send pictures: **Copy the bill picture** and paste it in WhatsApp Web or Desktop (Ctrl+V), or **Save picture**. **Send as text instead** sends the old text bill. With **WhatsApp bills** on (section 2e), the button is **Send on WhatsApp**: one tap sends the bill through the API, nothing to open, and the app says "Bill sent on WhatsApp ✓", then "Delivered ✓✓" (the owners get a Telegram message if it can't be delivered). Each bill also goes by itself after saving, from the salon's WhatsApp Business number, and the bill shows Sent ✓, Delivered ✓✓ or Read (or why it couldn't go). |
| Display (dark mode, bigger text) | The **Display** button at the top (sun and moon) changes this tablet only, with no owner code: **Light**, **Dark** or **Same as the tablet** (follows the tablet's own dark mode), and text **Normal**, **Large** or **Larger** (the whole app grows, buttons too, and rearranges itself so nothing goes off the screen). Dark is made for older eyes: soft off-white text on a warm dark grey (not black, which makes white text look blurry and glowing), every word at least 7 times brighter than its background (the highest WCAG level, AAA), grey notes and labels kept bright, slightly thicker letters, and the main buttons light with dark writing so they stand out. Printed bills, the WhatsApp bill picture, payslips and the UPI QR stay white. |
| Customers | One record per mobile number, created automatically when a bill is saved: name, gender, "OK to send offers on WhatsApp". ("How did they hear about us?" and birthday were taken off in November 2026; what was saved before stays in the database.) Visits, total spend and loyalty points update with every bill. |
| Loyalty points | 1 point = ₹1. **Earned:** 5% of what the customer pays with cash, UPI or card for services at their normal price (₹1,000 facial → 50 points), whole points rounded down. Nothing on offer prices, products, what points pay, or a staff member's own number. (A prepaid card isn't in the app yet; when it comes, what it pays won't earn either, because only cash, UPI and card earn.) **Used:** once the customer has 100 points, up to 20% of a bill: on the bill, tick **Pay with points** (the most allowed is filled in; type less if they want), and the rest is paid as usual. Points are a payment, so prices, GST and staff commission don't change. **Expire** 12 months after the last visit. Points need the internet to be used (so the same points can't be spent twice); bills made offline still earn. The bill, the printed receipt and the WhatsApp message show the points earned, used, the balance and until when it is valid. Cancelling a bill gives back the points used on it and takes off the ones it earned. **Customers** shows each balance, the points not yet used in ₹, a **Points to use** filter (for a WhatsApp reminder; the customer's WhatsApp button mentions their points), and each customer's points history. Reports shows points earned and paid in the period. All of it in **Settings → Salon & bill → Loyalty points**. The database works out the points itself and nobody can type a balance. |
| Face check-in | **Staff → Attendance → Face check-in.** The person looks at the tablet and turns their head a little (or blinks), so a photo held up doesn't work; they are marked **present** and a small photo is kept with the time. Scanning again 30 minutes or more later checks them out (the last scan is when they left). The camera stays open for the next person. The face is matched on the tablet: only the match and the small photo are sent. Someone else's face can't be set up as yours (the app refuses a face that already belongs to another person). |
| Attendance | Someone with face check-in who didn't check in is **flagged** ("Not checked in", and in the morning Telegram message); they count as present until the owner marks the day. Marking by hand (present, half day, absent, week off, leave) is for the owner: **Mark by hand** asks for the owner's OK. Someone without face check-in counts as present unless marked. Each check-in's photo can be opened from the list. |
| Leave | **Staff → Leave → Ask for leave**: who, from, to, kind (planned, medical, personal), reason. It shows the rules and what the leave does to their paid days off. The owners get it on Telegram with **Approve / Deny** (or approve in the app). Approved days become **L** in attendance by themselves; cancelling the leave takes them off. **Planning:** for each approved leave, a Telegram message **7, 3 and 1 days before** (change the days in Settings → Salon & bill → Staff): who, which days, the bookings given to them on those days (time, customer, number, services) to give to someone else, who else is off then, and how many staff are in; also at once when leave starting within a week is approved; on **Mondays** the morning message lists everyone's leave that week. Reminders: a red number on Staff while leave is waiting; "On leave today / tomorrow" on Attendance; the morning Telegram message (leave today and tomorrow, leave waiting, today's bookings, who didn't check in yesterday); Bookings shows who is on leave that day and warns when a booking is given to them; **Tell** / **Remind** sends the staff member a WhatsApp. |
| Leave rules | The owner's rules (November 2026), checked by the database for every request, so the counter can't get round them: **no days off on Friday, Saturday or Sunday**; **one person off a day** (a request is refused if anyone else has leave asked or approved, or a week off or leave marked, that day); **2 or more days off in the last week of the month (from the 22nd) must be asked 14 days before** (a single day is fine). **Medical** leave is the exception to all three: it can always be asked, the owner still approves it, and the form and the Telegram message say who else is off those days. The form shows the rules and the reason a request can't be sent ("Only one person can be off a day: Amit Das is off on Thu 12 Nov"). Change them in **Settings → Salon & bill → Staff** (the days, one person a day yes/no, the notice). |
| Expenses | **Bills → Expenses → Add expense**: the amount, what it was for (tea, cleaning, laundry, supplies, repairs, electricity, rent …), paid from the **cash drawer**, UPI, bank or the owner's pocket, and a note. The counter adds today's; an earlier day and removing one are for the owner (a removed expense stays in the list, marked). The page shows the day, how much came from the drawer, and the month by kind. Reports shows **Expenses** and **Sales less expenses** for any period. Stock purchases and salaries are not expenses here (they are in Stock and Payroll). |
| Cash close | **Bills → Cash close**, every evening. The app says what **should be in the drawer**: what was left at the last close + cash from bills since − cash bills cancelled since − expenses paid from the drawer. Count the drawer **by notes** (how many ₹500, ₹200 …) or type the total. It shows **Matches**, **Short ₹…** or **Over ₹…**; a difference above ₹10 (Settings) needs a note. Say how much stays in the drawer for tomorrow; the rest is taken out. Closing sends the owners a **Telegram summary**: sales by cash, UPI and card, expenses, the drawer sum, short or over, the note, taken out. A bill after closing is counted in tomorrow's close. One close a day; counting again is for the owner. The database works the figures out itself and keeps them, so a close can't be edited later. |
| Feedback and automatic WhatsApp | See section 2f: "How was your visit?" after a bill with the Google review link, booking reminders, "We miss you". Answers are under **Customers → Feedback** (unhappy ones first, with Call, WhatsApp and Dealt with), with the list of automatic messages sent and how each went. |
| Paid days off and day rate | Week offs (W) and leave (L) share **4 paid days off a month** (Settings; less for a part month). **Day rate = monthly salary ÷ (days in the month − 4)**: ₹20,000 in a 30-day month = ₹769.23 a day. **Salary = day rate × days worked.** So taking exactly 4 days off pays the full salary; each day off **not taken is paid one day more** (3 off → ₹20,769); each day off **above 4 is one day less** (6 off → ₹18,462). Days off don't carry over to next month. Payroll shows each person's day rate, days off taken of 4, "+N off not taken: paid" or "N off above 4: not paid", and the salary slip says the same. |
| Staff's own services | A bill on a staff member's **own mobile number** (as in Staff list) is their own bill: **Hair, Threading and Waxing are free**, **every other service is 50% off** (colour, treatments, hair spa, facials, D-tan, nails, makeup), **products at the normal price**, no offers and no points. On the bill screen: **Staff's own service? Choose who**, or type their number. The staff price is automatic and can't be changed at the counter, shows as "Staff price: free" or "Staff price −50%" on the line, the bill and the receipt, and doesn't count toward the discount limit (a discount on top of it still does). **Whoever does the service earns their commission on the full price**, as if a customer had paid. Bills marks the bill "Staff". The database checks the staff price and refuses a wrong one (a bill made offline is saved with a CHECK note). Change the free tabs and the % in Settings → Salon & bill → Staff. |
| Staff documents | Staff list → a person → **Documents**: Aadhaar (only the last 4 digits are kept as the number), PAN (checked), photo, bank details, address proof, certificates, agreement. Photos are made smaller before upload; PDFs up to 5 MB. Kept in private storage that only the owner can open. |
| Payroll | Day rate × days worked (see Paid days off and day rate), + commission % on each person's sales (after discount, without GST; a staff member's own service counts at its full price), + incentive − advances − deductions. Days worked run from the joining date to the last working day (set when someone leaves), less days off, absent days and half of half days. Pay never goes below ₹0: advances bigger than the month's pay are carried to next month as an advance. "Mark paid" saves the salary slip. **Mark paid** also sends the person their salary slip on WhatsApp (section 2f-2). |
| Rate chart and tabs | The menu is the printed rate chart of November 2026 (`src/data/menu.js` → `supabase/02_seed_services.sql`). Billing has a tab for each part of it: **Hair · Colour · Hair Spa · Hair Treatments · Facials · D-Tan · Threading · Waxing · Nails · Makeup & Bridal** (a tab shows only when it has services; **Beauty** is there for anything else you add). Inside a tab, services are grouped as on the printed page (Men / Women, Lotus / O3+, Raaga / O3+, Body / Men / Peel-off). The brand is in the name ("Raaga D-Tan Full Arms", "O3+ Clean-up"), so each product's Bottle check counts only its own services. |
| Hair length and thickness | "Onwards" prices: the printed price is for shoulder-length hair (S); M (below shoulder), L (waist) and XL (below waist) are ₹500 more each, picked at billing. That is hair treatments (smoothening, keratin, kera smoothening, botox, nanoplastia) and women's colour (global, ammonia-free, highlights, ombre, sombre, balayage). Hair treatments also have **Hair thickness**: Thick +₹500. The bill line reads e.g. "Nanoplastia (L · Thick)" = ₹7,499. Men's smoothening (short hair) is a fixed ₹1,999. Root touch-up is **from ₹1,299** (ammonia-free from ₹1,499): the counter types the final price; women's hair spa, keratin wash and the extra-thick highlights add-on work the same way from their printed price. A price typed below the printed one counts as a discount (the owner's OK above the limit). Change any of it in Settings → Services & prices. |
| Services & prices | **Settings → Services & prices.** Services sit in categories; each category also says where it goes on the website (page, tab, description). **Adding** a service or category is for the owner only: signed in as the owner, or the owner types the Authenticator code at the counter (the counter can't ask on Telegram for a new one). Every change to a service or category needs the owner's OK for that exact change ("Men Cut and Styling: price ₹600 → ₹549", on Telegram), even while owner screens are open, unless you are signed in as the owner or typed the Authenticator code at the counter. **Change history** lists every change with before, after, who and who approved. Services are hidden, never deleted, so old bills keep their names. |
| Website | The website reads the same menu, offers and salon details through one public function (`web_site`) and sends bookings and questions through two others (`request_booking`, `request_enquiry`). The public key can't read or write any table. See `docs/WEBSITE.md`. |
| Bookings | **Bookings** in the menu (a red number shows requests and enquiries waiting). **Day**: every booking by time, filter by stylist, booked / to confirm / came / no-show. **Requests**: website and Instagram bookings and ones taken without a time; **Confirm** adds the time and stylist. **New booking** for WhatsApp, phone and walk-in customers (search the service, pick the hair length and thick hair, the price comes from the menu); a clash with the stylist's other bookings is shown. **Send confirmation** and **Send reminder** open WhatsApp with the message typed (services, prices, address, map, ref). **Start bill** opens the normal bill with the number and services; when the bill is saved the booking is marked **Came** by itself — any bill for that number that day does it, so billing has no extra step. No-show and cancel (with a message offered). **Enquiries**: questions from WhatsApp, calls, Instagram and the website; **Reply with prices** (from the menu), **Book**, **Follow up** (tomorrow, 3 days, next week, shown as due), **Close** with the reason; someone billed within 30 days is marked Came. Website bookings and questions also come to the owners on Telegram. |
| Stock | Every change is a row in `stock_moves` (stock in, taken out, sold, corrected, returned). The product's stock count updates by itself. Selling a product on a bill takes it out of stock. |
| Product prices | Enter the **MRP** and the **supplier discount** (e.g. 40% off MRP): the cost works out by itself (or type the cost and the discount works out). A different discount on a delivery can be entered at **Stock in**. The selling price can't be more than the MRP. Each product has a **note** the counter can change. |
| Finished | **Finished** on a product puts it on the **To buy** list (shareable on WhatsApp) and tells the owner on Telegram. If the app still shows some in stock, they are written off as missing, which needs the owner. The next Stock in takes it off the list. |
| Stock control | **Bottle check: how many services each bottle lasted.** Tick once which services use each salon product (Stock → **Used in**; suggested for you). Every tube, jar, bottle or kit leaving the store is recorded with **Give out**: who took it, and what happened to the one in use (finished with the empty back, finished without it, or still in use: a second one). Costly ones, or ones without the empty, need the owner's approval. The services billed while each one was in use are its uses (long and thick hair count more), so **Bottle check** shows every bottle against normal (your number, or learned from the first 3), flags the ones that finished early with the ₹ not explained by bills, who took them, and services billed while none was given out. **Billing doesn't change**: nothing extra at the counter. **Used without a bill** records redos, staff's own services, family and training, so they count. Each product has its **size of one** (typed as printed: 1 L, 800 ml, 60 g); a delivery in another pack size is kept at Stock in, and a 500 ml bottle is expected to do half. At the weekly count, how full the one in use is gets checked against the bills (**running fast**). A bottle is flagged only when it is a whole service short; the same person twice is highlighted. Telegram tells the owner when a bottle finished early (and whether it happened before), when the last sealed one goes out, when the one in use is almost finished with none in the store, when a service is billed with none in use (taken without Give out?), and each use without a bill. **Count stock** records the weekly count and what is missing in ₹. The rules to go with it: `docs/STOCK-CONTROL.md`. |
| Login approval | Owners (listed in `app_roles`) sign in freely. Every other sign-in needs an owner's approval on Telegram or in the app. The database checks this on every request, so an unapproved login sees nothing, even through the API. |
| Owner approval | Reports, settings, payroll, salaries, product prices, stock corrections, bill cancelling and big discounts need an owner: Telegram Approve, or the Google Authenticator code (section 2c). Service and price changes ask every time (see Services & prices). The database enforces it: without approval, a counter login can't change settings, prices, offers, staff, salaries, payslips or products, can't cancel a bill, and can't save a discount above the limit. Reading is not locked at the database level (the counter needs customers and bills to work), so the owner screens hide reports from the counter but a technical person with the counter login could still read data through the API. |
| Internet | Not needed for billing (see section 5). Every bill carries its own id from the moment it is started, so a double tap, a retry or a reply lost on a bad connection still saves it once. Offers are checked against the clock again at the moment of saving. |
| App updates | After you deploy a new version, an **Update** button appears at the top of the counter screen. Tap it between customers. |

## Where to change things

| What | Where |
|---|---|
| Prices and services (app and website) | In the app: **Settings → Services & prices** |
| Opening hours, WhatsApp number, Maps link for the website | In the app: **Settings → Salon & bill** |
| Salon name, address, GSTIN, UPI ID, bill footer | In the app: **Settings → Salon & bill** |
| Colours and font | Top of `src/styles.css` |
| Tables and bill logic | `supabase/01_schema.sql` |
| Bill maths and payroll maths | `src/lib/calc.js` |
| Screens | `src/pages/*.jsx` |

## Folder map

```
supabase/01_schema.sql         tables, bill functions, security, ready-made views
supabase/02_seed_services.sql  the rate chart: 143 services (made from src/data/menu.js; also upgrades the October menu)
supabase/03_owners.sql         marks which logins are owners
supabase/functions/login-approval/  Telegram Approve / Deny for staff logins and owner approvals
supabase/functions/whatsapp/        WhatsApp bills: sends the bill picture with the bill template; Meta's delivery ticks and replies
supabase/05_daily_schedule.sql      optional: the morning Telegram message at 9:00 every day
scripts/preflight.mjs               npm run preflight: the last check before deploying (docs/DEPLOY.md)
src/lib/slipRows.js                 the salary slip, line by line (printed, WhatsApp picture, text)
src/lib/db.js                  picks demo or Supabase
src/lib/supadb.js              Supabase connection
src/lib/localdb.js             demo database in the browser
src/lib/offline.js             offline billing: copy of data on the device, waiting bills, upload
src/lib/textReceipt.js         plain-text receipt for tablet printing (RawBT)
src/components/Logins.jsx      owner's list of logins to approve
src/lib/calc.js                GST, discount and payroll maths, and the bill check
src/lib/paise.js               exact money helpers (whole paise)
src/lib/totp.js                Google Authenticator codes (set-up QR, demo check)
src/components/OwnerUnlock.jsx owner approval window (Telegram / code) and the owner's request list
tests/                         money and database tests: npm test
tests/fixtures/                the October 2026 schema, to test upgrading an older database
src/pages/                     New bill, Bills, Customers, Staff, Stock, Reports, Settings
.github/workflows/backup.yml   nightly database backup
docs/ARCHITECTURE.md           how this fits the Customer Intelligence System
docs/DATA-MODEL.md             the tables, ER diagrams (er-*.svg), who may do what
docs/WEBSITE.md                connecting the website: menu, offers, bookings, questions, WhatsApp buttons
src/pages/Appointments.jsx     Bookings: day list, requests, enquiries, WhatsApp messages, start bill
src/lib/bookings.js            booking prices, the visit link, WhatsApp texts (same rules as the database)
docs/TESTING.md                what was tested, problems found and fixed
docs/STOCK-CONTROL.md          the Bottle check and the 7 stock rules
src/data/usage.js              starting amounts of product per service
src/lib/stockcheck.js          Bottle check: normal, finished early, almost finished, by person
src/lib/units.js               how many uses each bottle served (the same as product_units() in the database)
src/pages/StaffAttendance.jsx  Attendance (face check-in camera, flags, marking by hand) and Leave
src/components/StaffExtras.jsx face check-in set-up and staff documents (Staff list → a person)
src/lib/face.js                face matching, blink / head turn, camera (the face models load only on the tablet that checks in)
src/lib/leave.js               leave days, the leave rules, paid days off, days without a check-in, WhatsApp texts
src/lib/staffPrice.js          a staff member's own services: free or 50% off (same check as the database)
src/lib/whatsapp.js            WhatsApp bills: the bill picture to the whatsapp function, and how each send went
src/lib/loyalty.js             loyalty points: earned, how many can be used, expiry, the lines on the bill and WhatsApp
src/lib/receiptRows.js         the bill line by line (as printed), and the short WhatsApp message
src/lib/receiptImage.js        draws the bill as a picture (PNG) for WhatsApp
src/lib/display.js             dark mode and bigger text on this tablet (saved in this browser)
src/components/DisplayModal.jsx the Display window: colours and text size
docs/STAFF.md                  face check-in, leave and documents: how they work and their limits
```

`npm run build:demo` makes the one-file demo in `dist-demo/`.

**Tests.** `npm test` checks the money logic in about a minute: about 3.4 million checks on random bills (GST in and out of the price, mixed rates, offers with caps, discounts, staff prices, rounding), payroll for every kind of month (day rate, paid days off taken or not), loyalty points over 15 months of random bills (the database and the demo agree to the point), face matching and the photo-or-real-face check, leave, and the real database schema in memory (bill numbers, stock, customers, cancelling, offline uploads, refused wrong bills, the menu and its approvals, the website's functions, bookings, face check-in and leave rules, and upgrading an October 2026 database). Run it after any change to `src/lib/calc.js`, `src/lib/offers.js` or `supabase/01_schema.sql`, and before deploying.

To try offline billing without Supabase: `VITE_FAKE_CLOUD=1 npm run build && npm run preview`, open it, then switch the browser to offline in DevTools (Network → Offline).

Already ran `01_schema.sql` before an update (offline billing, login approval, offers, bill checks, owner approval, categories and the website, the Bottle check, bookings, face check-in and leave)? Run it again, then redeploy the `login-approval` function with the new `index.ts`. It is safe to re-run: it adds what's new and keeps your data. On a database made before November 2026 it also makes the service categories from your services and fills in their website fields; on one that already has give-outs, the first run after 6 Nov 2026 works out which bottle each give-out replaced, so the Bottle check starts with your history. Don't run `02_seed_services.sql` again.

**Rate chart (November 2026) on the live database.** Run `01_schema.sql` again, then `02_seed_services.sql`. A service that is the same as before keeps its row ("Fruit Facial" becomes "Lotus Hydravitals Facial (Dry Skin)", "Root Touch Up" becomes "Root Touch-up"), so old bills, bookings, special-price offers and Stock → Used in stay linked. Services in the chart's categories that aren't on the printed pages (regular wax, bleach, head massage oils, blow-dry styles, add-on masks …) are hidden, not deleted: switch one back on in Settings → Services & prices if you still do it. Offers made for an old category or tab move to the new ones ("20% off Hair" covers Hair, Colour, Hair Spa and Hair Treatments). Nails and Makeup & Bridal keep their prices. Every change is in the change history. Then check Stock → each salon product → **Used in**: new services (Wella and Streax spas, O3+ D-tan, Kera Smoothening …) start unticked.

