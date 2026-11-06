"use client";

import { useActionState } from "react";
import { unlock } from "@/app/actions";
import { Logo } from "@/components/ui";

export default function UnlockPage() {
  const [state, action, pending] = useActionState(unlock, null);

  return (
    <main className="mx-auto mt-[8vh] grid max-w-sm gap-5">
      <div className="grid justify-items-start gap-3">
        <Logo height={56} />
        <h1 className="font-display text-3xl font-bold leading-tight tracking-tight">
          <span className="sr-only">CERTA&amp; Advisory </span>CashFlow Log
        </h1>
      </div>
      <form action={action} className="card">
        <div className="field">
          <label htmlFor="passcode">Passcode</label>
          <input id="passcode" name="passcode" className="input num" type="password" inputMode="numeric" autoComplete="current-password" autoFocus required />
        </div>
        <button className="btn" type="submit" disabled={pending}>
          {pending ? "Checking…" : "Open the ledger"}
        </button>
        {state?.error && (
          <p className="msg msg-err m-0" role="alert">
            {state.error}
          </p>
        )}
      </form>
      <p className="note">This device stays unlocked for a year.</p>
    </main>
  );
}
