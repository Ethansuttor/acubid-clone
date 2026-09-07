"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HardDrive, Zap } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { LOCAL_PASSWORD, LOCAL_USERNAME } from "@/lib/local-config";

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState(LOCAL_USERNAME);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: signInError } = await supabase().auth.signInWithPassword({
      email: username.trim(),
      password: LOCAL_PASSWORD,
    });
    setBusy(false);
    if (signInError) setError(signInError.message);
    else router.replace("/");
  }

  return (
    <main className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Zap size={18} strokeWidth={2.5} />
          </span>
          <span className="brand-name">Voltline</span>
        </div>

        <h1 id="login-title" className="mt-8 text-lg font-semibold tracking-[-0.02em]">
          Open your workspace
        </h1>

        <form onSubmit={signIn} className="mt-5">
          <label className="field-label" htmlFor="username">
            Username
          </label>
          <input
            id="username"
            name="username"
            className="input h-11"
            type="text"
            inputMode="numeric"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            aria-describedby="login-help"
          />
          <div id="login-help" className="mt-2 text-xs text-[var(--color-fg-dim)]">
            No password in local mode.
          </div>

          {error && (
            <div className="form-error mt-4" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-volt mt-5 h-10 w-full justify-center" disabled={busy} type="submit">
            {busy ? "Opening workspace…" : "Open workspace"}
          </button>
        </form>

        <div className="mt-7 flex items-center gap-2 border-t border-[var(--color-line)] pt-4 text-xs text-[var(--color-fg-faint)]">
          <HardDrive size={13} />
          Estimates are stored on this device.
        </div>
      </section>
    </main>
  );
}
