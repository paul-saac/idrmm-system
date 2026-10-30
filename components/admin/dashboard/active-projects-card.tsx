import Link from "next/link";
import { ArrowRight, Building2 } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import type { PortalBasePath } from "@/components/portal/portal-context";
import type { DashboardProject } from "@/lib/dashboard/data";
import type { ScheduleStatus } from "@/lib/task-progress/calculate";

const SCHEDULE: Record<ScheduleStatus, { label: string; className: string }> = {
  ahead: { label: "Ahead of schedule", className: "bg-sky-50 text-sky-700" },
  on_track: { label: "On track", className: "bg-emerald-50 text-emerald-700" },
  behind: { label: "Behind schedule", className: "bg-red-50 text-red-600" },
};

function peso(amount: number) {
  return `₱${Math.round(amount).toLocaleString("en-PH")}`;
}

function percent(value: number) {
  return `${value.toLocaleString("en-PH", { maximumFractionDigits: 1 })}%`;
}

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Every active project (ongoing, then planning) — its Gantt progress
 * against where its schedule says it should be by now, and its budget
 * against what's been spent. Each opens its own project. */
export function ActiveProjectsCard({
  basePath,
  projects,
}: {
  basePath: PortalBasePath;
  projects: DashboardProject[];
}) {
  return (
    <section className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">Active projects</h2>
          <span className="text-xs tabular-nums text-zinc-400">
            {projects.length}
          </span>
        </div>
        <Link
          href={`${basePath}/projects`}
          className="flex items-center gap-1.5 text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          View all projects <ArrowRight aria-hidden className="size-3.5" />
        </Link>
      </div>

      {projects.length === 0 ? (
        <EmptyState compact className="px-5 py-8">No active projects.</EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {projects.map((project) => {
            const details = [
              project.location,
              project.targetEndDate && `Due ${formatDate(project.targetEndDate)}`,
            ].filter(Boolean);
            return (
              <li key={project.id}>
                <Link
                  href={`${basePath}/projects/${project.id}`}
                  className="block px-5 py-4 transition hover:bg-zinc-50"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-500"><Building2 aria-hidden className="size-4" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-zinc-900">
                        {project.name}
                      </p>
                      {details.length > 0 && (
                        <p className="mt-0.5 truncate text-xs text-zinc-500">
                          {details.join(" · ")}
                        </p>
                      )}
                    </div>
                    {project.status === "planning" ? (
                      <span className="shrink-0 rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                        Planning
                      </span>
                    ) : (
                      project.scheduleStatus && (
                        <span
                          className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${SCHEDULE[project.scheduleStatus].className}`}
                        >
                          {SCHEDULE[project.scheduleStatus].label}
                        </span>
                      )
                    )}
                  </div>

                  <div className="mt-4 flex items-center justify-between gap-3 text-xs">
                    <span className="text-zinc-500">Project progress</span>
                    <span className="font-semibold tabular-nums text-zinc-900">{percent(project.progress)}</span>
                  </div>
                    <div className="mt-1.5 h-1 w-full overflow-hidden rounded-sm bg-zinc-100" role="progressbar" aria-label={`${project.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.max(0, project.progress))}>
                      <div
                        className="h-full rounded-sm bg-zinc-900"
                        style={{ width: `${Math.min(100, Math.max(0, project.progress))}%` }}
                      />
                    </div>

                  <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
                    <div>
                      <dt className="text-zinc-500">Total budget</dt>
                      <dd className="mt-0.5 font-medium text-zinc-900">
                        {project.budget != null ? peso(project.budget) : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Spent to date</dt>
                      <dd className="mt-0.5 font-medium text-zinc-900">{peso(project.spent)}</dd>
                    </div>
                    <div>
                      <dt className="text-zinc-500">Remaining budget</dt>
                      <dd
                        className={`mt-0.5 font-medium ${
                          project.remaining != null && project.remaining < 0
                            ? "text-red-600"
                            : "text-zinc-900"
                        }`}
                      >
                        {project.remaining != null ? peso(project.remaining) : "—"}
                      </dd>
                    </div>
                  </dl>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
