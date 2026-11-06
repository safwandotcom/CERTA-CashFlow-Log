import { describe, expect, it } from "vitest";
import {
  bankOverspendMessage,
  byCategory,
  byMonth,
  checkBankExpense,
  companyNames,
  formatBDT,
  friendlyDbError,
  groupInput,
  parseAmount,
  partnerInvestment,
  revenueByCompany,
  toCSV,
  totals,
  type Expense,
  type MoneyIn,
  type Partner,
} from "@/lib/ledger";

const partners: Partner[] = [
  { id: "az", name: "Azharul Islam", email: "az@x.com", role: "partner", sort: 0 },
  { id: "ju", name: "Jubair Eusuf", email: "ju@x.com", role: "partner", sort: 1 },
  { id: "to", name: "Sarker Towfiq Pritom", email: "to@x.com", role: "owner", sort: 2 },
];
const name = (id: string | null) => partners.find((p) => p.id === id)?.name ?? "";

const rev = (id: string, date: string, company: string, amount: number): MoneyIn => ({
  id, date, kind: "revenue", company, partner_id: null, amount, note: "", created_by: "ju", created_at: `${date}T09:00:00Z`,
});
const dep = (id: string, date: string, partner: string, amount: number): MoneyIn => ({
  id, date, kind: "investment", company: null, partner_id: partner, amount, note: "", created_by: partner, created_at: `${date}T09:30:00Z`,
});
const bankExp = (id: string, date: string, category: string, amount: number): Expense => ({
  id, paid_by: null, date, category, amount, note: "", source: "bank", created_by: "ju", created_at: `${date}T10:00:00Z`,
});
const pocket = (id: string, by: string, date: string, category: string, amount: number): Expense => ({
  id, paid_by: by, date, category, amount, note: "", source: "partner", created_by: by, created_at: `${date}T11:00:00Z`,
});

const moneyIn = [
  rev("m1", "2026-11-01", "Taj Consultancy", 150000),
  dep("m2", "2026-11-02", "ju", 15000),
  rev("m3", "2026-12-01", "taj consultancy ", 50000),
];
const expenses = [
  bankExp("e1", "2026-11-03", "Staff salary", 30000),
  pocket("e2", "ju", "2026-11-04", "Subscriptions", 5000),
  pocket("e3", "to", "2026-11-05", "Technology", 5000),
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

describe("totals", () => {
  it("splits revenue, investment, expenses and the bank balance", () => {
    expect(totals(moneyIn, expenses)).toEqual({
      revenue: 200000,
      deposits: 15000,
      pocket: 10000,
      investment: 25000,
      expenses: 40000,
      bankSpent: 30000,
      bank: 185000,
    });
  });
  it("pocket expenses never change the bank balance", () => {
    expect(totals(moneyIn, [...expenses, pocket("e9", "az", "2026-11-09", "Other", 999999)]).bank).toBe(185000);
  });
  it("avoids float drift", () => {
    expect(totals([rev("a", "2026-11-01", "X", 0.1), rev("b", "2026-11-01", "X", 0.2)], []).bank).toBe(0.3);
  });
});

describe("bank rule", () => {
  it("allows spending exactly the bank balance", () => {
    expect(checkBankExpense(185000, 185000).ok).toBe(true);
  });
  it("rejects one paisa more, with the agreed message", () => {
    const r = checkBankExpense(185000, 185000.01);
    expect(r).toEqual({ ok: false, message: "Only ৳1,85,000 is in the bank account. Log the rest as paid by a partner, or log money in first." });
  });
  it("rejects zero or invalid amounts", () => {
    expect(checkBankExpense(100, 0).ok).toBe(false);
    expect(checkBankExpense(100, NaN).ok).toBe(false);
  });
  it("translates the database errors", () => {
    expect(friendlyDbError("OVERSPEND:100.00")).toBe(bankOverspendMessage(100));
    expect(friendlyDbError("OVERSPEND:100.00", "delete-money-in")).toBe("Can't delete: the bank balance would go below ৳0. Delete some bank expenses first.");
    expect(friendlyDbError("new row violates row-level security policy")).toBe("You don't have permission to do that.");
    expect(friendlyDbError("boom")).toBe("Couldn't save. Check your connection and try again.");
  });
});

describe("investment by partner", () => {
  it("adds deposits and pocket payments, in partner order", () => {
    expect(partnerInvestment(partners, moneyIn, expenses).map((p) => [p.partner.id, p.deposits, p.pocket, p.total])).toEqual([
      ["az", 0, 0, 0],
      ["ju", 15000, 5000, 20000],
      ["to", 0, 5000, 5000],
    ]);
  });
});

describe("revenue by company", () => {
  it("groups names ignoring case and spaces, showing the latest spelling", () => {
    expect(revenueByCompany(moneyIn)).toEqual([{ company: "taj consultancy", amount: 200000 }]);
  });
  it("sorts largest first", () => {
    const r = revenueByCompany([...moneyIn, rev("m9", "2026-11-09", "Acme", 300000)]);
    expect(r.map((x) => x.company)).toEqual(["Acme", "taj consultancy"]);
  });
  it("offers each company name once, most recent first", () => {
    expect(companyNames([...moneyIn, rev("m9", "2026-10-09", "Acme", 1)])).toEqual(["taj consultancy", "Acme"]);
  });
});

describe("by category", () => {
  it("combines both payment methods, largest first", () => {
    expect(byCategory(expenses)).toEqual([
      { category: "Staff salary", amount: 30000 },
      { category: "Subscriptions", amount: 5000 },
      { category: "Technology", amount: 5000 },
    ]);
  });
});

describe("monthly totals", () => {
  it("counts pocket payments as investment and as expenses, newest month first", () => {
    expect(byMonth(moneyIn, expenses)).toEqual([
      { month: "2026-12", revenue: 50000, investment: 0, expenses: 0 },
      { month: "2026-11", revenue: 150000, investment: 25000, expenses: 40000 },
    ]);
  });
});

describe("CSV export", () => {
  it("includes every record with a header, oldest first", () => {
    const lines = toCSV(moneyIn, expenses, name).split("\r\n");
    expect(lines[0]).toBe('"Record","Date","From / Paid by","Category","Note","Amount (BDT)","Entered by","Entered at"');
    expect(lines).toHaveLength(1 + moneyIn.length + expenses.length);
    expect(lines[1]).toMatch(/^"Revenue","2026-11-01","Taj Consultancy","","","150000.00","Jubair Eusuf"/);
    expect(lines[2]).toMatch(/^"Investment","2026-11-02","Jubair Eusuf",/);
    expect(lines[3]).toMatch(/^"Expense \(bank\)","2026-11-03","Bank","Staff salary"/);
    expect(lines[4]).toMatch(/^"Expense \(paid by partner\)","2026-11-04","Jubair Eusuf","Subscriptions"/);
  });
});
