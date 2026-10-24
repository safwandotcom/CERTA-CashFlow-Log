"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
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

export interface LedgerData {
  me: Partner;
  partners: Partner[];
  categories: Category[];
  receipts: Receipt[];
  expenses: Expense[];
  supabase: ReturnType<typeof createClient>;
  reload: () => Promise<void>;
  partnerName: (id: string | null) => string;
  partnerColor: (id: string) => string;
  enteredBy: (id: string | null) => string;
}

// PostgREST can return numeric columns as strings; normalise once here.
const money = <T extends { amount: unknown }>(rows: T[] | null) => (rows ?? []).map((r) => ({ ...r, amount: Number(r.amount) }));

export default function Ledger({ me }: { me: Partner }) {
  const supabase = useMemo(() => createClient(), []);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [status, setStatus] = useState<"loading" | "live" | "offline">("loading");
  const [tab, setTab] = useState<Tab>("received");

  const loaders = useMemo(
    () => ({
      partners: async () => {
        const { data } = await supabase.from("partners").select("id,name,email,role,sort").order("sort");
        if (data) setPartners(data as Partner[]);
      },
      categories: async () => {
        const { data } = await supabase.from("categories").select("id,name,sort").order("sort");
        if (data) setCategories(data as Category[]);
      },
      receipts: async () => {
        const { data, error } = await supabase.from("receipts").select("*").order("date", { ascending: false });
        if (error) throw error;
        setReceipts(money(data) as Receipt[]);
      },
      expenses: async () => {
        const { data, error } = await supabase.from("expenses").select("*").order("date", { ascending: false });
        if (error) throw error;
        setExpenses(money(data) as Expense[]);
      },
    }),
    [supabase],
  );

  const reload = useCallback(async () => {
    try {
      await Promise.all(Object.values(loaders).map((f) => f()));
    } catch {
      setStatus("offline");
    }
  }, [loaders]);

  useEffect(() => {
    reload();
    // Any change by any partner refetches that table, so everyone sees the same ledger.
    const channel = supabase.channel("ledger");
    (Object.keys(loaders) as (keyof typeof loaders)[]).forEach((table) =>
      channel.on("postgres_changes", { event: "*", schema: "public", table }, () => loaders[table]().catch(() => {})),
    );
    channel.subscribe((s) => {
      if (s === "SUBSCRIBED") {
        setStatus("live");
        reload(); // catch anything that changed while connecting
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") setStatus("offline");
    });
    const onFocus = () => reload();
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      supabase.removeChannel(channel);
    };
  }, [supabase, loaders, reload]);

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

  const byId = useMemo(() => new Map(partners.map((p, i) => [p.id, { p, color: PARTNER_COLORS[i % PARTNER_COLORS.length] }])), [partners]);
  const data: LedgerData = {
    me,
    partners,
    categories,
    receipts,
    expenses,
    supabase,
    reload,
    partnerName: (id) => (id && byId.get(id)?.p.name) || "A partner",
    partnerColor: (id) => byId.get(id)?.color ?? "var(--muted)",
    enteredBy: (id) => (!id ? "" : id === me.id ? "You" : byId.get(id)?.p.name ?? "A partner"),
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
        <div className="grid justify-items-end gap-1 text-xs text-muted">
          <span aria-live="polite">
            {status === "loading" ? "Connecting…" : status === "live" ? `Live · ${count} ${count === 1 ? "entry" : "entries"}` : "Offline · changes from others may be delayed"}
          </span>
          <form action="/auth/signout" method="post" className="flex items-center gap-2">
            <span>{me.name}</span>
            <button type="submit" className="cursor-pointer underline underline-offset-2">
              Sign out
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
