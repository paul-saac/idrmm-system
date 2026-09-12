"use client";

import { useMemo, useState } from "react";
import { Search, Plus } from "lucide-react";
import { ProjectCard } from "@/components/projects/project-card";
import { Modal } from "@/components/ui/modal";
import { CreateProjectForm } from "@/components/projects/create-project-form";
import type { ProjectRow } from "@/lib/projects/data";
import type { ProjectStatus } from "@/lib/supabase/types";
import type { AccountRow } from "@/lib/accounts/data";

const TABS: { label: string; value: ProjectStatus | "all" }[] = [
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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((project) => {
      const matchesStatus =
        statusFilter === "all" || project.status === statusFilter;
      const matchesQuery =
        !q ||
        project.name.toLowerCase().includes(q) ||
        (project.location ?? "").toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [projects, query, statusFilter]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] max-w-xs flex-1">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search Project"
            className="w-full rounded-md border border-zinc-200 py-2 pl-3 pr-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          <Search className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>

        <div className="flex items-center gap-2">
          {TABS.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setStatusFilter(tab.value)}
              className={`cursor-pointer rounded border px-4 py-0.5 text-xs font-medium transition ${
                statusFilter === tab.value
                  ? "border-zinc-900 bg-zinc-900 text-white"
                  : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="ml-auto flex items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          Add Project
        </button>
      </div>

      {filtered.length === 0 ? (
        <p className="py-12 text-center text-sm text-zinc-500">
          {projects.length === 0
            ? "No projects yet — create the first one."
            : "No projects match your search/filter."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}

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
    </div>
  );
}
