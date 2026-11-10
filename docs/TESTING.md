# Money testing — October 2026

The app was tested at four levels (and the staff features at their own levels, below). Every check passes on the current code.

| Level | What | Checks |
|---|---|---|
| Bill maths (`tests/maths.test.mjs`) | Random bills: 1–12 lines, prices from ₹0.01 to ₹99,999.99, quantities, GST 0 / 2.5 / 5 / 12 / 18 / 28%, GST included or extra, offers (including bigger than the line), % and ₹ discounts (including more than the bill). Every figure is compared with a separate calculation in whole paise. Offers are compared with trying every possible combination. | ~2.6 million per run (56 million over 5 long runs) |
| Payroll (`tests/payroll.test.mjs`) | Random staff, months (Feb in leap and non-leap years, 30/31-day months), joining and leaving dates, absent, half, week-off and leave days, paid days off (week offs and leave above the monthly number are unpaid), advances, commission | ~236,000 |
| Database (`tests/db.test.mjs`) | The real `01_schema.sql` in an in-memory PostgreSQL. 300 random bills are saved through the database and the demo database side by side and compared. Also covered: cancelling, sending the same bill twice, offline numbers and clashes, bills uploaded out of order, a tablet with a wrong clock, deleted staff, products or offers, 14 kinds of wrong or tampered bills, edit or delete attempts, logins waiting for approval, the financial-year change on 1 April, and re-running the schema | ~11,600 |
| Screens (Playwright, not in `npm test`) | The real app in Chrome: mixed-GST bill with a split payment in paise, triple tap on Save, wrong and right owner code, a discount bigger than the bill, capped offers, GST extra with cash change, cancelling, and an offer ending at the moment of saving. Bills page, Reports, both CSV files and Payroll are reconciled against the saved bills. Also: offline bills, a reply lost mid-save, a reload while offline, upload, payroll for someone who left and advances carried to next month. Older screen tests (tablet layouts, login approval, offers) are run again too. | ~80, plus the earlier screen tests |

Run `npm test` after any change to the money code (about a minute).

## Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 1 | With an "up to ₹X" offer, the line took the offer with the bigger uncapped saving, even when the cap made it worth less | Customer could get, e.g., ₹100 off instead of ₹500 (in about 1 in 6 random test carts) | Offers are now picked for the biggest total saving after caps |
| 2 | CGST/SGST were split once for the whole bill, but the receipt split them per GST rate | With 5% and 18% on one bill, printed CGST/SGST could differ by 1 paisa from the stored GST figures | Split per rate everywhere, so receipt, database and reports match |
| 3 | Rounding of values ending in 5 paise, e.g. 81.335, sometimes went down; negative values rounded the wrong way | Off by 1 paisa on GST, discount or taxable value in roughly 1 in 100 random test bills | All maths in whole paise; half paise round up |
| 4 | The counter discount was spread over the lines, with the last line taking the leftover. If that line was free because of an offer, the leftover was lost | Discount on the lines could differ from the bill's discount by 1–2 paise | Exact split: the lines always add up to the discount |
| 5 | A new bill id was made on every press of Save | A retry after a dropped reply, or a page reload during saving, could save the bill twice | The id is fixed when the bill is started and kept with the draft |
| 6 | Happy-hour and offer prices were rechecked only every 30 seconds | A bill saved just after an offer ended could still get the offer | The clock is checked again at Save, and the counter is told if the total changed |
| 7 | The database trusted the totals sent by the app | A faulty or tampered app could store a bill that doesn't add up | `create_bill` checks every line and total to the paisa and refuses wrong bills |
| 8 | Any approved login could edit or delete saved bills through the database API | A saved bill could be changed after payment | Bills, bill lines, the counter and stock history are read-only. They are written only by `create_bill` and `cancel_bill` |
| 9 | An offline bill whose staff, product or offer was deleted before upload could never upload | The bill stayed stuck on the tablet | The bill keeps the names and uploads |
| 10 | A third device using the same offline letter got an error ("-2" already taken) | The bill was stuck | Clashes now get -2, -3 and so on |
| 11 | The "new customer" flag was decided at upload time | An earlier offline visit uploaded later was not counted as the first visit | The first paid bill by time is the first visit, and this is updated after cancels too |
| 12 | Payroll had no leaving date | Someone who left mid-month was paid for the whole month unless every day was marked absent | "Last working day" in the staff form; pay stops there |
| 13 | Advances bigger than the pay gave a negative net pay ("Mark −₹5,000 paid") | Confusing, and the money owed was not tracked | Net pay stops at ₹0; the rest becomes an advance on the 1st of next month |
| 14 | Reports "Staff performance" used price after discount, including GST | It didn't match the label or the commission base when GST is on | Uses taxable value, the same base as commission |
| 15 | Bills page offline showed only bills made since the internet went down | The day's total and cash in the drawer looked too low offline | Bills from the last 3 days stay readable offline |
| 16 | Money boxes accepted "1000.555" or "1.2.3" | Split amounts could disagree with the check by 1 paisa | At most 2 decimals, one decimal point |
| 17 | The receipt read "prices include/exclude GST" from today's setting | Reprinting an old bill after changing the setting showed the wrong line | Worked out from the bill itself |
| 18 | Reading data page by page sorted by time alone | All lines of one bill share a time, so a line could be skipped or repeated across pages (above 1,000 rows) | An id is always added to the sort order |
| 19 | Busy-hours chart showed only 10 am – 9 pm | Bills outside those hours were missing from the chart | The range widens to include them |

## What these tests can't cover

- The live Supabase project, the Telegram bot and real network failures. The same SQL and the same offline code are tested, with a simulated network.
- Thermal printers and the RawBT app. The text receipt is checked for width and content.
- Whether a UPI payment actually reached the account. That is checked on the phone or soundbox, as before.
- GST rules themselves (5% without input tax credit for salon services, product rates). Have your CA confirm them once.

## Owner approval (added later)

| Level | What | Checks |
|---|---|---|
| Database (`tests/db.test.mjs`, section 10) | Authenticator codes checked against the RFC 6238 test values; set-up, right, wrong, reused and old codes; 5-wrong-codes block; Lock; 10-minute expiry; one-bill approvals for a cancel and a discount (amount capped, not reusable, not for another bill); a request older than 15 minutes; offline bills made during an unlock; everything the counter can and can't change without the owner | ~60 |
| Telegram function | The request message, who may send it, only owners can approve, approve once, expired requests | 11 |
| Screens (Playwright) | Set-up with a real Authenticator code, unlock, reused code, Lock surviving a reload, approval for one discount and one cancel, owner not answering, product price change, the owner approving from the app | 20 |

## Stock control: the Bottle check (6 November 2026)

| Level | What | Checks |
|---|---|---|
| Bottle check maths (`tests/stock.test.mjs`) | How much a bill line counts (hair length, thickness, brackets that aren't options); suggested services and "counts as" for every product type; typical uses from the size; units from give-outs; a service at the very moment of a change; two in use at once (each counts half, nothing counted twice); 3 kits given together; services billed with none in use; marked Finished; uses without a bill; cancelled bills and product lines left out; the 180-day window; normal (owner's number or learned from 3, the first one never counted); finished early at 70%, fine at exactly 70%; almost finished at 90%; order now with none in the store; products with no service ticked checked by days; ₹ not explained; by person; a shorter period | 77 |
| Database (`tests/db.test.mjs`, sections 11–11c) | Give out only through issue_stock; what happened to the one in use (empty back / no empty / still in use), each with the right approval; the first one needs no empty; the taker's own one ends first, else the oldest; older apps still work; "One is empty" only while another stays in use; marked Finished ends all in use; unit ends, ticks, "lasts about" and uses without a bill can't be written by the counter; uses without a bill: bad option, extra, reason, note, service, quantity refused, sent twice saved once; only the owner reads them; the internal and Telegram functions can't be called by any app login or the website. **Parity:** 14 products × 70 random events (give-outs, batches, finished, no empty, still in use, bills with lengths and thickness, cancelled bills, uses without a bill) counted by the database and by the app in 3 windows: every unit agrees, and so does normal. **Alerts:** finished early with uses, normal and ₹; running low; last sealed one; once only; not after 10 minutes; almost finished after a bill, once per bottle; "One is empty"; uses without a bill | 130+ |
| Upgrade (`tests/menu.test.mjs`) | October give-outs: each ended the bottle before it, the one without the empty marked so, a finished product's ended, old usage rows count as 1, a second run doesn't rebuild them; demo data from before is kept and upgraded the same way | 9 |
| Telegram function | Each stock alert refused when not signed in or with a made-up id; finished early + order now in one message; running low; nothing to say → nothing sent; almost finished after a bill; use without a bill; "One is empty"; the database is asked with the service key and only the id | 20 more (40) |
| Sizes and weak points (6 Nov, later) | Size typed as printed (1 L, 800ml, 1.5l, 1 kg, 5 uses, a plain number, nonsense refused); a 500 ml delivery kept at Stock in, wrong kind of unit refused; Give out asks which size when the store has two, the older first; a 500 ml bottle expected to do half (database and app agree, also in the random parity data); learned normal per usual size; finished early only when a whole service short; history in the Telegram message ("3 times in 90 days, 2 given to Rahul"); "talk to them" for the same person twice; the weekly check of the one in use (running fast, owner only); the learned-normal warning; measure once; "Not given out?" on Telegram once a day, not for a product never given out | 20 unit + 20 database + 3 Telegram + 24 screen |
| Screens (Playwright) | The stock list shows "In use: 6 of ~10"; Give out asks what happened to the one in use, with who has it, and asks the owner for no empty or a second one; a second one, then "One is empty"; history; Used without a bill (length required, counted on the bottle in use straight away); **billing has no extra step and the bill alone moves the count**; Bottle check flags, ₹, by person, detail per bottle; Used in for a new product (13 waxing services suggested, counts as, lasts about, untick removes); stock count loss; the approval rule; the three answers fit a phone | 43 |

## Menu, website and products (added November 2026)

| Level | What | Checks |
|---|---|---|
| Database (`tests/menu.test.mjs`) | Categories, slugs and website fields from the seed; who may change the menu (counter refused, a Telegram "open owner screens" not enough, a one-time approval for exactly that service, the code unlock, owner login, a login still waiting); the change history; price = cheapest option, bad options and prices refused, only sent fields change; renaming a category moves its services and offers along, and billing still gives the offer; the website's public key can't read or write any table or call any app function; `web_site()` returns exactly the visible menu in the website's CATALOGUE shape, live offers only, salon details without anything private, and a new version after a price change; `request_booking()` cleans phone numbers, takes prices from the menu, refuses bad phones, names, dates, hidden services and spam; MRP, supplier discount, note; "Finished" with and without stock left, sent twice, cleared by stock in; the demo database follows the same rules; upgrading a database made with the October 2026 schema keeps every service, bill and offer and gives the same categories as a new install | 134 |
| Telegram function | A product marked finished (once, with what was written off), a website booking (once, only when new, made-up ids refused) | 9 more (20) |
| Screens (Playwright) | A price change asks the owner again even with owner screens open, and shows exactly the change; change history; no asking after the owner's code; renaming a category; a new service with website details; taking a service off the website; billing shows the changes. MRP − discount = cost and back; selling above MRP refused; note without the owner, MRP change with; Finished with stock left (owner approval, written off) and with none; To buy list and its WhatsApp text; a different discount at stock in; phone layouts. Earlier stock and billing screen tests run again | 15 + 25 + 23 |

### Problem found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 20 | The page's slide-in animation left an (invisible) transform on every page | Pop-up windows opened from a long page (the services list, stock) were placed in the middle of the whole page instead of on the screen, so on a phone or a long list they could open out of sight | The animation no longer leaves anything behind; pop-ups always sit on the screen |

## Bookings and enquiries (6 November 2026)

| Level | What | Checks |
|---|---|---|
| Database (`tests/menu.test.mjs`, 5c) | Counter bookings: confirmed with a time, stylist, who took it; prices from the menu (Keratin L + thick); duration; a request without a time; bad phone, name, no service, past day, too far, a time on another day, confirmed without a time, unknown source, made-up service refused; the website key can't use it; confirming a request keeps services and source; moving it clears "confirmation sent"; a website booking stays a website booking. Website questions: cleaned phone, only real visible services, tracking fields, refused bad input, 3 a day per number, can't be read back. Counter enquiries; booking from an enquiry links both. The visit link: a bill another day doesn't count, a bill that day marks Came with the bill, earlier enquiries marked Came, a second bill doesn't move it, a cancelled bill puts it back. Demo database: the same prices, checks and visit link | 38 |
| Telegram function | A website question: name, number, services, the question, a WhatsApp link; once; not for counter enquiries; made-up ids refused | 4 |
| Screens (Playwright) | The menu badge; today's list; confirmation and reminder on WhatsApp (number, text, services, prices, ref); a WhatsApp booking at the counter with hair length and thick hair; a clash shown and gone; confirming a website request; **Start bill → the normal bill → Came**; no-show with a message; enquiries: reply with prices from the menu, book from an enquiry, close with a reason, a new enquiry with a follow-up; the badge counting down; phone layout | 33 |

## Loyalty points (7 November 2026)

| Level | What | Checks |
|---|---|---|
| Rules (`tests/loyalty.test.mjs`) | ₹1,000 → 50; rounded down; offer prices, products (unless switched on), staff's own numbers and what points pay earn nothing; a counter discount earns on what is paid; GST included; split payments; 7% and 2.5% in Settings; a ₹99,999 bill without overflow; how many can be used (below 100, 20%, the balance, rounding); expiry 12 months after the last visit (29 Feb too); the receipt, tablet receipt and WhatsApp lines | 35 |
| Database and demo, side by side | About 500 random bills over 15 months for 30 customers (one a staff member's number), with offers, products, discounts, GST in and out, split payments, points used whenever allowed and wrong tries (too many, below 100, no number); some customers away for 15 months so their points expire; then the owner cancels 8% of the bills. Every answer is the same in both, every bill's points and balance match a separate model, every balance = the sum of its points rows, before and after the daily expiry. Hand-picked: the ₹1,000 facial example (50 + 50, then 100 off → pays ₹900, earns 45), cancelling gives back 100 and takes off 45, an offline bill using points it didn't have is saved with a CHECK note, switched off, 7% with products, expiry by the daily run. Nobody can type a balance (counter or owner login), add, change or delete points rows, or run the expiry; a customer added with points starts at 0; a waiting login can't read them; the schema re-runs keep them | about 3,000 |
| Screens (Playwright, the security headers on) | The customer card shows 250 points, ₹250 off, valid till; an offer price earns nothing; Pay with points: up to 250, to pay ₹2,250, earns 112; 100 instead → ₹2,400, earns 120; more than allowed held at the most; cash return on what is paid; the receipt and WhatsApp show points paid, earned, balance, valid till; saved rows; under 100 → no option; a staff number earns nothing; Customers: points not yet used, Points to use, the history, WhatsApp mentions the points; cancelling gives them back; offline → no option; Settings (and the bill preview); phone layout | 32 |

**WhatsApp bill as a picture.** The picture's lines are checked against the printed and tablet receipts (shop, GSTIN, tax invoice, items and staff, offers, GST halves, total, points paid, paid by, the points box, footer; a cancelled bill has no points box), and the chat message word for word (`tests/loyalty.test.mjs`, 12 checks). On screen (Playwright, 17 checks), on a tablet and on a laptop, with the security headers on: the picture is 1,200 px wide, as tall as the bill, dark text on white; 1. Open the chat goes to the customer's number with the thank-you, total, points earned and balance; on the tablet, 2. Share gets a PNG named "Bill HF2627-0041.png" with a caption; on the laptop Copy puts the picture on the clipboard and Save downloads it; Send as text instead still works.

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 35 | The payment check didn't know points | A bill paid partly with points couldn't add up | Points are a payment in whole rupees: cash + UPI + card + points = total, in the app and the database |
| 36 | Demo only: a bill refused for its points had already created the customer and written down expired points | The demo drifted from the database, which undoes the whole bill | The points are checked before anything is saved |
| 37 | Cancelling a bill from before the customer's points expired took its points off again (or gave back points that would have expired) | A balance could go below 0 for points already gone | Points from before an expiry stay expired: cancelling such a bill doesn't change the points |

## Staff: face check-in, leave and documents (7 November 2026)

| Level | What | Checks |
|---|---|---|
| Face matching (`tests/staff.test.mjs`) | 3,000 random teams of 2–8 people with face prints as far apart as real ones: never the wrong person, a stranger never checked in, the right person almost always; two people about as close → nobody; set-up refuses looks that don't agree and a face that is already someone else's | 3,000+ |
| Photo or real face | Eye openness and head turn don't change when a flat photo is moved, tilted or brought closer (500 cases); 2,000 photos held up, shaking, tilting, moving closer, with the points wobbling more than the real face models were measured to and the detector jumping now and then: none taken as a real face; a blink (1 or 3 frames) and a small head turn (either way, or one way) count; eyes shut for long, shut from the start, or one odd frame don't | 2,500+ |
| Leave and paid days off | Paid days off for a part month = the payroll's, for 4,000 random months, joins and leaves; what the leave form says will be unpaid = what the payroll then cuts after the leave is approved (random attendance with week offs, absences, half days, leave); hand-picked cases (a week off inside the leave, two months, a week at once, joined mid-month); days without a check-in (from set-up or joining to yesterday, not for staff without face check-in or who left); WhatsApp texts | 8,000+ |
| Database | Face set-up owner only, 1–10 looks, needs the agreement; the counter reads prints, a waiting login and the website don't; check-in refused when too far, not live, no photo, not an image, too big, unknown or left staff, waiting login, website; first scan in → present, second soon → already, 30 min later → out, once a minute, the last scan is the leaving time; checking in after being marked absent → present; the counter can't add, change or delete attendance or check-ins; the owner can. Leave: every wrong request refused; the counter can't approve (not even by changing the row) or add approved leave; approved → L except week offs; answered twice refused; owner unlocked at the counter → approved there, in the owner's name; cancelled → L days off; refused → nothing; approved on Telegram (service key) → L; leave today but came → present, kept after cancelling. Documents owner only, Aadhaar last 4 only. Morning message: tomorrow's leave, leave waiting, who didn't check in, once a day, not for the counter. Schema re-run keeps it all. **Demo = database:** 400 random leave requests, approvals, cancels and marks give the same attendance and the same answers, and the same face check-in answers | about 100 |
| Telegram function | Leave request: who, days, kind, reason, days off this month; Approve / Deny; once; not old ones; a stranger can't approve; an owner approves; the second owner's tap changes nothing; no time limit to refuse. Morning message: leave today and tomorrow, waiting, bookings, not checked in; once a day; nothing to say → nothing sent | 16 |
| Screens (Playwright, real face models, the security headers on) | A fake camera showing a real face photo that "turns": face set-up waits for the agreement, saves 5 looks and a small photo; a face already set up refused for another person; face check-in → present with the photo; the camera stays open without repeating; the same photo held still → recognised but not checked in; a stranger → not recognised; nobody → "Look at the camera". Flags and banners; marking by hand needs the owner; leave asked (preview, the same days refused), approved → 6 L days, WhatsApp reminder, refused → WhatsApp, cancelled → L days off; the badge; Bookings shows who is on leave; documents: Aadhaar last 4, a big phone photo made smaller, PAN checked, PDF download, delete; phone layout | 49 |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 29 | Measured with the real face models: a photo held up and moved around, face small in the picture, made the eyes look up to a third less open | A photo could pass the blink check | The face must be at least 22% of the picture wide ("Come a little closer"), a blink must close the eyes below 55% of open, and a head turn must move the nose 15% of the eye width (each value the middle of 3 frames). Head turn is what the app asks for |
| 30 | Eyes shut longer than a blink and then opened counted as a blink | A photo with shut eyes swapped for an open one could pass | Shut for more than 8 frames isn't a blink; the eyes must open again first |
| 31 | The security headers blocked the camera (`camera=()`) | Face check-in couldn't open the camera on the hosted app | `camera=(self)`: the app's own pages only |
| 32 | Pressing Escape closed every open window | Closing a document photo also closed the staff member's page | Only the top window closes |
| 33 | Leave approved at the counter after the owner unlocked it was saved as approved by the counter's email | The record didn't say which owner approved | Saved in the name of the owner who unlocked the counter |
| 34 | Demo only: opening a document fetched a `data:` link, which the security headers block | The photo didn't open in the hosted demo | Read without fetch |

**What these tests can't cover.** A real tablet camera in the salon's light, and real blinks: the fake camera turns a photo by squeezing one half, which the real models read as a head turn. A video of the person played on a phone could pass. The check-in photo is how the owner catches that (see `docs/STAFF.md`).

## Final testing before deployment (10 November 2026, night)

Everything run again, from clean builds, on the code in this package.

| What | Result |
|---|---|
| `npm test`: 10 suites (bill maths, payroll, stock, the real database in memory, menu and website, staff, loyalty, Telegram, WhatsApp, WhatsApp API) | 3,714,567 checks, 0 failed |
| Every screen test (Playwright, 19 files: the production build with the security headers, and the build with the offline layer) | 661 checks, 0 failed. (Run after 9 pm: the 3 checks that watch automatic messages go out were replaced by "nothing is sent at night", which held.) |
| A clean install from the zip: `npm ci`, then `npm run preflight` | First run: one test failed (problem 53 below, a fault in the test). After the fix: passed, tests, build, and the checks on the built files |
| `npm run preflight` with no `.env`, and with the **secret** key in `.env` | Refused both, with what to do |
| `npm audit --omit=dev` (the packages that are in the app the browser gets) | 0 known vulnerabilities |
| `npm audit` (with the build tools: Vite, esbuild, and what the offline-worker plugin uses) | 8 advisories (1 high, 5 moderate, 2 low), all in tools that run only on your computer while building or in `npm run dev`; none of that code is in the built app. Clearing them means moving to Vite 6+, a breaking upgrade left for after go-live. Don't run `npm run dev` on a public network. |
| Built app searched for the Supabase secret key, a Telegram bot token, a Meta token | None |
| The 9 database, payroll, staff, loyalty, Telegram and WhatsApp suites run again with the clock moved: 5 minutes before midnight, 1 am, 8 am, noon, 30 November, 1 December, 31 December, 1 January, and 1 April 2027 (the new financial year) | All passed except 1 April, which found problem 54 (demo only); passed after the fix |
| `01_schema.sql` run twice, and on top of the October 2026 database | No errors, no data changed (in `npm test`) |

`npm run preflight` (new) is the same gate for you before each deploy: see `docs/DEPLOY.md`, step 4.

**What only you can test,** on the real tablet with the real accounts: `docs/DEPLOY.md` step 6 is that list (login approval on your Telegram, your printer, your Wi-Fi going off and on, the camera, real WhatsApp templates). Nothing here replaces it.

## Salary slip on WhatsApp (10 November 2026, night)

| Level | What | Checks |
|---|---|---|
| Payroll (`tests/payroll.test.mjs`) | The slip's lines from a month with a week off, a leave, an absence, a half day, an advance, sales, an incentive and a deduction: day rate, days off taken / not taken / above the allowance, days worked; salary + commission + incentive − advances − deductions = net pay; the picture has the salon, month, name, every line, net pay and how it was paid; the text copy has the same lines; the carried-advance note; "₹0" not "-₹0"; an old slip without a day rate | 7 more |
| WhatsApp function (`tests/wa-api.test.mjs`) | **Who:** not signed in, the counter's login (it can't read payslips), a waiting login, a made-up id: all refused, nothing sent. **Refused in plain words:** salary not marked paid, no mobile number, staff member deleted, no picture, picture too big. **Sent:** the PNG goes up, the `salary_slip` template to the person's own number with the picture and 5 values (name, month in words, net pay, how, when); recorded with the payslip, kind slip, who sent it. **Limits:** not twice by itself or within a minute; again by hand; at most 3. **Failures:** a number not on WhatsApp, the template not approved (names it), another template name from the secrets. **After:** delivered marks the row; not delivered → both owners on Telegram; WhatsApp not set up → the app offers the slip as a message | 25 more (100) |
| Screens (Playwright `t46`: Pad 5 across, upright, and a phone; security headers on) | Mark paid: the pay window says the slip goes to them, with the number; the toast "Salary slip sent to Amit on WhatsApp ✓"; one message recorded to their own number; the picture is 1200 px wide; the row shows Slip sent ✓ then delivered ✓✓; the button is labelled and big enough; a second tap doesn't send twice; again by hand up to 3, then "Print the slip instead"; no number: said before and after paying, salary still saved; Settings switch On → Off: nothing goes by itself, by hand still works; nothing off the screen, no errors | 69 |

### Problem found and fixed

52. **An older screen test broke** (t44): WhatsApp settings now has two On/Off switches, and the test looked for "the" switch. The test now names the first. Not a fault in the app.
53. **A test that failed only after 10 pm** (found in the final run, on the clean install): the reminder check expected a booking 2 hours ahead to read "today at …", but after 10 pm that is "tomorrow at 12:03 AM", which the app said correctly. The test now accepts both. The fixed-time checks of today / tomorrow / a named day were already there. Not a fault in the app.
54. **Demo only: a bill dated before 1 April but saved on or after it got last year's number** (found by running every suite again with the clock moved to 1 April 2027). The real database numbers a bill by the day it is saved, so numbers always run in order (HF2728-0001 on 1 April); the demo database used the bill's own date and said HF2627. The demo now does the same as the database. The live app was never affected.

**Not tested here:** a real slip through Meta (the `salary_slip` template must be approved in your WhatsApp Manager first).

## Expenses, cash close, feedback and automatic WhatsApp messages (10 November 2026, evening)

| Level | What | Checks |
|---|---|---|
| Database (`tests/db.test.mjs`, section 16) | **Expenses:** 10 kinds of wrong expense refused with the same words as the app's own check (no amount, words, zero, 3 decimals, too big, nothing chosen, unknown way of paying, tomorrow, an earlier day by the counter, 61 days back); a waiting login can't; the counter adds one; a retry saves once; the owner adds one for an earlier day; the counter can't change, delete or remove one. **Cash close:** what should be in the drawer worked out by the database and by the app from the same rows, compared before the first close, after closing, and after a new cash bill + an expense + an old cash bill cancelled + an old drawer expense removed; wrong counts refused; ₹60 short without a note refused ("The cash is ₹60 short. Write why in the note."), ₹8 over needs none; the saved figures = the app's sum; the counter can't close twice or write a close; the owner counts the day again (one close a day). The demo: the same refusals and sums | 46 |
| Database (section 17) | **Who is due an automatic message:** the database's list and the app's list compared, in order, on bills spread over 3 days, customers last seen 20 to 400 days ago and 12 bookings: at 2 pm, a minute after sending (nothing twice), with the day's limit used up, and at 24 random times over 3 days with the settings changed on the way (always the same; nothing between 9 pm and 9 am). Feedback one a customer, never a staff or past bill; reminders only confirmed bookings in the next 3 hours with a real number; "we miss you" only customers who agreed, most recently lapsed first, none with a booking coming; STOP respected; a duplicate send refused by the database; the counter can't ask who is due or write a send or feedback; only the owner marks feedback dealt with | 14 |
| WhatsApp function (`tests/wa-api.test.mjs`) | The reminder time in words (today, tomorrow, the day); each template's values; who may ask (signed in, or the schedule's secret); the three kinds sent with their own templates, recorded with what they are for, the booking marked reminded; a number not on WhatsApp marked failed; asked again: nothing twice; a template not approved: says so, stops, nobody marked failed, goes once approved; an old database: says to run the schema. **Answers:** "Loved it" saved for that bill, a thank-you with the Google link as a plain message, nothing to Telegram; a second tap changes nothing; words after answering kept as the comment; "Not happy": apology, the review link (or not, by Settings), both owners told on Telegram with the bill and who did the service; "It was okay"; a button on someone else's message ignored; STOP and START; "Stop sending the wrong bill" is not STOP; an undelivered reminder doesn't bother the owners | 24 more (75) |
| Telegram (`tests/telegram.test.mjs`) | Cash close: refused when not signed in or with a made-up id; the message with sales by way of paying, expenses, the drawer sum, "₹50 SHORT", the note, taken out and left; once; "matches ✓"; an old close isn't sent | 4 more (82) |
| Screens (Playwright `t45`, the demo, security headers on) | Bills has the tabs Bills · Expenses · Cash close. Add expense: needs an amount and a kind; Cleaning ₹150 from the drawer with a note, Laundry ₹400 by UPI; the list and the month by kind; removing asks for the owner and marks it Removed. Cash close: ₹2,000 left yesterday + the cash bill − drawer expenses; counting by notes adds up; ₹60 less shows "Short ₹60" and asks why; leave ₹2,000, the rest taken out; closed and kept; the summary; yesterday in Earlier days; a bill after closing "counted in tomorrow's close"; Count again for the owner. Settings: the three messages off to begin with, 2 hours, 3 hours, 45 days, 20 a day; a review link without https refused; switched on, they go by themselves, one feedback request a customer for bills 2 to 48 hours old; nothing twice after a reload. Customers → Feedback: the red number, the unhappy customer first with the comment, bill and stylist, Dealt with (owner) with a note, the list of messages sent. Reports: Expenses and Sales less expenses. Xiaomi Pad 5 upright and a phone: nothing off the screen | 39 |

**Not tested here:** real messages through Meta (the templates must be approved in your WhatsApp Manager first), and Meta's price for each.

## One-tap WhatsApp, Xiaomi Pad 5, payments as rows (10 November 2026, later)

| Level | What | Checks |
|---|---|---|
| Screens (`t44`) | With WhatsApp bills on, the bill's button is **Send on WhatsApp**: one tap sends through the API, the notice "Bill sent on WhatsApp to … ✓" then "Delivered on WhatsApp ✓✓", no WhatsApp window and no 2-tap screen | 3 more (20) |
| WhatsApp function (`tests/wa-api.test.mjs`) | A bill Meta reports as not delivered: both owners told on Telegram with the number and the reason | 1 more (51) |
| Xiaomi Pad 5 (`pad5`, 1280×776 and 1280×696 sideways, 800×1256 and 800×1176 upright, touch) | On every page and Staff tab: no sideways scroll; the whole menu on one row; on New bill with 4 items the search, tabs and Save button on screen without scrolling the page; tiles at least 2 a row; every button, chip and box at least 36 px (most 42) | 96 |
| Database (`tests/db.test.mjs`) | `bill_payments`: every bill's rows add up to its cash + UPI + card + points (300+ bills); the counter reads them, can't add, change or delete | 2 |

The month calendars (Bookings → Month, Staff → Leave) were taken out again; Bookings and Leave are lists as before.

## Leave planning on Telegram, WhatsApp bills (10 November 2026)

| Level | What | Checks |
|---|---|---|
| Staff (`tests/staff.test.mjs`, the real database) | Amit's 2 days of leave a few weeks out: 7 days before, the plan has him, the days, "in 7 days" and the reason; the 2 bookings given to him on those days in time order (not his booking the day after, not someone else's, not a cancelled one), one not confirmed yet, with the services and hair length; who else is off (Priya asked for leave, Rahul has a week off); 2 of 4 staff in on the busiest day (leave only asked doesn't count). Each reminder once: nothing 6 or 4 days before, again 3 days before, again the day before, nothing on the day or more than a week ahead. Approved 2 days before: only the 3-day reminder, then the 1-day one. Waiting or cancelled leave: nothing. Settings "5 days before" followed. The counter can't ask for plans. In the morning message; on Mondays the week's leave, other days none | 14 |
| Telegram (`tests/telegram.test.mjs`) | The planning message word for word (who, days, in 7 days / tomorrow, the bookings with time, name, number and services, "not confirmed yet", where to change the stylist, also off, how many in); sent at once to both owners when leave is approved on Telegram, or in the app; once only. The morning message on a Monday with the week's leave ("waiting for your answer"), or "nobody", then one planning message per leave coming up. The daily 9:00 schedule works with its secret and is refused with a wrong one | 78 (12 new) |
| WhatsApp bills (`tests/wa-api.test.mjs`, the new `whatsapp` function, fake Meta and Supabase) | Refused: not signed in, a login waiting for approval (it can't read the bill), a made-up id, a cancelled bill, no number, older than 30 days, no picture, not a PNG, too big; nothing reaches Meta. Sent: the picture uploaded as a PNG with the token, then the bill template to 91 + the number with the picture on top and 4 values (first name, bill number, total, the points line); recorded as sending → sent with WhatsApp's id and who sent it. A double tap or opening the bill again doesn't send twice; Send again a minute later does; at most 3. The values: "there" without a name, a staff bill without points, paid with points, never a new line or tab. Meta's errors in plain words (not on WhatsApp, template not approved, picture refused, token expired, too many, account restricted, payment, number not registered), a failed send can be tried again. Settings check: the number, name, quality, template, what is missing. The webhook: Meta's check with the verify token; a wrong or made-up signature refused; delivered, read; a late "delivered" or "sent" doesn't go back; failed with the reason; someone else's message ignored; a customer's reply (text and a photo) to both owners on Telegram with a link to reply | 50 |
| Database (`tests/db.test.mjs`) | The counter reads how a WhatsApp send went but can't add, change or delete one; a status WhatsApp doesn't have is refused | 3 |
| Screens (Playwright, `t44`, the demo, the security headers on) | WhatsApp bills off: no tick. Settings → WhatsApp bills: the price and "untick for a customer", On, Check: the demo says nothing is really sent; saved. A bill: the tick "Send the bill on WhatsApp to 91234 56790", ticked; after saving, "Sent on WhatsApp ✓" then "Delivered on WhatsApp ✓✓" by itself; recorded once. Bills: "WA ✓✓"; opening it again doesn't send again. Unticked: nothing sent, "Not sent on WhatsApp yet", Send on WhatsApp by hand. Walk-in: no tick. Phone: fits. Settings → Staff (`t43`): Telegram before leave 7, 3 and 1 days, changed to 14, 7 and 3 and saved. All 16 screen tests run again | 17 + 38 + 399 older |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 48 | A booking pasted from WhatsApp with "Mens Haircut" (no apostrophe) didn't find "Men's Haircut & Styling" | The counter had to pick the service by hand | Apostrophes are ignored when matching names |
| 49 | The website privacy test looked for "9830" (a phone number) in the whole website data, ids included | About 1 run in 20 failed when a random id had those digits | Ids are taken out before the check |
| 50 | Dark mode: the WhatsApp dot on the Bookings month calendar was 6.95:1 | Just under the 7:1 the dark theme keeps everywhere | A lighter green (7.6:1) |
| 51 | How many days before leave the Telegram planning message goes could only be changed in the database | The owner couldn't change it | Settings → Salon & bill → Staff: 14, 7, 5, 3, 2 or 1 days before |

## Leave rules, day rate, staff's own services (9 November 2026)

| Level | What | Checks |
|---|---|---|
| Staff (`tests/staff.test.mjs`) | **Leave rules in the real database**, on days picked so the test works whatever day it runs: a planned request for someone else's day refused with "Only one person can be off a day: Amit Das is off on …", the same as medical leave accepted; Thursday to Sunday refused naming the Friday; Sunday alone, personal and other leave refused too; medical leave on Friday to Sunday accepted; a week off marked for someone else counts, not once removed, nor someone who has left; 2 days in the last week asked late refused with the "by" date, one day accepted, a second day in that week then refused, medical accepted; 14 days ahead accepted; Settings changed by the owner (30 days' notice, no days off on Monday, "Saturday or Sunday", more than one person a day) followed at once; the counter can't change the rules or add a request without them. **The demo database gives the same answer, word for word,** to 600 random requests, approvals, cancels and attendance marks, with the owner changing the rules now and then | 10,800 (40 new) |
| Payroll (`tests/payroll.test.mjs`) | Day rate = salary ÷ (days in the month − paid days off); days off not taken paid, days above unpaid, part months; the owner's examples (₹20,000, 30 days: ₹769.23 a day, 3 off ₹20,769, 6 off ₹18,462); commission on a staff member's own service at the full price | 254,700 |
| Bill maths (`tests/maths.test.mjs`) | Random bills now include staff members' own bills: services free or a % off (100, 50, 33, 25, 0), GST included or extra, a bill discount on top. Checked: the staff price is the line's own discount and kept apart; it is not in the counter's discount or the owner's limit %; the total discount = offers + staff prices + counter discounts; the commission value = the line's value before the staff price, with the same GST maths, between taxable and taxable + staff price; the save check refuses a staff price above the line's discount or a commission value outside that range | 3.4 million |
| Database (`tests/db.test.mjs`) | A staff bill on Amit's number (typed with a space in Staff): haircut free, a Lotus facial 50% off, shampoo at the normal price; saved for Amit, no points, no CHECK note; Priya (who did the services) earns commission on the full price before GST, and payroll counts it; the demo stores the same. Staff prices alone need no owner; a 25% bill discount on top does (limit 20%), 15% doesn't. Refused, with the same message in the database and the demo: a customer's number, a product at a staff price, hair at 50% ("should be ₹… off (100% for staff)"), a facial free, an offer on a staff line, another discount on it, someone who has left. A bill made offline with a wrong staff price is saved with a CHECK note. Settings 40% and facials free followed at once | 12,140 (30 new) |
| Telegram (`tests/telegram.test.mjs`) | A medical leave request says "Medical leave: Fever" and "Also off on these days: Sneha Paul (Wed, 18 Nov to Thu, 19 Nov), Priya Saha (Fri, 20 Nov)", not someone who has left or cancelled leave; a planned request with nobody else off has no such line | 66 |
| Receipts (`tests/loyalty.test.mjs`) | "Staff price −₹1,250" and "Staff price: free −₹1,000" under the lines on the picture and the tablet's text bill; a staff bill's totals say "Staff price −₹2,250" (not "Discount") and have no loyalty points box | 3 |
| Screens (Playwright, `t43`, the security headers on) | Settings → Staff: Fri, Sat, Sun; 14 days; one person a day; Hair, Threading, Waxing free; 50%. The leave form lists the rules; a Friday shows the refusal and greys out Send, Medical allows it; Amit's weekday sent; Rahul the same day refused, as medical it shows "Also off: Amit Das (…)" and is sent, the list says Medical and shows the owner "Also off: Amit Das (…)". **Staff's own service? Choose who** → Rahul: the banner, his name filled in; haircut ₹349 → ₹0 "Staff price: free", Lotus Clean-up "Staff price −50%", shampoo ₹450 with its Discount button; "Staff price (Rahul)" in the totals, no offers, no points; the receipt ("Staff price: free −₹349" under the haircut, "Staff price −₹998.50" in the totals, no points box); saved for Rahul with Amit's commission counting ₹349; "Staff" on Bills. Payroll: "Days worked", ₹692.31 a day for ₹18,000 in November, "+3 off not taken: paid", the note, the pay window, the slip keeps the day rate. Phone and Larger text in dark: nothing off the screen. All 14 older screen tests run again (two updated: 6 days over a weekend is now asked as medical leave; a staff number gets a staff bill, so no offers) | 36 + 399 older |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 45 | The demo's sample leave for Rahul ("Sister's wedding") fell on whatever days were 5–6 days away, often a Saturday and Sunday | The demo would have shown a request the new rules don't allow | The sample leave is put on days the rules allow |
| 46 | A negative "days of notice" in Settings was read as 0 by the app but as negative by the database | The form and the database could disagree | The database reads it as 0 too (the Settings box only takes 0–60) |
| 47 | A staff bill's receipt put the staff prices under "Discount" and printed an empty loyalty box ("Your balance 0 points") | Looked like a big discount given at the counter | The totals say "Staff price"; a staff bill has no points box |

## Item discounts, past bills, owner-only new services (8 November 2026)

| Level | What | Checks |
|---|---|---|
| Bill maths (`tests/maths.test.mjs`) | Random bills now also have a discount on some lines (% from 0.01 to 120%, ₹ from 1 paisa to more than the line, on lines an offer already made free). Checked against a separate calculation in paise: each line's own discount = % of what its offer left, or the ₹ typed, at most that; the bill discount then on what is left, spread in proportion; offers + line + bill discounts = the bill's discount; GST, total and round off as before; the owner's limit % = (line + bill discounts) ÷ the bill after offers. The save check refuses a line discount bigger than the line's discount, or below 0 | ~2.9 million |
| Database (`tests/db.test.mjs`) | The 300 random bills through the database and the demo now carry line discounts; every line's discount stored and adding up. A ₹49 discount on one line saved on that line; 30% on one item, or 15% on an item + 10% on the bill (23.5%), needs the owner; 19.5% together doesn't; a wrong line discount refused. **Past bills:** refused for the counter, also with owner screens unlocked on Telegram; with the owner's code at the counter saved as HF…-P0001, then P0002, P0003 (owner login), dated as typed, note "Past bill, paper bill no. …, typed in … by …", the product left the stock that day, a price far below today's menu with no CHECK note; today's numbers didn't move; refused after now, more than 400 days back, without a day and time, made offline, with points; a past bill before a customer's first bill becomes their first visit. The demo the same | 330+ |
| Menu (`tests/menu.test.mjs`) | A new service or category with a Telegram approval refused ("Only the owner can add …"), the approval not used up; with the owner's code at the counter the counter adds one; changes still work with a Telegram approval. The demo the same | 6 |
| Receipts (`tests/loyalty.test.mjs`) | A line discount under its item on the WhatsApp picture, the printed bill and the tablet's text bill | 2 |
| Screens (Playwright, the security headers on) | New customer card without "How did they hear about us?" or birthday; 10% on the haircut and ₹50 off the shampoo, 5% on the rest: ₹678, the receipt shows each item's discount; 30% on one item asks the owner; Past bill asks only for the owner's code (no Telegram), day, time and paper number, price typed from the paper bill, no offer, no points, needs the time, saved as P0001 that day at 11:30, marked on Bills; Add service asks for the owner's code even with owner screens open on Telegram; Customers without birthday or "found us via"; phone layout. All older screen tests run again | 25 + 14 older |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 43 | A past bill's receipt said the points were "valid till" 12 months after the past date | Wrong if the customer came again since | Past bills don't print a "valid till" (the balance is today's) |
| 44 | On a phone, the Past bill button pushed Clear off the edge | Clear couldn't be tapped | The buttons wrap to a second line |

## Rate chart and billing tabs (8 November 2026)

The printed rate chart (pages 2–7: Hair · Men, Hair · Women, Hair Spa & Treatments, Facials, D-Tan & Threading, Waxing) in the app and the database, with the owner's correction: root touch-up from ₹1,299, ammonia-free from ₹1,499.

| Level | What | Checks |
|---|---|---|
| Every printed price (`tests/menu.test.mjs`) | The 120 printed lines typed again in the test from the pages, each checked on a new database, on the October database after the upgrade, on the 6 November database after the upgrade, and in a new demo: name, category, price; "onwards" by hair length = S printed, M/L/XL +₹500 each; "from" prices typed at billing; hair treatments Thick +₹500 (not the men's short-hair ₹1,999); each category has exactly its printed lines; 143 services in billing; tabs and headings in order; nails and makeup as before | 4 × 145 |
| Database | 19 categories with tab, slug, website page, tab and small print; tidy slugs ("mens-loreal-classic-hair-spa"); a tab that doesn't exist refused; the database and the app have the same tab list; loading the menu not logged; running it again changes nothing; the website gets the new groups, "from ₹1,299" and the treatment sizes; bookings priced from the chart (Keratin L + thick ₹5,499); bill checks: root touch-up typed at ₹1,599 fine, at ₹1,199 counted as discount | 60+ |
| Upgrading the live menu | The menu of 6 November with bills, a booking, products ticked for services, offers on a category, a tab and a service, an edited nails price and two of the owner's own services: no service lost (190 rows, 46 hidden); the same row kept where the service is the same (Fruit Facial → Lotus Hydravitals, D-tan full arms → Raaga, Nano-Active → Nanoplastia) with its product links, old bill lines unchanged; hidden ones in the nearest category; nails price and own nails service kept; the 9 October categories gone; offers moved (facials → Lotus + O3+, "Hair" → 4 hair tabs, "Beauty" → the beauty tabs, mask → none, special price unchanged); changes logged (men's cut 600 → 349); running again keeps the offers. The October database (old schema) too | 40+ |
| Demo = database | A demo saved before this version, with the same menu and offers, upgraded in the browser: the same services (ids, names, prices, options, tabs, hidden), categories and offers as the database | 3 |
| Stock suggestions (`tests/stock.test.mjs`) | Every chart service that uses a product is suggested for one; brand products (spa creams, treatment creams, D-tan packs, oils) tick nothing by themselves; Rica and peel-off wax amounts | 5 more |
| Screens (Playwright, the security headers on) | Tabs Hair · Colour · Hair Spa · Hair Treatments · Facials · D-Tan · Threading · Waxing · Nails · Makeup & Bridal with the printed headings and counts; short tile names under a heading ("Full Arms" under Raaga D-Tan); colour picker S ₹2,999 … XL ₹4,499 with the lengths; root touch-up "From ₹1,299", can't go below; Keratin XL + thick ₹5,999; men's smoothening straight on the bill; search by full name; the bill ₹15,095; Settings tabs; all tabs in view on a tablet, Larger text and dark mode, a phone swipes the row. Every older screen test run again with the new names | 35 + 13 older |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 40 | The first version of the upgrade put every service back to menu.js, nails and makeup too | An owner's own nails price (Spa Pedicure ₹549) went back to ₹900 | Only the chart's categories are set; nails and makeup are only added when missing |
| 41 | With 12 tabs the row ran off the side of a 1280-wide tablet | Nails, Makeup & Bridal and Products were out of sight until swiped | On a tablet or computer the tabs wrap to a second row; a phone still swipes |
| 42 | Brand choice as an option (Raaga / O3+ on one D-tan service) would have counted both packs for every D-tan | The Bottle check could never see a D-tan pack finish early | Each brand is its own service, so each pack counts only its own |

## Dark mode and bigger text (7 November 2026)

For a receptionist of 50: the colours were chosen by contrast, then measured on every screen.

| Level | What | Checks |
|---|---|---|
| Contrast (Playwright, the security headers on) | Dark mode on every page (New bill, Bookings, Bills, Customers, Staff with all its tabs, Stock, Reports, Settings) and the open windows (a bill, a customer, a staff member, leave, Display, owner code): every piece of text on screen measured against what is behind it. All at least 7:1 (WCAG AAA), large text at least 4.5:1; the receipt, payslip and UPI QR stay white. Switching from the top bar with no owner code | 34 |
| Bigger text | Computer: Larger draws the app 1.3×, no sideways scrolling. Tablet (sideways and upright) and phone: Large and Larger lay the page out narrower and the browser scales it up, so the menu fits (all of it shows on the tablet) and no page scrolls sideways | 39 |
| Same as the tablet | Follows the tablet's dark mode when it changes; the choice stays after a reload; Light and Normal put everything back | 3 |

### Problems found and fixed

| # | Problem | Effect | Fix |
|---|---|---|---|
| 38 | Two small labels were just under 7:1 (red on the pink offer box 6.7, red on its pale red 6.9) | Hard to read for older eyes | The boxes behind them made a little darker |
| 39 | Larger text on the 1280-wide tablet cut off the menu ("ILL" instead of NEW BILL) | Billing out of reach | The CSS zoom used at first doesn't change which layout the page picks; on tablets and phones the page is now laid out narrower and scaled up by the browser, so it picks the narrower layout |

## Security review before going live (3 November 2026)

What was checked: every table's row level security; which database functions the website's public key can run, with Supabase's own default permissions copied into the test database; everything a counter login could try directly through the database API, not just through the screens; the website's two public functions; the Telegram function's inputs; the app for unsafe HTML; the repo for keys; the dependencies (`npm audit`); every page, tab and pop-up on a laptop, a tablet and a phone with the live security headers on; offline billing.

| # | Problem | Effect | Fix |
|---|---|---|---|
| 21 | A counter login could set a product's stock number directly through the database API | Stock taken out could be hidden by "correcting" the number, with no record | The stock number now changes only through stock moves (stock in, give out, bill, count). Even an owner login uses Count stock |
| 22 | A counter login could record a negative "stock in" through the API | A take-out without the empty or the owner's approval, disguised as a delivery | Stock in and returns must add, take-outs and sales must remove; the database refuses anything else |
| 23 | The database checked that a bill adds up, but not that its prices are the menu prices | A crafted request could bill a ₹3,000 service at ₹500 and skip the discount limit | Every line is checked against the menu. Anything below the menu counts towards the discount limit like a counter discount, and the bill gets a "CHECK:" note. A price that went up after an offline bill was made is allowed |
| 24 | Offer discounts were taken as sent | Any discount could be labelled "offer" to skip the limit | Each offer discount is checked against the offer: what it covers, %, ₹ or special price, "up to ₹X", minimum bill, first visit only, dates, days, hours, and (for online bills) that it is switched on |
| 25 | Website bookings had only an overall limit (30 an hour) | One script could use it up and block real bookings | Also 5 an hour from one internet connection (kept only as a hash) |
| 26 | CSV exports wrote text as it was | A customer "name" like `=HYPERLINK(…)` would run as a formula in Excel | Text starting with = + - @ is written with a leading ' |
| 27 | The Finished button made the stock list too wide on a tablet held upright | Finished, History and Edit were off the edge of the screen | The buttons go on two lines |
| 28 | No security headers on the hosted app | Another site could show the app inside a frame | `public/_headers`: no framing, scripts and connections only from the app and Supabase, no camera/mic, no search indexing |

Checked and fine: the website's public key can't read or write any table (every table has row level security, checked by the tests), and the only functions it can run that touch data are `web_site` and `request_booking`. All 30+ functions that run with the database's own rights have a fixed search path. A login still waiting for approval sees nothing. The counter can't make itself an owner, approve its own login or requests, edit or delete bills, reset bill numbers, read the Authenticator key, or change settings, prices, offers, staff or the change history. The Telegram function checks the webhook secret and that the tap came from an owner, accepts only real ids, and sends plain text. No unsafe HTML in the app (receipts are drawn by React). No keys in the code.

**Dependencies.** The app as deployed has no known vulnerabilities (`npm audit --omit=dev`: 0). The remaining advisories (12) are in build tools: the Vite 5 development server and the PWA build plugin. They matter only while `npm run dev` is running on your computer, and never reach the hosted app. Don't run `npm run dev -- --host` on a public Wi-Fi. Upgrading to Vite 8 later clears them.

**Known limits.**
- With the counter login, a size can still be billed cheaper than it was (S instead of L), the same as through the screen. The Bottle check sees it as a bottle that finished early.
- The Bottle check is a rough count, not a measurement. One bottle can fairly finish a little early (a long-hair week, a spill); look for the same person or product finishing early again and again. A redo or a staff colour recorded with **Used without a bill** is counted; one not recorded looks like a bottle that finished early.
- If an offer is edited or deleted, or a price raised, while a bill waits offline, its upload may need the owner like a big discount. The tablet shows the reason. Raise the discount limit for a minute in Settings, let it upload, and set it back.
- A counter login can read customers and bills through the API, because the counter needs them to work. The owner screens hide reports from the counter.

| Level | Checks |
|---|---|
| Database tamper tests (`tests/db.test.mjs` section 12) | 41 |
| Menu, website, bookings, enquiries, CSV, upgrades, the rate chart (`tests/menu.test.mjs`) | 794 |
| Screens: tour of every page and pop-up on 3 screen sizes with the security headers | 207 |
| Screens: services, products, stock, sizes, billing, offline, treatments | 15 + 25 + 43 + 24 + 3 + 6 + 12 |
