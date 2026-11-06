"use client";

import { useEffect, useMemo, useState } from "react";
import { addMoneyIn, deleteRecord } from "@/app/actions";
import { companyNames, formatBDT, formatDate, newestFirst, parseAmount, today, type Kind, type MoneyIn } from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { AmountInput, Choice, DeleteButton, Empty, FormMsg, Who, type Msg } from "./ui";

export default function MoneyInTab({ data }: { data: LedgerData }) {
  const rows = useMemo(() => [...data.moneyIn].sort(newestFirst), [data.moneyIn]);
  const total = rows.reduce((s, m) => s + Math.round(m.amount * 100), 0) / 100;

  return (
    <section className="grid gap-5">
      <MoneyInForm data={data} />
      <div className="card">
        {rows.length ? (
          <>
            <ul className="grid">
              {rows.map((m) => (
                <MoneyInRow key={m.id} m={m} data={data} />
              ))}
            </ul>
            <div className="msg">
              {rows.length} {rows.length === 1 ? "entry" : "entries"} · {formatBDT(total)}
            </div>
          </>
        ) : (
          <Empty title="No money in yet">When a company pays CERTA&amp; Advisory, or a partner puts money in, log it above.</Empty>
        )}
      </div>
    </section>
  );
}

function MoneyInForm({ data }: { data: LedgerData }) {
  const { partners, moneyIn, reload, partnerName } = data;
  const [kind, setKind] = useState<Kind>("revenue");
  const [company, setCompany] = useState("");
  const [partner, setPartner] = useState("");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const names = useMemo(() => companyNames(moneyIn), [moneyIn]);

  useEffect(() => {
    if (!partner && partners.length) setPartner(partners[0].id);
  }, [partners, partner]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const a = parseAmount(amount);
    if (kind === "revenue" && !company.trim()) return setMsg({ text: "Type the company's name.", err: true });
    if (!(a > 0)) return setMsg({ text: "Enter the amount received.", err: true });
    if (!date) return setMsg({ text: "Pick the date received.", err: true });
    setBusy(true);
    const res = await addMoneyIn({ kind, company, partnerId: partner, date, amount: a, note });
    setBusy(false);
    if ("error" in res) return setMsg({ text: res.error, err: true });
    setMsg({
      text: kind === "revenue" ? `Logged ${formatBDT(a)} revenue from ${company.trim()}.` : `Logged ${formatBDT(a)} invested by ${partnerName(partner)}.`,
    });
    setAmount("");
    setNote("");
    reload();
  }

  return (
    <div className="card">
      <h2 className="font-display text-[19px] font-semibold">Log money into the bank account</h2>
      <form onSubmit={submit} noValidate className="grid grid-cols-2 gap-3">
        <Choice
          label="Where did it come from?"
          value={kind}
          onChange={(k) => {
            setKind(k);
            setMsg(null);
          }}
          options={[
            { value: "revenue", label: "A company (Revenue)" },
            { value: "investment", label: "A partner (Investment)" },
          ]}
        />
        {kind === "revenue" ? (
          <div className="field col-span-2">
            <label htmlFor="mCompany">Company name</label>
            <input
              id="mCompany"
              className="input"
              list="mCompanies"
              maxLength={80}
              autoComplete="off"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Taj Consultancy"
            />
            <datalist id="mCompanies">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>
        ) : (
          <div className="field col-span-2">
            <label htmlFor="mPartner">Partner</label>
            <select id="mPartner" className="input" value={partner} onChange={(e) => setPartner(e.target.value)}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="mAmount">Amount (৳)</label>
          <AmountInput id="mAmount" value={amount} onChange={setAmount} placeholder="1,50,000" />
        </div>
        <div className="field">
          <label htmlFor="mDate">Date received</label>
          <input id="mDate" type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field col-span-2">
          <label htmlFor="mNote">Note</label>
          <input
            id="mNote"
            className="input"
            maxLength={200}
            autoComplete="off"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={kind === "revenue" ? "e.g. October staff supply" : "e.g. Capital for November salaries"}
          />
        </div>
        <div className="col-span-2 flex flex-wrap items-center gap-2.5">
          <button className="btn btn-green" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Log money in"}
          </button>
          <FormMsg msg={msg} />
        </div>
      </form>
    </div>
  );
}

function MoneyInRow({ m, data }: { m: MoneyIn; data: LedgerData }) {
  const { reload, partnerName, partnerColor, enteredBy } = data;
  const isRevenue = m.kind === "revenue";

  async function del() {
    const res = await deleteRecord("money_in", m.id);
    if ("error" in res) return res.error;
    await reload();
    return null;
  }

  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 gap-y-1 border-b border-line py-2.5 text-sm last:border-0 sm:grid-cols-[96px_minmax(0,1fr)_auto_auto]">
      <span className="num col-span-full text-xs text-muted sm:col-span-1 sm:text-sm sm:text-ink">{formatDate(m.date)}</span>
      <span className="min-w-0">
        <span className={`badge mr-2 ${isRevenue ? "bg-green-soft text-green" : "bg-amber-soft text-amber"}`}>{isRevenue ? "Revenue" : "Investment"}</span>
        {isRevenue ? <span className="font-medium">{m.company}</span> : <Who name={partnerName(m.partner_id)} color={partnerColor(m.partner_id ?? "")} />}
        {m.note && <div className="note">{m.note}</div>}
        {m.created_by && <div className="note">Entered by {enteredBy(m.created_by)}</div>}
      </span>
      <span className="num whitespace-nowrap text-right font-medium text-green">{formatBDT(m.amount)}</span>
      <span className="col-start-2 justify-self-end sm:col-start-auto">
        <DeleteButton onDelete={del} />
      </span>
    </li>
  );
}
