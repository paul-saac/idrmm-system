"use client";

import type { ReactNode } from "react";
import { Building2, Diamond, MapPin } from "lucide-react";
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
      <p className="text-xs font-medium tracking-wider text-zinc-400 uppercase">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 text-lg font-semibold text-zinc-900">
        {value}
      </div>
    </div>
  );
}

function Person({ role, name }: { role: string; name: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <InitialsAvatar name={name ?? "?"} neutral />
      <span className="text-zinc-400">{role}</span>
      <span className="truncate font-medium text-zinc-900">{name ?? "—"}</span>
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
}: {
  project: ProjectRow;
  categories: CostCategory[];
  workers: Worker[];
  workerAssignments: WorkerAssignment[];
  /** Admins' Edit project — left out where the project's read-only. */
  onEdit?: () => void;
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
    <div className="bg-white pt-6">
      <div className="mx-8 flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
            <Building2 aria-hidden className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-semibold text-zinc-900">{project.name}</h1>
              <span
                className={`rounded-xs px-2.5 py-1 text-xs font-medium ${projectStatusBadgeClasses(project.status)}`}
              >
                {projectStatusLabel(project.status)}
              </span>
            </div>
            {project.location && (
              <p className="mt-1 flex items-center gap-1.5 text-sm text-zinc-400">
                <MapPin aria-hidden className="size-4 shrink-0" />
                {project.location}
              </p>
            )}
          </div>
        </div>
        {/* Delete lives inside the Edit Project modal. */}
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            <EditIcon className="size-4" />
            Edit project
          </button>
        )}
      </div>

      <div className="mx-8 mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm">
        <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
          <Person role="Project manager" name={project.projectManagerName} />
          <span aria-hidden className="h-5 w-px bg-zinc-200" />
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
                <span key={worker.id} className="rounded-full">
                  <InitialsAvatar name={worker.fullName} neutral />
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

      <div className="mt-5 grid grid-cols-2 border-y border-zinc-200 lg:grid-cols-4 lg:divide-x lg:divide-zinc-200">
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
              <span className="text-zinc-400">Not scheduled</span>
            )
          }
        />
        <Stat
          label="Next milestone"
          value={
            nextMilestone ? (
              <>
                <span className="truncate">{nextMilestone.name}</span>
                <Diamond aria-hidden className="size-4 shrink-0 text-zinc-400" />
              </>
            ) : (
              <span className="text-zinc-400">None</span>
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
