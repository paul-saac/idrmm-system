import { Building2, MapPin } from "lucide-react";
import { HeaderActions } from "@/components/auth/header-actions";
import type { ProjectRow } from "@/lib/projects/data";
import {
  projectStatusBadgeClasses,
  projectStatusLabel,
} from "@/lib/projects/status";

const WORKSPACE_TABS = ["Overview", "Materials", "Equipment", "Expenses"];

// Mirrors project-header.tsx's own Person (no avatar) so the streamed
// shell doesn't flash profiles that disappear once the page loads.
function Person({ role, name }: { role: string; name: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-zinc-400">{role}</span>
      <span className="truncate font-medium text-zinc-100">{name ?? "—"}</span>
    </span>
  );
}

/**
 * The streamed project shell. Project identity stays useful while the much
 * larger workspace data set is still being assembled on the server.
 */
export function ProjectWorkspaceLoading({ project }: { project?: ProjectRow }) {
  return (
    <div className="relative flex-1 overflow-y-auto bg-zinc-200/28">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5">
        <nav className="flex items-center gap-1.5 text-base">
          <span className="text-zinc-500">Projects</span>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">Overview</span>
        </nav>
        <HeaderActions />
      </header>
      <div className="h-0.5 overflow-hidden bg-zinc-200">
        <span className="route-progress-indicator block h-full rounded-r-full bg-zinc-900" />
      </div>

      <main>
        <div className="bg-zinc-900 pt-4">
          <div className="mx-8 flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3.5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-200">
                <Building2 aria-hidden className="size-5" />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  {project ? (
                    <>
                      <h1 className="text-2xl font-semibold text-zinc-100">{project.name}</h1>
                      <span
                        className={`inline-flex h-6 shrink-0 items-center justify-center rounded-xs px-2.5 text-center text-xs leading-none font-medium whitespace-nowrap ${projectStatusBadgeClasses(project.status, "workspace")}`}
                      >
                        {projectStatusLabel(project.status)}
                      </span>
                      {project.archivedAt && <span className="rounded-xs border border-zinc-600 px-2.5 py-1 text-xs font-medium text-zinc-200">Archived</span>}
                    </>
                  ) : (
                    <>
                      <span className="h-7 w-52 animate-pulse rounded bg-zinc-800" />
                      <span className="h-6 w-20 animate-pulse rounded bg-zinc-800" />
                    </>
                  )}
                </div>
                {project?.location ? (
                  <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-400">
                    <MapPin aria-hidden className="size-4 shrink-0 text-zinc-400" />
                    {project.location}
                  </p>
                ) : !project ? (
                  <span className="mt-2 block h-3 w-36 animate-pulse rounded bg-zinc-800" />
                ) : null}
              </div>
            </div>
          </div>

          <div className="mx-8 mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
            {project ? (
              <Person role="Project manager" name={project.projectManagerName} />
            ) : (
              <span className="h-5 w-56 animate-pulse rounded bg-zinc-800" />
            )}
            <span aria-hidden className="h-4 w-px bg-zinc-600" />
            {project ? (
              <Person role="Foreman" name={project.foremanName} />
            ) : (
              <span className="h-5 w-44 animate-pulse rounded bg-zinc-800" />
            )}
          </div>

          <div className="mt-3.5 grid grid-cols-2 border-y border-zinc-300 bg-zinc-200 lg:grid-cols-4 lg:divide-x lg:divide-zinc-300">
            {["Overall progress", "Project schedule", "Next milestone", "Project tasks"].map(
              (label) => (
                <div key={label} className="min-w-0 px-8 py-4">
                  <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">{label}</p>
                  <div className="mt-2 h-6 w-28 animate-pulse rounded bg-zinc-100" />
                </div>
              )
            )}
          </div>
        </div>

        <div className="bg-white pt-3 shadow-[inset_0_-1px_0_var(--color-zinc-200)]">
          <div className="flex gap-10 px-8">
            {WORKSPACE_TABS.map((tab, index) => (
              <span
                key={tab}
                className={`border-b-2 pb-2 text-xs font-medium ${
                  index === 0
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-400"
                }`}
              >
                {tab}
              </span>
            ))}
          </div>
        </div>

        <div className="space-y-4 px-8 py-6" aria-label="Loading project overview">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="h-28 animate-pulse rounded border border-zinc-200 bg-white" />
            ))}
          </div>
          <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
            <div className="h-80 animate-pulse rounded border border-zinc-200 bg-white" />
            <div className="h-80 animate-pulse rounded border border-zinc-200 bg-white" />
          </div>
        </div>
      </main>
    </div>
  );
}
