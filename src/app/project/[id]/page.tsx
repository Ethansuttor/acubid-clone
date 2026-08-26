"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  Calculator,
  Database,
  FileStack,
  ListTree,
  ReceiptText,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/store/workspace";
import TakeoffView from "@/components/takeoff/TakeoffView";
import DatabaseView from "@/components/estimate/DatabaseView";
import EstimateView from "@/components/estimate/EstimateView";
import SummaryView from "@/components/estimate/SummaryView";
import ScopeView from "@/components/estimate/ScopeView";

const TABS = [
  { id: "takeoff", icon: FileStack },
  { id: "estimate", icon: Calculator },
  { id: "scope", icon: ListTree },
  { id: "database", icon: Database },
  { id: "summary", icon: ReceiptText },
] as const;
type Tab = (typeof TABS)[number]["id"];

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const ws = useWorkspace();
  const [tab, setTab] = useState<Tab>("takeoff");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase().auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      await ws.load(id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useEffect(() => {
    if (ws.pendingWrites === 0 && ws.saveState !== "error") return;
    const protectUnsavedChanges = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", protectUnsavedChanges);
    return () => window.removeEventListener("beforeunload", protectUnsavedChanges);
  }, [ws.pendingWrites, ws.saveState]);

  if (ws.loaded && ws.loadError) {
    return (
      <div className="workspace-loading" role="alert" aria-live="assertive">
        <span className="brand-mark !bg-[var(--color-danger)]" aria-hidden="true"><AlertTriangle size={18} /></span>
        <div className="max-w-md">
          <div className="text-sm font-semibold text-[var(--color-fg)]">Project data is incomplete</div>
          <div className="mt-1 text-xs leading-5 text-[var(--color-fg-dim)]">{ws.loadError}</div>
          <Link href="/" className="btn mt-4 w-fit"><ArrowLeft size={15} /> Back to projects</Link>
        </div>
      </div>
    );
  }

  if (!ws.loaded || !ws.project) {
    return (
      <div className="workspace-loading" role="status" aria-live="polite" aria-busy="true">
        <span className="brand-mark" aria-hidden="true"><Zap size={18} /></span>
        <div>
          <div className="text-sm font-medium text-[var(--color-fg)]">Opening project</div>
          <div className="mt-1 text-xs text-[var(--color-fg-dim)]">Loading sheets, takeoff, and pricing…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-shell">
      <header className="workspace-header">
        <Link href="/" className="icon-button" aria-label="Back to projects" title="Back to projects">
          <ArrowLeft size={17} />
        </Link>
        <Link href="/" className="workspace-brand" aria-label="Voltline projects">
          <span className="brand-mark small"><Zap size={14} strokeWidth={2.5} /></span>
          <span>Voltline</span>
        </Link>
        <span className="workspace-divider" />
        <div className="workspace-project">
          <span className="truncate font-medium">{ws.project.name}</span>
          <span className="status-pill status-pill-neutral">Draft</span>
        </div>

        <nav className="workspace-tabs" aria-label="Project views">
          {TABS.map(({ id: tabId, icon: Icon }) => (
            <button
              key={tabId}
              className={`tab ${tab === tabId ? "active" : ""}`}
              onClick={() => setTab(tabId)}
              aria-current={tab === tabId ? "page" : undefined}
            >
              <Icon size={15} />
              {tabId}
            </button>
          ))}
        </nav>

        <div
          className={`save-indicator ${ws.saveState}`}
          role={ws.saveState === "error" ? "alert" : "status"}
          aria-live="polite"
          aria-atomic="true"
          title={ws.saveError ?? `${ws.pendingWrites} pending changes`}
        >
          <span className="status-dot" aria-hidden="true" />
          {ws.saveState === "error"
            ? `${ws.failedWrites} save ${ws.failedWrites === 1 ? "failure" : "failures"}`
            : ws.saveState === "saving"
            ? `Saving ${ws.pendingWrites}`
            : "Saved locally"}
        </div>
        <span className="user-avatar small" title="Local user 1">1</span>
      </header>

      <div className="min-h-0 flex-1">
        {tab === "takeoff" && <TakeoffView />}
        {tab === "estimate" && <EstimateView />}
        {tab === "scope" && <ScopeView />}
        {tab === "database" && <DatabaseView />}
        {tab === "summary" && <SummaryView />}
      </div>
    </div>
  );
}
