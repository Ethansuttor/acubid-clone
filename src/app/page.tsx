"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Clock3,
  Folder,
  LogOut,
  Plus,
  Search,
  Trash2,
  Zap,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Project } from "@/lib/types";
import DataProtectionCard from "@/components/DataProtectionCard";

function formatUpdated(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase().auth.getUser();
      if (!auth.user) {
        router.replace("/login");
        return;
      }
      const { data, error: loadError } = await supabase()
        .from("projects")
        .select("*")
        .order("updated_at", { ascending: false });
      if (loadError) setError("Projects could not be loaded from this device.");
      setProjects((data as Project[]) ?? []);
    })();
  }, [router]);

  const visibleProjects = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return projects ?? [];
    return (projects ?? []).filter((project) => project.name.toLowerCase().includes(normalized));
  }, [projects, query]);

  async function createProject(e: React.FormEvent) {
    e.preventDefault();
    const projectName = name.trim();
    if (!projectName || busy) return;
    setBusy(true);
    setError(null);

    const { data: auth } = await supabase().auth.getUser();
    if (!auth.user) {
      setBusy(false);
      router.replace("/login");
      return;
    }

    const { data, error: createError } = await supabase()
      .from("projects")
      .insert({
        name: projectName,
        user_id: auth.user.id,
        labor_rate: 0,
        overhead_pct: 0,
        profit_pct: 0,
        waste_pct: 0,
        tax_pct: 0,
        labor_factor_pct: 0,
      })
      .select()
      .single();

    if (createError || !data) {
      setError("The project could not be created. Try again.");
      setBusy(false);
      return;
    }

    setName("");
    router.push(`/project/${data.id}`);
  }

  async function deleteProject(project: Project) {
    if (
      !confirm(
        `Delete project "${project.name}" and all sheets, takeoff, direct costs, and bid revisions? This cannot be undone.`
      )
    )
      return;
    const { error: deleteError } = await supabase().from("projects").delete().eq("id", project.id);
    if (deleteError) {
      setError(`Could not delete “${project.name}”.`);
      return;
    }
    setProjects((current) => (current ?? []).filter((item) => item.id !== project.id));
  }

  async function signOut() {
    await supabase().auth.signOut();
    router.replace("/login");
  }

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="brand-lockup px-5 py-5">
          <span className="brand-mark" aria-hidden="true">
            <Zap size={18} strokeWidth={2.5} />
          </span>
          <span className="brand-name">Voltline</span>
        </div>

        <nav className="mt-5 px-3" aria-label="Primary">
          <div className="sidebar-label">Workspace</div>
          <button className="sidebar-link active" type="button">
            <Folder size={17} />
            Projects
            <span className="sidebar-count">{projects?.length ?? 0}</span>
          </button>
        </nav>

        <div className="mt-auto p-3">
          <DataProtectionCard />
          <div className="user-row">
            <span className="user-avatar" aria-hidden="true">1</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">Estimator 1</div>
              <div className="text-xs text-[var(--color-fg-dim)]">Local user</div>
            </div>
            <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <div className="eyebrow">Bid workspace</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-0.03em]">Projects</h1>
            <p className="mt-1 text-sm text-[var(--color-fg-dim)]">
              Start a bid or return to an estimate already in progress.
            </p>
          </div>
          <span className="status-pill status-pill-success">
            <span className="status-dot" /> Local mode
          </span>
        </header>

        <div className="dashboard-content">
          <section className="create-project-card" aria-labelledby="create-project-title">
            <div className="create-project-copy">
              <span className="feature-icon" aria-hidden="true"><Plus size={18} /></span>
              <div>
                <h2 id="create-project-title" className="text-sm font-semibold">Create a project</h2>
                <p className="mt-1 text-xs text-[var(--color-fg-dim)]">A blank estimate with takeoff, pricing, and summary tools.</p>
              </div>
            </div>
            <form onSubmit={createProject} className="create-project-form">
              <label className="sr-only" htmlFor="new-project-name">Project name</label>
              <input
                id="new-project-name"
                className="input h-10"
                placeholder="New project name…"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="off"
              />
              <button className="btn btn-volt h-10 shrink-0" type="submit" disabled={!name.trim() || busy}>
                <Plus size={16} />
                {busy ? "Creating…" : "Create project"}
              </button>
            </form>
          </section>

          {error && <div className="form-error mt-4" role="alert">{error}</div>}

          <section className="projects-panel" aria-labelledby="project-list-title">
            <div className="projects-toolbar">
              <div>
                <h2 id="project-list-title" className="text-sm font-semibold">Recent projects</h2>
                <p className="mt-1 text-xs text-[var(--color-fg-dim)]">
                  {projects === null ? "Loading…" : `${projects.length} ${projects.length === 1 ? "project" : "projects"}`}
                </p>
              </div>
              <div className="search-field">
                <Search size={15} aria-hidden="true" />
                <label className="sr-only" htmlFor="project-search">Search projects</label>
                <input
                  id="project-search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search projects"
                />
              </div>
            </div>

            {projects === null ? (
              <div className="project-loading" aria-label="Loading projects">
                <span /><span /><span />
              </div>
            ) : visibleProjects.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-icon"><Folder size={20} /></span>
                <h3 className="mt-4 text-sm font-semibold">
                  {query ? "No matching projects" : "No projects yet"}
                </h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--color-fg-dim)]">
                  {query ? "Try a different project name." : "Name your first project above to open the estimating workspace."}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="project-table">
                  <thead>
                    <tr>
                      <th>Project</th>
                      <th>Status</th>
                      <th>Last updated</th>
                      <th><span className="sr-only">Actions</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleProjects.map((project) => (
                      <tr key={project.id} onDoubleClick={() => router.push(`/project/${project.id}`)}>
                        <td>
                          <button className="project-name" onClick={() => router.push(`/project/${project.id}`)}>
                            <span className="project-folder"><Folder size={16} /></span>
                            <span>
                              <span className="block font-medium text-[var(--color-fg)]">{project.name}</span>
                              <span className="mt-0.5 block text-xs text-[var(--color-fg-dim)]">Electrical estimate</span>
                            </span>
                          </button>
                        </td>
                        <td><span className="status-pill status-pill-neutral">Draft</span></td>
                        <td>
                          <span className="inline-flex items-center gap-2 text-xs text-[var(--color-fg-dim)]">
                            <Clock3 size={14} /> {formatUpdated(project.updated_at)}
                          </span>
                        </td>
                        <td>
                          <div className="flex justify-end gap-1">
                            <button className="icon-button" onClick={() => router.push(`/project/${project.id}`)} aria-label={`Open ${project.name}`} title="Open project">
                              <ArrowUpRight size={16} />
                            </button>
                            <button className="icon-button danger" onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`} title="Delete project">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
