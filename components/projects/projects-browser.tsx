"use client";

import { useMemo, useState } from "react";
import { Search, Plus, LayoutGrid, List, Users, ChevronDown } from "lucide-react";
import { ProjectCard } from "@/components/projects/project-card";
import { Modal } from "@/components/ui/modal";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import { usePortal } from "@/components/portal/portal-context";
import type { ProjectRow } from "@/lib/projects/data";
import type { ProjectStatus } from "@/lib/supabase/types";
import type { AccountRow } from "@/lib/accounts/data";

const STATUS_OPTIONS: { label: string; value: ProjectStatus | "all" }[] = [
  { label: "All", value: "all" },
  { label: "On going", value: "ongoing" },
  { label: "Completed", value: "completed" },
  { label: "Planning", value: "planning" },
];

export function ProjectsBrowser({
  projects,
  projectManagers,
  foremen,
}: {
  projects: ProjectRow[];
  projectManagers: AccountRow[];
  foremen: AccountRow[];
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ProjectStatus | "all">(
    "all"
  );
  const [addOpen, setAddOpen] = useState(false);
  const [view, setView] = useState<"grid" | "list">("grid");
  // Foremen only see the projects assigned to them (row-level security
  // already filters `projects`) and can't create new ones.
  const { basePath, isAdmin } = usePortal();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result = projects.filter((project) => {
      const matchesStatus =
        statusFilter === "all" || project.status === statusFilter;
      const matchesQuery =
        !q ||
        project.name.toLowerCase().includes(q) ||
        (project.location ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
    return result;
  }, [projects, query, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="flex items-baseline gap-2 text-base font-semibold text-zinc-900">
          {STATUS_OPTIONS.find(option => option.value === statusFilter)?.label} projects
          <span className="text-xs font-normal tabular-nums text-zinc-400">{filtered.length}</span>
        </h2>
        <div className="relative ml-auto w-72 max-w-full">
          <input
            type="text"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Project"
            aria-label="Search projects"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <select aria-label="Filter projects by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as ProjectStatus | "all")} className="cursor-pointer appearance-none rounded border border-zinc-200 bg-white py-2 pl-3 pr-9 text-sm text-zinc-600 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200">
              {STATUS_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.value === "all" ? "All statuses" : option.label}</option>)}
            </select>
            <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-500" />
          </div>
          <div className="flex rounded border border-zinc-200 bg-white p-1">
            {(["grid", "list"] as const).map(mode => <button key={mode} aria-label={`${mode === "grid" ? "Grid" : "List"} view`} aria-pressed={view === mode} onClick={() => setView(mode)} className={`rounded p-1.5 ${view === mode ? "bg-zinc-100 text-zinc-900" : "text-zinc-400 hover:bg-zinc-50"}`}>{mode === "grid" ? <LayoutGrid className="size-4" /> : <List className="size-4" />}</button>)}
          </div>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
          >
            <Plus className="size-4" />
            Add Project
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          {projects.length === 0
            ? isAdmin
              ? "No projects yet — create the first one."
              : "No projects are assigned to you yet."
            : "No projects match your search/filter."}
        </p>
      ) : (
        <div className={`grid grid-cols-1 gap-5 ${view === "grid" ? "lg:grid-cols-2" : ""}`}>
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} basePath={basePath} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500"><span>Showing {filtered.length} of {projects.length} projects</span><span className="flex items-center gap-1.5"><Users aria-hidden className="size-3.5" />{isAdmin ? "All workspace projects" : "Your assigned projects"}</span></div>
      {isAdmin && (
        <Modal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          title="Add Project"
        >
          <CreateProjectForm
            projectManagers={projectManagers}
            foremen={foremen}
            onSuccess={() => setAddOpen(false)}
          />
        </Modal>
      )}
    </div>
  );
}
