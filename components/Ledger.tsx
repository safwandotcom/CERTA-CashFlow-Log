"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLedger, lock, setActingAs, type LedgerSnapshot } from "@/app/actions";
import { formatBDT, totals, type Category, type Expense, type MoneyIn, type Partner } from "@/lib/ledger";
import { Logo, PARTNER_COLORS } from "./ui";
import MoneyInTab from "./MoneyInTab";
import ExpensesTab from "./ExpensesTab";
import SummaryTab from "./SummaryTab";
import SettingsTab from "./SettingsTab";

const TABS = [
  { id: "in", label: "Money in" },
  { id: "expenses", label: "Expenses" },
  { id: "summary", label: "Summary" },
  { id: "settings", label: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const REFRESH_MS = 20_000;
// Old links keep working.
const ALIASES: Record<string, Tab> = { received: "in", direct: "expenses" };

export interface LedgerData {
  partners: Partner[];
  categories: Category[];
  moneyIn: MoneyIn[];
  expenses: Expense[];
  /** Current company bank balance. */
  bank: number;
  reload: () => Promise<void>;
  partnerName: (id: string | null) => string;
  partnerColor: (id: string) => string;
  enteredBy: (id: string | null) => string;
}

export default function Ledger({ initial }: { initial: LedgerSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [status, setStatus] = useState<"live" | "offline">("live");
  const [tab, setTab] = useState<Tab>("in");

  const reload = useCallback(async () => {
    try {
      setSnap(await loadLedger());
      setStatus("live");
    } catch {
      setStatus("offline");
    }
  }, []);

  // Keep other devices' changes flowing in: refresh on a timer while visible, and on focus.
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && reload();
    const id = setInterval(tick, REFRESH_MS);
    window.addEventListener("focus", reload);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", reload);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [reload]);

  useEffect(() => {
    const fromHash = () => {
      const raw = window.location.hash.slice(1);
      const h = ALIASES[raw] ?? raw;
      if (TABS.some((t) => t.id === h)) setTab(h as Tab);
    };
    fromHash();
    window.addEventListener("hashchange", fromHash);
    return () => window.removeEventListener("hashchange", fromHash);
  }, []);

  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t}`);
  };

  async function changeActor(id: string) {
    setSnap((s) => ({ ...s, actingAs: id }));
    await setActingAs(id);
  }

  const { partners, categories, moneyIn, expenses, actingAs } = snap;
  const byId = useMemo(() => new Map(partners.map((p, i) => [p.id, { p, color: PARTNER_COLORS[i % PARTNER_COLORS.length] }])), [partners]);
  const t = useMemo(() => totals(moneyIn, expenses), [moneyIn, expenses]);
  const data: LedgerData = {
    partners,
    categories,
    moneyIn,
    expenses,
    bank: t.bank,
    reload,
    partnerName: (id) => (id && byId.get(id)?.p.name) || "A partner",
    partnerColor: (id) => byId.get(id)?.color ?? "var(--muted)",
    enteredBy: (id) => (id && byId.get(id)?.p.name) || "",
  };

  const count = moneyIn.length + expenses.length;

  return (
    <div className="mx-auto grid max-w-[960px] gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Logo height={48} />
          <h1 className="mt-3 font-display text-[clamp(24px,5.5vw,32px)] font-bold leading-[1.15] tracking-tight">
            <span className="sr-only">CERTA&amp; Advisory </span>CashFlow Log
          </h1>
          <p className="mt-1 max-w-[56ch] text-muted">Log money coming into the CERTA&amp; Advisory bank account, and every company expense, whether it's paid from the bank or by a partner.</p>
        </div>
        <div className="grid justify-items-start gap-1.5 text-xs text-muted sm:justify-items-end">
          <span aria-live="polite">{status === "live" ? `Up to date · ${count} ${count === 1 ? "entry" : "entries"}` : "Can't reach the ledger · retrying"}</span>
          <label className="flex items-center gap-2">
            Entering as
            <select className="input w-auto py-1 text-xs" value={actingAs ?? ""} onChange={(e) => changeActor(e.target.value)}>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <form action={lock}>
            <button type="submit" className="cursor-pointer underline underline-offset-2">
              Lock this device
            </button>
          </form>
        </div>
      </header>

      <section aria-label="Totals" className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line bg-line sm:grid-cols-4">
        {[
          ["Bank balance", t.bank],
          ["Revenue", t.revenue],
          ["Partner investment", t.investment],
          ["Company expenses", t.expenses],
        ].map(([label, v]) => (
          <div key={label as string} className="grid min-w-0 gap-0.5 bg-surface px-3.5 py-3">
            <span className="eyebrow">{label}</span>
            <b className="num text-[17px] font-medium [overflow-wrap:anywhere]">{formatBDT(v as number)}</b>
          </div>
        ))}
      </section>

      <nav role="tablist" aria-label="Views" className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
        {TABS.map((x) => (
          <button
            key={x.id}
            role="tab"
            aria-selected={tab === x.id}
            onClick={() => pick(x.id)}
            className={`tab cursor-pointer whitespace-nowrap border-b-2 px-3 py-2.5 font-medium ${tab === x.id ? "border-accent text-ink" : "border-transparent text-muted"}`}
          >
            {x.label}
          </button>
        ))}
      </nav>

      {tab === "in" && <MoneyInTab data={data} />}
      {tab === "expenses" && <ExpensesTab data={data} />}
      {tab === "summary" && <SummaryTab data={data} />}
      {tab === "settings" && <SettingsTab data={data} />}
    </div>
  );
}
