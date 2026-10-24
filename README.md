# CERTA& Advisory CashFlow Log

A shared expense ledger for the three CERTA& Advisory partners. All amounts are in BDT, shown with Indian digit grouping (৳1,23,456).

It records three things:

1. **Money received**: one partner sends money and another receives it.
2. **Expenses paid from money received**: each one is logged against the receipt it came from, and can't exceed what's left on it.
3. **Paid by partners**: expenses a partner pays from his own pocket.

Built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase (auth, Postgres, realtime, row-level security). It deploys to Vercel's free tier.

## Project layout

| Path | What it is |
| --- | --- |
| `supabase/migrations/20261024000000_init.sql` | Tables, overspend trigger, row-level security, realtime |
| `supabase/seed.sql` | The three partners and the categories (no transactions) |
| `lib/ledger.ts` | All the calculations (balances, totals, per partner, by category, by month, CSV) |
| `components/` | The four screens: Money received, Paid by partners, Summary, Settings |
| `tests/ledger.test.ts` | Calculation tests |
| `tests/db.test.ts` | Runs the real migration on in-memory Postgres to test the trigger and access rules |
| `docs/` | The original build prompt and the single-page reference design |

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and click **New project**. Pick the **Singapore** region (closest to Bangladesh) and set a database password.
2. When it's ready, open **SQL Editor → New query**, paste the whole of `supabase/migrations/20261024000000_init.sql` and click **Run**.
3. Open `supabase/seed.sql` and **replace the placeholder emails** with the address each partner will sign in with. Use lowercase. Towfiq is the `owner`.
4. Paste the edited seed into a new query and **Run** it.
5. Go to **Authentication → Sign In / Providers**:
   - Keep **Email** enabled (magic links).
   - Turn **off** "Allow new users to sign up". Only invited partners can then get in.
6. Go to **Authentication → URL Configuration**:
   - **Site URL**: your Vercel URL once you have one (use `http://localhost:3000` for now).
   - **Redirect URLs**: add `http://localhost:3000/auth/callback` and, later, `https://YOUR-APP.vercel.app/auth/callback`.

> Using the Supabase CLI instead? Run `supabase link` then `supabase db push`, and run `seed.sql` in the SQL editor.

### Optional: Google sign-in

1. In [Google Cloud Console](https://console.cloud.google.com/apis/credentials), create an **OAuth client ID** of type *Web application*.
2. Under **Authorised redirect URIs**, add the callback URL Supabase shows under **Authentication → Sign In / Providers → Google** (it looks like `https://YOUR-PROJECT.supabase.co/auth/v1/callback`).
3. Paste the client ID and secret into the Supabase Google provider and enable it.

A partner signing in with Google must use the same email that's in the `partners` table.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in both values from **Supabase → Project Settings → API**:

```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-public-key
```

The anon key is safe in the browser: row-level security means it can read and write nothing unless a signed-in partner is using it. **Never** put the `service_role` key in this app.

## 3. Run locally

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # calculation and database tests
npm run build      # production build check
```

## 4. Deploy to Vercel

1. Push this repo to GitHub (already done if you're reading this there).
2. On [vercel.com](https://vercel.com), click **Add New → Project** and import the repo. Vercel detects Next.js.
3. Under **Environment Variables**, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. Click **Deploy**.
5. Back in Supabase **Authentication → URL Configuration**, set **Site URL** to the Vercel URL and add `https://YOUR-APP.vercel.app/auth/callback` to the redirect URLs.

## 5. Invite the partners

Each partner needs two things: a row in `partners` (from the seed) and a Supabase user.

1. In Supabase, open **Authentication → Users → Add user → Send invitation**.
2. Enter the partner's email, exactly as it appears in `partners`. Repeat for all three.
3. Each partner gets an email. After that, they open the app, type their email and tap **Email me a sign-in link**, or use **Continue with Google**.

To **change a partner's email** later, update both places:

- In **Table Editor → partners**, edit the `email` (lowercase).
- Invite the new address under **Authentication → Users**.

Anyone who signs in with an email that isn't in `partners` sees a "This ledger is for invited partners" page and can't read or write anything.

## How the rules are enforced

| Rule | In the app | In the database |
| --- | --- | --- |
| Expense can't exceed what's left on its receipt | Checked before saving, with the "Only ৳X is left…" message | `check_expense_within_receipt` trigger locks the receipt row, so two partners saving at once can't both overspend |
| Paying partner is the receipt's receiver | Set automatically | The trigger overwrites `paid_by` |
| Receipt with expenses can't be deleted | Delete button says "Delete its expenses first" | `on delete restrict` foreign key |
| Sent by ≠ Received by | Form check | `receipts_sender_differs` check constraint |
| Who entered it | Shown as "Entered by" | `created_by` and `created_at` are stamped by a trigger and can't be faked |
| Only partners can read/write | Sign-in required | Row-level security on every table |
| Only the owner edits names and categories | Settings are read-only for others | RLS policies plus the owner-only `rename_category` function |

Entries are never edited, only added or deleted. To fix a mistake, delete the entry and log it again.
