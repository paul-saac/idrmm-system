"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Archive, Building2, Info, MapPin } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { InitialsAvatar } from "@/components/ui/list-table";
import type { CostCategory } from "@/lib/cost-estimate/data";
import type { ProjectRow } from "@/lib/projects/data";
import { projectStatusBadgeClasses, projectStatusLabel } from "@/lib/projects/status";
import type { Worker, WorkerAssignment } from "@/lib/workers/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import { assessProjectSchedule } from "@/lib/projects/schedule-assessment";
import { manilaToday } from "@/components/admin/dashboard/calendar-model";
import { Modal } from "@/components/ui/modal";

// How many crew avatars show before "+N".
const TEAM_PREVIEW = 4;

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

/** "Oct 16" — the app's own short date. */
function shortDate(iso: string) {
  return toDate(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** One figure in the stats strip — a small caps label, then the figure. */
function Stat({ label, value, description }: { label: string; value: ReactNode; description?: ReactNode }) {
  return (
    <div className="min-w-0 px-8 py-4">
      <p className="text-xs font-medium tracking-wider text-zinc-500 uppercase">{label}</p>
      <div className="mt-1.5 flex min-w-0 items-center gap-2 text-lg font-semibold text-zinc-900">
        {value}
      </div>
      {description && <div className="mt-1 text-xs leading-relaxed text-zinc-500">{description}</div>}
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
 * progress, the official schedule, delay risk, and forecast completion.
 */
export function ProjectHeader({
  project,
  categories,
  workers,
  workerAssignments,
  taskRecords,
  categoryRecords,
  onEdit,
  onArchive,
}: {
  project: ProjectRow;
  categories: CostCategory[];
  workers: Worker[];
  workerAssignments: WorkerAssignment[];
  taskRecords: Record<number, TaskProgressToday>;
  categoryRecords: Record<number, TaskProgressToday>;
  /** Admins' Edit project — left out where the project's read-only. */
  onEdit?: () => void;
  /** Admins' Archive/Unarchive project — available for completed or archived projects. */
  onArchive?: () => void;
}) {
  const today = manilaToday();
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const assessment = useMemo(() => assessProjectSchedule({ project, categories, taskRecords, categoryRecords, today }),
    [project, categories, taskRecords, categoryRecords, today]);
  const riskLabels = { low: "Low", medium: "Medium", high: "High", unassessed: "Not assessed", completed: "Completed" };
  const riskStyles = { low: "text-emerald-700", medium: "text-amber-700", high: "text-red-600", unassessed: "text-zinc-500", completed: "text-emerald-700" };
  const delta = assessment.differenceDays;
  const forecastNote = delta === null ? assessment.reason : delta > 0 ? `${delta} calendar days beyond target`
    : delta < 0 ? `${-delta} calendar days before target` : "Within the official target date";

  // Every task's weight × its percent complete (a task-less phase counts
  // as its own task) — the same rollup as the Gantt chart's toolbar.
  let progress = 0;
  for (const category of categories) {
    for (const row of category.tasks.length ? category.tasks : [category]) progress += row.weight * row.percentComplete / 100;
  }
  progress = Math.min(100, progress);

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
          description={project.targetEndDate ? `Official target: ${toDate(project.targetEndDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : undefined}
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
        <Stat label="Delay risk"
          value={<button type="button" onClick={() => setAssessmentOpen(true)} className={`flex cursor-pointer items-center gap-2 text-left ${riskStyles[assessment.risk]}`}>
            {riskLabels[assessment.risk]}<Info aria-hidden className="size-3.5 text-zinc-400" />
          </button>}
          description={<>{assessment.risk !== "unassessed" && assessment.risk !== "completed" && <><span>{assessment.delayedTasks} {assessment.delayedTasks === 1 ? "task" : "tasks"} behind recorded plan</span><br /></>}{assessment.reason}</>}
        />
        <Stat label="Forecast completion"
          value={<button type="button" onClick={() => setAssessmentOpen(true)} className="flex cursor-pointer items-center gap-2 text-left">
            {assessment.forecastDate ? toDate(assessment.forecastDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : <span className="text-zinc-500">Insufficient data</span>}
            <Info aria-hidden className="size-3.5 text-zinc-400" />
          </button>}
          description={<span className={delta !== null && delta > 0 ? "text-red-600" : undefined}>{assessment.forecastDate ? forecastNote : assessment.lastRecordedDate ? `Latest log: ${assessment.lastRecordedDate}` : "Uses saved progress and task dependencies"}</span>}
        />
      </div>
      <Modal open={assessmentOpen} onClose={() => setAssessmentOpen(false)} title="Project schedule assessment">
        <div className="space-y-5 text-sm text-zinc-700">
          <dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3">
            <dt className="text-zinc-500">Official target</dt><dd>{project.targetEndDate ?? "Not scheduled"}</dd>
            <dt className="text-zinc-500">Forecast completion</dt><dd>{assessment.forecastDate ?? "Insufficient data"}</dd>
            <dt className="text-zinc-500">Delay risk</dt><dd className={riskStyles[assessment.risk]}>{riskLabels[assessment.risk]}</dd>
            <dt className="text-zinc-500">Latest progress record</dt><dd>{assessment.lastRecordedDate ?? "No saved progress"}</dd>
          </dl>
          <p>{assessment.reason}</p>
          <section className="space-y-2"><h3 className="font-semibold text-zinc-900">How the forecast is calculated</h3><p>{assessment.method}</p>
            <p>Actual completion comes from saved progress entries. For started tasks, the remaining work is divided by the recorded average progress per working day since the planned start. Tasks with no recorded completion retain their planned duration. Successors wait for predecessor completion; parallel activities keep their own planned start constraints.</p>
          </section>
          <section className="space-y-2"><h3 className="font-semibold text-zinc-900">Risk rules</h3>
            <p><strong>High:</strong> the projected completion exceeds the target. <strong>Medium:</strong> some tasks are behind by more than five percentage points, while the forecast still fits the target. <strong>Low:</strong> no such recorded lag and the forecast fits the target.</p>
            <p>The rating is a schedule warning, not a statistical probability. Missing schedules, circular dependencies, missing logs, or records more than two working days old prevent assessment. A forecast does not move the official deadline or reschedule task bars.</p>
          </section>
        </div>
      </Modal>
    </div>
  );
}
