-- Habibs Fuljhore rate chart, November 2026: 19 categories, 143 services.
-- Generated from src/data/menu.js (node scripts/make-seed-sql.mjs): change prices there, or later in the app
-- (Settings → Services). The same rows feed the website (see docs/WEBSITE.md).
--
-- Run it after 01_schema.sql, in the Supabase SQL editor:
--   * on a new database: it fills the menu;
--   * on the live database with the October menu: it changes the menu to the printed chart.
--     A service that is still the same keeps its row (same id), so old bills, bookings and Stock → Used in stay
--     linked; it gets the new name, price and tab. Services in these categories that are not on the chart are
--     hidden from billing, not deleted (old bills keep them; switch one back on in Settings → Services).
--     Offers made for an old category or tab are moved to the new ones. Every change is in the change history.
--     Nails and Makeup & Bridal are not on the printed pages: their prices stay as they are (only missing ones are added).
-- Safe to run again: it puts the chart's prices, options and tabs back.
--
-- Hair length: S = Shoulder, M = Below shoulder, L = Waist, XL = Below waist. The printed "onwards" price is S,
-- each longer length +₹500 (hair treatments and women's colour). Hair treatments: thick hair +₹500.
-- "From" prices (root touch-up, women's hair spa …): the counter types the final price; less than the printed
-- price counts as a discount.

select set_config('app.no_log', case when exists (select 1 from services) then '' else '1' end, false); -- a new menu is not a "change"

do $chart$
declare
  v_cats jsonb := $cats$[{"section":"Hair","name":"Men's Cut & Grooming","slug":"mens-cut","sort":10,"web_page":"hair","web_tab":"Cuts & Styling","web_type":"Cut & Style","consult_only":false,"note":null},
  {"section":"Hair","name":"Women's Cut & Styling","slug":"womens-cut","sort":20,"web_page":"hair","web_tab":"Cuts & Styling","web_type":"Cut & Style","consult_only":false,"note":null},
  {"section":"Colour","name":"Men's Colour","slug":"mens-colour","sort":30,"web_page":"hair","web_tab":"Colour","web_type":"Colour","consult_only":false,"note":"Colour includes wash & blow-dry. Patch test 48 hours before your first colour."},
  {"section":"Colour","name":"Women's Colour","slug":"womens-colour","sort":40,"web_page":"hair","web_tab":"Colour","web_type":"Colour","consult_only":false,"note":"Colour includes wash & blow-dry. Patch test 48 hours before your first colour. Prices by hair length."},
  {"section":"Hair Spa","name":"Men's Hair Spa","slug":"mens-hair-spa","sort":50,"web_page":"hair","web_tab":"Spa & Treatments","web_type":"Spa & Treatment","consult_only":false,"note":null},
  {"section":"Hair Spa","name":"Women's Hair Spa","slug":"womens-hair-spa","sort":60,"web_page":"hair","web_tab":"Spa & Treatments","web_type":"Spa & Treatment","consult_only":false,"note":"Prices depend on hair length & density; final price after consultation."},
  {"section":"Hair Treatments","name":"Hair Treatments","slug":"hair-treatments","sort":70,"web_page":"hair","web_tab":"Spa & Treatments","web_type":"Spa & Treatment","consult_only":true,"note":"Prices by hair length; thick hair ₹500 more. Final price after consultation."},
  {"section":"Facials","name":"Lotus Professional Facials","slug":"lotus-facials","sort":80,"web_page":"beauty","web_tab":"Facials","web_type":"Skin & Facial","consult_only":false,"note":null},
  {"section":"Facials","name":"O3+ Facials","slug":"o3-facials","sort":90,"web_page":"beauty","web_tab":"Facials","web_type":"Skin & Facial","consult_only":false,"note":null},
  {"section":"D-Tan","name":"Raaga D-Tan","slug":"raaga-dtan","sort":100,"web_page":"beauty","web_tab":"D-Tan & Bleach","web_type":"Skin & Facial","consult_only":false,"note":null},
  {"section":"D-Tan","name":"O3+ D-Tan","slug":"o3-dtan","sort":110,"web_page":"beauty","web_tab":"D-Tan & Bleach","web_type":"Skin & Facial","consult_only":false,"note":null},
  {"section":"Threading","name":"Threading","slug":"threading","sort":120,"web_page":"beauty","web_tab":"Threading","web_type":"Hair Removal","consult_only":false,"note":null},
  {"section":"Waxing","name":"Rica Wax","slug":"rica","sort":130,"web_page":"beauty","web_tab":"Waxing","web_type":"Hair Removal","consult_only":false,"note":null},
  {"section":"Waxing","name":"Men's Rica Wax","slug":"mens-rica","sort":140,"web_page":"beauty","web_tab":"Waxing","web_type":"Hair Removal","consult_only":false,"note":null},
  {"section":"Waxing","name":"Peel-off Wax (Face & Underarms)","slug":"peel-off-wax","sort":150,"web_page":"beauty","web_tab":"Waxing","web_type":"Hair Removal","consult_only":false,"note":null},
  {"section":"Nails","name":"Manicure & Pedicure","slug":"manicure-and-pedicure","sort":160,"web_page":"nails","web_tab":"Mani / Pedi","web_type":"Nails","consult_only":false,"note":null},
  {"section":"Makeup","name":"Makeup","slug":"makeup","sort":170,"web_page":"makeup","web_tab":null,"web_type":"Makeup & Styling","consult_only":false,"note":null},
  {"section":"Makeup","name":"Bridal Packages","slug":"bridal-package","sort":180,"web_page":"bridal","web_tab":null,"web_type":"Package","consult_only":true,"note":null},
  {"section":"Makeup","name":"Groom Packages","slug":"groom-package","sort":190,"web_page":"groom","web_tab":null,"web_type":"Package","consult_only":false,"note":null}]$cats$;
  v_svcs jsonb := $svcs$[{"chart":true,"category":"Men's Cut & Grooming","name":"Men's Haircut & Styling","web_name":"Haircut & Styling","price":349,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":10,"for_gender":"men","was":["Men Cut and Styling"]},
  {"chart":true,"category":"Men's Cut & Grooming","name":"Kids' Haircut (Boys, under 10)","web_name":null,"price":199,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":20,"for_gender":"men","was":["Child Cut Boy (under 10)"]},
  {"chart":true,"category":"Men's Cut & Grooming","name":"Beard Trim / Shape","web_name":null,"price":199,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":30,"for_gender":"men","was":["Beard Trimming"]},
  {"chart":true,"category":"Men's Cut & Grooming","name":"Shave","web_name":null,"price":149,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":40,"for_gender":"men","was":["Shaving"]},
  {"chart":true,"category":"Men's Cut & Grooming","name":"Head Shave","web_name":null,"price":249,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":50,"for_gender":"men","was":["Men Head Shave"]},
  {"chart":true,"category":"Men's Cut & Grooming","name":"Men's Hair Wash & Blow-dry","web_name":"Hair Wash & Blow-dry","price":149,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":60,"for_gender":"men","was":["Men Wash and Blast Dry"]},
  {"chart":true,"category":"Women's Cut & Styling","name":"Women's Haircut & Styling","web_name":"Haircut & Styling","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":70,"for_gender":"women","was":["Ladies Cut and Styling"]},
  {"chart":true,"category":"Women's Cut & Styling","name":"Kids' Haircut (Girls, under 10)","web_name":null,"price":299,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":80,"for_gender":"women","was":["Child Cut Girl (under 10)"]},
  {"chart":true,"category":"Women's Cut & Styling","name":"Women's Hair Wash & Blow-dry","web_name":"Hair Wash & Blow-dry","price":399,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":90,"for_gender":"women","was":["Ladies Wash and Blast Dry"]},
  {"chart":true,"category":"Women's Cut & Styling","name":"Ironing / Tongs / Crimping / Roller Set","web_name":null,"price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":100,"for_gender":"women","was":["Crimping / Ironing"]},
  {"chart":true,"category":"Men's Colour","name":"Men's Global Colour","web_name":"Global Colour","price":1199,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":110,"for_gender":"men","was":["Global Colour Men"]},
  {"chart":true,"category":"Men's Colour","name":"Men's Global Colour, Ammonia-free","web_name":"Global Colour, Ammonia-free","price":1399,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":120,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Colour","name":"Men's Highlights","web_name":"Highlights","price":1299,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":130,"for_gender":"men","was":["Men Highlights"]},
  {"chart":true,"category":"Men's Colour","name":"Men's Per Streak","web_name":"Per Streak","price":149,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":140,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Colour","name":"Beard Colour","web_name":null,"price":299,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":150,"for_gender":"men","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Root Touch-up","web_name":null,"price":1299,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":160,"for_gender":"women","was":["Root Touch Up"]},
  {"chart":true,"category":"Women's Colour","name":"Root Touch-up, Ammonia-free","web_name":null,"price":1499,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":170,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Women's Global Colour","web_name":"Global Colour","price":2999,"variants":[{"label":"S","price":2999},
  {"label":"M","price":3499},
  {"label":"L","price":3999},
  {"label":"XL","price":4499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":180,"for_gender":"women","was":["Global Colour Women"]},
  {"chart":true,"category":"Women's Colour","name":"Women's Global Colour, Ammonia-free","web_name":"Global Colour, Ammonia-free","price":3999,"variants":[{"label":"S","price":3999},
  {"label":"M","price":4499},
  {"label":"L","price":4999},
  {"label":"XL","price":5499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":190,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Crown Highlights","web_name":null,"price":1999,"variants":[{"label":"S","price":1999},
  {"label":"M","price":2499},
  {"label":"L","price":2999},
  {"label":"XL","price":3499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":200,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"T-section Highlights","web_name":null,"price":2999,"variants":[{"label":"S","price":2999},
  {"label":"M","price":3499},
  {"label":"L","price":3999},
  {"label":"XL","price":4499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":210,"for_gender":"women","was":["T-Section Highlights"]},
  {"chart":true,"category":"Women's Colour","name":"Full Highlights","web_name":null,"price":4499,"variants":[{"label":"S","price":4499},
  {"label":"M","price":4999},
  {"label":"L","price":5499},
  {"label":"XL","price":5999}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":220,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Ombre","web_name":null,"price":3999,"variants":[{"label":"S","price":3999},
  {"label":"M","price":4499},
  {"label":"L","price":4999},
  {"label":"XL","price":5499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":230,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Sombre","web_name":null,"price":4999,"variants":[{"label":"S","price":4999},
  {"label":"M","price":5499},
  {"label":"L","price":5999},
  {"label":"XL","price":6499}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":240,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Balayage","web_name":null,"price":5499,"variants":[{"label":"S","price":5499},
  {"label":"M","price":5999},
  {"label":"L","price":6499},
  {"label":"XL","price":6999}],"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":250,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Colour","name":"Women's Per Streak","web_name":"Per Streak","price":299,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":260,"for_gender":"women","was":["Per Streak"]},
  {"chart":true,"category":"Women's Colour","name":"Extra-thick Hair (Highlights Add-on)","web_name":null,"price":999,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":270,"for_gender":"women","was":["Extra Thick Hair (Highlights)"]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Wella Classic Hair Spa","web_name":"Wella Classic Hair Spa","price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":280,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Wella Nourishing / Repair Hair Spa","web_name":"Wella Nourishing / Repair Hair Spa","price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":290,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's L'Oreal Classic Hair Spa","web_name":"L'Oreal Classic Hair Spa","price":699,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":300,"for_gender":"men","was":["L'Oreal Hair Spa Men"]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's L'Oreal Nourishing / Repair Hair Spa","web_name":"L'Oreal Nourishing / Repair Hair Spa","price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":310,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Streax Classic Hair Spa","web_name":"Streax Classic Hair Spa","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":320,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Streax Nourishing / Repair Hair Spa","web_name":"Streax Nourishing / Repair Hair Spa","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":330,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Keratin Wash","web_name":"Keratin Wash","price":299,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":340,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Anti-dandruff Treatment","web_name":"Anti-dandruff Treatment","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":350,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Hair Spa","name":"Men's Head Massage, 30 min","web_name":"Head Massage, 30 min","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":360,"for_gender":"men","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Wella Classic Hair Spa","web_name":"Wella Classic Hair Spa","price":1499,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":370,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Wella Nourishing / Repair Hair Spa","web_name":"Wella Nourishing / Repair Hair Spa","price":2299,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":380,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's L'Oreal Classic Hair Spa","web_name":"L'Oreal Classic Hair Spa","price":1499,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":390,"for_gender":"women","was":["L'Oreal Hair Spa Women"]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's L'Oreal Nourishing / Repair Hair Spa","web_name":"L'Oreal Nourishing / Repair Hair Spa","price":1999,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":400,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Streax Classic Hair Spa","web_name":"Streax Classic Hair Spa","price":999,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":410,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Streax Nourishing / Repair Hair Spa","web_name":"Streax Nourishing / Repair Hair Spa","price":1299,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":420,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Keratin Wash","web_name":"Keratin Wash","price":799,"variants":null,"extra_options":null,"open_price":true,"sac":"999721","gst_pct":5,"sort":430,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Anti-dandruff Treatment","web_name":"Anti-dandruff Treatment","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":440,"for_gender":"women","was":[]},
  {"chart":true,"category":"Women's Hair Spa","name":"Women's Head Massage, 30 min","web_name":"Head Massage, 30 min","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":450,"for_gender":"women","was":[]},
  {"chart":true,"category":"Hair Treatments","name":"Smoothening / Straightening","web_name":null,"price":4499,"variants":[{"label":"S","price":4499},
  {"label":"M","price":4999},
  {"label":"L","price":5499},
  {"label":"XL","price":5999}],"extra_options":{"title":"Hair thickness","choices":[{"label":"Thick","price":500}]},"open_price":false,"sac":"999721","gst_pct":5,"sort":460,"for_gender":"any","was":["Smoothening / Straightening / Rebonding"]},
  {"chart":true,"category":"Hair Treatments","name":"Men's Smoothening (Short Hair)","web_name":null,"price":1999,"variants":null,"extra_options":null,"open_price":false,"sac":"999721","gst_pct":5,"sort":470,"for_gender":"men","was":[]},
  {"chart":true,"category":"Hair Treatments","name":"Keratin","web_name":null,"price":3999,"variants":[{"label":"S","price":3999},
  {"label":"M","price":4499},
  {"label":"L","price":4999},
  {"label":"XL","price":5499}],"extra_options":{"title":"Hair thickness","choices":[{"label":"Thick","price":500}]},"open_price":false,"sac":"999721","gst_pct":5,"sort":480,"for_gender":"any","was":["Keratin / Cysteine"]},
  {"chart":true,"category":"Hair Treatments","name":"Kera Smoothening","web_name":null,"price":5999,"variants":[{"label":"S","price":5999},
  {"label":"M","price":6499},
  {"label":"L","price":6999},
  {"label":"XL","price":7499}],"extra_options":{"title":"Hair thickness","choices":[{"label":"Thick","price":500}]},"open_price":false,"sac":"999721","gst_pct":5,"sort":490,"for_gender":"any","was":[]},
  {"chart":true,"category":"Hair Treatments","name":"Hair Botox","web_name":null,"price":4999,"variants":[{"label":"S","price":4999},
  {"label":"M","price":5499},
  {"label":"L","price":5999},
  {"label":"XL","price":6499}],"extra_options":{"title":"Hair thickness","choices":[{"label":"Thick","price":500}]},"open_price":false,"sac":"999721","gst_pct":5,"sort":500,"for_gender":"any","was":["Botox / Botoplex"]},
  {"chart":true,"category":"Hair Treatments","name":"Nanoplastia","web_name":null,"price":5999,"variants":[{"label":"S","price":5999},
  {"label":"M","price":6499},
  {"label":"L","price":6999},
  {"label":"XL","price":7499}],"extra_options":{"title":"Hair thickness","choices":[{"label":"Thick","price":500}]},"open_price":false,"sac":"999721","gst_pct":5,"sort":510,"for_gender":"any","was":["Nano-Active / Plastia"]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Clean-up","web_name":"Clean-up","price":1299,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":520,"for_gender":"any","was":["Clean-Up"]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus D-Tan Clean-up","web_name":"D-Tan Clean-up","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":530,"for_gender":"any","was":["D-Tan Clean-Up"]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Basic Facial (Oily Skin)","web_name":"Basic Facial (Oily Skin)","price":1799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":540,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Hydravitals Facial (Dry Skin)","web_name":"Hydravitals Facial (Dry Skin)","price":1799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":550,"for_gender":"any","was":["Fruit Facial"]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Acne-X Facial","web_name":"Acne-X Facial","price":2499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":560,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Preservita Sensitive Facial","web_name":"Preservita Sensitive Facial","price":2499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":570,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Preservita Anti-ageing Facial","web_name":"Preservita Anti-ageing Facial","price":2499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":580,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Insta Fair Facial","web_name":"Insta Fair Facial","price":2799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":590,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Goldsheen Facial","web_name":"Goldsheen Facial","price":2799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":600,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Bridal Glow Facial","web_name":"Bridal Glow Facial","price":2999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":610,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Ultimo Gold / Pearl Facial","web_name":"Ultimo Gold / Pearl Facial","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":620,"for_gender":"any","was":[]},
  {"chart":true,"category":"Lotus Professional Facials","name":"Lotus Miraki Facial","web_name":"Miraki Facial","price":3999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":630,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Clean-up","web_name":"Clean-up","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":640,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ D-Tan Facial","web_name":"D-Tan Facial","price":2499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":650,"for_gender":"any","was":["D-Tan Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Whitening / Brightening Facial","web_name":"Whitening / Brightening Facial","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":660,"for_gender":"any","was":["Whitening Skin Starts Here Premium Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Seaweed Facial","web_name":"Seaweed Facial","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":670,"for_gender":"any","was":["Seaweed Treatment Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Men's Facial","web_name":"Men's Facial","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":680,"for_gender":"men","was":[]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Anti-ageing Facial","web_name":"Anti-ageing Facial","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":690,"for_gender":"any","was":["Anti-Ageing Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Bridal Facial (Vitamin C Glow or Radiant Glow)","web_name":"Bridal Facial (Vitamin C Glow or Radiant Glow)","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":700,"for_gender":"women","was":["Bridal Premium Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Gold Facial","web_name":"Gold Facial","price":4499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":710,"for_gender":"any","was":["Gold Premium Facial"]},
  {"chart":true,"category":"O3+ Facials","name":"O3+ Diamond Facial","web_name":"Diamond Facial","price":4499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":720,"for_gender":"any","was":["Diamond Brightening Premium Facial"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Face & Neck","web_name":"Face & Neck","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":730,"for_gender":"any","was":[]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga Charcoal D-Tan","web_name":"Charcoal D-Tan","price":599,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":740,"for_gender":"any","was":[]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Underarms","web_name":"Underarms","price":249,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":750,"for_gender":"any","was":["D-Tan/Bleach Underarms"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Half Arms","web_name":"Half Arms","price":599,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":760,"for_gender":"any","was":["D-Tan/Bleach Half Arms"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Full Arms","web_name":"Full Arms","price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":770,"for_gender":"any","was":["D-Tan/Bleach Full Arms"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Half Legs","web_name":"Half Legs","price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":780,"for_gender":"any","was":["D-Tan/Bleach Half Legs"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Full Legs","web_name":"Full Legs","price":1799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":790,"for_gender":"any","was":["D-Tan/Bleach Full Legs"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Back","web_name":"Back","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":800,"for_gender":"any","was":["D-Tan/Bleach Full Back or Front"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Stomach","web_name":"Stomach","price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":810,"for_gender":"any","was":["D-Tan/Bleach Half Back or Stomach"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Feet & Palms","web_name":"Feet & Palms","price":499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":820,"for_gender":"any","was":["D-Tan/Bleach Feet or Palms"]},
  {"chart":true,"category":"Raaga D-Tan","name":"Raaga D-Tan Full Body","web_name":"Full Body","price":2999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":830,"for_gender":"any","was":["D-Tan/Bleach Full Body"]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Face & Neck","web_name":"Face & Neck","price":699,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":840,"for_gender":"any","was":["D-Tan/Bleach Face & Neck"]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ Charcoal D-Tan","web_name":"Charcoal D-Tan","price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":850,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Underarms","web_name":"Underarms","price":299,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":860,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Half Arms","web_name":"Half Arms","price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":870,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Full Arms","web_name":"Full Arms","price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":880,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Half Legs","web_name":"Half Legs","price":1199,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":890,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Full Legs","web_name":"Full Legs","price":1999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":900,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Back","web_name":"Back","price":1699,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":910,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Stomach","web_name":"Stomach","price":1199,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":920,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Feet & Palms","web_name":"Feet & Palms","price":699,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":930,"for_gender":"any","was":[]},
  {"chart":true,"category":"O3+ D-Tan","name":"O3+ D-Tan Full Body","web_name":"Full Body","price":3499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":940,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Threading Eyebrows","web_name":"Eyebrows","price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":950,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Threading Forehead","web_name":"Forehead","price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":960,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Threading Upper Lip","web_name":"Upper Lip","price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":970,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Threading Chin","web_name":"Chin","price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":980,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Threading Side Locks","web_name":"Side Locks","price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":990,"for_gender":"any","was":[]},
  {"chart":true,"category":"Threading","name":"Men's Threading","web_name":null,"price":50,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1000,"for_gender":"men","was":["Men Threading"]},
  {"chart":true,"category":"Threading","name":"Threading Full Face","web_name":"Full Face","price":399,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1010,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Half Arms","web_name":"Half Arms","price":600,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1020,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Full Arms","web_name":"Full Arms","price":800,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1030,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Half Legs","web_name":"Half Legs","price":800,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1040,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Full Legs","web_name":"Full Legs","price":1100,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1050,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Midriff","web_name":"Midriff","price":800,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1060,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Half Back","web_name":"Half Back","price":900,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1070,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Full Back","web_name":"Full Back","price":1200,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1080,"for_gender":"any","was":["Rica Back"]},
  {"chart":true,"category":"Rica Wax","name":"Rica Buttock","web_name":"Buttock","price":900,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1090,"for_gender":"any","was":[]},
  {"chart":true,"category":"Rica Wax","name":"Rica Full Body","web_name":"Full Body","price":4000,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1100,"for_gender":"any","was":[]},
  {"chart":true,"category":"Men's Rica Wax","name":"Men's Rica Full Arms","web_name":"Full Arms","price":999,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1110,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Rica Wax","name":"Men's Rica Chest","web_name":"Chest","price":1199,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1120,"for_gender":"men","was":[]},
  {"chart":true,"category":"Men's Rica Wax","name":"Men's Rica Full Back","web_name":"Full Back","price":1499,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1130,"for_gender":"men","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Nose","web_name":"Nose","price":100,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1140,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Chin","web_name":"Chin","price":120,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1150,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Forehead","web_name":"Forehead","price":120,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1160,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Upper & Lower Lip","web_name":"Upper & Lower Lip","price":150,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1170,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Side Locks","web_name":"Side Locks","price":150,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1180,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Underarms","web_name":"Underarms","price":300,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1190,"for_gender":"any","was":[]},
  {"chart":true,"category":"Peel-off Wax (Face & Underarms)","name":"Peel-off Wax Full Face","web_name":"Full Face","price":550,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1200,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Regular Manicure","web_name":null,"price":699,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1210,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Regular Pedicure","web_name":null,"price":799,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1220,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Spa Manicure","web_name":null,"price":800,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1230,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Spa Pedicure","web_name":null,"price":900,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1240,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Paraffin Manicure","web_name":null,"price":900,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1250,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Paraffin Pedicure","web_name":null,"price":1000,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1260,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Crystal Manicure","web_name":null,"price":1000,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1270,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Crystal Pedicure","web_name":null,"price":1100,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1280,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Nail Cut & File","web_name":null,"price":100,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1290,"for_gender":"any","was":[]},
  {"chart":false,"category":"Manicure & Pedicure","name":"Change of Nail Polish","web_name":null,"price":120,"variants":null,"extra_options":null,"open_price":false,"sac":"999722","gst_pct":5,"sort":1300,"for_gender":"any","was":[]},
  {"chart":false,"category":"Makeup","name":"Simple Make-up","web_name":null,"price":1000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1310,"for_gender":"any","was":[]},
  {"chart":false,"category":"Makeup","name":"Party Make-up","web_name":null,"price":1500,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1320,"for_gender":"any","was":[]},
  {"chart":false,"category":"Makeup","name":"Saree Draping","web_name":null,"price":500,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1330,"for_gender":"any","was":[]},
  {"chart":false,"category":"Makeup","name":"Bridal Makeup","web_name":null,"price":10000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1340,"for_gender":"any","was":[]},
  {"chart":false,"category":"Makeup","name":"Reception Makeup","web_name":null,"price":10000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1350,"for_gender":"any","was":[]},
  {"chart":false,"category":"Bridal Packages","name":"Bride Package A + B","web_name":null,"price":20000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1360,"for_gender":"any","was":[]},
  {"chart":false,"category":"Bridal Packages","name":"Pre-Bridal Package (5 days prior)","web_name":null,"price":10000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1370,"for_gender":"any","was":[]},
  {"chart":false,"category":"Bridal Packages","name":"Wedding Day Package (Bride)","web_name":null,"price":10000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1380,"for_gender":"any","was":[]},
  {"chart":false,"category":"Bridal Packages","name":"Reception Package (Contemporary)","web_name":null,"price":6000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1390,"for_gender":"any","was":[]},
  {"chart":false,"category":"Bridal Packages","name":"Wedding Premium (Friends & Relatives)","web_name":null,"price":3000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1400,"for_gender":"any","was":[]},
  {"chart":false,"category":"Groom Packages","name":"Groom Pre-Wedding Package","web_name":null,"price":7000,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1410,"for_gender":"any","was":[]},
  {"chart":false,"category":"Groom Packages","name":"Advance Groom Package","web_name":null,"price":10000,"variants":null,"extra_options":null,"open_price":true,"sac":"999729","gst_pct":5,"sort":1420,"for_gender":"any","was":[]},
  {"chart":false,"category":"Groom Packages","name":"Wedding Day Groom Make-up","web_name":null,"price":4000,"variants":null,"extra_options":null,"open_price":false,"sac":"999729","gst_pct":5,"sort":1430,"for_gender":"any","was":[]}]$svcs$;
  -- October categories: where their offers now apply, and where their services not on the chart are kept (hidden)
  v_old jsonb := $old${"Haircut":{"home":"Men's Cut & Grooming","now":["Men's Cut & Grooming","Women's Cut & Styling"]},"Blow Dry & Styling":{"home":"Women's Cut & Styling","now":["Women's Cut & Styling","Men's Cut & Grooming"]},"Head Massage":{"home":"Women's Hair Spa","now":["Men's Hair Spa","Women's Hair Spa"]},"Hair Colour":{"home":"Women's Colour","now":["Men's Colour","Women's Colour"]},"Hair Spa":{"home":"Women's Hair Spa","now":["Men's Hair Spa","Women's Hair Spa"]},"Waxing":{"home":"Rica Wax","now":["Rica Wax","Men's Rica Wax","Peel-off Wax (Face & Underarms)"]},"D-Tan / Bleach":{"home":"Raaga D-Tan","now":["Raaga D-Tan","O3+ D-Tan"]},"Clean-up & Facials":{"home":"Lotus Professional Facials","now":["Lotus Professional Facials","O3+ Facials"]},"Add-on Mask":{"home":"O3+ Facials","now":[]}}$old$;
  v_old_tabs jsonb := $tabs${"Hair":["Hair","Colour","Hair Spa","Hair Treatments"],"Beauty":["Facials","D-Tan","Threading","Waxing","Nails","Beauty"]}$tabs$;
  v_chart text[] := array['Men''s Cut & Grooming', 'Women''s Cut & Styling', 'Men''s Colour', 'Women''s Colour', 'Men''s Hair Spa', 'Women''s Hair Spa', 'Hair Treatments', 'Lotus Professional Facials', 'O3+ Facials', 'Raaga D-Tan', 'O3+ D-Tan', 'Threading', 'Rica Wax', 'Men''s Rica Wax', 'Peel-off Wax (Face & Underarms)', 'Haircut', 'Blow Dry & Styling', 'Head Massage', 'Hair Colour', 'Hair Spa', 'Waxing', 'D-Tan / Bleach', 'Clean-up & Facials', 'Add-on Mask'];
  v_first boolean;
  c record;
  s record;
  v_id uuid;
  v_cat uuid;
  v_done uuid[] := '{}';
begin
  -- The October menu is still here (first run on the live database): offers are moved too
  v_first := exists (select 1 from service_categories where name in (select jsonb_object_keys(v_old)));

  -- 1. Categories, by name: added, or put on the chart's tab, order and website place
  for c in select * from jsonb_to_recordset(v_cats) as x(section text, name text, slug text, sort int, web_page text, web_tab text,
                                                         web_type text, consult_only boolean, note text) loop
    update service_categories
       set section = c.section, sort = c.sort, web_page = c.web_page, web_tab = c.web_tab, web_type = c.web_type,
           consult_only = c.consult_only, note = coalesce(note, c.note)
     where lower(name) = lower(c.name);
    if not found then
      insert into service_categories (section, name, slug, sort, web_page, web_tab, web_type, consult_only, note)
      values (c.section, c.name, case when exists (select 1 from service_categories where slug = c.slug) then null else c.slug end,
              c.sort, c.web_page, c.web_tab, c.web_type, c.consult_only, c.note);
    end if;
  end loop;

  -- 2. Services: the row with this name, or with its October name, is kept and updated; otherwise added
  for s in select * from jsonb_to_recordset(v_svcs) as x(chart boolean, category text, name text, web_name text, price numeric, variants jsonb,
                                                         extra_options jsonb, open_price boolean, sac text, gst_pct numeric, sort int,
                                                         for_gender text, was jsonb) loop
    select id into v_cat from service_categories where lower(name) = lower(s.category);
    select id into v_id from services
     where not (id = any (v_done))
       and (lower(name) = lower(s.name) or lower(name) in (select lower(w) from jsonb_array_elements_text(s.was) w))
     order by lower(name) = lower(s.name) desc, active desc, sort, created_at
     limit 1;
    if v_id is null then
      insert into services (category_id, name, web_name, price, variants, extra_options, open_price, sac, gst_pct, sort, active, for_gender)
      values (v_cat, s.name, s.web_name, s.price, s.variants, s.extra_options, s.open_price, s.sac, s.gst_pct, s.sort, true, s.for_gender)
      returning id into v_id;
    elsif s.chart then
      update services
         set category_id = v_cat, category = s.category, name = s.name, web_name = s.web_name, price = s.price, variants = s.variants,
             extra_options = s.extra_options, open_price = s.open_price, sac = s.sac, gst_pct = s.gst_pct, sort = s.sort,
             active = true, for_gender = s.for_gender
       where id = v_id;
    end if;
    v_done := v_done || v_id;
  end loop;

  -- 3. Not on the chart: hidden from billing (old bills keep them)
  update services set active = false
   where active and not (id = any (v_done)) and category = any (v_chart);

  -- 4. Offers made for an October category or tab apply to the new ones (first run only)
  if v_first then
    update offers o
       set categories = coalesce((select array_agg(distinct n order by n)
                                  from unnest(o.categories) oc
                                  cross join lateral (select jsonb_array_elements_text(v_old -> oc -> 'now') where v_old ? oc
                                                      union all select oc where not v_old ? oc) m(n)), '{}')
     where o.categories && (select array_agg(k) from jsonb_object_keys(v_old) k);
    update offers o
       set sections = (select array_agg(distinct n order by n)
                       from unnest(o.sections) os
                       cross join lateral (select jsonb_array_elements_text(v_old_tabs -> os) where v_old_tabs ? os
                                           union all select os where not v_old_tabs ? os) m(n))
     where o.sections && array['Hair', 'Beauty'];
  end if;

  -- 5. October categories: their hidden services move to the chart category nearest to them, then the empty category goes
  for c in select key as old_name, value ->> 'home' as home from jsonb_each(v_old) loop
    select id into v_cat from service_categories where name = c.home;
    update services set category_id = v_cat, category = c.home where category = c.old_name;
    delete from service_categories where name = c.old_name and not exists (select 1 from services where category_id = service_categories.id);
  end loop;
end
$chart$;

select set_config('app.no_log', '', false);

-- Check: each tab and category with the number of services in billing (and hidden ones)
select c.section as tab, c.name as category,
       count(s.id) filter (where s.active) as in_billing, count(s.id) filter (where not s.active) as hidden
from service_categories c left join services s on s.category_id = c.id
group by c.id order by c.sort, c.name;
