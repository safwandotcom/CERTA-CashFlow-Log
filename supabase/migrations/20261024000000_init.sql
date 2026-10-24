-- CERTA& Advisory CashFlow Log: initial schema
-- Three record kinds: receipts (money received), expenses with source 'receipt'
-- (paid from a receipt) and expenses with source 'direct' (paid by a partner).

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.partners (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  email      text not null unique check (email = lower(email)),
  role       text not null default 'partner' check (role in ('owner', 'partner')),
  sort       int  not null default 0,
  created_at timestamptz not null default now()
);

create table public.categories (
  id   uuid primary key default gen_random_uuid(),
  name text not null unique check (length(trim(name)) between 1 and 60),
  sort int  not null default 0
);

create table public.receipts (
  id           uuid primary key default gen_random_uuid(),
  date         date not null,
  from_partner uuid not null references public.partners(id),
  to_partner   uuid not null references public.partners(id),
  amount       numeric(12,2) not null check (amount > 0),
  note         text not null default '' check (length(note) <= 200),
  created_by   uuid references public.partners(id),
  created_at   timestamptz not null default now(),
  constraint receipts_sender_differs check (from_partner <> to_partner)
);

create type public.expense_source as enum ('receipt', 'direct');

create table public.expenses (
  id         uuid primary key default gen_random_uuid(),
  -- on delete restrict: a receipt with expenses can't be deleted
  receipt_id uuid references public.receipts(id) on delete restrict,
  paid_by    uuid not null references public.partners(id),
  date       date not null,
  category   text not null check (length(trim(category)) between 1 and 60),
  amount     numeric(12,2) not null check (amount > 0),
  note       text not null default '' check (length(note) <= 200),
  source     public.expense_source not null,
  created_by uuid references public.partners(id),
  created_at timestamptz not null default now(),
  constraint expenses_source_matches check (
    (source = 'receipt' and receipt_id is not null) or
    (source = 'direct'  and receipt_id is null)
  )
);

create index expenses_receipt_id_idx on public.expenses(receipt_id);
create index expenses_date_idx on public.expenses(date);
create index receipts_date_idx on public.receipts(date);

-- ---------------------------------------------------------------------------
-- Identity helpers: a signed-in user is a partner when their email matches.
-- ---------------------------------------------------------------------------

create or replace function public.current_partner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.partners where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_partner()
returns boolean language sql stable security definer set search_path = public as $$
  select public.current_partner_id() is not null
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.partners
    where email = lower(coalesce(auth.jwt() ->> 'email', '')) and role = 'owner'
  )
$$;

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

-- Stamp created_by with the signed-in partner (can't be spoofed by the client).
create or replace function public.stamp_created_by()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(public.current_partner_id(), new.created_by);
    new.created_at := now();
  else
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger receipts_stamp before insert or update on public.receipts
  for each row execute function public.stamp_created_by();
create trigger expenses_stamp before insert or update on public.expenses
  for each row execute function public.stamp_created_by();

-- Overspend rule: an expense can't exceed what is left on its receipt.
-- The receipt row is locked so two partners logging at once can't both overspend.
create or replace function public.check_expense_within_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  r     public.receipts%rowtype;
  spent numeric(12,2);
  left_ numeric(12,2);
begin
  -- Direct payments have no receipt; a missing receipt_id is rejected by expenses_source_matches.
  if new.source = 'direct' or new.receipt_id is null then
    return new;
  end if;

  select * into r from public.receipts where id = new.receipt_id for update;
  if not found then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;

  -- The paying partner is always the receipt's receiver.
  new.paid_by := r.to_partner;

  select coalesce(sum(amount), 0) into spent
  from public.expenses
  where receipt_id = new.receipt_id and id <> new.id;

  left_ := r.amount - spent;
  if new.amount > left_ then
    raise exception 'OVERSPEND:%', left_
      using errcode = 'P0001',
            hint = 'Log the rest from another receipt, or under Paid by partners.';
  end if;
  return new;
end $$;

create trigger expenses_within_receipt before insert or update on public.expenses
  for each row execute function public.check_expense_within_receipt();

-- A receipt's amount can't be lowered below what's already spent from it.
create or replace function public.check_receipt_not_below_spent()
returns trigger language plpgsql security definer set search_path = public as $$
declare spent numeric(12,2);
begin
  select coalesce(sum(amount), 0) into spent from public.expenses where receipt_id = new.id;
  if new.amount < spent then
    raise exception 'OVERSPEND:%', new.amount - spent using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger receipts_not_below_spent before update of amount on public.receipts
  for each row execute function public.check_receipt_not_below_spent();

-- Owner-only rename that also relabels past expenses, so the summary stays consistent.
create or replace function public.rename_category(cat_id uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare old_name text;
begin
  if not public.is_owner() then
    raise exception 'Only the owner can rename categories' using errcode = '42501';
  end if;
  select name into old_name from public.categories where id = cat_id for update;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  update public.categories set name = trim(new_name) where id = cat_id;
  update public.expenses set category = trim(new_name) where category = old_name;
end $$;

revoke execute on function public.rename_category(uuid, text) from public, anon;
grant execute on function public.rename_category(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: only the invited partners can read or write.
-- ---------------------------------------------------------------------------

alter table public.partners   enable row level security;
alter table public.categories enable row level security;
alter table public.receipts   enable row level security;
alter table public.expenses   enable row level security;

create policy partners_read  on public.partners for select using (public.is_partner());
create policy partners_owner on public.partners for update using (public.is_owner()) with check (public.is_owner());

create policy categories_read   on public.categories for select using (public.is_partner());
create policy categories_insert on public.categories for insert with check (public.is_owner());
create policy categories_update on public.categories for update using (public.is_owner()) with check (public.is_owner());
create policy categories_delete on public.categories for delete using (public.is_owner());

create policy receipts_read   on public.receipts for select using (public.is_partner());
create policy receipts_insert on public.receipts for insert with check (public.is_partner());
create policy receipts_delete on public.receipts for delete using (public.is_partner());

create policy expenses_read   on public.expenses for select using (public.is_partner());
create policy expenses_insert on public.expenses for insert with check (public.is_partner());
create policy expenses_delete on public.expenses for delete using (public.is_partner());

-- ---------------------------------------------------------------------------
-- Realtime: entries one partner adds appear for the others without a reload.
-- ---------------------------------------------------------------------------

alter table public.receipts   replica identity full;
alter table public.expenses   replica identity full;
alter publication supabase_realtime add table public.partners, public.categories, public.receipts, public.expenses;
