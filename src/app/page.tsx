"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowUpRight,
  Archive,
  ArchiveRestore,
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
  const [showArchived, setShowArchived] = useState(false);

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
    return (projects ?? []).filter((project) => !!project.archived_at === showArchived && project.name.toLowerCase().includes(normalized));
  }, [projects, query, showArchived]);

  async function archiveProject(project: Project) {
    const archived_at = project.archived_at ? null : new Date().toISOString();
    const { error } = await supabase().from("projects").update({ archived_at }).eq("id", project.id);
    if (error) { setError(`Could not ${archived_at ? "archive" : "restore"} “${project.name}”.`); return; }
    setProjects(current => (current ?? []).map(item => item.id === project.id ? { ...item, archived_at } : item));
  }

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
        labor_burden_pct: 0,
        small_tools_pct: 0,
        contingency_pct: 0,
        escalation_pct: 0,
        bond_pct: 0,
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

        <nav className="mt-3 px-3" aria-label="Primary">
          <button className="sidebar-link active" type="button">
            <Folder size={17} />
            Projects
            <span className="sidebar-count">{projects?.length ?? 0}</span>
          </button>
        </nav>

        <div className="sidebar-foot">
          <span className="status-pill status-pill-success">
            <span className="status-dot" /> Local mode
          </span>
          <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out">
            <LogOut size={16} />
          </button>
        </div>
      </aside>

      <main className="dashboard-main">
        <header className="dashboard-header">
          <h1 className="text-xl font-semibold tracking-[-0.02em]">Projects</h1>
          <form onSubmit={createProject} className="create-project-form">
            <label className="sr-only" htmlFor="new-project-name">Project name</label>
            <input
              id="new-project-name"
              className="input h-9"
              placeholder="New project name…"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="off"
            />
            <button className="btn btn-volt h-9 shrink-0" type="submit" disabled={!name.trim() || busy}>
              <Plus size={15} />
              {busy ? "Creating…" : "Create project"}
            </button>
          </form>
        </header>

        <div className="dashboard-content">
          {error && <div className="form-error mb-4" role="alert">{error}</div>}

          <div className="dashboard-columns">
          <section className="projects-panel" aria-labelledby="project-list-title">
            <div className="projects-toolbar">
              <h2 id="project-list-title" className="text-sm font-semibold">
                {showArchived ? "Archived projects" : "Recent projects"}
                <span className="num ml-2 text-xs font-normal text-[var(--color-fg-faint)]">
                  {projects === null ? "…" : projects.length}
                </span>
              </h2>
              <button className="btn ml-auto text-xs" onClick={() => setShowArchived(value => !value)}>{showArchived ? "Show active projects" : "Show archived projects"}</button>
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
                <h3 className="text-sm font-semibold">
                  {query ? "No matching projects" : showArchived ? "No archived projects" : "No projects yet"}
                </h3>
                <p className="mt-1 max-w-sm text-xs leading-5 text-[var(--color-fg-dim)]">
                  {query ? "No name matches that search." : showArchived ? "Archived bids stay here until you restore or delete them." : "Name a project above to start."}
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
                            <span className="font-medium text-[var(--color-fg)]">{project.name}</span>
                          </button>
                        </td>
                        <td><span className="status-pill status-pill-neutral">{project.archived_at ? "Archived" : "Active"}</span></td>
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
                            <button className="icon-button" onClick={() => archiveProject(project)} aria-label={`${project.archived_at ? "Restore" : "Archive"} ${project.name}`} title={project.archived_at ? "Restore project" : "Archive project"}>
                              {project.archived_at ? <ArchiveRestore size={15} /> : <Archive size={15} />}
                            </button>
                            {project.archived_at && <button className="icon-button danger" onClick={() => deleteProject(project)} aria-label={`Delete ${project.name}`} title="Permanently delete project">
                              <Trash2 size={15} />
                            </button>}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <DataProtectionCard />
          </div>
        </div>
      </main>
    </div>
  );
}
