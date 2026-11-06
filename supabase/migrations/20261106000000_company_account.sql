-- Company bank account model.
-- All money goes into the CERTA& Advisory bank account:
--   money_in.kind = 'revenue'    → paid by another company (typed name in `company`)
--   money_in.kind = 'investment' → deposited by a partner (`partner_id`)
-- Expenses are paid from the bank (source 'bank', capped by the bank balance)
-- or by a partner from their own pocket (source 'partner', also their investment).

-- ---------------------------------------------------------------------------
-- 0. Safety guard: the conversion below assumes the live data is exactly the one
--    Taj Consultancy receipt and no expenses (or an empty new database).
--    Anything else stops the migration before it changes a thing.
-- ---------------------------------------------------------------------------

do $$
declare r int; e int;
begin
  select count(*) into r from public.receipts;
  select count(*) into e from public.expenses;
  if r > 1 or e > 0 then
    raise exception 'Company account migration expected at most 1 receipt and no expenses, found % receipts and % expenses', r, e;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Remove the per-receipt rules
-- ---------------------------------------------------------------------------

drop trigger if exists expenses_within_receipt on public.expenses;
drop trigger if exists receipts_not_below_spent on public.receipts;
drop function if exists public.check_expense_within_receipt();
drop function if exists public.check_receipt_not_below_spent();

-- ---------------------------------------------------------------------------
-- 2. receipts → money_in
-- ---------------------------------------------------------------------------

alter table public.receipts rename to money_in;
alter table public.money_in rename column from_partner to partner_id;
alter table public.money_in drop constraint receipts_sender_differs;
alter table public.money_in add column kind text;
alter table public.money_in add column company text;
alter table public.money_in alter column partner_id drop not null;

-- The only live record (sent "from Azharul") is the Taj Consultancy payment.
update public.money_in set kind = 'revenue', company = 'Taj Consultancy', partner_id = null;

alter table public.money_in drop column to_partner;
alter table public.money_in alter column kind set not null;
alter table public.money_in add constraint money_in_kind_check check (kind in ('revenue', 'investment'));
alter table public.money_in add constraint money_in_company_check check (company is null or length(trim(company)) between 1 and 80);
alter table public.money_in add constraint money_in_source_check check (
  (kind = 'investment' and partner_id is not null and company is null) or
  (kind = 'revenue' and company is not null and partner_id is null)
);

alter index if exists public.receipts_pkey rename to money_in_pkey;
alter index if exists public.receipts_date_idx rename to money_in_date_idx;
alter trigger receipts_stamp on public.money_in rename to money_in_stamp;
alter policy receipts_read on public.money_in rename to money_in_read;
alter policy receipts_insert on public.money_in rename to money_in_insert;
alter policy receipts_delete on public.money_in rename to money_in_delete;

-- ---------------------------------------------------------------------------
-- 3. expenses: paid from the bank, or by a partner
-- ---------------------------------------------------------------------------

alter table public.expenses drop constraint expenses_source_matches;
alter type public.expense_source rename value 'receipt' to 'bank';
alter type public.expense_source rename value 'direct' to 'partner';
alter table public.expenses drop column receipt_id;
alter table public.expenses alter column paid_by drop not null;
update public.expenses set paid_by = null where source = 'bank';
alter table public.expenses add constraint expenses_paid_by_check check (
  (source = 'bank' and paid_by is null) or (source = 'partner' and paid_by is not null)
);

-- ---------------------------------------------------------------------------
-- 4. Bank balance rule
-- ---------------------------------------------------------------------------

create or replace function public.bank_balance()
returns numeric(12,2) language sql stable security definer set search_path = public as $$
  select ((select coalesce(sum(amount), 0) from public.money_in)
        - (select coalesce(sum(amount), 0) from public.expenses where source = 'bank'))::numeric(12,2)
$$;

-- A bank expense can't be more than what's in the bank. One lock serialises
-- every balance check, so two partners logging at once can't both overspend.
create or replace function public.check_bank_expense()
returns trigger language plpgsql security definer set search_path = public as $$
declare available numeric(12,2);
begin
  if new.source <> 'bank' then
    return new;
  end if;
  perform pg_advisory_xact_lock(20261106);
  select ((select coalesce(sum(amount), 0) from public.money_in)
        - (select coalesce(sum(amount), 0) from public.expenses where source = 'bank' and id <> new.id))::numeric(12,2)
    into available;
  if new.amount > available then
    raise exception 'OVERSPEND:%', available
      using errcode = 'P0001',
            hint = 'Log the rest as paid by a partner, or log money in first.';
  end if;
  return new;
end $$;

create trigger expenses_bank_check before insert or update on public.expenses
  for each row execute function public.check_bank_expense();

-- Money in can't be lowered or deleted if the bank balance would go below zero.
create or replace function public.check_money_in_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare cur numeric(12,2);
begin
  perform pg_advisory_xact_lock(20261106);
  cur := public.bank_balance();
  if cur - old.amount + (case when tg_op = 'UPDATE' then new.amount else 0 end) < 0 then
    raise exception 'OVERSPEND:%', cur using errcode = 'P0001';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end $$;

create trigger money_in_bank_check before update of amount or delete on public.money_in
  for each row execute function public.check_money_in_change();

-- ---------------------------------------------------------------------------
-- 5. Google Sheet export, new shape
-- ---------------------------------------------------------------------------

create or replace function public.ledger_export(key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if key is null or not exists (select 1 from public.export_keys where key_hash = sha256(convert_to(key, 'UTF8'))) then
    raise exception 'Invalid export key' using errcode = '28000';
  end if;

  with
  pname as (select id, name from public.partners),
  inv as (
    -- Date, Partner, How, Category, Amount, Note, Entered by, Entered at, ID
    select m.date, p.name partner, 'Deposit' how, '' category, m.amount, m.note, c.name entered_by, m.created_at, m.id
    from public.money_in m join pname p on p.id = m.partner_id left join pname c on c.id = m.created_by
    where m.kind = 'investment'
    union all
    select e.date, p.name, 'Paid from pocket', e.category, e.amount, e.note, c.name, e.created_at, e.id
    from public.expenses e join pname p on p.id = e.paid_by left join pname c on c.id = e.created_by
    where e.source = 'partner'
  )
  select jsonb_build_object(
    'generated_at', now(),

    'totals', jsonb_build_object(
      'bank',       public.bank_balance(),
      'revenue',    (select coalesce(sum(amount), 0) from public.money_in where kind = 'revenue'),
      'investment', (select coalesce(sum(amount), 0) from inv),
      'expenses',   (select coalesce(sum(amount), 0) from public.expenses)
    ),

    -- Date, Company, Amount, Note, Entered by, Entered at, ID
    'revenue', coalesce((
      select jsonb_agg(jsonb_build_array(m.date, m.company, m.amount, m.note, c.name, m.created_at, m.id) order by m.date desc, m.created_at desc)
      from public.money_in m left join pname c on c.id = m.created_by
      where m.kind = 'revenue'
    ), '[]'::jsonb),

    'investment', coalesce((
      select jsonb_agg(jsonb_build_array(date, partner, how, category, amount, note, entered_by, created_at, id) order by date desc, created_at desc)
      from inv
    ), '[]'::jsonb),

    -- Date, Paid from, Category, Amount, Note, Entered by, Entered at, ID
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_array(
        e.date, case when e.source = 'bank' then 'Bank' else p.name end, e.category, e.amount, e.note, c.name, e.created_at, e.id
      ) order by e.date desc, e.created_at desc)
      from public.expenses e left join pname p on p.id = e.paid_by left join pname c on c.id = e.created_by
    ), '[]'::jsonb),

    -- Company (most recent spelling), Amount — grouped case-insensitively, largest first
    'companies', coalesce((
      select jsonb_agg(jsonb_build_array(name, total) order by total desc, name)
      from (
        select (array_agg(trim(company) order by date desc, created_at desc))[1] as name, sum(amount) as total
        from public.money_in where kind = 'revenue'
        group by lower(trim(company))
      ) s
    ), '[]'::jsonb),

    -- Partner, Deposits, Paid from pocket, Total investment
    'partners', coalesce((
      select jsonb_agg(jsonb_build_array(p.name, x.deposits, x.pocket, x.deposits + x.pocket) order by p.sort)
      from public.partners p
      cross join lateral (
        select
          (select coalesce(sum(amount), 0) from public.money_in where kind = 'investment' and partner_id = p.id) as deposits,
          (select coalesce(sum(amount), 0) from public.expenses where source = 'partner' and paid_by = p.id) as pocket
      ) x
    ), '[]'::jsonb),

    -- Category, Amount (both payment methods), largest first
    'categories', coalesce((
      select jsonb_agg(jsonb_build_array(category, total) order by total desc, category)
      from (select category, sum(amount) as total from public.expenses group by category) s
    ), '[]'::jsonb),

    -- Month (YYYY-MM), Revenue, Investment, Expenses — newest first
    'months', coalesce((
      select jsonb_agg(jsonb_build_array(m, revenue, investment, expenses) order by m desc)
      from (
        select m, sum(revenue) as revenue, sum(investment) as investment, sum(expenses) as expenses
        from (
          select to_char(date, 'YYYY-MM') m,
                 case when kind = 'revenue' then amount else 0 end revenue,
                 case when kind = 'investment' then amount else 0 end investment,
                 0 expenses
          from public.money_in
          union all
          select to_char(date, 'YYYY-MM'),
                 0,
                 case when source = 'partner' then amount else 0 end,
                 amount
          from public.expenses
        ) u group by m
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.ledger_export(text) from public;
grant execute on function public.ledger_export(text) to anon, authenticated;
revoke execute on function public.bank_balance() from public, anon, authenticated;
