import { describe, expect, it } from "vitest";
import {
  byCategory,
  byMonth,
  checkExpense,
  formatBDT,
  friendlyDbError,
  groupInput,
  openReceipts,
  parseAmount,
  partnerTotals,
  receiptBalances,
  receiptLabel,
  toCSV,
  totals,
  type Expense,
  type Partner,
  type Receipt,
} from "@/lib/ledger";

const partners: Partner[] = [
  { id: "az", name: "Azharul Islam", email: "az@x.com", role: "partner", sort: 0 },
  { id: "ju", name: "Jubair Eusuf", email: "ju@x.com", role: "partner", sort: 1 },
  { id: "to", name: "Sarker Towfiq Pritom", email: "to@x.com", role: "owner", sort: 2 },
];
const name = (id: string | null) => partners.find((p) => p.id === id)?.name ?? "";

const receipt = (id: string, date: string, amount: number, from = "az", to = "ju"): Receipt => ({
  id, date, amount, from_partner: from, to_partner: to, note: "", created_by: "ju", created_at: `${date}T09:00:00Z`,
});
const fromReceipt = (id: string, receiptId: string, date: string, category: string, amount: number): Expense => ({
  id, receipt_id: receiptId, paid_by: "ju", date, category, amount, note: "", source: "receipt", created_by: "ju", created_at: `${date}T10:00:00Z`,
});
const direct = (id: string, by: string, date: string, category: string, amount: number): Expense => ({
  id, receipt_id: null, paid_by: by, date, category, amount, note: "", source: "direct", created_by: by, created_at: `${date}T11:00:00Z`,
});

const receipts = [receipt("r1", "2026-10-01", 60000), receipt("r2", "2026-11-01", 60000)];
const expenses = [
  fromReceipt("e1", "r1", "2026-10-03", "Staff salary", 30000),
  fromReceipt("e2", "r1", "2026-10-03", "Staff operational cost", 15000),
  fromReceipt("e3", "r1", "2026-10-05", "Office rent", 15000),
  fromReceipt("e4", "r2", "2026-11-02", "Staff salary", 30000.5),
  direct("d1", "to", "2026-10-10", "Subscriptions", 4500),
  direct("d2", "to", "2026-11-10", "Technology", 12000),
];

describe("formatting", () => {
  it("uses Indian digit grouping", () => {
    expect(formatBDT(123456)).toBe("৳1,23,456");
    expect(formatBDT(12345678)).toBe("৳1,23,45,678");
    expect(formatBDT(999)).toBe("৳999");
    expect(formatBDT(0)).toBe("৳0");
    expect(formatBDT(1000.5)).toBe("৳1,000.50");
    expect(formatBDT(-5000)).toBe("−৳5,000");
  });
  it("parses typed amounts", () => {
    expect(parseAmount("60,000")).toBe(60000);
    expect(parseAmount("৳ 4,500.50")).toBe(4500.5);
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("1.2.3")).toBeNaN();
  });
  it("groups input as typed", () => {
    expect(groupInput("123456")).toBe("1,23,456");
    expect(groupInput("1234.567")).toBe("1,234.56");
  });
});

describe("receipt left", () => {
  const b = receiptBalances(receipts, expenses);
  it("computes spent and left per receipt, newest first", () => {
    expect(b.map((r) => r.id)).toEqual(["r2", "r1"]);
    expect(b[1]).toMatchObject({ spent: 60000, left: 0 });
    expect(b[0]).toMatchObject({ spent: 30000.5, left: 29999.5 });
    expect(b[1].expenses.map((e) => e.id)).toEqual(["e1", "e2", "e3"]);
  });
  it("only receipts with money left appear in Paid from", () => {
    expect(openReceipts(b).map((r) => r.id)).toEqual(["r2"]);
  });
  it("labels the dropdown option", () => {
    expect(receiptLabel(b[0], name)).toBe("1 Nov 2026 · ৳60,000 from Azharul Islam · ৳29,999.50 left");
  });
  it("ignores direct payments", () => {
    expect(receiptBalances([receipt("r", "2026-01-01", 100)], [direct("d", "ju", "2026-01-01", "Other", 50)])[0].left).toBe(100);
  });
  it("avoids float drift", () => {
    const r = receiptBalances([receipt("r", "2026-01-01", 0.3)], [fromReceipt("a", "r", "2026-01-01", "Other", 0.1), fromReceipt("b", "r", "2026-01-01", "Other", 0.2)]);
    expect(r[0].left).toBe(0);
  });
});

describe("overspend rule", () => {
  it("allows spending exactly what is left", () => {
    expect(checkExpense(5000, 5000)).toEqual({ ok: true });
  });
  it("rejects spending more than is left, with the agreed message", () => {
    expect(checkExpense(5000, 5000.01)).toEqual({
      ok: false,
      message: "Only ৳5,000 is left from this money. Log the rest from another receipt, or under Paid by partners.",
    });
  });
  it("rejects zero or invalid amounts", () => {
    expect(checkExpense(5000, 0).ok).toBe(false);
    expect(checkExpense(5000, NaN).ok).toBe(false);
  });
  it("translates the database trigger error", () => {
    expect(friendlyDbError("OVERSPEND:5000.00")).toBe(
      "Only ৳5,000 is left from this money. Log the rest from another receipt, or under Paid by partners.",
    );
    expect(friendlyDbError('update or delete on table "receipts" violates foreign key constraint')).toMatch(/Delete the expenses/);
  });
});

describe("totals", () => {
  it("sums received, spent, left in hand and paid by partners", () => {
    expect(totals(receipts, expenses)).toEqual({ received: 120000, spent: 90000.5, left: 29999.5, direct: 16500 });
  });
});

describe("per-partner totals", () => {
  const t = Object.fromEntries(partnerTotals(partners, receipts, expenses).map((x) => [x.partner.id, x]));
  it("credits the sender with money sent", () => {
    expect(t.az).toMatchObject({ sent: 120000, paidDirectly: 0, contributed: 120000, receiver: null });
  });
  it("shows spent and still holding for the receiver", () => {
    expect(t.ju).toMatchObject({ sent: 0, paidDirectly: 0, contributed: 0, receiver: { spent: 90000.5, holding: 29999.5 } });
  });
  it("credits direct payments", () => {
    expect(t.to).toMatchObject({ sent: 0, paidDirectly: 16500, contributed: 16500, receiver: null });
  });
});

describe("by category", () => {
  it("combines both sources, largest first", () => {
    expect(byCategory(expenses)).toEqual([
      { category: "Staff salary", amount: 60000.5 },
      { category: "Office rent", amount: 15000 },
      { category: "Staff operational cost", amount: 15000 },
      { category: "Technology", amount: 12000 },
      { category: "Subscriptions", amount: 4500 },
    ]);
  });
});

describe("monthly totals", () => {
  it("splits received, spent and paid by partners per month, newest first", () => {
    expect(byMonth(receipts, expenses)).toEqual([
      { month: "2026-11", received: 60000, spent: 30000.5, direct: 12000 },
      { month: "2026-10", received: 60000, spent: 60000, direct: 4500 },
    ]);
  });
});

describe("CSV export", () => {
  it("includes every record with a header, oldest first", () => {
    const lines = toCSV(receipts, expenses, name).split("\r\n");
    expect(lines).toHaveLength(1 + receipts.length + expenses.length);
    expect(lines[0]).toContain('"Record"');
    expect(lines[1]).toBe('"Money received","2026-10-01","Azharul Islam","Jubair Eusuf","","","","60000.00","Jubair Eusuf","2026-10-01T09:00:00Z"');
    expect(lines.at(-1)).toContain('"Paid by partner"');
  });
});
