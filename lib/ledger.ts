// Pure ledger calculations. No I/O, so everything here is unit-tested.
// Money is summed in paisa (integers) to avoid floating-point drift.

export type Role = "owner" | "partner";
export type Source = "receipt" | "direct";

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

export interface Receipt {
  id: string;
  date: string; // YYYY-MM-DD
  from_partner: string;
  to_partner: string;
  amount: number;
  note: string;
  created_by: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  receipt_id: string | null;
  paid_by: string;
  date: string;
  category: string;
  amount: number;
  note: string;
  source: Source;
  created_by: string | null;
  created_at: string;
}

export interface ReceiptBalance extends Receipt {
  expenses: Expense[];
  spent: number;
  left: number;
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

const byDateThenCreated = (a: { date: string; created_at: string }, b: { date: string; created_at: string }) =>
  a.date.localeCompare(b.date) || a.created_at.localeCompare(b.created_at);

/** Each receipt with its expenses, spent and left. Newest first. */
export function receiptBalances(receipts: Receipt[], expenses: Expense[]): ReceiptBalance[] {
  return receipts
    .map((r) => {
      const lines = expenses.filter((e) => e.source === "receipt" && e.receipt_id === r.id).sort(byDateThenCreated);
      const spent = sum(lines, (e) => e.amount);
      return { ...r, expenses: lines, spent, left: fromPaisa(toPaisa(r.amount) - toPaisa(spent)) };
    })
    .sort((a, b) => byDateThenCreated(b, a));
}

/** Receipts that still have money left, newest first — the "Paid from" dropdown. */
export function openReceipts(balances: ReceiptBalance[]): ReceiptBalance[] {
  return balances.filter((r) => toPaisa(r.left) > 0);
}

export function overspendMessage(left: number): string {
  return `Only ${formatBDT(left)} is left from this money. Log the rest from another receipt, or under Paid by partners.`;
}

/** The overspend rule. Mirrors the database trigger. */
export function checkExpense(left: number, amount: number): { ok: true } | { ok: false; message: string } {
  if (!(amount > 0)) return { ok: false, message: "Enter the amount spent." };
  if (toPaisa(amount) > toPaisa(left)) return { ok: false, message: overspendMessage(left) };
  return { ok: true };
}

/** Turn a database error into something a partner can act on. */
export function friendlyDbError(message: string | undefined): string {
  const m = /OVERSPEND:(-?[\d.]+)/.exec(message ?? "");
  if (m) return overspendMessage(Math.max(0, Number(m[1])));
  if (/foreign key|violates.*expenses_receipt_id_fkey/i.test(message ?? "")) return "Delete the expenses under this receipt first.";
  if (/row-level security/i.test(message ?? "")) return "You don't have permission to do that.";
  return "Couldn't save. Check your connection and try again.";
}

export interface Totals {
  received: number;
  spent: number;
  left: number;
  direct: number;
}

export function totals(receipts: Receipt[], expenses: Expense[]): Totals {
  const received = sum(receipts, (r) => r.amount);
  const spent = sum(expenses.filter((e) => e.source === "receipt"), (e) => e.amount);
  const direct = sum(expenses.filter((e) => e.source === "direct"), (e) => e.amount);
  return { received, spent, left: fromPaisa(toPaisa(received) - toPaisa(spent)), direct };
}

export interface PartnerTotals {
  partner: Partner;
  sent: number;
  paidDirectly: number;
  contributed: number;
  /** Only set for partners who have received money. */
  receiver: { spent: number; holding: number } | null;
}

export function partnerTotals(partners: Partner[], receipts: Receipt[], expenses: Expense[]): PartnerTotals[] {
  const balances = receiptBalances(receipts, expenses);
  return partners.map((p) => {
    const sent = sum(receipts.filter((r) => r.from_partner === p.id), (r) => r.amount);
    const paidDirectly = sum(expenses.filter((e) => e.source === "direct" && e.paid_by === p.id), (e) => e.amount);
    const mine = balances.filter((r) => r.to_partner === p.id);
    return {
      partner: p,
      sent,
      paidDirectly,
      contributed: fromPaisa(toPaisa(sent) + toPaisa(paidDirectly)),
      receiver: mine.length ? { spent: sum(mine, (r) => r.spent), holding: sum(mine, (r) => r.left) } : null,
    };
  });
}

/** Expenses by category, both sources combined, largest first. */
export function byCategory(expenses: Expense[]): { category: string; amount: number }[] {
  const map = new Map<string, number>();
  for (const e of expenses) map.set(e.category, (map.get(e.category) ?? 0) + toPaisa(e.amount));
  return [...map].map(([category, p]) => ({ category, amount: fromPaisa(p) })).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

export interface MonthRow {
  month: string; // YYYY-MM
  received: number;
  spent: number;
  direct: number;
}

/** Received, spent from it, and paid by partners per month. Newest month first. */
export function byMonth(receipts: Receipt[], expenses: Expense[]): MonthRow[] {
  const map = new Map<string, { received: number; spent: number; direct: number }>();
  const bump = (date: string, key: "received" | "spent" | "direct", amount: number) => {
    const m = date.slice(0, 7);
    const row = map.get(m) ?? { received: 0, spent: 0, direct: 0 };
    row[key] += toPaisa(amount);
    map.set(m, row);
  };
  receipts.forEach((r) => bump(r.date, "received", r.amount));
  expenses.forEach((e) => bump(e.date, e.source === "receipt" ? "spent" : "direct", e.amount));
  return [...map]
    .map(([month, r]) => ({ month, received: fromPaisa(r.received), spent: fromPaisa(r.spent), direct: fromPaisa(r.direct) }))
    .sort((a, b) => b.month.localeCompare(a.month));
}

export function receiptLabel(r: ReceiptBalance, partnerName: (id: string) => string): string {
  return `${formatDate(r.date)} · ${formatBDT(r.amount)} from ${partnerName(r.from_partner)} · ${formatBDT(r.left)} left`;
}

/** Every record as CSV, oldest first. */
export function toCSV(receipts: Receipt[], expenses: Expense[], partnerName: (id: string | null) => string): string {
  const receiptDate = new Map(receipts.map((r) => [r.id, r.date]));
  type Row = { date: string; created_at: string; cells: (string | number)[] };
  const rows: Row[] = [
    ...receipts.map((r) => ({
      date: r.date,
      created_at: r.created_at,
      cells: ["Money received", r.date, partnerName(r.from_partner), partnerName(r.to_partner), "", "", r.note, r.amount.toFixed(2), partnerName(r.created_by), r.created_at],
    })),
    ...expenses.map((e) => ({
      date: e.date,
      created_at: e.created_at,
      cells: [
        e.source === "receipt" ? "Spent from money received" : "Paid by partner",
        e.date,
        partnerName(e.paid_by),
        "",
        e.category,
        e.receipt_id ? receiptDate.get(e.receipt_id) ?? "" : "",
        e.note,
        e.amount.toFixed(2),
        partnerName(e.created_by),
        e.created_at,
      ],
    })),
  ].sort(byDateThenCreated);
  const header = ["Record", "Date", "Partner", "Received by", "Category", "Paid from (receipt date)", "Note", "Amount (BDT)", "Entered by", "Entered at"];
  const esc = (v: string | number) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [header, ...rows.map((r) => r.cells)].map((r) => r.map(esc).join(",")).join("\r\n");
}

/** Today's date as YYYY-MM-DD in the browser's local time zone. */
export function today(): string {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
