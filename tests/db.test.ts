// Runs the real migrations and seed against an in-memory Postgres (PGlite)
// to check the database-side rules: bank balance trigger, constraints, RLS, export.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase/migrations");
const COMPANY_MIGRATION = "20261106000000_company_account.sql";
const read = (files: string[]) =>
  files
    .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
    .join("\n")
    .replace(/create extension[^;]+;/i, "");
const allFiles = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort();
const before = read(allFiles.filter((f) => f < COMPANY_MIGRATION));
const after = read(allFiles.filter((f) => f >= COMPANY_MIGRATION));
const seed = readFileSync(path.join(root, "supabase/seed.sql"), "utf8");

// Minimal stand-ins for what Supabase provides.
const supabaseStubs = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
  $$;
  create publication supabase_realtime;
  grant usage on schema public to anon, authenticated;
`;
const grants = `grant select, insert, update, delete on all tables in schema public to anon, authenticated;`;

let db: PGlite;
let ids: Record<string, string>;
let tajId: string;

/** Run SQL as a signed-in user (or anon when email is null), like PostgREST does. */
async function as<T = Record<string, unknown>>(email: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claims', '${email ? JSON.stringify({ email }) : ""}', false);`);
  await db.exec(`set role ${email ? "authenticated" : "anon"};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec("reset role;");
  }
}

const JUBAIR = "info@certaadvisory.com";
const OWNER = "towfiq@certaadvisory.com";
const STRANGER = "someone@else.com";

async function bank(): Promise<number> {
  const [r] = (
    await db.query<{ b: number }>(
      "select ((select coalesce(sum(amount),0) from money_in) - (select coalesce(sum(amount),0) from expenses where source='bank'))::float8 b",
    )
  ).rows;
  return r.b;
}
const revenue = (amount: number, company = "Acme Ltd") =>
  as<{ id: string }>(JUBAIR, "insert into money_in (date, kind, company, amount) values ('2026-11-03', 'revenue', $1, $2) returning id", [company, amount]);
const bankSpend = (amount: number) =>
  as<{ id: string }>(JUBAIR, "insert into expenses (source, date, category, amount) values ('bank', '2026-11-04', 'Staff salary', $1) returning id", [amount]);
const pocketSpend = (amount: number, by?: string) =>
  as<{ id: string }>(OWNER, "insert into expenses (source, paid_by, date, category, amount) values ('partner', $1, '2026-11-05', 'Subscriptions', $2) returning id", [
    by ?? ids.to,
    amount,
  ]);

beforeAll(async () => {
  db = new PGlite();
  await db.exec(supabaseStubs);
  await db.exec(before);
  await db.exec(grants);
  await db.exec(seed);
  const rows = (await db.query<{ id: string; sort: number }>("select id, sort from partners order by sort")).rows;
  ids = { az: rows[0].id, ju: rows[1].id, to: rows[2].id };
  // The one live record, in the old partner-to-partner format.
  tajId = (
    await db.query<{ id: string }>(
      "insert into receipts (date, from_partner, to_partner, amount, note, created_by) values ('2026-11-01', $1, $2, 150000, 'Oct staff', $2) returning id",
      [ids.az, ids.ju],
    )
  ).rows[0].id;
  await db.exec(after);
  await db.exec(grants);
}, 60_000);

describe("conversion of existing data", () => {
  it("converts the existing receipt to Taj Consultancy revenue", async () => {
    const rows = (
      await db.query<Record<string, unknown>>(
        "select id, to_char(date,'YYYY-MM-DD') date, kind, company, partner_id, amount::float8 amount, note, created_by from money_in",
      )
    ).rows;
    expect(rows).toEqual([
      { id: tajId, date: "2026-11-01", kind: "revenue", company: "Taj Consultancy", partner_id: null, amount: 150000, note: "Oct staff", created_by: ids.ju },
    ]);
  });

  it("removed the old receipt columns", async () => {
    const cols = (await db.query<{ c: string }>("select column_name c from information_schema.columns where table_name in ('money_in','expenses')")).rows.map(
      (r) => r.c,
    );
    expect(cols).not.toContain("to_partner");
    expect(cols).not.toContain("receipt_id");
  });
});

describe("migration safety guard", () => {
  async function oldDbWith(receipts: number, expenses: number) {
    const other = new PGlite();
    await other.exec(supabaseStubs);
    await other.exec(before);
    await other.exec(seed);
    const [az, ju] = (await other.query<{ id: string }>("select id from partners order by sort")).rows.map((r) => r.id);
    for (let i = 0; i < receipts; i++) {
      const [r] = (await other.query<{ id: string }>("insert into receipts (date, from_partner, to_partner, amount) values ('2026-11-01', $1, $2, 1000) returning id", [az, ju])).rows;
      for (let j = 0; j < expenses; j++) {
        await other.query("insert into expenses (source, receipt_id, paid_by, date, category, amount) values ('receipt', $1, $2, '2026-11-02', 'Other', 1)", [r.id, ju]);
      }
    }
    return other;
  }

  it("refuses to convert when there is more than the one known receipt", async () => {
    const other = await oldDbWith(2, 0);
    await expect(other.exec(after)).rejects.toThrow(/expected at most 1 receipt and no expenses/);
  });

  it("refuses to convert when expenses exist", async () => {
    const other = await oldDbWith(1, 1);
    await expect(other.exec(after)).rejects.toThrow(/expected at most 1 receipt and no expenses/);
  });

  it("applies cleanly to a new, empty database", async () => {
    const other = await oldDbWith(0, 0);
    await other.exec(after);
    expect((await other.query("select 1 from money_in")).rows).toHaveLength(0);
  });
});

describe("money in rules", () => {
  it("enforces kind, partner and company", async () => {
    await expect(as(JUBAIR, "insert into money_in (date, kind, amount) values ('2026-11-01', 'investment', 1)")).rejects.toThrow(/money_in_source/);
    await expect(as(JUBAIR, "insert into money_in (date, kind, amount) values ('2026-11-01', 'revenue', 1)")).rejects.toThrow(/money_in_source/);
    await expect(as(JUBAIR, "insert into money_in (date, kind, company, amount) values ('2026-11-01', 'revenue', '  ', 1)")).rejects.toThrow(/money_in_company/);
    await expect(
      as(JUBAIR, "insert into money_in (date, kind, partner_id, company, amount) values ('2026-11-01', 'investment', $1, 'X', 1)", [ids.ju]),
    ).rejects.toThrow(/money_in_source/);
    await expect(as(JUBAIR, "insert into money_in (date, kind, company, amount) values ('2026-11-01', 'loan', 'X', 1)")).rejects.toThrow(/kind/);
  });

  it("accepts a partner investment and stamps created_by", async () => {
    const [r] = await as<{ created_by: string }>(
      JUBAIR,
      "insert into money_in (date, kind, partner_id, amount) values ('2026-11-02', 'investment', $1, 15000) returning created_by",
      [ids.ju],
    );
    expect(r.created_by).toBe(ids.ju);
  });
});

describe("bank balance rule", () => {
  it("allows a bank expense of exactly the balance, and rejects one paisa more", async () => {
    const b = await bank();
    await bankSpend(b - 1000);
    await bankSpend(1000);
    expect(await bank()).toBe(0);
    await expect(bankSpend(0.01)).rejects.toThrow(/OVERSPEND:0\.00/);
  });

  it("reports how much is in the bank", async () => {
    await revenue(5000);
    await expect(bankSpend(6000)).rejects.toThrow(/OVERSPEND:5000\.00/);
  });

  it("never blocks pocket expenses, and they don't change the balance", async () => {
    const b = await bank();
    await pocketSpend(999999);
    expect(await bank()).toBe(b);
  });

  it("requires paid_by for pocket expenses and forbids it for bank expenses", async () => {
    await expect(as(OWNER, "insert into expenses (source, date, category, amount) values ('partner', '2026-11-05', 'Other', 1)")).rejects.toThrow(/expenses_paid_by/);
    await expect(as(OWNER, "insert into expenses (source, paid_by, date, category, amount) values ('bank', $1, '2026-11-05', 'Other', 1)", [ids.to])).rejects.toThrow(
      /expenses_paid_by/,
    );
  });

  it("blocks raising a bank expense above the balance", async () => {
    const b = await bank(); // 5000
    const [e] = await bankSpend(b - 100);
    await expect(db.query("update expenses set amount = $1 where id = $2", [b + 1, e.id])).rejects.toThrow(/OVERSPEND:5000\.00/);
    await db.query("update expenses set amount = $1 where id = $2", [b, e.id]);
    expect(await bank()).toBe(0);
  });

  it("blocks switching a pocket expense to the bank beyond the balance", async () => {
    await revenue(100);
    const [e] = await pocketSpend(500);
    await expect(db.query("update expenses set source = 'bank', paid_by = null where id = $1", [e.id])).rejects.toThrow(/OVERSPEND:100\.00/);
  });

  it("refuses deleting or lowering money in when the balance would go negative", async () => {
    // The bank holds ৳100 now, so removing the Taj ৳1,50,000 would go far below zero.
    await expect(as(JUBAIR, "delete from money_in where id = $1", [tajId])).rejects.toThrow(/OVERSPEND/);
    await expect(db.query("update money_in set amount = 1 where id = $1", [tajId])).rejects.toThrow(/OVERSPEND/);
  });

  it("allows deleting money in when the balance stays at or above zero", async () => {
    const [r] = await revenue(250);
    await as(JUBAIR, "delete from money_in where id = $1", [r.id]);
    expect((await db.query("select 1 from money_in where id = $1", [r.id])).rows).toHaveLength(0);
  });
});

describe("row-level security", () => {
  it("hides everything from someone who isn't a partner", async () => {
    expect(await as(STRANGER, "select * from money_in")).toHaveLength(0);
    expect(await as(STRANGER, "select * from partners")).toHaveLength(0);
    expect(await as(null, "select * from expenses")).toHaveLength(0);
    expect(await as(null, "select * from money_in")).toHaveLength(0);
  });

  it("stops a non-partner from writing", async () => {
    await expect(as(STRANGER, "insert into money_in (date, kind, company, amount) values ('2026-11-01', 'revenue', 'X', 1)")).rejects.toThrow(/row-level security/);
  });

  it("only lets the owner change partner names and categories", async () => {
    expect(await as(JUBAIR, "update partners set name = 'X' where id = $1 returning id", [ids.az])).toHaveLength(0);
    await expect(as(JUBAIR, "insert into categories (name, sort) values ('Travel', 99)")).rejects.toThrow(/row-level security/);
    await expect(as(JUBAIR, "select rename_category(id, 'Rent') from categories where name = 'Office rent'")).rejects.toThrow(/Only the owner/);
    expect(await as(OWNER, "update partners set name = 'Azharul Islam' where id = $1 returning id", [ids.az])).toHaveLength(1);
  });

  it("renaming a category relabels past expenses", async () => {
    await as(OWNER, "select rename_category(id, 'Salaries') from categories where name = 'Staff salary'");
    const [c] = (await db.query<{ n: number }>("select count(*)::int n from expenses where category = 'Staff salary'")).rows;
    expect(c.n).toBe(0);
    await as(OWNER, "select rename_category(id, 'Staff salary') from categories where name = 'Salaries'");
  });
});

describe("Google Sheet export", () => {
  let key: string;
  beforeAll(async () => {
    key = (await db.query<{ k: string }>("select create_export_key() k")).rows[0].k;
  });

  it("only the database admin can create export keys", async () => {
    await expect(as(OWNER, "select create_export_key()")).rejects.toThrow(/permission denied/);
    await expect(as(null, "select create_export_key()")).rejects.toThrow(/permission denied/);
  });

  it("rejects a wrong or missing key", async () => {
    await expect(as(null, "select ledger_export('nope')")).rejects.toThrow(/Invalid export key/);
    await expect(as(null, "select ledger_export(null)")).rejects.toThrow(/Invalid export key/);
  });

  it("returns revenue, investment, expenses and summaries", async () => {
    const [{ x }] = await as<{ x: Record<string, any> }>(null, "select ledger_export($1) x", [key]);
    const n = async (sql: string) => (await db.query<{ v: number }>(sql)).rows[0].v;
    const rev = await n("select coalesce(sum(amount),0)::float8 v from money_in where kind='revenue'");
    const dep = await n("select coalesce(sum(amount),0)::float8 v from money_in where kind='investment'");
    const pocket = await n("select coalesce(sum(amount),0)::float8 v from expenses where source='partner'");
    const all = await n("select coalesce(sum(amount),0)::float8 v from expenses");
    expect(x.totals).toEqual({ bank: await bank(), revenue: rev, investment: dep + pocket, expenses: all });

    expect(x.revenue).toHaveLength(await n("select count(*)::int v from money_in where kind='revenue'"));
    expect(x.investment).toHaveLength(
      (await n("select count(*)::int v from money_in where kind='investment'")) + (await n("select count(*)::int v from expenses where source='partner'")),
    );
    expect(x.expenses).toHaveLength(await n("select count(*)::int v from expenses"));

    const taj = x.revenue.find((r: unknown[]) => r[6] === tajId);
    expect(taj.slice(0, 4)).toEqual(["2026-11-01", "Taj Consultancy", 150000, "Oct staff"]);
    expect(x.companies[0]).toEqual(["Taj Consultancy", 150000]);
    expect(x.partners.map((p: unknown[]) => p[0])).toEqual(["Azharul Islam", "Jubair Eusuf", "Sarker Towfiq Pritom"]);
    const ju = x.partners[1];
    expect(ju[1]).toBe(15000);
    expect(ju[3]).toBe(ju[1] + ju[2]);
    expect(x.expenses.some((e: unknown[]) => e[1] === "Bank")).toBe(true);
    expect(x.months[0][0]).toBe("2026-11");
  });
});

describe("passcode mode (server uses the secret key)", () => {
  it("lets the service role rename categories", async () => {
    await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    await db.query("select rename_category(id, 'Rent') from categories where name = 'Office rent'");
    await db.query("select rename_category(id, 'Office rent') from categories where name = 'Rent'");
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    expect((await db.query("select 1 from categories where name = 'Office rent'")).rows).toHaveLength(1);
  });

  it("keeps the created_by the server sends", async () => {
    await db.exec(`select set_config('request.jwt.claims', '{"role":"service_role"}', false)`);
    const [r] = (
      await db.query<{ created_by: string }>(
        "insert into money_in (date, kind, company, amount, created_by) values ('2026-12-01', 'revenue', 'Taj Consultancy', 10, $1) returning created_by",
        [ids.ju],
      )
    ).rows;
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    expect(r.created_by).toBe(ids.ju);
  });
});
