"use client";

import { useEffect, useRef, useState } from "react";
import { groupInput } from "@/lib/ledger";

export const PARTNER_COLORS = ["var(--p0)", "var(--p1)", "var(--p2)"];

export function Who({ name, color, bold }: { name: string; color: string; bold?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${bold ? "font-semibold" : ""}`}>
      <span className="size-2.5 flex-none rounded-full" style={{ background: color }} aria-hidden />
      {name}
    </span>
  );
}

/** Two-tap delete: first tap arms it, second deletes. No browser confirm(). */
export function DeleteButton({ onDelete, blockedReason }: { onDelete: () => Promise<string | null>; blockedReason?: string }) {
  const [state, setState] = useState<"idle" | "confirm" | "busy" | "blocked" | "error">("idle");
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const reset = (ms: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), ms);
  };

  async function click() {
    if (blockedReason) {
      setState("blocked");
      return reset(4000);
    }
    if (state !== "confirm") {
      setState("confirm");
      return reset(4000);
    }
    clearTimeout(timer.current);
    setState("busy");
    const err = await onDelete();
    if (err) {
      setError(err);
      setState("error");
      reset(5000);
    }
  }

  const label =
    state === "confirm" ? "Tap to confirm" : state === "busy" ? "Deleting…" : state === "blocked" ? blockedReason : state === "error" ? error : "Delete";
  const armed = state === "confirm" || state === "error" || state === "blocked";
  return (
    <button
      type="button"
      onClick={click}
      disabled={state === "busy"}
      aria-live="polite"
      className={`cursor-pointer whitespace-nowrap rounded-md border px-2 py-1 text-xs ${armed ? "border-accent text-accent" : "border-line text-muted"}`}
    >
      {label}
    </button>
  );
}

/** Amount field that groups digits Indian-style as you type. */
export function AmountInput({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input
      id={id}
      className="input num"
      inputMode="decimal"
      autoComplete="off"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(groupInput(e.target.value))}
    />
  );
}

export function Empty({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="grid justify-items-center gap-1.5 px-3 py-6 text-center text-muted">
      <strong className="font-display text-[17px] text-ink">{title}</strong>
      <span>{children}</span>
    </div>
  );
}

export type Msg = { text: string; err?: boolean } | null;

export function FormMsg({ msg }: { msg: Msg }) {
  return (
    <span className={`msg ${msg?.err ? "msg-err" : ""}`} role={msg?.err ? "alert" : undefined} aria-live="polite">
      {msg?.text}
    </span>
  );
}
