"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
    else router.push("/");
  }

  return (
    <div className="blueprint flex h-full items-center justify-center">
      <form onSubmit={signIn} className="panel w-[360px] p-8">
        <div className="mb-1 font-mono text-2xl font-bold tracking-widest text-[var(--color-volt)]">
          VOLTLINE
        </div>
        <div className="titlebar mb-8">Estimating &amp; Takeoff</div>
        <label className="titlebar mb-1 block">Email</label>
        <input
          className="input mb-4"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          required
        />
        <label className="titlebar mb-1 block">Password</label>
        <input
          className="input mb-6"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        {error && <div className="mb-4 text-xs text-[var(--color-danger)]">{error}</div>}
        <button className="btn btn-volt w-full justify-center" disabled={busy} type="submit">
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
