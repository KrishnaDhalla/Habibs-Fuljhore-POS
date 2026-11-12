-- Check the setup. Run after 01, 02 and 03. Every line should show what is in the "should be" column.
select 'service categories' as what, count(*)::text as found, '19' as should_be from service_categories
union all select 'services in billing (rate chart, Nov 2026)', count(*)::text, '143' from services where active
union all select 'billing tabs with services', count(distinct section)::text, '10' from services where active
union all select 'settings', count(*)::text, '45' from settings
union all select 'tables without row level security', count(*)::text, '0' from pg_tables where schemaname = 'public' and not rowsecurity
union all select 'website menu groups (web_site)', jsonb_array_length(web_site() -> 'menu')::text, '19'
union all select 'owners', count(*)::text, '1 or more' from app_roles where role = 'owner'
union all select 'Bottle check report works', case when unit_report() ? 'products' then 'yes' else 'no' end, 'yes';
