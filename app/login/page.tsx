"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("error")) setError("That sign-in link has expired or was already used. Ask for a new one.");
  }, []);

  const redirectTo = () => `${window.location.origin}/auth/callback`;

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const addr = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(addr)) return setError("Enter your email address.");
    setState("sending");
    const { error } = await createClient().auth.signInWithOtp({
      email: addr,
      // Only partners who have been invited can sign in.
      options: { emailRedirectTo: redirectTo(), shouldCreateUser: false },
    });
    if (error) {
      setState("idle");
      setError(/not allowed|signups not allowed|not found/i.test(error.message) ? "This email hasn't been invited. Ask Towfiq to invite you." : error.message);
    } else setState("sent");
  }

  async function google() {
    setError("");
    const { error } = await createClient().auth.signInWithOAuth({ provider: "google", options: { redirectTo: redirectTo() } });
    if (error) setError(error.message);
  }

  return (
    <main className="mx-auto mt-[8vh] grid max-w-sm gap-5">
      <div>
        <div className="eyebrow">Shared business ledger · BDT</div>
        <h1 className="font-display text-3xl font-extrabold leading-tight tracking-tight">CERTA&amp; Advisory CashFlow Log</h1>
      </div>
      <div className="card">
        {state === "sent" ? (
          <div className="grid gap-2">
            <h2 className="font-display text-lg font-semibold">Check your email</h2>
            <p className="note">
              We sent a sign-in link to <b className="text-ink">{email.trim()}</b>. Open it on this device.
            </p>
            <button className="btn btn-ghost justify-self-start" type="button" onClick={() => setState("idle")}>
              Use a different email
            </button>
          </div>
        ) : (
          <>
            <form onSubmit={sendLink} className="grid gap-3" noValidate>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <button className="btn" type="submit" disabled={state === "sending"}>
                {state === "sending" ? "Sending…" : "Email me a sign-in link"}
              </button>
            </form>
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="h-px flex-1 bg-line" />
              or
              <span className="h-px flex-1 bg-line" />
            </div>
            <button className="btn btn-ghost" type="button" onClick={google}>
              Continue with Google
            </button>
          </>
        )}
        {error && (
          <p className="msg msg-err" role="alert">
            {error}
          </p>
        )}
      </div>
      <p className="note">Only the three invited partners can see this ledger.</p>
    </main>
  );
}
