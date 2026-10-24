"use client";

import { useEffect, useState } from "react";
import { addExpense, addReceipt, deleteRecord } from "@/app/actions";
import {
  checkExpense,
  formatBDT,
  formatDate,
  groupInput,
  openReceipts,
  parseAmount,
  receiptLabel,
  today,
  type ReceiptBalance,
} from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { AmountInput, DeleteButton, Empty, FormMsg, Who, type Msg } from "./ui";

const STAFF_OP = "Staff operational cost";

export default function ReceivedTab({ data, balances }: { data: LedgerData; balances: ReceiptBalance[] }) {
  return (
    <section className="grid gap-5">
      <div className="grid gap-4 md:grid-cols-2">
        <ReceiptForm data={data} />
        <ExpenseForm data={data} balances={balances} />
      </div>
      <div className="grid gap-3.5">
        {balances.length ? (
          balances.map((r) => <ReceiptCard key={r.id} r={r} data={data} />)
        ) : (
          <div className="card">
            <Empty title="No money received yet">
              When money comes in, log it in step 1. Each expense paid from it is logged in step 2 and listed under it here.
            </Empty>
          </div>
        )}
      </div>
    </section>
  );
}

function ReceiptForm({ data }: { data: LedgerData }) {
  const { partners, reload, partnerName } = data;
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Default: first partner sends, second receives (Azharul → Jubair).
  useEffect(() => {
    if (partners.length >= 2) {
      setFrom((v) => v || partners[0].id);
      setTo((v) => v || partners[1].id);
    }
  }, [partners]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!(a > 0)) return setMsg({ text: "Enter the amount received.", err: true });
    if (from === to) return setMsg({ text: "Sent by and Received by must be different partners.", err: true });
    if (!date) return setMsg({ text: "Pick the date received.", err: true });
    setBusy(true);
    const res = await addReceipt({ date, from, to, amount: a, note });
    setBusy(false);
    if ("error" in res) return setMsg({ text: res.error, err: true });
    setMsg({ text: `Logged ${formatBDT(a)} received by ${partnerName(to)}. Now log what it's spent on.` });
    setAmount("");
    setNote("");
    reload();
  }

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Step 1 · Log money received</h2>
      <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <div className="field">
          <label htmlFor="rFrom">Sent by</label>
          <select id="rFrom" className="input" value={from} onChange={(e) => setFrom(e.target.value)}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rTo">Received by</label>
          <select id="rTo" className="input" value={to} onChange={(e) => setTo(e.target.value)}>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="rAmount">Amount (৳)</label>
          <AmountInput id="rAmount" value={amount} onChange={setAmount} placeholder="60,000" />
        </div>
        <div className="field">
          <label htmlFor="rDate">Date received</label>
          <input id="rDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field col-span-2">
          <label htmlFor="rNote">Note</label>
          <input id="rNote" className="input" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. November salaries, operational cost and rent" />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2.5">
          <button className="btn btn-green" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Log money received"}
          </button>
          <FormMsg msg={msg} />
        </div>
      </form>
    </div>
  );
}

function ExpenseForm({ data, balances }: { data: LedgerData; balances: ReceiptBalance[] }) {
  const { categories, reload, partnerName } = data;
  const open = openReceipts(balances);
  const [fund, setFund] = useState("");
  const [category, setCategory] = useState("");
  const [heads, setHeads] = useState("3");
  const [rate, setRate] = useState("5,000");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  const selected = open.find((r) => r.id === fund) ?? open[0];
  const isStaffOp = category === STAFF_OP;

  useEffect(() => {
    if (!category && categories.length) setCategory(categories[0].name);
  }, [categories, category]);

  // Staff operational cost helper: staff count × rate per head fills the amount.
  useEffect(() => {
    if (!isStaffOp) return;
    const n = parseAmount(heads) || 0;
    const r = parseAmount(rate) || 0;
    if (n * r > 0) setAmount(groupInput(String(n * r)));
  }, [isStaffOp, heads, rate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return setMsg({ text: "Log money received first, then pick it under Paid from.", err: true });
    const a = parseAmount(amount);
    const check = checkExpense(selected.left, a);
    if (!check.ok) return setMsg({ text: check.message, err: true });
    if (!date) return setMsg({ text: "Pick the date paid.", err: true });
    if (!category) return setMsg({ text: "Pick a category.", err: true });
    setBusy(true);
    const res = await addExpense({ source: "receipt", receiptId: selected.id, paidBy: selected.to_partner, date, category, amount: a, note });
    setBusy(false);
    if ("error" in res) {
      reload();
      return setMsg({ text: res.error, err: true });
    }
    setMsg({ text: `Logged ${formatBDT(a)} · ${category}. ${formatBDT(selected.left - a)} left from this money.` });
    setNote("");
    if (!isStaffOp) setAmount("");
    reload();
  }

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Step 2 · Log an expense from it</h2>
      <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <div className="field col-span-2">
          <label htmlFor="sFund">Paid from</label>
          <select id="sFund" className="input" value={selected?.id ?? ""} onChange={(e) => setFund(e.target.value)} disabled={!open.length}>
            {open.length ? (
              open.map((r) => (
                <option key={r.id} value={r.id}>
                  {receiptLabel(r, partnerName)}
                </option>
              ))
            ) : (
              <option value="">No money left to spend. Log money received first.</option>
            )}
          </select>
          {selected && <span className="note">Paid by {partnerName(selected.to_partner)}</span>}
        </div>
        <div className={`field ${isStaffOp ? "" : "col-span-2 sm:col-span-1"}`}>
          <label htmlFor="sCat">Category</label>
          <select id="sCat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => (
              <option key={c.id} value={c.name}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        {isStaffOp && (
          <div className="field">
            <span className="label">Staff × rate</span>
            <div className="flex items-center gap-1.5">
              <input aria-label="Number of staff" className="input num w-[4.5em] flex-none" inputMode="numeric" value={heads} onChange={(e) => setHeads(e.target.value.replace(/\D/g, ""))} />
              <span className="msg">×</span>
              <input aria-label="Cost per staff" className="input num" inputMode="decimal" value={rate} onChange={(e) => setRate(groupInput(e.target.value))} />
            </div>
          </div>
        )}
        <div className="field">
          <label htmlFor="sAmount">Amount (৳)</label>
          <AmountInput id="sAmount" value={amount} onChange={setAmount} placeholder="15,000" />
        </div>
        <div className="field">
          <label htmlFor="sDate">Date paid</label>
          <input id="sDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field col-span-2">
          <label htmlFor="sNote">Note</label>
          <input id="sNote" className="input" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. November salary, 3 staff" />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2.5">
          <button className="btn" type="submit" disabled={busy || !open.length}>
            {busy ? "Saving…" : "Log expense"}
          </button>
          <FormMsg msg={msg} />
        </div>
      </form>
    </div>
  );
}

function ReceiptCard({ r, data }: { r: ReceiptBalance; data: LedgerData }) {
  const { reload, partnerName, partnerColor, enteredBy } = data;
  const pct = Math.min(100, (r.spent / (r.amount || 1)) * 100);

  const del = (table: "receipts" | "expenses", id: string) => async () => {
    const res = await deleteRecord(table, id);
    if ("error" in res) return res.error;
    await reload();
    return null;
  };

  return (
    <article className="overflow-hidden rounded-[10px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 bg-green-soft px-3.5 py-3">
        <span className="num text-[17px] font-medium text-green">{formatBDT(r.amount)}</span>
        <span className="min-w-[160px] flex-1">
          <Who name={partnerName(r.to_partner)} color={partnerColor(r.to_partner)} /> <span className="note">received from</span>{" "}
          <Who name={partnerName(r.from_partner)} color={partnerColor(r.from_partner)} />
          <div className="note">
            {formatDate(r.date)}
            {r.note && ` · ${r.note}`}
            {r.created_by && ` · Entered by ${enteredBy(r.created_by)}`}
          </div>
        </span>
        <DeleteButton onDelete={del("receipts", r.id)} blockedReason={r.expenses.length ? "Delete its expenses first" : undefined} />
      </div>
      <div className="h-1.5 bg-line" aria-hidden>
        <span className="block h-full bg-accent" style={{ width: `${pct.toFixed(1)}%` }} />
      </div>
      <div className="grid">
        {r.expenses.length ? (
          r.expenses.map((e) => (
            <div key={e.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-start gap-2.5 border-t border-line px-3.5 py-2.5 text-sm sm:grid-cols-[96px_minmax(0,1fr)_auto_auto]">
              <span className="num col-span-full text-xs text-muted sm:col-span-1 sm:text-sm sm:text-ink">{formatDate(e.date)}</span>
              <span>
                {e.category}
                {e.note && <div className="note">{e.note}</div>}
                {e.created_by && <div className="note">Entered by {enteredBy(e.created_by)}</div>}
              </span>
              <span className="num whitespace-nowrap text-right">{formatBDT(e.amount)}</span>
              <DeleteButton onDelete={del("expenses", e.id)} />
            </div>
          ))
        ) : (
          <div className="note border-t border-line px-3.5 py-2.5">No expenses logged from this money yet.</div>
        )}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-2 border-t border-line px-3.5 py-2.5 text-[13px] text-muted">
        <span>
          Spent <b className="num font-medium text-ink">{formatBDT(r.spent)}</b>
        </span>
        <span className="ml-auto">
          Left <b className={`num font-medium ${r.left > 0 ? "text-green" : "text-muted"}`}>{formatBDT(r.left)}</b>
        </span>
      </div>
    </article>
  );
}
