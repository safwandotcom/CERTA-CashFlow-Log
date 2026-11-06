# CERTA& Advisory CashFlow Log

A shared expense ledger for the three CERTA& Advisory partners. All amounts are in BDT, shown with Indian digit grouping (৳1,23,456).

All money goes through **the CERTA& Advisory bank account**. The app records:

1. **Money in**, which is either:
   - **Revenue:** another company pays CERTA& Advisory, for example Taj Consultancy paying for staff. You type the company's name.
   - **Investment:** a partner deposits their own money.
2. **Company expenses**, paid either:
   - **from the bank account.** An expense can't be more than the current bank balance.
   - **by a partner from their own pocket.** It counts as a company expense *and* as that partner's investment, and doesn't change the bank balance.

**Bank balance** = revenue + partner deposits − expenses paid from the bank.

Built with Next.js (App Router), TypeScript, Tailwind CSS and Supabase Postgres. It deploys to Vercel's free tier.

**Access:** one shared passcode, entered once per device and remembered for a year. There are no accounts. The browser never talks to the database: every read and write goes through the app's server, which uses a secret key that never reaches the page. With the public key alone, the database returns nothing.

## Project layout

| Path | What it is |
| --- | --- |
| `supabase/migrations/20261024000000_init.sql` | Tables, overspend trigger, row-level security, realtime |
| `supabase/seed.sql` | The three partners and the categories (no transactions) |
| `lib/ledger.ts` | All the calculations (balances, totals, per partner, by category, by month, CSV) |
| `components/` | The four screens: Money in, Expenses, Summary, Settings |
| `tests/ledger.test.ts` | Calculation tests |
| `tests/passcode.test.ts` | Passcode cookie checks |
| `tests/db.test.ts` | Runs the real migration on in-memory Postgres to test the trigger and access rules |
| `supabase/migrations/20261026000000_passcode_mode.sql` | Lets the server's secret key rename categories |
| `app/actions.ts` | Server actions: every read and write, each checking the passcode cookie |
| `supabase/migrations/20261025000000_sheet_export.sql` | Read-only, key-protected export used by the Google Sheet |
| `supabase/migrations/20261106000000_company_account.sql` | Switches to the company bank account model: `money_in` (revenue or investment), bank and pocket expenses, the bank balance rule, and the new sheet export |
| `google-sheets/Code.gs` | Apps Script that copies the ledger into the Google Sheet every 5 minutes |
| `docs/` | The original build prompt and the single-page reference design |

## 1. Create the Supabase project

1. Sign in at [supabase.com](https://supabase.com) and click **New project**. Pick a region near Bangladesh (Mumbai or Singapore).
2. Apply the database. With the CLI: `npx supabase login`, `npx supabase link --project-ref YOUR-REF`, `npx supabase db push`, then `npx supabase db query --linked -f supabase/seed.sql`. Without it, paste each file in `supabase/migrations/` (in order), then `supabase/seed.sql`, into **SQL Editor** and run them.

No Supabase Auth setup is needed.

## 2. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SECRET_KEY=sb_secret_...      # Project Settings → API Keys → Secret key
APP_PASSCODE=your-passcode
```

All three are server-only. None has the `NEXT_PUBLIC_` prefix, so none of them is sent to the browser. Never commit `.env.local`. To sign every device out, change `APP_PASSCODE`.

## 3. Run locally

Needs Node.js 20 or newer.

```bash
npm install
npm run dev        # http://localhost:3000
npm test           # calculation and database tests
npm run build      # production build check
```

## 4. Deploy to Vercel

1. On [vercel.com](https://vercel.com), click **Add New → Project** and import this GitHub repo. Vercel detects Next.js.
2. Under **Environment Variables**, add `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `APP_PASSCODE`, with the same values as `.env.local`.
3. Click **Deploy**. Open the URL, enter the passcode, and pick who you're entering as (top right).

## 5. Using it

- **Entering as** (top right) sets the "Entered by" name on new entries. It's remembered per device and defaults to Jubair.
- **Lock this device** removes the unlock from that browser.
- Changes from another device appear within 20 seconds, or straight away when you switch back to the tab.

## 6. Copy everything into the Google Sheet

The app's database is the source of truth. A small script inside the Google Sheet copies everything into it every 5 minutes, even when nobody has the sheet open. The sheet is a read-only mirror: edits made in its Ledger tabs are overwritten on the next sync.

The script writes only these four tabs, creating them if they don't exist. It also deletes the old *Ledger – Money received* tab from the earlier layout:

| Tab | Contents |
| --- | --- |
| **Ledger – Revenue** | Every payment from a company, with note, entered by/at |
| **Ledger – Investment** | Every partner deposit and every expense a partner paid from their own pocket |
| **Ledger – Expenses** | Every company expense, with "Paid from" (Bank or the partner) |
| **Ledger – Summary** | Last-synced time, totals, revenue by company, investment by partner, by category, by month |

Every other tab in the spreadsheet is left alone.

**One-time setup** (done by whoever owns the spreadsheet):

1. Run the migration `supabase/migrations/20261025000000_sheet_export.sql` in the Supabase SQL editor. Skip this if you used `supabase db push`, which runs it for you.
2. In the SQL editor, run `select create_export_key();` and copy the long key it returns. It's shown only once.
3. Open the spreadsheet and go to **Extensions → Apps Script**.
4. Replace the contents of `Code.gs` with `google-sheets/Code.gs` from this repo, then click **Save**.
5. *(Recommended)* Under **Project Settings**, tick **Show "appsscript.json"**, then paste in `google-sheets/appsscript.json`. This sets the time zone to Dhaka and limits the script's permissions to this spreadsheet.
6. Reload the spreadsheet. A **CashFlow Log** menu appears.
7. Choose **CashFlow Log → Set up sync…** and approve the Google permissions it asks for. Then paste three values:
   - the Supabase URL
   - the publishable key (starts with `sb_publishable_`)
   - the export key
8. Choose **CashFlow Log → Turn on auto-sync**.
9. Set **File → Settings → Time zone** to *(GMT+06:00) Dhaka* so the "Entered at" times display correctly.

**Using it**

- Use **CashFlow Log → Sync now** any time you want it refreshed immediately.
- If a sync fails, cell A1 of *Ledger – Summary* says so in red, and the last good numbers stay. Google also emails the script owner about repeated failures.
- **After updating the app's database** (for example the company bank account change), paste the latest `google-sheets/Code.gs` into Apps Script again, save, and choose **Sync now**. The export key and settings stay the same.
- **If the export key leaks:** run `delete from export_keys;` then `select create_export_key();`, and enter the new key under **Set up sync…**. The key can only read the ledger, never change it.

## How the rules are enforced

| Rule | In the app | In the database |
| --- | --- | --- |
| A bank expense can't be more than the bank balance | Checked before saving, with the "Only ৳X is in the bank account…" message | `check_bank_expense` trigger takes one lock for every balance check, so two partners saving at once can't both overspend |
| Money in can't be deleted if the bank balance would go below ৳0 | Delete button explains why | `check_money_in_change` trigger |
| Revenue has a company name; investment has a partner | Form check and server check | `money_in_source_check` constraint |
| Bank expenses have no partner; pocket expenses do | Set by the form | `expenses_paid_by_check` constraint |
| Who entered it | Shown as "Entered by", from the device's "Entering as" choice | `created_by` and `created_at` set on insert and can't be changed afterwards |
| Only you can read/write | Passcode required; data only flows through the server | Row-level security on every table: the public key sees nothing |

Entries are never edited, only added or deleted. To fix a mistake, delete the entry and log it again.
