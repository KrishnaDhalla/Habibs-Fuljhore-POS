# Connecting the website to the salon database

The website shows the menu, prices, offers and salon details straight from the billing database, and sends booking requests into it. Change a price in the billing app (Settings → Services & prices) and the website shows it at its next page load.

The website needs **only the public (anon / publishable) key**. It can't read any table with it: it can only call the three functions below. Never put the `service_role` / secret key in the website.

## 1. Read everything the website shows (one call)

```js
// src/lib/salonApi.js in the website
const URL = import.meta.env.VITE_SUPABASE_URL;       // same project as the billing app
const KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;  // public key
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

export async function loadSite() {
  const r = await fetch(`${URL}/rest/v1/rpc/web_site`, { method: 'POST', headers, body: '{}' });
  if (!r.ok) throw new Error('Menu not available');
  return r.json(); // { version, salon, menu, offers }
}
```

What comes back:

```json
{
  "version": "20261103T101500",
  "salon": { "salon_name": "Habibs Hair & Beauty", "branch": "Fuljhore, Durgapur", "address": "…", "phone": "+91 89275 63835",
             "whatsapp": "", "instagram": "@habibsfuljhore", "opening_hours": "10:00 AM – 9:00 PM, all 7 days", "maps_url": "", "prices_include_gst": true },
  "menu": [
    { "id": "womens-colour", "uid": "…", "cat": "hair", "tab": "Colour", "type": "Colour", "title": "Women's Colour",
      "desc": null, "note": "Colour includes wash & blow-dry. Patch test 48 hours before your first colour. Prices by hair length.", "image": null, "consult": false,
      "items": [
        { "uid": "…", "slug": "global-colour-women", "n": "Global Colour", "bill_name": "Women's Global Colour",
          "sub": null, "inc": [], "p": [2999, 3499, 3999, 4499], "lbl": ["S", "M", "L", "XL"], "from": false, "sized": true,
          "dur": null, "for": "women", "desc": null, "book": true, "featured": false, "extra": null }
      ] }
  ],
  "offers": [
    { "id": "…", "title": "Groom Makeup", "text": "Wedding season", "tag": "WEDDING SEASON", "image": "groom", "live": true,
      "starts_on": null, "ends_on": "2026-11-30", "kind": "price", "value": 2999, "applies_to": "services", "services": ["wedding-day-groom-make-up"] }
  ]
}
```

`menu` is in the same shape as `CATALOGUE` in the website's `src/data/services.js` (`id`, `cat`, `tab`, `type`, `title`, `desc`, `note`, `consult`, `items` with `n`, `sub`, `inc`, `p`, `lbl`, `from`, `sized`), so the website's catalogue code keeps working. Each item also has `uid` (the service id, used for bookings) and `slug`.

Since the printed rate chart (November 2026) the groups are: `mens-cut`, `womens-cut`, `mens-colour`, `womens-colour`, `mens-hair-spa`, `womens-hair-spa`, `hair-treatments` (hair page); `lotus-facials`, `o3-facials`, `raaga-dtan`, `o3-dtan`, `threading`, `rica`, `mens-rica`, `peel-off-wax` (beauty page); `manicure-and-pedicure`, `makeup`, `bridal-package`, `groom-package`. A group id never changes once made, so a database upgraded from the October menu keeps the old ids of the services it kept (e.g. `global-colour-women`). `for` is `men`, `women` or `any`, for a Men / Women filter.

`extra` is a second choice added to the price, e.g. hair treatments: `{"title": "Hair thickness", "choices": [{"label": "Thick", "price": 500}]}` ("Normal" costs nothing extra). Show it as "Thick hair +₹500".

Only what is switched on shows: categories with "Show on the website", services that are in billing and have "Show on the website", and offers with "Show on the website" that haven't ended (`live: false` means it starts later).

### Keep a copy, so the site never shows an empty menu

```js
const CACHE = 'salon-site-v1';
export async function siteData(bundled) {           // bundled = today's src/data/services.js, as the last resort
  let cached = null;
  try { cached = JSON.parse(localStorage.getItem(CACHE)); } catch {}
  try {
    const fresh = await loadSite();
    try { localStorage.setItem(CACHE, JSON.stringify(fresh)); } catch {}
    return fresh;
  } catch {
    return cached || { menu: bundled, offers: [], salon: null };
  }
}
```

Show the cached copy at once and swap in the fresh one when it arrives; the `version` tells you whether anything changed.

### Google (SEO)

Prices that arrive by JavaScript are indexed more slowly. If you prerender pages at build time, fetch `web_site()` during the build too, and rebuild when prices change: a Cloudflare Pages deploy hook called from a Supabase database webhook on `services` does it automatically.

## 2. Send a booking request

```js
export async function requestBooking({ name, phone, date, time, note, items, offerId, utm }) {
  // items: [{ service_id: item.uid, option: 'M', extra: 'Thick' }]  (option = one of item.lbl; extra = one of item.extra.choices; both optional)
  const r = await fetch(`${URL}/rest/v1/rpc/request_booking`, {
    method: 'POST', headers,
    body: JSON.stringify({ p: { name, phone, date, time, note, items, offer_id: offerId, utm } }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out.message || 'Could not send the booking'); // message is written for the customer
  // Tell the owners on Telegram (optional, needs the login-approval function deployed)
  fetch(`${URL}/functions/v1/login-approval`, { method: 'POST', headers, body: JSON.stringify({ action: 'booking', id: out.id }) }).catch(() => {});
  return out; // { id, ref: '7F3A2C', status: 'requested' }
}
```

- `phone`: 10 digits; `+91 98300 12345` and `098300 12345` are fine.
- `date`: `YYYY-MM-DD`, today to 90 days ahead (Indian time). `time`: free text, e.g. `11:30` or `Evening`.
- `utm`: pass `source`, `medium`, `campaign` from the page link (`?utm_source=instagram&utm_campaign=diwali`), so you can see which post brought the booking. Other keys are dropped.
- Prices are taken from the menu by the database. Whatever price the website shows or sends is ignored.
- Errors come back in plain words for the customer ("Enter a 10-digit mobile number", "Choose a date in the next 90 days"). After 3 requests from one number in a day, it asks them to wait for a call; after 5 in an hour from one internet connection, it asks them to call.

The booking lands in `bookings` with status `requested`, and the owners get a Telegram message with the name, number, day, services and prices.

The booking lands in the billing app under **Bookings → Requests**. The counter calls or WhatsApps the customer, then taps **Confirm** with a time and stylist, and sends the confirmation on WhatsApp from there.

## 2b. Send a question ("Ask us" form)

For people who want a price or have a question before booking:

```js
export async function askUs({ name, phone, message, serviceIds, utm }) {
  // serviceIds: item.uid of the services the question is about (optional, up to 10)
  const r = await fetch(`${URL}/rest/v1/rpc/request_enquiry`, {
    method: 'POST', headers,
    body: JSON.stringify({ p: { name, phone, message, service_ids: serviceIds, utm } }),
  });
  const out = await r.json();
  if (!r.ok) throw new Error(out.message || 'Could not send your question');
  fetch(`${URL}/functions/v1/login-approval`, { method: 'POST', headers, body: JSON.stringify({ action: 'enquiry', id: out.id }) }).catch(() => {});
  return out; // { id, ref }
}
```

A question or at least one service is needed. Same spam limits as bookings (3 a day per number, 5 an hour per connection, 30 an hour in total). It shows in the app under **Bookings → Enquiries**, and the owners get a Telegram message with a WhatsApp link to reply.

## 2c. "Book on WhatsApp" buttons

The simplest booking channel: a button that opens WhatsApp to the salon with the message already typed. No setup and nothing to pay.

```js
// salon = web_site().salon: its WhatsApp number (or the phone number), as 91 + 10 digits
const waNumber = (salon) => '91' + String(salon.whatsapp || salon.phone || '').replace(/\D/g, '').slice(-10);
export const waBook = (salon, item, option) =>
  `https://wa.me/${waNumber(salon)}?text=${encodeURIComponent(`Hi, I'd like to book ${item.n}${option ? ` (${option})` : ''}. Day and time: `)}`;
export const waAsk = (salon, item) =>
  `https://wa.me/${waNumber(salon)}?text=${encodeURIComponent(`Hi, I have a question about ${item ? item.n : 'your services'}: `)}`;
```

Put **Book on WhatsApp** next to every service and in the header, and the same link in the Instagram bio. The message arrives on the salon's phone; the counter adds it in the app in a few seconds (**Bookings → New booking**, or **New enquiry** for a question), so every WhatsApp customer is in the same list as the website ones.

## 3. What to set in the billing app

Settings → Services & prices → the pencil on a category:
- **Page** (Hair, Beauty, Manicure / Pedicure, Makeup, Bridal, Groom), **Tab** on that page, **Type** for the Services page filter.
- **Description**, **Small print**, **Picture** (image name from the website, e.g. `cat-hair`).
- **Book consultation** for bridal and chemical treatments.

On a service: **Name on the website** (e.g. "Full Legs" under Waxing), **One line under the name**, **What's included**, **Time taken**, **For** (everyone / women / men), **Description**, **Show on the website**, **Customers can book it online**.

Settings → Salon & bill: **Opening hours**, **WhatsApp number** and **Google Maps link** for the website.

## Before switching the website over

- The starting menu in the database is the printed Habibs chart from July 2025 (`src/data/menu.js`). Put in your final prices first, in Settings → Services & prices, or the website will show the old chart.
- The website's own `services.js` has descriptions and "what's included" text that the database doesn't have yet. Copy them into the categories and services once, then the database is the only copy.
