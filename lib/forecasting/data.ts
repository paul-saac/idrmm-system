import { createClient } from "@/lib/supabase/server";
import type { ProjectRow } from "@/lib/projects/data";
import type { CostEstimate } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";
import type { ExpenseOverview } from "@/lib/expenses/data";

export type RiskLevel = "low" | "medium" | "high" | "unknown";

/**
 * Earned Value Management thresholds/knobs — deliberately named
 * constants, not magic numbers, so the methodology's assumptions are
 * visible in one place and easy to cite/adjust.
 *
 *   SPI >= 0.95           -> Low risk (on track)
 *   0.85 <= SPI < 0.95    -> Medium risk
 *   SPI < 0.85            -> High risk
 *
 * A project sitting at Low/Medium can still get bumped up one level if
 * it's had several weather/schedule-delay incidents reported recently
 * (see daily_log_survey) — SPI alone doesn't see a delay coming until
 * it's already shown up in logged quantities, but the foreman's own
 * daily report already flagged it.
 */
const SPI_LOW_RISK_THRESHOLD = 0.95;
const SPI_MEDIUM_RISK_THRESHOLD = 0.85;
const RECENT_DELAY_WINDOW_DAYS = 30;
const RECENT_DELAY_NUDGE_THRESHOLD = 3;

function riskLevelFromSpi(spi: number | null): RiskLevel {
  if (spi === null) return "unknown";
  if (spi >= SPI_LOW_RISK_THRESHOLD) return "low";
  if (spi >= SPI_MEDIUM_RISK_THRESHOLD) return "medium";
  return "high";
}

function nudgeRiskLevel(level: RiskLevel, recentDelayIncidentCount: number): RiskLevel {
  if (recentDelayIncidentCount < RECENT_DELAY_NUDGE_THRESHOLD) return level;
  if (level === "low") return "medium";
  if (level === "medium") return "high";
  return level;
}

/** Fraction of a [start, end] date window elapsed by `today`, clamped
 * to [0, 1]. A degenerate window (end <= start) is treated as already
 * fully elapsed once `today` reaches it, 0 before. */
function elapsedFraction(startISO: string, endISO: string, today: Date): number {
  const start = new Date(`${startISO}T00:00:00`).getTime();
  const end = new Date(`${endISO}T00:00:00`).getTime();
  const now = today.getTime();
  if (end <= start) return now >= start ? 1 : 0;
  if (now <= start) return 0;
  if (now >= end) return 1;
  return (now - start) / (end - start);
}

/** Approved daily logs in the trailing `windowDays` that reported a
 * weather or schedule delay — the qualitative signal that nudges risk
 * up when SPI alone hasn't caught up to what the foreman already
 * reported. Reads daily_log_survey_answers for whichever of the
 * project's Survey questions are flagged affects_delay_risk (the two
 * defaults every project starts with — "Any schedule delays occur?"
 * and "Did weather cause any delays?" — see seedDefaultSurveyQuestions
 * in lib/daily-logs/actions.ts) rather than the old fixed
 * weather_delays_occurred/schedule_delays_occurred columns on
 * daily_logs directly, since those are now editable/deletable per
 * project (0034_daily_log_survey_defaults.sql). Counts *logs*, not
 * answers — a log with both flagged "Yes" still only counts once,
 * matching the original .or(...) behavior. */
async function countRecentDelayIncidents(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number,
  windowDays: number
): Promise<number> {
  const since = new Date();
  since.setDate(since.getDate() - windowDays);
  const sinceDate = since.toISOString().slice(0, 10);

  const [{ data: logs }, { data: delayQuestions }] = await Promise.all([
    supabase
      .from("daily_logs")
      .select("id")
      .eq("project_id", projectId)
      .eq("status", "approved")
      .gte("log_date", sinceDate),
    supabase
      .from("daily_log_survey_questions")
      .select("id")
      .eq("project_id", projectId)
      .eq("affects_delay_risk", true),
  ]);

  const logIds = (logs ?? []).map((log) => log.id);
  const questionIds = (delayQuestions ?? []).map((question) => question.id);
  if (logIds.length === 0 || questionIds.length === 0) return 0;

  const { data: answers } = await supabase
    .from("daily_log_survey_answers")
    .select("daily_log_id")
    .in("daily_log_id", logIds)
    .in("question_id", questionIds)
    .eq("occurred", true);

  return new Set((answers ?? []).map((answer) => answer.daily_log_id)).size;
}

export type DelayRiskAssessment = {
  /** Budget at Completion — the project's total estimated cost. */
  bac: number;
  /** Earned Value — BAC's worth of budget "earned" by actual logged
   * progress so far, per task. */
  ev: number;
  /** Actual Cost — real money spent so far (the four expense ledgers). */
  ac: number;
  /** Planned Value — what should be done by today per the schedule
   * baseline. Null only if not a single task has any usable baseline
   * (neither its own planned dates nor the project's start/target-end
   * dates) — genuinely nothing to compare against yet. */
  pv: number | null;
  /** Schedule Performance Index (EV / PV). Null if PV isn't
   * computable, or is 0 (project/task hasn't reached its planned start
   * yet). */
  spi: number | null;
  /** Cost Performance Index (EV / AC). Null if nothing's been spent
   * yet. */
  cpi: number | null;
  riskLevel: RiskLevel;
  /** The SPI-only risk level, before the qualitative nudge — shown
   * alongside riskLevel so the UI can explain *why* a level changed. */
  riskLevelBeforeNudge: RiskLevel;
  recentDelayIncidentCount: number;
  /** ISO date, or null if there's no project start/target-end date to
   * forecast against, or SPI isn't computable. */
  forecastedCompletionDate: string | null;
  /** Positive = forecasted after the target end date (late), negative
   * = ahead of it. Null under the same conditions as
   * forecastedCompletionDate. */
  daysAheadOrBehind: number | null;
  /** False if any task is missing a planned start/end date and had to
   * fall back to the coarse project-wide baseline for its own PV
   * contribution — surfaced so the UI can caveat the numbers instead
   * of presenting them as more precise than they are. */
  hasCompleteScheduleBaseline: boolean;
  unscheduledTaskCount: number;
};

/**
 * The Automated Delay Risk Assessment / Completion Forecasting
 * calculation — Earned Value Management (PV/EV/AC/SPI/CPI) plus a
 * qualitative nudge from reported delay incidents. Takes data the
 * caller (the project detail page) has already fetched for its own
 * Overview/Progress/Expenses tabs — no need to re-fetch the cost
 * estimate or re-run the progress calculation here, this is a pure
 * derivation on top of them. Only the recent-delay-incident count needs
 * its own query.
 */
export async function getDelayRiskAssessment(
  projectId: number,
  project: Pick<ProjectRow, "startDate" | "targetEndDate">,
  costEstimate: CostEstimate,
  progress: ProjectProgress,
  expenseOverview: ExpenseOverview
): Promise<DelayRiskAssessment> {
  const supabase = await createClient();
  const recentDelayIncidentCount = await countRecentDelayIncidents(
    supabase,
    projectId,
    RECENT_DELAY_WINDOW_DAYS
  );

  const bac = costEstimate.summary.totalEstimatedCost;
  const ac =
    expenseOverview.actual.labor +
    expenseOverview.actual.material +
    expenseOverview.actual.equipment +
    expenseOverview.actual.other;

  const percentCompleteByTaskId = new Map<number, number>();
  for (const category of progress.categories) {
    for (const task of category.tasks) {
      percentCompleteByTaskId.set(task.id, task.percentComplete);
    }
  }

  const projectRange =
    project.startDate && project.targetEndDate
      ? { start: project.startDate, end: project.targetEndDate }
      : null;

  const today = new Date();
  let ev = 0;
  let pv = 0;
  let hasAnyBaseline = false;
  let unscheduledTaskCount = 0;

  for (const category of costEstimate.categories) {
    for (const task of category.tasks) {
      const percentComplete = percentCompleteByTaskId.get(task.id) ?? 0;
      ev += task.totalEstimateCost * (percentComplete / 100);

      const isTaskScheduled = Boolean(task.plannedStartDate && task.plannedEndDate);
      if (!isTaskScheduled) unscheduledTaskCount += 1;

      const range = isTaskScheduled
        ? { start: task.plannedStartDate!, end: task.plannedEndDate! }
        : projectRange;

      if (range) {
        hasAnyBaseline = true;
        pv += task.totalEstimateCost * elapsedFraction(range.start, range.end, today);
      }
    }
  }

  const spi = hasAnyBaseline && pv > 0 ? ev / pv : null;
  const cpi = ac > 0 ? ev / ac : null;

  const riskLevelBeforeNudge = riskLevelFromSpi(spi);
  const riskLevel = nudgeRiskLevel(riskLevelBeforeNudge, recentDelayIncidentCount);

  let forecastedCompletionDate: string | null = null;
  let daysAheadOrBehind: number | null = null;

  if (projectRange && spi !== null && spi > 0) {
    const start = new Date(`${projectRange.start}T00:00:00`);
    const target = new Date(`${projectRange.end}T00:00:00`);
    const plannedDurationDays = (target.getTime() - start.getTime()) / 86_400_000;

    if (plannedDurationDays > 0) {
      const forecastedDurationDays = plannedDurationDays / spi;
      const forecasted = new Date(
        start.getTime() + forecastedDurationDays * 86_400_000
      );
      forecastedCompletionDate = forecasted.toISOString().slice(0, 10);
      daysAheadOrBehind = Math.round(
        (forecasted.getTime() - target.getTime()) / 86_400_000
      );
    }
  }

  return {
    bac,
    ev,
    ac,
    pv: hasAnyBaseline ? pv : null,
    spi,
    cpi,
    riskLevel,
    riskLevelBeforeNudge,
    recentDelayIncidentCount,
    forecastedCompletionDate,
    daysAheadOrBehind,
    hasCompleteScheduleBaseline: unscheduledTaskCount === 0,
    unscheduledTaskCount,
  };
}
