import { CheckCircle2, Circle, Clock, ListTodo } from "lucide-react";
import type { ReactNode } from "react";
import type { ProjectProgress, TaskStatus } from "@/lib/progress/data";
import type { DelayRiskAssessment } from "@/lib/forecasting/data";
import { riskLevelLabel, riskLevelBadgeClasses } from "@/lib/forecasting/status";

const STATUS_BAR_COLOR: Record<TaskStatus, string> = {
  completed: "bg-emerald-400",
  in_progress: "bg-amber-400",
  not_started: "bg-zinc-200",
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
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="flex-shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-xl font-semibold text-zinc-900">{value}</p>
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
        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-emerald-400 transition-all"
            style={{ width: `${progress.overallPercent}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
          <span>Start: {formatDateLong(startDate)}</span>
          <span>Target Completion: {formatDateLong(targetEndDate)}</span>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">
            Delay Risk Assessment
          </h3>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${riskLevelBadgeClasses(risk.riskLevel)}`}
          >
            {riskLevelLabel(risk.riskLevel)}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div>
            <p className="text-xs text-zinc-500">Forecasted Completion</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
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
            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
              {risk.spi != null ? risk.spi.toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Cost Performance (CPI)</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
              {risk.cpi != null ? risk.cpi.toFixed(2) : "—"}
            </p>
          </div>
          <div>
            <p className="text-xs text-zinc-500">Delay Reports (30d)</p>
            <p className="mt-0.5 text-sm font-semibold text-zinc-900">
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
            <div className="mt-6 flex flex-col gap-4">
              {progress.categories.map((category) => (
                <div key={category.id} className="flex items-center gap-4">
                  <span className="w-40 flex-shrink-0 truncate text-sm text-zinc-700">
                    {category.name}
                  </span>
                  <div className="h-4 flex-1 overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className={`h-full rounded-full transition-all ${STATUS_BAR_COLOR[category.status]}`}
                      style={{ width: `${category.percentComplete}%` }}
                    />
                  </div>
                  <span className="w-12 flex-shrink-0 text-right text-xs text-zinc-500">
                    {category.percentComplete}%
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-2 flex justify-between pl-40 text-xs text-zinc-400">
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
                      <div key={task.id} className="flex items-center gap-4">
                        <span className="w-48 flex-shrink-0 truncate text-sm text-zinc-700">
                          {task.name}
                        </span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-zinc-100">
                          <div
                            className={`h-full rounded-full transition-all ${STATUS_BAR_COLOR[task.status]}`}
                            style={{ width: `${task.percentComplete}%` }}
                          />
                        </div>
                        <span className="w-10 flex-shrink-0 text-right text-xs text-zinc-500">
                          {task.percentComplete}%
                        </span>
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
