# Staff: face check-in, leave and documents

## Face check-in

**Set up (owner, once per person, on the counter tablet).** Staff → Staff list → open the person → **Face check-in → Set up**.

1. Tick that they agree. The time is saved with the face print.
2. Tap **Start camera**.
3. They look at the camera and turn their head slowly. The app takes 5 looks in about 5 seconds.

Do this at the counter, in the light check-in will happen in. If they usually wear glasses, keep them on.

The app saves a **face print** (128 numbers worked out from the face, not a photo) and one small photo. A face that already matches someone else's print is refused, so nobody can set up a friend's face as their own. **Set up again** replaces the print. **Remove** deletes it; past check-ins stay.

**Every day (staff, at the counter).** Staff → Attendance → **Face check-in**.

1. One person at a time looks at the tablet.
2. When the app says their name, they turn their head a little left and right (a blink works too).
3. The app says "Checked in at 10:02". They are **present**, and a 160 px photo is kept with the time.
4. The camera stays open for the next person. It closes by itself after 90 seconds with nobody in front of it.

Scanning again 30 minutes or more later **checks out**, and the last scan of the day is the leaving time.

**Is it really them?**

- The face is matched on the tablet against everyone's prints. It must be clearly closer to one person than to anyone else; if two people are about as close, nobody is checked in.
- The database refuses a match that isn't close enough, a check-in with no photo, and anything from a login that isn't approved. Only the database can write check-ins and attendance: the counter login can't add, change or delete them, even through the API.
- **A photo held up doesn't work.** The app needs a blink or a head turn. It was tested with the real face models on photos held up and moved around (closer, tilted, shifted), and the thresholds sit well above what a photo does.
- **A video of the person playing on a phone could pass.** That is why every check-in keeps a small photo: tap the photo in the attendance list. Look through them now and then; a phone screen in the photo is easy to spot. Check-ins happen at the counter, in view of whoever is there.
- The tablet does the matching. Someone with the counter login and technical skills could call the check-in function directly with a made-up match. The photo would still show it. This is the limit of matching faces in the browser without a paid face service.

**Didn't check in.** For someone with face check-in, a past day with no check-in and no mark shows **Not checked in**. It is also listed on Attendance and in the morning Telegram message. They **count as present until the owner marks the day**: **Mark by hand** (owner approval) → present, half day, absent, week off or leave. Today shows "Not checked in yet".

**No face set up** (or the camera isn't working): the person counts as present unless the owner marks the day, exactly as before.

**Needs:** a front camera, Chrome, and the internet. The first check-in on a tablet downloads the face models (about 7 MB), which the installed app then keeps. The one-file demo has no face models, so face check-in there only shows a message.

## Leave

**Asking (staff, at the counter).** Staff → Leave → **Ask for leave**:

- Who is asking.
- First and last day. One day is fine; at most 31 days, up to 6 months ahead, or back to a week ago.
- Kind: planned, medical, personal or other.
- A reason (optional).

The form shows what the leave does to their paid days off, for example "November 2026: 2 off so far → 5 of 4 paid days off. 1 day unpaid." or "1 of 4 paid days off. 3 left: paid as a working day if not taken." The same days can't be asked twice.

**The owner's rules** (November 2026). The form lists them, says why a request can't be sent, and the database checks them again, so nobody can get round them:

- **Friday, Saturday and Sunday are busy days.** Leave on them can still be sent; the form, the owner's request card and the Telegram message say "Fri 13 Nov, Sat 14 Nov: busy days (Friday, Saturday or Sunday). Only if the owner agrees." The owner approves or refuses. Medical leave isn't flagged. (Until November 2026 these days were refused outright.)
- **One person off a day.** Refused if anyone else has leave asked or approved, or a week off or leave marked, on one of the days: "Only one person can be off a day: Amit Das is off on Thu 12 Nov."
- **The last week of the month (from the 22nd):** 2 or more days off there (this request and any they already have in that week) must be asked **14 days before** the first of them: "… must be asked 14 days before: by Mon 09 Nov." A single day is fine.
- **Medical leave** is the exception to all three. It can always be asked; the owner still approves it. The form and the Telegram message say who else is off those days, so you can see the cover.

Change them in **Settings → Salon & bill → Staff**: the busy days (tap Mon … Sun), one person a day (Yes / No), and the days of notice.

**Answering (owner).** Each request comes on Telegram with **Approve / Deny**: who, the days, the kind and reason, and their days off this month so far. You can also answer in the app on Staff → Leave (with the owner's OK). Approved days become **L** in attendance by themselves, except days already marked as a week off, a half day or present.

- **Cancel leave** (owner) takes the L days off attendance.
- If someone on leave comes in and checks in, that day becomes present.
- Staff at the counter can cancel their own request while it is still waiting.

**Planning before someone goes on leave (Telegram).** For each approved leave, the owners get a message **7, 3 and 1 days before** it starts (change the days in Settings → Salon & bill → Staff → Telegram before someone's leave), and straight away when leave starting within a week is approved (on Telegram or in the app):

```
Leave coming up: Amit Das
Thu, 19 Nov to Fri, 20 Nov (2 days) · in 7 days
Planned leave: Sister's wedding

Bookings with Amit on those days (2): give them to someone else
• Thu, 19 Nov 05:00 pm: Megha Agarwal 98311 00012 (Keratin (L · Thick))
• Fri, 20 Nov Evening: Riya Sen 98300 12345, not confirmed yet
In the app: Bookings → the day → the booking → Stylist.

Also off then: Priya Saha (Thu 19 Nov)
In on those days: 2 of 4 staff (fewest on one day).
```

Each reminder goes once; a leave approved late gets only the one it is due for. On **Mondays** the morning message also lists everyone's leave that week (approved, and asked but not answered yet). The morning message goes the first time the app is opened each day, or at 9:00 with `supabase/05_daily_schedule.sql`.

**Reminders.**

- A red number on **Staff** and on the **Leave** tab while leave is waiting.
- **On leave today / tomorrow** at the top of Attendance.
- The **morning message on Telegram**, the first time the app is opened each day (once a day, whichever device): who is on leave today and tomorrow, leave still waiting, today's bookings, and who didn't check in yesterday.
- **Bookings:** the day shows who is on leave, and warns when a booking is with them. A new booking warns when the stylist chosen is on leave that day.
- **Tell / Remind** opens WhatsApp to the staff member with the answer, or a reminder before the leave starts ("See you back on …").

## Paid days off

Week offs (W) and approved leave (L) share **4 paid days off a month** (Settings → Salon & bill → Staff → Paid days off a month). Someone who joins or leaves mid-month gets the same share of them as of their salary.

**Day rate = monthly salary ÷ (days in the month − 4).** Salary = day rate × days worked (days employed − days off − absent − half of half days). For ₹20,000 in a 30-day month the day rate is ₹769.23:

| Days off in the month | Days worked | Salary |
|---|---|---|
| 4 (the paid days off) | 26 | ₹20,000 |
| 3 (one not taken: paid) | 27 | ₹20,769 |
| 0 (four not taken) | 30 | ₹23,077 |
| 6 (two above 4: not paid) | 24 | ₹18,462 |

Days off don't carry over to next month. Taking them all at once is fine. Payroll shows each person's day rate, "N of 4 off", "+N off not taken: paid" or "N off above 4: not paid"; the pay window and the salary slip say the same, and the slip keeps the day rate.

## Salary slip on WhatsApp

**Staff → Payroll → Mark paid** saves the month's figures and sends the person their salary slip on WhatsApp, to the number in Staff list. The pay window says so before you confirm ("The salary slip with this breakup goes to Priya on WhatsApp (98000 00001)"), or warns that there is no number.

The slip is a picture with the same lines as the printed slip:

| Part | Lines |
|---|---|
| Days | Monthly salary · Days in month · Day rate (salary ÷ N days) · Days off taken (4 paid) · Days off not taken (paid) · Days off above 4 (not paid) · Absent / half days · Days worked |
| Pay | Salary for the days worked · Service sales · Product sales · Commission · Incentive · Less: advances · Less: deductions |
| | **Net pay**, "Paid on … by UPI / Cash / Bank", and the note when an advance is carried to next month |

- The row shows **Slip sent ✓**, **Slip delivered ✓✓**, **Slip read ✓✓** or **Slip not sent** (hold on it for why). The paper-plane button sends it again: not twice within a minute, at most 3 times a slip; after that, print it.
- A slip that can't be delivered (the number isn't on WhatsApp): the owners get a Telegram message; print the slip instead.
- Only an owner can send one (salaries are the owner's), and it goes only to that person's own number. Nobody else's figures are on it.
- Switch it off in Settings → Salon & bill → WhatsApp bills; the button on the row still sends one by hand.
- Needs the WhatsApp API (README 2e) and the `salary_slip` template (README 2f-2). Without them, the button opens WhatsApp on the device with the slip typed as a message.

## Staff's own services

A bill on a staff member's **own mobile number** (the one in Staff list) is their own bill. On the bill screen tap **Staff's own service? Choose who**, or type their number.

- **Free:** Hair (cuts, beard, shave, wash and blow-dry), Threading, Waxing.
- **50% off:** every other service (colour, hair treatments, hair spa, facials, D-tan, nails, makeup).
- **Products:** normal price.
- No offers and no loyalty points.
- The staff price is automatic and can't be changed at the counter. A discount on top of it (on the bill) counts toward the discount limit as usual; the staff price itself doesn't.
- **Whoever does the service earns their commission on the full price**, as if a customer had paid. Choose who does each service as usual.
- The line, the bill, the receipt and WhatsApp show "Staff price: free" or "Staff price −50%"; Bills marks it **Staff**.

Change the free tabs and the % in **Settings → Salon & bill → Staff**. The database checks every staff price: a wrong one is refused, and a bill made offline with a wrong one is saved with a CHECK note.

## Documents

Staff list → a person → **Documents**. Pick the kind, then add the number and/or a photo or PDF:

- **Aadhaar.** Only the last 4 digits are kept as the number. The database refuses more. Upload the **masked Aadhaar** from the UIDAI website, which shows only the last 4 digits.
- **PAN.** The number is checked (ABCDE1234F).
- **Photo, bank details, address proof, certificate, agreement, other.**

Photos from the tablet camera are made smaller before upload. PDFs can be up to 5 MB.

Files go to private storage (`staff-docs`) that only the owner can open. The counter login can't see the list or the files. Open a photo in the app, download a PDF, or delete one; deleting removes the file too.

Tell staff why you keep their documents and face print, and delete them when someone leaves and no longer needs them on file.

## What is where

| Piece | Where |
|---|---|
| Face prints, check-ins with photos | `staff_faces`, `check_ins` (owner writes faces; only `face_check_in()` writes check-ins) |
| Attendance (P, H, A, W, L) | `attendance` (owner writes; face check-in and approved leave write through the database) |
| Leave | `leave_requests` (asked through `request_leave()`, answered by `decide_leave()` or Telegram) |
| Documents | `staff_documents` and the private storage bucket `staff-docs` (owner only) |
| Morning message | `day_summary()` (the Telegram function only), action `day` in `login-approval` |
| Matching, blink and head turn | `src/lib/face.js` |
| Paid days off, days without a check-in | `src/lib/leave.js`, `calcPayroll()` in `src/lib/calc.js` |
| Leave rules | `leaveRuleError()` in `src/lib/leave.js`, `leave_rule_error()` in the database (the same rules and messages) |
| Salary slip | `src/lib/slipRows.js` (the lines), `src/lib/receiptImage.js` (the picture), action `slip` in the `whatsapp` function, `wa_messages` (kind `slip`, `payslip_id`) |
| Staff's own services | `src/lib/staffPrice.js`, `staff_price_check()` in the database; `calcBill()` works out the staff price and the commission value |
