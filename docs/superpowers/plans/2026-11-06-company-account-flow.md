# Company Bank Account Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the partner-to-partner receipt model with one company bank account: money in is Revenue (from a named company) or Investment (from a partner); expenses are paid from the bank (capped by balance) or by a partner's pocket (also counted as their investment).

**Architecture:** One new SQL migration reshapes `receipts`→`money_in` and `expenses` in place, swaps the per-receipt overspend trigger for a bank-balance trigger, converts the live row to Taj Consultancy revenue, and rewrites `ledger_export`. Pure calculations in `lib/ledger.ts`, server actions in `app/actions.ts`, and four tab components follow. The Apps Script is updated for the new export shape.

**Tech Stack:** Next.js 15 App Router, TypeScript, Tailwind, Supabase Postgres, Vitest + PGlite, Google Apps Script.

**Spec:** `docs/superpowers/specs/2026-11-06-company-account-flow-design.md`

## Global Constraints

- Amounts in BDT, summed in paisa; displayed with `formatBDT` (Indian grouping).
- The browser never talks to the database; every action calls `guard()` and uses the server-only secret key.
- Company name: required for revenue, trimmed, 1–80 chars. Partner required for investment.
- Bank overspend copy: "Only ৳X is in the bank account. Log the rest as paid by a partner, or log money in first."
- Money-in delete refusal copy: "Can't delete: the bank balance would go below ৳0. Delete some bank expenses first."
- Tabs: Money in (`#in`), Expenses (`#expenses`), Summary (`#summary`), Settings (`#settings`); `#received`→`#in`, `#direct`→`#expenses`.
- No opening balance.

## Review Focus

1. Two bank expenses logged at once that together exceed the balance: the second must be rejected (advisory lock). Test: db test inserting up to exactly the balance, then one more paisa rejected.
2. Changing an expense from `partner` to `bank` (update) must pass through the bank check. Test: db test updating source to `bank` beyond balance is rejected.
3. "Taj Consultancy" vs "taj consultancy " must group as one company in revenue-by-company and suggestions. Test: ledger test.
4. Deleting a pocket (`partner`) expense or a revenue entry that leaves the balance ≥ 0 must succeed; only the going-negative case is blocked. Test: db test.
5. Investment form with no partner / revenue form with blank company must be rejected server-side, not only in the browser. Test: db constraint test (actions validate too).

---

### Task 1: Database migration and db tests

**Files:**
- Create: `supabase/migrations/20261106000000_company_account.sql`
- Modify: `tests/db.test.ts`

**Interfaces:**
- Produces: table `money_in(id, date, kind 'revenue'|'investment', partner_id uuid null, company text null, amount, note, created_by, created_at)`; `expenses(id, paid_by uuid null, date, category, amount, note, source expense_source 'bank'|'partner', created_by, created_at)`; functions `check_bank_expense()` / `check_money_in_change()` raising `OVERSPEND:<balance before change>` (errcode P0001); `ledger_export(key)` returning `{generated_at, totals:{bank,revenue,investment,expenses}, revenue:[[date,company,amount,note,entered_by,entered_at,id]], investment:[[date,partner,how,category,amount,note,entered_by,entered_at,id]], expenses:[[date,paid_from,category,amount,note,entered_by,entered_at,id]], companies:[[company,amount]], partners:[[name,deposits,pocket,total]], categories:[[category,amount]], months:[[YYYY-MM,revenue,investment,expenses]]}`.

- [ ] **Step 1: Write failing db tests.** Restructure `beforeAll` to apply all migrations *except* `20261106…`, seed, insert one old-format receipt (Azharul→Jubair, `2026-11-01`, 150000, note 'Oct staff'), then apply the new migration. Tests:
  - `converts the existing receipt to Taj Consultancy revenue`: one `money_in` row, `kind='revenue'`, `company='Taj Consultancy'`, `partner_id` null, amount 150000, date `2026-11-01`, note `'Oct staff'`.
  - `enforces kind/partner/company`: investment without partner rejected; revenue without company rejected; revenue with blank `'  '` company rejected; investment with company rejected.
  - `bank expense up to exactly the balance is allowed, one paisa more is rejected` (message matches `/OVERSPEND:/`).
  - `partner (pocket) expenses are never blocked by the balance`; `bank` expense requires `paid_by` null, `partner` requires it.
  - `updating an expense from partner to bank beyond the balance is rejected`.
  - `deleting money in that would make the balance negative is rejected; deleting when it stays ≥ 0 succeeds`.
  - Existing RLS tests: anon and stranger see 0 rows of `money_in`/`expenses`.
  - `ledger_export returns the new shape` with correct totals.
  Delete the old receipt/overspend/delete-guard tests that no longer apply.

- [ ] **Step 2: Run** `npx vitest run tests/db.test.ts` — Expected: FAIL (table `money_in` missing).

- [ ] **Step 3: Write the migration.** Order: drop old triggers and functions (`expenses_within_receipt`, `receipts_not_below_spent`, their functions); rename table and column; add `kind`, `company`; `update money_in set kind='revenue', company='Taj Consultancy', partner_id=null`; drop `to_partner`, constraint `receipts_sender_differs`; add checks; rename enum values; drop `receipt_id` (and index); `paid_by` drop not null; `update expenses set paid_by=null where source='bank'`; add source/paid_by check; create row-level **BEFORE** triggers, each first taking `pg_advisory_xact_lock(20261106)`. `check_bank_expense()` on `expenses` insert/update: when `new.source='bank'`, `available = sum(money_in) − sum(bank expenses where id <> new.id)`; if `new.amount > available` raise `OVERSPEND:<available>`. `check_money_in_change()` on `money_in` update/delete: `after = current bank − old.amount + (new.amount on update, 0 on delete)`; if `after < 0` raise `OVERSPEND:<current bank>`. The function returns `old` on delete, `new` otherwise. Rewrite `ledger_export` to the produced shape. Keep `revoke/grant` lines as in the old export.

- [ ] **Step 4: Run** `npx vitest run tests/db.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Reshape the database around the company bank account"`

### Task 2: Calculations

**Files:**
- Modify: `lib/ledger.ts`, `tests/ledger.test.ts`

**Interfaces:**
- Produces:
  - `type Kind = "revenue" | "investment"; type Source = "bank" | "partner";`
  - `interface MoneyIn { id; date; kind: Kind; partner_id: string|null; company: string|null; amount: number; note; created_by: string|null; created_at }`
  - `interface Expense { id; paid_by: string|null; date; category; amount; note; source: Source; created_by; created_at }`
  - `totals(moneyIn, expenses): { revenue, deposits, pocket, investment, expenses, bankSpent, bank }`
  - `checkBankExpense(bank: number, amount: number): {ok:true}|{ok:false; message:string}`
  - `bankOverspendMessage(bank: number): string`
  - `partnerInvestment(partners, moneyIn, expenses): { partner; deposits; pocket; total }[]` (partner order)
  - `revenueByCompany(moneyIn): { company; amount }[]` (largest first; case-insensitive trimmed grouping; display the most recent spelling)
  - `companyNames(moneyIn): string[]` (distinct, most recent first)
  - `byCategory(expenses)` unchanged; `byMonth(moneyIn, expenses): { month; revenue; investment; expenses }[]`
  - `toCSV(moneyIn, expenses, partnerName): string` columns `Record, Date, From / Paid by, Category, Note, Amount (BDT), Entered by, Entered at`; Record values `Revenue`, `Investment`, `Expense (bank)`, `Expense (paid by partner)`
  - `friendlyDbError(message, context?: "delete-money-in")` → bank overspend copy, or the delete copy when context given
  - Remove: `Receipt`, `ReceiptBalance`, `receiptBalances`, `openReceipts`, `checkExpense`, `overspendMessage`, `partnerTotals`, `receiptLabel`.

- [ ] **Step 1: Rewrite tests** with fixtures: Taj revenue 150000 (`2026-11-01`), "taj consultancy " revenue 50000 (`2026-12-01`), Jubair deposit 15000, bank expense 30000 Staff salary, Jubair pocket 5000 Subscriptions, Towfiq pocket 5000 Technology. Assert: `totals` → revenue 200000, deposits 15000, pocket 10000, investment 25000, expenses 40000, bankSpent 30000, bank 185000; `checkBankExpense(185000, 185000).ok` true, `(185000, 185000.01).ok` false with message `"Only ৳1,85,000 is in the bank account. Log the rest as paid by a partner, or log money in first."`; `partnerInvestment` Jubair `{deposits:15000,pocket:5000,total:20000}`, Azharul all 0; `revenueByCompany` → `[{company:"taj consultancy", amount:200000}]` (most recent spelling, trimmed); `byMonth` Nov row `{revenue:150000, investment:25000, expenses:40000}` when all non-Dec entries dated Nov; CSV header and row count; `friendlyDbError("OVERSPEND:100")` bank copy with ৳100; keep formatting tests.

- [ ] **Step 2: Run** `npx vitest run tests/ledger.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement** the produced functions in `lib/ledger.ts`.

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "Rewrite ledger calculations for the bank account model"`

### Task 3: Server actions and screens

**Files:**
- Modify: `app/actions.ts`, `components/Ledger.tsx`, `components/SummaryTab.tsx`
- Create: `components/MoneyInTab.tsx`, `components/ExpensesTab.tsx`
- Delete: `components/ReceivedTab.tsx`, `components/DirectTab.tsx`

**Interfaces:**
- Consumes: Task 2 functions and types.
- Produces: `LedgerSnapshot { partners; categories; moneyIn: MoneyIn[]; expenses; actingAs }`; `addMoneyIn({kind, partnerId?, company?, date, amount, note}): Promise<Result>`; `addExpense({source, paidBy?, date, category, amount, note}): Promise<Result>`; `deleteRecord(table: "money_in"|"expenses", id): Promise<Result>` (passes `"delete-money-in"` context to `friendlyDbError` for money_in); `LedgerData.moneyIn` replaces `receipts`.

- [ ] **Step 1: Actions.** Update as above; server-side validation: revenue needs a non-empty trimmed company (≤80), investment needs a partner id present in `partners`; bank expense sends `paid_by: null`, partner expense requires `paidBy`.
- [ ] **Step 2: Screens** per the spec's Screens section: totals bar (Bank balance, Revenue, Partner investment, Company expenses), header subtitle copy, tab ids/hash aliases, two-button toggles (`aria-pressed`), company `<datalist>` from `companyNames`, bank-balance hint, Staff × rate helper moved into the expense form, lists with `DeleteButton`, Summary sections and CSV.
- [ ] **Step 3: Verify** `npx tsc --noEmit` exit 0; `npx vitest run` all pass; `npm run build` succeeds.
- [ ] **Step 4: Commit** `git commit -m "Switch the screens to money in and company expenses"`

### Task 4: Google Sheet sync and README

**Files:**
- Modify: `google-sheets/Code.gs`, `README.md`

- [ ] **Step 1:** `TABS = { revenue: "Ledger – Revenue", investment: "Ledger – Investment", expenses: "Ledger – Expenses", summary: "Ledger – Summary" }`; writers for each array from Task 1's export shape (money and date formats as today); `syncLedger` deletes the sheet `"Ledger – Money received"` if present; Summary blocks: totals, companies, partners (Deposits, Paid from pocket, Total investment), categories, months (Revenue, Investment, Expenses).
- [ ] **Step 2:** README: describe the new model (replace the three-records list), project-layout rows for the new migration and tab files, and a note that `Code.gs` must be pasted again after this change.
- [ ] **Step 3: Verify** `node --check` can't parse `.gs`; instead copy to a temp `.js` in the scratchpad and run `node --check` on it — Expected: no output, exit 0.
- [ ] **Step 4: Commit** `git commit -m "Update the Google Sheet sync for the new ledger"`

### Task 5: Rollout (needs the user's OK at step 1)

- [ ] **Step 1:** Ask the user, then `npx supabase db push` against the linked project. Verify with a read-only count: one `money_in` row, kind revenue, company Taj Consultancy.
- [ ] **Step 2:** `vercel deploy --prod --yes`; check `/` → 307 to `/unlock`, and no runtime errors.
- [ ] **Step 3:** Push to GitHub; give the user the steps to paste `Code.gs` and run Sync now.
