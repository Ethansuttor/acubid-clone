"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { WORKSPACE_LOCK } from "@/lib/local-config";
import { waitForWorkspaceWrites } from "@/store/workspace";

/** A local estimate must have one editor: the catalog is shared by every bid. */
export default function WorkspaceAccess({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState("checking");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    let release = () => {};
    if (!navigator.locks) {
      queueMicrotask(() => { if (active) setStatus("unsupported"); });
      return () => { active = false; };
    }
    // Defer acquisition so React's Strict Mode setup/cleanup probe cannot
    // briefly hold a lock against the real mount in the same tab.
    queueMicrotask(() => {
      if (!active) return;
      void navigator.locks.request(WORKSPACE_LOCK, { ifAvailable: true }, async lock => {
        if (!active) return;
        if (!lock) { setStatus("busy"); return; }
        setStatus("ready");
        await new Promise<void>(resolve => { release = resolve; });
      }).catch(() => { if (active) setStatus("error"); });
    });
    return () => { active = false; void waitForWorkspaceWrites().then(release, release); };
  }, [attempt]);
  if (status === "ready") return children;
  return <main className="workspace-loading">
    <div className="max-w-md">
      <h1 className="text-lg font-semibold">{status === "checking" ? "Opening workspace…" : status === "busy" ? "Workspace is open in another tab" : "Workspace protection unavailable"}</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--color-fg-dim)]">{status === "busy" ? "Finish saving and return to Projects in the other tab, then try again. One editing tab keeps your shared catalog and bid revisions consistent." : status !== "checking" ? "Open Voltline in a current browser with Web Locks support to protect local edits." : "Checking access to your local estimates."}</p>
      {status !== "checking" && <div className="mt-4 flex gap-2"><button className="btn btn-volt" onClick={() => { setStatus("checking"); setAttempt(value => value + 1); }}>Try again</button><Link className="btn" href="/">Back to projects</Link></div>}
    </div>
  </main>;
}
