"use client";

import { byCategory, byMonth, formatBDT, formatMonth, partnerTotals, toCSV, today } from "@/lib/ledger";
import type { LedgerData } from "./Ledger";
import { Empty, Who } from "./ui";

export default function SummaryTab({ data }: { data: LedgerData }) {
  const { partners, receipts, expenses, partnerName, partnerColor } = data;
  const people = partnerTotals(partners, receipts, expenses);
  const cats = byCategory(expenses);
  const cmax = cats[0]?.amount || 1;
  const months = byMonth(receipts, expenses);

  function exportCSV() {
    // BOM so Excel opens the ৳ and Bangla names correctly.
    const blob = new Blob(["﻿" + toCSV(receipts, expenses, partnerName)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `certa-cashflow-log-${today()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="grid gap-5">
      <div className="grid gap-3 md:grid-cols-3">
        {people.map(({ partner, sent, paidDirectly, contributed, receiver }) => (
          <article key={partner.id} className="card border-t-[3px]" style={{ borderTopColor: partnerColor(partner.id) }}>
            <Who name={partner.name} color={partnerColor(partner.id)} bold />
            <dl className="num m-0 grid gap-1.5 text-sm">
              <Row label="Money sent" value={sent} />
              <Row label="Paid directly" value={paidDirectly} />
              <Row label="Total contributed" value={contributed} strong />
              {receiver && (
                <>
                  <Row label="Spent from money received" value={receiver.spent} />
                  <Row label="Still holding" value={receiver.holding} />
                </>
              )}
            </dl>
          </article>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card content-start">
          <h2 className="font-display text-[19px] font-semibold">Expenses by category</h2>
          {cats.length ? (
            <div className="grid gap-2.5">
              {cats.map((c) => (
                <div key={c.category} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 text-sm">
                  <span>{c.category}</span>
                  <span className="num">{formatBDT(c.amount)}</span>
                  <div className="col-span-2 h-1.5 overflow-hidden rounded-sm bg-line">
                    <span className="block h-full bg-accent" style={{ width: `${((c.amount / cmax) * 100).toFixed(1)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty title="Nothing spent yet">Expenses appear here by category.</Empty>
          )}
        </div>

        <div className="card content-start">
          <h2 className="font-display text-[19px] font-semibold">By month</h2>
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[380px] border-collapse text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-[.08em] text-muted">
                  <th className="border-b border-line px-1.5 py-2 text-left font-semibold">Month</th>
                  <th className="border-b border-line px-1.5 py-2 text-right font-semibold">Received</th>
                  <th className="border-b border-line px-1.5 py-2 text-right font-semibold">Spent</th>
                  <th className="border-b border-line px-1.5 py-2 text-right font-semibold">Paid by partners</th>
                </tr>
              </thead>
              <tbody>
                {months.length ? (
                  months.map((m) => (
                    <tr key={m.month}>
                      <td className="whitespace-nowrap border-b border-line px-1.5 py-2.5">{formatMonth(m.month)}</td>
                      <td className="num border-b border-line px-1.5 py-2.5 text-right">{formatBDT(m.received)}</td>
                      <td className="num border-b border-line px-1.5 py-2.5 text-right">{formatBDT(m.spent)}</td>
                      <td className="num border-b border-line px-1.5 py-2.5 text-right">{formatBDT(m.direct)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} className="note px-1.5 py-2.5">
                      Months appear once entries are logged.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div>
        <button className="btn btn-ghost" type="button" onClick={exportCSV} disabled={!receipts.length && !expenses.length}>
          Export everything as CSV
        </button>
      </div>
    </section>
  );
}

function Row({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-2 ${strong ? "border-t border-dashed border-line pt-2 font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-muted"}>{label}</dt>
      <dd className="m-0">{formatBDT(value)}</dd>
    </div>
  );
}
