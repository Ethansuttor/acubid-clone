"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useWorkspace } from "@/store/workspace";
import TakeoffView from "@/components/takeoff/TakeoffView";
import DatabaseView from "@/components/estimate/DatabaseView";
import EstimateView from "@/components/estimate/EstimateView";
import SummaryView from "@/components/estimate/SummaryView";

const TABS = ["takeoff", "estimate", "database", "summary"] as const;
type Tab = (typeof TABS)[number];

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

  if (!ws.loaded || !ws.project) {
    return (
      <div className="blueprint flex h-full items-center justify-center text-[var(--color-fg-dim)]">
        Loading project…
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="panel flex items-center border-x-0 border-t-0 px-3">
        <Link
          href="/"
          className="mr-4 font-mono text-sm font-bold tracking-widest text-[var(--color-volt)]"
        >
          VOLTLINE
        </Link>
        <span className="mr-6 max-w-64 truncate text-sm text-[var(--color-fg-dim)]">
          {ws.project.name}
        </span>
        {TABS.map((t) => (
          <button key={t} className={`tab ${tab === t ? "active" : ""}`} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </header>
      <div className="min-h-0 flex-1">
        {tab === "takeoff" && <TakeoffView />}
        {tab === "estimate" && <EstimateView />}
        {tab === "database" && <DatabaseView />}
        {tab === "summary" && <SummaryView />}
      </div>
    </div>
  );
}
