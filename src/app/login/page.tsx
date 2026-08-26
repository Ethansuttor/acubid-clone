"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, HardDrive, Zap } from "lucide-react";
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

        <div className="mt-10">
          <div className="eyebrow">Estimator access</div>
          <h1 id="login-title" className="mt-2 text-2xl font-semibold tracking-[-0.03em]">
            Open your workspace
          </h1>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--color-fg-dim)]">
            This build runs locally on this device. No cloud account or password is required.
          </p>
        </div>

        <form onSubmit={signIn} className="mt-8">
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
          <div id="login-help" className="mt-2 flex items-center gap-2 text-xs text-[var(--color-fg-dim)]">
            <Check size={14} className="text-[var(--color-ok)]" />
            Username is prefilled. Password is disabled in local mode.
          </div>

          {error && (
            <div className="form-error mt-4" role="alert">
              {error}
            </div>
          )}

          <button className="btn btn-volt mt-6 h-11 w-full justify-center" disabled={busy} type="submit">
            {busy ? "Opening workspace…" : "Open workspace"}
            {!busy && <ArrowRight size={16} />}
          </button>
        </form>

        <div className="mt-8 flex items-center justify-between border-t border-[var(--color-line)] pt-5 text-xs text-[var(--color-fg-dim)]">
          <span className="inline-flex items-center gap-2">
            <HardDrive size={14} /> Local storage
          </span>
          <span className="status-pill status-pill-neutral">Prototype mode</span>
        </div>
      </section>
    </main>
  );
}
