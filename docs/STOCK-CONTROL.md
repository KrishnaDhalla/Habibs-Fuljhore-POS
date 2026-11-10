# Stock control: keep costly products from walking out

Most product loss in salons comes from three things: sealed stock taken home, services done without a bill (the customer pays cash to the stylist and salon product is used), and plain waste. The rules below catch all three. The app does the record-keeping and the counting; the rules make the records honest.

## The idea: count the services each bottle lasted

You don't have to know how many ml or grams a service uses. The app counts **how many services each tube, jar, bottle or kit lasted**, from the bills you already make:

1. Every **Give out** starts one (a new 1 L developer bottle, given to Amit on 2 Nov).
2. The **empty handed back** at the next Give out ends it.
3. The services billed while it was in use are its **uses**. If a bottle normally lasts about 10 colour services and one ends after 4, that is about 6 services' worth of product not explained by bills.

**Billing doesn't change at all.** No extra tap, no question. The bill already says which service was done; the app knows which products each service uses because you ticked them once (Stock → **Used in**).

Hair length and thickness count by themselves: S 1, M 1.5, L 2, XL 2.5, Fringe 0.5, Crown area 0.75, thick hair +0.5. So a long-hair nanoplastia counts as more than a short one. For a product used in very different services (wax: Full Legs vs Upper Lip), each ticked service has a **counts as** number, filled in for you.

## Setting it up (10 minutes, once)

1. Stock → **Add product** for each salon-use product (Salon use, What is it, Counted as: bottle / tube / jar / tin / kit) and the **Size of one**, typed as printed: `1 L`, `800 ml`, `60 g`, `1 kg`, `5 uses` (or tap a quick pick). The app then shows a typical number (1 L developer ≈ 17 services).
2. Stock → **Used in**: choose the product. The usual services for that type are suggested and ticked. Untick the ones that don't use it, add any that are missing, Save.
3. **One bottle lasts about** — your own number (e.g. 10). Best: **Measure it once** (in Used in): measure what a normal short-hair service really uses, 3–5 times, and the app works it out (1,000 ml ÷ 80 ml ≈ 12.5). Leave it empty and the app learns it from your first 3 finished ones; your own number is the safer standard, because if product goes from day one, a learned number learns the loss too (the app warns you when a learned number is far below what that size usually lasts).
4. From now on, give stock out only with **Give out**.

## The 7 rules

1. **One locked store.** A cupboard or almirah with one key, kept by you or one trusted manager. Each station keeps only the one open tube, jar or bottle of each product.
2. **Empty for full.** A new one is given only against the finished one. Keep the empties in a box until your weekly check, then crush or bin them so they can't be refilled.
3. **Give out in the app every time.** Stock → **Give out**: who takes it, and what happened to the one in use:
   - **Finished, empty back**: it ends; no approval needed for cheap items.
   - **Finished, no empty**: it ends, flagged; needs your approval.
   - **Still in use**: this is a second one at the same time (two colours at once); needs your approval.
   Costly items (₹500 or more, set in Settings → Owner unlock) always need your approval.
4. **Mark everything.** Write the date opened and "SALON USE" on every unit. Keep only one of each retail product on display.
5. **Receive deliveries yourself.** Count them against the supplier's bill, then do **Stock in**.
6. **Count every week.** Sunday after closing, 15 minutes: Stock → **Count stock**. Differences are saved as "missing" with their ₹ value.
7. **Read the Bottle check every week.** Stock → **Bottle check**. Talk to the staff about any red row that same week.

## Everyday situations

| What happens | What to do in the app |
|---|---|
| A bottle is finished, a new one is needed | **Give out** → Finished, empty back |
| Two stylists need it at once | **Give out** → Still in use (owner approves). When one of the two is empty and no new one is needed: **One is empty** on the Stock list |
| The last one is finished and none is left | **Finished** (it goes on To buy). The next Give out after the delivery asks nothing about an empty |
| A redo, the staff's own colour, family, a training model | **Used without a bill** on the Stock page (service, length, who, why). It counts, so the bottle isn't flagged for it. You get a Telegram message for each one |
| 3 facial kits given at once | **Give out**, How many: 3. Each kit's share of the facials is counted |
| A delivery comes in another pack size (500 ml instead of 1 L) | **Stock in** → Size of one: 500 ml. Those bottles are expected to do half. At **Give out** the app asks which size when the store has both (the older delivery first) |
| Gloves, foils, cotton (no service ticked) | Give out as usual. They are checked by how many **days** one lasts |

## Reading the Bottle check

- **In use now**: "6 of ~10 uses", with who has it and since when.
- **Last finished**: the uses of the last 5, newest first; red = finished early.
- **Normal**: your number, or the middle of the finished ones once 3 have finished (the very first one isn't counted or judged: an older one may have been in use with it).
- **Finished early**: below 70% of normal *and* at least one whole service short (so a small tube a little short isn't flagged). The ₹ figure is the part of it not explained by bills. Ask who used it, check the empties and the appointment book.
- **Running fast**: at the weekly count the one in use looked emptier than its bills explain (see below). You see it this week, not when the bottle ends.
- **Talk to them**: the same person has 2 or more bottles finished early in the period. One bottle can fairly vary; a pattern doesn't.
- **Almost finished**: the one in use has done 90% of normal ("9 of 10"). With none left in the store, order now.
- **Done with none given out**: services that use the product were billed while none had been given out. One was probably taken without Give out.
- **By person**: who took them out, how many finished early, how many without the empty, and their uses without a bill. A shared bottle is taken by one person and used by everyone, so read it with the product rows.

## The weekly check of the ones in use (2 minutes, with the count)

Stock → **Count stock**: next to each product in use, choose how much is left in the open one (Full, ¾, ½, ¼, Almost empty). The app compares it with the bills: a 1 L bottle half gone should have done about 6 of its 12 services. If the bills show 2, it is **running fast** and shows red in the Bottle check straight away. This catches a bottle being emptied long before it ends, and products that last weeks (a 2.5 L shampoo).

## Telegram messages you get

- **Finished early**, right when the next one is given out (or "One is empty"): which product, given to whom and when, uses against normal, the ₹ not explained by bills, and whether it has happened before ("3 times in 90 days, 2 of them given to Rahul") or is the first time.
- **Order now** when the last sealed one is given out, and **Running low** when the stock reaches your alert level.
- **Almost finished** after a bill, when the one in use reaches 90% of normal and none is left in the store.
- **Not given out?** after a bill, when a service that uses a product was billed but none of it is in use in the app: one was probably taken without Give out (once a day per product).
- **Used without a bill**, each time, with the count this month.

These are sent once each. The app only says which give-out or bill it was; the database works out what to say, so nobody can send you a made-up message.

## What each loss looks like, and what catches it

| What happens | What catches it |
|---|---|
| A sealed tube or jar taken home | Empty for full, the Give out record, the weekly count |
| A service done without a bill, using salon product | The bottle finishes early (Bottle check, Telegram). Later, CCTV footfall against bills |
| Using far more than needed | The bottle finishes early; By person shows who took it |
| A bottle taken without Give out | "Not given out?" on Telegram the same day, "Done with none given out", the weekly count |
| A bottle emptied fast (poured off) | The weekly check of the one in use: "Running fast" |
| A "free" service that wasn't really free | Every use without a bill is on Telegram and in the Bottle check, with who and why |
| A retail product sold without a bill | Weekly count of the retail shelf ("Missing at stock counts") |
| A short delivery | You receive deliveries and check them against the bill |
| Product poured into a personal bottle | Pump dispensers at the wash station, opened dates, the empties box |

## Buying price, notes and "Finished"

- **MRP and supplier discount.** Type the MRP printed on the pack and the distributor's discount (e.g. 40% off MRP); the app works out the cost (₹1,500 − 40% = ₹900). If one delivery comes at a different discount, change it at **Stock in**. The cost puts a ₹ value on a bottle that finished early and on stock-count losses.
- **Note.** Anything to remember about a product: shade, supplier, where it's kept, reorder details. The counter can change it.
- **Finished.** When the last one is used up, tap **Finished**. It goes on **To buy** (tap **Send list on WhatsApp** to send the list to the supplier) and you get a Telegram message. If the app still showed some in the store, they are written off as missing, and that needs your approval. The next **Stock in** takes it off the list.

## Things to buy

- A lockable cupboard with one key
- A measuring cup for developer, and pump dispensers for shampoo and conditioner
- A permanent marker or a "SALON USE" stamp
- A CCTV camera covering the store cupboard and the counter

## A reward that helps

A small monthly bonus, e.g. ₹500 shared among the team, for a month with no bottle finished early, makes staff watch each other's usage too.
