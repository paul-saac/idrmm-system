import { CheckCircle2, Circle, Clock, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectProgress, TaskStatus } from "@/lib/progress/data";
import type { DelayRiskAssessment } from "@/lib/forecasting/data";
import { riskLevelLabel, riskLevelBadgeClasses } from "@/lib/forecasting/status";

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  completed: "bg-emerald-300",
  in_progress: "bg-amber-300",
  not_started: "bg-zinc-200",
};

// The task breakdown's own inline "38%"-style label, drawn at a fixed
// inset from the bar's own left edge (not inside the fill div) so it
// stays legible even when the fill is only a sliver wide — a darker
// shade of the same status color reads fine whether it lands on the
// colored fill or the plain track past it.
const STATUS_INLINE_LABEL_COLOR: Record<TaskStatus, string> = {
  completed: "text-emerald-800",
  in_progress: "text-amber-800",
  not_started: "text-zinc-400",
};

const STATUS_TEXT_COLOR: Record<TaskStatus, string> = {
  completed: "text-emerald-600",
  in_progress: "text-amber-600",
  not_started: "text-zinc-400",
};

const STATUS_LABEL: Record<TaskStatus, string> = {
  completed: "Completed",
  in_progress: "In Progress",
  not_started: "Not Started",
};

function formatDateLong(iso: string | null) {
  if (!iso) return "—";
  // Appending a time avoids the date shifting a day back in negative-UTC
  // timezones, since new Date("2026-04-08") parses as UTC midnight.
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: ReactNode;
}) {
  return (
    <div className="relative rounded-t-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="flex-shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-zinc-900">{value}</p>
      {/* A plain fill bar, not a border-b — see StatCard's own comment
          in project-detail-view.tsx for why a border-b here mitered a
          visible diagonal notch into the corner instead of a straight
          edge. */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900" />
    </div>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-4 text-xs text-zinc-500">
      {(["completed", "in_progress", "not_started"] as const).map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span
            className={`size-2 rounded-full ${STATUS_BAR_COLOR[status]}`}
          />
          {STATUS_LABEL[status]}
        </span>
      ))}
    </div>
  );
}

export function ProgressView({
  startDate,
  targetEndDate,
  progress,
  risk,
}: {
  startDate: string | null;
  targetEndDate: string | null;
  progress: ProjectProgress;
  risk: DelayRiskAssessment;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
          Overall Progress
        </h3>
        <p className="mt-2 text-3xl font-bold text-emerald-600">
          {progress.overallPercent}%
        </p>
        <div className="mt-3 h-3 w-full overflow-hidden rounded-sm bg-zinc-100">
          <div
            className="h-full rounded-sm bg-emerald-400 transition-all"
            style={{ width: `${progress.overallPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>Start: {formatDateLong(startDate)}</span>
          <span>Target Completion: {formatDateLong(targetEndDate)}</span>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Delay Risk Assessment
          </h3>
          <span
            className={`rounded-sm px-2.5 py-1 text-xs font-medium ${riskLevelBadgeClasses(risk.riskLevel)}`}
          >
            {riskLevelLabel(risk.riskLevel)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-xs text-zinc-500">Forecasted Completion</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {formatDateLong(risk.forecastedCompletionDate)}
            </p>
            {risk.daysAheadOrBehind != null && risk.daysAheadOrBehind !== 0 && (
              <p
                className={`text-xs ${risk.daysAheadOrBehind > 0 ? "text-red-600" : "text-emerald-600"}`}
              >
                {risk.daysAheadOrBehind > 0
                  ? `${risk.daysAheadOrBehind} days late`
                  : `${Math.abs(risk.daysAheadOrBehind)} days early`}
              </p>
            )}
          </div>
          <div>
            <p className="text-xs text-zinc-500">Schedule Performance (SPI)</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {risk.spi != null ? risk.spi.toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Delay Reports (30d)</p>
            <p className="mt-1 text-2xl font-bold text-zinc-900">
              {risk.recentDelayIncidentCount}
            </p>
          </div>
        </div>

        {!risk.hasCompleteScheduleBaseline && (
          <p className="mt-4 text-xs text-zinc-400 italic">
            {risk.unscheduledTaskCount} task
            {risk.unscheduledTaskCount === 1 ? "" : "s"} still need
            {risk.unscheduledTaskCount === 1 ? "s" : ""} a planned schedule —
            using the project&apos;s overall timeline as a stand-in for those.
            Set planned start/end dates per task in the Cost Estimate for a
            more accurate forecast.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Tasks"
          value={progress.totalTasks}
          icon={<ListTodo className="size-4" />}
        />
        <StatCard
          label="Completed"
          value={progress.completed}
          icon={<CheckCircle2 className="size-4" />}
        />
        <StatCard
          label="In progress"
          value={progress.inProgress}
          icon={<Clock className="size-4" />}
        />
        <StatCard
          label="Not Started"
          value={progress.notStarted}
          icon={<Circle className="size-4" />}
        />
      </div>

      {progress.categories.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No progress to show yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add task items in the Cost Estimate Breakdown first — progress is
            tracked per task.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-zinc-900">
                Phase Completion Progress
              </h3>
              <Legend />
            </div>
            <div className="mt-6 flex gap-4">
              {/* Y-axis labels — a separate column, not inline with each
                  bar row, so they can line up against a single shared
                  plot area (with its own gridlines) to its right instead
                  of each bar drawing its own independent track. */}
              <div className="flex w-40 flex-shrink-0 flex-col gap-4">
                {progress.categories.map((category) => (
                  <span
                    key={category.id}
                    className="flex h-5 items-center truncate text-sm text-zinc-700"
                  >
                    {category.name}
                  </span>
                ))}
              </div>

              <div className="relative flex-1">
                {/* Gridlines at the same 0/20/40/60/80/100 marks the axis
                    below reads off — a real chart's plot background, not
                    a per-row gray track. Each bar now draws only its own
                    filled portion; the gridlines are what show through
                    the unfilled rest, exactly like the reference bar
                    graph's own faint vertical rules. */}
                <div className="pointer-events-none absolute inset-0">
                  {[0, 20, 40, 60, 80, 100].map((tick) => (
                    <div
                      key={tick}
                      className="absolute top-0 bottom-0 w-px bg-zinc-100"
                      style={{ left: `${tick}%` }}
                    />
                  ))}
                </div>
                <div className="relative z-10 flex flex-col gap-4">
                  {progress.categories.map((category) => (
                    <div key={category.id} className="h-5">
                      <div
                        className={`h-full rounded-sm transition-all ${STATUS_BAR_COLOR[category.status]}`}
                        style={{ width: `${category.percentComplete}%` }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-2 flex justify-between pl-44 text-xs text-zinc-400">
              <span>0%</span>
              <span>20%</span>
              <span>40%</span>
              <span>60%</span>
              <span>80%</span>
              <span>100%</span>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <h3 className="text-sm font-semibold text-zinc-900">
              Tasks Progress Breakdown
            </h3>
            <div className="mt-4 flex flex-col gap-6">
              {progress.categories.map((category) => (
                <div key={category.id}>
                  <h4 className="text-sm font-semibold text-zinc-800">
                    {category.name}
                  </h4>
                  <div className="mt-3 flex flex-col gap-3">
                    {category.tasks.map((task) => (
                      <div key={task.id} className="flex items-start gap-4">
                        {/* No truncate — a long task name wraps instead
                            of getting cut off with an ellipsis; the row
                            (items-start, not items-center) just grows
                            taller to fit it rather than clipping. */}
                        <span className="w-64 flex-shrink-0 text-sm text-zinc-700">
                          {task.name}
                        </span>
                        <div className="relative h-5 flex-1">
                          {/* Same faint-gridline plot background as Phase
                              Completion Progress above, drawn fresh per
                              row rather than shared across the whole
                              list — every row's bar sits at the exact
                              same left/right edges (same label and
                              status-column widths on every row), so the
                              lines still land in identical spots from
                              row to row without needing one continuous
                              overlay spanning the group. */}
                          <div className="pointer-events-none absolute inset-0">
                            {[0, 20, 40, 60, 80, 100].map((tick) => (
                              <div
                                key={tick}
                                className="absolute top-0 bottom-0 w-px bg-zinc-100"
                                style={{ left: `${tick}%` }}
                              />
                            ))}
                          </div>
                          <div
                            className={`relative z-10 h-full rounded-sm transition-all ${STATUS_BAR_COLOR[task.status]}`}
                            style={{ width: `${task.percentComplete}%` }}
                          />
                          {task.percentComplete > 0 && (
                            <span
                              className={`absolute inset-y-0 left-2 z-10 flex items-center text-[10px] font-semibold ${STATUS_INLINE_LABEL_COLOR[task.status]}`}
                            >
                              {task.percentComplete}%
                            </span>
                          )}
                        </div>
                        <span
                          className={`w-24 flex-shrink-0 text-right text-xs font-medium ${STATUS_TEXT_COLOR[task.status]}`}
                        >
                          {STATUS_LABEL[task.status]}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
