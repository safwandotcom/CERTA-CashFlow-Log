# CERTA& Advisory CashFlow Log — build prompt for Claude Code

Copy everything below the line into Claude Code (in VS Code, open an empty folder first). If you also put `partner-ledger.html` in that folder, Claude Code can use it as the reference for the screens and logic.

---

Build a small web app called **CERTA& Advisory CashFlow Log**: a shared expense ledger for a three-partner business in Bangladesh. All amounts are in BDT (৳), shown with Indian digit grouping (৳1,23,456).

## The business process (this is the source of truth)

There are three partners:
- **Azharul Islam** sends money each month to cover staff salaries, staff operational cost (৳5,000 per staff, currently 3 staff) and office rent.
- **Jubair Eusuf** receives that money, pays those expenses, and keeps the books.
- **Sarker Towfiq Pritom** pays subscriptions and technology expenses from his own pocket.

The app records only three kinds of transaction:

1. **Money received**: someone logs an amount when he receives it. Fields: date received, sent by (partner), received by (partner, must differ from sent by), amount, note.
2. **Expense paid from money received**: each expense is logged against the specific receipt it was paid from. Fields: which receipt it was paid from, date paid, category, amount, note. The paying partner is the receipt's receiver.
   - An expense can't exceed what is left on that receipt. If it does, show: "Only ৳X is left from this money. Log the rest from another receipt, or under Paid by partners."
   - For category "Staff operational cost", offer a helper: staff count × rate per head (defaults 3 × 5,000) that fills the amount.
   - A receipt that has expenses under it can't be deleted until its expenses are deleted.
3. **Paid by partners**: an expense a partner pays directly from his own money. Fields: date paid, paid by (partner), category, amount, note.

There is no capital, sales, withdrawals, profit-sharing or settle-up. Don't add them.

Categories (editable list in settings): Staff salary, Staff operational cost, Office rent, Subscriptions, Technology, Utilities & internet, Office supplies, Licences & fees, Marketing, Other.

## Calculations

- Each receipt: amount, spent (sum of its expenses), left = amount − spent.
- Totals: money received, spent from it, left in hand, paid by partners.
- Per partner: money sent (receipts where he is the sender), paid directly, total contributed = sent + paid directly. For a partner who receives money, also show spent from money received and still holding.
- Expenses by category, combining expenses from received money and partner payments.
- By month: received, spent, paid by partners.

## Screens

1. **Money received**: two forms side by side (stacked on phones): "Step 1 · Log money received" and "Step 2 · Log an expense from it". The "Paid from" dropdown lists only receipts with money left, newest first, e.g. "1 Nov 2026 · ৳60,000 from Azharul Islam · ৳5,000 left". Below the forms, a card for each receipt, newest first, with a progress bar, its expenses and spent/left.
2. **Paid by partners**: a form plus a table (date, paid by, details, amount, entered by, delete).
3. **Summary**: partner cards, category breakdown, monthly table, and CSV export of everything.
4. **Settings**: partner names and categories.

Every record stores who entered it and when, and shows "Entered by". Deleting asks for an inline confirmation (no browser `confirm()`).

The app must work well on a phone, since Jubair will mostly enter data from his phone.

## Users and access

- Each partner signs in with email (magic link or Google).
- All three partners can add and delete entries. Optionally, an owner role (Towfiq) manages partner names and categories.
- Data is shared live: an entry one partner adds appears for the others without a reload.

## Tech stack

Unless I say otherwise, use:
- **Next.js (App Router) + TypeScript + Tailwind**
- **Supabase** for auth, Postgres and realtime, with row-level security so only the three invited partners can read or write.
- Deploy on **Vercel** (free tier).

Tables:
- `partners` (id, name, email, role)
- `receipts` (id, date, from_partner, to_partner, amount numeric(12,2), note, created_by, created_at)
- `expenses` (id, receipt_id FK nullable, paid_by, date, category, amount, note, created_by, created_at, source enum: 'receipt' | 'direct')
- `categories` (id, name, sort)

Enforce "expense ≤ amount left on receipt" in the database too, with a trigger or check function, not only in the UI.

## How to work

1. Show me the plan and the database schema (as a SQL migration) before writing the app.
2. Seed the three partners and the categories. Don't seed fake transactions.
3. Write a README with step-by-step setup: creating the Supabase project, env vars, running locally, deploying to Vercel, and inviting the partners.
4. Add tests for the calculations (receipt left, per-partner totals, monthly totals) and the overspend rule.
5. When done, give me a short checklist to verify it myself.
