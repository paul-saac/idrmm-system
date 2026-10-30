import Link from "next/link";
import { Building2, ChevronRight, MapPin } from "lucide-react";
import type { ProjectRow } from "@/lib/projects/data";
import type { PortalBasePath } from "@/components/portal/portal-context";
import { initials } from "@/lib/initials";
import { avatarColor } from "@/components/ui/list-table";
import {
  projectStatusLabel,
  projectStatusBadgeClasses,
} from "@/lib/projects/status";

export function ProjectCard({
  project,
  basePath,
}: {
  project: ProjectRow;
  basePath: PortalBasePath;
}) {
  return (
    <div className="flex flex-col overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="bg-white p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-200">
            <Building2 aria-hidden className="size-6" />
          </span>
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-zinc-900">
              {project.name}
            </h3>
            {project.location && (
              <p className="mt-1 flex items-end gap-1.5 text-xs text-zinc-500"><MapPin aria-hidden className="size-3.5 shrink-0" /><span className="leading-none">{project.location}</span></p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-2">
          {project.archivedAt && <span className="inline-flex h-6 items-center justify-center rounded-sm bg-zinc-100 px-2 text-center text-xs leading-none font-medium text-zinc-600">Archived</span>}
          <span className={`inline-flex h-6 items-center justify-center rounded-sm px-2.5 text-center text-xs leading-none font-medium whitespace-nowrap ${projectStatusBadgeClasses(project.status)}`}>{projectStatusLabel(project.status)}</span>
        </div>
      </div>
      </div>

      <div className="grid flex-1 grid-cols-1 items-center gap-4 border-t border-zinc-200 bg-zinc-50 px-6 py-4 sm:grid-cols-2">
        {[["Project Manager", project.projectManagerName], ["Foreman", project.foremanName]].map(([role, name]) => <div key={role} className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={`flex size-7 shrink-0 items-center justify-center rounded-[1px] text-[11px] font-semibold ${avatarColor(name ?? "?")}`}>{initials(name, "—")}</span>
          <div className="min-w-0"><p className="text-[11px] text-zinc-500">{role}</p><p className="mt-0.5 break-words text-xs font-medium text-zinc-900">{name ?? "Unassigned"}</p></div>
        </div>)}
      </div>

      <Link
        href={`${basePath}/projects/${project.id}`}
        className="flex items-center justify-between border-t border-zinc-200 px-6 py-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        View Details
        <ChevronRight aria-hidden className="size-4 text-zinc-400" />
      </Link>
    </div>
  );
}
