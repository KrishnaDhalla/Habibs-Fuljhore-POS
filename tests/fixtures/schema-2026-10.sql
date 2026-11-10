-- =====================================================================
-- Habibs POS — database schema (Supabase / PostgreSQL)
-- Run this once in Supabase: SQL Editor → New query → paste → Run.
-- Then run 02_seed_services.sql to load the service menu,
-- and 03_owners.sql to mark the owner logins. Safe to run again after updates.
--
-- Design rules (keep these when you add the Customer Intelligence tables):
--   * One database for everything. Every source (POS, bookings, WhatsApp,
--     CCTV counts) writes its own tables here.
--   * customers.phone is the key that joins everything about a person.
--   * All times are stored as timestamptz (UTC). Convert with
--     "at time zone 'Asia/Kolkata'" when grouping by day or hour.
--   * Bills are never deleted or edited. A mistake is fixed by cancelling
--     the bill (status = 'cancelled') and making a new one.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- Settings (salon name, GSTIN, owner PIN hash, etc.) ----------
create table if not exists settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);

-- ---------- Service menu ----------
create table if not exists services (
  id          uuid primary key default gen_random_uuid(),
  section     text not null,                 -- Hair / Beauty / Makeup
  category    text not null,                 -- Haircut, Hair Spa, Waxing ...
  name        text not null,
  price       numeric(10,2) not null default 0,
  variants    jsonb,                         -- [{"label":"S","price":2500}, ...] or null
  open_price  boolean not null default false,-- price typed at billing ("Onwards", "+")
  sac         text,                          -- GST SAC code
  gst_pct     numeric(5,2) not null default 5,
  sort        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- ---------- Customers (one row per mobile number) ----------
create table if not exists customers (
  id           uuid primary key default gen_random_uuid(),
  phone        text not null unique,           -- 10-digit mobile, no +91
  name         text,
  gender       text check (gender in ('F','M','O')),
  birthday     date,
  source       text,                           -- how they found us: Instagram, Google, Friend ...
  whatsapp_ok  boolean not null default false, -- agreed to receive offers on WhatsApp
  notes        text,
  visits       int not null default 0,         -- kept up to date by create_bill / cancel_bill
  total_spent  numeric(12,2) not null default 0,
  first_visit  timestamptz,
  last_visit   timestamptz,
  created_at   timestamptz not null default now()
);

-- ---------- Staff ----------
create table if not exists staff (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null,
  phone                   text,
  role                    text,                -- Stylist, Beautician, Receptionist, Manager, Helper
  join_date               date,
  monthly_salary          numeric(10,2) not null default 0,
  service_commission_pct  numeric(5,2) not null default 0,
  product_commission_pct  numeric(5,2) not null default 0,
  upi_id                  text,
  address                 text,
  notes                   text,
  active                  boolean not null default true,
  created_at              timestamptz not null default now()
);

-- One row per staff per day. No row = present.
create table if not exists attendance (
  id        uuid primary key default gen_random_uuid(),
  staff_id  uuid not null references staff(id) on delete cascade,
  day       date not null,
  status    text not null check (status in ('P','A','H','W')), -- Present, Absent, Half day, Week off (paid)
  unique (staff_id, day)
);

create table if not exists staff_advances (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff(id) on delete cascade,
  day         date not null,
  amount      numeric(10,2) not null,
  note        text,
  created_at  timestamptz not null default now()
);

create table if not exists payslips (
  id              uuid primary key default gen_random_uuid(),
  staff_id        uuid not null references staff(id) on delete cascade,
  month           text not null,               -- '2026-10'
  days_in_month   int not null,
  paid_days       numeric(5,1) not null,
  absent_days     numeric(5,1) not null default 0,
  half_days       numeric(5,1) not null default 0,
  monthly_salary  numeric(10,2) not null,
  salary_earned   numeric(10,2) not null,
  service_sales   numeric(12,2) not null default 0,
  product_sales   numeric(12,2) not null default 0,
  commission      numeric(10,2) not null default 0,
  incentive       numeric(10,2) not null default 0,
  advances        numeric(10,2) not null default 0,
  deductions      numeric(10,2) not null default 0,
  net_pay         numeric(10,2) not null,
  status          text not null default 'paid' check (status in ('draft','paid')),
  paid_on         date,
  paid_mode       text,
  note            text,
  created_at      timestamptz not null default now(),
  unique (staff_id, month)
);

-- ---------- Inventory ----------
create table if not exists products (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  brand       text,
  kind        text not null default 'retail' check (kind in ('retail','salon')), -- retail = sold, salon = used in services
  unit        text not null default 'pcs',
  stock       numeric(12,2) not null default 0,  -- kept up to date by stock_moves trigger
  low_stock   numeric(12,2) not null default 2,
  cost_price  numeric(10,2) not null default 0,
  sell_price  numeric(10,2) not null default 0,
  hsn         text,
  gst_pct     numeric(5,2) not null default 18,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- Every stock change is a row here. qty is + for stock coming in, - for stock going out.
create table if not exists stock_moves (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references products(id) on delete cascade,
  type        text not null check (type in ('in','use','sale','adjust','return')),
  qty         numeric(12,2) not null,
  unit_cost   numeric(10,2),
  supplier    text,
  note        text,
  bill_id     uuid,
  created_at  timestamptz not null default now()
);

-- ---------- Billing ----------
create table if not exists bills (
  id               uuid primary key default gen_random_uuid(),
  bill_no          text not null unique,         -- HF2627-0001 (resets every financial year)
  created_at       timestamptz not null default now(),
  customer_id      uuid references customers(id),
  customer_name    text,
  customer_phone   text,
  is_new_customer  boolean not null default false,-- first paid visit
  subtotal         numeric(12,2) not null,        -- before discount
  discount         numeric(12,2) not null default 0,
  taxable          numeric(12,2) not null,        -- after discount, without GST
  cgst             numeric(12,2) not null default 0,
  sgst             numeric(12,2) not null default 0,
  round_off        numeric(6,2)  not null default 0,
  total            numeric(12,2) not null,        -- what the customer paid
  pay_mode         text not null,                 -- Cash, UPI, Card, Split
  paid_cash        numeric(12,2) not null default 0,
  paid_upi         numeric(12,2) not null default 0,
  paid_card        numeric(12,2) not null default 0,
  status           text not null default 'paid' check (status in ('paid','cancelled')),
  cancel_reason    text,
  cancelled_at     timestamptz,
  note             text,
  created_by       text
);

create table if not exists bill_items (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills(id) on delete cascade,
  created_at  timestamptz not null default now(),
  item_type   text not null check (item_type in ('service','product')),
  service_id  uuid references services(id) on delete set null,
  product_id  uuid references products(id) on delete set null,
  name        text not null,
  category    text,
  hsn_sac     text,
  staff_id    uuid references staff(id) on delete set null,
  staff_name  text,
  qty         numeric(10,2) not null default 1,
  unit_price  numeric(10,2) not null,
  amount      numeric(12,2) not null,   -- qty x unit_price
  discount    numeric(12,2) not null default 0,
  taxable     numeric(12,2) not null,   -- after discount, without GST (commission is paid on this)
  gst_pct     numeric(5,2) not null default 0,
  gst         numeric(12,2) not null default 0
);

-- ---------- Offers (festival offers, weekly offer days, happy hours) ----------
-- The billing screen applies a running offer by itself. Leave a field empty for "no limit".
create table if not exists offers (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,                  -- shown on the bill, e.g. "Pujo Ready 20% off"
  active              boolean not null default true,  -- switch off without deleting
  starts_on           date,                           -- first day (empty = already started)
  ends_on             date,                           -- last day  (empty = no end)
  days                int[],                          -- weekdays 1 = Mon … 7 = Sun (empty = every day)
  start_time          time,                           -- e.g. 11:00 for happy hours (empty = from opening)
  end_time            time,                           -- e.g. 15:00 (empty = till closing)
  applies_to          text not null default 'all' check (applies_to in ('all','section','category','services')),
  sections            text[],                         -- Hair / Beauty / Makeup
  categories          text[],                         -- e.g. Hair Spa, Waxing
  service_ids         uuid[],                         -- chosen services
  include_products    boolean not null default false, -- also on retail products (only with "all")
  kind                text not null default 'percent' check (kind in ('percent','amount','price')),
  value               numeric(10,2) not null,         -- 20 (%), 100 (₹ off each), or 499 (special price)
  min_bill            numeric(10,2) not null default 0,  -- bill must be at least this (0 = any bill)
  max_discount        numeric(10,2),                  -- most this offer can take off one bill (empty = no cap)
  new_customers_only  boolean not null default false,
  note                text,
  created_at          timestamptz not null default now()
);

alter table staff      add column if not exists leave_date date;    -- last working day, for the final salary

-- ---------- Stock control (salon-use products) ----------
-- A salon-use product has a type and a size, e.g. "Majirel 6.0", type colour, 60 g per tube.
-- Each service says how much of it one service uses (service_usage). Every bill then tells us how much
-- SHOULD have been used; every tube / jar taken out of the store is recorded with who took it.
-- The Stock check report compares the two.
alter table products    add column if not exists use_type  text;            -- colour, developer, spa, wax, kit …
alter table products    add column if not exists size      numeric(10,2);   -- how much is in one unit, e.g. 60
alter table products    add column if not exists size_unit text;            -- g, ml or uses
alter table stock_moves add column if not exists staff_id  uuid references staff(id) on delete set null; -- who took it out
alter table stock_moves add column if not exists empty_returned boolean;    -- the finished one was handed back
alter table stock_moves add column if not exists created_by text;           -- login that recorded it
alter table stock_moves add column if not exists owner_grant_id uuid;       -- the owner's approval, if it needed one

create table if not exists service_usage (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  amount      numeric(10,2) not null default 0,  -- per service, in the product's size unit (g / ml / uses)
  amounts     jsonb,                              -- per option, e.g. {"S": 60, "M": 90, "L": 120}
  created_at  timestamptz not null default now(),
  unique (service_id, product_id)
);
alter table bills      add column if not exists offer_discount numeric(12,2) not null default 0;
alter table bill_items add column if not exists offer_id uuid references offers(id) on delete set null;
alter table bill_items add column if not exists offer_name text;
alter table bill_items add column if not exists offer_discount numeric(12,2) not null default 0;

create table if not exists counters (
  key   text primary key,
  value int not null default 0
);

create index if not exists bills_created_idx      on bills (created_at);
create index if not exists bills_customer_idx     on bills (customer_id);
create index if not exists bill_items_bill_idx    on bill_items (bill_id);
create index if not exists bill_items_created_idx on bill_items (created_at);
create index if not exists bill_items_staff_idx   on bill_items (staff_id);
create index if not exists stock_moves_prod_idx   on stock_moves (product_id, created_at);
create index if not exists attendance_day_idx     on attendance (day);
create index if not exists advances_day_idx       on staff_advances (day);

-- =====================================================================
-- Logic
-- =====================================================================

-- Keep products.stock in step with stock_moves
create or replace function apply_stock_move() returns trigger
language plpgsql as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    update products set stock = stock - old.qty where id = old.product_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    update products set stock = stock + new.qty where id = new.product_id;
  end if;
  return null;
end $$;

drop trigger if exists trg_apply_stock_move on stock_moves;
create trigger trg_apply_stock_move after insert or update or delete on stock_moves
for each row execute function apply_stock_move();

-- The counter can change a product's stock count and cost price (stock coming in),
-- but its name, selling price or GST only with the owner's approval
create or replace function guard_product_change() returns trigger
language plpgsql as $$
begin
  if not owner_ok() and (new.name, new.brand, new.kind, new.unit, new.low_stock, new.sell_price, new.hsn, new.gst_pct, new.active, new.use_type, new.size, new.size_unit)
     is distinct from (old.name, old.brand, old.kind, old.unit, old.low_stock, old.sell_price, old.hsn, old.gst_pct, old.active, old.use_type, old.size, old.size_unit) then
    raise exception 'Owner approval needed to change a product''s details or price';
  end if;
  return new;
end $$;

drop trigger if exists trg_guard_product on products;
create trigger trg_guard_product before update on products
for each row execute function guard_product_change();

-- Recalculate a customer's visit count and spend from their paid bills,
-- and mark their first paid bill as the "new customer" visit (right even when
-- bills made offline upload later, or the first bill is cancelled)
create or replace function refresh_customer_stats(p_customer uuid) returns void
language plpgsql as $$
declare v_first uuid;
begin
  update customers c set
    visits      = s.visits,
    total_spent = s.spent,
    first_visit = s.first_visit,
    last_visit  = s.last_visit
  from (
    select count(*)::int as visits, coalesce(sum(total), 0) as spent,
           min(created_at) as first_visit, max(created_at) as last_visit
    from bills where customer_id = p_customer and status = 'paid'
  ) s
  where c.id = p_customer;

  select id into v_first from bills
  where customer_id = p_customer and status = 'paid'
  order by created_at, id limit 1;
  if v_first is not null then
    update bills set is_new_customer = (id = v_first)
    where customer_id = p_customer and status = 'paid' and is_new_customer is distinct from (id = v_first);
  end if;
end $$;

-- Checks that every figure of a bill adds up, to the paisa (same rules as checkBill in src/lib/calc.js).
-- Prices may include GST (taxable = net ÷ (1 + rate)) or have GST added (GST = net × rate).
create or replace function check_bill(p jsonb) returns void
language plpgsql immutable as $$
declare
  it jsonb;
  v_name text;
  v_qty numeric; v_price numeric; v_amt numeric; v_off numeric; v_disc numeric;
  v_tax numeric; v_gst numeric; v_rate numeric; v_net numeric;
  s_amt numeric := 0; s_off numeric := 0; s_disc numeric := 0; s_tax numeric := 0; s_gst numeric := 0;
  v_rates int;
  v_grand numeric;
  n numeric;
begin
  if jsonb_typeof(p->'items') is distinct from 'array' or jsonb_array_length(p->'items') = 0 then
    raise exception 'A bill needs at least one item';
  end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_name  := coalesce(it->>'name', 'item');
    v_qty   := (it->>'qty')::numeric;
    v_price := (it->>'unit_price')::numeric;
    v_amt   := (it->>'amount')::numeric;
    v_off   := coalesce((it->>'offer_discount')::numeric, 0);
    v_disc  := coalesce((it->>'discount')::numeric, 0);
    v_tax   := (it->>'taxable')::numeric;
    v_gst   := coalesce((it->>'gst')::numeric, 0);
    v_rate  := coalesce((it->>'gst_pct')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty <> trunc(v_qty) then
      raise exception 'Bill check failed: %: quantity must be a whole number above 0', v_name;
    end if;
    if v_price is null or v_price < 0 or v_amt is null or v_tax is null then
      raise exception 'Bill check failed: %: price, amount or taxable value missing', v_name;
    end if;
    if v_amt <> round(v_qty * v_price, 2) then
      raise exception 'Bill check failed: %: amount is not quantity × price', v_name;
    end if;
    if v_off < 0 or v_off > v_disc or v_disc > v_amt then
      raise exception 'Bill check failed: %: discount is wrong', v_name;
    end if;
    if v_tax < 0 or v_gst < 0 or v_rate < 0 then
      raise exception 'Bill check failed: %: taxable value or GST below 0', v_name;
    end if;
    v_net := v_amt - v_disc;
    if v_rate = 0 then
      if v_gst <> 0 or v_tax <> v_net then
        raise exception 'Bill check failed: %: taxable value doesn''t match', v_name;
      end if;
    elsif not ((v_tax + v_gst = v_net and v_tax = round(v_net * 100 / (100 + v_rate), 2))
            or (v_tax = v_net and v_gst = round(v_net * v_rate / 100, 2))) then
      raise exception 'Bill check failed: %: GST doesn''t match the rate', v_name;
    end if;
    s_amt := s_amt + v_amt; s_off := s_off + v_off; s_disc := s_disc + v_disc;
    s_tax := s_tax + v_tax; s_gst := s_gst + v_gst;
  end loop;

  select count(distinct (e->>'gst_pct')::numeric) into v_rates
  from jsonb_array_elements(p->'items') e where coalesce((e->>'gst_pct')::numeric, 0) > 0;

  if (p->>'subtotal')::numeric is distinct from s_amt then raise exception 'Bill check failed: subtotal is not the sum of the items'; end if;
  if coalesce((p->>'offer_discount')::numeric, 0) <> s_off then raise exception 'Bill check failed: offer discount is not the sum of the items'; end if;
  if coalesce((p->>'discount')::numeric, 0) <> s_disc then raise exception 'Bill check failed: discount is not the sum of the items'; end if;
  if (p->>'taxable')::numeric is distinct from s_tax then raise exception 'Bill check failed: taxable value is not the sum of the items'; end if;
  if coalesce((p->>'cgst')::numeric, 0) + coalesce((p->>'sgst')::numeric, 0) <> s_gst
     or coalesce((p->>'cgst')::numeric, 0) < 0 or coalesce((p->>'sgst')::numeric, 0) < 0
     or abs(coalesce((p->>'cgst')::numeric, 0) - coalesce((p->>'sgst')::numeric, 0)) > 0.01 * v_rates then
    raise exception 'Bill check failed: CGST and SGST must be the two halves of the GST';
  end if;
  v_grand := s_tax + s_gst;
  n := (p->>'total')::numeric;
  if n is null or n < 0 or n <> round(v_grand, 0) then
    raise exception 'Bill check failed: total is not (taxable value + GST) rounded to the rupee';
  end if;
  if coalesce((p->>'round_off')::numeric, 0) <> n - v_grand then
    raise exception 'Bill check failed: round off is wrong';
  end if;
  if coalesce((p->>'paid_cash')::numeric, 0) < 0 or coalesce((p->>'paid_upi')::numeric, 0) < 0 or coalesce((p->>'paid_card')::numeric, 0) < 0
     or coalesce((p->>'paid_cash')::numeric, 0) + coalesce((p->>'paid_upi')::numeric, 0) + coalesce((p->>'paid_card')::numeric, 0) <> n then
    raise exception 'Bill check failed: payments do not add up to the total';
  end if;
  if coalesce(p->>'pay_mode', '') not in ('Cash', 'UPI', 'Card', 'Split') then
    raise exception 'Bill check failed: payment mode missing';
  end if;
end $$;

-- Indian financial year of a moment, as used in bill numbers: 1 Apr 2026 – 31 Mar 2027 → '2627'
create or replace function fy_code(t timestamptz) returns text
language sql stable as $$
  select lpad((y % 100)::text, 2, '0') || lpad(((y + 1) % 100)::text, 2, '0')
  from (select extract(year from t at time zone 'Asia/Kolkata')::int
               - case when extract(month from t at time zone 'Asia/Kolkata') < 4 then 1 else 0 end as y) x;
$$;

-- Save a whole bill in one go (customer, bill number, items, stock).
-- Either everything is saved or nothing is.
-- The app sends its own bill id, so sending the same bill twice never makes two bills.
-- Bills made without internet arrive later with their own number (HF2627-A0001) and the time they were made.
-- Runs with the database's own rights (security definer): the app can read bills but never edit or delete them directly.
create or replace function create_bill(p jsonb) returns bills
language plpgsql security definer set search_path = public as $$
declare
  v_cust   customers;
  v_bill   bills;
  v_id     uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_at     timestamptz := coalesce(nullif(p->>'created_at', '')::timestamptz, now());
  v_no     text := nullif(p->>'bill_no', '');
  v_note   text := nullif(p->>'note', '');
  v_fy     text;
  v_n      int;
  v_k      int := 2;
  v_prefix text;
  v_new    boolean := false;
  v_phone  text := nullif(p->>'customer_phone', '');
  it       jsonb;
  v_prod   uuid;
  v_base   numeric;
  v_manual numeric;
  v_max    numeric;
begin
  -- Approved app logins only (or the owner working directly in the Supabase SQL editor / with the service key)
  if not (session_ok() or coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}')
          or auth.jwt() ->> 'role' = 'service_role') then
    raise exception 'This login is not approved yet';
  end if;

  -- The same bill sent twice at the same moment (two tabs uploading) waits here for the first one
  perform pg_advisory_xact_lock(hashtext(v_id::text));

  -- 0. Already saved? (the first try reached the database but the reply got lost)
  select * into v_bill from bills where id = v_id;
  if found then
    if v_no is not null and v_bill.bill_no <> v_no then
      update bills set note = concat_ws(' | ', note, 'Also printed offline as ' || v_no)
      where id = v_id and coalesce(note, '') not like '%Also printed offline as ' || v_no || '%'
      returning * into v_bill;
      select * into v_bill from bills where id = v_id;
    end if;
    return v_bill;
  end if;

  -- Every figure must add up, or nothing is saved
  perform check_bill(p);

  -- A tablet with a wrong clock can't put a bill in the future
  if v_at > now() + interval '10 minutes' then
    v_note := concat_ws(' | ', v_note, 'Device clock was ahead: ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'));
    v_at := now();
  end if;

  -- A discount above the limit (Settings) needs the owner: an owner login, an unlock,
  -- or the owner's approval for exactly this bill
  v_base := (p->>'subtotal')::numeric - coalesce((p->>'offer_discount')::numeric, 0);
  v_manual := coalesce((p->>'discount')::numeric, 0) - coalesce((p->>'offer_discount')::numeric, 0);
  v_max := coalesce(nullif((select value #>> '{}' from settings where key = 'max_discount_pct'), '')::numeric, 0);
  if v_base > 0 and v_manual * 100 >= (v_max + 0.005) * v_base
     and not use_owner_grant(nullif(p->>'owner_grant_id', '')::uuid, 'discount', v_id, v_at, v_manual) then
    raise exception '%', 'Owner approval needed: the discount is above the ' || trim_scale(v_max) || '% limit';
  end if;

  -- 1. Customer: find by phone, or create
  if v_phone is not null then
    if v_phone !~ '^[6-9][0-9]{9}$' then
      raise exception 'Bill check failed: mobile number must be 10 digits';
    end if;
    insert into customers (phone, name, gender, birthday, source, whatsapp_ok)
    values (v_phone,
            nullif(p->>'customer_name', ''),
            nullif(p->>'gender', ''),
            nullif(p->>'birthday', '')::date,
            nullif(p->>'source', ''),
            coalesce((p->>'whatsapp_ok')::boolean, false))
    on conflict (phone) do nothing;
    select * into v_cust from customers where phone = v_phone;
    if coalesce(p->>'customer_name', '') <> '' and v_cust.name is distinct from p->>'customer_name' then
      update customers set name = p->>'customer_name' where id = v_cust.id returning * into v_cust;
    end if;
    v_new := not exists (select 1 from bills where customer_id = v_cust.id and status = 'paid' and created_at < v_at);
  end if;

  -- 2. Bill number: <prefix><financial year>-<running number>, e.g. HF2627-0001
  --    Offline bills keep the number printed on them. If two devices used the same
  --    offline letter, the later one gets "-2" (or "-3" …) added and a note.
  if v_no is null then
    v_fy := fy_code(now());
    v_prefix := coalesce((select value #>> '{}' from settings where key = 'bill_prefix'), 'HF');
    insert into counters (key, value) values ('bill-' || v_fy, 1)
    on conflict (key) do update set value = counters.value + 1
    returning value into v_n;
    v_no := v_prefix || v_fy || '-' || lpad(v_n::text, 4, '0');
  elsif exists (select 1 from bills where bill_no = v_no) then
    v_note := concat_ws(' | ', v_note, 'Number clash: printed as ' || v_no);
    while exists (select 1 from bills where bill_no = v_no || '-' || v_k) loop
      v_k := v_k + 1;
    end loop;
    v_no := v_no || '-' || v_k;
  end if;

  -- 3. Bill
  insert into bills (id, bill_no, created_at, customer_id, customer_name, customer_phone, is_new_customer,
                     subtotal, offer_discount, discount, taxable, cgst, sgst, round_off, total,
                     pay_mode, paid_cash, paid_upi, paid_card, note, created_by)
  values (v_id, v_no, v_at,
          v_cust.id, coalesce(nullif(p->>'customer_name', ''), v_cust.name), v_phone, v_new,
          (p->>'subtotal')::numeric, coalesce((p->>'offer_discount')::numeric, 0),
          coalesce((p->>'discount')::numeric, 0), (p->>'taxable')::numeric,
          coalesce((p->>'cgst')::numeric, 0), coalesce((p->>'sgst')::numeric, 0),
          coalesce((p->>'round_off')::numeric, 0), (p->>'total')::numeric,
          p->>'pay_mode', coalesce((p->>'paid_cash')::numeric, 0), coalesce((p->>'paid_upi')::numeric, 0),
          coalesce((p->>'paid_card')::numeric, 0), v_note, nullif(p->>'created_by', ''))
  returning * into v_bill;

  -- 4. Items (+ stock out for products). A service, product, staff member or offer deleted
  --    while this bill waited offline is kept by name only, so the bill still uploads.
  for it in select * from jsonb_array_elements(p->'items') loop
    v_prod := (select id from products where id = nullif(it->>'product_id', '')::uuid);
    insert into bill_items (bill_id, created_at, item_type, service_id, product_id, name, category, hsn_sac,
                            staff_id, staff_name, qty, unit_price, amount, offer_id, offer_name, offer_discount,
                            discount, taxable, gst_pct, gst)
    values (v_bill.id, v_bill.created_at, it->>'item_type',
            (select id from services where id = nullif(it->>'service_id', '')::uuid), v_prod,
            it->>'name', it->>'category', nullif(it->>'hsn_sac', ''),
            (select id from staff where id = nullif(it->>'staff_id', '')::uuid), nullif(it->>'staff_name', ''),
            (it->>'qty')::numeric, (it->>'unit_price')::numeric, (it->>'amount')::numeric,
            (select id from offers where id = nullif(it->>'offer_id', '')::uuid), nullif(it->>'offer_name', ''),
            coalesce((it->>'offer_discount')::numeric, 0),
            coalesce((it->>'discount')::numeric, 0), (it->>'taxable')::numeric,
            coalesce((it->>'gst_pct')::numeric, 0), coalesce((it->>'gst')::numeric, 0));

    if it->>'item_type' = 'product' and v_prod is not null then
      insert into stock_moves (product_id, type, qty, bill_id, note, created_at)
      values (v_prod, 'sale', -((it->>'qty')::numeric), v_bill.id, v_bill.bill_no, v_bill.created_at);
    end if;
  end loop;

  -- 5. Customer visit count and spend
  if v_cust.id is not null then
    perform refresh_customer_stats(v_cust.id);
    select * into v_bill from bills where id = v_bill.id;
  end if;

  return v_bill;
end $$;

-- Cancel a bill: keeps the row (for GST records), puts products back in stock
create or replace function cancel_bill(p_id uuid, p_reason text) returns bills
language plpgsql security definer set search_path = public as $$
declare
  v_bill bills;
begin
  -- Approved app logins only (or the owner working directly in the Supabase SQL editor / with the service key)
  if not (session_ok() or coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}')
          or auth.jwt() ->> 'role' = 'service_role') then
    raise exception 'This login is not approved yet';
  end if;
  if not use_owner_grant(find_owner_grant('cancel', p_id), 'cancel', p_id, now(), 0) then
    raise exception 'Owner approval needed to cancel a bill';
  end if;
  update bills set status = 'cancelled', cancel_reason = p_reason, cancelled_at = now()
  where id = p_id and status = 'paid'
  returning * into v_bill;
  if not found then
    raise exception 'Bill not found or already cancelled';
  end if;

  insert into stock_moves (product_id, type, qty, bill_id, note)
  select product_id, 'return', -qty, bill_id, 'Cancelled ' || v_bill.bill_no
  from stock_moves where bill_id = p_id and type = 'sale';

  if v_bill.customer_id is not null then
    perform refresh_customer_stats(v_bill.customer_id);
  end if;
  return v_bill;
end $$;

-- =====================================================================
-- Ready-made views for dashboards and the AI agent (read-only)
-- =====================================================================

-- Every sold line with its bill, in Indian time
create or replace view v_sales_lines with (security_invoker = on) as
select i.id, b.bill_no, b.created_at,
       (b.created_at at time zone 'Asia/Kolkata')::date              as day,
       extract(hour from b.created_at at time zone 'Asia/Kolkata')::int as hour,
       b.customer_id, b.customer_phone, b.is_new_customer, b.pay_mode,
       i.item_type, i.name, i.category, i.staff_id, i.staff_name,
       i.qty, i.amount, i.discount, i.taxable, i.gst
from bill_items i join bills b on b.id = i.bill_id
where b.status = 'paid';

-- One row per day
create or replace view v_daily_sales with (security_invoker = on) as
select (created_at at time zone 'Asia/Kolkata')::date as day,
       count(*)                                        as bills,
       sum(total)                                      as revenue,
       round(avg(total), 2)                            as avg_bill,
       count(*) filter (where is_new_customer)          as new_customers,
       count(*) filter (where not is_new_customer and customer_id is not null) as returning_customers,
       sum(discount)                                   as discount,
       sum(cgst + sgst)                                as gst,
       sum(paid_cash) as cash, sum(paid_upi) as upi, sum(paid_card) as card
from bills where status = 'paid'
group by 1;

-- Busy hours (bills per hour of day per weekday)
-- How each offer did: bills, sales after discount, and what it cost in discount
create or replace view v_offer_performance with (security_invoker = on) as
select i.offer_name,
       min(b.created_at at time zone 'Asia/Kolkata')::date as first_day,
       max(b.created_at at time zone 'Asia/Kolkata')::date as last_day,
       count(distinct i.bill_id)                          as bills,
       count(distinct b.customer_id) filter (where b.is_new_customer) as new_customers,
       sum(i.amount - i.discount)                         as sales,
       sum(i.offer_discount)                              as discount_given
from bill_items i join bills b on b.id = i.bill_id
where b.status = 'paid' and i.offer_discount > 0
group by i.offer_name;

create or replace view v_hourly_traffic with (security_invoker = on) as
select extract(isodow from created_at at time zone 'Asia/Kolkata')::int as weekday, -- 1 = Monday
       extract(hour   from created_at at time zone 'Asia/Kolkata')::int as hour,
       count(*) as bills, sum(total) as revenue
from bills where status = 'paid'
group by 1, 2;

-- =====================================================================
-- Login approval
-- An owner's login works straight away. Any other login (the counter, staff)
-- creates a request, and the data stays locked for that login until an owner
-- approves it (Telegram button or the Logins screen in the app).
-- Approval is per login on a device: signing in again needs a new approval.
-- =====================================================================
create table if not exists app_roles (
  user_id  uuid primary key,          -- id from Authentication → Users
  role     text not null check (role in ('owner','staff')),
  name     text
);

create table if not exists login_requests (
  session_id   uuid primary key,      -- one sign-in on one device
  user_id      uuid not null,
  email        text,
  device       text,
  status       text not null default 'pending' check (status in ('pending','approved','denied')),
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  decided_at   timestamptz,
  decided_by   text
);

create or replace function current_session_id() returns uuid
language sql stable as $$
  select nullif(auth.jwt() ->> 'session_id', '')::uuid;
$$;

create or replace function is_owner() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from app_roles where user_id = auth.uid() and role = 'owner');
$$;

-- True when this login may use the data
create or replace function session_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select is_owner() or exists (
    select 1 from login_requests
    where session_id = current_session_id() and user_id = auth.uid() and status = 'approved');
$$;

-- 'owner', 'approved', 'pending', 'denied' or 'none'
create or replace function my_login_status() returns text
language sql stable security definer set search_path = public as $$
  select case when auth.uid() is null then 'none'
              when is_owner() then 'owner'
              else coalesce((select status from login_requests
                             where session_id = current_session_id() and user_id = auth.uid()), 'none') end;
$$;

-- Called by the app right after a staff login
create or replace function request_login(p_device text) returns text
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if auth.uid() is null or current_session_id() is null then
    raise exception 'Not signed in';
  end if;
  if is_owner() then return 'owner'; end if;
  insert into login_requests (session_id, user_id, email, device)
  values (current_session_id(), auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_device, ''), 120))
  on conflict (session_id) do nothing;
  select status into v_status from login_requests where session_id = current_session_id();
  return v_status;
end $$;

-- Owners only: recent logins, newest first
create or replace function list_logins() returns setof login_requests
language sql stable security definer set search_path = public as $$
  select * from login_requests where is_owner() order by created_at desc limit 100;
$$;

-- Owners only: approve, deny, or take away access from a device
create or replace function decide_login(p_session uuid, p_approve boolean) returns login_requests
language plpgsql security definer set search_path = public as $$
declare v login_requests;
begin
  if not is_owner() then
    raise exception 'Only an owner can approve logins';
  end if;
  update login_requests
     set status = case when p_approve then 'approved' else 'denied' end,
         decided_at = now(),
         decided_by = coalesce((select name from app_roles where user_id = auth.uid()), auth.jwt() ->> 'email')
   where session_id = p_session
  returning * into v;
  if not found then
    raise exception 'Login request not found';
  end if;
  return v;
end $$;

-- These two tables are reached only through the functions above
alter table app_roles enable row level security;
alter table login_requests enable row level security;

-- =====================================================================
-- Owner approval (replaces the owner PIN)
-- Owner screens, cancelling a bill and discounts above the limit need the owner:
--   * Telegram: the counter asks, the owner taps Approve on their phone (from anywhere), or
--   * Authenticator code: the owner, at the counter, types the 6-digit code from Google Authenticator.
-- A code works once and only for about a minute, so seeing it over the owner's shoulder is no use.
-- The database checks the approval itself, so it can't be skipped by going around the app.
-- An owner signed in with an owner login never needs approval.
-- =====================================================================
create table if not exists owner_secrets (
  user_id     uuid primary key,             -- the owner's login (app_roles)
  secret      bytea not null,               -- Authenticator key. Never readable by the app.
  last_step   bigint not null default 0,    -- last 30-second step used: each code works only once
  created_at  timestamptz not null default now()
);

create table if not exists owner_grants (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid,                        -- the login on the device that asked
  user_id      uuid,
  email        text,
  device       text,
  action       text not null check (action in ('unlock', 'cancel', 'discount', 'stock')),
  ref          uuid,                        -- the bill, for 'cancel' and 'discount'
  amount       numeric(12,2),               -- for 'discount': the most the owner allowed off this bill
  detail       text,                        -- what the owner is shown, e.g. "Cancel bill HF2627-0042 · ₹2,400"
  method       text,                        -- telegram, app or code
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'wrong_code')),
  created_at   timestamptz not null default now(),
  notified_at  timestamptz,
  decided_at   timestamptz,
  decided_by   text,
  expires_at   timestamptz,                 -- approval valid until (10 minutes)
  used_at      timestamptz                  -- one-time approvals (one bill) are used up here
);
alter table owner_grants add column if not exists amount numeric(12,2);
alter table owner_grants drop constraint if exists owner_grants_action_check;
alter table owner_grants add constraint owner_grants_action_check check (action in ('unlock', 'cancel', 'discount', 'stock'));
create index if not exists owner_grants_session_idx on owner_grants (session_id, created_at desc);
alter table owner_secrets enable row level security;  -- no policies: only the functions below can read it
alter table owner_grants  enable row level security;

-- Is this a direct database session (SQL editor, service key) rather than the app?
create or replace function direct_session() returns boolean
language sql stable as $$
  select coalesce(current_setting('request.jwt.claims', true), '') in ('', '{}')
      or auth.jwt() ->> 'role' = 'service_role';
$$;

-- True while this login may use owner screens: an owner login, or an approval in the last 10 minutes
create or replace function owner_ok() returns boolean
language sql stable security definer set search_path = public as $$
  select direct_session() or is_owner() or exists (
    select 1 from owner_grants
    where session_id = current_session_id() and user_id = auth.uid()
      and action = 'unlock' and status = 'approved' and expires_at > now());
$$;

-- 6-digit Authenticator code for one 30-second step (RFC 6238, HMAC-SHA1)
create or replace function totp_code(p_key bytea, p_step bigint) returns int
language plpgsql immutable set search_path = public, extensions as $$
declare
  h bytea;
  o int;
begin
  h := hmac(int8send(p_step), p_key, 'sha1');
  o := get_byte(h, 19) & 15;
  return ((((get_byte(h, o) & 127)::bigint << 24) | (get_byte(h, o + 1)::bigint << 16)
          | (get_byte(h, o + 2)::bigint << 8) | get_byte(h, o + 3)::bigint) % 1000000)::int;
end $$;

-- The counter asks the owner (Telegram message, and the owner's app). Returns the request.
create or replace function request_owner_unlock(p_action text, p_ref uuid, p_detail text, p_device text, p_amount numeric) returns owner_grants
language plpgsql security definer set search_path = public as $$
declare v owner_grants;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  if p_action not in ('unlock', 'cancel', 'discount', 'stock') then raise exception 'Unknown request'; end if;
  if (select count(*) from owner_grants where session_id = current_session_id() and status = 'pending'
      and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many requests waiting. Wait for the owner to answer.';
  end if;
  if p_action in ('cancel', 'discount', 'stock') and p_ref is null then raise exception 'Which bill or item?'; end if;
  insert into owner_grants (session_id, user_id, email, device, action, ref, amount, detail, method)
  values (current_session_id(), auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_device, ''), 120),
          p_action, p_ref, case when p_action = 'discount' then p_amount end, left(coalesce(p_detail, ''), 300), 'telegram')
  returning * into v;
  return v;
end $$;

-- The counter checks its request (every few seconds while waiting)
create or replace function owner_grant_status(p_id uuid) returns owner_grants
language sql stable security definer set search_path = public as $$
  select * from owner_grants where id = p_id and session_id = current_session_id() and user_id = auth.uid();
$$;

-- Still unlocked from earlier on this login? (after the page is reloaded)
create or replace function current_owner_unlock() returns owner_grants
language sql stable security definer set search_path = public as $$
  select * from owner_grants
  where session_id = current_session_id() and user_id = auth.uid()
    and action = 'unlock' and status = 'approved' and expires_at > now()
  order by expires_at desc limit 1;
$$;

-- "Lock" button: end this login's unlock now (it must not come back after a reload)
create or replace function owner_lock() returns boolean
language sql security definer set search_path = public as $$
  update owner_grants set expires_at = now()
  where session_id = current_session_id() and user_id = auth.uid() and action = 'unlock'
    and status = 'approved' and expires_at > now();
  select true;
$$;

-- The owner, at the counter, types the code from Google Authenticator.
-- Right code: unlocked for 10 minutes. Wrong code: recorded; 5 wrong codes in 15 minutes block codes on this login.
create or replace function owner_unlock_with_code(p_code text, p_detail text, p_device text) returns owner_grants
language plpgsql security definer set search_path = public as $$
declare
  s owner_secrets;
  v owner_grants;
  v_step bigint := floor(extract(epoch from now()) / 30)::bigint;
  k int;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  if (select count(*) from owner_grants where session_id = current_session_id() and status = 'wrong_code'
      and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many wrong codes. Wait 15 minutes, or ask the owner on Telegram.';
  end if;
  if not exists (select 1 from owner_secrets) then
    raise exception 'The owner has not set up Google Authenticator yet (Settings → Owner unlock, on the owner''s phone).';
  end if;
  if coalesce(p_code, '') ~ '^[0-9]{6}$' then
    for s in select * from owner_secrets for update loop
      for k in -1..1 loop
        if v_step + k > s.last_step and totp_code(s.secret, v_step + k) = p_code::int then
          update owner_secrets set last_step = v_step + k where user_id = s.user_id;
          insert into owner_grants (session_id, user_id, email, device, action, detail, method, status, decided_at, decided_by, expires_at)
          values (current_session_id(), auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_device, ''), 120), 'unlock',
                  left(coalesce(p_detail, ''), 300), 'code', 'approved', now(),
                  coalesce((select name from app_roles where user_id = s.user_id), 'Owner') || ' (code)', now() + interval '10 minutes')
          returning * into v;
          return v;
        end if;
      end loop;
    end loop;
  end if;
  insert into owner_grants (session_id, user_id, email, device, action, detail, method, status)
  values (current_session_id(), auth.uid(), auth.jwt() ->> 'email', left(coalesce(p_device, ''), 120), 'unlock',
          left(coalesce(p_detail, ''), 300), 'code', 'wrong_code')
  returning * into v;
  return v;
end $$;

-- How many owners have set up Google Authenticator, and has this owner?
create or replace function owner_totp_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('owners', (select count(*) from owner_secrets),
                            'mine', exists (select 1 from owner_secrets where user_id = auth.uid()))
  where session_ok();
$$;

-- Owners only: save the Authenticator key after checking one code made with it
create or replace function owner_totp_set(p_secret_hex text, p_code text) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_key bytea;
  v_step bigint := floor(extract(epoch from now()) / 30)::bigint;
  k int;
begin
  if not is_owner() then raise exception 'Only an owner can set up the Authenticator'; end if;
  if coalesce(p_secret_hex, '') !~ '^[0-9a-f]{32,128}$' then raise exception 'Bad key'; end if;
  v_key := decode(p_secret_hex, 'hex');
  for k in -1..1 loop
    if coalesce(p_code, '') ~ '^[0-9]{6}$' and totp_code(v_key, v_step + k) = p_code::int then
      insert into owner_secrets (user_id, secret, last_step) values (auth.uid(), v_key, 0)
      on conflict (user_id) do update set secret = excluded.secret, last_step = 0, created_at = now();
      return true;
    end if;
  end loop;
  raise exception 'That code doesn''t match. Check that the phone''s time is set automatically, and try the newest code.';
end $$;

create or replace function owner_totp_remove() returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not is_owner() then raise exception 'Only an owner can do this'; end if;
  delete from owner_secrets where user_id = auth.uid();
  return true;
end $$;

-- Owners only: requests and unlocks, newest first (the owner's app and Settings → Owner unlock)
create or replace function list_owner_requests() returns setof owner_grants
language sql stable security definer set search_path = public as $$
  select * from owner_grants where is_owner() order by created_at desc limit 100;
$$;

-- Owners only: approve or deny a waiting request from the app (same as the Telegram buttons)
create or replace function decide_owner_request(p_id uuid, p_approve boolean) returns owner_grants
language plpgsql security definer set search_path = public as $$
declare v owner_grants;
begin
  if not is_owner() then raise exception 'Only an owner can approve'; end if;
  update owner_grants
     set status = case when p_approve then 'approved' else 'denied' end,
         method = 'app',
         decided_at = now(),
         decided_by = coalesce((select name from app_roles where user_id = auth.uid()), auth.jwt() ->> 'email') || ' (app)',
         expires_at = case when p_approve then now() + interval '10 minutes' end
   where id = p_id and status = 'pending' and created_at > now() - interval '15 minutes'
  returning * into v;
  if not found then raise exception 'This request was already answered or has expired'; end if;
  return v;
end $$;

-- Used by cancel_bill and create_bill: an approval for exactly this bill, or a general unlock
create or replace function use_owner_grant(p_grant uuid, p_action text, p_ref uuid, p_at timestamptz, p_amount numeric) returns boolean
language plpgsql security definer set search_path = public as $$
declare g owner_grants;
begin
  if owner_ok() then return true; end if;
  select * into g from owner_grants
  where id = p_grant and user_id = auth.uid() and status = 'approved'
    and (action = 'unlock' or (action = p_action and ref = p_ref and used_at is null))
  for update;
  if not found then return false; end if;
  -- a discount approval covers at most the amount the owner saw
  if g.action = 'discount' and p_amount > coalesce(g.amount, 0) then return false; end if;
  -- the bill must have been made while the approval was valid (bills made offline arrive later)
  if p_at < g.decided_at - interval '1 minute' or p_at > g.expires_at + interval '5 minutes' then return false; end if;
  if g.action <> 'unlock' then update owner_grants set used_at = now() where id = g.id; end if;
  return true;
end $$;

-- A one-time approval for this login (cancel this bill)
create or replace function find_owner_grant(p_action text, p_ref uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select id from owner_grants
  where session_id = current_session_id() and user_id = auth.uid() and status = 'approved'
    and action = p_action and ref = p_ref and used_at is null and expires_at > now()
  order by decided_at desc limit 1;
$$;

-- Take stock out of the store (opening a new tube, jar, tin or kit), recording who took it and whether
-- the finished one was handed back ("empty for full"). The counter can't do this by writing to
-- stock_moves directly; it must come through here.
-- Needs the owner when Settings say so: 'always', 'expensive' (worth ₹500+ or no empty handed back), or 'never'.
create or replace function issue_stock(p jsonb) returns stock_moves
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_prod  products;
  v_qty   numeric := (p->>'qty')::numeric;
  v_empty boolean := coalesce((p->>'empty_returned')::boolean, false);
  v_staff uuid := (select id from staff where id = nullif(p->>'staff_id', '')::uuid);
  v_rule  text := coalesce((select value #>> '{}' from settings where key = 'stock_approval'), 'expensive');
  v_above numeric := coalesce(nullif((select value #>> '{}' from settings where key = 'stock_approval_above'), '')::numeric, 500);
  v_move  stock_moves;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  -- the same take-out sent twice is saved once
  select * into v_move from stock_moves where id = v_id;
  if found then return v_move; end if;
  select * into v_prod from products where id = nullif(p->>'product_id', '')::uuid for update;
  if not found then raise exception 'Product not found'; end if;
  if v_qty is null or v_qty <= 0 or v_qty > 100 then raise exception 'How many? Enter 1 to 100.'; end if;
  if v_qty > v_prod.stock then
    raise exception '%', 'Only ' || trim_scale(v_prod.stock) || ' ' || v_prod.unit || ' in stock. Ask the owner to correct the count first.';
  end if;
  if (v_rule = 'always' or (v_rule = 'expensive' and (v_prod.cost_price * v_qty >= v_above or not v_empty)))
     and not use_owner_grant(nullif(p->>'owner_grant_id', '')::uuid, 'stock', v_id, now(), 0) then
    raise exception 'Owner approval needed to take this out';
  end if;
  insert into stock_moves (id, product_id, type, qty, unit_cost, staff_id, empty_returned, note, created_by, owner_grant_id)
  values (v_id, v_prod.id, 'use', -v_qty, v_prod.cost_price, v_staff, v_empty, nullif(p->>'note', ''),
          auth.jwt() ->> 'email', nullif(p->>'owner_grant_id', '')::uuid)
  returning * into v_move;
  return v_move;
end $$;

-- =====================================================================
-- Security: only signed-in, approved logins can read or write.
-- =====================================================================
do $$
declare t text;
begin
  -- Everyday counter work
  foreach t in array array['customers','attendance'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('create policy "app users" on %I for all to authenticated using ((select session_ok())) with check ((select session_ok()))', t);
  end loop;
  -- Owner things: any approved login can read them; changing them needs the owner (see "Owner approval")
  foreach t in array array['settings','services','offers','staff','staff_advances','payslips','products','service_usage'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('drop policy if exists "app users read" on %I', t);
    execute format('drop policy if exists "owner writes" on %I', t);
    execute format('create policy "app users read" on %I for select to authenticated using ((select session_ok()))', t);
    execute format('create policy "owner writes" on %I for all to authenticated using ((select owner_ok())) with check ((select owner_ok()))', t);
  end loop;
  -- Stock coming in updates the product's stock and cost (other product changes are blocked by trg_guard_product)
  drop policy if exists "counter stock updates" on products;
  create policy "counter stock updates" on products for update to authenticated using ((select session_ok())) with check ((select session_ok()));
  -- Bills can be read, but are written only by create_bill / cancel_bill: nobody can quietly
  -- change or delete a saved bill, its lines or the bill counter.
  foreach t in array array['bills','bill_items','counters','stock_moves'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('drop policy if exists "app users read" on %I', t);
    execute format('create policy "app users read" on %I for select to authenticated using ((select session_ok()))', t);
  end loop;
  -- Stock coming in can be added directly. Taking stock out goes through issue_stock (who took it, empty
  -- handed back, owner approval). A stock count correction needs the owner. Moves are never changed or deleted.
  drop policy if exists "app users add" on stock_moves;
  create policy "app users add" on stock_moves for insert to authenticated
    with check ((select session_ok()) and (type = 'in' or (type = 'adjust' and (select owner_ok()))));
end $$;

revoke execute on function is_owner()                    from public, anon;
revoke execute on function session_ok()                  from public, anon;
revoke execute on function my_login_status()             from public, anon;
revoke execute on function request_login(text)           from public, anon;
revoke execute on function list_logins()                 from public, anon;
revoke execute on function decide_login(uuid, boolean)   from public, anon;
grant  execute on function is_owner()                    to authenticated;
grant  execute on function session_ok()                  to authenticated;
grant  execute on function my_login_status()             to authenticated;
grant  execute on function request_login(text)           to authenticated;
grant  execute on function list_logins()                 to authenticated;
grant  execute on function decide_login(uuid, boolean)   to authenticated;

revoke execute on function create_bill(jsonb)            from public, anon;
revoke execute on function cancel_bill(uuid, text)        from public, anon;
revoke execute on function refresh_customer_stats(uuid)   from public, anon;
revoke execute on function check_bill(jsonb)              from public, anon;
revoke execute on function direct_session()               from public, anon;
revoke execute on function owner_ok()                     from public, anon;
revoke execute on function totp_code(bytea, bigint)       from public, anon, authenticated;
revoke execute on function use_owner_grant(uuid, text, uuid, timestamptz, numeric) from public, anon, authenticated;
revoke execute on function find_owner_grant(text, uuid)   from public, anon, authenticated;
revoke execute on function request_owner_unlock(text, uuid, text, text, numeric) from public, anon;
revoke execute on function owner_grant_status(uuid)       from public, anon;
revoke execute on function current_owner_unlock()         from public, anon;
revoke execute on function owner_lock()                   from public, anon;
revoke execute on function owner_unlock_with_code(text, text, text) from public, anon;
revoke execute on function owner_totp_status()            from public, anon;
revoke execute on function owner_totp_set(text, text)     from public, anon;
revoke execute on function owner_totp_remove()            from public, anon;
revoke execute on function list_owner_requests()          from public, anon;
revoke execute on function decide_owner_request(uuid, boolean) from public, anon;
grant  execute on function direct_session()               to authenticated;
grant  execute on function owner_ok()                     to authenticated;
grant  execute on function request_owner_unlock(text, uuid, text, text, numeric) to authenticated;
grant  execute on function owner_grant_status(uuid)       to authenticated;
grant  execute on function current_owner_unlock()         to authenticated;
grant  execute on function owner_lock()                   to authenticated;
grant  execute on function owner_unlock_with_code(text, text, text) to authenticated;
grant  execute on function owner_totp_status()            to authenticated;
grant  execute on function owner_totp_set(text, text)     to authenticated;
grant  execute on function owner_totp_remove()            to authenticated;
grant  execute on function list_owner_requests()          to authenticated;
grant  execute on function decide_owner_request(uuid, boolean) to authenticated;
revoke execute on function issue_stock(jsonb)             from public, anon;
grant  execute on function issue_stock(jsonb)             to authenticated;
grant  execute on function check_bill(jsonb)              to authenticated;
grant  execute on function create_bill(jsonb)            to authenticated;
grant  execute on function cancel_bill(uuid, text)        to authenticated;
grant  execute on function refresh_customer_stats(uuid)   to authenticated;

-- Default settings (change them in the app: Settings)
insert into settings (key, value) values
  ('salon_name',        '"Habibs Hair & Beauty"'),
  ('branch',            '"Fuljhore, Durgapur"'),
  ('address',           '"Girija Niketan, 1st Floor, B-1 More, Durgapur, West Bengal"'),
  ('phone',             '"+91 89275 63835"'),
  ('instagram',         '"@habibsfuljhore"'),
  ('gstin',             '""'),
  ('prices_include_gst','true'),
  ('bill_prefix',       '"HF"'),
  ('bill_footer',       '"Thank you for visiting Habibs Fuljhore!"'),
  ('max_discount_pct',  '20'),
  ('upi_id',            '""'),
  ('receipt_width',     '80'),
  ('stock_approval',    '"expensive"'),  -- taking stock out needs the owner: always / expensive / never
  ('stock_approval_above', '500')       -- 'expensive' means worth this much (₹) or more, or no empty handed back
on conflict (key) do nothing;
