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
  status    text not null check (status in ('P','A','H','W')), -- Present, Absent, Half day, Week off (paid); L (leave) added below
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
  sections            text[],                         -- billing tabs: Hair, Colour, Hair Spa … (menu_sections())
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
-- L = approved leave. Week offs and leave share the paid days off a month (Settings: 4); more are unpaid.
alter table attendance drop constraint if exists attendance_status_check;
alter table attendance add constraint attendance_status_check check (status in ('P', 'A', 'H', 'W', 'L'));
alter table attendance add column if not exists note text;
alter table attendance add column if not exists marked_by text;     -- who marked it (face check-in, the owner, an approved leave)
alter table payslips   add column if not exists week_off_days numeric(5,1) not null default 0;
alter table payslips   add column if not exists leave_days    numeric(5,1) not null default 0;
alter table payslips   add column if not exists unpaid_off_days numeric(5,1) not null default 0;
alter table payslips   add column if not exists offs_not_taken numeric(5,1) not null default 0;   -- paid days off not taken: paid as days worked
alter table payslips   add column if not exists day_rate       numeric(10,2);                      -- salary ÷ (days in the month − paid days off)

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
-- Stock in and returns add, take-outs and sales remove: a "stock in" of -5 would be a hidden take-out
alter table stock_moves drop constraint if exists stock_moves_sign_check;
alter table stock_moves add constraint stock_moves_sign_check check (
  (type in ('in', 'return') and qty > 0) or (type in ('use', 'sale') and qty < 0) or (type = 'adjust' and qty <> 0)) not valid;

create table if not exists service_usage (
  id          uuid primary key default gen_random_uuid(),
  service_id  uuid not null references services(id) on delete cascade,
  product_id  uuid not null references products(id) on delete cascade,
  amount      numeric(10,2) not null default 0,  -- per service, in the product's size unit (g / ml / uses)
  amounts     jsonb,                              -- per option, e.g. {"S": 60, "M": 90, "L": 120}
  created_at  timestamptz not null default now(),
  unique (service_id, product_id)
);
-- Buying price from the printed MRP and the supplier's discount; a note; "finished" (used up, to buy again)
alter table products   add column if not exists mrp numeric(10,2);                 -- printed MRP per unit
alter table products   add column if not exists supplier_discount_pct numeric(5,2); -- e.g. 40 = bought at 40% off MRP
alter table products   add column if not exists note text;
alter table products   add column if not exists finished_at timestamptz;          -- marked used up; cleared by the next stock in
alter table products   add column if not exists finished_by text;
alter table products   add column if not exists finished_notified_at timestamptz;
alter table products   add column if not exists updated_at timestamptz not null default now();

-- ---------- Bottle check: how many services one tube / jar / bottle / kit lasts ----------
-- service_usage now simply says "this product is used in this service" (a tick). Every Give out starts a
-- unit; the empty handed back with the next Give out ends it (unit_ends). The services billed while a unit
-- was open are its uses: hair length and thickness count by themselves (S 1, M 1.5, L 2, XL 2.5, thick +0.5),
-- and a much bigger or smaller service can count as more or less (weight). A unit that ends with far fewer
-- uses than normal is flagged. Billing doesn't change at all: the bills already say which service was done.
alter table service_usage add column if not exists weight numeric(6,2) not null default 1;  -- one of these services counts as this many uses
alter table service_usage drop constraint if exists service_usage_weight_check;
alter table service_usage add constraint service_usage_weight_check check (weight > 0 and weight <= 50);
alter table products add column if not exists uses_per_unit numeric(8,2);  -- the owner's number: one unit lasts about this many uses (empty = learn it)
alter table products drop constraint if exists products_uses_per_unit_check;
alter table products add constraint products_uses_per_unit_check check (uses_per_unit is null or (uses_per_unit > 0 and uses_per_unit <= 10000));

select set_config('app.units_new', (to_regclass('public.unit_ends') is null)::text, false); -- first run: units are rebuilt from the give-outs below
create table if not exists unit_ends (
  move_id    uuid primary key references stock_moves(id) on delete cascade,  -- the Give out whose unit ended
  product_id uuid not null references products(id) on delete cascade,
  ended_at   timestamptz not null default now(),
  how        text not null check (how in ('empty', 'no_empty', 'finished')),  -- empty handed back / finished, no empty / marked Finished
  by_move    uuid references stock_moves(id) on delete set null,              -- the Give out that ended it
  created_by text
);
create index if not exists unit_ends_product_idx on unit_ends (product_id, ended_at);
-- The size of the unit in this move, e.g. 500 ml when the usual bottle is 1 L (in the product's size unit).
-- Stock in: the delivery's pack size. Give out: the size of the one given out. Empty = the product's size.
alter table stock_moves add column if not exists unit_size numeric(10,2);
alter table stock_moves drop constraint if exists stock_moves_unit_size_check;
alter table stock_moves add constraint stock_moves_unit_size_check check (unit_size is null or (unit_size > 0 and unit_size <= 100000));

-- At the weekly count, how full the one in use was. Bills that explain far less than that are "running fast".
create table if not exists unit_checks (
  id          uuid primary key default gen_random_uuid(),
  move_id     uuid not null references stock_moves(id) on delete cascade,  -- the one in use
  product_id  uuid not null references products(id) on delete cascade,
  left_pct    numeric(5,2) not null check (left_pct >= 0 and left_pct <= 100), -- 100 full, 50 half, 10 almost empty
  uses_at     numeric(10,2),   -- uses (or days) the bills show when it was checked
  expected_at numeric(10,2),   -- uses (or days) that much gone should have served
  created_by  text,
  created_at  timestamptz not null default now()
);
create index if not exists unit_checks_move_idx on unit_checks (move_id, created_at);
create index if not exists unit_ends_by_idx on unit_ends (by_move);

-- A service done without a bill (a redo, the staff's own colour, family, training). It used product too,
-- so the Bottle check counts it; the owner sees each one.
create table if not exists free_uses (
  id           uuid primary key default gen_random_uuid(),
  service_id   uuid not null references services(id) on delete cascade,
  option_label text,                               -- hair length etc., as on the menu
  extra_label  text,                               -- e.g. Thick
  qty          numeric(6,2) not null default 1 check (qty > 0 and qty <= 20),
  staff_id     uuid references staff(id) on delete set null,  -- who did it
  reason       text not null check (reason in ('redo', 'staff', 'family', 'training', 'other')),
  note         text,
  created_by   text,
  created_at   timestamptz not null default now()
);
create index if not exists free_uses_created_idx on free_uses (created_at);

-- Telegram messages already sent (each alert once)
create table if not exists alerts_sent (
  kind    text not null,
  ref     uuid not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);

-- Upgrading a database that already has give-outs: each give-out ended the one before it (the same
-- person's, else the oldest), and a product marked finished ended its open one. Only on the first run.
do $$
declare r record; v uuid;
begin
  if current_setting('app.units_new', true) is distinct from 'true' then return; end if;
  for r in select * from stock_moves where type = 'use' and qty < 0 order by created_at, id loop
    select m.id into v from stock_moves m
     where m.product_id = r.product_id and m.type = 'use' and m.qty < 0 and (m.created_at, m.id) < (r.created_at, r.id)
       and not exists (select 1 from unit_ends e where e.move_id = m.id)
     order by (m.staff_id is not distinct from r.staff_id) desc, m.created_at, m.id limit 1;
    if v is not null then
      insert into unit_ends (move_id, product_id, ended_at, how, by_move, created_by)
      values (v, r.product_id, r.created_at, case when r.empty_returned then 'empty' else 'no_empty' end, r.id, 'upgrade');
    end if;
  end loop;
  insert into unit_ends (move_id, product_id, ended_at, how, created_by)
  select m.id, m.product_id, p.finished_at, 'finished', 'upgrade'
    from stock_moves m join products p on p.id = m.product_id
   where p.finished_at is not null and m.type = 'use' and m.qty < 0 and m.created_at < p.finished_at
     and not exists (select 1 from unit_ends e where e.move_id = m.id);
end $$;

alter table bills      add column if not exists offer_discount numeric(12,2) not null default 0;
-- Loyalty points (see "Loyalty points" below): paid with points (₹, whole), earned on this bill, balance after it
alter table bills      add column if not exists paid_points    numeric(12,2) not null default 0;
alter table bills      add column if not exists points_earned  int not null default 0;
alter table bills      add column if not exists points_balance int;
alter table customers  add column if not exists points         int not null default 0;  -- kept by loyalty_points, never typed
alter table bill_items add column if not exists offer_id uuid references offers(id) on delete set null;
alter table bill_items add column if not exists offer_name text;
alter table bill_items add column if not exists offer_discount numeric(12,2) not null default 0;
-- A discount on this one line, given at the counter (November 2026); part of `discount`, after the offer
alter table bill_items add column if not exists line_discount numeric(12,2) not null default 0;
-- A staff member's own service (November 2026): the staff price (free or 50% off) is the line's own discount, kept here
-- too; commission_base is the line's value before it, so whoever did the service earns commission on the full price
alter table bill_items add column if not exists staff_discount numeric(12,2) not null default 0;
alter table bill_items add column if not exists commission_base numeric(12,2);
alter table bills      add column if not exists for_staff uuid references staff(id) on delete set null;  -- the bill's mobile number is this staff member's

-- Bills sent to the customer on WhatsApp through the WhatsApp Business Platform (November 2026). Written only by the
-- whatsapp Edge Function (service key): one row per send, then Meta's delivery updates (sent → delivered → read, or failed).
create table if not exists wa_messages (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid references bills(id) on delete cascade,
  phone      text not null,
  kind       text not null default 'bill',
  status     text not null default 'sending' check (status in ('sending', 'sent', 'delivered', 'read', 'failed')),
  wamid      text unique,                    -- WhatsApp's id for the message (its delivery updates come with it)
  error      text,                           -- why it failed, in plain words
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists wa_messages_bill_idx on wa_messages (bill_id, created_at);
create index if not exists wa_messages_created_idx on wa_messages (created_at);

-- How each bill was paid, one row per way of paying (November 2026). The bills table keeps its paid_cash / paid_upi /
-- paid_card / paid_points columns; this table is the same facts as rows, kept by a trigger, so a new way of paying
-- later (a prepaid wallet, a gift voucher, a package) is a new `mode` here and not a new column on every bill.
create table if not exists bill_payments (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills(id) on delete cascade,
  created_at  timestamptz not null,                 -- the bill's time
  mode        text not null,                        -- cash, upi, card, points; later wallet, voucher, package
  amount      numeric(12,2) not null check (amount > 0),
  ref         text,                                 -- for later: the voucher or wallet it came from
  unique (bill_id, mode)
);
create index if not exists bill_payments_created_idx on bill_payments (created_at);

create or replace function bill_payments_fill() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into bill_payments (bill_id, created_at, mode, amount)
  select new.id, new.created_at, x.mode, x.amount
    from (values ('cash', coalesce(new.paid_cash, 0)), ('upi', coalesce(new.paid_upi, 0)),
                 ('card', coalesce(new.paid_card, 0)), ('points', coalesce(new.paid_points, 0))) x(mode, amount)
   where x.amount > 0
  on conflict (bill_id, mode) do nothing;
  return new;
end $$;
drop trigger if exists bill_payments_fill on bills;
create trigger bill_payments_fill after insert on bills for each row execute function bill_payments_fill();
revoke execute on function bill_payments_fill() from public, anon, authenticated;
-- bills saved before this table
insert into bill_payments (bill_id, created_at, mode, amount)
select b.id, b.created_at, x.mode, x.amount
  from bills b cross join lateral (values ('cash', coalesce(b.paid_cash, 0)), ('upi', coalesce(b.paid_upi, 0)),
                                          ('card', coalesce(b.paid_card, 0)), ('points', coalesce(b.paid_points, 0))) x(mode, amount)
 where x.amount > 0
on conflict (bill_id, mode) do nothing;

create table if not exists counters (
  key   text primary key,
  value int not null default 0
);

create index if not exists bills_created_idx      on bills (created_at);
create index if not exists bills_customer_idx     on bills (customer_id);
create index if not exists bill_items_bill_idx    on bill_items (bill_id);
create index if not exists bill_items_created_idx on bill_items (created_at);
create index if not exists bill_items_staff_idx   on bill_items (staff_id);
create index if not exists bill_items_service_idx on bill_items (service_id);      -- Bottle check: the services each product is used in
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
    -- a product marked "finished" is back once there is stock again (e.g. a delivery came in)
    update products set finished_at = null, finished_by = null, finished_notified_at = null
     where id = new.product_id and stock > 0 and finished_at is not null;
  end if;
  return null;
end $$;

drop trigger if exists trg_apply_stock_move on stock_moves;
create trigger trg_apply_stock_move after insert or update or delete on stock_moves
for each row execute function apply_stock_move();

-- The counter can change a product's stock count, cost price and supplier discount (stock coming in)
-- and its note, but its name, MRP, selling price or GST only with the owner's approval
create or replace function guard_product_change() returns trigger
language plpgsql as $$
begin
  if not owner_ok() and (new.name, new.brand, new.kind, new.unit, new.low_stock, new.sell_price, new.mrp, new.hsn, new.gst_pct, new.active, new.use_type, new.size, new.size_unit, new.uses_per_unit)
     is distinct from (old.name, old.brand, old.kind, old.unit, old.low_stock, old.sell_price, old.mrp, old.hsn, old.gst_pct, old.active, old.use_type, old.size, old.size_unit, old.uses_per_unit) then
    raise exception 'Owner approval needed to change a product''s details or price';
  end if;
  -- The stock count changes only through stock_moves (stock in, give out, sale, count), never directly,
  -- so every change has a row saying who, when and why. pg_trigger_depth() > 1 = called by that trigger.
  if new.stock is distinct from old.stock and pg_trigger_depth() < 2 and not direct_session() then
    raise exception 'Stock changes only through Stock in, Give out, a bill or a stock count';
  end if;
  new.updated_at := now();
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
  v_qty numeric; v_price numeric; v_amt numeric; v_off numeric; v_disc numeric; v_line numeric; v_sd numeric; v_cb numeric;
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
    v_line  := coalesce((it->>'line_discount')::numeric, 0);
    v_sd    := coalesce((it->>'staff_discount')::numeric, 0);
    v_cb    := nullif(it->>'commission_base', '')::numeric;
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
    if v_line < 0 or v_off + v_line > v_disc then
      raise exception 'Bill check failed: %: discount on this item is wrong', v_name;
    end if;
    if v_sd < 0 or v_sd > v_line then
      raise exception 'Bill check failed: %: staff price is wrong', v_name;
    end if;
    if v_cb is not null and (v_cb < v_tax or v_cb > v_tax + v_sd) then
      raise exception 'Bill check failed: %: commission value is wrong', v_name;
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
  if coalesce((p->>'paid_points')::numeric, 0) < 0 or coalesce((p->>'paid_points')::numeric, 0) <> trunc(coalesce((p->>'paid_points')::numeric, 0)) then
    raise exception 'Bill check failed: points are whole rupees';
  end if;
  if coalesce((p->>'paid_cash')::numeric, 0) < 0 or coalesce((p->>'paid_upi')::numeric, 0) < 0 or coalesce((p->>'paid_card')::numeric, 0) < 0
     or coalesce((p->>'paid_due')::numeric, 0) < 0
     or coalesce((p->>'paid_cash')::numeric, 0) + coalesce((p->>'paid_upi')::numeric, 0) + coalesce((p->>'paid_card')::numeric, 0)
        + coalesce((p->>'paid_points')::numeric, 0) + coalesce((p->>'paid_due')::numeric, 0) <> n then
    raise exception 'Bill check failed: payments do not add up to the total';
  end if;
  -- Change given back by UPI (no small notes): only on cash received
  if coalesce((p->>'change_upi')::numeric, 0) < 0
     or (coalesce((p->>'change_upi')::numeric, 0) > 0 and coalesce((p->>'paid_cash')::numeric, 0) <= 0) then
    raise exception 'Bill check failed: change by UPI is only for cash received';
  end if;
  if coalesce(p->>'pay_mode', '') not in ('Cash', 'UPI', 'Card', 'Split') then
    raise exception 'Bill check failed: payment mode missing';
  end if;
end $$;

-- Is an offer running at this moment (Indian date, weekday and time)? Same rules as offerLive() in src/lib/offers.js
create or replace function offer_live_at(o offers, t timestamptz, p_need_active boolean) returns boolean
language sql stable as $$
  select (not p_need_active or o.active)
     and (o.starts_on is null or (t at time zone 'Asia/Kolkata')::date >= o.starts_on)
     and (o.ends_on   is null or (t at time zone 'Asia/Kolkata')::date <= o.ends_on)
     and (o.days is null or cardinality(o.days) = 0 or extract(isodow from t at time zone 'Asia/Kolkata')::int = any (o.days))
     and (o.start_time is null or (t at time zone 'Asia/Kolkata')::time >= o.start_time)
     and (o.end_time   is null or (t at time zone 'Asia/Kolkata')::time <  o.end_time);
$$;

-- The most an offer can take off one line, in rupees (same maths as offerSaving() in src/lib/offers.js, in paise)
create or replace function offer_line_saving(o offers, p_price numeric, p_qty numeric) returns numeric
language sql immutable as $$
  select (case o.kind
            when 'percent' then round(greatest(round(p_price * 100), 0) * p_qty * least(greatest(round(o.value * 100), 0), 10000) / 10000)
            when 'amount'  then least(greatest(round(o.value * 100), 0), greatest(round(p_price * 100), 0)) * p_qty
            when 'price'   then greatest(0, round(p_price * 100) - greatest(round(o.value * 100), 0)) * p_qty
            else 0 end) / 100;
$$;

-- Prices and offer discounts on a bill, checked against the menu and the offers themselves.
-- The app always bills at menu prices and works offers out by their rules, so for a real bill this finds nothing.
-- Anything below the menu price, or more off than the offer allows, is "hidden" discount: create_bill counts it
-- towards the discount limit exactly like a counter discount, and notes it on the bill.
--   * Bills made offline (they carry their own number) are checked at the time they were made, and a price
--     changed after that time is allowed. Online bills are checked now: the offer must be on (5 minutes' grace).
--   * A service or product that isn't on the menu: refused online; noted on bills made offline (it may have been
--     removed while the bill waited).
create or replace function bill_menu_check(p jsonb, p_at timestamptz, p_new boolean, out hidden numeric, out notes text)
language plpgsql stable security definer set search_path = public as $$
declare
  v_offline boolean := nullif(p->>'bill_no', '') is not null;
  v_t       timestamptz := case when nullif(p->>'bill_no', '') is not null then p_at else now() end;
  v_sub     numeric := (p->>'subtotal')::numeric;
  v_uuid    text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  it        jsonb;
  s         services;
  pr        products;
  o         offers;
  v_qty     numeric;
  v_price   numeric;
  v_off     numeric;
  v_max     numeric;
  v_ok      boolean;
  v_used    jsonb := '{}'::jsonb;   -- offer id → offer discount allowed so far (for "up to ₹X" caps)
  v_combo   jsonb := '{}'::jsonb;   -- combo id → {"n": {service id: how many}, "sum": the lines at their prices}
  v_sets    numeric;
  v_full    boolean;
  v_allow   numeric;
  v_missing text[] := '{}';
  v_low     text[] := '{}';
  k         text;
  v_cap     numeric;
begin
  hidden := 0;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_qty := (it->>'qty')::numeric;
    v_price := (it->>'unit_price')::numeric;
    v_off := coalesce((it->>'offer_discount')::numeric, 0);
    s := null;
    pr := null;
    o := null;
    if it->>'item_type' = 'service' then
      select * into s from services where id = case when it->>'service_id' ~ v_uuid then (it->>'service_id')::uuid end;
      if s.id is null then
        v_missing := v_missing || coalesce(nullif(it->>'name', ''), 'a service');
      elsif v_price < s.price and not exists (
              -- the menu price went up after this bill was made (offline bills)
              select 1 from service_changes c
              where c.service_id = s.id and c.created_at >= p_at and c.changes ? 'price'
                and (c.changes -> 'price' ->> 0)::numeric <= v_price) then
        hidden := hidden + (s.price - v_price) * v_qty;
        v_low := v_low || (s.name || ' at ₹' || trim_scale(v_price) || ', menu ₹' || trim_scale(s.price));
      end if;
    elsif it->>'item_type' = 'product' then
      select * into pr from products where id = case when it->>'product_id' ~ v_uuid then (it->>'product_id')::uuid end;
      if pr.id is null then
        v_missing := v_missing || coalesce(nullif(it->>'name', ''), 'a product');
      elsif v_price < pr.sell_price then
        hidden := hidden + (pr.sell_price - v_price) * v_qty;
        v_low := v_low || (pr.name || ' at ₹' || trim_scale(v_price) || ', price ₹' || trim_scale(pr.sell_price));
      end if;
    end if;
    if v_off > 0 then
      select * into o from offers where id = case when it->>'offer_id' ~ v_uuid then (it->>'offer_id')::uuid end;
      v_max := 0;
      if o.id is not null then
        v_ok := case when it->>'item_type' = 'product' then o.applies_to = 'all' and o.include_products
                     when o.applies_to = 'all' then true
                     when s.id is null then false
                     when o.applies_to = 'section' then s.section = any (coalesce(o.sections, '{}'))
                     when o.applies_to = 'category' then s.category = any (coalesce(o.categories, '{}'))
                     when o.applies_to = 'services' then s.id = any (coalesce(o.service_ids, '{}'))
                     else false end
                and (offer_live_at(o, v_t, not v_offline)
                     or (not v_offline and (offer_live_at(o, v_t - interval '5 minutes', true) or offer_live_at(o, v_t + interval '5 minutes', true))))
                and v_sub >= coalesce(o.min_bill, 0)
                and (not o.new_customers_only or p_new);
        if v_ok and o.kind = 'combo' then
          -- a combo's line: at most the line itself here; the whole set is checked after the loop
          v_max := least(v_off, v_price * v_qty);
          v_combo := jsonb_set(v_combo, array[o.id::text], jsonb_build_object(
            'n', coalesce(v_combo #> array[o.id::text, 'n'], '{}'::jsonb)
                 || jsonb_build_object(s.id::text, coalesce((v_combo #>> array[o.id::text, 'n', s.id::text])::numeric, 0) + v_qty),
            'sum', coalesce((v_combo #>> array[o.id::text, 'sum'])::numeric, 0) + v_price * v_qty));
        elsif v_ok then v_max := least(v_off, offer_line_saving(o, v_price, v_qty));
        end if;
        v_used := jsonb_set(v_used, array[o.id::text], to_jsonb(coalesce((v_used ->> o.id::text)::numeric, 0) + v_max));
      end if;
      if v_off > v_max then
        hidden := hidden + (v_off - v_max);
        v_low := v_low || (coalesce(nullif(it->>'offer_name', ''), 'offer') || ' ₹' || trim_scale(v_off) || ' on ' || coalesce(it->>'name', 'a line')
                           || case when o.id is null then ' (offer not found)' else ', allowed ₹' || trim_scale(v_max) end);
      end if;
    end if;
  end loop;
  -- Combos: whole sets only (each of its services the same number of times), and together no more off than
  -- (the set's lines at their prices) − (the combo price × the number of sets)
  for k in select jsonb_object_keys(v_combo) loop
    select * into o from offers where id = k::uuid;
    select min(coalesce((v_combo #>> array[k, 'n', x::text])::numeric, 0)), bool_and(coalesce((v_combo #>> array[k, 'n', x::text])::numeric, 0) = (v_combo #>> array[k, 'n', (o.service_ids)[1]::text])::numeric)
      into v_sets, v_full from unnest(o.service_ids) x;
    v_full := coalesce(v_full, false) and coalesce(v_sets, 0) >= 1
              and (select count(*) from jsonb_object_keys(v_combo #> array[k, 'n'])) = (select count(distinct x) from unnest(o.service_ids) x);
    v_allow := case when v_full then greatest(0, (v_combo #>> array[k, 'sum'])::numeric - v_sets * o.value) else 0 end;
    if (v_used ->> k)::numeric > v_allow then
      hidden := hidden + (v_used ->> k)::numeric - v_allow;
      v_low := v_low || (o.name || case when v_full then ' combo: more off than the combo price allows' else ' combo: not the whole set on the bill' end);
    end if;
  end loop;
  -- "Up to ₹X off": the whole bill can't get more than the cap from one offer
  for k in select jsonb_object_keys(v_used) loop
    select max_discount into v_cap from offers where id = k::uuid;
    if coalesce(v_cap, 0) > 0 and (v_used ->> k)::numeric > v_cap then
      hidden := hidden + (v_used ->> k)::numeric - v_cap;
      v_low := v_low || ('offer cap ₹' || trim_scale(v_cap) || ' passed');
    end if;
  end loop;
  if cardinality(v_missing) > 0 and not v_offline then
    raise exception '%', 'Bill check failed: ' || array_to_string(v_missing, ', ') || ' is not on the menu';
  end if;
  notes := nullif(concat_ws(' | ',
    case when cardinality(v_missing) > 0 then 'Not on the menu any more: ' || array_to_string(v_missing, ', ') end,
    case when hidden > 0 then 'CHECK: ₹' || trim_scale(round(hidden, 2)) || ' below menu prices or offer rules (' || array_to_string(v_low, '; ') || ')' end), '');
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
-- A staff member's own services: the bill's mobile number is an active staff member's. Services on the tabs in
-- Settings (Hair, Threading, Waxing) are free, the rest 50% off (Settings); no offers on those lines and no other
-- discount on them. Products are at the normal price. Same rules as staffPriceError() in src/lib/staffPrice.js.
-- Returns who the bill is for, the staff prices on it, and the first problem (create_bill refuses it, or notes it
-- on a bill made offline).
create or replace function staff_price_check(p jsonb, out for_staff uuid, out total numeric, out err text)
language plpgsql stable security definer set search_path = public as $$
declare
  it      jsonb;
  s       services;
  v_name  text;
  v_sd    numeric;
  v_pct   numeric;
  v_want  numeric;
  v_free  jsonb := coalesce((select value from settings where key = 'staff_free_sections' and jsonb_typeof(value) = 'array'),
                            '["Hair", "Threading", "Waxing"]'::jsonb);
  v_half  numeric := least(100, greatest(0, coalesce((select nullif(value #>> '{}', '')::numeric from settings where key = 'staff_discount_pct'), 50)));
  v_uuid  text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  total := 0;
  select x.id into for_staff from staff x
   where x.active and coalesce(p->>'customer_phone', '') ~ '^[0-9]{10}$'
     and right(regexp_replace(coalesce(x.phone, ''), '\D', '', 'g'), 10) = p->>'customer_phone'
   order by x.name collate "C" limit 1;
  for it in select * from jsonb_array_elements(p->'items') loop
    v_sd := coalesce((it->>'staff_discount')::numeric, 0);
    continue when v_sd = 0;
    v_name := coalesce(nullif(it->>'name', ''), 'item');
    total := total + v_sd;
    continue when err is not null;
    if for_staff is null then
      err := 'Staff price: this mobile number is not a staff member''s';
    elsif it->>'item_type' is distinct from 'service' then
      err := 'Staff price: only on services, not on ' || v_name;
    elsif coalesce((it->>'offer_discount')::numeric, 0) > 0 then
      err := 'Staff price: no offers on a staff member''s own services (' || v_name || ')';
    elsif coalesce((it->>'line_discount')::numeric, 0) <> v_sd then
      err := 'Staff price: no other discount on ' || v_name;
    else
      select * into s from services where id = case when it->>'service_id' ~ v_uuid then (it->>'service_id')::uuid end;
      if s.id is not null then
        v_pct := case when v_free ? s.section then 100 else v_half end;
        v_want := round((it->>'amount')::numeric * v_pct / 100, 2);
        if v_sd <> v_want then
          err := 'Staff price: ' || v_name || ' should be ₹' || trim_scale(v_want) || ' off (' || trim_scale(v_pct) || '% for staff)';
        end if;
      end if;
    end if;
  end loop;
end $$;

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
  v_check  record;
  v_offline boolean := nullif(p->>'bill_no', '') is not null;
  v_use    numeric := coalesce((p->>'paid_points')::numeric, 0);
  v_due    numeric := coalesce((p->>'paid_due')::numeric, 0);       -- left to pay later (Dues)
  v_chg    numeric := coalesce((p->>'change_upi')::numeric, 0);     -- change given back by UPI
  v_duemax numeric := coalesce((select nullif(value #>> '{}', '')::numeric from settings where key = 'due_max_counter'), 200);
  v_earn   int := 0;
  v_bal    int := 0;
  v_perr   text;
  -- A past bill (owner only): a bill from before, typed in later with its own date and time and its own number series
  v_past   boolean := coalesce((p->>'past')::boolean, false);
  v_paper  text := nullif(left(trim(coalesce(p->>'paper_no', '')), 40), '');
  v_sp     record;
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

  -- A past bill: only the owner (owner login, or the owner's code at the counter), with a date and time before now,
  -- within the last 400 days, online, without points. It gets a note saying when and by whom it was typed in.
  if v_past then
    if not owner_here() then
      raise exception 'Only the owner can add a past bill: sign in as the owner, or the owner types the code';
    end if;
    if nullif(p->>'created_at', '') is null then raise exception 'Past bill: choose the day and time of the bill'; end if;
    if v_at > now() then raise exception 'Past bill: the day and time must be before now'; end if;
    if v_at < now() - interval '400 days' then raise exception 'Past bill: that is more than 400 days ago'; end if;
    if v_no is not null then raise exception 'Past bills need the internet'; end if;
    if v_use > 0 then raise exception 'Past bill: points can''t be used on a past bill'; end if;
    v_note := concat_ws(' | ', 'Past bill' || coalesce(', paper bill no. ' || v_paper, '')
                               || ', typed in ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI')
                               || coalesce(' by ' || nullif(p->>'created_by', ''), ''), v_note);
  end if;

  -- A staff member's own services at the staff price (a bill made offline is saved anyway, with a CHECK note)
  select * into v_sp from staff_price_check(p);
  if v_sp.err is not null then
    if not v_offline then raise exception '%', v_sp.err; end if;
    v_note := concat_ws(' | ', v_note, 'CHECK: ' || v_sp.err);
  end if;

  -- A tablet with a wrong clock can't put a bill in the future
  if v_at > now() + interval '10 minutes' then
    v_note := concat_ws(' | ', v_note, 'Device clock was ahead: ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon YYYY HH24:MI'));
    v_at := now();
  end if;

  -- Bills made offline and uploaded much later say so
  if v_no is not null and v_at < now() - interval '6 hours' then
    v_note := concat_ws(' | ', v_note, 'Made offline ' || to_char(v_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI')
                                        || ', uploaded ' || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'));
  end if;

  -- Prices and offers against the menu: anything below the menu or more than an offer allows counts as discount.
  -- (Not for a past bill: the owner types it from the paper bill, at the prices of that day.)
  if v_past then
    select 0::numeric as hidden, null::text as notes into v_check;
  else
    select * into v_check from bill_menu_check(p, v_at,
      v_phone is not null and not exists (select 1 from bills b join customers c on c.id = b.customer_id
                                          where c.phone = v_phone and b.status = 'paid' and b.created_at < v_at));
  end if;
  v_note := concat_ws(' | ', v_note, v_check.notes);

  -- A discount above the limit (Settings) needs the owner: an owner login, an unlock,
  -- or the owner's approval for exactly this bill. Staff prices are not the counter's discount.
  v_base := (p->>'subtotal')::numeric - coalesce((p->>'offer_discount')::numeric, 0) - v_sp.total + v_check.hidden;
  v_manual := coalesce((p->>'discount')::numeric, 0) - coalesce((p->>'offer_discount')::numeric, 0) - v_sp.total + v_check.hidden;
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
    -- Loyalty points: one bill at a time per customer; points from before a 12-month gap expire first
    perform 1 from customers where id = v_cust.id for update;
    perform expire_points(v_cust.id, v_at);
    select points into v_bal from customers where id = v_cust.id;
  end if;

  -- Paying with points: from 100 points, up to 20% of the bill (Settings), never more than the balance.
  -- A bill made offline is saved anyway, with a CHECK note (the app doesn't offer points offline).
  if v_use > 0 then
    v_perr := case
      when not loyalty_flag('loyalty_on', true) then 'points are switched off'
      when v_cust.id is null then 'points need the customer''s mobile number'
      when v_bal < loyalty_num('loyalty_min_use', 100) then 'points can be used from ' || trim_scale(loyalty_num('loyalty_min_use', 100)) || ' points (balance ' || v_bal || ')'
      when v_use > v_bal then 'only ' || v_bal || ' points left'
      when v_use > floor((p->>'total')::numeric * loyalty_num('loyalty_max_use_pct', 20) / 100)
        then 'points can pay at most ' || trim_scale(loyalty_num('loyalty_max_use_pct', 20)) || '% of a bill (₹'
             || trim_scale(floor((p->>'total')::numeric * loyalty_num('loyalty_max_use_pct', 20) / 100)) || ' here)'
    end;
    if v_perr is not null then
      if not v_offline then raise exception '%', 'Points: ' || v_perr; end if;
      v_note := concat_ws(' | ', v_note, 'CHECK: ' || trim_scale(v_use) || ' points used offline, but ' || v_perr);
    end if;
  end if;
  v_earn := bill_points(p, v_phone);

  -- A due (pay later): only with the customer's mobile number; above the limit (Settings, ₹200) only with the owner.
  -- A bill made offline is saved anyway, with a CHECK note.
  if v_due > 0 then
    v_perr := case when v_cust.id is null then 'a due needs the customer''s mobile number'
                   when v_due > v_duemax and not owner_ok() then 'a due above ₹' || trim_scale(v_duemax) || ' needs the owner' end;
    if v_perr is not null then
      if not v_offline then raise exception '%', 'Due: ' || v_perr; end if;
      v_note := concat_ws(' | ', v_note, 'CHECK: ₹' || trim_scale(v_due) || ' due offline, but ' || v_perr);
    end if;
  end if;
  if v_chg > 0 then
    v_note := concat_ws(' | ', v_note, 'Change ₹' || trim_scale(v_chg) || ' given by UPI');
  end if;

  -- 2. Bill number: <prefix><financial year>-<running number>, e.g. HF2627-0001
  --    Offline bills keep the number printed on them. If two devices used the same
  --    offline letter, the later one gets "-2" (or "-3" …) added and a note.
  --    Past bills have their own series in the financial year of their date: HF2627-P0001, so today's
  --    numbers keep running in date order.
  if v_no is null and v_past then
    v_fy := fy_code(v_at);
    v_prefix := coalesce((select value #>> '{}' from settings where key = 'bill_prefix'), 'HF');
    insert into counters (key, value) values ('bill-P-' || v_fy, 1)
    on conflict (key) do update set value = counters.value + 1
    returning value into v_n;
    v_no := v_prefix || v_fy || '-P' || lpad(v_n::text, 4, '0');
  elsif v_no is null then
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
                     pay_mode, paid_cash, paid_upi, paid_card, paid_points, points_earned, note, created_by, for_staff, paid_due, change_upi)
  values (v_id, v_no, v_at,
          v_cust.id, coalesce(nullif(p->>'customer_name', ''), v_cust.name), v_phone, v_new,
          (p->>'subtotal')::numeric, coalesce((p->>'offer_discount')::numeric, 0),
          coalesce((p->>'discount')::numeric, 0), (p->>'taxable')::numeric,
          coalesce((p->>'cgst')::numeric, 0), coalesce((p->>'sgst')::numeric, 0),
          coalesce((p->>'round_off')::numeric, 0), (p->>'total')::numeric,
          p->>'pay_mode', coalesce((p->>'paid_cash')::numeric, 0), coalesce((p->>'paid_upi')::numeric, 0),
          coalesce((p->>'paid_card')::numeric, 0), v_use, v_earn, v_note, nullif(p->>'created_by', ''), v_sp.for_staff, v_due, v_chg)
  returning * into v_bill;

  -- A corrected bill ("Correct items" in the app): it replaces a bill the owner just cancelled. Linked both ways.
  if coalesce(p->>'replaces', '') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    update bills set replaced_by = v_bill.id
     where id = (p->>'replaces')::uuid and status = 'cancelled' and replaced_by is null;
    if found then
      update bills set replaces = (p->>'replaces')::uuid where id = v_bill.id returning * into v_bill;
    end if;
  end if;

  -- 4. Items (+ stock out for products). A service, product, staff member or offer deleted
  --    while this bill waited offline is kept by name only, so the bill still uploads.
  for it in select * from jsonb_array_elements(p->'items') loop
    v_prod := (select id from products where id = nullif(it->>'product_id', '')::uuid);
    insert into bill_items (bill_id, created_at, item_type, service_id, product_id, name, category, hsn_sac,
                            staff_id, staff_name, qty, unit_price, amount, offer_id, offer_name, offer_discount,
                            line_discount, staff_discount, commission_base, discount, taxable, gst_pct, gst)
    values (v_bill.id, v_bill.created_at, it->>'item_type',
            (select id from services where id = nullif(it->>'service_id', '')::uuid), v_prod,
            it->>'name', it->>'category', nullif(it->>'hsn_sac', ''),
            (select id from staff where id = nullif(it->>'staff_id', '')::uuid), nullif(it->>'staff_name', ''),
            (it->>'qty')::numeric, (it->>'unit_price')::numeric, (it->>'amount')::numeric,
            (select id from offers where id = nullif(it->>'offer_id', '')::uuid), nullif(it->>'offer_name', ''),
            coalesce((it->>'offer_discount')::numeric, 0), coalesce((it->>'line_discount')::numeric, 0),
            coalesce((it->>'staff_discount')::numeric, 0), coalesce(nullif(it->>'commission_base', '')::numeric, (it->>'taxable')::numeric),
            coalesce((it->>'discount')::numeric, 0), (it->>'taxable')::numeric,
            coalesce((it->>'gst_pct')::numeric, 0), coalesce((it->>'gst')::numeric, 0));

    if it->>'item_type' = 'product' and v_prod is not null then
      insert into stock_moves (product_id, type, qty, bill_id, note, created_at)
      values (v_prod, 'sale', -((it->>'qty')::numeric), v_bill.id, v_bill.bill_no, v_bill.created_at);
    end if;
  end loop;

  -- 5. Loyalty points used and earned, then the customer's visit count and spend
  if v_cust.id is not null then
    if v_use > 0 then
      insert into loyalty_points (customer_id, bill_id, kind, points, created_at, created_by)
      values (v_cust.id, v_bill.id, 'use', -(v_use::int), v_at, nullif(p->>'created_by', ''));
    end if;
    if v_earn > 0 then
      insert into loyalty_points (customer_id, bill_id, kind, points, created_at, created_by)
      values (v_cust.id, v_bill.id, 'earn', v_earn, v_at, nullif(p->>'created_by', ''));
    end if;
    update bills set points_balance = (select points from customers where id = v_cust.id) where id = v_bill.id;
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

  -- Points: the ones used go back, the ones earned come off. Points from before they expired stay expired
  -- (a bill older than the customer's last expiry changes nothing).
  if v_bill.customer_id is not null then
    perform expire_points(v_bill.customer_id, now());
    if v_bill.paid_points::int - v_bill.points_earned <> 0
       and not exists (select 1 from loyalty_points where customer_id = v_bill.customer_id and kind = 'expire' and created_at > v_bill.created_at) then
      insert into loyalty_points (customer_id, bill_id, kind, points, note)
      values (v_bill.customer_id, p_id, 'cancel', v_bill.paid_points::int - v_bill.points_earned, 'Cancelled ' || v_bill.bill_no);
    end if;
  end if;

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
       sum(paid_cash) as cash, sum(paid_upi) as upi, sum(paid_card) as card,
       sum(paid_points) as points_used, sum(points_earned) as points_earned
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
  action       text not null check (action in ('unlock', 'cancel', 'discount', 'stock', 'service')),
  ref          uuid,                        -- the bill (cancel, discount), stock move, or service / category being changed
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
alter table owner_grants add constraint owner_grants_action_check check (action in ('unlock', 'cancel', 'discount', 'stock', 'service'));
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

-- The owner is here: an owner login, or the owner typed the Authenticator code at the counter
-- (an unlock approved on Telegram is not enough). Adding services and categories, and past bills, need this.
create or replace function owner_here() returns boolean
language sql stable security definer set search_path = public as $$
  select direct_session() or is_owner() or exists (
    select 1 from owner_grants
    where session_id = current_session_id() and user_id = auth.uid()
      and action = 'unlock' and method = 'code' and status = 'approved' and expires_at > now());
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
  if p_action not in ('unlock', 'cancel', 'discount', 'stock', 'service') then raise exception 'Unknown request'; end if;
  if (select count(*) from owner_grants where session_id = current_session_id() and status = 'pending'
      and created_at > now() - interval '15 minutes') >= 5 then
    raise exception 'Too many requests waiting. Wait for the owner to answer.';
  end if;
  if p_action in ('cancel', 'discount', 'stock', 'service') and p_ref is null then raise exception 'Which bill or item?'; end if;
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

-- Take stock out of the store (opening a new tube, jar, tin or kit), recording who took it and what happened
-- to the one in use now: finished with the empty handed back ("empty for full"), finished without the empty,
-- or still in use (this is a second one). A finished one ends its unit (unit_ends), which the Bottle check
-- counts the services of. The counter can't do this by writing to stock_moves directly; it must come through here.
-- Needs the owner when Settings say so: 'always', 'expensive' (worth ₹500+ or no empty handed back), or 'never'.
create or replace function issue_stock(p jsonb) returns stock_moves
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_prod  products;
  v_qty   numeric := (p->>'qty')::numeric;
  v_staff uuid := (select id from staff where id = nullif(p->>'staff_id', '')::uuid);
  -- the one in use now: 'empty', 'no_empty' or 'in_use' (older apps send only empty_returned)
  v_last  text := coalesce(nullif(p->>'last', ''), case when coalesce((p->>'empty_returned')::boolean, false) then 'empty' else 'no_empty' end);
  v_open  uuid;
  v_empty boolean;
  v_size  numeric;
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
  if v_last not in ('empty', 'no_empty', 'in_use') then raise exception 'Say what happened to the one in use now'; end if;
  -- the size of the one given out (a different pack from the usual one), else the product's size
  v_size := coalesce(nullif(p ->> 'unit_size', '')::numeric, v_prod.size);
  if v_size is not null and (v_size <= 0 or v_size > 100000) then raise exception 'Size of one: more than 0'; end if;
  -- the one in use now: the taker's own open one, else the oldest open one
  select m.id into v_open from stock_moves m
   where m.product_id = v_prod.id and m.type = 'use' and m.qty < 0 and not exists (select 1 from unit_ends e where e.move_id = m.id)
   order by (m.staff_id is not distinct from v_staff) desc, m.created_at, m.id limit 1;
  -- nothing in use (the first one, or the last one was marked Finished): there is no empty to hand back
  v_empty := v_open is null or v_last = 'empty';
  if (v_rule = 'always' or (v_rule = 'expensive' and (v_prod.cost_price * v_qty >= v_above or not v_empty)))
     and not use_owner_grant(nullif(p->>'owner_grant_id', '')::uuid, 'stock', v_id, now(), 0) then
    raise exception 'Owner approval needed to take this out';
  end if;
  insert into stock_moves (id, product_id, type, qty, unit_cost, staff_id, empty_returned, note, created_by, owner_grant_id, unit_size)
  values (v_id, v_prod.id, 'use', -v_qty, v_prod.cost_price, v_staff, case when v_open is null then null else v_last = 'empty' end,
          nullif(p->>'note', ''), auth.jwt() ->> 'email', nullif(p->>'owner_grant_id', '')::uuid, v_size)
  returning * into v_move;
  if v_open is not null and v_last <> 'in_use' then
    insert into unit_ends (move_id, product_id, ended_at, how, by_move, created_by)
    values (v_open, v_prod.id, now(), v_last, v_id, auth.jwt() ->> 'email');
  end if;
  return v_move;
end $$;

-- =====================================================================
-- One service menu for the billing app AND the website
-- ---------------------------------------------------------------------
--   service_categories 1 ──< services 1 ──< service_usage >── 1 products
--                                     1 ──< booking_items >── 1 bookings
-- The billing app and the website read the same rows. A price changed in the app is on the
-- website at its next page load; nothing is copied anywhere. The website reads only through
-- web_site() (below), which returns just what is meant to be public.
-- services.section and services.category are kept as copies of the category's name (bills,
-- offers and reports use the names); they follow the category by themselves.
-- =====================================================================

-- "Clean-up & Facials" → "clean-up-and-facials", "Men's L'Oréal Spa" → "mens-loreal-spa" (same as slugify() in src/data/menu.js)
create or replace function slugify(t text) returns text
language sql immutable as $$
  select trim(both '-' from regexp_replace(
    translate(replace(regexp_replace(lower(coalesce(t, '')), '[''’]', '', 'g'), '&', ' and '), 'àáâäèéêëìíîïòóôöùúûüç', 'aaaaeeeeiiiioooouuuuc'),
    '[^a-z0-9]+', '-', 'g'));
$$;

-- The tabs on the billing screen (same list as SECTIONS in src/data/menu.js). "Beauty" is for anything else.
create or replace function menu_sections() returns text[]
language sql immutable as $$
  select array['Hair', 'Colour', 'Hair Spa', 'Hair Treatments', 'Facials', 'D-Tan', 'Threading', 'Waxing', 'Nails', 'Beauty', 'Makeup'];
$$;
-- The website page of a category that has none set (same as webPageOf() in src/data/menu.js)
create or replace function section_web_page(p_section text) returns text
language sql immutable as $$
  select case when p_section in ('Hair', 'Colour', 'Hair Spa', 'Hair Treatments') then 'hair'
              when p_section = 'Nails' then 'nails' when p_section = 'Makeup' then 'makeup' else 'beauty' end;
$$;

-- base, base-2, base-3 … whichever is free in that table
create or replace function unique_slug(p_table regclass, p_base text, p_id uuid) returns text
language plpgsql as $$
declare v text; n int := 1; taken boolean;
begin
  p_base := coalesce(nullif(p_base, ''), 'item');
  loop
    v := p_base || case when n > 1 then '-' || n else '' end;
    execute format('select exists (select 1 from %s where slug = $1 and id is distinct from $2)', p_table) into taken using v, p_id;
    exit when not taken;
    n := n + 1;
  end loop;
  return v;
end $$;

-- Price options: [{"label": "S", "price": 2500}, …], 2 to 20 of them, prices 0 or more
create or replace function valid_variants(v jsonb) returns boolean
language sql immutable as $$
  select v is null or v = 'null'::jsonb or (
    jsonb_typeof(v) = 'array' and jsonb_array_length(v) between 2 and 20
    and not exists (select 1 from jsonb_array_elements(v) e
                    where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'price') is distinct from 'number'
                       or (e ->> 'price')::numeric < 0 or coalesce(jsonb_typeof(e -> 'label'), 'string') <> 'string'));
$$;

-- A second choice added to the price at billing, e.g. {"title": "Hair thickness", "choices": [{"label": "Thick", "price": 500}]}
-- ("Normal" = no extra charge). 1 to 5 choices with a name and a price of 0 or more.
create or replace function valid_extra_options(v jsonb) returns boolean
language sql immutable as $$
  select v is null or v = 'null'::jsonb or (
    jsonb_typeof(v) = 'object' and jsonb_typeof(v -> 'title') = 'string' and length(v ->> 'title') between 1 and 40
    and jsonb_typeof(v -> 'choices') = 'array' and jsonb_array_length(v -> 'choices') between 1 and 5
    and not exists (select 1 from jsonb_array_elements(v -> 'choices') e
                    where jsonb_typeof(e) <> 'object' or jsonb_typeof(e -> 'label') is distinct from 'string' or length(trim(e ->> 'label')) = 0
                       or jsonb_typeof(e -> 'price') is distinct from 'number' or (e ->> 'price')::numeric < 0));
$$;

create table if not exists service_categories (
  id              uuid primary key default gen_random_uuid(),
  section         text not null default 'Hair' check (section = any (menu_sections())), -- tab on the billing screen
  name            text not null unique,          -- "Hair Spa": on bills, reports, offers and the website
  slug            text not null unique,          -- "hair-spa": the website's id. Set once, then never changes.
  sort            int  not null default 0,
  web_page        text check (web_page in ('hair', 'beauty', 'nails', 'makeup', 'bridal', 'groom')), -- website page
  web_tab         text,                          -- tab on that page, e.g. "Spa & Treatments"
  web_type        text,                          -- filter on the website's Services page, e.g. "Spa & Treatment"
  description     text,
  note            text,                          -- small print, e.g. "Patch test 48 hours before colour"
  image           text,                          -- website image name or link
  consult_only    boolean not null default false,-- website shows "Book consultation"
  show_on_website boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- November 2026: more tabs on the billing screen (Hair, Colour, Hair Spa, Hair Treatments, Facials, D-Tan …)
alter table service_categories drop constraint if exists service_categories_section_check;
alter table service_categories add constraint service_categories_section_check check (section = any (menu_sections()));
alter table services add column if not exists category_id     uuid references service_categories(id) on delete restrict;
alter table services add column if not exists slug            text;            -- website id, e.g. "global-colour-women"
alter table services add column if not exists web_name        text;            -- shorter name on the website ("Full Legs" under Waxing)
alter table services add column if not exists subtitle        text;            -- one line under the name
alter table services add column if not exists includes        text[];          -- "Wash", "Blow-dry" …
alter table services add column if not exists description     text;
alter table services add column if not exists duration_min    int;
alter table services add column if not exists for_gender      text not null default 'any';
alter table services add column if not exists show_on_website boolean not null default true;
alter table services add column if not exists book_online     boolean not null default true;
alter table services add column if not exists featured        boolean not null default false;
alter table services add column if not exists updated_at      timestamptz not null default now();
alter table services add column if not exists extra_options   jsonb;           -- e.g. hair thickness: Thick +₹500
create unique index if not exists services_slug_key on services (slug);
create index if not exists services_category_idx on services (category_id, sort);
alter table services drop constraint if exists services_for_gender_check;
alter table services add constraint services_for_gender_check check (for_gender in ('any', 'women', 'men'));
alter table services drop constraint if exists services_duration_check;
alter table services add constraint services_duration_check check (duration_min is null or duration_min between 5 and 720);
alter table services drop constraint if exists services_variants_check;
alter table services add constraint services_variants_check check (valid_variants(variants)) not valid;
alter table services drop constraint if exists services_extra_options_check;
alter table services add constraint services_extra_options_check check (valid_extra_options(extra_options)) not valid;
alter table services drop constraint if exists services_price_check;
alter table services add constraint services_price_check check (price >= 0) not valid;

-- Website extras on offers (the billing app ignores them)
alter table offers add column if not exists show_on_website boolean not null default false;
alter table offers add column if not exists web_title  text;   -- "Groom Makeup"
alter table offers add column if not exists web_text   text;   -- one or two lines for the offers panel
alter table offers add column if not exists web_tag    text;   -- "WEDDING SEASON"
alter table offers add column if not exists image      text;
alter table offers add column if not exists web_sort   int not null default 0;
alter table offers add column if not exists updated_at timestamptz not null default now();
-- Combos (November 2026): a set of services for one price, e.g. "Diwali Glow ₹1,799" = facial + D-tan + eyebrows.
-- kind 'combo', the services in service_ids (2 or more), the combo price in value. The counter adds them from the
-- Combos tab; the price is shared across the set's lines as the offer discount (applyOffers() in src/lib/offers.js),
-- and bill_menu_check() checks that the set is complete and the discount is no more than the combo allows.
alter table offers drop constraint if exists offers_kind_check;
alter table offers add constraint offers_kind_check check (kind in ('percent', 'amount', 'price', 'combo'));
alter table offers drop constraint if exists offers_combo_check;
alter table offers add constraint offers_combo_check check (kind <> 'combo' or (applies_to = 'services' and cardinality(service_ids) >= 2));

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists trg_touch_offers on offers;
create trigger trg_touch_offers before update on offers for each row execute function touch_updated_at();

-- Category: tidy the fields, give it a slug
create or replace function service_category_fill() returns trigger
language plpgsql as $$
begin
  new.name := trim(coalesce(new.name, ''));
  if new.name = '' then raise exception 'Enter a category name'; end if;
  new.web_page := nullif(trim(coalesce(new.web_page, '')), '');
  new.web_tab := nullif(trim(coalesce(new.web_tab, '')), '');
  new.web_type := nullif(trim(coalesce(new.web_type, '')), '');
  if tg_op = 'UPDATE' then
    if old.slug is not null and not direct_session() then new.slug := old.slug; end if; -- website links keep working
    new.updated_at := now();
  end if;
  if coalesce(new.slug, '') = '' then new.slug := unique_slug('service_categories', slugify(new.name), new.id); end if;
  return new;
end $$;
drop trigger if exists trg_service_category_fill on service_categories;
create trigger trg_service_category_fill before insert or update on service_categories
for each row execute function service_category_fill();

-- Category renamed or moved to another section: its services and offers follow
create or replace function service_category_moved() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (new.name, new.section) is distinct from (old.name, old.section) then
    update services set category = new.name, section = new.section where category_id = new.id;
    if new.name <> old.name then
      update offers set categories = array_replace(categories, old.name, new.name) where old.name = any(categories);
    end if;
  end if;
  return null;
end $$;
drop trigger if exists trg_service_category_moved on service_categories;
create trigger trg_service_category_moved after update on service_categories
for each row execute function service_category_moved();

-- Service: find its category (by id, or by name for older apps and the seed file; a new name makes
-- a new category), copy the category's name and section, price = cheapest option, give it a slug
create or replace function service_fill() returns trigger
language plpgsql security definer set search_path = public as $$
declare c service_categories;
begin
  if new.variants = 'null'::jsonb then new.variants := null; end if;
  if new.extra_options = 'null'::jsonb then new.extra_options := null; end if;
  if not valid_extra_options(new.extra_options) then raise exception 'Extra choice needs a title and choices like Thick:500'; end if;
  if new.category_id is not null
     and not (tg_op = 'UPDATE' and new.category_id is not distinct from old.category_id and new.category is distinct from old.category) then
    select * into c from service_categories where id = new.category_id;
  elsif coalesce(trim(new.category), '') <> '' then
    select * into c from service_categories where lower(name) = lower(trim(new.category));
    if not found then
      insert into service_categories (section, name, sort)
      values (case when new.section = any (menu_sections()) then new.section else 'Hair' end, trim(new.category), coalesce(new.sort, 0))
      returning * into c;
    end if;
  end if;
  if c.id is null then raise exception 'Choose a category for the service'; end if;
  new.category_id := c.id;
  new.category := c.name;
  new.section := c.section;
  new.name := trim(coalesce(new.name, ''));
  if new.name = '' then raise exception 'Enter the service name'; end if;
  new.web_name := nullif(trim(coalesce(new.web_name, '')), '');
  new.subtitle := nullif(trim(coalesce(new.subtitle, '')), '');
  if new.variants is not null then
    if not valid_variants(new.variants) then raise exception 'Price options need at least two prices, like S:2500, M:3000'; end if;
    new.price := (select min((e ->> 'price')::numeric) from jsonb_array_elements(new.variants) e);
  end if;
  if tg_op = 'UPDATE' then
    if old.slug is not null and not direct_session() then new.slug := old.slug; end if;
    new.updated_at := now();
  end if;
  if coalesce(new.slug, '') = '' then new.slug := unique_slug('services', slugify(new.name), new.id); end if;
  return new;
end $$;
drop trigger if exists trg_service_fill on services;
create trigger trg_service_fill before insert or update on services
for each row execute function service_fill();

-- Every change to the menu, with who made it and who approved it (Settings → Services → Change history)
create table if not exists service_changes (
  id             uuid primary key default gen_random_uuid(),
  service_id     uuid references services(id) on delete set null,
  category_id    uuid references service_categories(id) on delete set null,
  item           text not null,             -- name of the service or category
  kind           text not null check (kind in ('service', 'category')),
  action         text not null check (action in ('add', 'edit')),
  changes        jsonb not null,            -- {"price": [600, 549], "active": [true, false]}: before, after
  changed_by     text,                      -- the login that saved it
  approved_by    text,                      -- owner login, the code, or who approved on Telegram
  owner_grant_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists service_changes_created_idx on service_changes (created_at desc);

create or replace function log_menu_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  n jsonb := to_jsonb(new);
  d jsonb;
  g uuid := nullif(current_setting('app.owner_grant', true), '')::uuid;
begin
  if current_setting('app.no_log', true) = '1' then return null; end if; -- first fill of the menu (seed / upgrade)
  select jsonb_object_agg(k, jsonb_build_array(o -> k, n -> k)) into d
  from jsonb_object_keys(n) k
  where k not in ('id', 'created_at', 'updated_at', 'section', 'category', 'slug')
    and (o -> k) is distinct from (n -> k)
    and not (tg_op = 'INSERT' and (n -> k) = 'null'::jsonb);
  if d is null then return null; end if;
  insert into service_changes (service_id, category_id, item, kind, action, changes, changed_by, approved_by, owner_grant_id)
  values (case when tg_table_name = 'services' then new.id end,
          case when tg_table_name = 'service_categories' then new.id else (n ->> 'category_id')::uuid end,
          n ->> 'name', case when tg_table_name = 'services' then 'service' else 'category' end,
          case when tg_op = 'INSERT' then 'add' else 'edit' end, d,
          coalesce(auth.jwt() ->> 'email', 'database'),
          case when is_owner() then 'Owner login'
               when g is not null then (select decided_by from owner_grants where id = g)
               when direct_session() then 'Database' end,
          g);
  return null;
end $$;
drop trigger if exists trg_log_service_change on services;
create trigger trg_log_service_change after insert or update on services
for each row execute function log_menu_change();
drop trigger if exists trg_log_category_change on service_categories;
create trigger trg_log_category_change after insert or update on service_categories
for each row execute function log_menu_change();

-- Existing databases: make the categories from the services, then fill in the website fields.
-- (A new database gets them from 02_seed_services.sql, made from src/data/menu.js: keep the two lists the same.)
do $$
declare r record; c uuid;
begin
  perform set_config('app.no_log', '1', true);
  for r in select min(section) as section, category, min(sort) as s from services
           where category_id is null and coalesce(category, '') <> '' group by category order by min(sort) loop
    select id into c from service_categories where lower(name) = lower(r.category);
    if c is null then
      insert into service_categories (section, name, sort, slug)
      values (case when r.section in ('Hair', 'Beauty', 'Makeup') then r.section else 'Hair' end, r.category, r.s,
              case r.category when 'Waxing' then 'wax' when 'Rica Wax' then 'rica' when 'D-Tan / Bleach' then 'dtan'
                              when 'Add-on Mask' then 'mask' when 'Hair Colour' then 'color'
                              when 'Bridal Packages' then 'bridal-package' when 'Groom Packages' then 'groom-package' end)
      returning id into c;
    end if;
    update services set category_id = c where category_id is null and category = r.category;
  end loop;
  update services set name = name where slug is null; -- gives the rest a slug

  update service_categories c set web_page = d.page, web_tab = d.tab, web_type = d.type, consult_only = d.consult
  from (values
  ('Haircut',             'hair',   'Cuts & Styling',   'Cut & Style',      false),
  ('Blow Dry & Styling',  'hair',   'Cuts & Styling',   'Cut & Style',      false),
  ('Head Massage',        'hair',   'Spa & Treatments', 'Spa & Treatment',  false),
  ('Hair Colour',         'hair',   'Colour',           'Colour',           false),
  ('Hair Spa',            'hair',   'Spa & Treatments', 'Spa & Treatment',  false),
  ('Hair Treatments',     'hair',   'Spa & Treatments', 'Spa & Treatment',  true),
  ('Threading',           'beauty', 'Threading',        'Hair Removal',     false),
  ('Waxing',              'beauty', 'Waxing',           'Hair Removal',     false),
  ('Rica Wax',            'beauty', 'Waxing',           'Hair Removal',     false),
  ('D-Tan / Bleach',      'beauty', 'D-Tan & Bleach',   'Skin & Facial',    false),
  ('Clean-up & Facials',  'beauty', 'Facials',          'Skin & Facial',    false),
  ('Add-on Mask',         'beauty', 'D-Tan & Bleach',   'Skin & Facial',    false),
  ('Manicure & Pedicure', 'nails',  'Mani / Pedi',      'Nails',            false),
  ('Makeup',              'makeup', null,               'Makeup & Styling', false),
  ('Bridal Packages',     'bridal', null,               'Package',          true),
  ('Groom Packages',      'groom',  null,               'Package',          false)
  ) d(name, page, tab, type, consult)
  where c.name = d.name and c.web_page is null;

  -- Shorter names on the website, where the category already says it ("Wax Full Legs" → "Full Legs" under Waxing)
  update services set web_name = regexp_replace(name, '^(Wax|Rica|Threading|D-Tan/Bleach) ', '')
  where web_name is null and category in ('Waxing', 'Rica Wax', 'Threading', 'D-Tan / Bleach')
    and name ~ '^(Wax|Rica|Threading|D-Tan/Bleach) ';
  perform set_config('app.no_log', '', true);
end $$;

-- Who may change the menu:
--   * an owner login (or the SQL editor),
--   * the counter while the owner's Authenticator-code unlock is on (the owner is standing there), or
--   * a one-time approval of exactly this change (Telegram / owner's app), which is used up here.
-- A general unlock approved on Telegram is NOT enough: the owner sees every price change.
-- Returns the approval used ('' for an owner login), or null when not allowed.
create or replace function menu_change_grant(p_grant uuid, p_ref uuid) returns text
language plpgsql security definer set search_path = public as $$
declare g uuid;
begin
  if direct_session() or is_owner() then return ''; end if;
  if not session_ok() then return null; end if;
  select id into g from owner_grants
   where session_id = current_session_id() and user_id = auth.uid() and action = 'unlock' and method = 'code'
     and status = 'approved' and expires_at > now()
   order by expires_at desc limit 1;
  if g is not null then return g::text; end if;
  update owner_grants set used_at = now()
   where id = p_grant and session_id = current_session_id() and user_id = auth.uid() and action = 'service'
     and ref = p_ref and status = 'approved' and used_at is null and expires_at > now()
  returning id into g;
  return g::text;
end $$;

-- Add or change a service. Only the fields sent are changed. Services are hidden (active = false), never deleted.
create or replace function save_service(p jsonb) returns services
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_old  services;
  v_row  services;
  v_g    text;
  v_in   jsonb;
begin
  v_g := menu_change_grant(nullif(p ->> 'owner_grant_id', '')::uuid, v_id);
  if v_g is null then raise exception 'Owner approval needed to add or change a service'; end if;
  perform set_config('app.owner_grant', v_g, true);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_in from jsonb_each(p)
   where key = any (array['name', 'category_id', 'category', 'price', 'variants', 'open_price', 'gst_pct', 'sac', 'sort', 'active',
                          'web_name', 'subtitle', 'includes', 'description', 'duration_min', 'for_gender', 'show_on_website',
                          'book_online', 'featured', 'extra_options']);
  select * into v_old from services where id = v_id for update;
  if not found and not owner_here() then
    raise exception 'Only the owner can add a service: sign in as the owner, or the owner types the code';
  end if;
  if found then
    v_row := jsonb_populate_record(v_old, v_in);
    update services set
      name = v_row.name, category_id = v_row.category_id, category = v_row.category, price = v_row.price, variants = v_row.variants,
      open_price = v_row.open_price, gst_pct = v_row.gst_pct, sac = v_row.sac, sort = v_row.sort, active = v_row.active,
      web_name = v_row.web_name, subtitle = v_row.subtitle, includes = v_row.includes, description = v_row.description,
      duration_min = v_row.duration_min, for_gender = v_row.for_gender, show_on_website = v_row.show_on_website,
      book_online = v_row.book_online, featured = v_row.featured, extra_options = v_row.extra_options
    where id = v_id
    returning * into v_row;
  else
    v_row := jsonb_populate_record(null::services, jsonb_build_object(
      'id', v_id, 'section', 'Hair', 'price', 0, 'open_price', false, 'gst_pct', 5, 'active', true, 'for_gender', 'any',
      'show_on_website', true, 'book_online', true, 'featured', false,
      'sort', coalesce((select max(sort) from services), 0) + 10, 'created_at', now(), 'updated_at', now()) || v_in);
    insert into services select v_row.* returning * into v_row;
  end if;
  perform set_config('app.owner_grant', '', true);
  return v_row;
end $$;

-- Add or change a category (name, section, order, website fields). Same approval as a service.
create or replace function save_service_category(p jsonb) returns service_categories
language plpgsql security definer set search_path = public as $$
declare
  v_id   uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_old  service_categories;
  v_row  service_categories;
  v_g    text;
  v_in   jsonb;
begin
  v_g := menu_change_grant(nullif(p ->> 'owner_grant_id', '')::uuid, v_id);
  if v_g is null then raise exception 'Owner approval needed to add or change a category'; end if;
  perform set_config('app.owner_grant', v_g, true);
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_in from jsonb_each(p)
   where key = any (array['name', 'section', 'sort', 'web_page', 'web_tab', 'web_type', 'description', 'note', 'image',
                          'consult_only', 'show_on_website']);
  if v_in ? 'name' and exists (select 1 from service_categories where lower(name) = lower(trim(v_in ->> 'name')) and id <> v_id) then
    raise exception 'There is already a category with that name';
  end if;
  select * into v_old from service_categories where id = v_id for update;
  if not found and not owner_here() then
    raise exception 'Only the owner can add a category: sign in as the owner, or the owner types the code';
  end if;
  if found then
    v_row := jsonb_populate_record(v_old, v_in);
    update service_categories set
      name = v_row.name, section = v_row.section, sort = v_row.sort, web_page = v_row.web_page, web_tab = v_row.web_tab,
      web_type = v_row.web_type, description = v_row.description, note = v_row.note, image = v_row.image,
      consult_only = v_row.consult_only, show_on_website = v_row.show_on_website
    where id = v_id
    returning * into v_row;
  else
    v_row := jsonb_populate_record(null::service_categories, jsonb_build_object(
      'id', v_id, 'section', 'Hair', 'consult_only', false, 'show_on_website', true,
      'sort', coalesce((select max(sort) from service_categories), 0) + 10, 'created_at', now(), 'updated_at', now()) || v_in);
    insert into service_categories select v_row.* returning * into v_row;
  end if;
  perform set_config('app.owner_grant', '', true);
  return v_row;
end $$;

-- "Finished" on a product: it is used up and must be bought again (Stock → To buy, and a Telegram message).
-- If the app still shows some in stock, that many are written off as missing, which needs the owner.
-- The next stock in clears it.
create or replace function mark_finished(p jsonb) returns products
language plpgsql security definer set search_path = public as $$
declare
  v_id    uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_prod  products;
  v_left  numeric;
  v_grant uuid := nullif(p ->> 'owner_grant_id', '')::uuid;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  select * into v_prod from products where id = nullif(p ->> 'product_id', '')::uuid for update;
  if not found then raise exception 'Product not found'; end if;
  if exists (select 1 from stock_moves where id = v_id) then return v_prod; end if; -- sent twice
  v_left := greatest(v_prod.stock, 0);
  if v_left > 0 then
    if not use_owner_grant(v_grant, 'stock', v_id, now(), 0) then
      raise exception '%', 'Owner approval needed: the app still shows ' || trim_scale(v_left) || ' ' || v_prod.unit || ' in stock';
    end if;
    insert into stock_moves (id, product_id, type, qty, unit_cost, note, created_by, owner_grant_id)
    values (v_id, v_prod.id, 'adjust', -v_left, v_prod.cost_price,
            'Marked finished with ' || trim_scale(v_left) || ' ' || v_prod.unit || ' still in the app' || coalesce(' · ' || nullif(trim(p ->> 'note'), ''), ''),
            auth.jwt() ->> 'email', v_grant);
  end if;
  update products set finished_at = coalesce(finished_at, now()), finished_by = coalesce(finished_by, auth.jwt() ->> 'email', 'database'),
         note = case when nullif(trim(p ->> 'note'), '') is null then note
                     else left(trim(coalesce(note, '') || chr(10) || to_char(now() at time zone 'Asia/Kolkata', 'DD Mon') || ': ' || trim(p ->> 'note')), 1000) end
   where id = v_prod.id
  returning * into v_prod;
  -- the one(s) in use are used up too
  insert into unit_ends (move_id, product_id, ended_at, how, created_by)
  select m.id, m.product_id, now(), 'finished', auth.jwt() ->> 'email' from stock_moves m
   where m.product_id = v_prod.id and m.type = 'use' and m.qty < 0 and not exists (select 1 from unit_ends e where e.move_id = m.id);
  return v_prod;
end $$;

-- =====================================================================
-- Bottle check: how many services each tube / jar / bottle / kit lasted
-- ---------------------------------------------------------------------
-- The same maths is in src/lib/units.js (demo mode); npm test checks the two agree.
-- =====================================================================

-- How many uses one bill line counts as, from the option in its name: "Keratin / Cysteine (L · Thick)" = 2 + 0.5.
-- Same as useWeight() in src/data/usage.js.
create or replace function use_weight(p_name text) returns numeric
language plpgsql immutable set search_path = public as $$
declare parts text[]; x text; w numeric;
begin
  parts := string_to_array(substring(coalesce(p_name, '') from '\(([^()]*)\)\s*$'), ' · ');
  if parts is null or array_length(parts, 1) is null then return 1; end if;
  w := case trim(parts[1]) when 'Fringe' then 0.5 when 'Crown area' then 0.75 when 'S' then 1 when 'M' then 1.5
                           when 'L' then 2 when 'XL' then 2.5 else 1 end;
  foreach x in array parts loop
    w := w + case trim(x) when 'Thick' then 0.5 when 'Extra thick' then 1 else 0 end;
  end loop;
  return w;
end $$;

-- Every unit (Give out) of a product that was in use on or after p_from, and how many uses it served:
-- the paid service lines (and uses without a bill) of the services ticked for it, while it was open.
-- A service done while two were open counts half for each. Uses and clients are per unit (3 kits given
-- out together: each kit's share). An extra row (how = 'gap', no move_id) holds the services billed while
-- none was in use at all, after the first Give out: something was used without a Give out.
-- scale: its size against the product's usual size (a 500 ml bottle of a 1 L product = 0.5), so normal is per usual size.
drop function if exists product_units(uuid, timestamptz);
create function product_units(p_product uuid, p_from timestamptz)
returns table (move_id uuid, staff_id uuid, n numeric, unit_cost numeric, started_at timestamptz, ended_at timestamptz,
               how text, by_move uuid, empty_returned boolean, is_first boolean, uses numeric, clients numeric,
               unit_size numeric, scale numeric)
language sql stable set search_path = public as $$
  with mv as (
    select m.id, m.staff_id, -m.qty as n, m.unit_cost, m.created_at as s, e.ended_at as e, e.how, e.by_move, m.empty_returned,
           row_number() over (order by m.created_at, m.id) = 1 as is_first, m.unit_size as us,
           coalesce(round(coalesce(m.unit_size, p.size) / nullif(p.size, 0), 4), 1) as sc
      from stock_moves m left join unit_ends e on e.move_id = m.id join products p on p.id = m.product_id
     where m.product_id = p_product and m.type = 'use' and m.qty < 0
  ),
  rep as (select * from mv where mv.s >= p_from or mv.e is null or mv.e > p_from),
  w0 as (select least(p_from, coalesce((select min(rep.s) from rep), p_from)) as t),
  allu as (select * from mv where mv.e is null or mv.e > (select t from w0)),
  lines as (
    select b.created_at as t, coalesce(bi.qty, 1) * su.weight * use_weight(bi.name) as w, coalesce(bi.qty, 1)::numeric as c
      from bill_items bi
      join bills b on b.id = bi.bill_id
      join service_usage su on su.service_id = bi.service_id and su.product_id = p_product
     where bi.item_type = 'service' and b.status = 'paid' and b.created_at >= (select t from w0)
    union all
    select f.created_at, f.qty * su.weight * use_weight('(' || concat_ws(' · ', f.option_label, f.extra_label) || ')'), f.qty
      from free_uses f
      join service_usage su on su.service_id = f.service_id and su.product_id = p_product
     where f.created_at >= (select t from w0)
  ),
  shared as (
    select l.t, l.w, l.c, (select sum(x.n) from allu x where x.s <= l.t and (x.e is null or x.e > l.t)) as k from lines l
  )
  select u.id, u.staff_id, u.n, u.unit_cost, u.s, u.e, u.how, u.by_move, u.empty_returned, u.is_first,
         round(coalesce(sum(sh.w / sh.k), 0), 2), round(coalesce(sum(sh.c / sh.k), 0), 2), u.us, u.sc
    from rep u left join shared sh on sh.k > 0 and sh.t >= u.s and (u.e is null or sh.t < u.e)
   group by u.id, u.staff_id, u.n, u.unit_cost, u.s, u.e, u.how, u.by_move, u.empty_returned, u.is_first, u.us, u.sc
  union all
  select null, null, 0, null, null, null, 'gap', null, null, false, round(sum(sh.w), 2), round(sum(sh.c), 2), null, null
    from shared sh
   where sh.k is null and sh.t >= greatest(p_from, (select min(mv.s) from mv)) and exists (select 1 from mv)
  having count(*) > 0
$$;

-- Normal uses per unit: the owner's number, else the middle of the finished ones (not the first one ever,
-- which may have shared with one opened before the app), once there are 3. Same as unitNormal() in stockcheck.js.
create or replace function unit_normal(p_product uuid) returns jsonb
language sql stable set search_path = public as $$
  with u as (select x.uses / x.scale as uses from product_units(p_product, now() - interval '180 days') x
              where x.move_id is not null and x.ended_at is not null and not x.is_first and x.scale > 0),
       l as (select count(*)::int as n, (percentile_cont(0.5) within group (order by u.uses))::numeric as m from u)
  select jsonb_build_object(
           'set', p.uses_per_unit,
           'learned', case when l.n >= 3 then round(l.m, 2) end,
           'learned_n', l.n,
           'normal', coalesce(p.uses_per_unit, case when l.n >= 3 and l.m > 0 then round(l.m, 2) end))
    from products p, l where p.id = p_product
$$;

-- Everything the Bottle check screen shows, for the last 180 days (or since p_since)
create or replace function unit_report(p_since timestamptz default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare v_from timestamptz := coalesce(p_since, now() - interval '180 days');
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  return jsonb_build_object('now', now(), 'from', v_from, 'products', coalesce((
    select jsonb_agg(jsonb_build_object(
             'product_id', p.id,
             'tags', (select count(*) from service_usage su where su.product_id = p.id),
             'units', coalesce((select jsonb_agg(to_jsonb(u) order by u.started_at nulls last, u.move_id) from product_units(p.id, v_from) u), '[]'::jsonb))
           order by p.name, p.id)
      from products p
     where exists (select 1 from service_usage su where su.product_id = p.id)
        or exists (select 1 from stock_moves m where m.product_id = p.id and m.type = 'use')
  ), '[]'::jsonb));
end $$;

-- "Used without a bill": a redo, the staff's own service, family, training. Anyone at the counter can record
-- one; the owners are told each time and see them all in the Bottle check.
create or replace function record_free_use(p jsonb) returns free_uses
language plpgsql security definer set search_path = public as $$
declare
  v_id  uuid := coalesce(nullif(p ->> 'id', '')::uuid, gen_random_uuid());
  v_svc services;
  v_opt text := nullif(trim(p ->> 'option'), '');
  v_ext text := nullif(trim(p ->> 'extra'), '');
  v_qty numeric := coalesce(nullif(p ->> 'qty', '')::numeric, 1);
  v_row free_uses;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  select * into v_row from free_uses where id = v_id;
  if found then return v_row; end if; -- sent twice
  select * into v_svc from services where id = nullif(p ->> 'service_id', '')::uuid;
  if not found then raise exception 'Choose the service'; end if;
  if v_opt is not null and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_svc.variants) = 'array' then v_svc.variants else '[]'::jsonb end) e
                                        where e ->> 'label' = v_opt) then
    raise exception 'Choose an option of this service from the menu';
  end if;
  if v_ext is not null and not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(v_svc.extra_options -> 'choices') = 'array' then v_svc.extra_options -> 'choices' else '[]'::jsonb end) e
                                        where e ->> 'label' = v_ext) then
    raise exception 'Choose an option of this service from the menu';
  end if;
  if coalesce(p ->> 'reason', '') not in ('redo', 'staff', 'family', 'training', 'other') then raise exception 'Choose why there was no bill'; end if;
  if p ->> 'reason' = 'other' and nullif(trim(p ->> 'note'), '') is null then raise exception 'Write what it was for'; end if;
  if v_qty <= 0 or v_qty > 20 then raise exception 'How many? 1 to 20.'; end if;
  insert into free_uses (id, service_id, option_label, extra_label, qty, staff_id, reason, note, created_by)
  values (v_id, v_svc.id, v_opt, v_ext, v_qty, (select id from staff where id = nullif(p ->> 'staff_id', '')::uuid),
          p ->> 'reason', left(nullif(trim(p ->> 'note'), ''), 200), auth.jwt() ->> 'email')
  returning * into v_row;
  return v_row;
end $$;

-- Two in use and one of them is empty, with no new one needed (the other is still in use): it ends here.
-- Only while another one stays in use, so "none in use" (no empty needed at the next Give out) can't be
-- reached this way; a finished product is marked Finished instead.
create or replace function end_unit(p jsonb) returns unit_ends
language plpgsql security definer set search_path = public as $$
declare v_move stock_moves; v_row unit_ends; v_how text := coalesce(nullif(p ->> 'how', ''), 'empty');
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  select * into v_move from stock_moves where id = nullif(p ->> 'move_id', '')::uuid and type = 'use' and qty < 0 for update;
  if not found then raise exception 'Not found'; end if;
  select * into v_row from unit_ends where move_id = v_move.id;
  if found then return v_row; end if; -- sent twice
  if v_how not in ('empty', 'no_empty') then raise exception 'Empty handed back: yes or no'; end if;
  if not exists (select 1 from stock_moves m where m.product_id = v_move.product_id and m.type = 'use' and m.qty < 0 and m.id <> v_move.id
                    and not exists (select 1 from unit_ends e where e.move_id = m.id)) then
    raise exception 'This is the only one in use. Give out the next one, or mark the product Finished.';
  end if;
  insert into unit_ends (move_id, product_id, ended_at, how, created_by)
  values (v_move.id, v_move.product_id, now(), v_how, auth.jwt() ->> 'email')
  returning * into v_row;
  return v_row;
end $$;

-- Finished early: below 70% of what it should have served, and at least one whole service short (so one
-- small tube a little short is not flagged). Same as isEarly() in src/lib/stockcheck.js.
create or replace function unit_early(p_uses numeric, p_expected numeric) returns boolean
language sql immutable as $$
  select p_expected is not null and p_uses < 0.7 * p_expected and p_expected - p_uses >= 1;
$$;

-- How a unit that just ended did: uses, normal, finished early, value not explained by bills, and how many
-- others of this product finished early in the last 90 days (and how many of those the same person took)
create or replace function unit_ended_info(p_move uuid) returns jsonb
language plpgsql stable set search_path = public as $$
declare e unit_ends; p products; u record; nrm jsonb; v_normal numeric; v_exp numeric; v_before int := 0; v_taker int := 0;
begin
  select * into e from unit_ends where move_id = p_move;
  if not found then return null; end if;
  select * into p from products where id = e.product_id;
  select * into u from product_units(p.id, e.ended_at - interval '1 second') x where x.move_id = p_move;
  nrm := unit_normal(p.id);
  v_normal := case when exists (select 1 from service_usage where product_id = p.id) then (nrm ->> 'normal')::numeric end;
  v_exp := v_normal * u.scale;
  if v_normal is not null then
    select count(*), count(*) filter (where x.staff_id is not distinct from u.staff_id) into v_before, v_taker
      from product_units(p.id, now() - interval '90 days') x
     where x.move_id is not null and x.move_id <> p_move and x.ended_at is not null and not x.is_first
       and unit_early(x.uses, v_normal * x.scale);
  end if;
  return jsonb_build_object(
    'given_to', (select name from staff where id = u.staff_id), 'started_at', u.started_at, 'ended_at', e.ended_at, 'how', e.how,
    'uses', u.uses, 'clients', u.clients, 'first', u.is_first, 'normal', round(v_exp, 2), 'scale', u.scale, 'unit_size', u.unit_size,
    'normal_source', case when v_normal is null then null when nrm ->> 'set' is not null then 'set' else 'learned' end,
    'early', not u.is_first and unit_early(u.uses, v_exp),
    'early_before', v_before, 'early_same_person', v_taker,
    'value', case when v_exp > 0 and u.uses < v_exp then round((1 - u.uses / v_exp) * coalesce(u.unit_cost, p.cost_price) * u.n, 0) end);
end $$;

-- For the Telegram message right after a Give out (only the Telegram function can call it; once, within
-- 10 minutes): did the one it replaced finish early, and is the store running out?
create or replace function unit_alert(p_move uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare m stock_moves; p products; v_ended uuid;
begin
  select * into m from stock_moves where id = p_move and type = 'use';
  if not found or m.created_at < now() - interval '10 minutes' then return null; end if;
  insert into alerts_sent (kind, ref) values ('unit', p_move) on conflict do nothing;
  if not found then return null; end if; -- already sent
  select * into p from products where id = m.product_id;
  v_ended := (select move_id from unit_ends where by_move = p_move);
  return jsonb_build_object('product', p.name, 'brand', p.brand, 'unit', p.unit, 'taker', (select name from staff where id = m.staff_id),
                            'stock', p.stock, 'low_stock', p.low_stock, 'before', p.stock - m.qty,
                            'ended', case when v_ended is not null then unit_ended_info(v_ended) end);
end $$;

-- For the Telegram message after "One is empty" (end_unit): did it finish early? Once, within 10 minutes.
create or replace function unit_end_alert(p_move uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e unit_ends; p products;
begin
  select * into e from unit_ends where move_id = p_move and by_move is null and how <> 'finished';
  if not found or e.ended_at < now() - interval '10 minutes' then return null; end if;
  insert into alerts_sent (kind, ref) values ('unit_end', p_move) on conflict do nothing;
  if not found then return null; end if;
  select * into p from products where id = e.product_id;
  return jsonb_build_object('product', p.name, 'brand', p.brand, 'unit', p.unit, 'ended', unit_ended_info(p_move));
end $$;

-- For the Telegram message right after a bill (only the Telegram function; within 10 minutes of the bill),
-- for each product its services use:
--   almost: the one in use has done 90% of normal and none is left in the store (each unit told once)
--   gap:    none is in use in the app although it has been given out before: one was probably taken without
--           Give out (told once a day per product)
create or replace function bill_stock_alert(p_bill uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare b bills; r products; u record; v_normal numeric; out jsonb := '[]'::jsonb;
begin
  select * into b from bills where id = p_bill and status = 'paid';
  if not found or b.created_at < now() - interval '10 minutes' then return out; end if;
  for r in select * from products where active and id in (
             select su.product_id from bill_items bi join service_usage su on su.service_id = bi.service_id
              where bi.bill_id = p_bill and bi.item_type = 'service') order by name loop
    if exists (select 1 from stock_moves m where m.product_id = r.id and m.type = 'use' and m.qty < 0)
       and not exists (select 1 from stock_moves m where m.product_id = r.id and m.type = 'use' and m.qty < 0
                          and not exists (select 1 from unit_ends e where e.move_id = m.id)) then
      insert into alerts_sent (kind, ref) values ('gap ' || to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD'), r.id) on conflict do nothing;
      if found then
        out := out || jsonb_build_array(jsonb_build_object('kind', 'gap', 'product', r.name, 'brand', r.brand, 'unit', r.unit, 'stock', r.stock,
                 'service', (select string_agg(distinct bi.name, ', ') from bill_items bi join service_usage su on su.service_id = bi.service_id
                              where bi.bill_id = p_bill and su.product_id = r.id)));
      end if;
      continue;
    end if;
    continue when r.stock > 0;
    v_normal := (unit_normal(r.id) ->> 'normal')::numeric;
    continue when v_normal is null;
    for u in select * from product_units(r.id, now()) x where x.move_id is not null and x.ended_at is null and x.uses >= 0.9 * v_normal * x.scale loop
      insert into alerts_sent (kind, ref) values ('almost', u.move_id) on conflict do nothing;
      if found then
        out := out || jsonb_build_array(jsonb_build_object('kind', 'almost', 'product', r.name, 'brand', r.brand, 'unit', r.unit, 'uses', u.uses,
                 'normal', round(v_normal * u.scale, 2), 'given_to', (select name from staff where id = u.staff_id), 'started_at', u.started_at));
      end if;
    end loop;
  end loop;
  return out;
end $$;

-- For the Telegram message about a use without a bill (only the Telegram function; once, within 10 minutes)
create or replace function free_use_alert(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare f free_uses;
begin
  select * into f from free_uses where id = p_id;
  if not found or f.created_at < now() - interval '10 minutes' then return null; end if;
  insert into alerts_sent (kind, ref) values ('free_use', p_id) on conflict do nothing;
  if not found then return null; end if;
  return jsonb_build_object('service', (select name from services where id = f.service_id), 'option', f.option_label, 'extra', f.extra_label,
    'qty', f.qty, 'staff', (select name from staff where id = f.staff_id), 'reason', f.reason, 'note', f.note, 'by', f.created_by,
    'at', f.created_at, 'this_month', (select count(*) from free_uses x
      where x.created_at >= (date_trunc('month', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata')));
end $$;

-- =====================================================================
-- Bookings: the website's booking form, WhatsApp and phone bookings
-- =====================================================================
create table if not exists bookings (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null,                 -- short code for the customer, e.g. "7F3A2C"
  phone        text not null,                 -- 10 digits: joins to customers, bills, WhatsApp
  name         text,
  customer_id  uuid references customers(id) on delete set null,
  want_date    date,                          -- what the customer asked for
  want_time    text,                          -- "11:30" or "Evening"
  slot_at      timestamptz,                   -- the time the salon confirmed
  staff_id     uuid references staff(id) on delete set null,
  offer_id     uuid references offers(id) on delete set null,
  source       text not null default 'website' check (source in ('website', 'whatsapp', 'phone', 'walk_in', 'instagram', 'other')),
  status       text not null default 'requested' check (status in ('requested', 'confirmed', 'came', 'no_show', 'cancelled')),
  note         text,
  utm          jsonb,                         -- {"source": "instagram", "campaign": "diwali"} from the website link
  bill_id      uuid references bills(id) on delete set null, -- the bill when they came
  notified_at  timestamptz,                   -- Telegram message sent
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table bookings add column if not exists client_key text; -- md5 of the sender's internet address: only for the spam limit
create index if not exists bookings_phone_idx on bookings (phone, created_at desc);
create index if not exists bookings_client_idx on bookings (client_key, created_at desc);
create index if not exists bookings_day_idx on bookings (want_date);
drop trigger if exists trg_touch_bookings on bookings;
create trigger trg_touch_bookings before update on bookings for each row execute function touch_updated_at();

create table if not exists booking_items (
  id            uuid primary key default gen_random_uuid(),
  booking_id    uuid not null references bookings(id) on delete cascade,
  service_id    uuid references services(id) on delete set null,
  name          text not null,                -- kept even if the service is removed later
  option_label  text,                         -- "M", "Shoulder length" …
  price         numeric(10,2),                -- the menu price when they booked
  price_from    boolean not null default false-- "from ₹…" (price depends on hair length or is typed at billing)
);
create index if not exists booking_items_booking_idx on booking_items (booking_id);

-- Added at the counter (WhatsApp, phone, walk-in): who, how long, when confirmed / reminded, why cancelled
alter table bookings add column if not exists created_by    text;
alter table bookings add column if not exists duration_min  int;          -- the services' times added up (30 min each when not set)
alter table bookings add column if not exists confirmed_at  timestamptz;
alter table bookings add column if not exists reminded_at   timestamptz;  -- WhatsApp reminder opened from the app
alter table bookings add column if not exists confirm_sent_at timestamptz; -- WhatsApp confirmation opened from the app (for this time)
alter table bookings add column if not exists cancel_reason text;
create index if not exists bookings_status_idx on bookings (status, want_date);

-- Enquiries: someone asked (a price, a service, a day) but hasn't booked. From WhatsApp, a call, Instagram,
-- the website's "Ask us" form, or at the counter. Followed up until they book, come or say no.
create table if not exists enquiries (
  id           uuid primary key default gen_random_uuid(),
  ref          text not null default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  phone        text not null check (phone ~ '^[6-9][0-9]{9}$'),
  name         text,
  customer_id  uuid references customers(id) on delete set null,
  source       text not null default 'whatsapp' check (source in ('website', 'whatsapp', 'phone', 'walk_in', 'instagram', 'other')),
  message      text,                       -- what they asked, in their words
  service_ids  uuid[],                     -- the services they asked about
  status       text not null default 'new' check (status in ('new', 'replied', 'follow_up', 'booked', 'came', 'closed')),
  follow_up_on date,                       -- when to message them again
  close_reason text,                       -- price, too far, just asking, went elsewhere …
  booking_id   uuid references bookings(id) on delete set null,
  utm          jsonb,
  client_key   text,                       -- website only, for the spam limit
  notified_at  timestamptz,                -- Telegram message sent (website)
  created_by   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists enquiries_status_idx on enquiries (status, follow_up_on);
create index if not exists enquiries_phone_idx on enquiries (phone, created_at desc);
drop trigger if exists trg_touch_enquiries on enquiries;
create trigger trg_touch_enquiries before update on enquiries for each row execute function touch_updated_at();
alter table bookings add column if not exists enquiry_id uuid references enquiries(id) on delete set null;

-- The website's booking form. Anyone can call it (no login), so it checks everything itself
-- and takes prices from the menu, never from the website.
create or replace function request_booking(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_phone  text;
  v_name   text := left(trim(coalesce(p ->> 'name', '')), 80);
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_date   date;
  v_b      bookings;
  it       jsonb;
  s        services;
  v_opt    text;
  v_price  numeric;
  v_from   boolean;
  v_h      json;
  v_client text;
begin
  -- who is sending (the address Supabase passes on), kept only as a hash, for the spam limit
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_h := null;
  end;
  v_client := md5(nullif(trim(coalesce(v_h ->> 'cf-connecting-ip', split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1), v_h ->> 'x-real-ip', '')), ''));
  if v_digits !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit mobile number'; end if;
  v_phone := right(v_digits, 10);
  if length(v_name) < 2 then raise exception 'Enter your name'; end if;
  begin
    v_date := nullif(p ->> 'date', '')::date;
  exception when others then
    raise exception 'Choose a date';
  end;
  if v_date is not null and (v_date < v_today or v_date > v_today + 90) then raise exception 'Choose a date in the next 90 days'; end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') not between 1 and 10 then
    raise exception 'Choose 1 to 10 services';
  end if;
  -- spam limits
  if (select count(*) from bookings where phone = v_phone and source = 'website' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'We already have 3 requests from this number today. We will call you back soon.';
  end if;
  if v_client is not null and (select count(*) from bookings where client_key = v_client and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many requests from this connection. Please call or WhatsApp us.';
  end if;
  if (select count(*) from bookings where source = 'website' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many requests right now. Please call or WhatsApp us.';
  end if;
  insert into bookings (ref, phone, name, customer_id, want_date, want_time, source, note, offer_id, utm, client_key)
  values (upper(substr(md5(gen_random_uuid()::text), 1, 6)), v_phone, v_name, (select id from customers where phone = v_phone),
          v_date, left(nullif(trim(p ->> 'time'), ''), 40), 'website', left(nullif(trim(p ->> 'note'), ''), 500),
          (select id from offers where id = case when p ->> 'offer_id' ~ '^[0-9a-f-]{36}$' then (p ->> 'offer_id')::uuid end and show_on_website),
          case when jsonb_typeof(p -> 'utm') = 'object' then
            (select jsonb_object_agg(key, left(value #>> '{}', 100)) from jsonb_each(p -> 'utm')
              where key in ('source', 'medium', 'campaign', 'content', 'term')) end,
          v_client)
  returning * into v_b;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into s from services
     where id = case when it ->> 'service_id' ~ '^[0-9a-f-]{36}$' then (it ->> 'service_id')::uuid end
       and active and show_on_website and book_online;
    if not found then raise exception 'One of the services can''t be booked online. Please call us.'; end if;
    v_opt := nullif(trim(coalesce(it ->> 'option', '')), '');
    v_price := s.price;
    v_from := s.open_price;
    if s.variants is not null then
      v_price := null;
      if v_opt is not null then
        select (e ->> 'price')::numeric into v_price from jsonb_array_elements(s.variants) e where e ->> 'label' = v_opt limit 1;
      end if;
      if v_price is null then v_price := s.price; v_from := true; v_opt := null; end if; -- no or unknown option: "from" price
    end if;
    -- a second choice, e.g. thick hair +₹500
    if s.extra_options is not null and nullif(trim(coalesce(it ->> 'extra', '')), '') is not null then
      select v_price + (e ->> 'price')::numeric, concat_ws(' · ', v_opt, e ->> 'label') into v_price, v_opt
      from jsonb_array_elements(s.extra_options -> 'choices') e where e ->> 'label' = trim(it ->> 'extra') limit 1;
    end if;
    insert into booking_items (booking_id, service_id, name, option_label, price, price_from)
    values (v_b.id, s.id, s.name, v_opt, v_price, v_from);
  end loop;
  return jsonb_build_object('id', v_b.id, 'ref', v_b.ref, 'status', v_b.status);
end $$;

-- A booking added or changed at the counter (WhatsApp, phone, walk-in), with its services. Prices come
-- from the menu. A time makes it confirmed. Same as saveBooking() in src/lib/localdb.js.
create or replace function save_booking(p jsonb) returns bookings
language plpgsql security definer set search_path = public as $$
declare
  v_id     uuid := nullif(p ->> 'id', '')::uuid;
  v_old    bookings;
  v_b      bookings;
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_phone  text;
  v_name   text := left(trim(coalesce(p ->> 'name', '')), 80);
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_slot   timestamptz;
  v_date   date;
  v_status text;
  v_source text;
  v_staff  uuid;
  v_dur    int := 0;
  it       jsonb;
  s        services;
  v_opt    text;
  v_price  numeric;
  v_from   boolean;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  if v_id is not null then
    select * into v_old from bookings where id = v_id for update;
    if not found then raise exception 'Booking not found'; end if;
  end if;
  if v_digits !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit mobile number'; end if;
  v_phone := right(v_digits, 10);
  if length(v_name) < 2 then raise exception 'Enter the name'; end if;
  begin
    v_slot := nullif(p ->> 'slot_at', '')::timestamptz;
  exception when others then raise exception 'Choose a time';
  end;
  begin
    v_date := coalesce(nullif(p ->> 'date', '')::date, (v_slot at time zone 'Asia/Kolkata')::date);
  exception when others then raise exception 'Choose a day';
  end;
  if v_date is null then raise exception 'Choose a day'; end if;
  if v_slot is not null and (v_slot at time zone 'Asia/Kolkata')::date <> v_date then raise exception 'The time is on another day'; end if;
  if v_old.id is null and v_date < v_today then raise exception 'Choose today or a later day'; end if;
  if v_date > v_today + 180 then raise exception 'Choose a day in the next 6 months'; end if;
  v_status := coalesce(nullif(p ->> 'status', ''), case when v_slot is not null then 'confirmed' else 'requested' end);
  if v_status not in ('requested', 'confirmed', 'came', 'no_show', 'cancelled') then raise exception 'Unknown status'; end if;
  if v_status = 'confirmed' and v_slot is null then raise exception 'Choose the time to confirm it'; end if;
  -- a website booking stays a website booking (for the campaign reports)
  v_source := case when v_old.source = 'website' then 'website' else coalesce(nullif(p ->> 'source', ''), v_old.source, 'whatsapp') end;
  if v_source not in ('website', 'whatsapp', 'phone', 'walk_in', 'instagram', 'other') then raise exception 'Unknown source'; end if;
  v_staff := (select id from staff where id = case when p ->> 'staff_id' ~ '^[0-9a-f-]{36}$' then (p ->> 'staff_id')::uuid end);
  if p ? 'items' or v_old.id is null then
    if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') not between 1 and 10 then
      raise exception 'Choose 1 to 10 services';
    end if;
  end if;

  if v_old.id is null then
    insert into bookings (ref, phone, name, customer_id, want_date, want_time, slot_at, staff_id, source, status, note, created_by,
                          confirmed_at, enquiry_id)
    values (upper(substr(md5(gen_random_uuid()::text), 1, 6)), v_phone, v_name, (select id from customers where phone = v_phone),
            v_date, case when v_slot is not null then to_char(v_slot at time zone 'Asia/Kolkata', 'HH24:MI') else left(nullif(trim(p ->> 'time'), ''), 40) end,
            v_slot, v_staff, v_source, v_status, left(nullif(trim(p ->> 'note'), ''), 500), auth.jwt() ->> 'email',
            case when v_status = 'confirmed' then now() end,
            (select id from enquiries where id = case when p ->> 'enquiry_id' ~ '^[0-9a-f-]{36}$' then (p ->> 'enquiry_id')::uuid end))
    returning * into v_b;
  else
    update bookings set phone = v_phone, name = v_name, customer_id = coalesce(customer_id, (select id from customers where phone = v_phone)),
           want_date = v_date,
           want_time = case when v_slot is not null then to_char(v_slot at time zone 'Asia/Kolkata', 'HH24:MI') else coalesce(left(nullif(trim(p ->> 'time'), ''), 40), want_time) end,
           slot_at = v_slot, staff_id = v_staff, source = v_source, status = v_status,
           note = case when p ? 'note' then left(nullif(trim(p ->> 'note'), ''), 500) else note end,
           confirmed_at = case when v_status = 'confirmed' and (old_confirmed(v_old) is distinct from v_slot) then now() else confirmed_at end,
           reminded_at = case when slot_at is distinct from v_slot then null else reminded_at end,
           confirm_sent_at = case when slot_at is distinct from v_slot then null else confirm_sent_at end,
           cancel_reason = case when v_status = 'cancelled' then left(nullif(trim(p ->> 'cancel_reason'), ''), 200) else null end
     where id = v_old.id
    returning * into v_b;
  end if;

  if p ? 'items' or v_old.id is null then
    delete from booking_items where booking_id = v_b.id;
    for it in select * from jsonb_array_elements(p -> 'items') loop
      select * into s from services where id = case when it ->> 'service_id' ~ '^[0-9a-f-]{36}$' then (it ->> 'service_id')::uuid end and active;
      if not found then raise exception 'A service is not on the menu any more'; end if;
      v_opt := nullif(trim(coalesce(it ->> 'option', '')), '');
      v_price := s.price;
      v_from := s.open_price;
      if s.variants is not null then
        v_price := null;
        if v_opt is not null then
          select (e ->> 'price')::numeric into v_price from jsonb_array_elements(s.variants) e where e ->> 'label' = v_opt limit 1;
        end if;
        if v_price is null then v_price := s.price; v_from := true; v_opt := null; end if;
      end if;
      if s.extra_options is not null and nullif(trim(coalesce(it ->> 'extra', '')), '') is not null then
        select v_price + (e ->> 'price')::numeric, concat_ws(' · ', v_opt, e ->> 'label') into v_price, v_opt
        from jsonb_array_elements(s.extra_options -> 'choices') e where e ->> 'label' = trim(it ->> 'extra') limit 1;
      end if;
      insert into booking_items (booking_id, service_id, name, option_label, price, price_from)
      values (v_b.id, s.id, s.name, v_opt, v_price, v_from);
      v_dur := v_dur + coalesce(s.duration_min, 30);
    end loop;
    update bookings set duration_min = greatest(v_dur, 15) where id = v_b.id returning * into v_b;
  end if;
  -- made from an enquiry: it is booked now
  if v_b.enquiry_id is not null then
    update enquiries set status = 'booked', booking_id = v_b.id where id = v_b.enquiry_id and status not in ('came');
  end if;
  return v_b;
end $$;

-- the time a booking was confirmed for (helper for save_booking: a new time is a new confirmation)
create or replace function old_confirmed(b bookings) returns timestamptz
language sql immutable as $$ select case when b.status = 'confirmed' then b.slot_at end $$;

-- The website's "Ask us" form (no login). Checks everything itself; the counter follows it up.
create or replace function request_enquiry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_phone  text;
  v_name   text := left(trim(coalesce(p ->> 'name', '')), 80);
  v_msg    text := left(trim(coalesce(p ->> 'message', '')), 1000);
  v_ids    uuid[];
  v_e      enquiries;
  v_h      json;
  v_client text;
begin
  begin
    v_h := nullif(current_setting('request.headers', true), '')::json;
  exception when others then
    v_h := null;
  end;
  v_client := md5(nullif(trim(coalesce(v_h ->> 'cf-connecting-ip', split_part(coalesce(v_h ->> 'x-forwarded-for', ''), ',', 1), v_h ->> 'x-real-ip', '')), ''));
  if v_digits !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'Enter a 10-digit mobile number'; end if;
  v_phone := right(v_digits, 10);
  if length(v_name) < 2 then raise exception 'Enter your name'; end if;
  if jsonb_typeof(p -> 'service_ids') = 'array' then
    if jsonb_array_length(p -> 'service_ids') > 10 then raise exception 'Choose up to 10 services'; end if;
    select array_agg(s.id) into v_ids from services s
     where s.active and s.show_on_website
       and s.id::text in (select x from jsonb_array_elements_text(p -> 'service_ids') x where x ~ '^[0-9a-f-]{36}$');
  end if;
  if length(v_msg) < 2 and v_ids is null then raise exception 'Write your question'; end if;
  if (select count(*) from enquiries where phone = v_phone and source = 'website' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'We already have your question. We will reply soon.';
  end if;
  if v_client is not null and (select count(*) from enquiries where client_key = v_client and created_at > now() - interval '1 hour') >= 5 then
    raise exception 'Too many questions from this connection. Please call or WhatsApp us.';
  end if;
  if (select count(*) from enquiries where source = 'website' and created_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many questions right now. Please call or WhatsApp us.';
  end if;
  insert into enquiries (phone, name, customer_id, source, message, service_ids, utm, client_key)
  values (v_phone, v_name, (select id from customers where phone = v_phone), 'website', nullif(v_msg, ''), v_ids,
          case when jsonb_typeof(p -> 'utm') = 'object' then
            (select jsonb_object_agg(key, left(value #>> '{}', 100)) from jsonb_each(p -> 'utm')
              where key in ('source', 'medium', 'campaign', 'content', 'term')) end,
          v_client)
  returning * into v_e;
  return jsonb_build_object('id', v_e.id, 'ref', v_e.ref);
end $$;

-- A paid bill for a phone that has a booking that day: they came (the booking gets the bill). Their open
-- enquiries from the last 30 days: came too. A cancelled bill puts the booking back. Nothing extra at billing.
create or replace function link_visit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.status = 'paid' and new.customer_phone is not null then
    update bookings set status = 'came', bill_id = new.id
     where id = (select b.id from bookings b
                  where b.phone = new.customer_phone and b.status in ('requested', 'confirmed') and b.bill_id is null
                    and b.want_date = (new.created_at at time zone 'Asia/Kolkata')::date
                  order by b.slot_at nulls last, b.created_at limit 1);
    update enquiries set status = 'came'
     where phone = new.customer_phone and status in ('new', 'replied', 'follow_up', 'booked')
       and created_at between new.created_at - interval '30 days' and new.created_at;
  elsif tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    update bookings set status = 'confirmed', bill_id = null where bill_id = new.id;
  end if;
  return null;
end $$;
drop trigger if exists trg_link_visit on bills;
create trigger trg_link_visit after insert or update of status on bills for each row execute function link_visit();

-- =====================================================================
-- Staff: face check-in, documents, leave requests
-- =====================================================================

-- Face check-in. The face prints (numbers worked out on the tablet from a few looks at the camera, not
-- photos) are made by the owner with the staff member's agreement. The tablet compares a new look with
-- them; a match checks them in (present) and, later in the day, out. A small photo of each check-in is
-- kept so the owner can see it was really them.
create table if not exists staff_faces (
  staff_id    uuid primary key references staff(id) on delete cascade,
  descriptors jsonb not null,           -- 3 to 5 face prints of 128 numbers
  photo       text,                     -- a small photo from the set-up, for the owner
  consent_at  timestamptz not null,     -- the staff member agreed to face check-in
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
alter table staff_faces drop constraint if exists staff_faces_descriptors_check;
alter table staff_faces add constraint staff_faces_descriptors_check check (
  jsonb_typeof(descriptors) = 'array' and jsonb_array_length(descriptors) between 1 and 10);
drop trigger if exists trg_touch_staff_faces on staff_faces;
create trigger trg_touch_staff_faces before update on staff_faces for each row execute function touch_updated_at();

create table if not exists check_ins (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff(id) on delete cascade,
  day          date not null,
  in_at        timestamptz not null default now(),
  out_at       timestamptz,
  in_photo     text,                    -- small JPEG of the face at check-in
  out_photo    text,
  in_distance  numeric(5,3),            -- how close the face was to the face prints (0 = same; 0.5 is the limit)
  out_distance numeric(5,3),
  created_by   text,
  unique (staff_id, day)
);
create index if not exists check_ins_day_idx on check_ins (day);

-- Check in or out with the face. The tablet has matched the face; this records it once a minute at most:
-- the first look of the day checks in (present), a look 30 minutes or more later checks out.
create or replace function face_check_in(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_staff staff;
  v_day   date := (now() at time zone 'Asia/Kolkata')::date;
  v_dist  numeric := nullif(p ->> 'distance', '')::numeric;
  v_photo text := p ->> 'photo';
  v_row   check_ins;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  select * into v_staff from staff where id = case when p ->> 'staff_id' ~ '^[0-9a-f-]{36}$' then (p ->> 'staff_id')::uuid end and active;
  if not found then raise exception 'Staff not found'; end if;
  if not exists (select 1 from staff_faces where staff_id = v_staff.id) then raise exception 'Face check-in is not set up for this person'; end if;
  if v_dist is null or v_dist < 0 or v_dist > 0.55 then raise exception 'The face did not match. Try again in better light.'; end if;
  if coalesce((p ->> 'live')::boolean, false) is not true then raise exception 'Blink or turn your head a little, so the app knows it is a real face'; end if;
  if v_photo is null or v_photo !~ '^data:image/(jpeg|png|webp);base64,' or length(v_photo) > 90000 then raise exception 'The check-in photo is missing'; end if;
  select * into v_row from check_ins where staff_id = v_staff.id and day = v_day for update;
  if not found then
    insert into check_ins (staff_id, day, in_photo, in_distance, created_by)
    values (v_staff.id, v_day, v_photo, round(v_dist, 3), auth.jwt() ->> 'email') returning * into v_row;
    insert into attendance (staff_id, day, status, marked_by) values (v_staff.id, v_day, 'P', 'face check-in')
    on conflict (staff_id, day) do update set status = 'P', marked_by = 'face check-in';
    return jsonb_build_object('kind', 'in', 'at', v_row.in_at, 'name', v_staff.name);
  end if;
  if now() < v_row.in_at + interval '30 minutes' then
    return jsonb_build_object('kind', 'again', 'at', v_row.in_at, 'name', v_staff.name);
  end if;
  if v_row.out_at is not null and now() < v_row.out_at + interval '1 minute' then
    return jsonb_build_object('kind', 'again_out', 'at', v_row.out_at, 'name', v_staff.name);
  end if;
  update check_ins set out_at = now(), out_photo = v_photo, out_distance = round(v_dist, 3) where id = v_row.id returning * into v_row;
  return jsonb_build_object('kind', 'out', 'at', v_row.out_at, 'in_at', v_row.in_at, 'name', v_staff.name);
end $$;

-- Staff documents: Aadhaar (masked), PAN, photo, bank details… The files are in private storage
-- ("staff-docs"); only the owner can see or add them.
create table if not exists staff_documents (
  id          uuid primary key default gen_random_uuid(),
  staff_id    uuid not null references staff(id) on delete cascade,
  kind        text not null check (kind in ('aadhaar', 'pan', 'photo', 'bank', 'address', 'certificate', 'agreement', 'other')),
  number      text,                     -- PAN, or only the last 4 digits of Aadhaar
  file_path   text,                     -- in storage: staff-docs/<staff id>/<file>
  file_name   text,
  mime        text,
  size_bytes  int,
  note        text,
  created_by  text,
  created_at  timestamptz not null default now()
);
alter table staff_documents drop constraint if exists staff_documents_aadhaar_check;
alter table staff_documents add constraint staff_documents_aadhaar_check check (kind <> 'aadhaar' or number is null or number ~ '^[0-9]{4}$');
create index if not exists staff_documents_staff_idx on staff_documents (staff_id);
do $$ begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('staff-docs', 'staff-docs', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
    on conflict (id) do update set public = false, file_size_limit = 5242880;
    execute 'drop policy if exists "owner staff documents" on storage.objects';
    execute 'create policy "owner staff documents" on storage.objects for all to authenticated
               using (bucket_id = ''staff-docs'' and (select public.owner_ok()))
               with check (bucket_id = ''staff-docs'' and (select public.owner_ok()))';
  end if;
end $$;

-- Leave requests: made at the counter, approved by the owner (Telegram or the app). Approved days become
-- L in attendance; cancelling or refusing it afterwards takes them out again.
create table if not exists leave_requests (
  id           uuid primary key default gen_random_uuid(),
  staff_id     uuid not null references staff(id) on delete cascade,
  from_day     date not null,
  to_day       date not null,
  kind         text not null default 'planned' check (kind in ('planned', 'sick', 'personal', 'other')),
  reason       text,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by   text,
  decided_at   timestamptz,
  requested_by text,
  notified_at  timestamptz,
  created_at   timestamptz not null default now(),
  check (to_day >= from_day and to_day <= from_day + 30)
);
create index if not exists leave_requests_days_idx on leave_requests (from_day, to_day);

create or replace function leave_to_attendance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    insert into attendance (staff_id, day, status, marked_by, note)
    select new.staff_id, d::date, 'L', 'leave approved', left(coalesce(new.reason, new.kind), 200)
      from generate_series(new.from_day, new.to_day, interval '1 day') d
    on conflict (staff_id, day) do update set status = 'L', marked_by = 'leave approved', note = excluded.note
      where attendance.status in ('A', 'L');   -- a week off or a day they came stays as it is
  elsif tg_op = 'UPDATE' and old.status = 'approved' and new.status <> 'approved' then
    delete from attendance where staff_id = old.staff_id and day between old.from_day and old.to_day and status = 'L';
  end if;
  return null;
end $$;
drop trigger if exists trg_leave_to_attendance on leave_requests;
create trigger trg_leave_to_attendance after insert or update of status on leave_requests for each row execute function leave_to_attendance();

-- The owner decides in the app (Telegram does the same through the Telegram function)
create or replace function decide_leave(p_id uuid, p_approve boolean) returns leave_requests
language plpgsql security definer set search_path = public as $$
declare v leave_requests;
begin
  if not owner_ok() then raise exception 'Only the owner can approve leave'; end if;
  -- who decided: the owner's login, or the owner who unlocked this counter (Telegram or the Authenticator code)
  update leave_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = coalesce(
           case when is_owner() then auth.jwt() ->> 'email' end,
           (select g.decided_by from owner_grants g where g.session_id = current_session_id() and g.user_id = auth.uid()
               and g.action = 'unlock' and g.status = 'approved' and g.expires_at > now() order by g.decided_at desc nulls last limit 1),
           'owner'),
         decided_at = now()
   where id = p_id and status = 'pending' returning * into v;
  if not found then raise exception 'This request was already answered'; end if;
  return v;
end $$;

-- A request made at the counter: one at a time per person for the same days, not in the past
-- The salon's leave rules (Settings → Staff rules; same as leaveRuleError() in src/lib/leave.js):
--  1. Busy days: Friday, Saturday or Sunday (leave_blocked_days). Not a refusal (since November 2026): the request
--     goes to the owner, who sees "busy day" on it (app and Telegram) and decides.
--  2. One person off a day (leave_one_at_a_time): not when someone else has leave asked, approved or marked.
--  3. Two or more days off in the last week of a month (from the 22nd) are asked at least 14 days before
--     (leave_notice_days): saving the month's days off for the end.
-- Medical leave ('sick') is not held to these (the owner still approves it). Returns the first rule broken, or null.
create or replace function leave_rule_error(p_staff uuid, p_from date, p_to date, p_kind text,
                                            p_today date default (now() at time zone 'Asia/Kolkata')::date)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  v_notice int := greatest(0, coalesce((select (value #>> '{}')::int from settings where key = 'leave_notice_days'), 14));
  v_one boolean := coalesce((select (value #>> '{}')::boolean from settings where key = 'leave_one_at_a_time'), true);
  v_other text;
  m date;
  v_last date;
  v_first date;
  v_n int;
begin
  if p_kind = 'sick' then return null; end if;
  -- 1. busy days: not a refusal any more; the owner sees them on the request and decides
  -- 2. one person off a day
  if v_one then
    select s.name || ' is off on ' || to_char(x.t, 'Dy DD Mon') into v_other
      from generate_series(p_from, p_to, interval '1 day') x(t)
      join staff s on s.active and s.id <> p_staff
     where exists (select 1 from leave_requests l where l.staff_id = s.id and l.status in ('pending', 'approved') and x.t::date between l.from_day and l.to_day)
        or exists (select 1 from attendance a where a.staff_id = s.id and a.day = x.t::date and a.status in ('W', 'L'))
     order by x.t, s.name collate "C"
     limit 1;
    if v_other is not null then return 'Only one person can be off a day: ' || v_other; end if;
  end if;
  -- 3. two or more days off in the last week of a month: asked in time
  for m in select distinct date_trunc('month', t)::date from generate_series(p_from, p_to, interval '1 day') t order by 1 loop
    v_last := (m + interval '1 month' - interval '1 day')::date;
    v_first := greatest(p_from, m + 21);
    continue when v_first > least(p_to, v_last);
    select count(*) into v_n from generate_series(m + 21, v_last, interval '1 day') x(t)
     where x.t::date between p_from and p_to
        or exists (select 1 from leave_requests l where l.staff_id = p_staff and l.status in ('pending', 'approved') and x.t::date between l.from_day and l.to_day)
        or exists (select 1 from attendance a where a.staff_id = p_staff and a.day = x.t::date and a.status in ('W', 'L'));
    if v_n >= 2 and v_first - p_today < v_notice then
      return format('2 or more days off in the last week of the month (from the 22nd) must be asked %s days before: by %s',
                    v_notice, to_char(v_first - v_notice, 'Dy DD Mon'));
    end if;
  end loop;
  return null;
end $$;

create or replace function request_leave(p jsonb) returns leave_requests
language plpgsql security definer set search_path = public as $$
declare
  v leave_requests;
  v_staff uuid := (select id from staff where id = case when p ->> 'staff_id' ~ '^[0-9a-f-]{36}$' then (p ->> 'staff_id')::uuid end and active);
  v_from date; v_to date;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_rule text;
begin
  if not (session_ok() or direct_session()) then raise exception 'This login is not approved yet'; end if;
  if v_staff is null then raise exception 'Choose who is asking'; end if;
  begin
    v_from := (p ->> 'from_day')::date;
    v_to := coalesce(nullif(p ->> 'to_day', '')::date, v_from);
  exception when others then raise exception 'Choose the days';
  end;
  if v_from is null then raise exception 'Choose the days'; end if;
  if v_to < v_from then raise exception 'The last day is before the first'; end if;
  if v_to > v_from + 30 then raise exception 'At most 31 days at a time'; end if;
  if v_from < v_today - 7 then raise exception 'That is more than a week ago. The owner can mark past days.'; end if;
  if v_from > v_today + 180 then raise exception 'Choose days in the next 6 months'; end if;
  if exists (select 1 from leave_requests where staff_id = v_staff and status in ('pending', 'approved') and from_day <= v_to and to_day >= v_from) then
    raise exception 'There is already a request for some of these days';
  end if;
  if coalesce(nullif(p ->> 'kind', ''), 'planned') not in ('planned', 'sick', 'personal', 'other') then raise exception 'Choose the kind of leave'; end if;
  v_rule := leave_rule_error(v_staff, v_from, v_to, coalesce(nullif(p ->> 'kind', ''), 'planned'), v_today);
  if v_rule is not null then raise exception '%', v_rule; end if;
  insert into leave_requests (staff_id, from_day, to_day, kind, reason, requested_by)
  values (v_staff, v_from, v_to, coalesce(nullif(p ->> 'kind', ''), 'planned'), left(nullif(trim(p ->> 'reason'), ''), 300), auth.jwt() ->> 'email')
  returning * into v;
  return v;
end $$;

-- The morning message (only the Telegram function; once a day, the first time the app is opened):
-- Leave coming up, for planning (November 2026): what the owner needs to know before someone goes on leave.
-- One staff member's approved leave: the days, the bookings given to them on those days (to give to someone else),
-- who else is off then, and how many are in on the busiest day. The Telegram function sends it.
create or replace function leave_plan(p_id uuid, p_today date default (now() at time zone 'Asia/Kolkata')::date) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', l.id, 'name', s.name, 'from', l.from_day, 'to', l.to_day, 'days', l.to_day - l.from_day + 1,
    'in_days', l.from_day - p_today, 'kind', l.kind, 'reason', l.reason,
    'bookings', (select coalesce(jsonb_agg(jsonb_build_object(
                    'day', coalesce((b.slot_at at time zone 'Asia/Kolkata')::date, b.want_date),
                    'time', coalesce(to_char(b.slot_at at time zone 'Asia/Kolkata', 'HH12:MI am'), b.want_time),
                    'name', b.name, 'phone', b.phone, 'status', b.status,
                    'services', (select string_agg(i.name || coalesce(' (' || i.option_label || ')', ''), ', ') from booking_items i where i.booking_id = b.id))
                  order by coalesce(b.slot_at, b.want_date::timestamptz)), '[]'::jsonb)
                 from bookings b
                 where b.staff_id = l.staff_id and b.status in ('requested', 'confirmed')
                   and coalesce((b.slot_at at time zone 'Asia/Kolkata')::date, b.want_date) between l.from_day and l.to_day),
    'also_off', (select coalesce(jsonb_agg(x.t order by x.t), '[]'::jsonb) from (
                   select distinct o.name || ' (' || case when greatest(o2.from_day, l.from_day) = least(o2.to_day, l.to_day)
                            then to_char(greatest(o2.from_day, l.from_day), 'Dy DD Mon')
                            else to_char(greatest(o2.from_day, l.from_day), 'Dy DD Mon') || ' to ' || to_char(least(o2.to_day, l.to_day), 'Dy DD Mon') end
                          || case when o2.status = 'pending' then ', asked' else '' end || ')' t
                     from leave_requests o2 join staff o on o.id = o2.staff_id
                    where o2.staff_id <> l.staff_id and o.active and o2.status in ('pending', 'approved')
                      and o2.from_day <= l.to_day and o2.to_day >= l.from_day
                   union
                   select distinct o.name || ' (' || to_char(a.day, 'Dy DD Mon') || case a.status when 'W' then ', week off' else '' end || ')'
                     from attendance a join staff o on o.id = a.staff_id
                    where a.staff_id <> l.staff_id and o.active and a.status in ('W', 'L') and a.day between l.from_day and l.to_day
                      and not exists (select 1 from leave_requests o3 where o3.staff_id = a.staff_id and o3.status = 'approved' and a.day between o3.from_day and o3.to_day)) x),
    'staff', (select count(*) from staff where active),
    'in_least', (select min((select count(*) from staff t where t.active and (t.join_date is null or t.join_date <= d.d)
                              and not exists (select 1 from leave_requests o where o.staff_id = t.id and o.status = 'approved' and d.d between o.from_day and o.to_day)
                              and not exists (select 1 from attendance a where a.staff_id = t.id and a.day = d.d and a.status in ('W', 'L'))))
                 from generate_series(l.from_day, l.to_day, interval '1 day') d0, lateral (select d0::date d) d))
  from leave_requests l join staff s on s.id = l.staff_id
  where l.id = p_id;
$$;

-- Due now? The first reminder day (Settings: 7, 3 and 1 days before) the leave has reached that wasn't sent yet. Each
-- is sent once (alerts_sent); a leave approved late gets the one it is due for, not every earlier one.
create or replace function leave_plan_due(p_id uuid, p_today date default (now() at time zone 'Asia/Kolkata')::date) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  l leave_requests;
  v_days int;
  v_alerts int[] := coalesce((select array(select jsonb_array_elements_text(value)::int) from settings
                              where key = 'leave_alert_days' and jsonb_typeof(value) = 'array'), array[7, 3, 1]);
  v_m int;
begin
  select * into l from leave_requests where id = p_id and status = 'approved';
  if not found then return null; end if;
  v_days := l.from_day - p_today;
  if v_days < 1 then return null; end if;
  select min(m) into v_m from unnest(v_alerts) m where m >= v_days;
  if v_m is null then return null; end if;
  insert into alerts_sent (kind, ref) values ('leave ahead ' || v_m, l.id) on conflict do nothing;
  if not found then return null; end if;
  insert into alerts_sent (kind, ref) select 'leave ahead ' || m, l.id from unnest(v_alerts) m where m > v_m on conflict do nothing;
  return leave_plan(l.id, p_today);
end $$;

-- who is on leave today and tomorrow, leave waiting for the owner, today's bookings, who didn't check in yesterday
create or replace function day_summary() returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  insert into alerts_sent (kind, ref) values ('day ' || v_today, '00000000-0000-0000-0000-000000000000') on conflict do nothing;
  if not found then return null; end if;
  perform expire_points();
  return jsonb_build_object(
    'day', v_today,
    'leave_today', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from leave_requests l join staff s on s.id = l.staff_id
                     where l.status = 'approved' and v_today between l.from_day and l.to_day),
    'leave_tomorrow', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from leave_requests l join staff s on s.id = l.staff_id
                     where l.status = 'approved' and v_today + 1 between l.from_day and l.to_day and v_today not between l.from_day and l.to_day),
    'pending_leave', (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'from', l.from_day, 'to', l.to_day) order by l.from_day), '[]'::jsonb)
                     from leave_requests l join staff s on s.id = l.staff_id where l.status = 'pending' and l.to_day >= v_today),
    -- leave coming up (for planning): each approved leave 7, 3 and 1 days before, once each
    'leave_ahead', (select coalesce(jsonb_agg(x.p order by x.p ->> 'from', x.p ->> 'name'), '[]'::jsonb)
                    from (select leave_plan_due(l.id, v_today) p from leave_requests l
                          where l.status = 'approved' and l.from_day > v_today and l.from_day <= v_today + 60) x where x.p is not null),
    -- Mondays: everyone's leave this week (approved and asked)
    'week_leave', case when extract(isodow from v_today) = 1 then
                    (select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'from', greatest(l.from_day, v_today), 'to', least(l.to_day, v_today + 6), 'status', l.status)
                                               order by greatest(l.from_day, v_today), s.name), '[]'::jsonb)
                       from leave_requests l join staff s on s.id = l.staff_id
                      where l.status in ('approved', 'pending') and l.from_day <= v_today + 6 and l.to_day >= v_today) end,
    -- backups to download (Mondays), about to be deleted, or not running (backup_status(), at the end of this file)
    'backup', backup_status(now()),
    'bookings_today', (select count(*) from bookings where want_date = v_today and status in ('requested', 'confirmed')),
    'requests', (select count(*) from bookings where status = 'requested' and want_date >= v_today),
    'not_checked_in', (select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) from staff s
                     where s.active and exists (select 1 from staff_faces f where f.staff_id = s.id)
                       and not exists (select 1 from check_ins c where c.staff_id = s.id and c.day = v_today - 1)
                       and not exists (select 1 from attendance a where a.staff_id = s.id and a.day = v_today - 1 and a.status in ('A', 'W', 'L', 'H', 'P'))));
end $$;

-- =====================================================================
-- Loyalty points
--   1 point = ₹1. Earned on what the customer pays (with money, not points) for services at their normal price:
--   5% (Settings), whole points, rounded down. Nothing on offer prices, on products (unless switched on in Settings),
--   on staff's own numbers, or on what a prepaid card pays (the card isn't in the app yet; only cash, UPI and card earn).
--   Used from 100 points, up to 20% of a bill, as a payment ("Points"), so the bill's prices, GST and commission
--   don't change. They expire 12 months after the customer's last visit.
--   Same rules as src/lib/loyalty.js (the demo database and the bill screen).
-- =====================================================================
create table if not exists loyalty_points (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references customers(id) on delete cascade,
  bill_id     uuid references bills(id),
  kind        text not null check (kind in ('earn', 'use', 'cancel', 'expire', 'adjust')),
  points      int not null,                 -- + earned / given back, − used / expired
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists loyalty_points_customer_idx on loyalty_points (customer_id, created_at);
create index if not exists loyalty_points_created_idx  on loyalty_points (created_at);

create or replace function loyalty_num(k text, d numeric) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::numeric from settings where key = k), d);
$$;
create or replace function loyalty_flag(k text, d boolean) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select nullif(value #>> '{}', '')::boolean from settings where key = k), d);
$$;

-- Points a bill earns (same maths as earnPoints() in src/lib/loyalty.js, in whole paise):
-- (services at their normal price, with GST) × (paid with money ÷ total) × 5%, rounded down
create or replace function bill_points(p jsonb, p_phone text) returns int
language plpgsql stable security definer set search_path = public as $$
declare
  v_pct   numeric := round(loyalty_num('loyalty_earn_pct', 5) * 100);
  v_prod  boolean := loyalty_flag('loyalty_products', false);
  v_total numeric := round(coalesce((p->>'total')::numeric, 0) * 100);
  v_money numeric := round((coalesce((p->>'paid_cash')::numeric, 0) + coalesce((p->>'paid_upi')::numeric, 0) + coalesce((p->>'paid_card')::numeric, 0)) * 100);
  v_base  numeric := 0;
  it      jsonb;
begin
  if not loyalty_flag('loyalty_on', true) or p_phone is null or v_total <= 0 or v_pct <= 0 then return 0; end if;
  -- staff can't earn on their own number
  if exists (select 1 from staff where active and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = p_phone) then return 0; end if;
  for it in select * from jsonb_array_elements(p->'items') loop
    if coalesce((it->>'offer_discount')::numeric, 0) = 0 and (it->>'item_type' = 'service' or (v_prod and it->>'item_type' = 'product')) then
      v_base := v_base + round(((it->>'taxable')::numeric + coalesce((it->>'gst')::numeric, 0)) * 100);
    end if;
  end loop;
  return greatest(0, floor(v_base * v_money * v_pct / (v_total * 1000000)))::int;
end $$;

-- The balance is the sum of the customer's points rows, kept on customers.points
create or replace function loyalty_balance() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update customers set points = (select coalesce(sum(points), 0) from loyalty_points where customer_id = new.customer_id)
   where id = new.customer_id;
  return new;
end $$;
drop trigger if exists trg_loyalty_balance on loyalty_points;
create trigger trg_loyalty_balance after insert on loyalty_points for each row execute function loyalty_balance();

-- Nobody types a balance: it changes only through bills (and expiry)
create or replace function guard_customer_points() returns trigger
language plpgsql as $$
begin
  if pg_trigger_depth() < 2 and not direct_session() then
    if tg_op = 'INSERT' then new.points := 0;
    elsif new.points is distinct from old.points then raise exception 'Points change only through bills';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_customer_points on customers;
create trigger trg_guard_customer_points before insert or update of points on customers for each row execute function guard_customer_points();

-- Points of customers who haven't come for 12 months (Settings) expire. Run by create_bill for its customer, and
-- once a day for everyone (day_summary). Returns how many customers lost points.
create or replace function expire_points(p_customer uuid default null, p_at timestamptz default now()) returns int
language plpgsql security definer set search_path = public as $$
declare
  v_m int := greatest(1, loyalty_num('loyalty_expiry_months', 12)::int);
  r   record;
  n   int := 0;
begin
  for r in select c.id, c.points, c.last_visit from customers c
            where c.points > 0 and c.last_visit is not null and c.last_visit + make_interval(months => v_m) <= p_at
              and (p_customer is null or c.id = p_customer) loop
    insert into loyalty_points (customer_id, kind, points, note, created_at)
    values (r.id, 'expire', -r.points, 'No visit for ' || v_m || ' months', r.last_visit + make_interval(months => v_m));
    n := n + 1;
  end loop;
  return n;
end $$;

-- =====================================================================
-- The website reads everything it shows from here, in one call, with no login:
--   POST {SUPABASE_URL}/rest/v1/rpc/web_site   (headers: apikey = the anon / publishable key)
-- Only public things: menu (visible categories and services), live offers, salon details.
-- Nothing about customers, bills, staff, costs or stock. See docs/WEBSITE.md.
-- "menu" uses the same shape as the website's CATALOGUE in src/data/services.js.
-- =====================================================================
create or replace function web_site() returns jsonb
language sql stable security definer set search_path = public as $$
  with today as (select (now() at time zone 'Asia/Kolkata')::date as d),
  svc as (
    select s.*,
           case when s.variants is not null then (select jsonb_agg((e ->> 'price')::numeric order by o) from jsonb_array_elements(s.variants) with ordinality x(e, o))
                when s.price > 0 then jsonb_build_array(s.price) else '[]'::jsonb end as prices,
           case when s.variants is not null and exists (select 1 from jsonb_array_elements(s.variants) e where coalesce(e ->> 'label', '') <> '')
                then (select jsonb_agg(e ->> 'label' order by o) from jsonb_array_elements(s.variants) with ordinality x(e, o)) end as labels,
           s.variants is not null and not exists (select 1 from jsonb_array_elements(s.variants) e where e ->> 'label' not in ('S', 'M', 'L', 'XL')) as sized
    from services s
    where s.active and s.show_on_website
  )
  select jsonb_build_object(
    'version', to_char(greatest((select max(updated_at) from services), (select max(updated_at) from service_categories),
                                (select max(updated_at) from offers), (select max(updated_at) from settings)) at time zone 'UTC', 'YYYYMMDD"T"HH24MISS'),
    'salon', (select jsonb_object_agg(key, value) from settings
              where key in ('salon_name', 'branch', 'address', 'phone', 'whatsapp', 'instagram', 'opening_hours', 'maps_url', 'prices_include_gst')),
    'menu', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.slug, 'uid', c.id, 'cat', coalesce(c.web_page, section_web_page(c.section)), 'tab', c.web_tab, 'type', c.web_type,
               'title', c.name, 'desc', c.description, 'note', c.note, 'image', c.image, 'consult', c.consult_only,
               'items', (select jsonb_agg(jsonb_build_object(
                           'uid', s.id, 'slug', s.slug, 'n', coalesce(s.web_name, s.name), 'bill_name', s.name,
                           'sub', s.subtitle, 'inc', coalesce(to_jsonb(s.includes), '[]'::jsonb), 'p', s.prices, 'lbl', s.labels,
                           'from', s.open_price, 'sized', s.sized, 'dur', s.duration_min, 'for', s.for_gender,
                           'desc', s.description, 'book', s.book_online, 'featured', s.featured,
                           'extra', s.extra_options) order by s.sort, s.name)
                         from svc s where s.category_id = c.id))
             order by c.sort, c.name)
      from service_categories c
      where c.show_on_website and exists (select 1 from svc s where s.category_id = c.id)), '[]'::jsonb),
    'offers', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'title', coalesce(o.web_title, o.name), 'text', o.web_text, 'tag', o.web_tag, 'image', o.image,
               'live', o.starts_on is null or o.starts_on <= t.d, 'starts_on', o.starts_on, 'ends_on', o.ends_on,
               'days', o.days, 'start_time', o.start_time, 'end_time', o.end_time,
               'kind', o.kind, 'value', o.value, 'min_bill', o.min_bill, 'max_discount', o.max_discount,
               'new_customers_only', o.new_customers_only, 'applies_to', o.applies_to, 'sections', o.sections,
               'categories', (select jsonb_agg(c.slug) from service_categories c where c.name = any (o.categories)),
               'services', (select jsonb_agg(s.slug) from services s where s.id = any (o.service_ids) and s.active and s.show_on_website))
             order by o.web_sort, o.starts_on nulls first, o.name)
      from offers o, today t
      where o.active and o.show_on_website and (o.ends_on is null or o.ends_on >= t.d)), '[]'::jsonb)
  );
$$;

-- =====================================================================
-- Security: only signed-in, approved logins can read or write.
-- =====================================================================
do $$
declare t text;
begin
  -- Everyday counter work
  foreach t in array array['customers'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('create policy "app users" on %I for all to authenticated using ((select session_ok())) with check ((select session_ok()))', t);
  end loop;
  -- Owner things: any approved login can read them; changing them needs the owner (see "Owner approval").
  -- Attendance too: the counter checks staff in with their face (face_check_in), the owner marks the rest.
  foreach t in array array['settings','offers','staff','staff_advances','payslips','products','service_usage','attendance','staff_faces'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('drop policy if exists "app users read" on %I', t);
    execute format('drop policy if exists "owner writes" on %I', t);
    execute format('create policy "app users read" on %I for select to authenticated using ((select session_ok()))', t);
    execute format('create policy "owner writes" on %I for all to authenticated using ((select owner_ok())) with check ((select owner_ok()))', t);
  end loop;
  -- The menu (also shown on the website): every approved login reads it. An owner login may change it directly;
  -- the counter only through save_service / save_service_category, which need the owner's OK for that exact change.
  foreach t in array array['services','service_categories'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('drop policy if exists "app users read" on %I', t);
    execute format('drop policy if exists "owner writes" on %I', t);
    execute format('drop policy if exists "owner login writes" on %I', t);
    execute format('create policy "app users read" on %I for select to authenticated using ((select session_ok()))', t);
    execute format('create policy "owner login writes" on %I for all to authenticated using ((select is_owner())) with check ((select is_owner()))', t);
  end loop;
  -- Change history of the menu: owner screens only. Written only by the trigger.
  alter table service_changes enable row level security;
  drop policy if exists "owner reads" on service_changes;
  create policy "owner reads" on service_changes for select to authenticated using ((select owner_ok()));
  -- Bookings: everyday counter work. The website adds them only through request_booking().
  foreach t in array array['bookings','booking_items','enquiries'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "app users" on %I', t);
    execute format('create policy "app users" on %I for all to authenticated using ((select session_ok())) with check ((select session_ok()))', t);
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
    with check ((select session_ok()) and ((type = 'in' and qty > 0) or (type = 'adjust' and (select owner_ok()))));
  -- Bottle check: unit ends are written only by issue_stock / mark_finished, uses without a bill only by
  -- record_free_use. Any approved login reads the unit ends (the Stock list shows the open ones); only the
  -- owner reads the uses without a bill. alerts_sent: no policies (only the Telegram function's functions).
  alter table unit_ends enable row level security;
  drop policy if exists "app users read" on unit_ends;
  create policy "app users read" on unit_ends for select to authenticated using ((select session_ok()));
  alter table free_uses enable row level security;
  drop policy if exists "owner reads" on free_uses;
  create policy "owner reads" on free_uses for select to authenticated using ((select owner_ok()));
  alter table alerts_sent enable row level security;
  -- Check-ins: the counter sees today's (with the photos); written only by face_check_in; the owner can remove one
  alter table check_ins enable row level security;
  drop policy if exists "app users read" on check_ins;
  drop policy if exists "owner removes" on check_ins;
  create policy "app users read" on check_ins for select to authenticated using ((select session_ok()));
  create policy "owner removes" on check_ins for delete to authenticated using ((select owner_ok()));
  -- Staff documents: the owner only (the files themselves are in the private "staff-docs" storage, owner only)
  alter table staff_documents enable row level security;
  drop policy if exists "owner only" on staff_documents;
  create policy "owner only" on staff_documents for all to authenticated using ((select owner_ok())) with check ((select owner_ok()));
  -- Leave: everyone at the counter sees it (who is off when); requests through request_leave; the owner decides
  alter table leave_requests enable row level security;
  drop policy if exists "app users read" on leave_requests;
  drop policy if exists "owner writes" on leave_requests;
  drop policy if exists "counter cancels pending" on leave_requests;
  create policy "app users read" on leave_requests for select to authenticated using ((select session_ok()));
  -- WhatsApp bills: the app reads how each send went; only the whatsapp Edge Function (service key) writes
  alter table bill_payments enable row level security;
  drop policy if exists "app users read" on bill_payments;
  create policy "app users read" on bill_payments for select to authenticated using ((select session_ok()));
  alter table wa_messages enable row level security;
  drop policy if exists "app users read" on wa_messages;
  create policy "app users read" on wa_messages for select to authenticated using ((select session_ok()));
  create policy "owner writes" on leave_requests for all to authenticated using ((select owner_ok())) with check ((select owner_ok()));
  create policy "counter cancels pending" on leave_requests for update to authenticated
    using ((select session_ok()) and status = 'pending') with check ((select session_ok()) and status = 'cancelled');
  -- Checks of how full the one in use was: the owner's weekly count only
  -- Loyalty points: every approved login reads them (the bill shows the balance); only bills write them
  alter table loyalty_points enable row level security;
  drop policy if exists "app users read" on loyalty_points;
  create policy "app users read" on loyalty_points for select to authenticated using ((select session_ok()));
  alter table unit_checks enable row level security;
  drop policy if exists "owner only" on unit_checks;
  create policy "owner only" on unit_checks for all to authenticated using ((select owner_ok())) with check ((select owner_ok()));
  -- Safety net: every table has row level security, so the public (anon) key used by the website
  -- can't read or write any table. The website gets only what web_site() returns.
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table %I enable row level security', t);
  end loop;
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
revoke execute on function owner_here()                   from public, anon;
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
grant  execute on function owner_here()                   to authenticated;
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
revoke execute on function use_weight(text)               from public, anon;
grant  execute on function use_weight(text)               to authenticated;
revoke execute on function unit_report(timestamptz)       from public, anon;
grant  execute on function unit_report(timestamptz)       to authenticated;
revoke execute on function record_free_use(jsonb)         from public, anon;
grant  execute on function record_free_use(jsonb)         to authenticated;
revoke execute on function end_unit(jsonb)                from public, anon;
grant  execute on function end_unit(jsonb)                to authenticated;
-- Inside the database only (they skip the login checks), or for the Telegram function (service key)
revoke execute on function product_units(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function unit_normal(uuid)              from public, anon, authenticated;
revoke execute on function unit_alert(uuid)               from public, anon, authenticated;
revoke execute on function unit_end_alert(uuid)           from public, anon, authenticated;
revoke execute on function unit_ended_info(uuid)          from public, anon, authenticated;
revoke execute on function unit_early(numeric, numeric)    from public, anon;
grant  execute on function unit_early(numeric, numeric)    to authenticated;
revoke execute on function bill_stock_alert(uuid)         from public, anon, authenticated;
revoke execute on function free_use_alert(uuid)           from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function unit_alert(uuid), unit_end_alert(uuid), bill_stock_alert(uuid), free_use_alert(uuid), day_summary() to service_role;
    grant execute on function leave_plan(uuid, date), leave_plan_due(uuid, date) to service_role;
  end if;
end $$;
revoke execute on function bill_menu_check(jsonb, timestamptz, boolean) from public, anon, authenticated;
revoke execute on function staff_price_check(jsonb) from public, anon, authenticated;
revoke execute on function offer_live_at(offers, timestamptz, boolean) from public, anon;
grant  execute on function offer_live_at(offers, timestamptz, boolean) to authenticated;
revoke execute on function offer_line_saving(offers, numeric, numeric) from public, anon;
grant  execute on function offer_line_saving(offers, numeric, numeric) to authenticated;
revoke execute on function fy_code(timestamptz)           from public, anon;
grant  execute on function fy_code(timestamptz)           to authenticated;
revoke execute on function current_session_id()           from public, anon;
grant  execute on function current_session_id()           to authenticated;
revoke execute on function unique_slug(regclass, text, uuid) from public, anon;
grant  execute on function unique_slug(regclass, text, uuid) to authenticated;
revoke execute on function mark_finished(jsonb)           from public, anon;
grant  execute on function mark_finished(jsonb)           to authenticated;
revoke execute on function save_service(jsonb)            from public, anon;
grant  execute on function save_service(jsonb)            to authenticated;
revoke execute on function save_service_category(jsonb)   from public, anon;
grant  execute on function save_service_category(jsonb)   to authenticated;
revoke execute on function menu_change_grant(uuid, uuid)  from public, anon, authenticated;
revoke execute on function log_menu_change()              from public, anon, authenticated;
revoke execute on function service_fill()                 from public, anon, authenticated;
revoke execute on function service_category_moved()       from public, anon, authenticated;
-- The website (no login): read the public menu, send a booking request
grant  execute on function web_site()                     to anon, authenticated;
grant  execute on function request_booking(jsonb)         to anon, authenticated;
grant  execute on function request_enquiry(jsonb)         to anon, authenticated;
revoke execute on function save_booking(jsonb)            from public, anon;
revoke execute on function face_check_in(jsonb)           from public, anon;
grant  execute on function face_check_in(jsonb)           to authenticated;
revoke execute on function request_leave(jsonb)           from public, anon;
revoke execute on function leave_rule_error(uuid, date, date, text, date) from public, anon;
grant  execute on function request_leave(jsonb)           to authenticated;
revoke execute on function decide_leave(uuid, boolean)    from public, anon;
grant  execute on function decide_leave(uuid, boolean)    to authenticated;
revoke execute on function leave_to_attendance()          from public, anon, authenticated;
revoke execute on function day_summary()                  from public, anon, authenticated;
revoke execute on function leave_plan(uuid, date)          from public, anon, authenticated;
revoke execute on function leave_plan_due(uuid, date)      from public, anon, authenticated;
grant  execute on function save_booking(jsonb)            to authenticated;
revoke execute on function link_visit()                   from public, anon, authenticated;
revoke execute on function old_confirmed(bookings)        from public, anon;
grant  execute on function check_bill(jsonb)              to authenticated;
grant  execute on function create_bill(jsonb)            to authenticated;
grant  execute on function cancel_bill(uuid, text)        to authenticated;
grant  execute on function refresh_customer_stats(uuid)   to authenticated;
revoke execute on function loyalty_num(text, numeric)     from public, anon;
revoke execute on function loyalty_flag(text, boolean)    from public, anon;
revoke execute on function bill_points(jsonb, text)       from public, anon;
grant  execute on function bill_points(jsonb, text)       to authenticated;
revoke execute on function expire_points(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function loyalty_balance()              from public, anon, authenticated;
revoke execute on function guard_customer_points()        from public, anon, authenticated;

-- =====================================================================================================
-- Expenses and the daily cash close (November 2026)
-- =====================================================================================================
-- Money that left the salon for anything but stock and salaries: tea, cleaning, laundry, repairs, rent …
-- Added at the counter through add_expense(); only the owner removes one (it stays, marked cancelled).
create table if not exists expenses (
  id            uuid primary key default gen_random_uuid(),
  day           date not null,
  amount        numeric(12,2) not null check (amount > 0),
  category      text not null,
  note          text,
  paid_from     text not null default 'cash' check (paid_from in ('cash', 'upi', 'bank', 'owner')), -- cash = from the drawer
  created_by    text,
  created_at    timestamptz not null default now(),
  cancelled_at  timestamptz,
  cancelled_by  text,
  cancel_reason text
);
create index if not exists expenses_day_idx on expenses (day);
create index if not exists expenses_created_idx on expenses (created_at);

-- The cash count at the end of the day. A close covers everything since the close before it (by time, not by
-- calendar day), so a bill made after closing is in the next day's count. The figures are worked out by the
-- database when the day is closed and kept, so a later change never rewrites an old close.
create table if not exists cash_closes (
  id              uuid primary key default gen_random_uuid(),
  day             date not null unique,
  from_at         timestamptz,                    -- the close before this one (empty for the first)
  closed_at       timestamptz not null default now(),
  opening_cash    numeric(12,2) not null default 0, -- left in the drawer at the close before
  cash_sales      numeric(12,2) not null default 0, -- cash on paid bills since then
  cash_refunds    numeric(12,2) not null default 0, -- cash bills from before, cancelled since then
  cash_expenses   numeric(12,2) not null default 0, -- expenses paid from the drawer since then
  expected        numeric(12,2) not null,           -- opening + sales − refunds − expenses
  counted         numeric(12,2) not null,           -- what is in the drawer
  difference      numeric(12,2) not null,           -- counted − expected (minus = short)
  taken_out       numeric(12,2) not null default 0, -- taken home or to the bank at closing
  closing_cash    numeric(12,2) not null,           -- counted − taken out: tomorrow's opening
  notes           jsonb,                            -- the count: {"500": 4, "200": 1, …}
  note            text,
  bills           int not null default 0,
  total_sales     numeric(12,2) not null default 0,
  upi_sales       numeric(12,2) not null default 0,
  card_sales      numeric(12,2) not null default 0,
  expenses_total  numeric(12,2) not null default 0, -- all expenses since then, however paid
  closed_by       text,
  notified_at     timestamptz                       -- Telegram message to the owners sent
);

create or replace function add_expense(p jsonb) returns expenses
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_day   date;
  v_amt   numeric;
  v_cat   text := left(trim(coalesce(p->>'category', '')), 40);
  v_from  text := coalesce(nullif(p->>'paid_from', ''), 'cash');
  v_uuid  text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  r       expenses;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  if coalesce(p->>'id', '') ~ v_uuid then
    select * into r from expenses where id = (p->>'id')::uuid;
    if found then return r; end if;                 -- sent twice: saved once
  end if;
  if coalesce(p->>'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the amount'; end if;
  v_amt := (p->>'amount')::numeric;
  if v_amt <= 0 or v_amt > 500000 then raise exception 'Type the amount (up to ₹5,00,000)'; end if;
  if v_cat = '' then raise exception 'Choose what it was for'; end if;
  if v_from not in ('cash', 'upi', 'bank', 'owner') then raise exception 'Choose how it was paid'; end if;
  if coalesce(p->>'day', '') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then v_day := (p->>'day')::date; else v_day := v_today; end if;
  if v_day > v_today then raise exception 'The day can''t be after today'; end if;
  if v_day < v_today and not owner_ok() then raise exception 'Only the owner can add an expense for an earlier day'; end if;
  if v_day < v_today - 60 then raise exception 'At most 60 days back'; end if;
  insert into expenses (id, day, amount, category, note, paid_from, created_by)
  values (case when coalesce(p->>'id', '') ~ v_uuid then (p->>'id')::uuid else gen_random_uuid() end,
          v_day, v_amt, v_cat, nullif(left(trim(coalesce(p->>'note', '')), 200), ''), v_from, auth.jwt() ->> 'email')
  returning * into r;
  return r;
end $$;

create or replace function cancel_expense(p_id uuid, p_reason text default null) returns expenses
language plpgsql security definer set search_path = public as $$
declare r expenses;
begin
  if not owner_ok() then raise exception 'Only the owner can remove an expense'; end if;
  update expenses set cancelled_at = now(), cancelled_by = auth.jwt() ->> 'email', cancel_reason = nullif(left(trim(coalesce(p_reason, '')), 200), '')
   where id = p_id and cancelled_at is null returning * into r;
  if not found then select * into r from expenses where id = p_id; end if;
  if r.id is null then raise exception 'Expense not found'; end if;
  return r;
end $$;

-- What should be in the drawer right now: everything since the last close (or since this morning, before the first)
create or replace function cash_now() returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_last  cash_closes;
  v_start timestamptz;
  v_open  numeric; v_sales numeric; v_ref numeric := 0; v_exp numeric; v_back numeric := 0;
  v_tot   numeric; v_upi numeric; v_card numeric; v_n int; v_all numeric;
  v_dc    numeric; v_du numeric; v_dk numeric; v_dall numeric;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  select * into v_last from cash_closes order by closed_at desc limit 1;
  v_start := coalesce(v_last.closed_at, ((now() at time zone 'Asia/Kolkata')::date)::timestamp at time zone 'Asia/Kolkata');
  v_open := coalesce(v_last.closing_cash, 0);
  -- cash in the drawer: what the bills were paid in cash, plus change given back by UPI (the note stayed in the drawer)
  select coalesce(sum(paid_cash + change_upi), 0), coalesce(sum(total), 0), coalesce(sum(paid_upi - change_upi), 0), coalesce(sum(paid_card), 0), count(*)::int
    into v_sales, v_tot, v_upi, v_card, v_n
    from bills where created_at > v_start and created_at <= now() and status = 'paid';
  -- dues collected since then (they come in on the day they are paid)
  select coalesce(sum(d.amount) filter (where d.mode = 'cash'), 0), coalesce(sum(d.amount) filter (where d.mode = 'upi'), 0),
         coalesce(sum(d.amount) filter (where d.mode = 'card'), 0), coalesce(sum(d.amount), 0)
    into v_dc, v_du, v_dk, v_dall
    from due_payments d join bills b on b.id = d.bill_id
   where d.created_at > v_start and d.created_at <= now() and b.status = 'paid';
  v_sales := v_sales + v_dc; v_upi := v_upi + v_du; v_card := v_card + v_dk;
  select coalesce(sum(amount) filter (where paid_from = 'cash'), 0), coalesce(sum(amount), 0) into v_exp, v_all
    from expenses where created_at > v_start and cancelled_at is null;
  if v_last.id is not null then
    select coalesce(sum(paid_cash), 0) into v_ref from bills where created_at <= v_start and status = 'cancelled' and cancelled_at > v_start;
    -- …and the due collected in cash on those bills before the close (given back too)
    v_ref := v_ref + coalesce((select sum(d.amount) from due_payments d join bills b on b.id = d.bill_id
                                where d.mode = 'cash' and d.created_at <= v_start and b.status = 'cancelled' and b.cancelled_at > v_start), 0);
    select coalesce(sum(amount), 0) into v_back from expenses where paid_from = 'cash' and created_at <= v_start and cancelled_at > v_start;
  end if;
  return jsonb_build_object(
    'first', v_last.id is null, 'from_at', v_last.closed_at, 'last_day', v_last.day,
    'opening_cash', v_open, 'cash_sales', v_sales, 'cash_refunds', v_ref, 'cash_expenses', v_exp - v_back,
    'expected', v_open + v_sales - v_ref - v_exp + v_back,
    'bills', v_n, 'total_sales', v_tot, 'upi_sales', v_upi, 'card_sales', v_card, 'expenses_total', v_all,
    'due_collected', v_dall);
end $$;

create or replace function close_day(p jsonb) returns cash_closes
language plpgsql security definer set search_path = public as $$
declare
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_old   cash_closes;
  f       jsonb;
  v_cnt   numeric; v_out numeric; v_open numeric; v_exp numeric; v_diff numeric;
  v_tol   numeric := greatest(0, coalesce((select nullif(value #>> '{}', '')::numeric from settings where key = 'cash_tolerance'), 10));
  v_note  text := nullif(left(trim(coalesce(p->>'note', '')), 300), '');
  r       cash_closes;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  if coalesce(p->>'counted', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the cash counted'; end if;
  v_cnt := (p->>'counted')::numeric;
  if v_cnt > 10000000 then raise exception 'Type the cash counted'; end if;
  if coalesce(p->>'taken_out', '0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the cash taken out'; end if;
  v_out := coalesce((p->>'taken_out')::numeric, 0);
  if v_out > v_cnt then raise exception 'Cash taken out can''t be more than the cash counted'; end if;
  select * into v_old from cash_closes where day = v_today;
  if found then
    if not owner_ok() then raise exception 'Today is already closed. Only the owner can close it again.'; end if;
    delete from cash_closes where id = v_old.id;   -- counted again: worked out afresh from the close before
  end if;
  f := cash_now();
  v_open := (f->>'opening_cash')::numeric;
  if (f->>'first')::boolean then
    if coalesce(p->>'opening_cash', '0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the cash the day started with'; end if;
    v_open := coalesce((p->>'opening_cash')::numeric, 0);
  end if;
  v_exp := v_open + (f->>'cash_sales')::numeric - (f->>'cash_refunds')::numeric - (f->>'cash_expenses')::numeric;
  v_diff := v_cnt - v_exp;
  if abs(v_diff) > v_tol and v_note is null then
    raise exception 'The cash is ₹% %. Write why in the note.', trim_scale(abs(v_diff)), case when v_diff < 0 then 'short' else 'over' end;
  end if;
  insert into cash_closes (day, from_at, opening_cash, cash_sales, cash_refunds, cash_expenses, expected, counted, difference, taken_out,
                           closing_cash, notes, note, bills, total_sales, upi_sales, card_sales, expenses_total, closed_by, due_collected)
  values (v_today, nullif(f->>'from_at', '')::timestamptz, v_open, (f->>'cash_sales')::numeric, (f->>'cash_refunds')::numeric, (f->>'cash_expenses')::numeric,
          v_exp, v_cnt, v_diff, v_out, v_cnt - v_out, case when jsonb_typeof(p->'notes') = 'object' then p->'notes' end, v_note,
          (f->>'bills')::int, (f->>'total_sales')::numeric, (f->>'upi_sales')::numeric, (f->>'card_sales')::numeric, (f->>'expenses_total')::numeric,
          auth.jwt() ->> 'email', coalesce((f->>'due_collected')::numeric, 0))
  returning * into r;
  return r;
end $$;

-- =====================================================================================================
-- Automatic WhatsApp messages: feedback after a visit (with the Google review link), booking reminders,
-- "we miss you" to customers not seen for a while (November 2026). Sent by the whatsapp Edge Function.
-- =====================================================================================================
alter table wa_messages add column if not exists booking_id  uuid references bookings(id) on delete set null;
alter table wa_messages add column if not exists customer_id uuid references customers(id) on delete set null;
alter table wa_messages add column if not exists dedupe      text;   -- one automatic message per bill / booking / lapse
create unique index if not exists wa_messages_dedupe_idx on wa_messages (dedupe);
create index if not exists wa_messages_phone_idx on wa_messages (phone, created_at);
-- A salary slip sent to the staff member when the salary is marked paid (kind 'slip')
alter table wa_messages add column if not exists payslip_id  uuid references payslips(id) on delete set null;
create index if not exists wa_messages_payslip_idx on wa_messages (payslip_id) where payslip_id is not null;
alter table customers add column if not exists wa_stop boolean not null default false; -- replied STOP: no automatic messages

-- What the customer answered to "How was your visit?" (one per bill). Written by the whatsapp Edge Function.
create table if not exists feedback (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid unique references bills(id) on delete cascade,
  customer_id  uuid references customers(id) on delete set null,
  phone        text not null,
  name         text,
  rating       text not null check (rating in ('good', 'ok', 'bad')),
  comment      text,                          -- what they wrote after answering
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,                   -- the owner called / sorted it out
  handled_by   text,
  handled_note text
);
create index if not exists feedback_created_idx on feedback (created_at);

create or replace function handle_feedback(p_id uuid, p_note text default null) returns feedback
language plpgsql security definer set search_path = public as $$
declare r feedback;
begin
  if not owner_ok() then raise exception 'Only the owner can mark feedback as dealt with'; end if;
  update feedback set handled_at = now(), handled_by = coalesce((select name from app_roles where user_id = auth.uid()), auth.jwt() ->> 'email'),
         handled_note = nullif(left(trim(coalesce(p_note, '')), 300), '')
   where id = p_id returning * into r;
  if not found then raise exception 'Feedback not found'; end if;
  return r;
end $$;

-- The automatic messages due now. Same rules as dueMessages() in src/lib/waAuto.js. Only the whatsapp function calls it.
--   feedback: a paid bill 2 to 48 hours old (Settings), not a staff or past bill; one request a customer in 30 days
--   reminder: a confirmed booking starting within 3 hours (Settings), booked at least an hour ago, not reminded yet
--   winback:  agreed to WhatsApp offers, last visit 45 to 365 days ago (Settings), no booking coming up, not staff;
--             once per lapse and at most once in 60 days; at most 20 a day (Settings)
-- Nothing between 9 pm and 9 am, and nothing to a customer who replied STOP.
create or replace function wa_due(p_now timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_local  timestamp := p_now at time zone 'Asia/Kolkata';
  v_today  date := (p_now at time zone 'Asia/Kolkata')::date;
  v_fb     boolean := loyalty_flag('wa_feedback_on', false);
  v_after  numeric := least(47, greatest(0, loyalty_num('wa_feedback_after_hours', 2)));
  v_rem    boolean := loyalty_flag('wa_reminders_on', false);
  v_hours  numeric := least(48, greatest(1, loyalty_num('wa_remind_hours', 3)));
  v_win    boolean := loyalty_flag('wa_winback_on', false);
  v_days   int := least(300, greatest(14, loyalty_num('wa_winback_days', 45)))::int;
  v_cap    int := least(200, greatest(0, loyalty_num('wa_winback_per_day', 20)))::int;
  v_left   int;
  a jsonb := '[]'::jsonb; b jsonb := '[]'::jsonb; c jsonb := '[]'::jsonb;
begin
  if extract(hour from v_local) < 9 or extract(hour from v_local) >= 21 then return '[]'::jsonb; end if;
  if v_fb then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'feedback', 'dedupe', 'feedback:' || x.id, 'phone', x.customer_phone, 'name', x.customer_name,
             'bill_id', x.id, 'customer_id', x.customer_id, 'bill_no', x.bill_no) order by x.customer_phone), '[]'::jsonb) into a
      from (select distinct on (b1.customer_phone) b1.*
              from bills b1 left join customers cu on cu.phone = b1.customer_phone
             where b1.status = 'paid' and b1.customer_phone ~ '^[6-9][0-9]{9}$' and b1.for_staff is null and b1.bill_no !~ '-P[0-9]+$'
               and b1.created_at <= p_now - make_interval(secs => v_after * 3600) and b1.created_at > p_now - interval '48 hours'
               and not coalesce(cu.wa_stop, false)
               and not exists (select 1 from wa_messages m where m.kind = 'feedback' and m.phone = b1.customer_phone and m.created_at > p_now - interval '30 days')
             order by b1.customer_phone, b1.created_at desc, b1.id) x;
  end if;
  if v_rem then
    select coalesce(jsonb_agg(jsonb_build_object('kind', 'reminder', 'dedupe', 'reminder:' || k.id || ':' || extract(epoch from k.slot_at)::bigint, 'phone', k.phone, 'name', k.name,
             'booking_id', k.id, 'customer_id', k.customer_id, 'slot_at', k.slot_at,
             'services', (select string_agg(i.name, ', ' order by i.name collate "C") from booking_items i where i.booking_id = k.id)) order by k.slot_at, k.id), '[]'::jsonb) into b
      from bookings k left join customers cu on cu.phone = k.phone
     where k.status = 'confirmed' and k.slot_at > p_now and k.slot_at <= p_now + make_interval(secs => v_hours * 3600)
       and k.reminded_at is null and k.created_at <= p_now - interval '1 hour' and k.phone ~ '^[6-9][0-9]{9}$'
       and not coalesce(cu.wa_stop, false)
       and not exists (select 1 from wa_messages m where m.dedupe = 'reminder:' || k.id || ':' || extract(epoch from k.slot_at)::bigint);
  end if;
  if v_win then
    v_left := v_cap - (select count(*) from wa_messages m where m.kind = 'winback' and (m.created_at at time zone 'Asia/Kolkata')::date = v_today)::int;
    if v_left > 0 then
      select coalesce(jsonb_agg(jsonb_build_object('kind', 'winback', 'dedupe', x.dd, 'phone', x.phone, 'name', x.name, 'customer_id', x.id,
               'last_visit', x.last_visit, 'points', x.points) order by x.last_visit desc, x.id), '[]'::jsonb) into c
        from (select cu.*, 'winback:' || cu.id || ':' || (cu.last_visit at time zone 'Asia/Kolkata')::date as dd
                from customers cu
               where cu.whatsapp_ok and not cu.wa_stop and cu.phone ~ '^[6-9][0-9]{9}$' and cu.visits >= 1
                 and cu.last_visit <= p_now - make_interval(days => v_days) and cu.last_visit > p_now - interval '365 days'
                 and not exists (select 1 from bookings k where k.phone = cu.phone and k.status in ('requested', 'confirmed') and coalesce(k.want_date, (k.slot_at at time zone 'Asia/Kolkata')::date) >= v_today)
                 and not exists (select 1 from staff s where s.active and right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 10) = cu.phone)
                 and not exists (select 1 from wa_messages m where m.kind = 'winback' and m.customer_id = cu.id and m.created_at > p_now - interval '60 days')
                 and not exists (select 1 from wa_messages m where m.dedupe = 'winback:' || cu.id || ':' || (cu.last_visit at time zone 'Asia/Kolkata')::date)
               order by cu.last_visit desc, cu.id limit v_left) x;
    end if;
  end if;
  return a || b || c;
end $$;

do $$ begin
  alter table expenses enable row level security;
  drop policy if exists "app users read" on expenses;
  create policy "app users read" on expenses for select to authenticated using ((select session_ok()));
  alter table cash_closes enable row level security;
  drop policy if exists "app users read" on cash_closes;
  create policy "app users read" on cash_closes for select to authenticated using ((select session_ok()));
  alter table feedback enable row level security;
  drop policy if exists "app users read" on feedback;
  create policy "app users read" on feedback for select to authenticated using ((select session_ok()));
end $$;
revoke execute on function add_expense(jsonb), cancel_expense(uuid, text), cash_now(), close_day(jsonb), handle_feedback(uuid, text) from public, anon;
grant  execute on function add_expense(jsonb), cancel_expense(uuid, text), cash_now(), close_day(jsonb), handle_feedback(uuid, text) to authenticated;
revoke execute on function wa_due(timestamptz) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function wa_due(timestamptz) to service_role;
  end if;
end $$;

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
  ('stock_approval_above', '500'),      -- 'expensive' means worth this much (₹) or more, or no empty handed back
  ('opening_hours',     '"10:00 AM – 9:00 PM, all 7 days"'), -- shown on the website
  ('whatsapp',          '""'),           -- WhatsApp number for the website (empty = the phone number)
  ('maps_url',          '""'),           -- Google Maps link for the website
  ('paid_offs_per_month', '4'),         -- days off a month in the day rate: salary ÷ (days in month − this); not taken = paid, above = unpaid
  ('leave_blocked_days', '[5, 6, 0]'),  -- busy days (0 Sunday … 6 Saturday): leave on them is flagged to the owner, who decides
  ('leave_notice_days', '14'),          -- 2 or more days off in a month's last week: asked this many days before
  ('leave_one_at_a_time', 'true'),      -- one person off a day
  ('staff_free_sections', '["Hair", "Threading", "Waxing"]'), -- staff's own services on these billing tabs are free
  ('staff_discount_pct', '50'),         -- staff's own services on the other tabs: this % off
  ('leave_alert_days', '[7, 3, 1]'),    -- Telegram: leave coming up, this many days before (bookings to move, who else is off)
  ('wa_bills_on', 'false'),             -- send each bill to the customer on WhatsApp by itself (WhatsApp Business API, see README)
  ('wa_slips_on', 'true'),              -- WhatsApp: send the salary slip to the staff member when the salary is marked paid
  ('wa_feedback_on', 'false'),          -- WhatsApp: ask "How was your visit?" after a bill, then send the Google review link
  ('wa_feedback_after_hours', '2'),     -- …this many hours after the bill
  ('google_review_url', '""'),          -- the salon's Google review link (Google Business Profile → Ask for reviews)
  ('wa_review_all', 'true'),            -- the review link goes to everyone who answers (Google's rule), not only happy customers
  ('wa_reminders_on', 'false'),         -- WhatsApp: remind customers of a confirmed booking
  ('wa_remind_hours', '3'),             -- …this many hours before
  ('wa_winback_on', 'false'),           -- WhatsApp: "we miss you" to customers who agreed to offers and haven't come
  ('wa_winback_days', '45'),            -- …for this many days
  ('wa_winback_text', '"We would love to see you again."'), -- the line in that message (an offer, if you like)
  ('wa_winback_per_day', '20'),         -- at most this many a day
  ('cash_tolerance', '10'),             -- cash close: a difference above this (₹) needs a note
  ('due_max_counter', '200'),           -- a due (pay later) above this (₹) needs the owner
  ('expense_categories', '["Tea & snacks", "Cleaning", "Laundry", "Supplies", "Repairs", "Electricity", "Rent", "Internet & phone", "Transport", "Marketing", "Other"]'),
  ('loyalty_on',            'true'),    -- loyalty points (1 point = ₹1)
  ('loyalty_earn_pct',      '5'),       -- earned: % of what is paid for services at their normal price
  ('loyalty_min_use',       '100'),     -- can be used from this many points
  ('loyalty_max_use_pct',   '20'),      -- points pay at most this % of a bill
  ('loyalty_expiry_months', '12'),      -- points expire this many months after the last visit
  ('loyalty_products',      'false')    -- products earn points too
on conflict (key) do nothing;

-- =====================================================================
-- Backups (November 2026)
--   The nightly GitHub backup (.github/workflows/backup.yml) records each file it makes here. GitHub deletes each
--   file after 30 days, so the owners are reminded to download one and keep it (Google Drive, a pen drive):
--     due:    nothing downloaded in the last 6 days (or ever): the Monday morning message, and a bar in the app
--     urgent: nothing downloaded in 25 days and a backup is deleted within 5 days: every morning, until one is
--     stale:  the newest backup is more than 2 days old: the nightly backup stopped (GitHub → Actions)
--   The owner taps "I downloaded it" in the app (Settings → Data & backup); that stops the reminders for 6 days.
--   Only the owner can see this table; the backup itself writes to it with the database login (no row security).
-- =====================================================================
create table if not exists backups (
  id            uuid primary key default gen_random_uuid(),
  made_at       timestamptz not null default now(),
  file          text not null,
  size_bytes    bigint,
  run_url       text,                    -- the GitHub run page: the file is under Artifacts there
  expires_at    timestamptz not null,    -- when GitHub deletes it
  downloaded_at timestamptz,             -- the owner said they downloaded it
  downloaded_by text
);
create index if not exists backups_made_idx on backups (made_at desc);
alter table backups enable row level security;
drop policy if exists "owner reads" on backups;
create policy "owner reads" on backups for select to authenticated using ((select owner_ok()));

-- What to remind about (the morning message and the app say the same), or null before the first backup
create or replace function backup_status(p_now timestamptz default now()) returns jsonb
language sql stable security definer set search_path = public as $$
  with latest as (select * from backups order by made_at desc limit 1),
       dl as (select max(downloaded_at) d from backups),
       going as (select * from backups where downloaded_at is null and expires_at > p_now and expires_at <= p_now + interval '5 days'
                 order by expires_at limit 1)
  select case when not exists (select 1 from latest) then null else jsonb_build_object(
    'latest', (select jsonb_build_object('id', id, 'made_at', made_at, 'file', file, 'run_url', run_url, 'expires_at', expires_at,
                                         'downloaded_at', downloaded_at) from latest),
    'last_download', (select d from dl),
    'kept', (select count(*) from backups where expires_at > p_now),
    'stale', (select made_at < p_now - interval '2 days' from latest),
    'due', (select d is null or d < p_now - interval '6 days' from dl),
    'urgent', case when (select d is null or d < p_now - interval '25 days' from dl)
                   then (select jsonb_build_object('made_at', made_at, 'expires_at', expires_at, 'run_url', run_url) from going) end
  ) end;
$$;

-- The app: the owner sees the reminder (others get null)
create or replace function backup_alert() returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not owner_ok() then return null; end if;
  return backup_status(now());
end $$;

-- The app: "I downloaded it"
create or replace function mark_backup_downloaded(p_id uuid) returns backups
language plpgsql security definer set search_path = public as $$
declare v backups;
begin
  if not owner_ok() then raise exception 'Only the owner can do this'; end if;
  update backups set downloaded_at = now(), downloaded_by = coalesce(auth.jwt() ->> 'email', 'owner')
   where id = p_id returning * into v;
  if not found then raise exception 'That backup is not in the list'; end if;
  return v;
end $$;

revoke execute on function backup_status(timestamptz)       from public, anon, authenticated;
revoke execute on function backup_alert()                   from public, anon;
grant  execute on function backup_alert()                   to authenticated;
revoke execute on function mark_backup_downloaded(uuid)     from public, anon;
grant  execute on function mark_backup_downloaded(uuid)     to authenticated;
-- =====================================================================
-- Editing a saved bill (November 2026): the owner only (an owner login, or the counter unlocked by the owner)
--   A bill is a tax invoice, so its items and amounts never change. edit_bill() changes only what doesn't change
--   the money, and keeps every change in bill_edits (who, when, why, before → after):
--     * the customer's name, and the mobile number: the visit and the points the bill earned move to the right
--       customer (not when points were used on it, not for a staff member's own bill or to a staff number)
--     * who did each service (commission follows), unless that month's salary is already paid to either person
--     * how it was paid (cash / UPI / card, the same total), unless that time's cash is already closed
--     * the note
--   Wrong items or prices: "Correct items" in the app cancels the bill ("Corrected: …") and opens a new bill with
--   its lines; create_bill() links the two (bills.replaces / replaced_by).
-- =====================================================================
alter table bills add column if not exists edited_at   timestamptz;
alter table bills add column if not exists replaces    uuid references bills(id);
alter table bills add column if not exists replaced_by uuid references bills(id);

create table if not exists bill_edits (
  id         uuid primary key default gen_random_uuid(),
  bill_id    uuid not null references bills(id) on delete cascade,
  edited_at  timestamptz not null default now(),
  edited_by  text,
  reason     text not null,
  changes    jsonb not null           -- {"customer_phone": [old, new], "staff": [{"line": …, "from": …, "to": …}], …}
);
create index if not exists bill_edits_bill_idx on bill_edits (bill_id, edited_at);
alter table bill_edits enable row level security;
drop policy if exists "app users read" on bill_edits;
create policy "app users read" on bill_edits for select to authenticated using ((select session_ok()));

create or replace function edit_bill(p_id uuid, p jsonb) returns bills
language plpgsql security definer set search_path = public as $$
declare
  b        bills;
  v_reason text := nullif(left(trim(coalesce(p->>'reason', '')), 200), '');
  v_ch     jsonb := '{}'::jsonb;
  v_who    text := coalesce(auth.jwt() ->> 'email', 'owner');
  v_phone  text;
  v_name   text;
  v_new    customers;
  v_old    uuid;
  v_month  text;
  v_staff  jsonb := '[]'::jsonb;
  it       jsonb;
  li       bill_items;
  st       staff;
  v_c      numeric; v_u numeric; v_k numeric;
  v_mode   text;
  v_note   text;
  v_uuid   text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  m        text;
begin
  if not owner_ok() then raise exception 'Only the owner can edit a bill'; end if;
  select * into b from bills where id = p_id for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status <> 'paid' then raise exception 'A cancelled bill can''t be edited'; end if;
  if v_reason is null then raise exception 'Write why the bill is being changed'; end if;

  -- 1. The mobile number: the visit and the points it earned move to the right customer
  if p ? 'customer_phone' then
    v_phone := nullif(regexp_replace(coalesce(p->>'customer_phone', ''), '\D', '', 'g'), '');
    if v_phone is distinct from b.customer_phone then
      if v_phone is not null and v_phone !~ '^[6-9][0-9]{9}$' then raise exception 'The mobile number must be 10 digits'; end if;
      if b.for_staff is not null then raise exception 'This is a staff member''s own bill (staff prices). Use Correct items instead.'; end if;
      if v_phone is not null and exists (select 1 from staff where active and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone) then
        raise exception 'That is a staff member''s number: their own bills have staff prices. Use Correct items instead.';
      end if;
      if b.paid_points > 0 then raise exception 'Points were used on this bill, so its number can''t change. Use Correct items instead.'; end if;
      if b.points_earned > 0 and v_phone is null then raise exception 'This bill earned points, so it needs a mobile number'; end if;
      if b.points_earned > 0 and b.customer_id is not null and (select points from customers where id = b.customer_id) < b.points_earned then
        raise exception 'The points this bill earned were already used by that customer. Use Correct items instead.';
      end if;
      v_old := b.customer_id;
      if v_phone is not null then
        insert into customers (phone, name) values (v_phone, nullif(trim(coalesce(p->>'customer_name', '')), '')) on conflict (phone) do nothing;
        select * into v_new from customers where phone = v_phone;
      end if;
      if b.points_earned > 0 then
        insert into loyalty_points (customer_id, bill_id, kind, points, note, created_by)
        values (v_old, b.id, 'adjust', -b.points_earned, 'Bill ' || b.bill_no || ' moved to ' || v_phone, v_who),
               (v_new.id, b.id, 'adjust', b.points_earned, 'Bill ' || b.bill_no || ' moved from ' || coalesce(b.customer_phone, 'no number'), v_who);
      end if;
      update bills set customer_id = v_new.id, customer_phone = v_phone, points_balance = null where id = b.id;
      if v_old is not null then perform refresh_customer_stats(v_old); end if;
      if v_new.id is not null then perform refresh_customer_stats(v_new.id); end if;
      v_ch := v_ch || jsonb_build_object('customer_phone', jsonb_build_array(b.customer_phone, v_phone));
      select * into b from bills where id = p_id;
    end if;
  end if;

  -- 2. The name (on the bill, and the customer's own record)
  if p ? 'customer_name' then
    v_name := nullif(left(trim(coalesce(p->>'customer_name', '')), 80), '');
    if v_name is distinct from nullif(b.customer_name, '') then
      update bills set customer_name = v_name where id = b.id;
      if b.customer_id is not null and v_name is not null then update customers set name = v_name where id = b.customer_id; end if;
      v_ch := v_ch || jsonb_build_object('customer_name', jsonb_build_array(nullif(b.customer_name, ''), v_name));
    end if;
  end if;

  -- 3. Who did each service: commission follows, unless that month's salary is already paid
  if jsonb_typeof(p->'items') = 'array' then
    v_month := to_char(b.created_at at time zone 'Asia/Kolkata', 'YYYY-MM');
    for it in select * from jsonb_array_elements(p->'items') loop
      select * into li from bill_items where id = case when it->>'id' ~ v_uuid then (it->>'id')::uuid end and bill_id = b.id;
      if li.id is null then raise exception 'That line is not on this bill'; end if;
      st := null;
      if coalesce(it->>'staff_id', '') <> '' then
        select * into st from staff where id = case when it->>'staff_id' ~ v_uuid then (it->>'staff_id')::uuid end;
        if st.id is null then raise exception 'Choose a staff member on the list'; end if;
      end if;
      continue when st.id is not distinct from li.staff_id;
      if exists (select 1 from payslips where month = v_month and status = 'paid' and staff_id in (li.staff_id, st.id)) then
        raise exception '%', 'The salary for ' || to_char(b.created_at at time zone 'Asia/Kolkata', 'FMMonth YYYY')
                             || ' is already paid, so who did ' || li.name || ' can''t change now';
      end if;
      update bill_items set staff_id = st.id, staff_name = st.name where id = li.id;
      v_staff := v_staff || jsonb_build_array(jsonb_build_object('line', li.name, 'from', li.staff_name, 'to', st.name));
    end loop;
    if jsonb_array_length(v_staff) > 0 then v_ch := v_ch || jsonb_build_object('staff', v_staff); end if;
  end if;

  -- 4. How it was paid: the same total; not once that time's cash is closed
  if p ? 'paid_cash' or p ? 'paid_upi' or p ? 'paid_card' then
    foreach m in array array['paid_cash', 'paid_upi', 'paid_card'] loop
      if coalesce(p->>m, '0') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the amounts paid'; end if;
    end loop;
    v_c := coalesce((p->>'paid_cash')::numeric, 0); v_u := coalesce((p->>'paid_upi')::numeric, 0); v_k := coalesce((p->>'paid_card')::numeric, 0);
    if (v_c, v_u, v_k) is distinct from (b.paid_cash, b.paid_upi, b.paid_card) then
      if b.change_upi > 0 then raise exception 'Change was given by UPI on this bill. Use Correct items instead.'; end if;
      if v_c + v_u + v_k <> b.total - b.paid_points - b.paid_due then
        raise exception '%', 'Cash, UPI and card must add up to ₹' || trim_scale(b.total - b.paid_points - b.paid_due);
      end if;
      if exists (select 1 from cash_closes where closed_at >= b.created_at) then
        raise exception 'The cash for that time is already closed, so how this bill was paid can''t change now';
      end if;
      v_mode := case when (v_c > 0)::int + (v_u > 0)::int + (v_k > 0)::int > 1 then 'Split'
                     when v_u > 0 then 'UPI' when v_k > 0 then 'Card' else 'Cash' end;
      update bills set paid_cash = v_c, paid_upi = v_u, paid_card = v_k, pay_mode = v_mode where id = b.id;
      delete from bill_payments where bill_id = b.id and mode in ('cash', 'upi', 'card');
      insert into bill_payments (bill_id, created_at, mode, amount)
      select b.id, b.created_at, x.mode, x.amount from (values ('cash', v_c), ('upi', v_u), ('card', v_k)) x(mode, amount) where x.amount > 0;
      v_ch := v_ch || jsonb_build_object('payment', jsonb_build_array(
                jsonb_build_object('mode', b.pay_mode, 'cash', b.paid_cash, 'upi', b.paid_upi, 'card', b.paid_card),
                jsonb_build_object('mode', v_mode, 'cash', v_c, 'upi', v_u, 'card', v_k)));
    end if;
  end if;

  -- 5. The note
  if p ? 'note' then
    v_note := nullif(left(trim(coalesce(p->>'note', '')), 300), '');
    if v_note is distinct from nullif(b.note, '') then
      update bills set note = v_note where id = b.id;
      v_ch := v_ch || jsonb_build_object('note', jsonb_build_array(nullif(b.note, ''), v_note));
    end if;
  end if;

  if v_ch = '{}'::jsonb then raise exception 'Nothing was changed'; end if;
  update bills set edited_at = now() where id = b.id returning * into b;
  insert into bill_edits (bill_id, edited_by, reason, changes) values (b.id, v_who, v_reason, v_ch);
  return b;
end $$;

revoke execute on function edit_bill(uuid, jsonb) from public, anon;
grant  execute on function edit_bill(uuid, jsonb) to authenticated;
-- =====================================================================
-- Dues and change by UPI (November 2026)
--   Change by UPI: the customer pays with a big note and there is no small change. The salon keeps the note and sends
--   the change by UPI. change_upi is that amount: the cash close counts the note in the drawer (paid_cash +
--   change_upi) and the UPI that went out (UPI sales − change_upi).
--   Due (pay later): part of a bill isn't paid now (bill ₹2,100, the customer has ₹2,000). paid_due is that part. It
--   needs the customer's mobile number; above ₹200 (Settings: due_max_counter) the owner's OK. The bill says "Due".
--   Points are earned only on what was paid with money (bill_points). A due is collected later (collect_due), on the
--   day it comes in: the cash close for that day counts it (cash_now). due_left = what is still owed.
-- =====================================================================
alter table bills add column if not exists paid_due    numeric(12,2) not null default 0;
alter table bills add column if not exists change_upi  numeric(12,2) not null default 0;
alter table bills add column if not exists due_cleared numeric(12,2) not null default 0;
alter table bills add column if not exists due_left    numeric(12,2) generated always as (paid_due - due_cleared) stored;
create index if not exists bills_due_idx on bills (due_left) where due_left > 0;
alter table cash_closes add column if not exists due_collected numeric(12,2) not null default 0;

create table if not exists due_payments (
  id          uuid primary key default gen_random_uuid(),
  bill_id     uuid not null references bills(id),
  customer_id uuid references customers(id),
  amount      numeric(12,2) not null check (amount > 0),
  mode        text not null check (mode in ('cash', 'upi', 'card')),
  note        text,
  created_at  timestamptz not null default now(),
  created_by  text
);
create index if not exists due_payments_created_idx on due_payments (created_at);
create index if not exists due_payments_bill_idx on due_payments (bill_id);
alter table due_payments enable row level security;
drop policy if exists "app users read" on due_payments;
create policy "app users read" on due_payments for select to authenticated using ((select session_ok()));

-- The counter collects a due: part or all of it, by cash, UPI or card
create or replace function collect_due(p jsonb) returns due_payments
language plpgsql security definer set search_path = public as $$
declare
  b    bills;
  v_a  numeric;
  v_m  text := coalesce(nullif(p->>'mode', ''), 'cash');
  r    due_payments;
begin
  if not session_ok() then raise exception 'This login is not approved yet'; end if;
  select * into b from bills where id = case when coalesce(p->>'bill_id', '') ~ '^[0-9a-fA-F-]{36}$' then (p->>'bill_id')::uuid end for update;
  if not found then raise exception 'Bill not found'; end if;
  if b.status <> 'paid' then raise exception 'This bill is cancelled: nothing is due'; end if;
  if coalesce(p->>'amount', '') !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception 'Type the amount paid'; end if;
  v_a := (p->>'amount')::numeric;
  if v_a <= 0 then raise exception 'Type the amount paid'; end if;
  if v_a > b.due_left then raise exception '%', 'Only ₹' || trim_scale(b.due_left) || ' is due on ' || b.bill_no; end if;
  if v_m not in ('cash', 'upi', 'card') then raise exception 'Choose how it was paid'; end if;
  insert into due_payments (bill_id, customer_id, amount, mode, note, created_by)
  values (b.id, b.customer_id, v_a, v_m, nullif(left(trim(coalesce(p->>'note', '')), 200), ''), auth.jwt() ->> 'email')
  returning * into r;
  update bills set due_cleared = due_cleared + v_a where id = b.id;
  return r;
end $$;

revoke execute on function collect_due(jsonb) from public, anon;
grant  execute on function collect_due(jsonb) to authenticated;
-- =====================================================================
-- WhatsApp booking bot (November 2026)
--   A customer messages the salon's WhatsApp number: the bot answers with buttons (Book · Prices & offers · Talk to us).
--   A booking made there lands in Appointments → Requests (source WhatsApp); the counter confirms it and the
--   confirmation goes back on WhatsApp. "Prices" and "Talk to us" are kept as enquiries. Only the whatsapp
--   function (service key) uses these; the app and the website can't.
-- =====================================================================
create table if not exists wa_chats (
  phone       text primary key,               -- 10 digits
  name        text,                           -- the WhatsApp profile name
  state       jsonb not null default '{}',    -- where the customer is in the booking steps
  last_in_at  timestamptz,                    -- their last message: WhatsApp lets us reply freely for 24 hours after it
  human_until timestamptz,                    -- after "Talk to us": the bot stays quiet until then
  updated_at  timestamptz not null default now()
);
alter table wa_chats enable row level security;   -- no policies: the service key only

insert into settings (key, value) values ('wa_bot_on', 'false') on conflict (key) do nothing; -- the WhatsApp booking bot answers customers

-- A booking from the bot: prices from the menu, only services that can be booked online, a request for the counter
create or replace function wa_book(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_phone  text;
  v_name   text := left(trim(coalesce(p ->> 'name', '')), 80);
  v_today  date := (now() at time zone 'Asia/Kolkata')::date;
  v_date   date;
  v_time   text := nullif(trim(coalesce(p ->> 'time', '')), '');
  v_b      bookings;
  v_enq    uuid;
  it       jsonb;
  s        services;
  v_opt    text;
  v_price  numeric;
  v_from   boolean;
  v_dur    int := 0;
  v_items  jsonb := '[]';
begin
  if v_digits !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'Bad phone'; end if;
  v_phone := right(v_digits, 10);
  if length(v_name) < 2 then raise exception 'Name needed'; end if;
  begin
    v_date := (p ->> 'date')::date;
  exception when others then raise exception 'Bad date';
  end;
  if v_date is null or v_date < v_today or v_date > v_today + 30 then raise exception 'Bad date'; end if;
  if v_time is not null and v_time !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then raise exception 'Bad time'; end if;
  if jsonb_typeof(p -> 'items') is distinct from 'array' or jsonb_array_length(p -> 'items') not between 1 and 5 then
    raise exception 'Choose 1 to 5 services';
  end if;
  if (select count(*) from bookings where phone = v_phone and created_by = 'whatsapp' and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Too many';
  end if;
  -- what they asked before (Prices, Talk to us): now booked
  select id into v_enq from enquiries
   where phone = v_phone and status in ('new', 'replied', 'follow_up') and created_at > now() - interval '14 days'
   order by created_at desc limit 1;
  insert into bookings (ref, phone, name, customer_id, want_date, want_time, source, status, note, created_by, enquiry_id)
  values (upper(substr(md5(gen_random_uuid()::text), 1, 6)), v_phone, v_name, (select id from customers where phone = v_phone),
          v_date, v_time, 'whatsapp', 'requested', left(nullif(trim(p ->> 'note'), ''), 500), 'whatsapp', v_enq)
  returning * into v_b;
  for it in select * from jsonb_array_elements(p -> 'items') loop
    select * into s from services
     where id = case when it ->> 'service_id' ~ '^[0-9a-f-]{36}$' then (it ->> 'service_id')::uuid end
       and active and show_on_website and book_online;
    if not found then raise exception 'Service not bookable'; end if;
    v_opt := nullif(trim(coalesce(it ->> 'option', '')), '');
    v_price := s.price;
    v_from := s.open_price;
    if s.variants is not null then
      v_price := null;
      if v_opt is not null then
        select (e ->> 'price')::numeric into v_price from jsonb_array_elements(s.variants) e where e ->> 'label' = v_opt limit 1;
      end if;
      if v_price is null then v_price := s.price; v_from := true; v_opt := null; end if;
    end if;
    insert into booking_items (booking_id, service_id, name, option_label, price, price_from)
    values (v_b.id, s.id, s.name, v_opt, v_price, v_from);
    v_dur := v_dur + coalesce(s.duration_min, 30);
    v_items := v_items || jsonb_build_object('name', s.name, 'option', v_opt, 'price', v_price, 'from', v_from);
  end loop;
  update bookings set duration_min = greatest(v_dur, 15) where id = v_b.id;
  if v_enq is not null then
    update enquiries set status = 'booked', booking_id = v_b.id where id = v_enq;
  end if;
  return jsonb_build_object('id', v_b.id, 'ref', v_b.ref, 'items', v_items);
end $$;

-- "Prices & offers" or "Talk to us": one open enquiry a customer (a week), their words added to it
create or replace function wa_enquiry(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_digits text := regexp_replace(coalesce(p ->> 'phone', ''), '\D', '', 'g');
  v_phone  text;
  v_msg    text := left(trim(coalesce(p ->> 'message', '')), 1000);
  e        enquiries;
begin
  if v_digits !~ '^(91|0)?[6-9][0-9]{9}$' then raise exception 'Bad phone'; end if;
  v_phone := right(v_digits, 10);
  select * into e from enquiries
   where phone = v_phone and status in ('new', 'replied', 'follow_up') and created_at > now() - interval '7 days'
   order by created_at desc limit 1 for update;
  if found then
    if v_msg <> '' and position(v_msg in coalesce(e.message, '')) = 0 then
      update enquiries set message = left(concat_ws(E'\n', nullif(message, ''), v_msg), 2000), status = 'new' where id = e.id returning * into e;
    end if;
    return jsonb_build_object('id', e.id, 'ref', e.ref, 'fresh', false);
  end if;
  insert into enquiries (phone, name, customer_id, source, message, created_by)
  values (v_phone, nullif(left(trim(coalesce(p ->> 'name', '')), 80), ''), (select id from customers where phone = v_phone),
          'whatsapp', nullif(v_msg, ''), 'whatsapp')
  returning * into e;
  return jsonb_build_object('id', e.id, 'ref', e.ref, 'fresh', true);
end $$;

revoke execute on function wa_book(jsonb), wa_enquiry(jsonb) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function wa_book(jsonb), wa_enquiry(jsonb) to service_role;
    grant all on wa_chats to service_role;
  end if;
end $$;
