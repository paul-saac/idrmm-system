"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronRight, Search } from "lucide-react";
import { Modal } from "@/components/ui/modal";

export type ProjectOption = { id: number; name: string };

export function ProjectPicker({
  projects,
  selectedProjectId,
}: {
  projects: ProjectOption[];
  selectedProjectId: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex cursor-pointer flex-shrink-0 items-center gap-1 rounded border border-zinc-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-700"
      >
        Select Project
        <ChevronRight className="size-4" />
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title="Select a Project">
        <div className="relative mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            placeholder="Search projects…"
            className="w-full rounded border border-zinc-200 py-2 pr-3 pl-8 text-sm outline-none focus:border-zinc-400"
          />
        </div>
        <div className="flex flex-col divide-y divide-zinc-100">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-sm text-zinc-400">No projects match.</p>
          ) : (
            filtered.map((project) => (
              <Link
                key={project.id}
                href={`/admin/reports?projectId=${project.id}`}
                onClick={() => setOpen(false)}
                className={`flex items-center justify-between gap-3 px-1 py-2.5 text-sm transition hover:bg-zinc-50 ${
                  project.id === selectedProjectId
                    ? "font-medium text-zinc-900"
                    : "text-zinc-700"
                }`}
              >
                {project.name}
                {project.id === selectedProjectId && (
                  <span className="text-xs text-zinc-400">Current</span>
                )}
              </Link>
            ))
          )}
        </div>
      </Modal>
    </>
  );
}
