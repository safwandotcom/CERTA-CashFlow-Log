-- Read-only export for the Google Sheet sync (google-sheets/Code.gs).
-- The sheet calls ledger_export(key) with a secret export key. The key's hash is
-- stored in export_keys, which has RLS on and no policies, so the API can't read it.

create table public.export_keys (
  id         uuid primary key default gen_random_uuid(),
  label      text not null default 'Google Sheet',
  key_hash   bytea not null unique,
  created_at timestamptz not null default now()
);
alter table public.export_keys enable row level security;

-- Run in the Supabase SQL editor: returns a new key once. Only its hash is kept.
create or replace function public.create_export_key(p_label text default 'Google Sheet')
returns text language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  insert into public.export_keys (label, key_hash) values (p_label, sha256(convert_to(k, 'UTF8')));
  return k;
end $$;
revoke execute on function public.create_export_key(text) from public, anon, authenticated;

create or replace function public.ledger_export(key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare result jsonb;
begin
  if key is null or not exists (select 1 from public.export_keys where key_hash = sha256(convert_to(key, 'UTF8'))) then
    raise exception 'Invalid export key' using errcode = '28000';
  end if;

  with
  rb as (
    select r.*, coalesce(sum(e.amount), 0)::numeric(12,2) as spent
    from public.receipts r left join public.expenses e on e.receipt_id = r.id and e.source = 'receipt'
    group by r.id
  ),
  pname as (select id, name from public.partners)
  select jsonb_build_object(
    'generated_at', now(),

    'totals', jsonb_build_object(
      'received', (select coalesce(sum(amount), 0) from public.receipts),
      'spent',    (select coalesce(sum(amount), 0) from public.expenses where source = 'receipt'),
      'left',     (select coalesce(sum(amount), 0) from public.receipts) - (select coalesce(sum(amount), 0) from public.expenses where source = 'receipt'),
      'direct',   (select coalesce(sum(amount), 0) from public.expenses where source = 'direct')
    ),

    -- Date, Sent by, Received by, Amount, Spent, Left, Note, Entered by, Entered at, ID
    'receipts', coalesce((
      select jsonb_agg(jsonb_build_array(
        rb.date, f.name, t.name, rb.amount, rb.spent, rb.amount - rb.spent, rb.note, c.name, rb.created_at, rb.id
      ) order by rb.date desc, rb.created_at desc)
      from rb
      join pname f on f.id = rb.from_partner
      join pname t on t.id = rb.to_partner
      left join pname c on c.id = rb.created_by
    ), '[]'::jsonb),

    -- Date, Type, Paid by, Category, Amount, Paid from, Note, Entered by, Entered at, ID
    'expenses', coalesce((
      select jsonb_agg(jsonb_build_array(
        e.date,
        case e.source when 'receipt' then 'From money received' else 'Paid by partner' end,
        p.name, e.category, e.amount,
        case when r.id is null then '' else to_char(r.date, 'FMDD Mon YYYY') || ' · from ' || rf.name end,
        e.note, c.name, e.created_at, e.id
      ) order by e.date desc, e.created_at desc)
      from public.expenses e
      join pname p on p.id = e.paid_by
      left join public.receipts r on r.id = e.receipt_id
      left join pname rf on rf.id = r.from_partner
      left join pname c on c.id = e.created_by
    ), '[]'::jsonb),

    -- Partner, Money sent, Paid directly, Total contributed, Spent from money received, Still holding
    'partners', coalesce((
      select jsonb_agg(jsonb_build_array(
        p.name, x.sent, x.direct, x.sent + x.direct,
        case when x.received_count > 0 then x.rspent end,
        case when x.received_count > 0 then x.held end
      ) order by p.sort)
      from public.partners p
      cross join lateral (
        select
          (select coalesce(sum(amount), 0) from public.receipts where from_partner = p.id) as sent,
          (select coalesce(sum(amount), 0) from public.expenses where source = 'direct' and paid_by = p.id) as direct,
          (select count(*) from rb where to_partner = p.id) as received_count,
          (select coalesce(sum(spent), 0) from rb where to_partner = p.id) as rspent,
          (select coalesce(sum(amount - spent), 0) from rb where to_partner = p.id) as held
      ) x
    ), '[]'::jsonb),

    -- Category, Amount (both sources), largest first
    'categories', coalesce((
      select jsonb_agg(jsonb_build_array(category, total) order by total desc, category)
      from (select category, sum(amount) as total from public.expenses group by category) s
    ), '[]'::jsonb),

    -- Month (YYYY-MM), Received, Spent, Paid by partners — newest first
    'months', coalesce((
      select jsonb_agg(jsonb_build_array(m, received, spent, direct) order by m desc)
      from (
        select m, sum(received) as received, sum(spent) as spent, sum(direct) as direct
        from (
          select to_char(date, 'YYYY-MM') m, amount received, 0 spent, 0 direct from public.receipts
          union all
          select to_char(date, 'YYYY-MM'),
                 0,
                 case when source = 'receipt' then amount else 0 end,
                 case when source = 'direct' then amount else 0 end
          from public.expenses
        ) u group by m
      ) s
    ), '[]'::jsonb)
  ) into result;

  return result;
end $$;

revoke execute on function public.ledger_export(text) from public;
grant execute on function public.ledger_export(text) to anon, authenticated;
