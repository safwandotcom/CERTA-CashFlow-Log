"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { loadLedger, lock, setActingAs, type LedgerSnapshot } from "@/app/actions";
import { formatBDT, receiptBalances, totals, type Category, type Expense, type Partner, type Receipt } from "@/lib/ledger";
import { PARTNER_COLORS } from "./ui";
import ReceivedTab from "./ReceivedTab";
import DirectTab from "./DirectTab";
import SummaryTab from "./SummaryTab";
import SettingsTab from "./SettingsTab";

const TABS = [
  { id: "received", label: "Money received" },
  { id: "direct", label: "Paid by partners" },
  { id: "summary", label: "Summary" },
  { id: "settings", label: "Settings" },
] as const;
type Tab = (typeof TABS)[number]["id"];
const REFRESH_MS = 20_000;

export interface LedgerData {
  partners: Partner[];
  categories: Category[];
  receipts: Receipt[];
  expenses: Expense[];
  reload: () => Promise<void>;
  partnerName: (id: string | null) => string;
  partnerColor: (id: string) => string;
  enteredBy: (id: string | null) => string;
}

export default function Ledger({ initial }: { initial: LedgerSnapshot }) {
  const [snap, setSnap] = useState(initial);
  const [status, setStatus] = useState<"live" | "offline">("live");
  const [tab, setTab] = useState<Tab>("received");

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
      const h = window.location.hash.slice(1);
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

  const { partners, categories, receipts, expenses, actingAs } = snap;
  const byId = useMemo(() => new Map(partners.map((p, i) => [p.id, { p, color: PARTNER_COLORS[i % PARTNER_COLORS.length] }])), [partners]);
  const data: LedgerData = {
    partners,
    categories,
    receipts,
    expenses,
    reload,
    partnerName: (id) => (id && byId.get(id)?.p.name) || "A partner",
    partnerColor: (id) => byId.get(id)?.color ?? "var(--muted)",
    enteredBy: (id) => (id && byId.get(id)?.p.name) || "",
  };

  const t = totals(receipts, expenses);
  const balances = useMemo(() => receiptBalances(receipts, expenses), [receipts, expenses]);
  const count = receipts.length + expenses.length;

  return (
    <div className="mx-auto grid max-w-[960px] gap-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="eyebrow">Shared business ledger · BDT</div>
          <h1 className="font-display text-[clamp(26px,6vw,36px)] font-extrabold leading-[1.1] tracking-tight">CERTA&amp; Advisory CashFlow Log</h1>
          <p className="mt-1 max-w-[56ch] text-muted">Log money when it's received, log each expense against the money it came from, and log anything a partner pays directly.</p>
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
          ["Money received", t.received],
          ["Spent from it", t.spent],
          ["Left in hand", t.left],
          ["Paid by partners", t.direct],
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

      {tab === "received" && <ReceivedTab data={data} balances={balances} />}
      {tab === "direct" && <DirectTab data={data} />}
      {tab === "summary" && <SummaryTab data={data} />}
      {tab === "settings" && <SettingsTab data={data} />}
    </div>
  );
}
