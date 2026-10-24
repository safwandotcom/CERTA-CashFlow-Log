-- Passcode mode: the app's server talks to the database with the secret key
-- (role service_role), so the owner-only rename must also accept that role.

create or replace function public.rename_category(cat_id uuid, new_name text)
returns void language plpgsql security definer set search_path = public as $$
declare old_name text;
begin
  if not (public.is_owner() or coalesce(auth.jwt() ->> 'role', '') = 'service_role') then
    raise exception 'Only the owner can rename categories' using errcode = '42501';
  end if;
  select name into old_name from public.categories where id = cat_id for update;
  if not found then
    raise exception 'Category not found' using errcode = 'P0002';
  end if;
  update public.categories set name = trim(new_name) where id = cat_id;
  update public.expenses set category = trim(new_name) where category = old_name;
end $$;
