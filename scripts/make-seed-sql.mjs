// Generates supabase/02_seed_services.sql (the rate chart) from src/data/menu.js
// Run: node scripts/make-seed-sql.mjs
import { writeFileSync } from 'node:fs';
import { menuToServices, menuToCategories, OLD_CATEGORIES, OLD_SECTIONS, CHART_CATEGORIES } from '../src/data/menu.js';

const cats = menuToCategories();
const svcs = menuToServices();
const dollar = (tag, v) => `$${tag}$${JSON.stringify(v, null, 0).replace(/\},\{/g, '},\n  {')}$${tag}$`;
const arr = (a) => `array[${a.map((x) => `'${x.replace(/'/g, "''")}'`).join(', ')}]`;

const catRows = cats.map((c) => ({ section: c.section, name: c.name, slug: c.slug, sort: c.sort, web_page: c.web_page, web_tab: c.web_tab, web_type: c.web_type, consult_only: c.consult_only, note: c.note }));
const chart = new Set(CHART_CATEGORIES);
const svcRows = svcs.map((r) => ({
  chart: chart.has(r.category), category: r.category, name: r.name, web_name: r.web_name, price: r.price, variants: r.variants, extra_options: r.extra_options,
  open_price: r.open_price, sac: r.sac, gst_pct: r.gst_pct, sort: r.sort, for_gender: r.for_gender, was: r.was,
}));

const sql = `-- Habibs Fuljhore rate chart, November 2026: ${cats.length} categories, ${svcs.length} services.
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
  v_cats jsonb := ${dollar('cats', catRows)};
  v_svcs jsonb := ${dollar('svcs', svcRows)};
  -- October categories: where their offers now apply, and where their services not on the chart are kept (hidden)
  v_old jsonb := ${dollar('old', OLD_CATEGORIES)};
  v_old_tabs jsonb := ${dollar('tabs', OLD_SECTIONS)};
  v_chart text[] := ${arr(CHART_CATEGORIES)};
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
`;
writeFileSync(new URL('../supabase/02_seed_services.sql', import.meta.url), sql);
console.log('categories:', cats.length, 'services:', svcs.length);
