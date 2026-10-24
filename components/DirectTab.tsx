"use client";

import { useEffect, useState } from "react";
import { formatBDT, formatDate, friendlyDbError, parseAmount, today } from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { AmountInput, DeleteButton, Empty, FormMsg, Who, type Msg } from "./ui";

export default function DirectTab({ data }: { data: LedgerData }) {
  const { partners, categories, expenses, supabase, reload, partnerName, partnerColor, enteredBy } = data;
  const [by, setBy] = useState("");
  const [category, setCategory] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);

  // Defaults: third partner (Towfiq) paying Subscriptions.
  useEffect(() => {
    if (!by && partners.length) setBy(partners[Math.min(2, partners.length - 1)].id);
  }, [partners, by]);
  useEffect(() => {
    if (!category && categories.length) setCategory((categories.find((c) => c.name === "Subscriptions") ?? categories[0]).name);
  }, [categories, category]);

  const rows = expenses.filter((e) => e.source === "direct").sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at));
  const total = rows.reduce((s, e) => s + Math.round(e.amount * 100), 0) / 100;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = parseAmount(amount);
    if (!(a > 0)) return setMsg({ text: "Enter the amount paid.", err: true });
    if (!date) return setMsg({ text: "Pick the date paid.", err: true });
    if (!category) return setMsg({ text: "Pick a category.", err: true });
    setBusy(true);
    const { error } = await supabase.from("expenses").insert({ source: "direct", receipt_id: null, paid_by: by, date, category, amount: a, note: note.trim().slice(0, 200) });
    setBusy(false);
    if (error) return setMsg({ text: friendlyDbError(error.message), err: true });
    setMsg({ text: `Logged ${formatBDT(a)} paid by ${partnerName(by)}.` });
    setAmount("");
    setNote("");
    reload();
  }

  const del = (id: string) => async () => {
    const { error } = await supabase.from("expenses").delete().eq("id", id);
    if (error) return friendlyDbError(error.message);
    await reload();
    return null;
  };

  return (
    <section className="grid gap-5">
      <div className="card">
        <h2 className="font-display text-[19px] font-semibold">Log a payment a partner made for the business</h2>
        <p className="note m-0 max-w-[65ch]">For expenses a partner pays from his own pocket, not from money received. For example, Towfiq paying subscriptions and technology.</p>
        <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div className="field col-span-2 sm:col-span-1">
            <label htmlFor="dPartner">Paid by</label>
            <select id="dPartner" className="input" value={by} onChange={(e) => setBy(e.target.value)}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field col-span-2 sm:col-span-1">
            <label htmlFor="dCat">Category</label>
            <select id="dCat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.map((c) => (
                <option key={c.id} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="dAmount">Amount (৳)</label>
            <AmountInput id="dAmount" value={amount} onChange={setAmount} placeholder="4,500" />
          </div>
          <div className="field">
            <label htmlFor="dDate">Date paid</label>
            <input id="dDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field col-span-2">
            <label htmlFor="dNote">Note</label>
            <input id="dNote" className="input" maxLength={200} autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Google Workspace, November" />
          </div>
          <div className="col-span-full flex flex-wrap items-center gap-2.5">
            <button className="btn" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Log payment"}
            </button>
            <FormMsg msg={msg} />
          </div>
        </form>
      </div>

      <div className="card">
        {rows.length ? (
          <>
            {/* Phones: one compact row per payment */}
            <ul className="grid sm:hidden">
              {rows.map((d) => (
                <li key={d.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-b border-line py-2.5 text-sm last:border-0">
                  <span>
                    <span className="font-medium">{d.category}</span>
                    {d.note && <div className="note">{d.note}</div>}
                  </span>
                  <span className="num text-right">{formatBDT(d.amount)}</span>
                  <span className="note">
                    <Who name={partnerName(d.paid_by)} color={partnerColor(d.paid_by)} /> · {formatDate(d.date)}
                    {d.created_by && ` · Entered by ${enteredBy(d.created_by)}`}
                  </span>
                  <span className="justify-self-end">
                    <DeleteButton onDelete={del(d.id)} />
                  </span>
                </li>
              ))}
            </ul>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[.08em] text-muted">
                    <th className="border-b border-line px-1.5 py-2 font-semibold">Date</th>
                    <th className="border-b border-line px-1.5 py-2 font-semibold">Paid by</th>
                    <th className="border-b border-line px-1.5 py-2 font-semibold">Details</th>
                    <th className="border-b border-line px-1.5 py-2 text-right font-semibold">Amount</th>
                    <th className="border-b border-line px-1.5 py-2 font-semibold">Entered by</th>
                    <th className="border-b border-line px-1.5 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="align-top">
                      <td className="num whitespace-nowrap border-b border-line px-1.5 py-2.5">{formatDate(d.date)}</td>
                      <td className="border-b border-line px-1.5 py-2.5">
                        <Who name={partnerName(d.paid_by)} color={partnerColor(d.paid_by)} />
                      </td>
                      <td className="border-b border-line px-1.5 py-2.5">
                        {d.category}
                        {d.note && <div className="note">{d.note}</div>}
                      </td>
                      <td className="num whitespace-nowrap border-b border-line px-1.5 py-2.5 text-right">{formatBDT(d.amount)}</td>
                      <td className="note border-b border-line px-1.5 py-2.5">{enteredBy(d.created_by)}</td>
                      <td className="border-b border-line px-1.5 py-2.5 text-right">
                        <DeleteButton onDelete={del(d.id)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="msg">
              {rows.length} {rows.length === 1 ? "payment" : "payments"} · {formatBDT(total)}
            </div>
          </>
        ) : (
          <Empty title="No partner payments yet">Log anything a partner pays for the business from his own money.</Empty>
        )}
      </div>
    </section>
  );
}
