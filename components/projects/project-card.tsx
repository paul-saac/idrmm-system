import Link from "next/link";
import type { ProjectRow } from "@/lib/projects/data";
import {
  projectStatusLabel,
  projectStatusBadgeClasses,
} from "@/lib/projects/status";

export function ProjectCard({ project }: { project: ProjectRow }) {
  return (
    <div className="flex flex-col rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-sm font-semibold text-zinc-900">
          {project.name}
        </h3>
        <span
          className={`flex-shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${projectStatusBadgeClasses(project.status)}`}
        >
          {projectStatusLabel(project.status)}
        </span>
      </div>

      {project.location && (
        <p className="mt-2 text-xs text-zinc-500">{project.location}</p>
      )}

      <div className="mt-3 space-y-0.5 text-xs text-zinc-500">
        <p>Project Manager: {project.projectManagerName ?? "—"}</p>
        <p>Foreman: {project.foremanName ?? "—"}</p>
      </div>

      <Link
        href={`/admin/projects/${project.id}`}
        className="mt-4 rounded border border-zinc-200 py-2 text-center text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        View Details
      </Link>
    </div>
  );
}
