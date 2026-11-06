# Company bank account flow: design

**Date:** 2026-11-06 · **Status:** approved to build

## Why

The app models money as moving between partners: one partner sends money to another, who then spends it, and every expense is tied to the receipt it came from. That no longer matches how CERTA& Advisory works. All money now goes into **the CERTA& Advisory company bank account**, and expenses are paid from that account. Some money also comes from client companies rather than partners. For example, Taj Consultancy pays CERTA& Advisory for staff it supplies them. The ledger should show the company's money: what came in, from whom, what went out, and the bank balance.

## The model (decided with the user)

**Money in** always lands in the company bank account and has one of two sources:

| Source | Recorded as | Who it's credited to |
|---|---|---|
| A partner deposits their own money | **Investment** | That partner |
| Another company pays CERTA& Advisory (a client) | **Revenue** | That company, by typed name, e.g. "Taj Consultancy" |

**Money out** is always a **company expense**, paid one of two ways:

| Paid by | Effect |
|---|---|
| The company bank account | Lowers the bank balance. **It can't be more than the current bank balance.** |
| A partner, from their own pocket | Counts as a company expense **and** as that partner's Investment. The bank balance doesn't change. |

There is **one bank balance**: total money in (revenue + partner deposits) minus expenses paid from the bank. Expenses are no longer linked to a particular deposit. **There is no opening balance.** The user confirmed the account starts from the Taj Consultancy payment.

## Goals

- Money in form: "Where did it come from?" → **A company (Revenue)** with a typed company name, or **A partner (Investment)** with a partner dropdown.
- Expense form: "Who paid?" → **Company bank account** or **A partner, from own pocket** (partner dropdown).
- Totals at the top: **Bank balance**, **Revenue**, **Partner investment** (deposits + pocket payments), **Company expenses** (bank + pocket).
- Summary: **Revenue by company**, **Investment by partner** (showing deposit and pocket parts), **Expenses by category**, **By month**, and CSV export.
- Convert the one existing live record (logged as money sent from Azharul) into **Revenue from Taj Consultancy**, keeping its date, amount and note.
- Update the Google Sheet sync to the new model.

## Non-goals

- No client list or client management screen. Company names are free text, with names used before offered as suggestions.
- No invoices, accounts receivable, or partner withdrawals or payouts.
- No changes to the passcode, the "Entering as" picker, partner names, categories, or the Settings screen.
- No ownership percentages or profit split.

## Anti-goals (would count as failure even if it works)

- Client revenue showing up as a partner's investment, or the other way round.
- A bank-paid expense being accepted when the bank doesn't have the money, including when two people log at the same moment.
- A partner's pocket payment changing the bank balance.
- Losing or changing the amount or date of the existing Taj Consultancy record.

## Screens

The tabs become **Money in · Expenses · Summary · Settings**. The URL hashes are `#in`, `#expenses`, `#summary` and `#settings`. The old hashes `#received` and `#direct` map to the new tabs.

The header subtitle changes to: "Log money coming into the CERTA& Advisory bank account, and every company expense, whether it's paid from the bank or by a partner."

**Money in tab**
- The form "Log money into the bank account" has a two-button choice, **A company (Revenue)** and **A partner (Investment)**. Company is the default because that's the current real case.
  - Company: a text field "Company name", required, up to 80 characters, with a `<datalist>` of company names already used.
  - Partner: a "Partner" dropdown.
  - Then Amount (৳), Date received (default today), and Note (optional).
- Below the form is a list of every money-in entry, newest first: date, type badge (Revenue or Investment), source (company name, or partner with their colour dot), note, amount, entered by, and delete. It ends with a count and total line.
- Deleting a money-in entry is refused if it would take the bank balance below zero. The message: "Can't delete: the bank balance would go below ৳0. Delete some bank expenses first."

**Expenses tab**
- The form "Log a company expense" has a two-button choice, **Company bank account** (default) and **A partner, from own pocket**. Choosing the partner option reveals a "Partner" dropdown.
  - Category, the Staff × rate helper for "Staff operational cost" (kept from today's form), Amount, Date paid, and Note.
  - When paying from the bank, a hint shows "Bank balance: ৳X available". The amount is checked against it before sending, and again by the database.
  - Overspend message: "Only ৳X is in the bank account. Log the rest as paid by a partner, or log money in first."
- Below the form is a list of every expense, newest first: date, paid from (Bank, or partner with dot), category and note, amount, entered by, and delete. It ends with a count and total line.

**Summary tab**
- **Investment by partner:** one card per partner, showing deposits, paid from pocket, and total investment.
- **Revenue by company:** each company name with its total, largest first.
- **Expenses by category:** both payment methods combined, as today.
- **By month:** Month, Revenue, Investment, Expenses (all), newest first.
- **Export everything as CSV.**

## Data

A new migration `supabase/migrations/20261106000000_company_account.sql` reshapes the existing tables in place.

- `receipts` is renamed to **`money_in`**.
  - Add `kind text not null check (kind in ('revenue','investment'))`.
  - `from_partner` is renamed to `partner_id` and becomes nullable.
  - Add `company text` (nullable, 1–80 characters after trim).
  - Drop `to_partner` and the sender-differs constraint.
  - Constraint: `(kind='investment' and partner_id is not null and company is null) or (kind='revenue' and company is not null and partner_id is null)`.
  - Existing rows: **all existing rows become `kind='revenue', company='Taj Consultancy', partner_id=null`**. The live database has exactly one row, which the user confirmed is the Taj payment. Date, amount, note, created_by and created_at stay unchanged.
- `expenses`:
  - Enum `expense_source` values are renamed: `'receipt'` becomes **`'bank'`** and `'direct'` becomes **`'partner'`**.
  - Drop `receipt_id` and its index.
  - `paid_by` becomes nullable. Constraint: `(source='bank' and paid_by is null) or (source='partner' and paid_by is not null)`. Existing `'receipt'` expenses (there are none live) get `paid_by=null`.
- Triggers:
  - Drop the receipt-based ones: `check_expense_within_receipt` and `check_receipt_not_below_spent`.
  - New bank rule `check_bank_balance()`: a statement that would leave `sum(money_in) − sum(expenses where source='bank') < 0` is rejected with `raise exception 'OVERSPEND:<balance before this change>'`. It runs on insert or update of `expenses` (when the row is or becomes `bank`) and on update or delete of `money_in`. It takes `pg_advisory_xact_lock(<fixed key>)` first, so concurrent writes are serialised.
  - Keep `stamp_created_by` on both tables (re-point it at the renamed table).
- RLS policies and the realtime publication follow the renamed table automatically. Re-check this in the db tests.
- `ledger_export(key)` is rewritten for the new shape. See Sheet sync.

`lib/ledger.ts` types change to match: `MoneyIn {id, date, kind, partner_id, company, amount, note, created_by, created_at}`, and `Expense` without `receipt_id`, with `source: 'bank'|'partner'` and `paid_by: string|null`.

## Calculations (`lib/ledger.ts`, pure and tested; money summed in paisa as today)

- `totals(moneyIn, expenses)` returns `{ revenue, deposits, pocket, investment = deposits + pocket, expenses = all, bankSpent, bank = revenue + deposits − bankSpent }`.
- `checkBankExpense(bank, amount)` is the client-side version of the trigger.
- `partnerInvestment(partners, moneyIn, expenses)` returns `[{ partner, deposits, pocket, total }]`.
- `revenueByCompany(moneyIn)` returns `[{ company, amount }]`, largest first. Company names group case-insensitively after trimming and display the most recent spelling.
- `byCategory(expenses)` stays the same.
- `byMonth(moneyIn, expenses)` returns `[{ month, revenue, investment, expenses }]`. Pocket payments count in both investment and expenses for their month.
- `companyNames(moneyIn)` returns distinct names for the datalist, most recent first.
- `toCSV` has the columns: Record (Revenue · Investment · Expense (bank) · Expense (paid by partner)), Date, From / Paid by, Category, Note, Amount (BDT), Entered by, Entered at. Rows are oldest first.
- `friendlyDbError` maps `OVERSPEND:x` to the bank overspend message (or the delete message, depending on context) and keeps the RLS mapping. Drop the receipt foreign-key message.

## Server actions (`app/actions.ts`)

- `loadLedger` reads `money_in` instead of `receipts`. The snapshot field becomes `moneyIn`.
- `addMoneyIn({ kind, partnerId?, company?, date, amount, note })` validates kind and requires the matching field. The company name is trimmed to 80 characters.
- `addExpense({ source: 'bank'|'partner', paidBy?, date, category, amount, note })` sends `paid_by` only for `partner`.
- `deleteRecord(table: 'money_in'|'expenses', id)`.
- Everything still goes through `guard()` and the server-only secret key.

## Sheet sync

The Google Sheet gets these tabs:

- **Ledger – Revenue:** Date, Company, Amount, Note, Entered by, Entered at, ID.
- **Ledger – Investment:** Date, Partner, How (Deposit or Paid from pocket), Category (pocket only), Amount, Note, Entered by, Entered at, ID.
- **Ledger – Expenses:** Date, Paid from (Bank or partner name), Category, Amount, Note, Entered by, Entered at, ID.
- **Ledger – Summary:** totals (Bank balance, Revenue, Partner investment, Company expenses), revenue by company, investment by partner, categories, months.

`ledger_export` returns those arrays. `Code.gs` deletes the obsolete tab "Ledger – Money received" if it exists, and never touches other tabs.

The Apps Script has to be pasted in again by hand after deploy. The export key and script properties stay the same.

## Rollout order

1. Build and test locally: unit tests, plus the PGlite db test running every migration in order.
2. **Apply the migration to the live Supabase project.** This changes production, so it needs the user's explicit OK at that moment.
3. Deploy to Vercel production straight away. The old app breaks once the migration runs, so keep the gap to minutes.
4. The user pastes the new `Code.gs` into the sheet's Apps Script and runs "Sync now".

## Tests

- `tests/ledger.test.ts`: rewrite for the new calculations. Cover totals, the bank check (exact balance allowed, one paisa over rejected), investment by partner including pocket, revenue grouping by company name, by month, and CSV.
- `tests/db.test.ts`: run all migrations, then cover:
  - The kind/partner/company constraint.
  - The bank trigger: allowed at exactly the balance, rejected above it, pocket expenses never blocked.
  - A money-in delete refused when it would go negative.
  - The conversion of a pre-existing receipt into Taj Consultancy revenue with the same amount and date. Insert an old-format receipt before applying the new migration.
  - RLS and anon still see nothing.
  - `ledger_export` shape.

## Calls made by the builder (Claude), not the user

- The table is renamed `money_in`, and the enum values become `bank` and `partner`.
- Company names are free text with suggestions. There's no clients table.
- Both payment choices are two-button toggles. Company is the default for money in and the bank for expenses.
- Deleting money in is blocked if the balance would go negative.
- Sheet tabs: Revenue, Investment, Expenses, Summary.
- The Staff × rate helper is kept.
- The tab names and URL hashes listed above.
