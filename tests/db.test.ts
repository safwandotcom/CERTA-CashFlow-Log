// Runs the real migration and seed against an in-memory Postgres (PGlite)
// to check the database-side rules: overspend trigger, delete guard, RLS.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";
import { byCategory, byMonth, partnerTotals, totals, type Expense, type Partner, type Receipt } from "@/lib/ledger";

const root = path.resolve(__dirname, "..");
const migrationsDir = path.join(root, "supabase/migrations");
const migration = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
  .join("\n")
  .replace(/create extension[^;]+;/i, "");
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

async function newReceipt(amount: number) {
  const [r] = await as<{ id: string }>(JUBAIR, "insert into receipts (date, from_partner, to_partner, amount) values ('2026-11-01', $1, $2, $3) returning id", [
    ids.az,
    ids.ju,
    amount,
  ]);
  return r.id;
}
const spend = (receiptId: string, amount: number, paidBy = ids.ju) =>
  as<{ id: string; paid_by: string; created_by: string }>(
    JUBAIR,
    "insert into expenses (source, receipt_id, paid_by, date, category, amount) values ('receipt', $1, $2, '2026-11-02', 'Staff salary', $3) returning id, paid_by, created_by",
    [receiptId, paidBy, amount],
  );

beforeAll(async () => {
  db = new PGlite();
  await db.exec(supabaseStubs);
  await db.exec(migration);
  await db.exec(grants);
  await db.exec(seed);
  const rows = (await db.query<{ id: string; sort: number }>("select id, sort from partners order by sort")).rows;
  ids = { az: rows[0].id, ju: rows[1].id, to: rows[2].id };
}, 60_000);

describe("seed", () => {
  it("has three partners, ten categories and no transactions", async () => {
    const [c] = (await db.query<{ p: number; c: number; r: number; e: number }>(
      "select (select count(*)::int from partners) p, (select count(*)::int from categories) c, (select count(*)::int from receipts) r, (select count(*)::int from expenses) e",
    )).rows;
    expect(c).toEqual({ p: 3, c: 10, r: 0, e: 0 });
  });
});

describe("overspend trigger", () => {
  it("allows spending up to what is left, and rejects one paisa more", async () => {
    const r = await newReceipt(60000);
    await spend(r, 45000);
    await spend(r, 15000);
    await expect(spend(r, 0.01)).rejects.toThrow(/OVERSPEND:0\.00/);
  });

  it("reports how much is left", async () => {
    const r = await newReceipt(10000);
    await spend(r, 5000);
    await expect(spend(r, 6000)).rejects.toThrow(/OVERSPEND:5000\.00/);
  });

  it("also blocks raising an existing expense above what is left", async () => {
    const r = await newReceipt(1000);
    const [e] = await spend(r, 400);
    await spend(r, 500);
    await expect(db.query("update expenses set amount = 600 where id = $1", [e.id])).rejects.toThrow(/OVERSPEND:500\.00/);
  });

  it("blocks lowering a receipt below what is already spent", async () => {
    const r = await newReceipt(1000);
    await spend(r, 800);
    await expect(db.query("update receipts set amount = 700 where id = $1", [r])).rejects.toThrow(/OVERSPEND/);
  });

  it("sets the paying partner to the receipt's receiver and stamps created_by", async () => {
    const r = await newReceipt(1000);
    const [e] = await spend(r, 100, ids.to); // client claims Towfiq paid; the trigger corrects it
    expect(e.paid_by).toBe(ids.ju);
    expect(e.created_by).toBe(ids.ju);
  });

  it("doesn't limit direct partner payments", async () => {
    const rows = await as(OWNER, "insert into expenses (source, paid_by, date, category, amount) values ('direct', $1, '2026-11-05', 'Subscriptions', 999999) returning id", [ids.to]);
    expect(rows).toHaveLength(1);
  });

  it("rejects a direct payment with a receipt, or a receipt expense without one", async () => {
    const r = await newReceipt(1000);
    await expect(as(OWNER, "insert into expenses (source, receipt_id, paid_by, date, category, amount) values ('direct', $1, $2, '2026-11-05', 'Other', 1)", [r, ids.to])).rejects.toThrow(
      /expenses_source_matches/,
    );
    await expect(as(OWNER, "insert into expenses (source, paid_by, date, category, amount) values ('receipt', $1, '2026-11-05', 'Other', 1)", [ids.to])).rejects.toThrow(
      /expenses_source_matches/,
    );
  });
});

describe("receipt rules", () => {
  it("rejects a receipt sent and received by the same partner", async () => {
    await expect(as(JUBAIR, "insert into receipts (date, from_partner, to_partner, amount) values ('2026-11-01', $1, $1, 100)", [ids.ju])).rejects.toThrow(/receipts_sender_differs/);
  });

  it("can't delete a receipt that has expenses until they are deleted", async () => {
    const r = await newReceipt(500);
    const [e] = await spend(r, 100);
    await expect(as(JUBAIR, "delete from receipts where id = $1", [r])).rejects.toThrow(/foreign key/);
    await as(JUBAIR, "delete from expenses where id = $1", [e.id]);
    await as(JUBAIR, "delete from receipts where id = $1", [r]);
    expect((await db.query("select 1 from receipts where id = $1", [r])).rows).toHaveLength(0);
  });
});

describe("row-level security", () => {
  it("hides everything from someone who isn't a partner", async () => {
    expect(await as(STRANGER, "select * from receipts")).toHaveLength(0);
    expect(await as(STRANGER, "select * from partners")).toHaveLength(0);
    expect(await as(null, "select * from expenses")).toHaveLength(0);
  });

  it("stops a non-partner from writing", async () => {
    await expect(as(STRANGER, "insert into receipts (date, from_partner, to_partner, amount) values ('2026-11-01', $1, $2, 1)", [ids.az, ids.ju])).rejects.toThrow(/row-level security/);
  });

  it("lets partners read and add entries", async () => {
    expect((await as(JUBAIR, "select * from partners")).length).toBe(3);
  });

  it("only lets the owner change partner names and categories", async () => {
    expect(await as(JUBAIR, "update partners set name = 'X' where id = $1 returning id", [ids.az])).toHaveLength(0);
    await expect(as(JUBAIR, "insert into categories (name, sort) values ('Travel', 99)")).rejects.toThrow(/row-level security/);
    await expect(as(JUBAIR, "select rename_category(id, 'Rent') from categories where name = 'Office rent'")).rejects.toThrow(/Only the owner/);

    expect(await as(OWNER, "update partners set name = 'Azharul Islam' where id = $1 returning id", [ids.az])).toHaveLength(1);
    await as(OWNER, "insert into categories (name, sort) values ('Travel', 99)");
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

  it("keeps key hashes unreadable through the API", async () => {
    expect(await as(OWNER, "select * from export_keys")).toHaveLength(0);
    expect(await as(null, "select * from export_keys")).toHaveLength(0);
  });

  it("rejects a wrong or missing key", async () => {
    await expect(as(null, "select ledger_export('nope')")).rejects.toThrow(/Invalid export key/);
    await expect(as(null, "select ledger_export(null)")).rejects.toThrow(/Invalid export key/);
  });

  it("matches the app's calculations exactly", async () => {
    const [{ x }] = await as<{ x: Record<string, any> }>(null, "select ledger_export($1) x", [key]);

    const partners = (await db.query<Partner>("select id, name, email, role, sort from partners order by sort")).rows;
    const receipts = (await db.query<Receipt>("select id, to_char(date,'YYYY-MM-DD') date, from_partner, to_partner, amount::float8 amount, note, created_by, created_at::text from receipts")).rows;
    const expenses = (
      await db.query<Expense>("select id, receipt_id, paid_by, to_char(date,'YYYY-MM-DD') date, category, amount::float8 amount, note, source::text, created_by, created_at::text from expenses")
    ).rows;

    expect(x.receipts).toHaveLength(receipts.length);
    expect(x.expenses).toHaveLength(expenses.length);

    const t = totals(receipts, expenses);
    expect(x.totals).toEqual({ received: t.received, spent: t.spent, left: t.left, direct: t.direct });

    expect(x.partners).toEqual(
      partnerTotals(partners, receipts, expenses).map((p) => [p.partner.name, p.sent, p.paidDirectly, p.contributed, p.receiver?.spent ?? null, p.receiver?.holding ?? null]),
    );
    expect(x.categories).toEqual(byCategory(expenses).map((c) => [c.category, c.amount]));
    expect(x.months).toEqual(byMonth(receipts, expenses).map((m) => [m.month, m.received, m.spent, m.direct]));
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
      await db.query<{ created_by: string }>("insert into receipts (date, from_partner, to_partner, amount, created_by) values ('2026-12-01', $1, $2, 10, $2) returning created_by", [ids.az, ids.ju])
    ).rows;
    await db.exec(`select set_config('request.jwt.claims', '', false)`);
    expect(r.created_by).toBe(ids.ju);
  });
});
