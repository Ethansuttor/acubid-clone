"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase().auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      const { data } = await supabase()
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      setProjects((data as Project[]) ?? []);
    })();
  }, [router]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { data: auth } = await supabase().auth.getUser();
    if (!auth.user) return;
    const { data, error } = await supabase()
      .from("projects")
      .insert({
        name: name.trim(),
        user_id: auth.user.id,
        labor_rate: 0,
        overhead_pct: 0,
        profit_pct: 0,
        waste_pct: 0,
        tax_pct: 0,
        labor_factor_pct: 0,
        labor_burden_pct: 0,
        small_tools_pct: 0,
        escalation_pct: 0,
        contingency_pct: 0,
        bond_pct: 0,
      })
      .select()
      .single();
    if (!error && data) router.push(`/project/${data.id}`);
  }

  async function deleteProject(p: Project) {
    if (!confirm(`Delete project "${p.name}" and all of its takeoff?`)) return;
    await supabase().from("projects").delete().eq("id", p.id);
    setProjects((ps) => (ps ?? []).filter((x) => x.id !== p.id));
  }

  return (
    <div className="blueprint h-full overflow-auto">
      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="mb-10 flex items-end justify-between">
          <div>
            <div className="font-mono text-3xl font-bold tracking-widest text-[var(--color-volt)]">
              VOLTLINE
            </div>
            <div className="titlebar">Estimating &amp; Takeoff</div>
          </div>
          <button
            className="btn"
            onClick={async () => {
              await supabase().auth.signOut();
              router.replace("/login");
            }}
          >
            Sign out
          </button>
        </div>

        <form onSubmit={createProject} className="mb-6 flex gap-2">
          <input
            className="input flex-1"
            placeholder="New project name…"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <button className="btn btn-volt" type="submit">
            Create project
          </button>
        </form>

        <div className="panel">
          {projects === null ? (
            <div className="p-6 text-[var(--color-fg-dim)]">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="p-6 text-[var(--color-fg-dim)]">
              No projects yet. Create one above to start a bid.
            </div>
          ) : (
            <table className="tbl">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Last updated</th>
                  <th className="r">Actions</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button
                        className="cursor-pointer font-medium text-[var(--color-fg)] hover:text-[var(--color-volt)]"
                        onClick={() => router.push(`/project/${p.id}`)}
                      >
                        {p.name}
                      </button>
                    </td>
                    <td className="num text-[var(--color-fg-dim)]">
                      {new Date(p.updated_at).toLocaleString()}
                    </td>
                    <td className="r">
                      <button className="btn btn-danger !py-0.5 text-xs" onClick={() => deleteProject(p)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
