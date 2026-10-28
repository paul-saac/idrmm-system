import Link from "next/link";
import { ChevronRight, Folder, MapPin } from "lucide-react";
import type { ProjectRow } from "@/lib/projects/data";
import type { PortalBasePath } from "@/components/portal/portal-context";
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
      <div className="flex-1 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-4">
          <Folder aria-hidden className="size-7 shrink-0 text-zinc-500" />
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold text-zinc-900">
              {project.name}
            </h3>
            {project.location && (
              <p className="mt-1 flex items-end gap-1.5 text-xs text-zinc-500"><MapPin aria-hidden className="size-3.5 shrink-0" /><span className="leading-none">{project.location}</span></p>
            )}
          </div>
        </div>
        <span className={`shrink-0 rounded-sm px-2 py-1 text-xs font-medium whitespace-nowrap ${projectStatusBadgeClasses(project.status)}`}>{projectStatusLabel(project.status)}</span>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 border-t border-zinc-200 pt-5 sm:grid-cols-2">
        {[["Project Manager", project.projectManagerName], ["Foreman", project.foremanName]].map(([role, name]) => <div key={role} className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden className={`flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarColor(name ?? "?")}`}>{name ? name.split(/\s+/).filter(Boolean).map(part => part[0]).filter((_, index, letters) => index === 0 || index === letters.length - 1).join("").toUpperCase() : "—"}</span>
          <div className="min-w-0"><p className="text-xs text-zinc-500">{role}</p><p className="mt-1 break-words text-sm text-zinc-900">{name ?? "Unassigned"}</p></div>
        </div>)}
      </div>
      </div>

      <Link
        href={`${basePath}/projects/${project.id}`}
        className="flex items-center justify-between border-t border-zinc-200 px-6 py-4 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        View Details
        <ChevronRight aria-hidden className="size-4 text-zinc-500" />
      </Link>
    </div>
  );
}
