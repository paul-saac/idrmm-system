"use client";

import { ProjectWriteButton, ProjectWriteInput, ProjectWriteSelect, useProjectCanEdit } from "@/components/projects/project-access-context";
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal, flushSync } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import {
  CalendarDays,
  ChartGantt,
  ChevronDown,
  ChevronRight,
  Diamond,
  GripVertical,
  Plus,
  Redo2,
  Trash2,
  Undo2,
} from "lucide-react";
import { AiSparklesIcon } from "@/components/ui/ai-sparkles-icon";
import { ProjectInsightsPanel } from "./project-insights-panel";
import type { ProjectInsightDestination } from "@/lib/project-insights/types";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { GanttDateInput } from "./gantt-date-input";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { SubtaskForm } from "@/components/projects/progress/subtask-form";
import { applyScheduleModalEdits, scheduleModalEdit, unconfirmedScheduleModalEdits, type PendingScheduleModalEdit, type ScheduleModalEdit } from "./schedule-modal-edits";
import { useEstimateSync } from "@/components/projects/cost-estimate/estimate-sync-context";
import { applyEstimateChanges, withSavedEstimateProgress, type EstimateChange } from "@/lib/cost-estimate/live-estimate";
import { computeWeights } from "@/lib/cost-estimate/weights";
import { moveScheduleRow } from "@/lib/cost-estimate/reorder-actions";
import { applyPendingScheduleMoves, scheduleOrderForMove, unconfirmedScheduleMoves, type PendingScheduleMove, type ScheduleRowMove } from "@/lib/cost-estimate/schedule-order";
import { AssignWorkersModalContent } from "@/components/projects/progress/assign-workers-modal-content";
import { EquipmentTrackingPanel } from "@/components/projects/equipment/equipment-tracking-panel";
import { loadEquipmentTracking } from "@/lib/equipment/tracking-actions";
import type { EquipmentTracking } from "@/lib/equipment/tracking-types";
import { ProgressTrackingModal, type ProgressModalTarget } from "@/components/projects/progress/progress-tracking-modal";
import type { MaterialStockItem } from "@/lib/materials/purchases-model";
import {
  ProjectCalendarView,
  type CalendarItem,
} from "@/components/projects/progress/project-calendar-view";
import { ProjectEventModalContent } from "@/components/projects/progress/project-event-modal-content";
import { usePortal } from "@/components/portal/portal-context";
import type { ProjectEvent } from "@/lib/project-events/types";
import {
  WeightBreakdownModal,
  type CostNavigateDestination,
  type WeightBreakdownTarget,
} from "@/components/projects/cost-estimate/weight-breakdown-modal-content";
import {
  updateTaskSchedule,
  updateCategorySchedule,
  updateTaskPriority,
  updateCategoryPriority,
  createCategory,
  updateCategory,
  updateSubtask,
  renameTask,
  createTask,
  deleteCategory,
  deleteTask,
  deleteScheduleItems,
} from "@/lib/cost-estimate/actions";
import { deleteProjectEvent } from "@/lib/project-events/actions";
import {
  undoGanttAction,
  redoGanttAction,
  resetGanttHistory,
} from "@/lib/cost-estimate/undo-redo-actions";
import type { CostCategory, CostTask, TaskPriority } from "@/lib/cost-estimate/data";
import { projectScheduleDates } from "@/lib/cost-estimate/schedule-dates";
import type { ScheduleDateChange } from "@/lib/cost-estimate/schedule-dates";
import { moveSelectedSchedules } from "@/lib/cost-estimate/schedule-actions";
import { barDragDays, selectedBarChanges } from "./gantt-bar-selection";
import { createScheduleMoveQueue } from "./schedule-move-queue";
import { ganttBarColors } from "./gantt-bar-colors";
import { createGanttOperationQueue } from "./gantt-operation-queue";
import { setTaskWorkers, setCategoryWorkers } from "@/lib/workers/actions";
import type { ProjectOverrideHistory } from "@/lib/progress-logs/types";
import type {
  Worker,
  WorkerAssignment,
  MemberGroup,
  TaskWorkerAssignments,
  CategoryWorkerAssignments,
} from "@/lib/workers/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import {
  computeAutoPercentComplete,
  computeExpectedProgress,
  countWorkingDays,
  EMPTY_PROGRESS_ANCHOR,
  groupPlannedMaterials,
  scheduleStatusFor,
  ZERO_COSTS,
  type ScheduleStatus,
} from "@/lib/task-progress/calculate";

type OptimisticScheduleDeletion = {
  taskIds: number[];
  categoryIds: number[];
  pending: boolean;
};
const NO_ESTIMATE_CHANGES: EstimateChange[] = [];

// Summing decimal weights leaves float noise (99.99 + 0.010000000000005116);
// two decimals is all a weight is ever shown to.
function roundWeight(value: number) {
  return Math.round(value * 100) / 100;
}

function formatWeightPoints(value: number) {
  return roundWeight(value).toLocaleString("en-PH", {
    maximumFractionDigits: 2,
  });
}

/** The Weight column's cell — display-only (automatic from cost, see
 * lib/cost-estimate/weights.ts); a click opens the Weight Breakdown
 * modal showing how it was computed. */
function WeightButton({
  weight,
  muted,
  onClick,
}: {
  weight: number;
  muted: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`h-full w-full cursor-pointer px-2 text-right text-xs tabular-nums transition hover:bg-zinc-900 hover:text-white ${
        muted ? "text-zinc-400" : "text-zinc-600"
      }`}
    >
      {formatWeightPoints(weight)}%
    </button>
  );
}

// Ahead blue, on track green, behind red — same as the progress
// modal's and the dashboard's own badges.
const SCHEDULE_STATUS_TEXT: Record<ScheduleStatus, string> = {
  ahead: "text-sky-600",
  on_track: "text-emerald-600",
  behind: "text-red-600",
};

const SCHEDULE_STATUS_LABEL: Record<ScheduleStatus, string> = {
  ahead: "Ahead of schedule",
  on_track: "On track",
  behind: "Behind schedule",
};

// The Expected column's own cell: where the schedule says the row should
// be by today, colored by schedule status (SCHEDULE_STATUS_TEXT — same
// 5-point tolerance as the Progress Tracking modal, see scheduleStatusFor).
function ExpectedProgressCell({
  actual,
  expected,
}: {
  actual: number;
  expected: number;
}) {
  const status = scheduleStatusFor(actual, expected);
  return (
    <span
      className={`flex h-full w-full items-center px-2 text-xs font-medium ${SCHEDULE_STATUS_TEXT[status]}`}
      title={`${SCHEDULE_STATUS_LABEL[status]} — actual ${Math.round(actual)}%, expected ${Math.round(expected)}%`}
    >
      {Math.round(expected)}%
    </span>
  );
}


function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function phaseRowId(categoryId: number) {
  return `phase-${categoryId}`;
}

function nextDay(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}

function previousDay(date: Date) {
  const prev = new Date(date);
  prev.setDate(prev.getDate() - 1);
  return prev;
}

// gantt-task-react's own bar-width math treats `end` as an *exclusive*
// boundary, not the inclusive last day the rest of this app (and the
// DB's own planned_end_date column) treats it as — confirmed directly
// by reading taskXCoordinate in the compiled bundle: a task whose `end`
// is exactly midnight on its own planned end date resolves to that
// day's own left edge, so the bar visually stops one full day short of
// covering it. Every GanttTask.end constructed for a real task/phase
// bar (never a milestone — its start/end are intentionally kept equal,
// a single point in time, and were never part of this problem) is
// pushed one day later (see nextDay above) than the true planned end
// date to compensate, purely so the bar's own rendered width covers the
// whole of its last working day.
//
// trueEndDate is the matching inverse — every other reader of a row's
// own `.end` in this file (the End date input, the Days column, drag/
// typed-edit persistence, the Assign Workers date badge) goes through
// this instead of reading `.end` directly, so nothing outside the bar's
// own rendering ever sees or saves the shifted value. The one
// GanttTooltipContent's own Duration line goes through it too.
function trueEndDate(row: { type: GanttTask["type"]; end: Date }): Date {
  return row.type === "milestone" ? row.end : previousDay(row.end);
}

// Every percent-complete display in this file goes through this —
// exactly 2 decimal places, never rounded off to a whole number. See
// computeAutoPercentComplete's own doc comment (lib/task-progress/
// calculate.ts) for why the underlying value itself is kept exact all
// the way through instead of rounding at the source.
function formatPercent(value: number) {
  return value.toFixed(2);
}

/** Local-date components, not UTC — matches how toDate() above parses
 * `${iso}T00:00:00` as local midnight, so a round trip through this
 * never shifts a day at a timezone boundary. */
function toIsoDate(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// The project's working schedule, for GanttTooltipContent below —
// gantt-task-react renders that tooltip itself and hands it only the
// task, so it reads the working days/holidays from here instead
// (provided around <Gantt> in GanttChartView).
const WorkScheduleContext = createContext<{
  workingDays: readonly number[];
  holidays: ReadonlySet<string>;
}>({ workingDays: [1, 2, 3, 4, 5, 6], holidays: new Set() });

// Mirrors gantt-task-react's own default hover tooltip (StandardTooltipContent)
// pixel-for-pixel — same date format, same CSS-module classes (_3T42e/_29NTg,
// confirmed directly by reading the compiled bundle, the same technique
// already used for the barLabel classes referenced in globals.css) — with
// two deliberate changes: Progress always renders, even at 0% (the
// library's own version guards it behind `!!task.progress`, so a task
// that hasn't started yet silently drops the line instead of showing
// "Progress: 0%"), and Duration counts working days only — a
// non-working weekday or holiday inside the bar isn't a day of work.
function GanttTooltipContent({
  task,
  fontSize,
  fontFamily,
}: {
  task: GanttTask;
  fontSize: string;
  fontFamily: string;
}) {
  const { workingDays, holidays } = useContext(WorkScheduleContext);
  const isMilestone = task.type === "milestone";
  const displayEnd = trueEndDate(task);
  const durationDays = isMilestone
    ? 0
    : countWorkingDays(task.start, displayEnd, workingDays, holidays);
  const headingSize = (parseInt(fontSize, 10) || 14) + 6;
  // A milestone's name without the date its label carries (see
  // milestoneLabel below) — the dates follow right after it here anyway.
  const separatorAt = task.name.lastIndexOf(MILESTONE_LABEL_SEPARATOR);
  const name = isMilestone && separatorAt >= 0 ? task.name.slice(0, separatorAt) : task.name;

  return (
    <div className="_3T42e" style={{ fontSize, fontFamily }}>
      <b style={{ fontSize: `${headingSize}px` }}>
        {name}: {task.start.getDate()}-{task.start.getMonth() + 1}-
        {task.start.getFullYear()} - {displayEnd.getDate()}-
        {displayEnd.getMonth() + 1}-{displayEnd.getFullYear()}
      </b>
      {!isMilestone && (
        <p className="_29NTg">Duration: {durationDays} day(s)</p>
      )}
      <p className="_29NTg">Progress: {formatPercent(task.progress)}%</p>
    </div>
  );
}

const MILESTONE_LABEL_SEPARATOR = " · ";

// A milestone's label beside its diamond: its name and its date, e.g.
// "Site ready · 23 Oct".
function milestoneLabel(name: string, date: Date) {
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${name}${MILESTONE_LABEL_SEPARATOR}${day}`;
}

// gantt-task-react's ViewMode enum has no "Quarter" granularity (it has
// Hour/QuarterDay/HalfDay/Day/Week/Month/Year instead — the "Quarter"
// options are sub-day zoom levels, not a 3-month view) — one real
// capability gap versus the previous SVAR build, not something this
// component can work around.
type TimelineView = "day" | "week" | "month" | "year";

// The toolbar's own zoom buttons — deliberately excludes "week" (see
// the `view` state's own doc comment in GanttChartView for why), even
// though TimelineView itself still includes it (every date-range/
// column-width calculation in this file already handles it, this is
// just not offering it as a pickable option).
const TIMELINE_VIEW_OPTIONS: readonly TimelineView[] = ["day", "month", "year"];

// The two ways to view the project's schedule — the toolbar's view menu
// (the shared ViewMenu, the Material record's too).
const SCHEDULE_VIEWS: ViewOption<"gantt" | "calendar">[] = [
  { value: "gantt", label: "Gantt", icon: <ChartGantt className="size-4" /> },
  { value: "calendar", label: "Calendar", icon: <CalendarDays className="size-4" /> },
];

const VIEW_MODE: Record<TimelineView, ViewMode> = {
  day: ViewMode.Day,
  week: ViewMode.Week,
  month: ViewMode.Month,
  year: ViewMode.Year,
};

// Day keeps a fixed width as tasks are added or their dates change.
// Coarser zoom levels can expand these minimum widths to fill the chart.
const BASE_COLUMN_WIDTH: Record<TimelineView, number> = {
  day: 60,
  week: 50,
  month: 100,
  year: 300,
};

// Rough (deliberately over-, never under-, estimated) count of header
// columns gantt-task-react will render for a given date span and zoom
// level — used only to size columns to fill available width, not to
// reproduce the library's exact internal date-seeding logic (which
// isn't exposed). Padded generously so a slight overestimate (columns a
// touch narrower than perfectly exact) is the failure mode, never an
// underestimate that would overshoot the container and defeat the
// point of this calculation.
function estimateColumnCount(view: TimelineView, min: Date, max: Date) {
  const days = Math.max(
    1,
    Math.round((max.getTime() - min.getTime()) / 86_400_000)
  );
  switch (view) {
    case "day":
      return days + 3;
    case "week":
      return Math.ceil(days / 7) + 3;
    case "month":
      return (
        (max.getFullYear() - min.getFullYear()) * 12 +
        (max.getMonth() - min.getMonth()) +
        3
      );
    case "year":
      return max.getFullYear() - min.getFullYear() + 3;
  }
}

// Same hand-built column-resize approach as the Cost Estimate Breakdown
// grid needed for SVAR — except here it's simpler: TaskListHeader/
// TaskListTable are plain React components we supply outright (not a
// string/HTML template rendered by the library), so a columnWidths
// state change is just a normal React re-render of our own lightweight
// table, not something that forces the whole chart to re-init. No
// guide-line-then-snap-on-release needed — every column resizes live.
const RESIZABLE_COLUMN_IDS = [
  "text",
  "start",
  "end",
  "duration",
  "priority",
  "weight",
  "assigned",
  "equipment",
  "percentComplete",
  "expected",
] as const;
type ResizableColumnId = (typeof RESIZABLE_COLUMN_IDS)[number];

// Start/end are wider than a plain date label needs — the native
// <input type="date"> that renders in those columns (see
// CustomTaskListTable) wants more room for its "MM/DD/YYYY" segments
// plus the calendar-icon affordance than static text like "Jan 5" did.
// text is wider than a name alone needs, too — its own add/edit buttons
// (moved into this cell, see CustomTaskListTable) now share the space
// with the name, not a separate Actions column. assigned is wider than
// priority/duration since it holds one or more worker names, not a
// single short word.
// duration/priority/assigned/percentComplete measured directly (canvas
// measureText, this app's own real font/cell padding) against their
// own widest realistic content — Days' own 3-digit values, "Medium"
// (Priority's widest option), the Assign button's own placeholder text,
// and the "Percent Complete" header label itself (longer than any
// value it'll ever hold) — each with a little padding on top, not
// shaved to the exact pixel, so text never touches the column's own
// border.
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnId, number> = {
  text: 220,
  start: 108,
  end: 108,
  duration: 46,
  priority: 80,
  weight: 70,
  assigned: 78,
  equipment: 78,
  percentComplete: 122,
  expected: 84,
};

const MIN_COLUMN_WIDTH: Record<ResizableColumnId, number> = {
  text: 140,
  start: 84,
  end: 84,
  duration: 38,
  priority: 68,
  weight: 56,
  assigned: 58,
  equipment: 58,
  percentComplete: 90,
  expected: 70,
};

// How far the whole task-list panel's own outer-edge handle can curtain
// it down to — see visiblePanelWidth's own doc comment. Deliberately
// much smaller than any single MIN_COLUMN_WIDTH above: those bound an
// individual column's own real width, this bounds how much of the
// panel can be covered/hidden, which is meant to be able to go quite
// far (just enough left to still see and re-grab the handle itself).
const MIN_PANEL_WIDTH = 40;

const COLUMN_LABEL: Record<ResizableColumnId, string> = {
  text: "Task",
  start: "Start",
  end: "End",
  duration: "Days",
  priority: "Priority",
  weight: "Weight",
  assigned: "Assigned",
  equipment: "Assigned Equipment",
  percentComplete: "Percent Complete",
  expected: "Expected",
};

const RIGHT_ALIGNED_COLUMNS = new Set<ResizableColumnId>(["duration"]);

const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 44;
// A *minimum* total row count to pad a short project's task list out
// to (see fillerTasks below) — not tied to any fixed-height CSS box
// anymore (there isn't one; the chart grows to fit however many real
// rows it has, filler or not, and the page scrolls through it). Just a
// plain target height, chosen to roughly match how tall the chart used
// to always look back when it *did* have a fixed box.
const MIN_CHART_FILL_HEIGHT_PX = 792;
// A row id prefix reserved for fillerTasks below — never a real
// category/task id (those are always plain numbers stringified), so
// `taskById`/`categoryById` lookups naturally miss for one and every
// piece of this file that keys off "is this a real row" (the edit
// button, the date inputs, drag persistence) already falls back to its
// inert case for free, with no separate "is this a filler" branching
// needed anywhere except the two spots that render unconditionally
// regardless of whether a real task was found — see CustomTaskListTable.
const FILLER_ROW_ID_PREFIX = "filler-";

// A sane bound for a typed Start/End year — catches an obvious typo
// (e.g. "2222" instead of "2026", or a year segment that only got one
// of its digits typed before something else moved focus off it) before
// it ever reaches an optimistic override or the server, not a real
// business rule about how far out a project could plan. Matches
// updateTaskSchedule/createTask/updateSubtask's own server-side copy of
// this same check in lib/cost-estimate/actions.ts — this client-side
// one exists purely so a bad year never even flashes on screen while
// the (identical) rejection round-trips to the server and back.
const MIN_PLANNED_YEAR = 1980;
const MAX_PLANNED_YEAR = 2100;

// No per-task `styles` override and no barCornerRadius prop below —
// both deliberately left at the library's own defaults (barBackgroundColor
// #b8c2cc / barProgressColor #a3a3ff for tasks, projectBackgroundColor
// #fac465 / projectProgressColor #7db59a for phases, barCornerRadius 3 —
// confirmed directly by reading the compiled bundle's own default props)
// so the chart matches gantt-task-react's own reference look exactly
// instead of drifting from it. Milestones (blue, to match the task list's
// diamond) and phases (a slate summary bracket) are the exceptions — see
// the <Gantt> below and globals.css.
//
// A larger custom barCornerRadius (10, tried earlier) broke visibly on
// short-duration bars: a radius bigger than half a narrow bar's own
// pixel width pinches the rounded-rect into a lozenge/tent shape rather
// than a clean pill — confirmed directly on a handful of 1-2 day tasks.
// The library's own default of 3 stays proportionate at any bar width.

type ScheduleOverride = { start: string; end: string };

const EMPTY_OVERRIDES: ReadonlyMap<number, unknown> = new Map();

// Optimistic local override for some per-task field (schedule, priority,
// name, ...), set the instant an edit finishes — see persistTaskDates,
// handleTaskPriorityEdit, and handleTaskRename in GanttChartView below
// for its three current callers. Without this, a just-made edit only
// shows up once router.refresh() pulls fresh `categories`/`progress`
// props back down from the server — for schedule specifically,
// gantt-task-react also resets its own in-progress-drag visual state to
// "" the moment the mouse comes up (confirmed directly by reading the
// compiled bundle: setGanttEvent clears synchronously on mouseup,
// *before* onDateChange's promise even starts), so without an override
// the bar has nowhere correct to fall back to for however long that
// round trip takes and snaps to its *pre-drag* position, then jumps
// again once the round trip lands. For priority/name it's less visually
// jarring but still a real, measurable lag (this round trip re-fetches
// this whole page's ~20 parallel queries in page.tsx, easily 1-2s in
// dev) — priority's own color coding and a just-typed name would both
// otherwise sit stale (or, for name, flash back to the *old* value the
// instant the rename input closes) until that lands. Setting an
// override here closes that gap for whichever field it's used for:
// reads immediately reflect the edited value, synchronously, with no
// round trip to wait for.
//
// A refresh can belong to another cost/schedule save. Retain each field
// override until its own value is confirmed, so an unrelated response
// cannot roll back a newer name, priority or date while it is saving.
//
// Generic (not schedule-specific) so each field gets its own isolated
// Map via its own hook call — e.g. renaming a task while a priority
// change for a *different* task is still in flight can't clobber it,
// since they're never sharing one Map/state slot.
function usePendingOverrides<T>(categories: CostCategory[], confirmed: (rows: CostCategory[], id: number, value: T) => boolean) {
  const [state, setState] = useState<{
    categoriesAtSet: CostCategory[];
    overrides: Map<number, T>;
  } | null>(null);

  let overrides: ReadonlyMap<number, T> = state?.overrides ?? (EMPTY_OVERRIDES as ReadonlyMap<number, T>);
  if (state && state.categoriesAtSet !== categories) {
    const remaining = new Map([...state.overrides].filter(([id, value]) => !confirmed(categories, id, value)));
    if (remaining.size !== state.overrides.size) {
      overrides = remaining;
      setState({ categoriesAtSet: categories, overrides: remaining });
    }
  }

  function setOverride(taskId: number, override: T) {
    setState((prev) => {
      const base =
        prev
          ? prev.overrides
          : new Map<number, T>();
      const next = new Map(base);
      next.set(taskId, override);
      return { categoriesAtSet: categories, overrides: next };
    });
  }

  function clearOverride(taskId: number, expected?: T) {
    setState((prev) => {
      if (!prev || !prev.overrides.has(taskId)) {
        return prev;
      }
      if (expected !== undefined && prev.overrides.get(taskId) !== expected) return prev;
      const next = new Map(prev.overrides);
      next.delete(taskId);
      return { categoriesAtSet: categories, overrides: next };
    });
  }

  function updateOverrides(entries: ReadonlyMap<number, T | null>, expected?: ReadonlyMap<number, T>) {
    if (entries.size === 0) return;
    setState(prev => {
      const next = new Map(prev?.overrides);
      for (const [id, value] of entries) {
        if (expected && next.get(id) !== expected.get(id)) continue;
        if (value === null) next.delete(id);
        else next.set(id, value);
      }
      return { categoriesAtSet: categories, overrides: next };
    });
  }

  return [overrides, setOverride, clearOverride, updateOverrides] as const;
}

/**
 * The Schedule tab: the project's planning workspace, built on
 * `gantt-task-react` (MIT-licensed, dependency-free). Third Gantt
 * engine tried this session — after SVAR (kept, then reverted back to
 * after a DHTMLX detour) — chosen this time specifically for its
 * TaskListHeader/TaskListTable props: unlike SVAR's string-based column
 * config or DHTMLX's HTML-string cell templates, these are plain React
 * components we supply outright, so the Task/Start/End/Days/Priority
 * grid below is real JSX — including mounting the actual add/edit
 * buttons directly in the Task cell (no separate Actions column — see
 * that cell's own comment below for why), which DHTMLX's HTML-template
 * cells couldn't do at all. Delete itself isn't a button in this table
 * at all (unlike the Cost Estimate Breakdown's own table) — it's a
 * button inside each row's own Edit modal instead, see SubtaskForm's
 * and CategoryForm's own doc comments.
 *
 * Its React peer dependency is `^18.0.0` — this app runs React 19, so
 * it's installed with --legacy-peer-deps. Works in practice (verified
 * directly: rendering, dragging, and the custom grid all behave
 * correctly), but it's an unverified-by-upstream combination worth
 * knowing about if something Gantt-related ever breaks after a React
 * bump.
 *
 * Drag persistence is simpler here than either previous engine, verified
 * directly before writing this:
 *  - `onDateChange(task, children)` fires exactly once, on release — not
 *    per animation frame like SVAR's raw drag event, so no event needs
 *    filtering by an `inProgress` flag.
 *  - `children` lists tasks that *depend on* the dragged one via
 *    `dependencies`, but their own start/end come back unchanged — the
 *    library does not auto-cascade a reschedule through dependents, it
 *    only tells you who they are. This component deliberately ignores
 *    `children` and persists only the directly-dragged task, matching
 *    how the Predecessor field has always worked elsewhere in this
 *    app (a visual dependency arrow, not an auto-scheduling engine) —
 *    nothing here should move a task the user didn't directly touch.
 *  - Returning `false` from `onDateChange` makes the library revert the
 *    drag's own internal visual state itself — confirmed by testing a
 *    failed persist directly. No manual revert bookkeeping needed on a
 *    failure, unlike the SVAR build's router.refresh()-based
 *    reconciliation (still called after a *successful* persist, since
 *    that's what pulls the corrected phase-row rollup back down through
 *    the `categories` prop).
 *  - Phase ("project"-type) rows are natively not draggable at all —
 *    confirmed directly (no onDateChange call, no visual movement).
 *    SVAR needed an intercepted "drag-task" to stop a phase drag from
 *    cascading into moving every child task; this library never needed
 *    that guard, though one is still kept here as cheap insurance.
 *
 * Each phase (category) is a `type: "project"` row — EXCEPT a task-less
 * one, which is `type: "task"` instead (see the `tasks` useMemo below),
 * per an explicit request: a standalone phase with nothing under it yet
 * (e.g. "MOBILIZATION") should have its own bar draggable the same way
 * a real task's is, to set its start/end without needing a subtask
 * first. `isProject` in the row-rendering loop below is therefore keyed
 * off categoryById (an id-space check), never `row.type` directly —
 * every other category-only behavior (bold name, its own Start/End/
 * Assign/Priority cells, the phase-tinted row background, etc.) still
 * needs to apply regardless of which underlying gantt-task-react type
 * makes the bar itself draggable. persistDrag mirrors this same
 * dispatch for the drag-release side. Auto-rollup of a project row's
 * own start/end from its children is not something this library
 * computes for you (its `start`/`end` fields are required, not derived)
 * — same as the SVAR build, this component still computes each phase's
 * aggregate start/end/progress itself from its tasks.
 */
export type { ProjectInsightDestination } from "@/lib/project-insights/types";

export function GanttChartView({
  projectId,
  projectName,
  categories,
  projectStartDate,
  projectEndDate,
  workingDays,
  holidays,
  events,
  canUndo,
  canRedo,
  workers,
  workerAssignments,
  memberGroups,
  defaultWorkerIds = [],
  taskWorkerAssignments,
  categoryWorkerAssignments,
  taskProgressToday,
  categoryProgressToday,
  overrideHistory,
  initialEquipmentTracking = null,
  onOpenMaterialBreakdown,
  onImportBom,
  onNavigateToCostEstimate,
  onNavigateInsight,
  materialStocks,
}: {
  projectId: number;
  projectName: string;
  /** Actual completion uses saved progress; dates determine Expected only. */
  categories: CostCategory[];
  /** Only ever used as a fallback for a task/phase with no dates of its
   * own yet (see fallbackStart/fillerDate below) — a task's own typed
   * Start/End is otherwise unbounded, see handleTaskDateEdit's own doc
   * comment for why. */
  projectStartDate: string | null;
  /** Empty timelines cover the project schedule before any work is added. */
  projectEndDate: string | null;
  /** The project's own working-days setting (lib/projects/data.ts) —
   * which ISO weekdays count toward a task's schedule, same convention
   * computeAutoPercentComplete already uses server-side (lib/task-
   * progress/calculate.ts) to derive each task's percentComplete.
   * Threaded down to the Progress Tracking modal so it can show the
   * same "time elapsed" reading there, purely as context alongside
   * quantity/labor — see ProgressTrackingModalContent's own doc
   * comment. */
  workingDays: number[];
  /** The project's own holidays (lib/projects/data.ts) — left out of
   * Expected progress the same way a non-working weekday is. */
  holidays: string[];
  /** The project's calendar events (lib/project-events/data.ts) — shown
   * on the Calendar view. */
  events: ProjectEvent[];
  /** From lib/cost-estimate/undo-redo.ts's getGanttUndoRedoState, fetched
   * server-side alongside categories/progress — refreshes for free
   * through the same revalidatePath/router.refresh() flow every Gantt
   * mutation already triggers, no separate polling needed. */
  canUndo: boolean;
  canRedo: boolean;
  /** The company Team (the admin's Team page) and each task's current
   * assignments from it — see lib/workers/data.ts. Fetched alongside
   * categories/progress, same revalidatePath-driven refresh as
   * everything else here. */
  workers: Worker[];
  /** Every member's open assignments, any project — their availability
   * in the Assigned picker. */
  workerAssignments: WorkerAssignment[];
  /** The Team's groups (crews) — the Assign picker adds a whole one at
   * once. */
  memberGroups: MemberGroup[];
  defaultWorkerIds?: number[];
  taskWorkerAssignments: TaskWorkerAssignments;
  /** Same idea, one level up — see CategoryWorkerAssignments's own doc
   * comment. */
  categoryWorkerAssignments: CategoryWorkerAssignments;
  /** Every task's own cumulative-to-date progress plus whatever's
   * already recorded for today — see lib/task-progress/data.ts, fetched
   * alongside categories/progress. Pre-fills the Progress Tracking
   * modal instead of it needing its own per-open fetch. */
  taskProgressToday: Record<number, TaskProgressToday>;
  /** Same idea, one level up, for a task-less category's own Progress
   * Tracking Override — see lib/category-progress/data.ts. Only ever
   * reachable for a category with no tasks yet (see
   * percentCompleteByCategoryId's own doc comment). */
  categoryProgressToday: Record<number, TaskProgressToday>;
  /** Preloaded per-task/phase override history, keyed by `task-<id>` or
   * `category-<id>`, so the Progress Tracking modal renders it immediately. */
  overrideHistory: ProjectOverrideHistory;
  /** Preloaded equipment tracking so the Assign Equipment and Progress modals render immediately. */
  initialEquipmentTracking?: EquipmentTracking | null;
  /** Opens the shared Material Breakdown modal — owned by
   * project-detail-view.tsx, the nearest common ancestor with
   * CostEstimateView (which owns that modal's own trigger too) —
   * highlighting the given task's own row there. Wired to the Edit
   * Task form's own "See All" button under Assigned Resources (see
   * SubtaskForm's own onViewMaterials prop). */
  onOpenMaterialBreakdown: (taskId?: number) => void;
  /** Opens the shared "Import with AI" modal — same modal, same open
   * state (project-detail-view.tsx), as the entry point already in
   * Material Breakdown's own footer (see MaterialBreakdownModalContent's
   * own onImportBom). The schedule header's button is a second, more visible
   * entry point into the identical flow, not a separate one. */
  onImportBom: () => void;
  onNavigateToCostEstimate?: (target: CostNavigateDestination) => void;
  onNavigateInsight: (destination: ProjectInsightDestination) => void;
  materialStocks?: MaterialStockItem[];
}) {
  const router = useRouter();
  const [operationQueue] = useState(createGanttOperationQueue);
  const historyQueued = useRef(0);
  const categoriesRef = useRef(categories);
  categoriesRef.current = categories;
  const estimateSync = useEstimateSync();
  const sharedCostChanges = estimateSync?.changes ?? NO_ESTIMATE_CHANGES;
  const savingSharedCost = sharedCostChanges.some(change => change.pending);
  const successorArrowId = useId();
  // Month is the default — unlike Week, its column labels are plain
  // month names with no "W##" numbering that could read as resetting
  // each time the visible range crosses a year boundary (an ISO-8601
  // week-numbering quirk, not a bug, but confusing at a glance for a
  // non-technical viewer). Week itself is deliberately not offered as
  // a toolbar option for that same reason — Day/Month/Year are, all
  // three already fully supported by every date-range/column-width
  // calculation in this file (computeChartDateRange/seedGanttDates/
  // estimateColumnCount all switch on TimelineView already), so
  // exposing them is just this one piece of UI, nothing else to wire.
  const [view, setView] = useState<TimelineView>("month");
  // Editing only — adding a phase no longer opens this at all (see
  // handleAddPhase below), just creates it directly and drops straight
  // into the inline rename input on its own row instead.
  const [categoryModal, setCategoryModal] = useState<{
    id: number;
    name: string;
    hasTasks: boolean;
    isMilestone: boolean;
  } | null>(null);
  // Which phase row's own name is showing as a live text input right
  // now, instead of its normal chevron+name display — set the instant
  // handleAddPhase's own create call succeeds, so a freshly-added phase
  // drops straight into "type the real name" instead of sitting there
  // as "New Task" until someone remembers to rename it. Also settable by
  // clicking a phase's own name directly (see its own button below) —
  // renaming isn't only available right after creation, every phase's
  // name is always renameable this way. The pencil icon's own
  // CategoryForm modal still exists alongside it purely for Delete
  // (its own rename field is now redundant with this, but harmless).
  const [editingCategoryId, setEditingCategoryId] = useState<number | null>(
    null
  );
  const inlineNameDrafts = useRef(new Map<string, { value: string; start: number | null; end: number | null }>());
  const pendingNameCreations = useRef(new Map<string, Promise<number | undefined>>());
  // Add Phase's own optimistic row — unlike renaming/priority (which
  // patch a field on a row that already exists), a brand new phase has
  // nothing to patch: it doesn't exist client-side until the server
  // hands back a real id. This synthesizes a temporary one (negative id,
  // guaranteed not to collide with a real DB id) the instant "+" is
  // clicked, fed into `categoriesForDisplay` below so it flows through
  // the exact same `tasks`/`categoryById` pipeline a real phase does —
  // no separate rendering branch needed, it just looks like a real row
  // until the genuine one replaces it.
  //
  // Tied to the `categories` reference active when it was set, same
  // auto-expiry trick pendingScheduleOverrides uses (see
  // usePendingOverrides' own doc comment) — it stops showing the
  // instant a fresh `categories` prop (containing the *real* phase, via
  // router.refresh()) lands, with nothing to reconcile field-by-field.
  //
  // Deliberately positioned here, before percentCompleteByCategoryId/
  // taskById/categoryById/tasks below (all of which need to see it) —
  // NOT in this file's other usual "new hooks go after visibleTasks"
  // safe zone, since those three are computed earlier in render order
  // than visibleTasks and can't read state declared after themselves.
  // Verified directly this doesn't break the React Compiler's own
  // memoization of effectiveTasks/timelineExtent/visibleTasks
  // downstream (the exact failure mode this file's other doc comments
  // describe) via eslint's react-hooks/preserve-manual-memoization rule
  // before considering this safe to ship.
  // Undo/Redo's own optimistic full-state swap — unlike every other
  // override here, which patches one field/adds one row on top of the
  // existing `categories`, an undo/redo genuinely replaces the *whole*
  // schedule with a past (or future) snapshot fetched server-side (see
  // undoGanttAction/redoGanttAction in undo-redo-actions.ts, which now
  // fetch and return the restored categories directly instead of
  // leaving the caller to wait on router.refresh() to find out what
  // changed). Set the instant that round trip resolves; categoriesForDisplay
  // below treats it as the new base in place of the (now stale) `categories`
  // prop until a fresh one actually lands.
  //
  // Carries canUndo/canRedo alongside categories, not just the restored
  // schedule — confirmed directly this was needed, not just nice to
  // have: without it, the buttons kept reading their stale *pre*-undo
  // enabled props (still true right after an undo that emptied the
  // history) for however long router.refresh() below took to land, so
  // Undo stayed clickable and a second click in that window fired a
  // second real undo. Tied to the exact same `categoriesAtSet` — both
  // pieces come from the same undoGanttAction/redoGanttAction round
  // trip and both go stale the instant a fresh `categories` prop
  // (carrying its own fresh canUndo/canRedo alongside it, from the same
  // page.tsx fetch) actually lands.
  const [undoRedoOverride, setUndoRedoOverride] = useState<{
    categoriesAtSet: CostCategory[];
    categories: CostCategory[];
    canUndo: boolean;
    canRedo: boolean;
  } | null>(null);
  const activeUndoRedoOverride =
    undoRedoOverride && undoRedoOverride.categoriesAtSet === categories
      ? undoRedoOverride
      : null;
  const activeCategoriesOverride = activeUndoRedoOverride?.categories ?? null;
  const [historyAvailability, setHistoryAvailability] = useState<{
    categoriesAtSet: CostCategory[]; canUndo: boolean; canRedo: boolean;
  } | null>(null);
  const activeHistoryAvailability = historyAvailability?.categoriesAtSet === categories ? historyAvailability : null;
  const effectiveCanUndo = activeHistoryAvailability?.canUndo ?? activeUndoRedoOverride?.canUndo ?? canUndo;
  const effectiveCanRedo = activeHistoryAvailability?.canRedo ?? activeUndoRedoOverride?.canRedo ?? canRedo;
  function markHistoryEdit() {
    setHistoryAvailability({ categoriesAtSet: categoriesRef.current, canUndo: true, canRedo: false });
  }
  function queueEdit<T extends { error?: string }>(operation: () => Promise<T>) {
    return operationQueue.run(async () => {
      const result = await operation();
      if (!result.error) markHistoryEdit();
      return result;
    });
  }
  const [pendingNewPhase, setPendingNewPhase] = useState<{
    categoriesAtSet: CostCategory[];
    category: CostCategory;
  } | null>(null);
  const activeNewPhase =
    pendingNewPhase && !categories.some(category => category.id === pendingNewPhase.category.id)
      ? pendingNewPhase.category
      : null;
  // Same idea, one level down — a subtask added via a phase row's own
  // "+" (see handleAddSubtask below). Keyed by which category it's
  // going into (categoryId) rather than embedding the whole CostTask
  // pre-merged, since categoriesForDisplay below needs to splice it
  // into that *specific* category's own `tasks` array each render.
  const [pendingNewTask, setPendingNewTask] = useState<{
    categoriesAtSet: CostCategory[];
    categoryId: number;
    task: CostTask;
  } | null>(null);
  const activeNewTask =
    pendingNewTask && !categories.some(category => category.tasks.some(task => task.id === pendingNewTask.task.id))
      ? pendingNewTask
      : null;
  const [optimisticDeletions, setOptimisticDeletions] = useState<OptimisticScheduleDeletion[]>([]);
  const [modalEdits, setModalEdits] = useState<PendingScheduleModalEdit[]>([]);
  const modalEditSequence = useRef(0);
  const [modalSaveError, setModalSaveError] = useState<string | null>(null);
  const activeModalEdits = useMemo(() => unconfirmedScheduleModalEdits(activeCategoriesOverride ?? categories, modalEdits),
    [categories, activeCategoriesOverride, modalEdits]);
  if (activeModalEdits !== modalEdits) setModalEdits(activeModalEdits);
  const savingModalEdit = activeModalEdits.some(edit => edit.pending);
  const [rowMoves, setRowMoves] = useState<PendingScheduleMove[]>([]);
  const rowMoveSequence = useRef(0);
  const [rowMoveError, setRowMoveError] = useState<string | null>(null);
  const draggedRow = useRef<{ kind: "category" | "task"; id: number; categoryId: number | null } | null>(null);
  const dropMarker = useRef<HTMLElement | null>(null);
  const activeRowMoves = useMemo(() => unconfirmedScheduleMoves(activeCategoriesOverride ?? categories, rowMoves),
    [categories, activeCategoriesOverride, rowMoves]);
  if (activeRowMoves !== rowMoves) setRowMoves(activeRowMoves);
  const savingRowOrder = activeRowMoves.some(entry => entry.pending);
  // Keep rows hidden through unrelated refreshes while saving, and until
  // server data confirms their absence. Then discard the mask so Undo can
  // restore those IDs normally.
  const activeDeletions = useMemo(() => optimisticDeletions.filter((deletion) =>
    deletion.pending || (activeCategoriesOverride ?? categories).some((category) =>
      deletion.categoryIds.includes(category.id) ||
      category.tasks.some((task) => deletion.taskIds.includes(task.id))
    )
  ), [optimisticDeletions, categories, activeCategoriesOverride]);
  if (activeDeletions.length !== optimisticDeletions.length) {
    setOptimisticDeletions(activeDeletions);
  }
  // `tasks`/`categoryById`/`taskById`/percentCompleteByCategoryId below
  // all read this merged value (a subtask needs `taskById` too, unlike
  // a phase — its own Priority/rename/etc. cells all resolve `task`
  // through that map; percentCompleteByCategoryId needs it specifically
  // for activeCategoriesOverride — an undo/redo's restored tasks have
  // real, non-zero percentages that a phase's own rollup must reflect
  // immediately too, unlike activeNewPhase/activeNewTask's always-0%
  // placeholders, which the rollup's own `?? 0` fallback already
  // handles fine without the extra merge). Every usePendingOverrides(...)
  // call elsewhere still deliberately reads the raw `categories` prop,
  // not this — their own auto-expiry compares against that exact
  // reference, and this array is freshly created on every render while
  // any of these three overrides is active, so using it there would
  // make every override expire the render after it's set.
  const localCategoriesForDisplay = useMemo(() => {
    let result = activeCategoriesOverride ?? categories;
    if (activeNewPhase) {
      result = [...result, activeNewPhase];
    }
    if (activeNewTask) {
      result = result.map((c) =>
        c.id === activeNewTask.categoryId
          ? { ...c, tasks: [...c.tasks, activeNewTask.task] }
          : c
      );
    }
    if (activeModalEdits.length > 0) {
      result = applyScheduleModalEdits(result, activeModalEdits.map(entry => entry.edit));
    }
    if (activeDeletions.length > 0) {
      const categoryIds = new Set(activeDeletions.flatMap((item) => item.categoryIds));
      const taskIds = new Set(activeDeletions.flatMap((item) => item.taskIds));
      result = result.filter((category) => !categoryIds.has(category.id)).map((category) => ({
        ...category,
        tasks: category.tasks.filter((task) => !taskIds.has(task.id)),
      }));
    }
    if (activeRowMoves.length > 0) result = applyPendingScheduleMoves(result, activeRowMoves);
    return result;
  }, [categories, activeCategoriesOverride, activeNewPhase, activeNewTask, activeDeletions, activeModalEdits, activeRowMoves]);
  const categoriesForDisplay = useMemo(() => {
    const updated = withSavedEstimateProgress(applyEstimateChanges(localCategoriesForDisplay, sharedCostChanges), {
      task: taskProgressToday, category: categoryProgressToday, workingDays, holidays,
    });
    const weights = computeWeights(updated);
    return updated.map(category => ({ ...category, weight: weights.categoryWeights.get(category.id) ?? 0,
      tasks: category.tasks.map(task => ({ ...task, weight: weights.taskWeights.get(task.id) ?? 0 })),
    }));
  }, [localCategoriesForDisplay, sharedCostChanges, taskProgressToday, categoryProgressToday, workingDays, holidays]);
  // Same click-to-rename pattern as editingCategoryId above, just for a
  // subtask's own name cell — its pencil icon's SubtaskForm modal still
  // exists alongside it for everything else (dates, priority, milestone,
  // materials/labor, Delete), this is purely the fast-path rename.
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  // Edit-only now — adding a subtask no longer opens this at all (see
  // handleAddSubtask below), same "create directly, rename inline"
  // change handleAddPhase/editingCategoryId already went through for
  // phases. SubtaskForm itself still technically supports a create
  // mode (task === undefined) for everything this inline flow doesn't
  // cover — nothing in this file constructs it that way anymore, but
  // gutting that mode out of a shared, non-trivial form component is a
  // separate, larger change than this one, left alone.
  const [taskModal, setTaskModal] = useState<CostTask | null>(null);
  // A discriminated union rather than two separate pieces of state —
  // only one "Assign workers" modal is ever open at a time, for either
  // a task row or, one level up, a category row with no tasks yet (see
  // categoryDatesLocked's own doc comment above for that same "only
  // while empty" gating, and CategoryWorkerAssignments's own doc
  // comment for why a category can have its own assigned workers at
  // all).
  const [assignWorkersModal, setAssignWorkersModal] = useState<
    | {
        kind: "task";
        taskId: number;
        name: string;
        start: Date;
        end: Date;
      }
    | {
        kind: "category";
        categoryId: number;
        name: string;
        start: Date;
        end: Date;
      }
    | null
  >(null);
  // Opened by a single click on a task's own bar, or — one level up — a
  // task-less category's own bar (see handleBarClick below) — the
  // Progress Tracking Override modal. A discriminated union, same
  // "one modal, either entity kind" shape assignWorkersModal above
  // already uses; carries the whole task/category, not just its id,
  // since the modal needs its own estimatedQuantity/unit/percentComplete
  // for display alongside the form.
  // highlightLatest: opened from a notification — its Last override (the
  // change it was about) is highlighted.
  const [progressModal, setProgressModal] = useState<ProgressModalTarget | null>(null);
  const [equipmentTarget, setEquipmentTarget] = useState<{ key: string; name: string } | null>(null);
  const [projectInsightsOpen, setProjectInsightsOpen] = useState(false);
  const [equipmentSaving, setEquipmentSaving] = useState(false);
  const [equipmentTracking, setEquipmentTracking] = useState<EquipmentTracking | null>(initialEquipmentTracking);
  const [prevInitialEquipmentTracking, setPrevInitialEquipmentTracking] = useState(initialEquipmentTracking);
  if (initialEquipmentTracking !== prevInitialEquipmentTracking) {
    setPrevInitialEquipmentTracking(initialEquipmentTracking);
    if (initialEquipmentTracking) setEquipmentTracking(initialEquipmentTracking);
  }
  useEffect(() => {
    if (initialEquipmentTracking) return;
    let active = true;
    loadEquipmentTracking(projectId).then((result) => {
      if (active && result.data) setEquipmentTracking(result.data);
    }).catch(() => { /* The assignment panel shows a retryable load error. */ });
    return () => { active = false; };
  }, [projectId, initialEquipmentTracking]);

  // A notification (?progress=task-12 or category-5) opens the saved record
  // read-only, with the notification's log date selected. Compared with
  // the last one handled during render (React's "adjust state when a
  // prop changes" pattern), then dropped from the URL below — so a
  // refresh doesn't reopen it, and the same link works again later.
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const progressParam = searchParams.get("progress");
  const rawProgressDate = searchParams.get("progressDate");
  const progressDate =
    rawProgressDate && /^\d{4}-\d{2}-\d{2}$/.test(rawProgressDate)
      ? rawProgressDate
      : undefined;
  const progressTargetKey = progressParam
    ? `${progressParam}:${progressDate ?? ""}`
    : null;
  const [handledProgressParam, setHandledProgressParam] = useState<string | null>(null);
  if (progressTargetKey !== handledProgressParam) {
    setHandledProgressParam(progressTargetKey);
    const [kind, rawId] = (progressParam ?? "").split("-");
    const id = Number(rawId);
    if (kind === "task") {
      const task = categoriesForDisplay
        .flatMap((category) => category.tasks)
        .find((t) => t.id === id);
      if (task && !task.isMilestone) {
        setProgressModal({
          kind: "task",
          task,
          readOnly: true,
          highlightLatest: !progressDate,
          highlightEntryDate: progressDate,
        });
      }
    } else if (kind === "category") {
      const category = categoriesForDisplay.find((c) => c.id === id);
      if (category && category.tasks.length === 0 && !category.isMilestone) {
        setProgressModal({
          kind: "category",
          category,
          readOnly: true,
          highlightLatest: !progressDate,
          highlightEntryDate: progressDate,
        });
      }
    }
  }
  useEffect(() => {
    if (!progressParam) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete("progress");
    params.delete("progressDate");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }, [progressParam, pathname, router, searchParams]);
  // Gantt chart vs. Calendar view of the same tasks (the toolbar's
  // view menu, SCHEDULE_VIEWS) — see ProjectCalendarView.
  const [calendarView, setCalendarView] = useState(false);
  const { isAdmin } = usePortal();
  const canEdit = useProjectCanEdit();
  // The Calendar view's Add event / event chip — a new event on a day,
  // or an existing one to edit. See ProjectEventModalContent.
  const [eventModal, setEventModal] = useState<
    { date: string; event?: ProjectEvent } | null
  >(null);

  // Delete from a modal's own ⋮ menu (Edit Phase / Edit Task / Edit
  // Event) — asks first. Schedule rows disappear as soon as confirmed;
  // failures restore them and reopen the confirmation with an error.
  const [pendingDelete, setPendingDelete] = useState<{
    kind: "phase" | "task" | "event" | "selection";
    name: string;
    remove: () => Promise<{ error?: string }>;
    close: () => void;
    items?: { taskIds: number[]; categoryIds: number[] };
  } | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // The task list's ticked rows (gantt-task-react row ids) — tasks, and
  // phases without tasks — for the toolbar's Delete.
  const [selectedRowIds, setSelectedRowIds] = useState<ReadonlySet<string>>(() => new Set());

  function toggleRowSelected(rowId: string) {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function confirmAndDelete(
    kind: "phase" | "task" | "event" | "selection",
    name: string,
    remove: () => Promise<{ error?: string }>,
    close: () => void,
    items?: { taskIds: number[]; categoryIds: number[] }
  ) {
    if (!canEdit || deleting) return;
    setDeleteError(null);
    setPendingDelete({ kind, name, remove, close, items });
  }

  async function runPendingDelete() {
    if (!pendingDelete || !canEdit || deleting) return;
    const request = pendingDelete;
    const deletion = request.items ? { ...request.items, pending: true } : null;
    setDeleting(true);
    setDeleteError(null);
    if (deletion) {
      setOptimisticDeletions((previous) => [...previous, deletion]);
      setPendingDelete(null);
      if (request.kind !== "selection") request.close();
    }
    try {
      const result = await request.remove();
      if (result.error) throw new Error(result.error);
      if (deletion) {
        setPendingNewPhase((previous) => previous && deletion.categoryIds.includes(previous.category.id) ? null : previous);
        setPendingNewTask((previous) => previous && (
          deletion.categoryIds.includes(previous.categoryId) || deletion.taskIds.includes(previous.task.id)
        ) ? null : previous);
        setOptimisticDeletions((previous) => previous.map((item) =>
          item === deletion ? { ...item, pending: false } : item
        ));
      }
      request.close();
      setPendingDelete(null);
      router.refresh();
    } catch (error) {
      if (deletion) {
        setOptimisticDeletions((previous) => previous.filter((item) => item !== deletion));
      }
      setPendingDelete(request);
      setDeleteError(error instanceof Error ? error.message : "Could not delete. Please try again.");
      // A multi-row delete may have partially saved before the failure.
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  // A calendar bar opens the same Daily Progress Update a Gantt bar does.
  function handleCalendarItemClick(item: CalendarItem) {
    for (const category of categoriesForDisplay) {
      if (item.kind === "category" && category.id === item.id) {
        setProgressModal({ kind: "category", category });
        return;
      }
      const task = category.tasks.find((t) => t.id === item.id);
      if (item.kind === "task" && task) {
        setProgressModal({ kind: "task", task });
        return;
      }
    }
  }

  // The Weight column's own click-through — see WeightButton.
  const [weightBreakdown, setWeightBreakdown] = useState<WeightBreakdownTarget | null>(
    null
  );
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(
    new Set()
  );
  // Read side (the message itself) is intentionally unused — validation
  // still rejects/snaps back bad input at every setScheduleError(...)
  // call site below, only the visible error text was removed.
  const [, setScheduleError] = useState<string | null>(null);
  // No existing "disable while a direct server-action call is in
  // flight" convention in this component to reuse (updateTaskSchedule
  // below is called directly, not through useActionState — only the 3
  // modal forms get a `pending` flag for free that way), so this is its
  // own local state, same as that one already manages its own
  // optimistic/error state by hand.
  const [isUndoRedoPending, setIsUndoRedoPending] = useState(false);

  function clearRowDrag() {
    if (dropMarker.current) delete dropMarker.current.dataset.ganttDrop;
    dropMarker.current = null;
    draggedRow.current = null;
  }

  function handleRowMove(move: ScheduleRowMove) {
    if (!canEdit || deleting || isUndoRedoPending || move.id <= 0 || move.targetId <= 0) return;
    if (!scheduleOrderForMove(categoriesForDisplay, move)) return;
    const token = ++rowMoveSequence.current;
    setRowMoveError(null);
    // Update rows and bars before starting any network work. Keep later drops
    // responsive while serializing writes to preserve their exact click order.
    setRowMoves(previous => [...previous, { token, move, pending: true }]);
    void operationQueue.run(async () => {
      try {
        const result = await moveScheduleRow(projectId, move);
        if (result.error || !result.order) throw new Error(result.error ?? "Could not save the task order.");
        markHistoryEdit();
        setRowMoves(previous => previous.map(entry => entry.token === token
          ? { ...entry, pending: false, savedOrder: result.order } : entry));
      } catch (error) {
        setRowMoves(previous => previous.filter(entry => entry.token !== token));
        setRowMoveError(error instanceof Error ? error.message : "Could not save the task order. Please try again.");
      } finally {
        router.refresh();
      }
    });
  }

  // Initialize before queued mutations, including edits made during first load.
  const [historyReady, setHistoryReady] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    operationQueue.run(() => resetGanttHistory(projectId)).then(() => {
      if (!cancelled) {
        setHistoryAvailability({ categoriesAtSet: categoriesRef.current, canUndo: false, canRedo: false });
        setHistoryReady(true);
      }
    }).catch(() => {
      if (!cancelled) setHistoryError("Could not initialize Undo/Redo. Refresh the project to retry.");
    });
    return () => { cancelled = true; };
    // One baseline for this chart visit; all edits use the same ordered queue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleUndo() {
    if (!canEdit || savingSharedCost) return;
    if (!historyReady || (!effectiveCanUndo && operationQueue.pending === 0)) return;
    return handleHistory("undo");
  }

  function handleRedo() {
    if (!canEdit || savingSharedCost) return;
    if (!historyReady || (!effectiveCanRedo && historyQueued.current === 0)) return;
    return handleHistory("redo");
  }

  function handleHistory(direction: "undo" | "redo") {
    groupDragCleanup.current?.();
    historyQueued.current++;
    setIsUndoRedoPending(true);
    setHistoryError(null);
    // Each click runs after earlier saves in exact order, even during another Undo.
    return operationQueue.run(async () => {
      try {
        const result = await (direction === "undo" ? undoGanttAction(projectId) : redoGanttAction(projectId));
        if (result.error) { setHistoryError(result.error); return; }
        setHistoryAvailability({ categoriesAtSet: categoriesRef.current, canUndo: result.canUndo ?? false, canRedo: result.canRedo ?? false });
        if (result.categories) {
          setRowMoves([]); setModalEdits([]); setOptimisticDeletions([]);
          setUndoRedoOverride({ categoriesAtSet: categoriesRef.current, categories: result.categories,
            canUndo: result.canUndo ?? false, canRedo: result.canRedo ?? false });
          clearHistoryOverrides();
        }
        setPendingNewPhase(null); setPendingNewTask(null);
      } catch {
        setHistoryError("Could not reach the server. Please try again.");
      } finally {
        historyQueued.current--;
        if (historyQueued.current === 0) { setIsUndoRedoPending(false); router.refresh(); }
      }
    });
  }

  // Ctrl+Z (undo) / Ctrl+Y or Ctrl+Shift+Z (redo, both — Y is the
  // Windows convention this was explicitly asked for, Shift+Z the
  // common Mac/Linux alternative, cheap to also support) — window-level
  // since there's no single element that "owns" the whole chart's focus.
  // Never fires while focus is actually inside a text field or a modal
  // is open: Ctrl+Z typed into a task name field should undo *that*
  // text edit (the browser's own native behavior), not the whole
  // project's schedule/cost history out from under whatever the user is
  // mid-typing.
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const modifier = e.ctrlKey || e.metaKey;
      if (!modifier) return;

      const key = e.key.toLowerCase();
      if (key !== "z" && key !== "y") return;

      if (categoryModal || taskModal) return;

      const target = e.target as HTMLElement | null;
      const isEditableTarget =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isEditableTarget) return;

      e.preventDefault();
      if (key === "y" || (key === "z" && e.shiftKey)) {
        handleRedo();
      } else {
        handleUndo();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    historyReady,
    effectiveCanUndo,
    effectiveCanRedo,
    isUndoRedoPending,
    savingModalEdit,
    savingRowOrder,
    savingSharedCost,
    categoryModal,
    taskModal,
  ]);

  // Which phase row's Start/End/Percent Complete cell currently has its
  // "why can't I edit this" info bubble open — a phase's date input is
  // inert (pointer-events-none, see CustomTaskListTable) and its
  // Percent Complete cell isn't an input at all, just computed text, so
  // this is driven by a click on the *cell* wrapping it instead of the
  // input itself. top/left are the clicked cell's own
  // getBoundingClientRect(), taken once at click time — the bubble
  // itself is portaled straight to <body> and positioned from these
  // instead of living in-flow inside the task list panel, since that
  // panel's own horizontal scroll clipping was cutting the bubble off
  // the moment it grew wider than the panel (confirmed directly: the
  // text was cut off mid-word).
  const [cellInfoTooltip, setCellInfoTooltip] = useState<{
    rowId: string;
    field: "start" | "end" | "percentComplete";
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    if (!cellInfoTooltip) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-phase-info-cell]")) {
        setCellInfoTooltip(null);
      }
    }
    // Dismiss rather than drift out of place — a portaled, fixed-
    // position bubble positioned from a one-time getBoundingClientRect()
    // can't follow the cell live the way an in-flow tooltip would if
    // the chart (or the page) scrolls while it's open.
    function handleScroll() {
      setCellInfoTooltip(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [cellInfoTooltip]);
  // A task row's own Start/End cell's "focused" look (white background +
  // border, plus the calendar icon itself — see its own opacity rule in
  // globals.css) is driven by a plain `data-cell-active` DOM attribute,
  // toggled directly by each input's own onFocus/onBlur (see the inputs
  // themselves below) — deliberately NOT React state, and this is the
  // second attempt at that: a first version tracked it as state right
  // here (`activeDateCell`, since removed) and confirmed directly that
  // doing so broke the calendar icon entirely (clicking it opened
  // nothing). Root cause: CustomTaskListTable is declared *inside* this
  // component (see handleChartMouseDown's own doc comment above for the
  // same hazard hit once already, there for a different reason) — a
  // fresh function reference every render — so any state update here
  // that re-renders this component hands gantt-task-react's <Gantt> a
  // brand-new TaskListTable prop, which gantt-task-react (ordinary React
  // reconciliation on a changed element type) responds to by unmounting
  // and remounting the *entire* task list. setActiveDateCell(...) inside
  // onFocus was triggering exactly that remount, on every single click —
  // destroying the real DOM node the browser had just focused a moment
  // earlier and replacing it with an unfocused twin, right as the
  // browser would otherwise have opened the native picker from that same
  // click. A plain DOM attribute mutation never touches React state, so
  // it never re-renders this component and never triggers that remount.
  //
  // :focus itself was ruled out before this (twice — an !important
  // :focus rule didn't help either): confirmed directly that Chromium
  // stops matching :focus on a date input the moment its own calendar
  // popup opens, even though the field never actually blurs — which is
  // also exactly why plain onFocus/onBlur (real DOM events, not a CSS
  // pseudo-class) is the right primitive to hang this off of: the field
  // never actually blurs while its own popup is open, so the attribute
  // stays set for that whole time with no dependency on :focus at all,
  // and each input manages only its own attribute — no shared "which
  // cell is active" bookkeeping (state or otherwise) needed at all,
  // since a direct field-to-field click always pairs blur (old field)
  // with focus (new field), no cross-cell coordination required.

  const [columnWidths, setColumnWidths] =
    useState<Record<ResizableColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  // Always shown for now — the toolbar's own Show/Hide Task List toggle
  // was removed pending a later design pass. Collapsing the grid to
  // just the timeline is a documented gantt-task-react pattern: an
  // empty `listCellWidth` hides it entirely (not a boolean prop).
  const showTaskList = true;

  const fallbackStart = projectStartDate ? toDate(projectStartDate) : new Date();
  const fallbackEnd = projectEndDate ? toDate(projectEndDate) : fallbackStart;

  // Every duration in this view (the Days column, the hover card, the
  // phase rollups below) counts working days only — the project's own
  // Working days, holidays left out — same as Expected progress does.
  const holidaySet = useMemo(() => new Set(holidays), [holidays]);
  const workSchedule = useMemo(
    () => ({ workingDays, holidays: holidaySet }),
    [workingDays, holidaySet]
  );
  function workingDaysBetween(start: Date, end: Date) {
    return countWorkingDays(start, end, workingDays, holidaySet);
  }

  function resolvedDates(task: { plannedStartDate: string | null; plannedEndDate: string | null }) {
    return {
      start: task.plannedStartDate ? toDate(task.plannedStartDate) : fallbackStart,
      end: task.plannedEndDate ? toDate(task.plannedEndDate) : fallbackEnd,
    };
  }

  // A phase's own percent complete is never stored — a *duration-
  // weighted* average of its own tasks' percentComplete (each directly
  // user-editable, see CostTask's own doc comment), not a plain
  // per-task average. Confirmed directly against a reference tool
  // (same 3 subtasks, same percentages, only one subtask's own end
  // date shortened) that this is the expected behavior: the phase's
  // own rollup shifted even though no percentage changed, because a
  // shorter subtask now counts for less of the total. Each task's own
  // weight is its planned duration in working days (the same count the
  // Days column shows), so a short 100%-done task pulls the phase's own
  // percent up less than a long one would. Empty of tasks (a fresh
  // phase with nothing added yet), or every task resolving to 0 working
  // days, reads as 0.
  const percentCompleteByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of categoriesForDisplay) {
      // Task-less: this category's own directly-tracked percentComplete
      // (see CostCategory's own doc comment and 0048_category_progress_
      // tracking.sql) rather than a rollup of nothing — same asymmetric
      // rule Start/End/Labor Percentage already use.
      if (category.tasks.length === 0) {
        map.set(category.id, category.percentComplete);
        continue;
      }
      let weightedSum = 0;
      let totalDuration = 0;
      for (const task of category.tasks) {
        const { start, end } = resolvedDates(task);
        const duration = workingDaysBetween(start, end);
        weightedSum += duration * task.percentComplete;
        totalDuration += duration;
      }
      // Exact fraction, not rounded — see computeAutoPercentComplete's
      // own doc comment for why: this value flows into row.progress
      // below, formatted for display only at the point it's rendered.
      map.set(category.id, totalDuration > 0 ? weightedSum / totalDuration : 0);
    }
    return map;
    // fallbackStart/fallbackEnd (read indirectly through resolvedDates)
    // deliberately omitted — see the identical omission (and its own
    // doc comment) on the `tasks` useMemo elsewhere in this file; same
    // reasoning applies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesForDisplay, workingDays, holidaySet]);

  // Expected progress (where the schedule says each row should be by
  // today) for the Expected column — the counterpart to Percent Complete,
  // which is only what's actually been logged. Same shared math as the
  // Progress Tracking modal (computeExpectedProgress). A phase with tasks
  // rolls its tasks up the same duration-weighted way its own Percent
  // Complete does, so the two stay comparable; null means no schedule to
  // measure against.
  const expectedByTaskId = useMemo(() => {
    const today = new Date();
    const map = new Map<number, number | null>();
    for (const category of categoriesForDisplay) {
      for (const task of category.tasks) {
        map.set(
          task.id,
          computeExpectedProgress({
            plannedStartDate: task.plannedStartDate,
            plannedEndDate: task.plannedEndDate,
            workingDays,
            holidays,
            today,
          }).timePercent
        );
      }
    }
    return map;
  }, [categoriesForDisplay, workingDays, holidays]);

  const expectedByCategoryId = useMemo(() => {
    const today = new Date();
    const map = new Map<number, number | null>();
    for (const category of categoriesForDisplay) {
      if (category.tasks.length === 0) {
        map.set(
          category.id,
          computeExpectedProgress({
            plannedStartDate: category.plannedStartDate,
            plannedEndDate: category.plannedEndDate,
            workingDays,
            holidays,
            today,
          }).timePercent
        );
        continue;
      }
      let weightedSum = 0;
      let totalDuration = 0;
      for (const task of category.tasks) {
        const expected = expectedByTaskId.get(task.id);
        if (expected == null) continue;
        const { start, end } = resolvedDates(task);
        const duration = workingDaysBetween(start, end);
        weightedSum += duration * expected;
        totalDuration += duration;
      }
      map.set(category.id, totalDuration > 0 ? weightedSum / totalDuration : null);
    }
    return map;
    // resolvedDates' own fallbacks deliberately omitted, same as
    // percentCompleteByCategoryId above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesForDisplay, expectedByTaskId, workingDays, holidays]);

  // Keyed by the same string ids used in the `tasks` array below, so the
  // custom TaskListTable can hand a clicked row's full record to the
  // Edit modal / delete button without needing anywhere to stash extra
  // fields on a GanttTask object (its type has no room for custom
  // properties, unlike SVAR's ITask or DHTMLX's Task).
  const taskById = useMemo(() => {
    const map = new Map<string, CostTask>();
    for (const category of categoriesForDisplay) {
      for (const task of category.tasks) {
        map.set(String(task.id), task);
      }
    }
    return map;
  }, [categoriesForDisplay]);

  // The schedule header's counts: each task (a task-less category
  // counts as its own task) and the milestones.
  const scheduleCounts = useMemo(() => {
    let tasks = 0;
    let milestones = 0;
    for (const category of categoriesForDisplay) {
      if (category.tasks.length === 0) {
        if (category.isMilestone) milestones += 1;
        else tasks += 1;
      }
      for (const task of category.tasks) {
        if (task.isMilestone) milestones += 1;
        else tasks += 1;
      }
    }
    return { tasks, milestones };
  }, [categoriesForDisplay]);

  // The Calendar view (the toolbar's view menu) — every dated task, and
  // every dated task-less category, as a bar across its own days. A
  // category with tasks isn't its own bar; its tasks are.
  const calendarItems = useMemo(() => {
    const items: CalendarItem[] = [];
    const add = (
      kind: CalendarItem["kind"],
      row: {
        id: number;
        name: string;
        plannedStartDate: string | null;
        plannedEndDate: string | null;
        percentComplete: number;
      }
    ) => {
      if (row.id <= 0 || !row.plannedStartDate || !row.plannedEndDate) return;
      if (row.plannedEndDate < row.plannedStartDate) return;
      items.push({
        kind,
        id: row.id,
        name: row.name,
        start: row.plannedStartDate,
        end: row.plannedEndDate,
        percentComplete: row.percentComplete,
      });
    };
    for (const category of categoriesForDisplay) {
      if (category.tasks.length === 0) add("category", category);
      for (const task of category.tasks) add("task", task);
    }
    return items;
  }, [categoriesForDisplay]);

  const categoryById = useMemo(() => {
    const map = new Map<
      string,
      {
        id: number;
        name: string;
        hasTasks: boolean;
        isMilestone: boolean;
        priority: TaskPriority;
        weight: number;
      }
    >();
    for (const category of categoriesForDisplay) {
      map.set(phaseRowId(category.id), {
        id: category.id,
        name: category.name,
        // A category's own Start/End cells are only directly editable
        // while this is false — see the `tasks` useMemo above and the
        // Start/End cell rendering below, both of which read it too.
        hasTasks: category.tasks.length > 0,
        // Only while it has no tasks — see CostCategory's own isMilestone.
        isMilestone: category.tasks.length === 0 && category.isMilestone,
        priority: category.priority,
        // Already the sum of its tasks' weights while it has any — see
        // lib/cost-estimate/weights.ts.
        weight: category.weight,
      });
    }
    return map;
  }, [categoriesForDisplay]);

  // The ticked rows that still exist (and can still be ticked — a phase
  // that's since gained tasks can't), split the way deleteScheduleItems
  // takes them.
  const selectedTaskIds: number[] = [];
  const selectedCategoryIds: number[] = [];
  for (const rowId of selectedRowIds) {
    const task = taskById.get(rowId);
    if (task) {
      if (task.id > 0 && !task.isMilestone) selectedTaskIds.push(task.id);
      continue;
    }
    const category = categoryById.get(rowId);
    if (category && category.id > 0 && !category.hasTasks && !category.isMilestone) {
      selectedCategoryIds.push(category.id);
    }
  }
  const selectedCount = selectedTaskIds.length + selectedCategoryIds.length;

  function deleteSelected() {
    const taskIds = selectedTaskIds;
    const categoryIds = selectedCategoryIds;
    confirmAndDelete(
      "selection",
      `${selectedCount} ${selectedCount === 1 ? "task" : "tasks"}`,
      () => queueEdit(() => deleteScheduleItems(projectId, { taskIds, categoryIds })),
      () => setSelectedRowIds(new Set()),
      { taskIds, categoryIds }
    );
  }


  const workerById = useMemo(() => {
    const map = new Map<number, Worker>();
    for (const worker of workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [workers]);

  const defaultWorkerSet = useMemo(
    () => new Set(defaultWorkerIds),
    [defaultWorkerIds]
  );

  /**
   * Resolves the label and tooltip for the Gantt chart "Assigned" cell:
   * Prioritizes skilled workers first, then other non-management crew,
   * followed by management members at the end.
   * If only default management is attached (no active crew assigned yet),
   * the cell displays "Assign" to invite assignment rather than showing
   * the project manager's name across every row.
   */
  const getAssignedCellDisplay = useCallback(
    (assignedIds: number[]) => {
      const assignedWorkers = assignedIds
        .map((id) => workerById.get(id))
        .filter((w): w is Worker => Boolean(w));

      if (assignedWorkers.length === 0) {
        return { label: "Assign", title: "Assign workers", hasAssigned: false };
      }

      const isSubcontractor = (w: Worker) => w.employmentType === "subcontractor";
      const isManagement = (w: Worker) =>
        !isSubcontractor(w) && (w.category === "management" || defaultWorkerSet.has(w.id));
      const isSkilled = (w: Worker) =>
        !isManagement(w) && (w.category === "skilled" || isSubcontractor(w));

      const skilledWorkers: Worker[] = [];
      const otherWorkers: Worker[] = [];
      const managementWorkers: Worker[] = [];

      for (const w of assignedWorkers) {
        if (isSkilled(w)) {
          skilledWorkers.push(w);
        } else if (isManagement(w)) {
          managementWorkers.push(w);
        } else {
          otherWorkers.push(w);
        }
      }

      const activeCrew = [...skilledWorkers, ...otherWorkers];
      const displayWorkers =
        activeCrew.length > 0 ? [...activeCrew, ...managementWorkers] : [];

      const names = displayWorkers.map((w) => w.fullName);
      const hasAssigned = names.length > 0;
      const label = hasAssigned ? names.join(", ") : "Assign";
      const title = hasAssigned ? names.join(", ") : "Assign workers";

      return { label, title, hasAssigned };
    },
    [workerById, defaultWorkerSet]
  );

  const tasks: GanttTask[] = useMemo(() => {
    const result: GanttTask[] = [];
    // A fresh local date, deliberately not fallbackStart (see
    // fillerDate's own doc comment elsewhere in this file for the exact
    // same reasoning/hazard) — a brand-new, still-childless phase with
    // no planned dates of its own yet falls back to today/today (a
    // freshly created phase has no schedule of its own yet, so "right
    // now" reads better than fallbackStart's own project-start-or-today
    // plus a week), not the wider single-task fallback range
    // resolvedDates still uses for a genuinely dateless *task*.
    const emptyPhaseDate = new Date();
    for (const category of categoriesForDisplay) {
      // A phase with no task items yet still gets its own row (with a
      // placeholder date range) rather than being skipped entirely —
      // otherwise there'd be nowhere in the Gantt itself to click "+"
      // and add that phase's very first task. That range is its own
      // persisted plannedStartDate/plannedEndDate once the admin has
      // actually set one (directly editable in this state — see the
      // Start/End cell rendering below and categoryById's own
      // hasTasks) — today/today only until then.
      const emptyPhaseRange = {
        start: category.plannedStartDate
          ? toDate(category.plannedStartDate)
          : emptyPhaseDate,
        end: category.plannedEndDate
          ? toDate(category.plannedEndDate)
          : emptyPhaseDate,
      };
      const childDates =
        category.tasks.length > 0
          ? category.tasks.map(resolvedDates)
          : [emptyPhaseRange];
      // A task-less category marked as a milestone is a diamond on its
      // one date, the same as a milestone task below (its planned end
      // if set, otherwise its planned start).
      const isMilestoneCategory = category.tasks.length === 0 && category.isMilestone;
      const categoryMilestoneDate = category.plannedEndDate
        ? emptyPhaseRange.end
        : emptyPhaseRange.start;

      result.push({
        id: phaseRowId(category.id),
        styles: ganttBarColors(category.id, category.tasks.length > 0 ? "summary" : isMilestoneCategory ? "milestone" : "standalone"),
        // "task" (not "project") for a category with no subtasks yet —
        // see this component's own doc comment above for why: it needs
        // its own bar to actually be draggable, which gantt-task-react
        // only ever allows for a "task"/"milestone" type row.
        type:
          category.tasks.length > 0 ? "project" : isMilestoneCategory ? "milestone" : "task",
        name: isMilestoneCategory
          ? milestoneLabel(category.name, categoryMilestoneDate)
          : category.name,
        start: isMilestoneCategory
          ? categoryMilestoneDate
          : new Date(Math.min(...childDates.map((d) => d.start.getTime()))),
        // +1 day for the bar's own rendering — see trueEndDate's own doc
        // comment above. `childDates` itself stays the true, unshifted
        // date throughout (it's also what feeds a task-less phase's own
        // rollup Start/End cells further below). A milestone's isn't.
        end: isMilestoneCategory
          ? categoryMilestoneDate
          : nextDay(new Date(Math.max(...childDates.map((d) => d.end.getTime())))),
        progress: percentCompleteByCategoryId.get(category.id) ?? 0,
        hideChildren: collapsedPhaseIds.has(phaseRowId(category.id)),
        dependencies: category.predecessorCategoryId
          ? [phaseRowId(category.predecessorCategoryId)]
          : category.predecessorTaskId ? [String(category.predecessorTaskId)] : undefined,
      });

      category.tasks.forEach((task, i) => {
        // A milestone collapses to a single date — the planned end if
        // set (a milestone usually marks when something finishes, e.g.
        // "Permit Approved"), otherwise the planned start.
        const milestoneDate = task.plannedEndDate
          ? childDates[i].end
          : childDates[i].start;

        result.push({
          id: String(task.id),
          styles: ganttBarColors(category.id, task.isMilestone ? "milestone" : "subtask"),
          type: task.isMilestone ? "milestone" : "task",
          // A milestone's label carries its date too — the task list
          // shows task.name itself.
          name: task.isMilestone ? milestoneLabel(task.name, milestoneDate) : task.name,
          start: task.isMilestone ? milestoneDate : childDates[i].start,
          // +1 day for the bar's own rendering — see trueEndDate's own
          // doc comment above. A milestone's own end is never shifted.
          end: task.isMilestone ? milestoneDate : nextDay(childDates[i].end),
          progress: task.percentComplete,
          project: phaseRowId(category.id),
          dependencies: task.predecessorTaskId
            ? [String(task.predecessorTaskId)]
            : task.predecessorCategoryId ? [phaseRowId(task.predecessorCategoryId)] : undefined,
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesForDisplay, percentCompleteByCategoryId, collapsedPhaseIds]);

  const [pendingScheduleOverrides, setScheduleOverride, clearScheduleOverride, updateScheduleOverrides] =
    usePendingOverrides<ScheduleOverride>(categories, (rows, id, value) => {
      const task = rows.flatMap(category => category.tasks).find(task => task.id === id);
      return task?.plannedStartDate === value.start && task?.plannedEndDate === value.end;
    });
  // Same idea, one level up — a task-less category's own bar is now
  // draggable/editable too (see this component's own doc comment
  // above), and needs the exact same "show it instantly, don't wait for
  // the round trip" treatment a task's schedule already gets, or its
  // own edit would sit visually stale for however long router.refresh()
  // takes. A separate Map (own id-space, category ids vs task ids —
  // same reasoning as every other category/task override pair in this
  // file) rather than reusing pendingScheduleOverrides above.
  const [
    pendingCategoryScheduleOverrides,
    setCategoryScheduleOverride,
    clearCategoryScheduleOverride,
    updateCategoryScheduleOverrides,
  ] = usePendingOverrides<ScheduleOverride>(categories, (rows, id, value) => {
    const category = rows.find(category => category.id === id);
    return category?.plannedStartDate === value.start && category?.plannedEndDate === value.end;
  });

  function clearHistoryOverrides() {
    for (const [id, value] of pendingNameOverrides) clearNameOverride(id, value);
    for (const [id, value] of pendingCategoryNameOverrides) clearCategoryNameOverride(id, value);
    for (const [id, value] of pendingPriorityOverrides) clearPriorityOverride(id, value);
    for (const [id, value] of pendingCategoryPriorityOverrides) clearCategoryPriorityOverride(id, value);
    updateScheduleOverrides(new Map([...pendingScheduleOverrides.keys()].map(id => [id, null])), pendingScheduleOverrides);
    updateCategoryScheduleOverrides(new Map([...pendingCategoryScheduleOverrides.keys()].map(id => [id, null])), pendingCategoryScheduleOverrides);
  }

  // Applies any pending optimistic overrides (see usePendingOverrides'
  // own doc comment) on top of the otherwise-unaware `tasks` above — kept
  // as a separate pass, rather than reading pendingScheduleOverrides
  // inside `tasks` itself, purely to satisfy the React Compiler: with the
  // override hook's own useState called any earlier than this (in
  // particular, anywhere before `tasks`'s own useMemo), it silently gave
  // up preserving memoization for timelineExtent/visibleTasks below,
  // confirmed directly by bisecting hook-call position. A category WITH
  // tasks (still `type: "project"`) never gets an override of its own —
  // it's not directly draggable/editable (see this component's own doc
  // comment below) — but its bar is its tasks' span, so it's re-spanned
  // here from their *overridden* dates too: the phase follows a dragged
  // or retyped task the same instant, not once the refresh lands. A task-less
  // category (now `type: "task"`) instead checks categoryById first, to
  // read from its own override Map rather than the task one below —
  // its id would never actually match a real task's anyway (a task id
  // is a plain number, a category row's id is "phase-<id>", so
  // Number(row.id) is NaN and never found in pendingScheduleOverrides),
  // but this is the actual, correct lookup rather than relying on that.
  const effectiveTasks: GanttTask[] = useMemo(() => {
    if (
      pendingScheduleOverrides.size === 0 &&
      pendingCategoryScheduleOverrides.size === 0
    ) {
      return tasks;
    }
    const today = new Date();
    const rows = tasks.map((row) => {
      if (row.type === "project") return row;
      const category = categoryById.get(row.id);
      const override = category
        ? pendingCategoryScheduleOverrides.get(category.id)
        : pendingScheduleOverrides.get(Number(row.id));
      if (!override) return row;
      const startDate = toDate(override.start);
      const endDate = toDate(override.end);
      const task = category ? undefined : taskById.get(row.id);
      const fullCategory = category
        ? categoriesForDisplay.find((c) => c.id === category.id)
        : undefined;
      const progress =
        row.type === "milestone"
          ? row.progress
          : task
            ? computeAutoPercentComplete({
                plannedStartDate: override.start,
                plannedEndDate: override.end,
                estimatedQuantity: task.estimatedQuantity,
                plannedMaterials: groupPlannedMaterials(task.materialAssignments),
                plannedCosts: {
                  labor: task.laborEstimate,
                  material: task.materialEstimate,
                  equipment: task.equipmentEstimate,
                  other: task.otherCostEstimate,
                },
                workingDays,
                holidays,
                anchor: taskProgressToday[task.id] ?? EMPTY_PROGRESS_ANCHOR,
                today,
              })
            : fullCategory
              ? computeAutoPercentComplete({
                  plannedStartDate: override.start,
                  plannedEndDate: override.end,
                  estimatedQuantity: fullCategory.estimatedQuantity,
                  plannedMaterials: groupPlannedMaterials(
                    fullCategory.materialAssignments
                  ),
                  plannedCosts: {
                    labor: fullCategory.categoryLaborEstimate,
                    material: fullCategory.categoryMaterialEstimate,
                    equipment: fullCategory.categoryEquipmentEstimate,
                    other: fullCategory.categoryOtherEstimate,
                  },
                  workingDays,
                  holidays,
                  anchor:
                    categoryProgressToday[fullCategory.id] ??
                    EMPTY_PROGRESS_ANCHOR,
                  today,
                })
              : row.progress;
      // override.start/end are always the true, unshifted ISO dates
      // (see persistTaskDates/persistCategoryDates) — +1 day for the
      // bar's own rendering here too, same as `tasks` above, so an
      // optimistic override doesn't flash the bar back to its old
      // (unshifted-looking) width for the moment before router.refresh()
      // lands.
      return {
        ...row,
        name:
          row.type === "milestone"
            ? milestoneLabel(category?.name ?? task?.name ?? row.name, endDate)
            : row.name,
        start: startDate,
        end: row.type === "milestone" ? endDate : nextDay(endDate),
        progress,
      };
    });

    // Every phase with a task just moved, re-spanned from its tasks'
    // dates as they now stand — the same rollup `tasks` above makes
    // from the persisted ones (earliest start, latest true end, +1 day
    // for the bar), plus its duration-weighted progress rollup.
    const movedPhases = new Set<string>();
    rows.forEach((row, index) => {
      if (row !== tasks[index] && row.project) movedPhases.add(row.project);
    });
    if (movedPhases.size === 0) return rows;
    return rows.map((row) => {
      if (row.type !== "project" || !movedPhases.has(row.id)) return row;
      const children = rows.filter((child) => child.project === row.id);
      if (children.length === 0) return row;
      let weightedSum = 0;
      let totalDuration = 0;
      for (const child of children) {
        const duration = countWorkingDays(
          child.start,
          trueEndDate(child),
          workingDays,
          holidaySet
        );
        weightedSum += duration * child.progress;
        totalDuration += duration;
      }
      return {
        ...row,
        start: new Date(Math.min(...children.map((child) => child.start.getTime()))),
        end: nextDay(
          new Date(Math.max(...children.map((child) => trueEndDate(child).getTime())))
        ),
        progress: totalDuration > 0 ? weightedSum / totalDuration : 0,
      };
    });
  }, [
    tasks,
    pendingScheduleOverrides,
    pendingCategoryScheduleOverrides,
    categoryById,
    taskById,
    categoriesForDisplay,
    workingDays,
    holidays,
    holidaySet,
    taskProgressToday,
    categoryProgressToday,
  ]);

  const totalColumnsWidth = RESIZABLE_COLUMN_IDS.reduce(
    (sum, id) => sum + columnWidths[id],
    0
  );

  // The task-list panel's own *visible* width — separate from
  // totalColumnsWidth (each column's own natural, individually-resized
  // width, unchanged by this). null means "fully visible" (the common
  // case). When set, it's always <= totalColumnsWidth: dragging the
  // panel's own outer-edge handle (see handlePanelResizeMouseDown)
  // narrows this without touching any individual column's own width —
  // the columns keep rendering at their full natural size inside an
  // outer wrapper clipped to this width (overflow-hidden), so shrinking
  // it reads as covering the task list like a curtain/blanket and
  // revealing more of the chart underneath, not reshaping the columns
  // themselves. Confirmed directly this is what was wanted after a
  // first version that scaled every column's own width proportionally
  // instead — that wasn't it.
  const [panelWidthOverride, setPanelWidthOverride] = useState<number | null>(
    null
  );
  const visiblePanelWidth = Math.min(
    panelWidthOverride ?? totalColumnsWidth,
    totalColumnsWidth
  );

  // Earliest start / latest end across every rendered row (phase and
  // task), used only to estimate how many header columns the current
  // zoom level will draw — see estimateColumnCount above.
  const timelineExtent = useMemo(() => {
    if (effectiveTasks.length === 0) return null;
    let min = effectiveTasks[0].start.getTime();
    let max = effectiveTasks[0].end.getTime();
    for (const t of effectiveTasks) {
      if (t.start.getTime() < min) min = t.start.getTime();
      if (t.end.getTime() > max) max = t.end.getTime();
    }
    return { min: new Date(min), max: new Date(max) };
  }, [effectiveTasks]);

  // Measures the chart's own bordered wrapper so columnWidth can be
  // widened to fill it exactly when the project's date range is short
  // — without this, a short project renders its bars flush-left and
  // leaves the rest of the card as dead white space (confirmed directly
  // by inspecting a short-range render: the chart's own SVG came out
  // hundreds of pixels narrower than the wrapper around it).
  //
  // Deliberately a *separate* ref from chartWrapRef below, both
  // normally reporting the same width. Originally this split existed
  // to dodge a ResizeObserver feedback loop: chartWrapRef used to be a
  // fixed-height, internally vertically-scrolling box of its own, and
  // right at the edge where effectiveColumnWidth's own output caused
  // its content to just barely need (or stop needing) a vertical
  // scrollbar, that scrollbar's own width would shrink chartWrapRef's
  // *content-box* width — exactly what ResizeObserver reports —
  // closing a loop: containerWidth -> effectiveColumnWidth -> content
  // width -> scrollbar toggles -> containerWidth changes again,
  // indefinitely, tripping React's "Maximum update depth exceeded".
  // chartWrapRef no longer has any vertical scroll of its own at all
  // (see its own doc comment below — the chart now grows to fit its
  // real rows and scrolls as part of the page), so that *specific*
  // loop can't happen anymore. chartOuterRef now uses overflow-x-clip
  // (see its own doc comment below) rather than no overflow control at
  // all, which closed off a separate, confirmed real bug of its own — a
  // genuine second horizontal scrollbar reopening on the page's own
  // scroll container at Day zoom (scrollWidth 2121px vs. clientWidth
  // 1166px, confirmed directly) — but a user-reported "Maximum update
  // depth exceeded", also specifically at Day zoom, was never
  // reproduced on demand in isolation even with that bug present, so
  // whether it was the actual cause couldn't be confirmed either way.
  // The ResizeObserver below keeps a small dead-band regardless (this
  // paragraph's own width should already be stable now that content
  // is clipped rather than free to bleed outward, but a couple of
  // pixels of layout noise costing nothing to ignore).
  const chartOuterRef = useRef<HTMLDivElement>(null);
  // No longer a scrolling element at all — see its own doc comment
  // below (on the actual rendered div) for why. Still a separate ref
  // from chartOuterRef purely for the ResizeObserver reasoning above.
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = chartOuterRef.current;
    if (!el) return;
    let resizeTimer: ReturnType<typeof setTimeout> | undefined;
    let measured = false;
    let committedWidth = 0;
    const observer = new ResizeObserver((entries) => {
      const newWidth = entries[0].contentRect.width;
      // The hover sidebar animates its width for 300ms. Rendering the
      // entire SVG/task list for every intermediate width blocks that
      // animation. Measure immediately on mount, then commit only after
      // resizing settles (also handles window resize and hover reversal).
      clearTimeout(resizeTimer);
      if (measured && Math.abs(committedWidth - newWidth) < 2) return;
      const commitWidth = () => {
        committedWidth = newWidth;
        setContainerWidth((prev) => Math.abs(prev - newWidth) < 2 ? prev : newWidth);
      };
      if (!measured) {
        measured = true;
        commitWidth();
      } else {
        resizeTimer = setTimeout(commitWidth, 120);
      }
    });
    observer.observe(el);
    return () => {
      clearTimeout(resizeTimer);
      observer.disconnect();
    };
  }, []);

  const effectiveColumnWidth = useMemo(() => {
    const base = BASE_COLUMN_WIDTH[view];
    if (view === "day" || !timelineExtent || containerWidth === 0) return base;
    const chartAreaWidth =
      containerWidth - (showTaskList ? visiblePanelWidth : 0);
    if (chartAreaWidth <= 0) return base;
    const unitCount = estimateColumnCount(
      view,
      timelineExtent.min,
      timelineExtent.max
    );
    return Math.max(base, Math.floor(chartAreaWidth / unitCount));
  }, [view, containerWidth, timelineExtent, showTaskList, visiblePanelWidth]);

  // Mirrors gantt-task-react's own removeHiddenTasks: a collapsed
  // phase's own row still counts toward row height/index (it's still
  // drawn), but its children are skipped entirely — for computing the
  // chart's own date range (collapsing a phase can shrink the visible
  // date span).
  const visibleTasks = useMemo(
    () =>
      effectiveTasks.filter(
        (row) => row.type === "project" || !collapsedPhaseIds.has(row.project ?? "")
      ),
    [effectiveTasks, collapsedPhaseIds]
  );

  // Optimistic overrides for the task-list panel's own Priority/Task-name/
  // Phase-name cells — same usePendingOverrides mechanism
  // pendingScheduleOverrides above uses for the chart's bars, just three
  // more independent instances (each its own isolated Map, see the
  // hook's own doc comment) since these read directly in
  // CustomTaskListTable's row JSX further down, not through
  // `tasks`/`effectiveTasks`. Positioned here (after visibleTasks, not
  // up near pendingScheduleOverrides itself) for the same React
  // Compiler memoization reason handleBarClick below is — see its own
  // doc comment.
  //
  // Task name and phase (category) name are deliberately two *separate*
  // Maps, not one shared by id — a task id and a category id are
  // different id spaces (e.g. task 1 and category 1 can both exist at
  // once), so sharing one Map risked a phase-name override silently
  // showing up on an unrelated same-numbered task, or vice versa.
  const [pendingPriorityOverrides, setPriorityOverride, clearPriorityOverride] =
    usePendingOverrides<string>(categories, (rows, id, value) => rows.some(category => category.tasks.some(task => task.id === id && task.priority === value)));
  // Same "separate Map, different id space" reasoning as
  // pendingCategoryNameOverrides below — a category's own priority
  // override, one level up from pendingPriorityOverrides above.
  const [
    pendingCategoryPriorityOverrides,
    setCategoryPriorityOverride,
    clearCategoryPriorityOverride,
  ] = usePendingOverrides<string>(categories, (rows, id, value) => rows.some(category => category.id === id && category.priority === value));
  const [pendingNameOverrides, setNameOverride, clearNameOverride] =
    usePendingOverrides<string>(categories, (rows, id, value) => rows.some(category => category.tasks.some(task => task.id === id && task.name === value)));
  const [
    pendingCategoryNameOverrides,
    setCategoryNameOverride,
    clearCategoryNameOverride,
  ] = usePendingOverrides<string>(categories, (rows, id, value) => rows.some(category => category.id === id && category.name === value));

  const publishedCategories = useMemo(() => localCategoriesForDisplay.map(category => {
    const categorySchedule = pendingCategoryScheduleOverrides.get(category.id);
    return { ...category,
      name: pendingCategoryNameOverrides.get(category.id) ?? category.name,
      priority: (pendingCategoryPriorityOverrides.get(category.id) ?? category.priority) as TaskPriority,
      ...(categorySchedule ? { plannedStartDate: categorySchedule.start, plannedEndDate: categorySchedule.end } : {}),
      tasks: category.tasks.map(task => {
        const schedule = pendingScheduleOverrides.get(task.id);
        return { ...task, name: pendingNameOverrides.get(task.id) ?? task.name,
          priority: (pendingPriorityOverrides.get(task.id) ?? task.priority) as TaskPriority,
          ...(schedule ? { plannedStartDate: schedule.start, plannedEndDate: schedule.end } : {}),
        };
      }),
    };
  }), [localCategoriesForDisplay, pendingCategoryScheduleOverrides, pendingCategoryNameOverrides, pendingCategoryPriorityOverrides,
    pendingScheduleOverrides, pendingNameOverrides, pendingPriorityOverrides]);
  const publishGantt = estimateSync?.publishGantt;
  useLayoutEffect(() => { publishGantt?.(categories, publishedCategories); }, [publishGantt, categories, publishedCategories]);

  // Add Phase ("+" next to the Task column header, see handleAddPhase
  // below) — a pure double-submission guard now, no UI of its own
  // (there used to be a disabled+spinner treatment on the "+" button
  // itself here, removed once pendingNewPhase below started showing the
  // new row immediately, which made it redundant). Still needed
  // internally: without it, mashing "+" twice before the first
  // createCategory call resolves would create two phases from one
  // burst of clicks.
  //
  // Tracked the same "tied to the exact `categories` reference active
  // when it was set" way pendingScheduleOverrides is (see
  // usePendingOverrides' own doc comment) rather than a plain boolean —
  // this component doesn't unmount/reset its own state on a prop
  // change, router.refresh() just flows fresh `categories` down, so a
  // plain useState(false) flipped true here would have nothing to ever
  // flip it back on the success path. Comparing against the *current*
  // `categories` prop each render means it's automatically "false"
  // again the instant a fresh one lands, no useEffect required.
  const [addingPhaseAt, setAddingPhaseAt] = useState<CostCategory[] | null>(
    null
  );
  const isAddingPhase = addingPhaseAt === categories;

  // A click on a task's own bar opens Progress Tracking Override — the
  // flow this whole feature is centered on ("the user simply clicks the
  // Gantt Chart schedule bar"). Same for a task-less category's own bar
  // (see categoryById's own doc comment on why its row masquerades as
  // `type: "task"` for drag support) — its `row.id` is "phase-<id>", so
  // it fails the taskById lookup below and falls through to the
  // categoryById one instead. A phase row WITH tasks is excluded (its
  // own percent complete is only ever a rollup of its tasks, never
  // directly trackable — see percentCompleteByCategoryId's own doc
  // comment) — its bar's `type` stays "project", failing the very first
  // check below. Milestone bars are excluded too, per an explicit
  // request — a zero-duration marker has nothing to track progress
  // against. Filler rows are excluded too (never real tasks at all).
  //
  // Double-clicking a bar to open its Edit modal used to live here too
  // (debounced by hand against this single-click handler, since
  // gantt-task-react wires onClick/onDoubleClick straight to the DOM's
  // own click/dblclick with no debounce of its own) — removed per an
  // explicit request; Edit is still reachable from the row's own edit
  // button in the task list, just not from the chart bar itself anymore.
  // Deliberately positioned here, after visibleTasks rather than up near
  // categoryById/taskById (which it reads from) — the React Compiler
  // failed to preserve effectiveTasks' own memoization with this placed
  // any earlier, confirmed directly by bisecting hook position, the
  // exact same hazard usePendingOverrides' own doc comment describes for
  // the same reason.
  function handleBarClick(row: GanttTask) {
    // Suppress the click that follows a real bar drag (move/resize/
    // progress) — see barJustDraggedRef's own doc comment above for why
    // this has to exist at all.
    if (barJustDraggedRef.current) return;
    if (row.type !== "task") return;
    const task = taskById.get(row.id);
    // task.id > 0 excludes handleAddSubtask's own brief placeholder row
    // (negative id) — recording progress against a not-yet-real task
    // doesn't make sense.
    if (task && task.id > 0) {
      const override = pendingScheduleOverrides.get(task.id);
      setProgressModal({
        kind: "task",
        task: override
          ? {
              ...task,
              plannedStartDate: override.start,
              plannedEndDate: override.end,
              percentComplete: row.progress,
            }
          : task,
      });
      return;
    }
    const categoryEntry = categoryById.get(row.id);
    if (categoryEntry && categoryEntry.id > 0) {
      const category = categoriesForDisplay.find(
        (c) => c.id === categoryEntry.id
      );
      if (category) {
        const override = pendingCategoryScheduleOverrides.get(category.id);
        setProgressModal({
          kind: "category",
          category: override
            ? {
                ...category,
                plannedStartDate: override.start,
                plannedEndDate: override.end,
                percentComplete: row.progress,
              }
            : category,
        });
      }
    }
  }

  // Padding rows so a short project's chart still reads as "full"
  // instead of just a couple of real rows followed by nothing —
  // deliberately *real* gantt-task-react rows (not a CSS overlay
  // simulating them — tried first, abandoned: faking the library's own
  // zebra striping/gridlines/scrollbar position with background-image
  // layers fought the library instead of using it). Each one:
  //  - is `isDisabled` (gantt-task-react's own flag — confirmed directly
  //    in the compiled bundle this turns off drag/resize/progress-change
  //    for that row entirely, so it can never be dragged into persisting
  //    a bogus schedule), and
  //  - has `styles` with every color set to transparent, so its native
  //    bar never actually paints anything, while the row itself (and
  //    the chart's own real gridlines/zebra shading, drawn against the
  //    real total row count) still renders normally.
  // `type: "milestone"` rather than "task" — a milestone's own footprint
  // is a small fixed-size diamond, not a bar spanning a date range, so
  // there's less of it for a stray hover to land on even though it's
  // invisible either way. Its id is never a real category/task id (see
  // FILLER_ROW_ID_PREFIX's own doc comment), so every lookup keyed off
  // a real id (taskById, categoryById) already treats it as inert
  // without any separate "is this a filler row" branching — except the
  // two spots in CustomTaskListTable that render unconditionally
  // regardless of whether a real task was found (the Start/End date
  // inputs, the Duration cell), which do check for it directly.
  //
  // This only ever tops the row count *up* to MIN_CHART_FILL_HEIGHT_PX
  // worth of rows — a project with more real rows than that already
  // gets zero filler rows, growing past it exactly the way it always
  // has. Nothing here caps the chart's own real height anymore (that
  // was the actual bug — a *separate*, now-removed fixed-height box on
  // chartWrapRef, not this row-count padding itself).
  //
  // Deliberately positioned here, after handleBarClick rather than
  // right next to visibleTasks (which it reads from) — the React
  // Compiler failed to preserve effectiveTasks' own memoization with it
  // placed any earlier, confirmed directly by bisecting hook position
  // (the exact same hazard usePendingOverrides' own doc comment
  // describes for the same reason).
  const fillerTaskCount = Math.max(
    0,
    Math.ceil((MIN_CHART_FILL_HEIGHT_PX - HEADER_HEIGHT) / ROW_HEIGHT) -
      visibleTasks.length
  );
  // A fresh local date, deliberately *not* reusing fallbackStart (the
  // same "projectStartDate, else new Date()" fallback the tasks/
  // effectiveTasks memos above already use) — confirmed directly that
  // referencing that shared variable again here, even read-only, was
  // what broke the React Compiler's ability to preserve
  // effectiveTasks' own memoization a few lines up (bisected down to
  // this exact line): a second downstream consumer of a value an
  // earlier memo already depends on (with its own deliberate
  // exhaustive-deps omission) is apparently more than its static
  // analysis can reconcile, even though nothing here writes to it.
  // Must still fall within the project's real date span (not an
  // arbitrary fixed date) — gantt-task-react computes its own visible
  // date range from every task it's given, filler rows included, so a
  // wildly different date would stretch the chart's own axis out to
  // include it.
  const fillerDate = projectStartDate ? toDate(projectStartDate) : new Date();
  const fillerEndDate = effectiveTasks.length === 0 && projectEndDate
    ? new Date(Math.max(fillerDate.getTime(), toDate(projectEndDate).getTime()))
    : fillerDate;
  const fillerTasks: GanttTask[] = Array.from(
    { length: fillerTaskCount },
    (_, i) => ({
      id: `${FILLER_ROW_ID_PREFIX}${i}`,
      type: "milestone",
      name: "",
      start: fillerDate,
      end: fillerEndDate,
      progress: 0,
      isDisabled: true,
      styles: {
        backgroundColor: "transparent",
        backgroundSelectedColor: "transparent",
        progressColor: "transparent",
        progressSelectedColor: "transparent",
      },
    })
  );
  // What actually gets handed to <Gantt> — real rows first, so filler
  // rows always sort after every real one. Kept separate from
  // effectiveTasks/visibleTasks (used everywhere else) so none of that
  // ever has to know filler rows exist.
  const chartTasks = [...effectiveTasks.map(task => ({ ...task, isDisabled: !canEdit || task.isDisabled })), ...fillerTasks]
    .map((task, index) => {
      const category = categoryById.get(task.id);
      const name = category ? pendingCategoryNameOverrides.get(category.id) : pendingNameOverrides.get(Number(task.id));
      return { ...task, displayOrder: index + 1,
        ...(name !== undefined ? { name: task.type === "milestone" ? milestoneLabel(name, task.start) : name } : {}),
      };
    });

  // True for a brief moment right after a *real* bar drag (move/resize/
  // progress — actual mouse movement between mousedown and mouseup, not
  // just a mousedown/mouseup pair that never moved) — set in
  // handleChartMouseDown's own mouseup handler below. Exists purely so
  // handleBarClick can tell "the user just finished dragging this bar"
  // apart from "the user just clicked this bar": the browser fires a
  // real, ordinary "click" event immediately after any mousedown+mouseup
  // pair that lands on the same element, drag or not (confirmed
  // directly — dragging a bar to reschedule it was *also* opening the
  // Progress Tracking modal right after, since gantt-task-react wires
  // onClick straight to that same native click event with no drag
  // awareness of its own).
  const barJustDraggedRef = useRef(false);
  const [selectedBarIds, setSelectedBarIds] = useState<ReadonlySet<string>>(() => new Set());
  const [savingBarGroup, setSavingBarGroup] = useState(false);
  const [barGroupError, setBarGroupError] = useState<string | null>(null);
  const groupDragCleanup = useRef<(() => void) | null>(null);
  const [barMoveQueue] = useState(() => createScheduleMoveQueue(async changes => {
    const result = await moveSelectedSchedules(projectId, changes);
    if (!result.error) markHistoryEdit();
    return result;
  }, operation => operationQueue.run(operation)));
  useEffect(() => () => groupDragCleanup.current?.(), []);
  useEffect(() => {
    const root = chartWrapRef.current;
    if (!root) return;
    function markSelected() {
      root!.querySelectorAll<SVGGElement>("[data-gantt-row-id]").forEach(node => {
        const selected = selectedBarIds.has(node.dataset.ganttRowId ?? "");
        node.toggleAttribute("data-gantt-multi-selected", selected);
      });
    }
    markSelected();
    const observer = new MutationObserver(markSelected);
    observer.observe(root, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [selectedBarIds, calendarView]);
  useEffect(() => {
    function clear(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      groupDragCleanup.current?.();
      setSelectedBarIds(new Set());
    }
    window.addEventListener("keydown", clear);
    return () => window.removeEventListener("keydown", clear);
  }, []);

  function persistBarGroup(changes: ScheduleDateChange[]) {
    if (changes.length === 0) return Promise.resolve();
    setBarGroupError(null);
    const tasks = new Map<number, ScheduleOverride | null>();
    const categories = new Map<number, ScheduleOverride | null>();
    for (const change of changes) {
      (change.kind === "category" ? categories : tasks).set(change.id, change);
    }
    updateScheduleOverrides(tasks);
    updateCategoryScheduleOverrides(categories);
    return barMoveQueue.enqueue(changes, {
      onBusy: setSavingBarGroup,
      onRollback(positions, message) {
        groupDragCleanup.current?.();
        const tasks = new Map<number, ScheduleOverride | null>();
        const categories = new Map<number, ScheduleOverride | null>();
        for (const position of positions) {
          const dates = position.start !== null && position.end !== null ? { start: position.start, end: position.end } : null;
          (position.kind === "category" ? categories : tasks).set(position.id, dates);
        }
        updateScheduleOverrides(tasks);
        updateCategoryScheduleOverrides(categories);
        setBarGroupError(message);
      },
      onIdle: () => router.refresh(),
    });
  }

  function handleBarSelectionMouseDown(event: React.MouseEvent<HTMLDivElement>) {
    if (!canEdit || event.button !== 0 || !(event.target instanceof Element)) return;
    const bar = event.target.closest<SVGGElement>("[data-gantt-row-id]");
    if (!bar) {
      if (selectedBarIds.size > 0 && !event.shiftKey && event.target.closest("svg") && !event.target.closest("button")) setSelectedBarIds(new Set());
      return;
    }
    const id = bar.dataset.ganttRowId;
    const row = effectiveTasks.find(item => item.id === id);
    if (!id || !row || row.isDisabled || (!taskById.has(id) && !categoryById.has(id))) return;
    const wasSelected = selectedBarIds.has(id);
    if (!event.shiftKey && !wasSelected) { if (selectedBarIds.size > 0) setSelectedBarIds(new Set()); return; }
    event.preventDefault(); event.stopPropagation();
    const selected = new Set(selectedBarIds); selected.add(id);
    if (!wasSelected) setSelectedBarIds(selected);
    const previewIds = new Set(selected);
    for (const item of effectiveTasks) if (item.project && selected.has(item.project)) previewIds.add(item.id);
    const svg = bar.ownerSVGElement;
    if (!svg) return;
    const originX = event.clientX;
    const originLeft = svg.getBoundingClientRect().left;
    let currentLeft = originLeft;
    const scale = svg.getScreenCTM()?.a || 1;
    const projectFirst = projectStartDate ? toDate(projectStartDate) : null;
    const first = projectFirst && (!timelineExtent || projectFirst < timelineExtent.min) ? projectFirst : timelineExtent?.min ?? row.start;
    const previousDates = new Map<string, ScheduleOverride>();
    for (const [id, dates] of pendingScheduleOverrides) previousDates.set(String(id), dates);
    for (const [id, dates] of pendingCategoryScheduleOverrides) previousDates.set(phaseRowId(id), dates);
    const originals = new Map<SVGGElement, string | null>();
    let nodes: SVGGElement[] = [];
    let pixels = 0, pointerX = originX, moved = false, frame = 0;
    const shiftClick = event.shiftKey;
    function displacement(clientX: number) {
      return (clientX - originX + originLeft - currentLeft) / scale;
    }
    function cacheNodes() {
      nodes = Array.from(chartWrapRef.current?.querySelectorAll<SVGGElement>("[data-gantt-row-id]") ?? [])
        .filter(node => previewIds.has(node.dataset.ganttRowId ?? ""));
      for (const node of nodes) if (!originals.has(node)) originals.set(node, node.getAttribute("transform"));
      if (moved) {
        if (frame) window.cancelAnimationFrame(frame);
        paint();
      }
    }
    function paint() {
      frame = 0;
      for (const node of nodes) {
        node.setAttribute("transform", `${originals.get(node) ?? ""} translate(${pixels} 0)`);
      }
    }
    function updateScroll() {
      currentLeft = svg!.getBoundingClientRect().left;
      if (moved) {
        pixels = displacement(pointerX);
        if (!frame) frame = window.requestAnimationFrame(paint);
      }
    }
    cacheNodes();
    const observer = new MutationObserver(cacheNodes);
    if (chartWrapRef.current) observer.observe(chartWrapRef.current, { childList: true, subtree: true });
    function cleanup() {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("blur", cleanup);
      window.removeEventListener("scroll", updateScroll, true);
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
      originals.forEach((value, node) => { if (value === null) node.removeAttribute("transform"); else node.setAttribute("transform", value); });
      groupDragCleanup.current = null;
    }
    function move(e: MouseEvent) {
      pointerX = e.clientX;
      pixels = displacement(pointerX);
      if (Math.abs(pixels) > 3) moved = true;
      if (!moved) return;
      e.preventDefault();
      if (!frame) frame = window.requestAnimationFrame(paint);
    }
    function up(e: MouseEvent) {
      pixels = displacement(e.clientX);
      moved ||= Math.abs(pixels) > 3;
      const delta = barDragDays(pixels, effectiveColumnWidth, view, first);
      cleanup();
      if (!moved) {
        if (shiftClick && wasSelected) setSelectedBarIds(prev => { const next = new Set(prev); next.delete(id!); return next; });
        else if (!shiftClick && selected.size === 1) handleBarClick(row!);
        return;
      }
      barJustDraggedRef.current = true;
      window.setTimeout(() => { barJustDraggedRef.current = false; }, 0);
      try {
        const changes = selectedBarChanges(selected, effectiveTasks, categoriesForDisplay, delta, previousDates);
        flushSync(() => { void persistBarGroup(changes); });
      }
      catch (error) { setBarGroupError(error instanceof Error ? error.message : "Could not move the selected schedules."); }
    }
    groupDragCleanup.current?.();
    groupDragCleanup.current = cleanup;
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("blur", cleanup);
    window.addEventListener("scroll", updateScroll, true);
  }

  // Detects a native gantt-task-react drag starting (move, resize, or
  // progress), purely to set barJustDraggedRef above. Every such
  // interaction happens on the chart's own <svg> content, so "target is
  // inside an svg" was the original check here — but the task list's
  // own Edit/Add/Expand buttons render a lucide-react icon too, which is
  // *also* an <svg>, so those need excluding explicitly.
  // `svg.closest("button")` does that: none of gantt-task-react's own
  // bar/grid SVG content is ever inside an HTML <button>, only this
  // app's own icon buttons are.
  function handleChartMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.target instanceof Element)) return;
    const svg = e.target.closest("svg");
    if (!svg || svg.closest("button")) return;

    const startX = e.clientX;
    const startY = e.clientY;

    function onUp(ev: MouseEvent) {
      window.removeEventListener("mouseup", onUp);

      // Real mouse movement between this mousedown and its own mouseup
      // — i.e. an actual move/resize/progress drag, not a plain click
      // that just happened to start on the same SVG content — see
      // barJustDraggedRef's own doc comment above for what this guards.
      // A few pixels of slop (not === 0) since a real physical click
      // still jitters a pixel or two between press and release.
      const moved =
        Math.abs(ev.clientX - startX) > 3 || Math.abs(ev.clientY - startY) > 3;
      if (moved) {
        barJustDraggedRef.current = true;
        // Cleared on the next tick, not synchronously here — the
        // browser's own native "click" event for this same mousedown/
        // mouseup pair fires immediately after this handler returns,
        // still within the same synchronous dispatch, and has to still
        // see this as true when it does. A setTimeout(0) callback only
        // runs once that's already happened, so this is safe to clear
        // that "late" without a race against the click it's meant to
        // suppress.
        window.setTimeout(() => {
          barJustDraggedRef.current = false;
        }, 0);
      }
    }
    window.addEventListener("mouseup", onUp);
  }

  // Hand-built drag-to-resize for one column header — see the
  // RESIZABLE_COLUMN_IDS comment above. Global mousemove/mouseup
  // listeners so the drag keeps tracking even if the cursor leaves the
  // thin handle, cleaned up on mouseup.
  function handleResizeMouseDown(id: ResizableColumnId) {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const startWidth = columnWidths[id];

      function onMove(ev: MouseEvent) {
        const delta = ev.clientX - startX;
        const newWidth = Math.max(MIN_COLUMN_WIDTH[id], startWidth + delta);
        setColumnWidths((prev) => ({ ...prev, [id]: newWidth }));
      }
      function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      }
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
  }

  // Hand-built drag-to-resize for the whole task-list panel's own outer
  // right edge — separate from handleResizeMouseDown above (that one
  // resizes a single column's own real width). Dragging this only ever
  // changes visiblePanelWidth — every column keeps its own real,
  // individually-set width the whole time, so narrowing this handle
  // reads as covering the task list like a curtain sliding over it
  // (the outer overflow-hidden wrapper clips whatever no longer fits)
  // rather than reshaping the columns to fit a narrower panel — a first
  // version scaled every column's own width proportionally instead,
  // confirmed directly that wasn't what was wanted. Same global
  // mousemove/mouseup pattern as every other drag in this file.
  function handlePanelResizeMouseDown(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startWidth = visiblePanelWidth;

    function onMove(ev: MouseEvent) {
      const delta = ev.clientX - startX;
      const next = Math.min(
        totalColumnsWidth,
        Math.max(MIN_PANEL_WIDTH, startWidth + delta)
      );
      setPanelWidthOverride(next);
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Shared by both the drag-to-move/resize handler below and the
  // inline Start/End date inputs in the task list — same server action,
  // same error surfacing, same post-success refresh.
  async function persistTaskDates(
    taskId: number,
    startIso: string,
    endIso: string
  ): Promise<boolean> {
    setScheduleError(null);
    // Never let end fall before start — snap it to match start instead
    // of erroring, per an explicit request. Clamped here too (not just
    // in updateTaskSchedule, the actual source of truth) so the
    // optimistic override two lines down already reflects the final,
    // corrected value — without this, a drag or typed edit that crossed
    // the two would flash the *wrong* (uncorrected) end date until
    // router.refresh() below pulled the real one back down.
    if (endIso < startIso) endIso = startIso;
    // Set *before* the await — see usePendingOverrides' own doc
    // comment above for why: this needs to land before gantt-task-react
    // resets its own drag visual state on this same mouseup, not after.
    setScheduleOverride(taskId, { start: startIso, end: endIso });
    const result = await queueEdit(() => updateTaskSchedule(taskId, projectId, startIso, endIso));
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually saved — drop the optimistic override so
      // the bar falls back to its last-confirmed (server) position
      // instead of getting stuck showing a change that never persisted.
      clearScheduleOverride(taskId);
      return false;
    }
    router.refresh(); // pulls the recomputed phase-row rollup back down
    return true;
  }

  async function persistDrag(task: GanttTask): Promise<boolean> {
    if (task.type === "project") return false; // cheap insurance — see doc comment; a category WITH tasks stays type: "project" and never reaches here
    // A task-less category's own bar — dragged the same way a real
    // task's is (see this component's own doc comment above), but
    // persisted through the category-specific action, one level up
    // from persistTaskDates below.
    const category = categoryById.get(task.id);
    if (category) {
      return persistCategoryDates(
        category.id,
        toIsoDate(task.start),
        toIsoDate(trueEndDate(task))
      );
    }
    if (!taskById.has(task.id)) return false; // defensive — every real dragged row should already be in taskById or categoryById
    // A milestone only moves (no resize handles on a zero-duration
    // diamond), so task.start/task.end are still equal after a drag —
    // both get persisted as the same planned_start_date/planned_end_date.
    // trueEndDate is a no-op for a milestone (its own end was never
    // shifted to begin with), so this is safe for both row kinds.
    return persistTaskDates(
      Number(task.id),
      toIsoDate(task.start),
      toIsoDate(trueEndDate(task))
    );
  }

  // Same idea as persistTaskDates above, one level up — a category's
  // own Start/End cells (only reachable while it has no tasks yet, see
  // categoryDatesLocked in the row-rendering loop below), and its own
  // bar (now draggable — see persistDrag above and this component's own
  // doc comment). Sets the SAME kind of optimistic override a task's
  // schedule already gets, and for the same reason: without it, an
  // empty category's edit (typed or dragged) sat visually stale until
  // router.refresh() landed — confirmed directly as a real, noticeable
  // lag once this row became just as interactive as a task's.
  async function persistCategoryDates(
    categoryId: number,
    startIso: string,
    endIso: string
  ): Promise<boolean> {
    setScheduleError(null);
    if (endIso < startIso) endIso = startIso;
    // Set *before* the await — see persistTaskDates' own matching
    // comment above for why.
    setCategoryScheduleOverride(categoryId, { start: startIso, end: endIso });
    const result = await queueEdit(() => updateCategorySchedule(
      categoryId,
      projectId,
      startIso,
      endIso
    ));
    if (result.error) {
      // TEMPORARY — scheduleError's own read side was removed earlier
      // (see its own doc comment), so a failed save is otherwise 100%
      // silent: just an optimistic flash that quietly reverts once the
      // round trip lands, with no indication why. Logging here to
      // actually see the real error message while tracking down why
      // category schedule saves keep failing.
      console.error("[persistCategoryDates] updateCategorySchedule failed:", result.error);
      setScheduleError(result.error);
      // Nothing was actually saved — drop the optimistic override, same
      // reasoning as persistTaskDates' own rollback above.
      clearCategoryScheduleOverride(categoryId);
      return false;
    }
    router.refresh();
    return true;
  }

  // Typing a new Start or End date directly in the task list is an
  // alternative to dragging the bar. A milestone has no duration — its
  // start and end are always kept equal — so editing either field moves
  // the whole diamond rather than stretching a (non-existent) duration.
  //
  // Deliberately no longer bounded by the project's own Start Date ->
  // Target End Date window — that check existed on the (reasonable-
  // sounding, but backwards) assumption that a task's own dates should
  // fall inside some already-fixed parent range. They don't: a phase's
  // own start/end is purely a rollup of its tasks' dates (see
  // percentCompleteByCategoryId's own doc comment for the same
  // "computed from children, not the other way around" shape), and nor
  // is the project's own date range this task's parent — a task can
  // legitimately need to run earlier or later than what the project's
  // own Start/Target End currently say, and that's the admin's own call
  // to make, not something this cell should silently block. Confirmed
  // directly this was rejecting valid edits it shouldn't have.
  //
  // Still bounded by MIN_PLANNED_YEAR/MAX_PLANNED_YEAR above, though —
  // an "unbounded" field is only meant to free it from the project's
  // own range, not to accept an obviously-mistyped year. Rejected (not
  // clamped, unlike the start/end-crossing case in persistTaskDates —
  // there's no sensible "nearest valid value" for a typo like 2222) and
  // snapped back to the field's own last known-good value, since the
  // input is uncontrolled (see its own key comment below) and wouldn't
  // otherwise visually undo a rejected value on its own.
  function handleTaskDateEdit(
    row: GanttTask,
    field: "start" | "end",
    value: string,
    inputEl: HTMLInputElement
  ) {
    if (!value) return;

    const year = Number(value.slice(0, 4));
    if (
      !Number.isFinite(year) ||
      year < MIN_PLANNED_YEAR ||
      year > MAX_PLANNED_YEAR
    ) {
      inputEl.value = toIsoDate(field === "start" ? row.start : trueEndDate(row));
      setScheduleError(
        `Invalid date range — planned dates must fall between ${MIN_PLANNED_YEAR} and ${MAX_PLANNED_YEAR}.`
      );
      return;
    }

    setScheduleError(null);
    const isMilestone = row.type === "milestone";
    const startIso =
      field === "start" ? value : isMilestone ? value : toIsoDate(row.start);
    const endIso =
      field === "end" ? value : isMilestone ? value : toIsoDate(trueEndDate(row));
    persistTaskDates(Number(row.id), startIso, endIso);
  }

  // Same idea as handleTaskDateEdit above — only ever wired up to an
  // empty category's own Start/End cells (see categoryDatesLocked in
  // the row-rendering loop below). One marked as a milestone moves its
  // start and end together, the same as a milestone task.
  function handleCategoryDateEdit(
    categoryId: number,
    row: GanttTask,
    field: "start" | "end",
    value: string,
    inputEl: HTMLInputElement
  ) {
    if (!value) return;

    const year = Number(value.slice(0, 4));
    if (
      !Number.isFinite(year) ||
      year < MIN_PLANNED_YEAR ||
      year > MAX_PLANNED_YEAR
    ) {
      inputEl.value = toIsoDate(field === "start" ? row.start : trueEndDate(row));
      setScheduleError(
        `Invalid date range — planned dates must fall between ${MIN_PLANNED_YEAR} and ${MAX_PLANNED_YEAR}.`
      );
      return;
    }

    setScheduleError(null);
    const isMilestone = row.type === "milestone";
    const startIso =
      field === "start" ? value : isMilestone ? value : toIsoDate(row.start);
    const endIso =
      field === "end" ? value : isMilestone ? value : toIsoDate(trueEndDate(row));
    persistCategoryDates(categoryId, startIso, endIso);
  }

  // Same direct-call pattern as persistTaskDates above — the Priority
  // cell is a plain <select>, not a form, so there's no useActionState
  // to hang this off of. The <select> itself shows the newly-picked
  // option immediately for free (that's just the browser reflecting the
  // user's own click, nothing to do with this component's state) — but
  // this row's own color coding (High = red, Low = muted, see the
  // <select>'s className below) reads from `task.priority`, which only
  // flows from a fresh `categories` prop, i.e. only after
  // router.refresh() lands. Confirmed directly: without the override
  // below, the dropdown already says "High" while the text stays its
  // old color for the full round trip. Same optimistic-override pattern
  // as persistTaskDates — see usePendingOverrides' own doc comment.
  async function handleTaskPriorityEdit(taskId: number, priority: string) {
    setScheduleError(null);
    setPriorityOverride(taskId, priority);
    const result = await queueEdit(() => updateTaskPriority(taskId, projectId, priority));
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually saved — drop the optimistic override so
      // the color falls back to the last-confirmed (server) priority
      // instead of getting stuck showing a change that never persisted.
      clearPriorityOverride(taskId);
      return;
    }
    router.refresh();
  }

  // Same idea as handleTaskPriorityEdit above, one level up.
  async function handleCategoryPriorityEdit(
    categoryId: number,
    priority: string
  ) {
    setScheduleError(null);
    setCategoryPriorityOverride(categoryId, priority);
    const result = await queueEdit(() => updateCategoryPriority(categoryId, projectId, priority));
    if (result.error) {
      setScheduleError(result.error);
      clearCategoryPriorityOverride(categoryId);
      return;
    }
    router.refresh();
  }

  // The header's own "+" (Add task, next to the Task column label) —
  // creates a phase directly, no modal, per an explicit request that
  // adding one shouldn't need a form popup at all. "New Task" is a
  // placeholder, not a real name anyone's expected to keep: the newly
  // created row drops straight into its own inline rename input (see
  // editingCategoryId above) the instant this succeeds, so the very
  // next thing that happens is the admin typing over it.
  async function handleAddPhase() {
    if (!canEdit) return;
    if (isAddingPhase) return;
    setScheduleError(null);
    setAddingPhaseAt(categories);

    // Negative — guaranteed to never collide with a real DB id (a
    // Postgres identity column never produces one) — so this row can be
    // told apart from a genuine, persisted phase at a glance (see the
    // `category.id > 0` check on its own name button further down,
    // which uses exactly that to keep it non-renameable until it's
    // swapped for a real id below).
    const tempId = -Date.now();
    const categoriesAtSet = categories;
    const dates = projectScheduleDates(projectStartDate, projectEndDate);
    setEditingCategoryId(tempId);
    setPendingNewPhase({
      categoriesAtSet,
      category: {
        id: tempId,
        name: "New Task",
        weight: 0,
        tasks: [],
        materialDirectQuantity: 0,
        materialDirectUnit: null,
        materialUnitCost: 0,
        materialDirectAmountOverride: null,
        categoryMaterialEstimate: 0,
        materialAssignments: [],
        plannedStartDate: dates.start,
        plannedEndDate: dates.end,
        priority: "medium",
        isMilestone: false,
        categoryLaborEstimate: 0,
        categoryEquipmentEstimate: 0,
        categoryOtherEstimate: 0,
        estimatedQuantity: 0,
        unit: null,
        percentComplete: 0,
        costsToDate: { ...ZERO_COSTS },
      },
    });

    const formData = new FormData();
    formData.set("categoryName", "New Task");
    const creation = queueEdit(() => createCategory(projectId, {}, formData))
      .catch(() => ({ error: "Could not create the task. Please retry.", categoryId: undefined }));
    pendingNameCreations.current.set(`category:${tempId}`, creation.then(result => result.categoryId));
    const result = await creation;
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually created — drop both markers so the button
      // re-enables and the placeholder row disappears immediately,
      // instead of staying stuck (neither `categories` nor
      // `categoriesAtSet` change on a failed create, so both would
      // otherwise keep reading as still in-flight forever).
      setAddingPhaseAt(null);
      setPendingNewPhase(null);
      setEditingCategoryId(current => current === tempId ? null : current);
      return;
    }
    if (result.categoryId !== undefined) {
      // Swap the placeholder over to its real id the moment it's known
      // — well before router.refresh() below actually lands — so the
      // rename input opened next targets a real, persistable row
      // instead of the temporary placeholder one (renaming *that*
      // would silently do nothing: updateCategory's own `.eq("id", ...)`
      // would just match zero rows).
      setPendingNewPhase({
        categoriesAtSet,
        category: {
          id: result.categoryId,
          name: "New Task",
          weight: 0,
          tasks: [],
          materialDirectQuantity: 0,
          materialDirectUnit: null,
          materialUnitCost: 0,
          materialDirectAmountOverride: null,
          categoryMaterialEstimate: 0,
          materialAssignments: [],
          plannedStartDate: dates.start,
          plannedEndDate: dates.end,
          priority: "medium",
          isMilestone: false,
          categoryLaborEstimate: 0,
          categoryEquipmentEstimate: 0,
          categoryOtherEstimate: 0,
          estimatedQuantity: 0,
          unit: null,
          percentComplete: 0,
          costsToDate: { ...ZERO_COSTS },
        },
      });
      const draft = inlineNameDrafts.current.get(`category:${tempId}`);
      if (draft) {
        inlineNameDrafts.current.set(`category:${result.categoryId}`, draft);
        inlineNameDrafts.current.delete(`category:${tempId}`);
        setCategoryNameOverride(result.categoryId, draft.value);
      }
      setEditingCategoryId(current => current === tempId ? result.categoryId! : current);
    }
    router.refresh();
    // Not cleared here on success — see addingPhaseAt's/pendingNewPhase's
    // own doc comments above: both read false/null again on their own
    // the instant the fresh `categories` this refresh fetches (now
    // containing the real phase) actually lands as a new prop.
  }

  // Same "instant optimistic row, no modal" treatment as handleAddPhase
  // above, one level down — a phase row's own "+" (Add task to this
  // phase). No taskModal/SubtaskForm involved at all here per an
  // explicit request; that modal still opens from the row's own pencil
  // icon afterward for everything this inline flow doesn't cover
  // (dates, priority, milestone, materials/labor).
  async function handleAddSubtask(categoryId: number) {
    if (!canEdit) return;
    if (activeNewTask) return;
    setScheduleError(null);
    setCollapsedPhaseIds(previous => {
      const next = new Set(previous);
      next.delete(phaseRowId(categoryId));
      return next;
    });

    // Same negative-id placeholder convention as handleAddPhase's own
    // tempId above — see its own comment for why.
    const tempId = -Date.now();
    const categoriesAtSet = categories;
    const dates = projectScheduleDates(projectStartDate, projectEndDate);
    const placeholderTask: CostTask = {
      id: tempId,
      categoryId,
      name: "New Task",
      estimatedQuantity: 0,
      unit: null,
      laborEstimate: 0,
      materialEstimate: 0,
      materialDirectQuantity: 0,
      materialDirectUnit: null,
      materialUnitCost: 0,
      materialDirectAmountOverride: null,
      equipmentEstimate: 0,
      otherCostEstimate: 0,
      otherCostItems: [],
      totalEstimateCost: 0,
      weight: 0,
      plannedStartDate: dates.start,
      plannedEndDate: dates.end,
      predecessorTaskId: null,
      isMilestone: false,
      priority: "medium",
      percentComplete: 0,
      costsToDate: { ...ZERO_COSTS },
      materialAssignments: [],
    };
    setPendingNewTask({ categoriesAtSet, categoryId, task: placeholderTask });
    setEditingTaskId(tempId);

    const formData = new FormData();
    formData.set("taskName", "New Task");
    formData.set("categoryId", String(categoryId));
    const creation = queueEdit(() => createTask(projectId, {}, formData))
      .catch(() => ({ error: "Could not create the task. Please retry.", taskId: undefined }));
    pendingNameCreations.current.set(`task:${tempId}`, creation.then(result => result.taskId));
    const result = await creation;
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually created — drop the placeholder so it
      // disappears immediately instead of staying stuck (`categories`
      // never changes on a failed create, so it'd otherwise keep
      // reading as still in-flight forever).
      setPendingNewTask(null);
      setEditingTaskId(current => current === tempId ? null : current);
      return;
    }
    if (result.taskId !== undefined) {
      // Swap the placeholder over to its real id the moment it's known
      // — well before router.refresh() below actually lands — same
      // reasoning as handleAddPhase's own swap above: renaming the
      // temporary id would silently do nothing once a real row exists
      // to persist against instead.
      setPendingNewTask({
        categoriesAtSet,
        categoryId,
        task: { ...placeholderTask, id: result.taskId },
      });
      const draft = inlineNameDrafts.current.get(`task:${tempId}`);
      if (draft) {
        inlineNameDrafts.current.set(`task:${result.taskId}`, draft);
        inlineNameDrafts.current.delete(`task:${tempId}`);
        setNameOverride(result.taskId, draft.value);
      }
      setEditingTaskId(current => current === tempId ? result.taskId! : current);
    }
    router.refresh();
    // Not cleared here on success — see pendingNewTask's own doc
    // comment above: it reads null again on its own the instant the
    // fresh `categories` this refresh fetches (now containing the real
    // subtask) actually lands as a new prop.
  }

  // Saves the inline rename input's own value on blur (or Enter, which
  // just blurs — see the input itself below) — same "commit on blur,
  // skip an unchanged/empty save" shape handleTaskPercentCompleteEdit
  // used to use for the now-removed Percent Complete cell. Leaving it
  // blank keeps whatever name was already saved (e.g. still "New Task"
  // if nobody typed anything) rather than erroring or saving an empty
  // name. Optimistic name override same as handleTaskRename below (see
  // usePendingOverrides' own doc comment) — editingCategoryId clears
  // the instant this runs, so without it the button below would flash
  // back to the *old* name for the whole router.refresh() round trip.
  async function handleCategoryRename(categoryId: number, value: string, previousValue: string) {
    setEditingCategoryId(null);
    inlineNameDrafts.current.delete(`category:${categoryId}`);
    const trimmed = value.trim();
    if (!trimmed || trimmed === previousValue) return;
    setScheduleError(null);
    setCategoryNameOverride(categoryId, trimmed);
    // Reserve this gesture's queue position before waiting for a temporary ID.
    const result = await queueEdit(async () => {
      if (categoryId < 0) {
        const createdId = await pendingNameCreations.current.get(`category:${categoryId}`);
        pendingNameCreations.current.delete(`category:${categoryId}`);
        if (!createdId) return { error: "The new task could not be saved. Please retry." };
        categoryId = createdId;
        setCategoryNameOverride(categoryId, trimmed);
      }
      const formData = new FormData();formData.set("categoryName", trimmed);return updateCategory(categoryId, projectId, {}, formData);
    });
    if (result.error) {
      setScheduleError(result.error);
      clearCategoryNameOverride(categoryId, trimmed);
      return;
    }
    router.refresh();
  }

  // Same shape as handleCategoryRename above, just against renameTask
  // (see that action's own doc comment for why this isn't built on
  // updateSubtask instead) — plus an optimistic name override (same
  // pattern as persistTaskDates/handleTaskPriorityEdit, see
  // usePendingOverrides' own doc comment): editingTaskId clears the
  // instant this runs, so without it the button below would flash back
  // to the *old* name (still `task.name` from the stale `categories`
  // prop) for the whole round trip before jumping to the new one.
  async function handleTaskRename(taskId: number, value: string, previousValue: string) {
    setEditingTaskId(null);
    inlineNameDrafts.current.delete(`task:${taskId}`);
    const trimmed = value.trim();
    if (!trimmed || trimmed === previousValue) return;
    setScheduleError(null);
    setNameOverride(taskId, trimmed);
    // Reserve this gesture's queue position before waiting for a temporary ID.
    const result = await queueEdit(async () => {
      if (taskId < 0) {
        const createdId = await pendingNameCreations.current.get(`task:${taskId}`);
        pendingNameCreations.current.delete(`task:${taskId}`);
        if (!createdId) return { error: "The new task could not be saved. Please retry." };
        taskId = createdId;
        setNameOverride(taskId, trimmed);
      }
      return renameTask(taskId, projectId, trimmed);
    });
    if (result.error) {
      setScheduleError(result.error);
      clearNameOverride(taskId, trimmed);
      return;
    }
    router.refresh();
  }

  function handleModalSave(kind: ScheduleModalEdit["kind"], id: number, name: string, form: FormData) {
    if (!canEdit) return;
    const token = ++modalEditSequence.current;
    const edit = scheduleModalEdit(kind, id, form);
    setModalSaveError(null);
    setModalEdits(current => [...current, { token, edit, pending: true }]);
    if (kind === "category") setCategoryModal(null);
    else setTaskModal(null);

    // Preserve click order even when another modal is saved before the first
    // request finishes. Only the existing authorized server actions persist it.
    void operationQueue.run(async () => {
      try {
        const result = kind === "category"
          ? await updateCategory(id, projectId, {}, form)
          : await updateSubtask(id, projectId, {}, form);
        if (!result.success || result.error) throw new Error(result.error || "Please try again.");
        markHistoryEdit();
        setModalEdits(current => current.map(entry => entry.token === token ? { ...entry, pending: false } : entry));
      } catch (error) {
        setModalEdits(current => current.filter(entry => entry.token !== token));
        setModalSaveError(`Could not save changes to ${name}. ${error instanceof Error ? error.message : "Please try again."}`);
      } finally {
        // Some existing server actions can partially change a relationship
        // before failing. Reconcile with actual server data on either outcome.
        router.refresh();
      }
    });
  }

  // A resizable column header cell + its drag handle at the right edge.
  function HeaderCell({ id }: { id: ResizableColumnId }) {
    return (
      <div
        className={`relative flex h-full shrink-0 items-center px-2 text-xs font-medium text-zinc-700 ${
          RIGHT_ALIGNED_COLUMNS.has(id) ? "justify-end" : "justify-start"
        }`}
        style={{ width: columnWidths[id] }}
      >
        {COLUMN_LABEL[id]}
        {/* Stays fully inside this column's own box (no negative-offset
            overflow into the next column's) — an overflowing handle
            gets covered by the next column's div, since later flex
            siblings paint over an earlier sibling's overflow in normal
            stacking order. Confirmed directly: the handle was
            unclickable at exactly the boundary until this was fixed. */}
        <div
          onMouseDown={handleResizeMouseDown(id)}
          className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
        >
          <div className="ml-auto h-full w-px bg-zinc-200" />
        </div>
      </div>
    );
  }

  function CustomTaskListHeader() {
    return (
      // Outer wrapper is the *visible* (possibly curtain-narrowed)
      // width, overflow-hidden — see visiblePanelWidth's own doc
      // comment above. The inner div underneath keeps every column at
      // its own real, individually-resized width regardless; narrowing
      // the outer one just clips it, it never reshapes the columns.
      <div
        style={{ height: HEADER_HEIGHT, width: visiblePanelWidth }}
        className="overflow-hidden border-r border-b border-zinc-200 bg-zinc-50"
      >
        <div
          style={{ width: totalColumnsWidth }}
          className="flex h-full items-center"
        >
          {RESIZABLE_COLUMN_IDS.map((id) =>
            id === "text" ? (
              <div
                key={id}
                className="relative flex h-full shrink-0 items-center justify-between gap-1 px-2 text-xs font-medium text-zinc-700"
                style={{ width: columnWidths[id] }}
              >
                <span>{COLUMN_LABEL[id]}</span>
                <ProjectWriteButton
                  type="button"
                  onClick={handleAddPhase}
                  aria-label="Add task"
                  title="Add task"
                  className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                >
                  <Plus className="size-3.5" />
                </ProjectWriteButton>
                <div
                  onMouseDown={handleResizeMouseDown(id)}
                  className="absolute top-0 right-0 z-10 h-full w-2 cursor-col-resize"
                >
                  <div className="ml-auto h-full w-px bg-zinc-200" />
                </div>
              </div>
            ) : (
              <HeaderCell key={id} id={id} />
            )
          )}
        </div>
      </div>
    );
  }

  function CustomTaskListTable({
    tasks: rows,
    onExpanderClick,
  }: {
    rowHeight: number;
    tasks: GanttTask[];
    selectedTaskId: string;
    setSelectedTask: (taskId: string) => void;
    onExpanderClick: (task: GanttTask) => void;
  }) {
    return (
      // Same outer-clip / inner-natural-width split as
      // CustomTaskListHeader above — see visiblePanelWidth's own doc
      // comment.
      <div
        style={{ width: visiblePanelWidth }}
        className="overflow-hidden border-r border-zinc-200"
        // gantt-task-react's own outermost wrapper (an ancestor of
        // everything TaskListTable renders, confirmed directly by
        // reading the compiled bundle) has its own onKeyDown that
        // calls event.preventDefault() unconditionally, for every key,
        // to drive its own arrow-key grid-scrolling — including a
        // plain digit typed into one of this table's own inputs, since
        // React's synthetic events still bubble up to it regardless of
        // real DOM nesting. That blocks the browser's own default
        // "insert this character" action, so typing into a focused
        // input here silently does nothing. Confirmed directly this
        // isn't new to the Percent Complete input either — the
        // existing Start/End date inputs have the exact same problem,
        // just never noticed before now since picking a date via the
        // native calendar popup (a separate, page-JS-independent UI
        // layer) was always how those got used in practice, not typing
        // digits into their segments directly.
        // stopPropagation here, once, on every keydown from anywhere
        // in this table, is the actual fix — it never reaches gantt-
        // task-react's own listener at all, for this input or any
        // future one added here, rather than requiring every
        // individual input to remember its own workaround.
        onKeyDown={(e) => e.stopPropagation()}
      >
      <div style={{ width: totalColumnsWidth }}>
        {rows.map((row) => {
          // Id-based, not row.type === "project" — a task-less category
          // is deliberately type: "task" now (see this component's own
          // doc comment above), so every category-only behavior below
          // still has to key off "is this id a category" rather than
          // the gantt-task-react type that only controls bar draggability.
          const isProject = categoryById.has(row.id);
          const isFiller = row.id.startsWith(FILLER_ROW_ID_PREFIX);
          const category = isProject ? categoryById.get(row.id) : undefined;
          const task = !isProject ? taskById.get(row.id) : undefined;
          const days = workingDaysBetween(row.start, trueEndDate(row));
          // A phase's Start/End only lock to a read-only rollup once it
          // actually has tasks to roll up — an empty one has nothing to
          // compute from, so it's directly editable instead, same as a
          // real task's own cells (see categoryById's own hasTasks and
          // the `tasks` useMemo above). Defaults to locked if the lookup
          // somehow misses, matching the original always-locked behavior.
          const categoryDatesLocked = isProject && (category?.hasTasks ?? true);
          // A phase with tasks nesting under it. A task-less one reads as
          // a plain task row — ticked, not expanded.
          const isGroup = isProject && (category?.hasTasks ?? true);
          // A milestone task, or a task-less category marked as one.
          const isMilestoneRow = !isFiller && row.type === "milestone";
          const rowKind = isProject ? "category" : "task";
          const savedRowId = category?.id ?? task?.id ?? 0;
          const parentId = task?.categoryId ?? null;
          const canReorder = canEdit && !isFiller && savedRowId > 0 && !deleting && !isUndoRedoPending;
          function allowedDrop() {
            const source = draggedRow.current;
            return canReorder && source && source.kind === rowKind && source.id !== savedRowId &&
              (rowKind === "category" || source.categoryId === parentId) ? source : null;
          }

          return (
            <div
              key={row.id}
              data-gantt-order-row={row.id}
              onDragOver={(event) => {
                if (!allowedDrop()) return;
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const element = event.currentTarget;
                const bounds = element.getBoundingClientRect();
                if (dropMarker.current && dropMarker.current !== element) delete dropMarker.current.dataset.ganttDrop;
                element.dataset.ganttDrop = event.clientY >= bounds.top + bounds.height / 2 ? "after" : "before";
                dropMarker.current = element;
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                  delete event.currentTarget.dataset.ganttDrop;
                }
              }}
              onDrop={(event) => {
                const source = allowedDrop();
                if (!source) { clearRowDrag(); return; }
                event.preventDefault();
                const bounds = event.currentTarget.getBoundingClientRect();
                const after = event.clientY >= bounds.top + bounds.height / 2;
                clearRowDrag();
                handleRowMove({ kind: source.kind, id: source.id, targetId: savedRowId, after });
              }}
              style={{ height: ROW_HEIGHT }}
              // Phase rows get a faint darker fill so the hierarchy reads
              // at a glance, not just from the bold name/chevron — task
              // rows stay plain (no class) rather than an explicit white,
              // so they still show through whatever the panel's own
              // background is. A phase row's own divider is a shade darker
              // than its fill — border-zinc-100 on a bg-zinc-100 row
              // vanished, so back-to-back phases read as one gray block.
              className={`flex items-center border-b text-xs text-zinc-600 ${
                isGroup ? "border-zinc-200 bg-zinc-100" : "border-zinc-100"
              }`}
            >
              <div
                className="flex h-full shrink-0 items-center gap-1 border-r border-zinc-200 px-2 text-zinc-900"
                style={{ width: columnWidths.text }}
              >
                {canReorder && (
                  <button
                    type="button"
                    draggable
                    aria-label={`Reorder ${category?.name ?? task?.name ?? row.name}`}
                    title="Drag to reorder. Use Alt + Up or Down to move with the keyboard."
                    onDragStart={(event) => {
                      event.stopPropagation();
                      draggedRow.current = { kind: rowKind, id: savedRowId, categoryId: parentId };
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", row.id);
                      event.dataTransfer.setDragImage(event.currentTarget.closest("[data-gantt-order-row]")!, 16, ROW_HEIGHT / 2);
                    }}
                    onDragEnd={clearRowDrag}
                    onKeyDown={(event) => {
                      if (!event.altKey || !["ArrowUp", "ArrowDown"].includes(event.key)) return;
                      event.preventDefault();
                      const siblings = rowKind === "category" ? categoriesForDisplay
                        : categoriesForDisplay.find(item => item.id === parentId)?.tasks ?? [];
                      const index = siblings.findIndex(item => item.id === savedRowId);
                      const target = siblings[index + (event.key === "ArrowUp" ? -1 : 1)];
                      if (target) handleRowMove({ kind: rowKind, id: savedRowId, targetId: target.id, after: event.key === "ArrowDown" });
                    }}
                    className="flex h-full w-3.5 shrink-0 cursor-grab items-center justify-center text-zinc-400 hover:text-zinc-700 active:cursor-grabbing"
                  >
                    <GripVertical aria-hidden="true" className="size-3.5" />
                  </button>
                )}
                {/* Every row's leading slot, all the same size so names
                    line up: the chevron, only for a category that
                    actually has tasks to expand/collapse; a blue diamond
                    for a milestone; a checkbox for every other task and
                    task-less "standalone" category (e.g. MOBILIZATION,
                    a regular task row — see categoryDatesLocked's own
                    doc comment above), ticking it for the toolbar's
                    Delete; and an empty spacer for a filler row or one
                    not saved yet (nothing real to delete). */}
                {isGroup ? (
                  <button
                    type="button"
                    onClick={() => onExpanderClick(row)}
                    aria-label={row.hideChildren ? "Expand phase" : "Collapse phase"}
                    className="mr-1.5 shrink-0 cursor-pointer text-zinc-400 hover:text-zinc-700"
                  >
                    {row.hideChildren ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                ) : isMilestoneRow ? (
                  <Diamond
                    aria-hidden
                    className={`${!isProject ? "ml-4 " : ""}mr-1.5 size-3.5 shrink-0 text-blue-600`}
                  />
                ) : (isProject ? category?.id ?? 0 : task?.id ?? 0) > 0 ? (
                  // Drawn, not the browser's own: square, light gray, and
                  // a small check centered in it (same path as the
                  // progress window's history markers).
                  <span className="relative mr-1.5 size-3.5 shrink-0">
                    <ProjectWriteInput
                      type="checkbox"
                      checked={selectedRowIds.has(row.id)}
                      onChange={() => toggleRowSelected(row.id)}
                      aria-label={`Select ${row.name}`}
                      className="peer block size-3.5 cursor-pointer appearance-none border border-zinc-300 bg-white transition checked:border-zinc-500 checked:bg-zinc-500 focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-zinc-400"
                    />
                    <svg
                      aria-hidden
                      viewBox="0 0 16 16"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="pointer-events-none absolute inset-0 size-3.5 text-white opacity-0 peer-checked:opacity-100"
                    >
                      <path d="M4.5 8 7 10.5l4.5-5" />
                    </svg>
                  </span>
                ) : (
                  <span className="mr-1.5 size-3.5 shrink-0" aria-hidden="true" />
                )}
                {isProject && category && editingCategoryId === category.id ? (
                  // Shown either right after handleAddPhase's own create
                  // call succeeds, or any time the name button just below
                  // is clicked — a phase's own name is always renameable
                  // this way, not just the moment it's created. Same
                  // no-border-radius "active cell" look the rest of this
                  // table already uses for its own focused-cell states
                  // (Percent Complete's own wrapper, the Start/End date
                  // inputs' data-cell-active rule in globals.css) — square
                  // corners, matching the plain grid it's replacing rather
                  // than introducing a mismatched rounded one. h-full so
                  // it actually fills the row instead of just its own
                  // line-height, the same reason every other inline input
                  // in this table already sets it.
                  <ProjectWriteInput
                    key={category.id}
                    type="text"
                    autoFocus
                    defaultValue={
                      inlineNameDrafts.current.get(`category:${category.id}`)?.value ??
                      pendingCategoryNameOverrides.get(category.id) ?? category.name
                    }
                    onFocus={(e) => {
                      const draft = inlineNameDrafts.current.get(`category:${category.id}`);
                      if (draft) e.currentTarget.setSelectionRange(draft.start, draft.end);
                      else e.currentTarget.select();
                    }}
                    onChange={(e) => inlineNameDrafts.current.set(`category:${category.id}`, {
                      value: e.currentTarget.value, start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd,
                    })}
                    onBlur={(e) =>
                      handleCategoryRename(category.id, e.target.value, category.name)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") {
                        inlineNameDrafts.current.delete(`category:${category.id}`);
                        setEditingCategoryId(null);
                      }
                    }}
                    aria-label="Phase name"
                    className={`h-full min-w-0 flex-1 border-none bg-white px-1 text-xs text-zinc-900 outline-1 -outline-offset-1 outline-zinc-400 ${
                      isGroup ? "font-bold" : "font-medium"
                    }`}
                  />
                ) : isProject && category && category.id > 0 ? (
                  <ProjectWriteButton
                    type="button"
                    onClick={() => setEditingCategoryId(category.id)}
                    title="Click to rename"
                    className={`min-w-0 flex-1 cursor-pointer truncate text-left transition ${
                      isGroup ? "font-bold" : "font-medium"
                    } ${isMilestoneRow ? "text-blue-600 hover:text-blue-500" : "hover:text-zinc-600"}`}
                  >
                    {/* pendingCategoryNameOverrides' own doc comment (see
                        usePendingOverrides) — without this, closing the
                        rename input flashed back to the *old* row.name
                        for the whole router.refresh() round trip. */}
                    {pendingCategoryNameOverrides.get(category.id) ?? category.name}
                  </ProjectWriteButton>
                ) : isProject && category ? (
                  // The brief placeholder window (see handleAddPhase's
                  // own tempId comment) — a negative id means this row's
                  // real one hasn't come back from the server yet, so
                  // renaming here has nothing real to persist against.
                  // Plain, not clickable, same look otherwise; swaps to
                  // the button above itself the instant the real id
                  // lands (categoryById/tasks re-derive from the exact
                  // same pendingNewPhase update that swaps it in).
                  <span
                    className={`min-w-0 flex-1 truncate text-left ${isGroup ? "font-bold" : "font-medium"}`}
                  >
                    {row.name}
                  </span>
                ) : !isProject && task && editingTaskId === task.id ? (
                  // Same inline rename input as a phase's own name above,
                  // just indented to match a task row's own nesting level.
                  // ml-4 (margin, not the pl-4 padding the static span/
                  // button below use) so the input's own outline box
                  // starts at the indent instead of spanning the full
                  // cell width with blank padded space inside it — with
                  // padding instead, the visible outline wrapped that
                  // empty space too, reading as oversized/misaligned
                  // against the indent it's supposed to match.
                  <ProjectWriteInput
                    key={task.id}
                    type="text"
                    autoFocus
                    // The table can remount during creation/revalidation. Its
                    // draft survives both that refresh and the temporary-ID
                    // handoff, even after optimistic overrides have expired.
                    defaultValue={inlineNameDrafts.current.get(`task:${task.id}`)?.value ?? pendingNameOverrides.get(task.id) ?? task.name}
                    onFocus={(e) => {
                      const draft = inlineNameDrafts.current.get(`task:${task.id}`);
                      if (draft) e.currentTarget.setSelectionRange(draft.start, draft.end);
                      else e.currentTarget.select();
                    }}
                    onChange={(e) => inlineNameDrafts.current.set(`task:${task.id}`, {
                      value: e.currentTarget.value, start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd,
                    })}
                    onBlur={(e) =>
                      handleTaskRename(task.id, e.target.value, task.name)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") {
                        inlineNameDrafts.current.delete(`task:${task.id}`);
                        setEditingTaskId(null);
                      }
                    }}
                    aria-label="Task name"
                    className={`h-full min-w-0 flex-1 border-none bg-white ${
                      isMilestoneRow ? "" : "ml-4 "
                    }px-1 text-xs font-medium text-zinc-900 outline-1 -outline-offset-1 outline-zinc-400`}
                  />
                ) : !isProject && task && task.id > 0 ? (
                  <ProjectWriteButton
                    type="button"
                    onClick={() => setEditingTaskId(task.id)}
                    title="Click to rename"
                    className={
                      // Same pl-4 nesting-indent reasoning as the former
                      // plain span here (phase names sit flush left of
                      // their own chevron, so an unindented task name
                      // read as the same hierarchy level instead of
                      // belonging *under* its phase), now on a button
                      // since the name itself is clickable-to-rename —
                      // same convention as a phase's own name button
                      // just above, not bold since a task row isn't. A
                      // milestone's name is blue, like its diamond.
                      `min-w-0 flex-1 cursor-pointer truncate text-left font-medium transition ${
                        isMilestoneRow
                          ? "text-blue-600 hover:text-blue-500"
                          : "pl-4 hover:text-zinc-600"
                      }`
                    }
                  >
                    {/* pendingNameOverrides' own doc comment (see
                        usePendingOverrides) — without this, closing the
                        rename input (editingTaskId clears immediately)
                        flashed back to the *old* row.name for the whole
                        router.refresh() round trip before jumping to the
                        new one. */}
                    {pendingNameOverrides.get(task.id) ?? task.name}
                  </ProjectWriteButton>
                ) : (
                  // Filler rows, or a brand new subtask's own temporary
                  // placeholder id (see handleAddSubtask's own tempId
                  // comment — renaming it here would have nothing real
                  // to persist against yet) — plain, unclickable either
                  // way.
                  <span
                    className={`min-w-0 flex-1 truncate font-medium ${
                      isMilestoneRow ? "text-blue-600" : "pl-4"
                    }`}
                  >
                    {row.name}
                  </span>
                )}
                {/* Formerly their own Actions column, moved in here per
                    an explicit user request — a phase row's add-task/
                    edit pair, or a task row's own single edit button.
                    Delete lives inside each row's own Edit modal (see
                    CategoryForm's/SubtaskForm's own showDeleteButton /
                    built-in Delete button), not a button here. */}
                {isProject && category && category.id > 0 ? (
                  <>
                    <ProjectWriteButton
                      type="button"
                      onClick={() => handleAddSubtask(category.id)}
                      aria-label={`Add task to ${category.name}`}
                      title="Add task"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <Plus className="size-3.5" />
                    </ProjectWriteButton>
                    <ProjectWriteButton
                      type="button"
                      onClick={() => setCategoryModal(category)}
                      aria-label="Edit category"
                      title="Edit phase"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </ProjectWriteButton>
                  </>
                ) : isProject ? null : (
                  !isProject &&
                  task &&
                  task.id > 0 && (
                    <ProjectWriteButton
                      type="button"
                      onClick={() => setTaskModal(task)}
                      aria-label="Edit task item"
                      title="Edit task"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </ProjectWriteButton>
                  )
                )}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.start }}
                data-phase-info-cell={categoryDatesLocked ? true : undefined}
                onClick={
                  categoryDatesLocked
                    ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setCellInfoTooltip((current) =>
                          current?.rowId === row.id && current.field === "start"
                            ? null
                            : {
                                rowId: row.id,
                                field: "start",
                                top: rect.bottom,
                                left: rect.left,
                              }
                        );
                      }
                    : undefined
                }
              >
                {categoryDatesLocked ? (
                  // Same <input type="date"> as a task row below, for the
                  // exact same native MM/DD/YYYY rendering — just locked
                  // down (readOnly + pointer-events-none + unfocusable)
                  // since a phase's own start/end is a rollup of its
                  // tasks, never something to edit directly here. The
                  // calendar icon itself is hidden entirely for a
                  // readonly date input specifically (see globals.css) —
                  // a plain span would drift from the task rows' own
                  // date format (locale, separators) since it can't reuse
                  // the input's own native formatting.
                  <ProjectWriteInput
                    key={toIsoDate(row.start)}
                    type="date"
                    readOnly
                    tabIndex={-1}
                    defaultValue={toIsoDate(row.start)}
                    aria-label={`${row.name} start date`}
                    className="pointer-events-none h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light"
                  />
                ) : isFiller ? null : (
                  <GanttDateInput disabled={!canEdit}
                    // Forces a remount (and so a freshly-evaluated
                    // defaultValue) whenever the underlying date actually
                    // changes — including live, frame-by-frame, while
                    // dragging the bar. Without this the input is an
                    // ordinary uncontrolled field: it mounts once and
                    // never notices row.start changing on a later
                    // render, the same reason the Days column (plain
                    // text, recomputed every render — no such staleness)
                    // already tracked a drag live and this didn't.
                    //
                    // That same remount is exactly why this used to save
                    // on every onChange rather than commit on blur like
                    // Percent Complete does: a native date input's own
                    // onChange fires the moment a segment becomes a
                    // complete-enough value on its own (e.g. typing "2"
                    // for a day that could still become "20"-"29"), not
                    // only once the whole field is done being typed into
                    // — persisting immediately set an optimistic
                    // override, which changed row.start, which changed
                    // this very key, remounting the input out from under
                    // whatever the next keystroke was about to be.
                    // Confirmed directly this was eating characters
                    // typed in quick succession. Committing on blur (or
                    // Enter, which just blurs) instead means nothing
                    // saves — and nothing can remount this input — until
                    // typing is actually finished.
                    key={toIsoDate(row.start)}
                    type="date"
                    defaultValue={toIsoDate(row.start)}
                    onFocus={(e) => {
                      e.currentTarget.dataset.cellActive = "true";
                    }}
                    onBlur={(e) => {
                      delete e.currentTarget.dataset.cellActive;
                      if (isProject && category) {
                        handleCategoryDateEdit(
                          category.id,
                          row,
                          "start",
                          e.target.value,
                          e.target
                        );
                      } else {
                        handleTaskDateEdit(row, "start", e.target.value, e.target);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`${row.name} start date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light transition hover:bg-zinc-900 hover:text-white"
                  />
                )}
                {cellInfoTooltip?.rowId === row.id &&
                  cellInfoTooltip.field === "start" &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        top: cellInfoTooltip.top + 8,
                        left: cellInfoTooltip.left,
                      }}
                      className="fixed z-50 rounded bg-zinc-900 px-4 py-2 text-[11px] font-medium whitespace-nowrap text-white uppercase shadow-lg"
                    >
                      {/* The pointer — a 45deg-rotated square, half
                          tucked behind the bubble's own top edge (so
                          only its top-left/top-right corners peek out
                          above it) and half above it, reading as a
                          triangle pointing up at the cell that opened
                          this tooltip. */}
                      <div className="absolute -top-1.5 left-4 size-3 rotate-45 bg-zinc-900" />
                      This is calculated automatically from the earliest
                      planned start date of its subtasks.
                    </div>,
                    document.body
                  )}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.end }}
                data-phase-info-cell={categoryDatesLocked ? true : undefined}
                onClick={
                  categoryDatesLocked
                    ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setCellInfoTooltip((current) =>
                          current?.rowId === row.id && current.field === "end"
                            ? null
                            : {
                                rowId: row.id,
                                field: "end",
                                top: rect.bottom,
                                left: rect.left,
                              }
                        );
                      }
                    : undefined
                }
              >
                {categoryDatesLocked ? (
                  // See the matching comment on the Start input above.
                  // trueEndDate, not row.end directly — see its own doc
                  // comment for why row.end is one day later than the
                  // true planned end for a non-milestone row.
                  <ProjectWriteInput
                    key={toIsoDate(trueEndDate(row))}
                    type="date"
                    readOnly
                    tabIndex={-1}
                    defaultValue={toIsoDate(trueEndDate(row))}
                    aria-label={`${row.name} end date`}
                    className="pointer-events-none h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light"
                  />
                ) : isFiller ? null : (
                  <GanttDateInput disabled={!canEdit}
                    // See the matching comment on the Start input above.
                    key={toIsoDate(trueEndDate(row))}
                    type="date"
                    defaultValue={toIsoDate(trueEndDate(row))}
                    onFocus={(e) => {
                      e.currentTarget.dataset.cellActive = "true";
                    }}
                    onBlur={(e) => {
                      delete e.currentTarget.dataset.cellActive;
                      if (isProject && category) {
                        handleCategoryDateEdit(
                          category.id,
                          row,
                          "end",
                          e.target.value,
                          e.target
                        );
                      } else {
                        handleTaskDateEdit(row, "end", e.target.value, e.target);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`${row.name} end date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light transition hover:bg-zinc-900 hover:text-white"
                  />
                )}
                {cellInfoTooltip?.rowId === row.id &&
                  cellInfoTooltip.field === "end" &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        top: cellInfoTooltip.top + 8,
                        left: cellInfoTooltip.left,
                      }}
                      className="fixed z-50 rounded bg-zinc-900 px-4 py-2 text-[11px] font-medium whitespace-nowrap text-white uppercase shadow-lg"
                    >
                      {/* See the matching comment on the Start tooltip
                          above. */}
                      <div className="absolute -top-1.5 left-4 size-3 rotate-45 bg-zinc-900" />
                      This is calculated automatically from the latest
                      planned end date of its subtasks.
                    </div>,
                    document.body
                  )}
              </div>
              <div
                className="flex h-full shrink-0 items-center justify-end border-r border-zinc-200 px-2"
                style={{ width: columnWidths.duration }}
              >
                {isFiller || isMilestoneRow ? null : days}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.priority }}
              >
                {/* A category row gets its own priority cell too now
                    (see CostCategory.priority's own doc comment) —
                    always directly set, never a rollup of its tasks'
                    own priorities the way Start/End is. A plain <select>,
                    same "blend in until interacted with" look as the
                    Start/End date inputs (border-none/bg-transparent,
                    hover highlight, and the same data-cell-active
                    onFocus/onBlur -> white background + outline
                    treatment, see globals.css) rather than a custom
                    dropdown — native <select> already gives keyboard/
                    screen-reader support for free. key={...} remounts
                    it (so its defaultValue re-evaluates) the same way
                    the date inputs already do whenever the underlying
                    value actually changes from elsewhere (e.g. an
                    Undo).
                    appearance-none strips the browser's own native
                    control chrome (its own padding/min-size/rounded
                    background, confirmed directly this is what was
                    making the hover highlight look like a small pill
                    instead of filling the cell) — padding/hover/height
                    are this app's own utility classes instead, same as
                    every other cell here, with a hand-drawn chevron
                    replacing the native one appearance-none removes. */}
                {!isMilestoneRow &&
                  isProject &&
                  category &&
                  (() => {
                    const effectivePriority =
                      pendingCategoryPriorityOverrides.get(category.id) ??
                      category.priority;
                    return (
                      <>
                        <ProjectWriteSelect
                          key={effectivePriority}
                          defaultValue={effectivePriority}
                          onChange={(e) =>
                            handleCategoryPriorityEdit(
                              category.id,
                              e.target.value
                            )
                          }
                          onFocus={(e) => {
                            e.currentTarget.dataset.cellActive = "true";
                          }}
                          onBlur={(e) => {
                            delete e.currentTarget.dataset.cellActive;
                          }}
                          aria-label={`${row.name} priority`}
                          className={`flex h-full w-full cursor-pointer appearance-none items-center border-none bg-transparent px-2 pr-6 text-left text-xs leading-none transition hover:bg-zinc-900 hover:text-white ${
                            effectivePriority === "high"
                              ? "font-medium text-red-600"
                              : effectivePriority === "low"
                                ? "text-zinc-400"
                                : "text-zinc-600"
                          }`}
                        >
                          <option value="high" className="text-zinc-900">
                            High
                          </option>
                          <option value="medium" className="text-zinc-900">
                            Medium
                          </option>
                          <option value="low" className="text-zinc-900">
                            Low
                          </option>
                        </ProjectWriteSelect>
                        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-zinc-400" />
                      </>
                    );
                  })()}
                {!isMilestoneRow &&
                  task &&
                  task.id > 0 &&
                  (() => {
                    // pendingPriorityOverrides' own doc comment (see
                    // usePendingOverrides) — without this, `task.priority`
                    // stays stale until router.refresh() lands, so the
                    // <select>'s own color coding lagged 1-2s behind the
                    // option it was already showing.
                    const effectivePriority =
                      pendingPriorityOverrides.get(task.id) ?? task.priority;
                    return (
                      <>
                        <ProjectWriteSelect
                          key={effectivePriority}
                          defaultValue={effectivePriority}
                          onChange={(e) =>
                            handleTaskPriorityEdit(task.id, e.target.value)
                          }
                          onFocus={(e) => {
                            e.currentTarget.dataset.cellActive = "true";
                          }}
                          onBlur={(e) => {
                            delete e.currentTarget.dataset.cellActive;
                          }}
                          aria-label={`${row.name} priority`}
                          className={`flex h-full w-full cursor-pointer appearance-none items-center border-none bg-transparent px-2 pr-6 text-left text-xs leading-none transition hover:bg-zinc-900 hover:text-white ${
                            effectivePriority === "high"
                              ? "font-medium text-red-600"
                              : effectivePriority === "low"
                                ? "text-zinc-400"
                                : "text-zinc-600"
                          }`}
                        >
                          {/* text-zinc-900 on every option, not just a
                              neutral default — an <option> otherwise
                              inherits the <select>'s own text color
                              (confirmed directly: with High selected, the
                              whole open dropdown list rendered in that same
                              red), so this overrides that inheritance
                              explicitly rather than leaving it to fall back
                              on its own. Only the closed cell's own text
                              should read as color-coded, not the option
                              list. */}
                          <option value="high" className="text-zinc-900">
                            High
                          </option>
                          <option value="medium" className="text-zinc-900">
                            Medium
                          </option>
                          <option value="low" className="text-zinc-900">
                            Low
                          </option>
                        </ProjectWriteSelect>
                        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-zinc-400" />
                      </>
                    );
                  })()}
              </div>
              <div
                className="flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.weight }}
              >
                {/* See WeightButton. A category with tasks is the sum of
                    its tasks' weights, so it's shown muted. */}
                {!isMilestoneRow && isProject && category && (
                  <WeightButton
                    weight={category.weight}
                    muted={category.hasTasks}
                    onClick={() =>
                      setWeightBreakdown({ kind: "category", id: category.id })
                    }
                  />
                )}
                {!isMilestoneRow && task && task.id > 0 && (
                  <WeightButton
                    weight={task.weight}
                    muted={false}
                    onClick={() => setWeightBreakdown({ kind: "task", id: task.id })}
                  />
                )}
              </div>
              <div
                className="flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.assigned }}
              >
                {/* Unlike Priority above, a category row DOES get its
                    own cell here — see CategoryWorkerAssignments's own
                    doc comment for why worker assignment doesn't have
                    Start/End's own "conflicts with a rollup" problem
                    (categoryMaterialEstimate already layers a category's
                    own direct cost on top of its tasks' the same way,
                    regardless of whether it has any), so this isn't
                    gated by categoryDatesLocked/hasTasks the way the
                    Start/End cells are. */}
                {!isMilestoneRow &&
                  isProject &&
                  category &&
                  (() => {
                    const assignedIds =
                      categoryWorkerAssignments[category.id] ?? [];
                    const assignedInfo = getAssignedCellDisplay(assignedIds);
                    return (
                      <ProjectWriteButton
                        type="button"
                        onClick={() =>
                          setAssignWorkersModal({
                            kind: "category",
                            categoryId: category.id,
                            name: category.name,
                            start: row.start,
                            end: trueEndDate(row),
                          })
                        }
                        title={assignedInfo.title}
                        className={`h-full w-full cursor-pointer truncate px-2 text-left transition hover:bg-zinc-900 hover:text-white ${
                          assignedInfo.hasAssigned ? "text-zinc-700" : "text-zinc-400"
                        }`}
                      >
                        {assignedInfo.label}
                      </ProjectWriteButton>
                    );
                  })()}
                {!isMilestoneRow &&
                  task &&
                  task.id > 0 &&
                  (() => {
                    const assignedIds = taskWorkerAssignments[task.id] ?? [];
                    const assignedInfo = getAssignedCellDisplay(assignedIds);
                    return (
                      <ProjectWriteButton
                        type="button"
                        onClick={() =>
                          setAssignWorkersModal({
                            kind: "task",
                            taskId: task.id,
                            name: task.name,
                            start: row.start,
                            end: trueEndDate(row),
                          })
                        }
                        title={assignedInfo.title}
                        className={`h-full w-full cursor-pointer truncate px-2 text-left transition hover:bg-zinc-900 hover:text-white ${
                          assignedInfo.hasAssigned ? "text-zinc-700" : "text-zinc-400"
                        }`}
                      >
                        {assignedInfo.label}
                      </ProjectWriteButton>
                    );
                  })()}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.equipment }}
              >
                {!isMilestoneRow && ((task && task.id > 0) || (isProject && category && !category.hasTasks)) && (() => {
                  const key = task && task.id > 0 ? `task-${task.id}` : `category-${category!.id}`;
                  const name = task && task.id > 0 ? task.name : category!.name;
                  const planned = equipmentTracking?.plans.filter((p) => p.itemKey === key) ?? [];
                  return <ProjectWriteButton type="button" onClick={() => setEquipmentTarget({ key, name })}
                    title={planned.map((p) => `${p.name} (${p.assetTag})`).join(", ") || "Assign tools & equipment"}
                    className="h-full w-full cursor-pointer truncate px-2 text-left text-zinc-600 hover:bg-zinc-900 hover:text-white">
                    {planned.length ? `${planned[0].name}${planned.length > 1 ? ` +${planned.length - 1}` : ""}` : "Assign"}
                  </ProjectWriteButton>;
                })()}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.percentComplete }}
                data-phase-info-cell={
                  isProject && category?.hasTasks ? true : undefined
                }
                onClick={
                  isFiller
                    ? undefined
                    : isProject && category?.hasTasks
                      ? (e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          setCellInfoTooltip((current) =>
                            current?.rowId === row.id &&
                            current.field === "percentComplete"
                              ? null
                              : {
                                  rowId: row.id,
                                  field: "percentComplete",
                                  top: rect.bottom,
                                  left: rect.left,
                                }
                          );
                        }
                      : isProject
                        ? // A task-less category: same destination as
                          // clicking its own bar in the chart
                          // (handleBarClick above) — its percent complete
                          // is directly tracked, not a rollup of anything,
                          // so there's a real action to take here too, not
                          // just something to explain.
                          // Not for one marked as a milestone, the same
                          // as a milestone task's below.
                          () => {
                            if (!category || isMilestoneRow) return;
                            const foundCategory = categoriesForDisplay.find(
                              (c) => c.id === category.id
                            );
                            if (foundCategory) {
                              const override = pendingCategoryScheduleOverrides.get(
                                foundCategory.id
                              );
                              setProgressModal({
                                kind: "category",
                                category: override
                                  ? {
                                      ...foundCategory,
                                      plannedStartDate: override.start,
                                      plannedEndDate: override.end,
                                      percentComplete: row.progress,
                                    }
                                  : foundCategory,
                              });
                            }
                          }
                        : // Task rows: same destination as clicking the
                          // task's own bar in the chart (handleBarClick
                          // above) — open Progress Tracking directly instead
                          // of an info tooltip, since there's now a real
                          // action to take here, not just something to
                          // explain. task.id > 0 excludes handleAddSubtask's
                          // own brief placeholder row, same reasoning as
                          // handleBarClick's own guard. Milestones are
                          // excluded — a zero-duration marker has nothing
                          // to track progress against, same reasoning as
                          // handleBarClick's own milestone exclusion.
                          () => {
                            if (task && task.id > 0 && !task.isMilestone) {
                              const override = pendingScheduleOverrides.get(task.id);
                              setProgressModal({
                                kind: "task",
                                task: override
                                  ? {
                                      ...task,
                                      plannedStartDate: override.start,
                                      plannedEndDate: override.end,
                                      percentComplete: row.progress,
                                    }
                                  : task,
                              });
                            }
                          }
                }
              >
                {/* Never stored, never typed here on either row type —
                    Automatic Progress Completion (see
                    lib/task-progress/calculate.ts), anchored by a
                    Progress Tracking Override once one exists (click the
                    task's own bar in the chart, see handleBarClick
                    below). A phase row's own value is still the plain
                    duration-weighted average of its tasks (see
                    percentCompleteByCategoryId's own doc comment);
                    row.progress already *is* that computed value for
                    either row type (set from task.percentComplete
                    directly in the tasks memo above), so this just
                    reads it back rather than re-deriving it. */}
                {!isFiller &&
                  (() => {
                    // A directly tracked row (a task, or a task-less
                    // phase) with saved Daily Progress Update days — its
                    // progress was overridden, not just automatic. The
                    // latest one is what its own modal shows under its inputs.
                    const lastOverride = (
                      task
                        ? taskProgressToday[task.id]
                        : category && !category.hasTasks
                          ? categoryProgressToday[category.id]
                          : undefined
                    )?.latest;
                    return (
                      <span
                        className={`flex h-full w-full items-center truncate px-2 text-xs text-zinc-600 transition ${
                          (isProject || task) && !isMilestoneRow
                            ? "cursor-pointer hover:bg-zinc-900 hover:text-white"
                            : ""
                        }`}
                      >
                        {formatPercent(row.progress)}%
                        {lastOverride && (
                          <span
                            title={`Progress overridden · last on ${new Date(
                              `${lastOverride.entryDate}T00:00:00`
                            ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${
                              lastOverride.savedByName ? ` by ${lastOverride.savedByName}` : ""
                            }`}
                            aria-label="Progress overridden"
                            className="ml-auto size-1.5 shrink-0 rounded-full bg-orange-500"
                          />
                        )}
                      </span>
                    );
                  })()}
                {cellInfoTooltip?.rowId === row.id &&
                  cellInfoTooltip.field === "percentComplete" &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        top: cellInfoTooltip.top + 8,
                        left: cellInfoTooltip.left,
                      }}
                      className="fixed z-50 rounded bg-zinc-900 px-4 py-2 text-[11px] font-medium whitespace-nowrap text-white uppercase shadow-lg"
                    >
                      {/* See the matching comment on the Start tooltip
                          above. Only ever reachable for a phase row that
                          still has tasks now — a task/milestone row, or a
                          task-less phase row, opens Progress Tracking
                          directly on click instead (see the onClick
                          above), so this text no longer needs either
                          branch. */}
                      <div className="absolute -top-1.5 left-4 size-3 rotate-45 bg-zinc-900" />
                      This is calculated automatically and shows the
                      cumulative percent complete of all subtasks.
                    </div>,
                    document.body
                  )}
              </div>
              <div
                className="flex h-full shrink-0 items-center"
                style={{ width: columnWidths.expected }}
              >
                {!isFiller &&
                  (() => {
                    let expected: number | null | undefined;
                    if (isProject && category) {
                      if (!category.hasTasks) {
                        const override = pendingCategoryScheduleOverrides.get(
                          category.id
                        );
                        expected = override
                          ? computeExpectedProgress({
                              plannedStartDate: override.start,
                              plannedEndDate: override.end,
                              workingDays,
                              holidays,
                              today: new Date(),
                            }).timePercent
                          : expectedByCategoryId.get(category.id);
                      } else if (pendingScheduleOverrides.size > 0) {
                        const fullCategory = categoriesForDisplay.find(
                          (c) => c.id === category.id
                        );
                        if (
                          fullCategory &&
                          fullCategory.tasks.some((t) =>
                            pendingScheduleOverrides.has(t.id)
                          )
                        ) {
                          const today = new Date();
                          let weightedSum = 0;
                          let totalDuration = 0;
                          for (const childTask of fullCategory.tasks) {
                            const childOverride = pendingScheduleOverrides.get(
                              childTask.id
                            );
                            const childExpected = childOverride
                              ? computeExpectedProgress({
                                  plannedStartDate: childOverride.start,
                                  plannedEndDate: childOverride.end,
                                  workingDays,
                                  holidays,
                                  today,
                                }).timePercent
                              : expectedByTaskId.get(childTask.id);
                            if (childExpected == null) continue;
                            const { start, end } = childOverride
                              ? {
                                  start: toDate(childOverride.start),
                                  end: toDate(childOverride.end),
                                }
                              : resolvedDates(childTask);
                            const duration = workingDaysBetween(start, end);
                            weightedSum += duration * childExpected;
                            totalDuration += duration;
                          }
                          expected =
                            totalDuration > 0
                              ? weightedSum / totalDuration
                              : null;
                        } else {
                          expected = expectedByCategoryId.get(category.id);
                        }
                      } else {
                        expected = expectedByCategoryId.get(category.id);
                      }
                    } else if (task) {
                      const override = pendingScheduleOverrides.get(task.id);
                      expected = override
                        ? computeExpectedProgress({
                            plannedStartDate: override.start,
                            plannedEndDate: override.end,
                            workingDays,
                            holidays,
                            today: new Date(),
                          }).timePercent
                        : expectedByTaskId.get(task.id);
                    } else {
                      expected = null;
                    }
                    if (expected == null) {
                      return <span className="px-2 text-xs text-zinc-300">—</span>;
                    }
                    return (
                      <ExpectedProgressCell actual={row.progress} expected={expected} />
                    );
                  })()}
              </div>
            </div>
          );
        })}
      </div>
      </div>
    );
  }

  return (
    // Inset in the page's own padding, on the gray content area under
    // the Cost overview card (project-detail-view.tsx).
    <div id="project-schedule-section" className="flex flex-col gap-3">
      {/* The section's header: its name and counts, and Import with AI. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900">Project schedule</h2>
          <span className="text-xs text-zinc-400">
            {scheduleCounts.tasks} {scheduleCounts.tasks === 1 ? "task" : "tasks"} ·{" "}
            {scheduleCounts.milestones}{" "}
            {scheduleCounts.milestones === 1 ? "milestone" : "milestones"}
          </span>
          {(savingModalEdit || savingRowOrder) && <span role="status" className="text-xs text-zinc-500">Saving changes…</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setProjectInsightsOpen(true)}
            title="AI Project Insights"
            className="ai-rainbow-button flex cursor-pointer items-center gap-2 rounded px-3.5 py-1.5 text-sm font-semibold text-white transition"
          >
            <AiSparklesIcon variant="white" className="size-5 shrink-0" />
            <span>AI Project Insights</span>
          </button>
          <ProjectWriteButton
            type="button"
            onClick={onImportBom}
            title="Import a document with AI"
            className="ai-rainbow-button flex cursor-pointer items-center gap-2 rounded px-3.5 py-1.5 text-sm font-semibold text-white transition"
          >
            <AiSparklesIcon variant="white" className="size-5 shrink-0" />
            <span>Import with AI</span>
          </ProjectWriteButton>
        </div>
      </div>
      {modalSaveError && <p role="alert" className="text-sm text-red-600">{modalSaveError}</p>}
      {rowMoveError && <p role="alert" className="text-sm text-red-600">{rowMoveError}</p>}
      {/* Toolbar + whatever follows (the chart, or the empty-state
          placeholder) share this one un-gapped flex column so the
          toolbar sits flush against it, no visible seam — a plain
          sibling gap (like the rest of this component uses via the
          outer gap-3) would leave a gap here instead. Their two
          `border-zinc-200` edges land directly on top of each other
          this way, reading as one continuous line rather than a double
          border, same as adjacent bordered rows elsewhere in this
          chart. */}
      <div className="flex flex-col">
        {/* Deliberately just the view menu, Undo/Redo and zoom — a reference
            toolbar image with ~25 icons (text color, cut/copy/paste,
            zoom, print, share, lock, settings, ...) was the original
            ask, but none of those other actions have a real feature
            behind them in this app, so they're not here as decoration. */}
        <div className="flex items-center gap-1.5 border border-zinc-200 bg-zinc-50 px-3 py-2">
          <ViewMenu
            views={SCHEDULE_VIEWS}
            value={calendarView ? "calendar" : "gantt"}
            onChange={(scheduleView) => setCalendarView(scheduleView === "calendar")}
          />
          <div className="mx-1.5 h-6 w-px bg-zinc-200" />
          <ProjectWriteButton
            type="button"
            onClick={handleUndo}
            disabled={!historyReady || (!effectiveCanUndo && operationQueue.pending === 0) || savingSharedCost}
            aria-label="Undo"
            title="Undo last action (Ctrl+Z)"
            aria-busy={isUndoRedoPending}
            className="cursor-pointer rounded p-2 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Undo2 className="size-4" />
          </ProjectWriteButton>
          <ProjectWriteButton
            type="button"
            onClick={handleRedo}
            disabled={!historyReady || (!effectiveCanRedo && !isUndoRedoPending) || savingSharedCost}
            aria-label="Redo"
            title="Redo last action (Ctrl+Y)"
            aria-busy={isUndoRedoPending}
            className="cursor-pointer rounded p-2 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Redo2 className="size-4" />
          </ProjectWriteButton>
          {historyError && <span role="status" className="ml-2 text-xs text-red-600">{historyError}</span>}
          {/* Zoom is the Gantt view's alone. Week isn't offered here —
              see the `view` state's own doc comment above for why. */}
          {!calendarView && <div className="mx-1.5 h-6 w-px bg-zinc-200" />}
          {!calendarView && TIMELINE_VIEW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              title={`Zoom to ${option}`}
              className={`cursor-pointer rounded px-3 py-1.5 text-sm font-medium capitalize transition ${
                view === option
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
              }`}
            >
              {option}
            </button>
          ))}
          {!calendarView && canEdit && <span className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
            {savingBarGroup ? "Saving schedules..." : selectedBarIds.size > 0 ? `${selectedBarIds.size} bars selected` : "Shift-click bars to select"}
            {selectedBarIds.size > 0 && <button type="button" onClick={() => setSelectedBarIds(new Set())} className="cursor-pointer underline underline-offset-2">Clear</button>}
          </span>}
          {/* Only while something's ticked in the task list. */}
          {!calendarView && selectedCount > 0 && (
            <ProjectWriteButton
              type="button"
              onClick={deleteSelected}
              disabled={deleting}
              className="ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-red-200 bg-white px-2.5 py-1.5 text-sm font-medium text-red-600 transition hover:bg-red-50"
            >
              <Trash2 className="size-4" />
              Delete {selectedCount} selected
            </ProjectWriteButton>
          )}
        </div>

        {barGroupError && <p role="alert" className="border-x border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">{barGroupError}</p>}
        {/* Always the real chart, even with zero phases yet — a plain
            "add your first phase" placeholder here used to replace the
            whole chart outright, but the chart already renders as a
            full, real-looking grid with nothing in it (the filler-row
            system below pads a short/empty project out to a minimum
            height on its own, same mechanism a short *populated*
            project already relies on), so there's no need to swap in a
            separate empty state — the header's own "+" (Add task, see
            CustomTaskListHeader) is already reachable with zero phases,
            same as with any number of them. */}
        {calendarView && (
          <ProjectCalendarView
            items={calendarItems}
            events={events}
            holidays={holidays}
            workingDays={workingDays}
            canEditEvents={isAdmin && canEdit}
            onAddEvent={(date) => setEventModal({ date })}
            onEventClick={(event) => setEventModal({ date: event.date, event })}
            onItemClick={handleCalendarItemClick}
          />
        )}
        {/* Hidden, not unmounted, while the Calendar view is showing —
            the chart's own scroll/resize wiring is set up once on mount,
            so remounting it on the way back isn't safe. */}
        <div className={calendarView ? "hidden" : "contents"}>
            {/* Expand/Collapse-all and Show/Hide Task List are still
                removed for now — the Gantt chart's own toolbar gets a
                fuller design pass later. Day/Month/Year zoom is live
                (see the toolbar row above); showTaskList itself stays
                at its own default (true) with no UI to change it yet. */}

            <div
              ref={chartOuterRef}
              // isolate: gives everything inside this box its own
              // stacking context, so none of its internal z-index
              // values (the panel-resize handle, etc.) can ever compete
              // with page-level elements outside this box, like
              // project-detail-view.tsx's own sticky tabs bar (z-20).
              // Confirmed directly this was a real bug without it: the
              // panel-resize handle's own z-20 tied with the tabs bar's
              // z-20, and being later in the DOM, won that tie and
              // painted over the tabs once scrolled
              // far enough for the two to visually overlap.
              //
              // overflow-x-clip (not overflow-x-hidden) — a deliberate,
              // confirmed-directly distinction. `hidden` was tried first
              // and removed entirely: per the CSS overflow spec, setting
              // *either* axis to a non-visible, non-`clip` value forces
              // the *other* axis's computed value off of "visible" too
              // (confirmed directly via getComputedStyle — overflow-x:
              // hidden alone silently became "overflow-y: auto" as well,
              // with no overflow-y ever set), making this box an
              // accidental vertical scroll container — which caps how
              // far up the DOM tree _2k9Ys' own `position: sticky;
              // bottom: 0` (see globals.css) can resolve its own
              // containing block, breaking the "truly fixed" horizontal
              // scrollbar this box exists to support (see chartWrapRef's
              // own doc comment below). `clip` doesn't have this
              // coupling — confirmed directly via getComputedStyle that
              // overflow-x: clip here leaves overflow-y computed as
              // "visible", and a live sticky-position check confirmed
              // the scrollbar still resolves all the way up to the real
              // browser viewport with it applied, not trapped by this
              // box.
              //
              // Still needed on *some* axis, though — going back to no
              // overflow control at all (tried after `hidden` broke
              // sticky) was itself a real, confirmed regression: at Day
              // zoom, gantt-task-react's own internal chart width
              // (svgWidth, easily 10,000+px for a long date range) isn't
              // clipped by anything once this box has no overflow
              // control, so that width bleeds all the way out to
              // project-detail-view.tsx's own page-level scroll
              // container — which, by the same CSS coupling rule above,
              // silently computes its own overflow-x as non-visible too
              // (it only ever sets overflow-y-auto) and grows a second,
              // real horizontal scrollbar of its own once the content is
              // wide enough to need one. Confirmed directly: with no
              // overflow control here, that page-level container's own
              // scrollWidth (2121px) genuinely exceeded its clientWidth
              // (1166px) at Day zoom — exactly the "double horizontal
              // scrollbar" bug from earlier this session, just reopened
              // through a different path and easy to miss since the
              // *visible* fixed scrollbar (_2k9Ys) still looked and
              // worked fine on its own. overflow-x-clip closes this off
              // without reopening the sticky-trapping problem `hidden`
              // caused.
              className="isolate overflow-x-clip border border-zinc-200 bg-white"
            >
            <div
              ref={chartWrapRef}
              // No height/overflow classes at all anymore — this used
              // to be a fixed-height (h-220), internally-scrolling
              // (overflow-y-auto) box of its own. Confirmed directly
              // that box (not the filler rows padding a short project's
              // row *count* — that part's still here, see fillerTasks
              // above) was what broke the one thing that actually
              // mattered more: it made this element itself the nearest
              // scrolling ancestor for _2k9Ys' own `position: sticky;
              // bottom: 0`, capping the horizontal scrollbar to
              // sticking within *this fixed box's* own bottom edge —
              // reachable only once that edge was itself scrolled into
              // view, not truly "fixed" the way a page's own sticky
              // footer would be. Now this is a plain block, its own
              // height simply following its content's (real rows plus
              // however many filler ones top it up to a minimum) — a
              // short project still reads as "full," a long one just
              // keeps growing past that minimum exactly as before, and
              // either way the page scrolls through it with a properly
              // fixed scrollbar. The className is kept only because
              // several CSS rules in globals.css are scoped to it (the
              // visible-scrollbar-on-_2k9Ys styling, the sticky rule
              // itself, milestone-label hiding, the date-input
              // calendar-icon/active-state rules).
              className="gantt-task-react-root"
              style={{ "--gantt-successor-arrow": `url("#${successorArrowId}")` } as CSSProperties}
              // Month zoom hides the bars' own labels (see globals.css).
              data-zoom={view}
            >
              <svg aria-hidden="true" focusable="false" width="0" height="0" className="absolute">
                <defs>
                  <marker id={successorArrowId} viewBox="0 0 6 6" markerWidth="6" markerHeight="6" refX="4.5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
                    <path d="M1.5 1 4.5 3 1.5 5" fill="none" stroke="#71717a" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
              </svg>
              <div className="relative" onMouseDown={handleChartMouseDown} onMouseDownCapture={handleBarSelectionMouseDown}
                onClickCapture={event => {
                  if (event.target instanceof Element && event.target.closest("[data-gantt-row-id]") && (event.shiftKey || selectedBarIds.size > 0 || barJustDraggedRef.current)) {
                    event.preventDefault(); event.stopPropagation();
                  }
                }}>
                <WorkScheduleContext.Provider value={workSchedule}>
                <Gantt
                  tasks={chartTasks}
                  viewMode={VIEW_MODE[view]}
                  rowHeight={ROW_HEIGHT}
                  headerHeight={HEADER_HEIGHT}
                  listCellWidth={showTaskList ? `${visiblePanelWidth}px` : ""}
                  columnWidth={effectiveColumnWidth}
                  todayColor="rgba(252, 211, 77, 0.15)"
                  arrowColor="#71717a"
                  arrowIndent={12}
                  // Blue like the task list's milestone diamond and name
                  // (Tailwind's blue-600 / blue-700).
                  milestoneBackgroundColor="#155dfc"
                  milestoneBackgroundSelectedColor="#1447e6"
                  // A phase's summary bar: a slate bracket (Tailwind's
                  // slate-500 / slate-600). globals.css shows its saved
                  // rolled-up progress as a thin colored line inside it.
                  projectBackgroundColor="#62748e"
                  projectBackgroundSelectedColor="#45556c"
                  projectProgressColor="#ffffff"
                  projectProgressSelectedColor="#ffffff"
                  TooltipContent={GanttTooltipContent}
                  TaskListHeader={CustomTaskListHeader}
                  TaskListTable={CustomTaskListTable}
                  onDateChange={(task) => persistDrag(task)}
                  onClick={handleBarClick}
                  onExpanderClick={(task) => {
                    setCollapsedPhaseIds((prev) => {
                      const next = new Set(prev);
                      if (next.has(task.id)) next.delete(task.id);
                      else next.add(task.id);
                      return next;
                    });
                  }}
                />
                </WorkScheduleContext.Provider>
                {/* The whole task-list panel's own resize handle — see
                    handlePanelResizeMouseDown's own doc comment. Height
                    computed directly (header + one row per currently
                    visible row, filler rows included so it reaches the
                    same padded-out minimum height those give the rest
                    of the chart) rather than a percentage, since this
                    element's own containing block (the `relative` wrapper
                    just above) is auto-height, and percentage heights
                    don't resolve against an auto-height ancestor. */}
                <div
                  onMouseDown={handlePanelResizeMouseDown}
                  title="Drag to resize the task list"
                  className="absolute top-0 z-20 w-3 cursor-col-resize"
                  style={{
                    left: visiblePanelWidth - 6,
                    height:
                      HEADER_HEIGHT +
                      (visibleTasks.length + fillerTaskCount) * ROW_HEIGHT,
                  }}
                >
                  <div className="mx-auto h-full w-1 bg-zinc-300" />
                  {/* Grip indicator — a short, slightly darker pill
                      centered in the middle of the track, the common
                      "this is draggable" affordance for a thin resize
                      handle that could otherwise read as a plain
                      divider line. */}
                  <div className="pointer-events-none absolute top-1/2 left-1/2 h-8 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-zinc-400" />
                </div>
              </div>
            </div>
            </div>
        </div>
      </div>

      <Modal
        open={projectInsightsOpen}
        onClose={() => setProjectInsightsOpen(false)}
        title="AI Project Insights"
        icon={<AiSparklesIcon className="size-6 shrink-0 text-amber-300" />}
        bareIcon
        aiBorder
      >
        {projectInsightsOpen && <ProjectInsightsPanel
          key={projectId}
          projectId={projectId}
          onNavigate={destination => { setProjectInsightsOpen(false); onNavigateInsight(destination); }}
        />}
      </Modal>

      <Modal
        open={eventModal !== null}
        onClose={() => setEventModal(null)}
        title={eventModal?.event ? "Edit Event" : "Add Event"}
        menuItems={
          eventModal?.event
            ? [
                {
                  label: "Delete",
                  destructive: true,
                  onSelect: () => {
                    const event = eventModal.event!;
                    confirmAndDelete(
                      "event",
                      event.name,
                      () => deleteProjectEvent(event.id, projectId),
                      () => setEventModal(null)
                    );
                  },
                },
              ]
            : undefined
        }
      >
        {eventModal && (
          <ProjectEventModalContent
            projectId={projectId}
            date={eventModal.date}
            event={eventModal.event}
            onClose={() => setEventModal(null)}
          />
        )}
      </Modal>

      <WeightBreakdownModal
        projectId={projectId}
        categories={categoriesForDisplay}
        target={weightBreakdown}
        onTargetChange={setWeightBreakdown}
        onNavigateToCostEstimate={onNavigateToCostEstimate}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={
          pendingDelete?.kind === "selection"
            ? `Delete ${pendingDelete.name}?`
            : `Delete this ${pendingDelete?.kind ?? "item"}?`
        }
        message={
          pendingDelete?.kind === "phase"
            ? `"${pendingDelete.name}" and every task in it will be deleted, along with their progress. This can't be undone.`
            : pendingDelete?.kind === "task"
              ? `"${pendingDelete.name}" will be deleted, along with its progress. This can't be undone.`
              : pendingDelete?.kind === "selection"
                ? "Every ticked task will be deleted, along with its progress. This can't be undone."
                : `"${pendingDelete?.name ?? ""}" will be deleted. This can't be undone.`
        }
        pending={deleting}
        error={deleteError}
        onConfirm={runPendingDelete}
        onCancel={() => {
          if (deleting) return;
          setPendingDelete(null);
          setDeleteError(null);
        }}
      />

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title={categoryModal ? `Edit ${categoryModal.name}` : "Edit Phase"}
      >
        {categoryModal && (
          <CategoryForm
            projectId={projectId}
            projectCategories={categoriesForDisplay}
            category={{
              ...categoryModal,
              materialAssignments:
                categoriesForDisplay.find((c) => c.id === categoryModal.id)
                  ?.materialAssignments ?? [],
            }}
            siblingCategories={categoriesForDisplay
              .filter((c) => c.tasks.length === 0)
              .map((c) => ({
                id: c.id,
                name: c.name,
                predecessorCategoryId: c.predecessorCategoryId ?? null,
              }))}
            onViewMaterials={() => {
              setCategoryModal(null);
              onOpenMaterialBreakdown();
            }}
            onRequestDelete={() =>
              confirmAndDelete(
                "phase",
                categoryModal.name,
                () => queueEdit(() => deleteCategory(categoryModal.id, projectId, {}, new FormData())),
                () => setCategoryModal(null),
                { taskIds: [], categoryIds: [categoryModal.id] }
              )
            }
            onSuccess={() => setCategoryModal(null)}
            onSave={form => handleModalSave("category", categoryModal.id, categoryModal.name, form)}
          />
        )}
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title={taskModal ? `Edit ${taskModal.name}` : "Edit Task"}
      >
        {taskModal && (
          <SubtaskForm
            projectId={projectId}
            projectCategories={categoriesForDisplay}
            categoryId={taskModal.categoryId}
            task={taskModal}
            siblingTasks={
              categoriesForDisplay.find((c) => c.id === taskModal.categoryId)?.tasks ??
              []
            }
            onViewMaterials={() => {
              const viewedTaskId = taskModal.id;
              setTaskModal(null);
              onOpenMaterialBreakdown(viewedTaskId);
            }}
            onRequestDelete={() =>
              confirmAndDelete(
                "task",
                taskModal.name,
                () => queueEdit(() => deleteTask(taskModal.id, projectId, {}, new FormData())),
                () => setTaskModal(null),
                { taskIds: [taskModal.id], categoryIds: [] }
              )
            }
            onSuccess={() => setTaskModal(null)}
            onSave={form => handleModalSave("task", taskModal.id, taskModal.name, form)}
          />
        )}
      </Modal>

      <Modal
        open={assignWorkersModal !== null}
        onClose={() => setAssignWorkersModal(null)}
        title="Assign Workers"
      >
        {assignWorkersModal && assignWorkersModal.kind === "task" && (
          <AssignWorkersModalContent
            rowName={assignWorkersModal.name}
            startDate={assignWorkersModal.start}
            endDate={assignWorkersModal.end}
            workers={workers}
            assignments={workerAssignments}
            groups={memberGroups}
            defaultWorkerIds={defaultWorkerIds}
            current={{ kind: "task", id: assignWorkersModal.taskId }}
            assignedWorkerIds={
              taskWorkerAssignments[assignWorkersModal.taskId] ?? []
            }
            onSave={(workerIds) =>
              setTaskWorkers(assignWorkersModal.taskId, projectId, workerIds)
            }
            onClose={() => setAssignWorkersModal(null)}
          />
        )}
        {assignWorkersModal && assignWorkersModal.kind === "category" && (
          <AssignWorkersModalContent
            rowName={assignWorkersModal.name}
            startDate={assignWorkersModal.start}
            endDate={assignWorkersModal.end}
            workers={workers}
            assignments={workerAssignments}
            groups={memberGroups}
            defaultWorkerIds={defaultWorkerIds}
            current={{ kind: "category", id: assignWorkersModal.categoryId }}
            assignedWorkerIds={
              categoryWorkerAssignments[assignWorkersModal.categoryId] ?? []
            }
            onSave={(workerIds) =>
              setCategoryWorkers(
                assignWorkersModal.categoryId,
                projectId,
                workerIds
              )
            }
            onClose={() => setAssignWorkersModal(null)}
          />
        )}
      </Modal>

      <Modal open={equipmentTarget !== null} onClose={() => { if (!equipmentSaving) setEquipmentTarget(null); }} title={equipmentTarget ? `Assign Equipment — ${equipmentTarget.name}` : "Assign Equipment"}>
        {equipmentTarget && <EquipmentTrackingPanel key={equipmentTarget.key} projectId={projectId} itemKey={equipmentTarget.key} initialData={equipmentTracking} onChange={setEquipmentTracking} onClose={() => setEquipmentTarget(null)} onPendingChange={setEquipmentSaving} />}
      </Modal>
      <ProgressTrackingModal
        readOnly={!canEdit || progressModal?.readOnly === true}
        target={progressModal}
        projectId={projectId}
        projectName={projectName}
        materialStocks={materialStocks}
        categories={categoriesForDisplay}
        workingDays={workingDays}
        holidays={holidays}
        taskProgressToday={taskProgressToday}
        categoryProgressToday={categoryProgressToday}
        overrideHistory={overrideHistory}
        workers={workers}
        taskWorkerAssignments={taskWorkerAssignments}
        categoryWorkerAssignments={categoryWorkerAssignments}
        onClose={() => setProgressModal(null)}
      />
    </div>
  );
}
