"use client";

import { useActionState } from "react";
import { unlock } from "@/app/actions";

export default function UnlockPage() {
  const [state, action, pending] = useActionState(unlock, null);

  return (
    <main className="mx-auto mt-[8vh] grid max-w-sm gap-5">
      <div>
        <div className="eyebrow">Shared business ledger · BDT</div>
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">CERTA&amp; Advisory CashFlow Log</h1>
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
