"use client";

import { useEffect, useMemo, useState } from "react";
import { addExpense, deleteRecord } from "@/app/actions";
import { checkBankExpense, formatBDT, formatDate, groupInput, newestFirst, parseAmount, today, type Expense, type Source } from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { AmountInput, Choice, DeleteButton, Empty, FormMsg, Who, type Msg } from "./ui";

const STAFF_OP = "Staff operational cost";

export default function ExpensesTab({ data }: { data: LedgerData }) {
  const rows = useMemo(() => [...data.expenses].sort(newestFirst), [data.expenses]);
  const total = rows.reduce((s, e) => s + Math.round(e.amount * 100), 0) / 100;

  return (
    <section className="grid gap-5">
      <ExpenseForm data={data} />
      <div className="card">
        {rows.length ? (
          <>
            <ul className="grid">
              {rows.map((e) => (
                <ExpenseRow key={e.id} e={e} data={data} />
              ))}
            </ul>
            <div className="msg">
              {rows.length} {rows.length === 1 ? "expense" : "expenses"} · {formatBDT(total)}
            </div>
          </>
        ) : (
          <Empty title="No expenses yet">Log every company expense above, whether it&apos;s paid from the bank or by a partner.</Empty>
        )}
      </div>
    </section>
  );
}

function ExpenseForm({ data }: { data: LedgerData }) {
  const { partners, categories, bank, reload, partnerName } = data;
  const [source, setSource] = useState<Source>("bank");
  const [partner, setPartner] = useState("");
  const [category, setCategory] = useState("");
  const [heads, setHeads] = useState("3");
  const [rate, setRate] = useState("5,000");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const isStaffOp = category === STAFF_OP;

  useEffect(() => {
    if (!partner && partners.length) setPartner(partners[Math.min(2, partners.length - 1)].id);
  }, [partners, partner]);
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
    const a = parseAmount(amount);
    if (source === "bank") {
      const check = checkBankExpense(bank, a);
      if (!check.ok) return setMsg({ text: check.message, err: true });
    } else if (!(a > 0)) {
      return setMsg({ text: "Enter the amount paid.", err: true });
    }
    if (!date) return setMsg({ text: "Pick the date paid.", err: true });
    if (!category) return setMsg({ text: "Pick a category.", err: true });
    setBusy(true);
    const res = await addExpense({ source, paidBy: source === "partner" ? partner : undefined, date, category, amount: a, note });
    setBusy(false);
    if ("error" in res) {
      reload();
      return setMsg({ text: res.error, err: true });
    }
    setMsg({
      text:
        source === "bank"
          ? `Logged ${formatBDT(a)} · ${category} from the bank. ${formatBDT(bank - a)} left in the bank.`
          : `Logged ${formatBDT(a)} · ${category} paid by ${partnerName(partner)}, counted as their investment.`,
    });
    setNote("");
    if (!isStaffOp) setAmount("");
    reload();
  }

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Log a company expense</h2>
      <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <Choice
          label="Who paid?"
          value={source}
          onChange={(s) => {
            setSource(s);
            setMsg(null);
          }}
          options={[
            { value: "bank", label: "Company bank account" },
            { value: "partner", label: "A partner, from own pocket" },
          ]}
        />
        {source === "bank" ? (
          <p className="note col-span-2 m-0">
            Bank balance: <b className="num font-medium text-ink">{formatBDT(bank)}</b> available
          </p>
        ) : (
          <div className="field col-span-2">
            <label htmlFor="xPartner">Partner</label>
            <select id="xPartner" className="input" value={partner} onChange={(e) => setPartner(e.target.value)}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <span className="note">Counts as a company expense and as this partner&apos;s investment. The bank balance doesn&apos;t change.</span>
          </div>
        )}
        <div className={`field ${isStaffOp ? "" : "col-span-2 sm:col-span-1"}`}>
          <label htmlFor="xCat">Category</label>
          <select id="xCat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
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
          <label htmlFor="xAmount">Amount (৳)</label>
          <AmountInput id="xAmount" value={amount} onChange={setAmount} placeholder="15,000" />
        </div>
        <div className="field">
          <label htmlFor="xDate">Date paid</label>
          <input id="xDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field col-span-2">
          <label htmlFor="xNote">Note</label>
          <input id="xNote" className="input" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. November salary, 3 staff" />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2.5">
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Log expense"}
          </button>
          <FormMsg msg={msg} />
        </div>
      </form>
    </div>
  );
}

function ExpenseRow({ e, data }: { e: Expense; data: LedgerData }) {
  const { reload, partnerName, partnerColor, enteredBy } = data;

  async function del() {
    const res = await deleteRecord("expenses", e.id);
    if ("error" in res) return res.error;
    await reload();
    return null;
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-line py-2.5 text-sm last:border-0 sm:grid-cols-[96px_minmax(0,1fr)_auto_auto]">
      <span className="num col-span-full text-xs text-muted sm:col-span-1 sm:text-sm sm:text-ink">{formatDate(e.date)}</span>
      <span className="min-w-0">
        <span className="font-medium">{e.category}</span>
        <span className="note">
          {" · "}
          {e.source === "bank" ? "Paid from the bank" : <Who name={partnerName(e.paid_by)} color={partnerColor(e.paid_by ?? "")} />}
        </span>
        {e.note && <div className="note">{e.note}</div>}
        {e.created_by && <div className="note">Entered by {enteredBy(e.created_by)}</div>}
      </span>
      <span className="num whitespace-nowrap text-right">{formatBDT(e.amount)}</span>
      <span className="col-start-2 justify-self-end sm:col-start-auto">
        <DeleteButton onDelete={del} />
      </span>
    </li>
  );
}
