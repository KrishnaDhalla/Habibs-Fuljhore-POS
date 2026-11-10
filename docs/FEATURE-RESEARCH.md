# Salon POS feature research: what to add to the Habibs billing app

Researched 4 Oct 2026. Products looked at: Salonist, Zoho (Zoho POS + Zoho Bookings), Odoo (POS, Appointments, loyalty, salon add-ons), MioSalon, Invoay, Zenoti, Fresha.

## What our app already covers

GST billing with UPI QR and split payment, discounts with an owner limit, WhatsApp bill, customer history (visits, spend, source, birthday, WhatsApp consent, "not seen in 45 days"), staff attendance, advances, payroll and commission, retail and salon-use stock, reports, offline billing, Telegram login approval, tablet printing and daily backups.

These match the core of every product below. The paid products charge roughly ₹2,500 to ₹4,200 a month in India (vendor comparison, so treat as indicative), and Salonist lists US$59 to US$179 a month. Most charge extra for WhatsApp automation.

## Features they have that we don't

| Feature | Who has it | Why it matters for Habibs Fuljhore | Effort |
|---|---|---|---|
| Appointments calendar + online booking | Salonist, Zoho Bookings, Odoo Appointments, Invoay, Fresha, Zenoti | The website already has a booking flow that only sends a WhatsApp message. Saving bookings into the same database gives a staff-wise calendar, reminders, and "booked → came → billed" tracking for marketing. | Medium |
| Memberships, service packages, prepaid wallet | MioSalon, Invoay, Salonist, Zenoti, Odoo (eWallet) | Brings cash in upfront and locks in repeat visits ("5 hair spas for the price of 4", "pay ₹5,000, get ₹6,000"). The marketing roadmap already plans a prepaid membership in January. | Medium |
| Gift vouchers | All of them | Festival gifting (Pujo, Bhai Phonta, Valentine's). Same engine as the prepaid wallet. | Small, once wallet exists |
| Automatic WhatsApp messages: reminders, birthday, "due for a visit", win-back | Invoay, MioSalon, Salonist (add-on), Zoho POS, Zenoti (AI) | Repeat visits are the main growth lever. Every competitor sells this as a paid add-on. | Small (one-tap list) / Medium (fully automatic) |
| Feedback after visit + Google review request | MioSalon (automated feedback), Salonist (review requests), Zenoti, Fresha | The roadmap targets 50 → 120 → 300 Google reviews. Happy customers get the review link, unhappy ones alert the owner first. | Small |
| Product consumption per service | MioSalon, Zenoti (usage forecasting) | Each hair spa or colour deducts the cream or colour it uses, so back-bar stock stays right and wastage shows up. | Medium |
| Expenses and daily cash close | MioSalon | Tea, cleaning and petty cash recorded, and counted cash checked against the app every night. Gives real profit, not just sales. | Small |
| Loyalty points and referrals | Salonist, Invoay, Zoho POS, Odoo, Fresha | "Refer a friend, both get ₹200 off" suits the Gen Z and college crowd. | Small to medium |
| Client notes, consent forms, before/after photos | Salonist (forms), Zenoti | Colour formula, allergies and patch-test consent for chemical services, and before/after photos for Instagram (with permission). | Medium |
| Staff targets and incentive slabs, shift roster | Invoay, MioSalon, Salonist | "10% above ₹50,000 in services" style incentives motivate stylists. | Small |
| Tally / GSTR-1 export | Invoay (Tally) | Saves the CA time every month. We already export CSV. | Small |

## Not worth it yet

- **Marketplace listing** (Fresha, Salonist): their customer base in Durgapur is negligible. Google Business Profile matters more.
- **Branded customer app** (Invoay, Salonist add-on): website + WhatsApp do the job.
- **AI receptionist / voice booking** (Zenoti, Salonist add-on): belongs to the later AI agent plan.
- **Multi-branch, franchise, warehouse**: only when a second outlet opens.
- **Card terminals and booking deposits through a payment gateway** (Fresha, Salonist): gateway fees (Razorpay charges 2% on UPI). For bridal bookings, take an advance by UPI QR instead.

## Suggested build order

1. **Appointments + website bookings**: the calendar the receptionist works from, and the start of the Customer Intelligence data (`bookings` table).
2. **Prepaid wallet, packages, memberships and gift vouchers**: one "credits" engine, redeemed at billing. Ask the CA how GST applies to prepaid cards and vouchers before launch.
3. **WhatsApp follow-ups + feedback/review requests**: start with a free one-tap daily list (wa.me links); move to fully automatic through a WhatsApp Business API provider (AiSensy, Interakt, WATI; paid per message) once volume justifies it.
4. **Expenses and daily cash close**.
5. **Product consumption per service**.
6. Then loyalty/referrals, client notes and photos, incentive slabs, Tally/GSTR-1 export.

## Sources

- Salonist features: https://salonist.io/ and pricing: https://salonist.io/industries/pricing
- Zoho POS for salons: https://www.zoho.com/en-in/pos/solutions/salon/
- Zoho Bookings for salons: https://www.zoho.com/bookings/industries/salon-scheduling-software.html
- Odoo hair salon industry module: https://apps.odoo.com/apps/modules/saas-18.1/hair_salon
- Odoo eWallets and gift cards: https://www.odoo.com/documentation/19.0/applications/sales/sales/products_prices/ewallets_giftcards.html
- Odoo POS salon add-on (Webkul): https://store.webkul.com/odoo-pos-salon-spa-management.html
- MioSalon: https://www.miosalon.com/
- Invoay salon software: https://invoay.com/salon-software-india/
- Zenoti: https://www.zenoti.com/
- Fresha for business: https://www.fresha.com/for-business
- India price comparison (published by a competitor, SalonBoost): https://salonboost.online/compare-salon-softwares
- Razorpay pricing: https://razorpay.com/pricing/
