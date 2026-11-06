// Pure ledger calculations. No I/O, so everything here is unit-tested.
// Money is summed in paisa (integers) to avoid floating-point drift.
//
// Model: all money goes into the CERTA& Advisory bank account.
//   Money in: revenue (from another company) or investment (from a partner).
//   Expenses: paid from the bank, or by a partner from their own pocket
//   (a pocket payment is also that partner's investment and never touches the bank).

export type Role = "owner" | "partner";
export type Kind = "revenue" | "investment";
export type Source = "bank" | "partner";

export interface Partner {
  id: string;
  name: string;
  email: string;
  role: Role;
  sort: number;
}

export interface Category {
  id: string;
  name: string;
  sort: number;
}

export interface MoneyIn {
  id: string;
  date: string; // YYYY-MM-DD
  kind: Kind;
  partner_id: string | null; // investment only
  company: string | null; // revenue only
  amount: number;
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  paid_by: string | null; // partner for pocket payments, null for the bank
  date: string;
  category: string;
  amount: number;
  note: string;
  source: Source;
  created_by: string | null;
  created_at: string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const toPaisa = (n: number) => Math.round((Number(n) || 0) * 100);
export const fromPaisa = (p: number) => p / 100;
const sum = <T>(xs: T[], f: (x: T) => number) => fromPaisa(xs.reduce((a, x) => a + toPaisa(f(x)), 0));

/** Indian digit grouping: 1234567 → "12,34,567". */
function groupIndian(int: string) {
  if (int.length <= 3) return int;
  const last3 = int.slice(-3);
  const rest = int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ",");
  return `${rest},${last3}`;
}

/** ৳1,23,456 — paisa shown only when there are any. */
export function formatBDT(n: number): string {
  const p = toPaisa(n);
  const neg = p < 0;
  const abs = Math.abs(p);
  const whole = groupIndian(String(Math.floor(abs / 100)));
  const frac = abs % 100;
  return `${neg ? "−" : ""}৳${whole}${frac ? "." + String(frac).padStart(2, "0") : ""}`;
}

/** Group digits as the user types: "123456" → "1,23,456". Keeps a decimal part. */
export function groupInput(raw: string): string {
  const clean = raw.replace(/[^\d.]/g, "");
  if (!clean) return "";
  const [int, ...rest] = clean.split(".");
  const grouped = groupIndian(int.replace(/^0+(?=\d)/, ""));
  return rest.length ? `${grouped}.${rest.join("").slice(0, 2)}` : grouped;
}

/** Parse what someone typed ("60,000", "৳ 4,500.50") into a number, or NaN. */
export function parseAmount(raw: string): number {
  const clean = String(raw ?? "").replace(/[^\d.]/g, "");
  if (!clean || (clean.match(/\./g) || []).length > 1) return NaN;
  return Math.round(parseFloat(clean) * 100) / 100;
}

export function formatDate(d: string): string {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${+dd} ${MONTHS[+m - 1]} ${y}`;
}

export function formatMonth(ym: string): string {
  return `${MONTHS[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`;
}

type Dated = { date: string; created_at: string };
const oldestFirst = (a: Dated, b: Dated) => a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);
export const newestFirst = (a: Dated, b: Dated) => oldestFirst(b, a);

// ---------------------------------------------------------------------------
// Bank rule
// ---------------------------------------------------------------------------

export function bankOverspendMessage(bank: number): string {
  return `Only ${formatBDT(bank)} is in the bank account. Log the rest as paid by a partner, or log money in first.`;
}

export const DELETE_MONEY_IN_MESSAGE = "Can't delete: the bank balance would go below ৳0. Delete some bank expenses first.";

/** The bank rule for an expense paid from the bank. Mirrors the database trigger. */
export function checkBankExpense(bank: number, amount: number): { ok: true } | { ok: false; message: string } {
  if (!(amount > 0)) return { ok: false, message: "Enter the amount paid." };
  if (toPaisa(amount) > toPaisa(bank)) return { ok: false, message: bankOverspendMessage(Math.max(0, bank)) };
  return { ok: true };
}

/** Turn a database error into something a partner can act on. */
export function friendlyDbError(message: string | undefined, context?: "delete-money-in"): string {
  const m = /OVERSPEND:(-?[\d.]+)/.exec(message ?? "");
  if (m) return context === "delete-money-in" ? DELETE_MONEY_IN_MESSAGE : bankOverspendMessage(Math.max(0, Number(m[1])));
  if (/row-level security/i.test(message ?? "")) return "You don't have permission to do that.";
  return "Couldn't save. Check your connection and try again.";
}

// ---------------------------------------------------------------------------
// Totals and summaries
// ---------------------------------------------------------------------------

export interface Totals {
  revenue: number;
  deposits: number;
  pocket: number;
  /** deposits + pocket */
  investment: number;
  /** every expense, bank and pocket */
  expenses: number;
  bankSpent: number;
  /** revenue + deposits − bankSpent */
  bank: number;
}

export function totals(moneyIn: MoneyIn[], expenses: Expense[]): Totals {
  const revenue = toPaisa(sum(moneyIn.filter((m) => m.kind === "revenue"), (m) => m.amount));
  const deposits = toPaisa(sum(moneyIn.filter((m) => m.kind === "investment"), (m) => m.amount));
  const pocket = toPaisa(sum(expenses.filter((e) => e.source === "partner"), (e) => e.amount));
  const bankSpent = toPaisa(sum(expenses.filter((e) => e.source === "bank"), (e) => e.amount));
  return {
    revenue: fromPaisa(revenue),
    deposits: fromPaisa(deposits),
    pocket: fromPaisa(pocket),
    investment: fromPaisa(deposits + pocket),
    expenses: fromPaisa(pocket + bankSpent),
    bankSpent: fromPaisa(bankSpent),
    bank: fromPaisa(revenue + deposits - bankSpent),
  };
}

export interface PartnerInvestment {
  partner: Partner;
  deposits: number;
  pocket: number;
  total: number;
}

export function partnerInvestment(partners: Partner[], moneyIn: MoneyIn[], expenses: Expense[]): PartnerInvestment[] {
  return partners.map((partner) => {
    const deposits = sum(moneyIn.filter((m) => m.kind === "investment" && m.partner_id === partner.id), (m) => m.amount);
    const pocket = sum(expenses.filter((e) => e.source === "partner" && e.paid_by === partner.id), (e) => e.amount);
    return { partner, deposits, pocket, total: fromPaisa(toPaisa(deposits) + toPaisa(pocket)) };
  });
}

const companyKey = (name: string | null) => (name ?? "").trim().toLowerCase();

/** Revenue grouped by company (case and spaces ignored), latest spelling shown, largest first. */
export function revenueByCompany(moneyIn: MoneyIn[]): { company: string; amount: number }[] {
  const map = new Map<string, { company: string; paisa: number }>();
  for (const m of moneyIn.filter((x) => x.kind === "revenue").sort(newestFirst)) {
    const k = companyKey(m.company);
    const row = map.get(k) ?? { company: (m.company ?? "").trim(), paisa: 0 };
    row.paisa += toPaisa(m.amount);
    map.set(k, row);
  }
  return [...map.values()]
    .map((r) => ({ company: r.company, amount: fromPaisa(r.paisa) }))
    .sort((a, b) => b.amount - a.amount || a.company.localeCompare(b.company));
}

/** Company names used before, for suggestions. Each once, most recent first. */
export function companyNames(moneyIn: MoneyIn[]): string[] {
  const seen = new Map<string, string>();
  for (const m of moneyIn.filter((x) => x.kind === "revenue").sort(newestFirst)) {
    const k = companyKey(m.company);
    if (k && !seen.has(k)) seen.set(k, (m.company ?? "").trim());
  }
  return [...seen.values()];
}

/** Expenses by category, both payment methods combined, largest first. */
export function byCategory(expenses: Expense[]): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + toPaisa(e.amount));
  return [...map]
    .map(([category, p]) => ({ category, amount: fromPaisa(p) }))
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export interface MonthRow {
  month: string; // YYYY-MM
  revenue: number;
  investment: number;
  expenses: number;
}

/** Revenue, investment (deposits + pocket) and all expenses per month. Newest month first. */
export function byMonth(moneyIn: MoneyIn[], expenses: Expense[]): MonthRow[] {
  const map = new Map<string, { revenue: number; investment: number; expenses: number }>();
  const bump = (date: string, key: "revenue" | "investment" | "expenses", amount: number) => {
    const m = date.slice(0, 7);
    const row = map.get(m) ?? { revenue: 0, investment: 0, expenses: 0 };
    row[key] += toPaisa(amount);
    map.set(m, row);
  };
  moneyIn.forEach((m) => bump(m.date, m.kind === "revenue" ? "revenue" : "investment", m.amount));
  expenses.forEach((e) => {
    bump(e.date, "expenses", e.amount);
    if (e.source === "partner") bump(e.date, "investment", e.amount);
  });
  return [...map]
    .map(([month, r]) => ({ month, revenue: fromPaisa(r.revenue), investment: fromPaisa(r.investment), expenses: fromPaisa(r.expenses) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

/** Every record as CSV, oldest first. */
export function toCSV(moneyIn: MoneyIn[], expenses: Expense[], partnerName: (id: string | null) => string): string {
  type Row = Dated & { cells: (string | number)[] };
  const rows: Row[] = [
    ...moneyIn.map((m) => ({
      date: m.date,
      created_at: m.created_at,
      cells: [
        m.kind === "revenue" ? "Revenue" : "Investment",
        m.date,
        m.kind === "revenue" ? (m.company ?? "") : partnerName(m.partner_id),
        "",
        m.note,
        m.amount.toFixed(2),
        partnerName(m.created_by),
        m.created_at,
      ],
    })),
    ...expenses.map((e) => ({
      date: e.date,
      created_at: e.created_at,
      cells: [
        e.source === "bank" ? "Expense (bank)" : "Expense (paid by partner)",
        e.date,
        e.source === "bank" ? "Bank" : partnerName(e.paid_by),
        e.category,
        e.note,
        e.amount.toFixed(2),
        partnerName(e.created_by),
        e.created_at,
      ],
    })),
  ].sort(oldestFirst);
  const header = ["Record", "Date", "From / Paid by", "Category", "Note", "Amount (BDT)", "Entered by", "Entered at"];
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows.map((r) => r.cells)].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Today's date as YYYY-MM-DD in the browser's local time zone. */
export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
