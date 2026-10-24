-- Partners and categories only. No transactions are seeded.
-- Replace the emails with the addresses each partner will sign in with.

insert into public.partners (name, email, role, sort) values
  ('Azharul Islam',        'azharul@example.com', 'partner', 0),
  ('Jubair Eusuf',         'jubair@example.com',  'partner', 1),
  ('Sarker Towfiq Pritom', 'towfiq@veita.ai',     'owner',   2)
on conflict (email) do nothing;

insert into public.categories (name, sort) values
  ('Staff salary', 0),
  ('Staff operational cost', 1),
  ('Office rent', 2),
  ('Subscriptions', 3),
  ('Technology', 4),
  ('Utilities & internet', 5),
  ('Office supplies', 6),
  ('Licences & fees', 7),
  ('Marketing', 8),
  ('Other', 9)
on conflict (name) do nothing;
