"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { friendlyDbError, type Category, type Expense, type Partner, type Receipt } from "@/lib/ledger";
import { COOKIE, MAX_AGE, isUnlocked, safeEqual, tokenFor } from "@/lib/passcode";

const AS_COOKIE = "certa_as";

export interface LedgerSnapshot {
  partners: Partner[];
  categories: Category[];
  receipts: Receipt[];
  expenses: Expense[];
  actingAs: string | null;
}

export type Result = { error: string } | { ok: true };

async function guard() {
  const jar = await cookies();
  if (!(await isUnlocked(jar.get(COOKIE)?.value))) throw new Error("Locked");
  return jar;
}

const fail = (message: string | undefined): Result => ({ error: friendlyDbError(message) });
const money = <T extends { amount: unknown }>(rows: T[] | null) => (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));
const clean = (s: unknown, max = 200) => String(s ?? "").trim().slice(0, max);

// ---------------------------------------------------------------------------
// Passcode
// ---------------------------------------------------------------------------

export async function unlock(_: { error: string } | null, form: FormData): Promise<{ error: string } | null> {
  const expected = process.env.APP_PASSCODE;
  if (!expected) return { error: "APP_PASSCODE isn't set on the server." };
  const given = String(form.get("passcode") ?? "").trim();
  if (!safeEqual(given, expected)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return { error: "That passcode isn't right." };
  }
  (await cookies()).set(COOKIE, await tokenFor(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
  redirect("/");
}

export async function lock() {
  (await cookies()).delete(COOKIE);
  redirect("/unlock");
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function loadLedger(): Promise<LedgerSnapshot> {
  const jar = await guard();
  const s = db();
  const [p, c, r, e] = await Promise.all([
    s.from("partners").select("id,name,email,role,sort").order("sort"),
    s.from("categories").select("id,name,sort").order("sort"),
    s.from("receipts").select("*").order("date", { ascending: false }),
    s.from("expenses").select("*").order("date", { ascending: false }),
  ]);
  const err = p.error ?? c.error ?? r.error ?? e.error;
  if (err) throw new Error(err.message);
  const partners = (p.data ?? []) as Partner[];
  const saved = jar.get(AS_COOKIE)?.value;
  // Default "entering as" is the second partner (Jubair), who keeps the books.
  const actingAs = partners.find((x) => x.id === saved)?.id ?? partners[1]?.id ?? partners[0]?.id ?? null;
  return { partners, categories: (c.data ?? []) as Category[], receipts: money(r.data) as Receipt[], expenses: money(e.data) as Expense[], actingAs };
}

export async function setActingAs(partnerId: string): Promise<Result> {
  const jar = await guard();
  jar.set(AS_COOKIE, partnerId, { httpOnly: true, sameSite: "lax", maxAge: MAX_AGE, path: "/" });
  return { ok: true };
}

/** Who "Entered by" records: the device's chosen partner, else the same default loadLedger shows. */
async function actor() {
  const jar = await guard();
  const { data } = await db().from("partners").select("id").order("sort");
  const ids = (data ?? []).map((p) => p.id as string);
  const saved = jar.get(AS_COOKIE)?.value;
  return saved && ids.includes(saved) ? saved : (ids[1] ?? ids[0] ?? null);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function addReceipt(input: { date: string; from: string; to: string; amount: number; note: string }): Promise<Result> {
  const createdBy = await actor();
  if (!(input.amount > 0)) return { error: "Enter the amount received." };
  if (input.from === input.to) return { error: "Sent by and Received by must be different partners." };
  const { error } = await db()
    .from("receipts")
    .insert({ date: input.date, from_partner: input.from, to_partner: input.to, amount: input.amount, note: clean(input.note), created_by: createdBy });
  return error ? fail(error.message) : { ok: true };
}

export async function addExpense(input: {
  source: "receipt" | "direct";
  receiptId: string | null;
  paidBy: string;
  date: string;
  category: string;
  amount: number;
  note: string;
}): Promise<Result> {
  const createdBy = await actor();
  if (!(input.amount > 0)) return { error: "Enter the amount." };
  const { error } = await db()
    .from("expenses")
    .insert({
      source: input.source,
      receipt_id: input.source === "receipt" ? input.receiptId : null,
      paid_by: input.paidBy, // for receipt expenses the database sets this to the receiver
      date: input.date,
      category: clean(input.category, 60),
      amount: input.amount,
      note: clean(input.note),
      created_by: createdBy,
    });
  return error ? fail(error.message) : { ok: true };
}

export async function deleteRecord(table: "receipts" | "expenses", id: string): Promise<Result> {
  await guard();
  if (table !== "receipts" && table !== "expenses") return { error: "Unknown record." };
  const { error } = await db().from(table).delete().eq("id", id);
  return error ? fail(error.message) : { ok: true };
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export async function renamePartner(id: string, name: string): Promise<Result> {
  await guard();
  const n = clean(name, 60);
  if (!n) return { error: "Names can't be empty." };
  const { error } = await db().from("partners").update({ name: n }).eq("id", id);
  return error ? fail(error.message) : { ok: true };
}

export async function addCategory(name: string): Promise<Result> {
  await guard();
  const n = clean(name, 60);
  if (!n) return { error: "Type a category name." };
  const s = db();
  const { data } = await s.from("categories").select("sort").order("sort", { ascending: false }).limit(1);
  const { error } = await s.from("categories").insert({ name: n, sort: (data?.[0]?.sort ?? -1) + 1 });
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "That category already exists." : friendlyDbError(error.message) };
  return { ok: true };
}

export async function renameCategory(id: string, name: string): Promise<Result> {
  await guard();
  const n = clean(name, 60);
  if (!n) return { error: "Names can't be empty." };
  const { error } = await db().rpc("rename_category", { cat_id: id, new_name: n });
  if (error) return { error: /duplicate|unique/i.test(error.message) ? "That name is already used." : friendlyDbError(error.message) };
  return { ok: true };
}

export async function swapCategories(a: string, b: string): Promise<Result> {
  await guard();
  const s = db();
  const { data, error } = await s.from("categories").select("id,sort").in("id", [a, b]);
  if (error || data?.length !== 2) return fail(error?.message);
  const [x, y] = data;
  await s.from("categories").update({ sort: y.sort }).eq("id", x.id);
  const r = await s.from("categories").update({ sort: x.sort }).eq("id", y.id);
  return r.error ? fail(r.error.message) : { ok: true };
}

export async function deleteCategory(id: string): Promise<Result> {
  await guard();
  const { error } = await db().from("categories").delete().eq("id", id);
  return error ? fail(error.message) : { ok: true };
}
