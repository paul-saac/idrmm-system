"use client";

import type { ReactNode } from "react";
import { Archive, Building2, Diamond, MapPin } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { InitialsAvatar } from "@/components/ui/list-table";
import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectRow } from "@/lib/projects/data";
import { projectStatusBadgeClasses, projectStatusLabel } from "@/lib/projects/status";
import type { Worker, WorkerAssignment } from "@/lib/workers/data";

// How many crew avatars show before "+N".
const TEAM_PREVIEW = 4;

function localIso(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

/** "Oct 16" — the app's own short date. */
function shortDate(iso: string) {
  return toDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** One figure in the stats strip — a small caps label, then the figure. */
function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0 px-8 py-4">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 text-lg font-semibold text-zinc-900">
        {value}
      </div>
    </div>
  );
}

function Person({ role, name }: { role: string; name: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <span className="text-zinc-400">{role}</span>
      <span className="truncate font-medium text-zinc-100">{name ?? "—"}</span>
    </span>
  );
}

/**
 * The project's own header, over its tabs: what it is and where, who runs
 * it and who's on its crew, then a strip of four figures — overall
 * progress, the schedule, the next milestone, and the number of tasks.
 */
export function ProjectHeader({
  project,
  categories,
  workers,
  workerAssignments,
  onEdit,
  onArchive,
}: {
  project: ProjectRow;
  categories: CostCategory[];
  workers: Worker[];
  workerAssignments: WorkerAssignment[];
  /** Admins' Edit project — left out where the project's read-only. */
  onEdit?: () => void;
  /** Admins' Archive/Unarchive project — available for completed or archived projects. */
  onArchive?: () => void;
}) {
  const today = localIso(new Date());

  // Every task's weight × its percent complete (a task-less phase counts
  // as its own task) — the same rollup as the Gantt chart's toolbar.
  let progress = 0;
  // Each schedulable item: a task, or a phase without tasks.
  const items: { name: string; start: string | null; end: string | null; percent: number; milestone: boolean }[] = [];
  for (const category of categories) {
    if (category.tasks.length === 0) {
      progress += (category.weight * category.percentComplete) / 100;
      items.push({
        name: category.name,
        start: category.plannedStartDate,
        end: category.plannedEndDate,
        percent: category.percentComplete,
        milestone: category.isMilestone,
      });
      continue;
    }
    for (const task of category.tasks) {
      progress += (task.weight * task.percentComplete) / 100;
      items.push({
        name: task.name,
        start: task.plannedStartDate,
        end: task.plannedEndDate,
        percent: task.percentComplete,
        milestone: task.isMilestone,
      });
    }
  }
  progress = Math.min(100, progress);

  // The next milestone on or after today.
  const nextMilestone = items
    .filter((item) => item.milestone)
    .map((item) => ({ name: item.name, date: item.end ?? item.start }))
    .filter((item): item is { name: string; date: string } => !!item.date && item.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];

  // Match the Gantt header's count: normal tasks and task-less phases count;
  // milestones are reported separately and are not included here.
  const taskCount = items.filter((item) => !item.milestone).length;

  // The crew: everyone on one of its tasks or phases.
  const crewIds = new Set(
    workerAssignments
      .filter((a) => a.projectId === project.id && a.kind !== "project")
      .map((a) => a.workerId)
  );
  const crew = workers.filter((worker) => crewIds.has(worker.id));

  const scheduled = project.startDate && project.targetEndDate;

  return (
    <div className="bg-zinc-900 pt-4">
      <div className="mx-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-800 text-zinc-200">
            <Building2 aria-hidden className="size-5" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-zinc-100">{project.name}</h1>
              <span
                className={`inline-flex h-6 shrink-0 items-center justify-center rounded-xs px-2.5 text-center text-xs leading-none font-medium whitespace-nowrap ${projectStatusBadgeClasses(project.status, "workspace")}`}
              >
                {projectStatusLabel(project.status)}
              </span>
            </div>
            {project.location && (
              <p className="mt-0.5 flex items-center gap-1.5 text-sm text-zinc-400">
                <MapPin aria-hidden className="size-4 shrink-0 text-zinc-400" />
                {project.location}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onArchive && (
            <button
              type="button"
              onClick={onArchive}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              <Archive className="size-4" />
              {project.archivedAt ? "Unarchive project" : "Archive project"}
            </button>
          )}
          {onEdit && (
            <button
              type="button"
              onClick={onEdit}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 transition hover:bg-zinc-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-400"
            >
              <EditIcon className="size-4" />
              Edit project
            </button>
          )}
        </div>
      </div>

      <div className="mx-8 mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5">
          <Person role="Project manager" name={project.projectManagerName} />
          <span aria-hidden className="h-4 w-px bg-zinc-600" />
          <Person role="Foreman" name={project.foremanName} />
        </div>
        {crew.length > 0 && (
          <div className="flex items-center gap-3">
            <span className="text-zinc-400">Project team</span>
            <div
              className="flex flex-wrap items-center gap-1.5"
              title={crew.map((worker) => worker.fullName).join(", ")}
            >
              {crew.slice(0, TEAM_PREVIEW).map((worker) => (
                <span key={worker.id} className="rounded-[1px]">
                  <InitialsAvatar name={worker.fullName} />
                </span>
              ))}
              {crew.length > TEAM_PREVIEW && (
                <span className="text-xs text-zinc-400">
                  +{crew.length - TEAM_PREVIEW}
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3.5 grid grid-cols-2 border-y border-zinc-300 bg-zinc-200 lg:grid-cols-4 lg:divide-x lg:divide-zinc-300">
        <Stat
          label="Overall progress"
          value={<span className="tabular-nums">{progress.toFixed(2)}%</span>}
        />
        <Stat
          label="Project schedule"
          value={
            scheduled ? (
              <span className="truncate">
                {shortDate(project.startDate!)} – {shortDate(project.targetEndDate!)}
              </span>
            ) : (
              <span className="text-zinc-500">Not scheduled</span>
            )
          }
        />
        <Stat
          label="Next milestone"
          value={
            nextMilestone ? (
              <>
                <span className="truncate">{nextMilestone.name}</span>
                <Diamond aria-hidden className="size-4 shrink-0 text-zinc-500" />
              </>
            ) : (
              <span className="text-zinc-500">None</span>
            )
          }
        />
        <Stat
          label="Project tasks"
          value={`${taskCount} ${taskCount === 1 ? "task" : "tasks"}`}
        />
      </div>
    </div>
  );
}
