"use client";

import type { ReactNode } from "react";
import { Building2, CircleCheck, Diamond, MapPin, TriangleAlert } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { InitialsAvatar } from "@/components/ui/list-table";
import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectRow } from "@/lib/projects/data";
import { projectStatusBadgeClasses, projectStatusLabel } from "@/lib/projects/status";
import type { Worker, WorkerAssignment } from "@/lib/workers/data";

const DAY_MS = 24 * 60 * 60 * 1000;

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

function daysBetween(fromIso: string, toIso: string) {
  return Math.round((toDate(toIso).getTime() - toDate(fromIso).getTime()) / DAY_MS);
}

/** One figure in the stats strip — a small caps label, the figure, and a
 * line under it. */
function Stat({ label, value, caption }: { label: string; value: ReactNode; caption: ReactNode }) {
  return (
    <div className="min-w-0 px-8 py-4">
      <p className="text-xs font-medium tracking-wider text-zinc-400 uppercase">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 text-lg font-semibold text-zinc-900">
        {value}
      </div>
      <p className="mt-1 truncate text-sm text-zinc-400">{caption}</p>
    </div>
  );
}

function Person({ role, name }: { role: string; name: string | null }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <InitialsAvatar name={name ?? "?"} />
      <span className="text-zinc-400">{role}</span>
      <span className="truncate font-medium text-zinc-900">{name ?? "—"}</span>
    </span>
  );
}

/**
 * The project's own header, over its tabs: what it is and where, who runs
 * it and who's on its crew, then a strip of four figures — overall
 * progress, the schedule, the next milestone, and planning health (any
 * task past its End and not done, and what starts this week).
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
        milestone: false,
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
  const milestoneIn = nextMilestone ? daysBetween(today, nextMilestone.date) : 0;

  // Planning health: past its End and not done; starting within a week.
  const work = items.filter((item) => !item.milestone);
  const overdue = work.filter((item) => item.end && item.end < today && item.percent < 99.995).length;
  const weekEnd = localIso(new Date(toDate(today).getTime() + 6 * DAY_MS));
  const startingThisWeek = work.filter(
    (item) => item.start && item.start >= today && item.start <= weekEnd
  ).length;

  // The crew: everyone on one of its tasks or phases.
  const crewIds = new Set(
    workerAssignments
      .filter((a) => a.projectId === project.id && a.kind !== "project")
      .map((a) => a.workerId)
  );
  const crew = workers.filter((worker) => crewIds.has(worker.id));

  const scheduled = project.startDate && project.targetEndDate;
  const startYear = project.startDate?.slice(0, 4);
  const endYear = project.targetEndDate?.slice(0, 4);

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
              className="flex -space-x-1.5"
              title={crew.map((worker) => worker.fullName).join(", ")}
            >
              {crew.slice(0, TEAM_PREVIEW).map((worker) => (
                <span key={worker.id} className="rounded-full ring-2 ring-white">
                  <InitialsAvatar name={worker.fullName} />
                </span>
              ))}
              {crew.length > TEAM_PREVIEW && (
                <span className="flex size-6 items-center justify-center rounded-full bg-zinc-100 text-[10px] font-semibold text-zinc-600 ring-2 ring-white">
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
          value={
            <>
              <span className="tabular-nums">{progress.toFixed(2)}%</span>
              <span className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-200">
                <span
                  className="block h-full rounded-full bg-zinc-900"
                  style={{ width: `${progress}%` }}
                />
              </span>
            </>
          }
          caption="Weighted completion across all tasks"
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
          caption={
            scheduled
              ? `${startYear === endYear ? startYear : `${startYear} – ${endYear}`} · ${
                  daysBetween(project.startDate!, project.targetEndDate!) + 1
                } calendar days`
              : "Set its start and target end"
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
          caption={
            nextMilestone
              ? `${shortDate(nextMilestone.date)} · ${
                  milestoneIn === 0 ? "Today" : milestoneIn === 1 ? "Tomorrow" : `In ${milestoneIn} days`
                }`
              : "No upcoming milestones"
          }
        />
        <Stat
          label="Planning health"
          value={
            overdue === 0 ? (
              <>
                On track
                <CircleCheck aria-hidden className="size-4 shrink-0 text-emerald-600" />
              </>
            ) : (
              <>
                {overdue} overdue
                <TriangleAlert aria-hidden className="size-4 shrink-0 text-amber-500" />
              </>
            )
          }
          caption={`${
            overdue === 0 ? "No overdue tasks" : `${overdue} past their end, not done`
          } · ${startingThisWeek} starting this week`}
        />
      </div>
    </div>
  );
}
