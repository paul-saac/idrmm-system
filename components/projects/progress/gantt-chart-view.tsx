"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import {
  ChevronsDown,
  ChevronsUp,
  ChevronDown,
  ChevronRight,
  Diamond,
  Pencil,
  Plus,
} from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { AddPhaseForm } from "@/components/projects/progress/add-phase-form";
import { SubtaskForm } from "@/components/projects/progress/subtask-form";
import { updateTaskSchedule, setPredecessor } from "@/lib/cost-estimate/actions";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
}

function formatDateCell(value: Date) {
  return value.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function daysBetween(start: Date, end: Date) {
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1);
}

function phaseRowId(categoryId: number) {
  return `phase-${categoryId}`;
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

// Mirrors gantt-task-react's own default hover tooltip (StandardTooltipContent)
// pixel-for-pixel — same date format, same CSS-module classes (_3T42e/_29NTg,
// confirmed directly by reading the compiled bundle, the same technique
// already used for the barLabel classes referenced in globals.css) — with
// one deliberate change: Progress always renders, even at 0%. The
// library's own version guards it behind `!!task.progress`, so a task
// that hasn't started yet silently drops the line instead of showing
// "Progress: 0%".
function GanttTooltipContent({
  task,
  fontSize,
  fontFamily,
}: {
  task: GanttTask;
  fontSize: string;
  fontFamily: string;
}) {
  const durationDays = Math.floor(
    (task.end.getTime() - task.start.getTime()) / 86_400_000
  );
  const headingSize = (parseInt(fontSize, 10) || 14) + 6;

  return (
    <div className="_3T42e" style={{ fontSize, fontFamily }}>
      <b style={{ fontSize: `${headingSize}px` }}>
        {task.name}: {task.start.getDate()}-{task.start.getMonth() + 1}-
        {task.start.getFullYear()} - {task.end.getDate()}-
        {task.end.getMonth() + 1}-{task.end.getFullYear()}
      </b>
      {durationDays !== 0 && (
        <p className="_29NTg">Duration: {durationDays} day(s)</p>
      )}
      <p className="_29NTg">Progress: {Math.round(task.progress)}%</p>
    </div>
  );
}

// gantt-task-react's ViewMode enum has no "Quarter" granularity (it has
// Hour/QuarterDay/HalfDay/Day/Week/Month/Year instead — the "Quarter"
// options are sub-day zoom levels, not a 3-month view) — one real
// capability gap versus the previous SVAR build, not something this
// component can work around.
type TimelineView = "day" | "week" | "month" | "year";

const VIEW_MODE: Record<TimelineView, ViewMode> = {
  day: ViewMode.Day,
  week: ViewMode.Week,
  month: ViewMode.Month,
  year: ViewMode.Year,
};

const VIEW_LABELS: Record<TimelineView, string> = {
  day: "Day",
  week: "Week",
  month: "Month",
  year: "Year",
};

// Baseline column width per zoom level — the actual width used is
// whichever is wider between this and "however much it takes to fill
// the chart's available width" (see effectiveColumnWidth below), so a
// short project never leaves a dead strip of blank space to the right
// of its bars, and a long one still falls back to a sane, readable
// minimum and scrolls horizontally instead of over-compressing.
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
const RESIZABLE_COLUMN_IDS = ["text", "start", "end", "duration"] as const;
type ResizableColumnId = (typeof RESIZABLE_COLUMN_IDS)[number];

// Start/end are wider than a plain date label needs — the native
// <input type="date"> that renders in those columns (see
// CustomTaskListTable) wants more room for its "MM/DD/YYYY" segments
// plus the calendar-icon affordance than static text like "Jan 5" did.
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnId, number> = {
  text: 176,
  start: 108,
  end: 108,
  duration: 60,
};

const MIN_COLUMN_WIDTH: Record<ResizableColumnId, number> = {
  text: 100,
  start: 84,
  end: 84,
  duration: 40,
};

// Wide enough for the busiest case: a phase row's add-task / edit /
// delete trio. Task rows only ever show two of the three (no add-task),
// so they sit with a little extra breathing room in the same column.
const ACTIONS_COLUMN_WIDTH = 88;

const COLUMN_LABEL: Record<ResizableColumnId, string> = {
  text: "Task",
  start: "Start",
  end: "End",
  duration: "Days",
};

const RIGHT_ALIGNED_COLUMNS = new Set<ResizableColumnId>(["duration"]);

const TOOLBAR_BUTTON_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900";
const TOOLBAR_BUTTON_ACTIVE_CLASS =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition";

const ROW_HEIGHT = 34;
const HEADER_HEIGHT = 44;
// gantt-task-react's own taskHeight = rowHeight * barFill / 100 (barFill
// defaults to 60, not overridden by this app's own <Gantt> below) —
// needed to place a milestone's connector handles on its actual
// diamond, which is sized off taskHeight, not off any date range (see
// convertToMilestone in the compiled bundle).
const BAR_HEIGHT = ROW_HEIGHT * 0.6;
// gantt-task-react widens any "task"-type bar (not "project") narrower
// than 2*handleWidth so its own resize handles stay grabbable —
// handleWidth defaults to 8, not overridden here, so this is that same
// 16px floor. Confirmed directly: at Year zoom, a short task's true
// date-based width comes out well under this, and skipping the clamp
// left this file's connector handles several pixels off the bar's own
// actual (wider) rendered edge.
const MIN_TASK_BAR_WIDTH = 16;

// The predecessor-connector feature (drag from one bar's own end-point
// to another bar within the same phase, to link them) needs each
// visible task/milestone bar's real position. Earlier this was measured
// off the rendered DOM (a MutationObserver watching gantt-task-react's
// own SVG output) — abandoned after three rounds of bugs (stale
// positions after a zoom change, an infinite render loop, then
// lag/flicker during any bar drag) all traceable to the same root
// cause: DOM measurement can only ever be a step behind whatever
// gantt-task-react is doing internally.
//
// This instead reimplements the library's own date-to-pixel math
// directly (addToDate/startOfDate/getMonday/computeChartDateRange/
// seedGanttDates/computeTaskX below), transcribed from the compiled
// bundle (node_modules/gantt-task-react/dist/index.js), restricted to
// the 4 ViewModes this app actually uses (Day/Week/Month/Year — the
// Hour/QuarterDay/HalfDay branches are dead code here). Bar positions
// become a plain, synchronous function of `tasks`/`view`/
// `effectiveColumnWidth` — recomputed by React on every render exactly
// like the Days column already was, with no DOM to measure, no
// observer, and nothing that can ever be stale.
type DateScale = "year" | "month" | "day";

function addToDate(date: Date, quantity: number, scale: DateScale): Date {
  return new Date(
    date.getFullYear() + (scale === "year" ? quantity : 0),
    date.getMonth() + (scale === "month" ? quantity : 0),
    date.getDate() + (scale === "day" ? quantity : 0),
    date.getHours(),
    date.getMinutes(),
    date.getSeconds(),
    date.getMilliseconds()
  );
}

// Restricted to scale in {day, month, year} — the only values this
// file ever passes in — so this skips the library's own generic
// "scores" table and just special-cases the two coarser levels
// directly: startOfDate(d, "day") keeps year/month/date and zeroes the
// time; "month" also resets date to 1; "year" also resets month to 0.
function startOfDate(date: Date, scale: DateScale): Date {
  return new Date(
    date.getFullYear(),
    scale === "year" ? 0 : date.getMonth(),
    scale === "year" || scale === "month" ? 1 : date.getDate(),
    0,
    0,
    0,
    0
  );
}

// Mutates and returns its own argument (matches the library exactly) —
// every call site below only ever passes it an already-freshly-`new
// Date`'d value, so this never touches a task's own start/end Date.
function getMonday(date: Date): Date {
  const day = date.getDay();
  const diff = date.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(date.setDate(diff));
}

// The same padded start/end range gantt-task-react computes for itself
// to decide how many header columns to draw — this has to match
// exactly, since a one-column difference here would throw every bar's
// computed x position off by a full columnWidth.
function computeChartDateRange(
  rangeTasks: { start: Date; end: Date }[],
  view: TimelineView
): [Date, Date] {
  let newStartDate = rangeTasks[0].start;
  let newEndDate = rangeTasks[0].start;
  for (const t of rangeTasks) {
    if (t.start < newStartDate) newStartDate = t.start;
    if (t.end > newEndDate) newEndDate = t.end;
  }

  switch (view) {
    case "year":
      newStartDate = addToDate(newStartDate, -1, "year");
      newStartDate = startOfDate(newStartDate, "year");
      newEndDate = addToDate(newEndDate, 1, "year");
      newEndDate = startOfDate(newEndDate, "year");
      break;
    case "month":
      newStartDate = addToDate(newStartDate, -1, "month");
      newStartDate = startOfDate(newStartDate, "month");
      newEndDate = addToDate(newEndDate, 1, "year");
      newEndDate = startOfDate(newEndDate, "year");
      break;
    case "week":
      newStartDate = startOfDate(newStartDate, "day");
      newStartDate = addToDate(getMonday(newStartDate), -7, "day");
      newEndDate = startOfDate(newEndDate, "day");
      newEndDate = addToDate(newEndDate, 1.5, "month");
      break;
    case "day":
      newStartDate = startOfDate(newStartDate, "day");
      newStartDate = addToDate(newStartDate, -1, "day");
      newEndDate = startOfDate(newEndDate, "day");
      newEndDate = addToDate(newEndDate, 19, "day");
      break;
  }
  return [newStartDate, newEndDate];
}

// The tick-date array the chart's header columns are drawn at —
// computeTaskX below finds where a given date falls between two
// consecutive ticks.
function seedGanttDates(startDate: Date, endDate: Date, view: TimelineView): Date[] {
  let currentDate = new Date(startDate);
  const dates = [currentDate];
  while (currentDate < endDate) {
    switch (view) {
      case "year":
        currentDate = addToDate(currentDate, 1, "year");
        break;
      case "month":
        currentDate = addToDate(currentDate, 1, "month");
        break;
      case "week":
        currentDate = addToDate(currentDate, 7, "day");
        break;
      case "day":
        currentDate = addToDate(currentDate, 1, "day");
        break;
    }
    dates.push(currentDate);
  }
  return dates;
}

// gantt-task-react's own taskXCoordinate, verbatim: locates xDate
// between the two ticks that bracket it and interpolates linearly
// across that one column's width.
function computeTaskX(xDate: Date, dates: Date[], columnWidth: number): number {
  const index = dates.findIndex((d) => d.getTime() >= xDate.getTime()) - 1;
  const remainderMillis = xDate.getTime() - dates[index].getTime();
  const percentOfInterval =
    remainderMillis / (dates[index + 1].getTime() - dates[index].getTime());
  return index * columnWidth + percentOfInterval * columnWidth;
}

type BarPosition = {
  taskId: string;
  categoryId: number;
  // Both already include the task-list column's own width (when
  // shown) and the header row's own height, so these are ready to use
  // as-is as `left`/`top` for a `position: absolute` element inside
  // the same positioned container `<Gantt>` itself renders into — no
  // further offsetting needed at the call site.
  left: number;
  right: number;
  centerY: number;
  // Only actually used for a milestone row's own name label — see the
  // milestone-label overlay below. gantt-task-react's own per-row
  // <text> (rendered by its TaskItem wrapper for every row type, not
  // just Milestone — confirmed directly by reading the compiled
  // bundle) is unreliable for a milestone specifically: it measures its
  // own rendered width once, right after mount, to decide whether to
  // draw itself inside the bar or floated outside it, and for a
  // milestone's narrow ~20px diamond that measurement can race the
  // SVG's own layout and get stuck showing (and flickering) directly on
  // top of the diamond — see the CSS rule in globals.css that now hides
  // gantt-task-react's own text for a milestone row unconditionally.
  // This label is this component's own, deliberately independent,
  // replacement. Carried on every row here (not just milestones) simply
  // because it's already sitting right there in the same loop that
  // computes everything else.
  name: string;
  isMilestone: boolean;
};

type ConnectorDragState = {
  sourceTaskId: string;
  originX: number;
  originY: number;
  pointerX: number;
  pointerY: number;
};

// Small visible gap between a bar's own edge and its connector handle
// (not touching it), and the handle's own diameter — both drive the
// handle's `left` position below and the extra margin hitTest() gives
// hovering so moving from the bar onto its handle doesn't hide it.
const CONNECTOR_HANDLE_SIZE = 10;
const CONNECTOR_HANDLE_GAP = 4;
const CONNECTOR_HOVER_MARGIN = 14;

// No per-task `styles` override and no barCornerRadius prop below —
// both deliberately left at the library's own defaults (barBackgroundColor
// #b8c2cc / barProgressColor #a3a3ff for tasks, projectBackgroundColor
// #fac465 / projectProgressColor #7db59a for phases, milestoneBackgroundColor
// #f1c453, barCornerRadius 3 — confirmed directly by reading the compiled
// bundle's own default props) so the chart matches gantt-task-react's own
// reference look exactly instead of drifting from it.
//
// A larger custom barCornerRadius (10, tried earlier) broke visibly on
// short-duration bars: a radius bigger than half a narrow bar's own
// pixel width pinches the rounded-rect into a lozenge/tent shape rather
// than a clean pill — confirmed directly on a handful of 1-2 day tasks.
// The library's own default of 3 stays proportionate at any bar width.

type ScheduleOverride = { start: string; end: string };

const EMPTY_SCHEDULE_OVERRIDES: ReadonlyMap<number, ScheduleOverride> = new Map();

// Optimistic local override for a task's own schedule, set the instant a
// drag (or an inline Start/End edit) finishes — see persistTaskDates in
// GanttChartView below. Without this, `tasks` only reflects the new
// dates once router.refresh() pulls fresh `categories`/`progress` props
// back down from the server, and gantt-task-react itself resets its own
// in-progress-drag visual state to "" the moment the mouse comes up
// (confirmed directly by reading the compiled bundle: setGanttEvent
// clears synchronously on mouseup, *before* onDateChange's promise even
// starts) — so for however long that round trip takes, the bar has
// nowhere correct to fall back to and snaps to its *pre-drag* position,
// then jumps again once the server round trip lands. Setting an
// override here closes that gap: `tasks` (and this component's own
// connector-handle positions, computed from it) reflect the dragged-to
// dates immediately, synchronously, with no round trip to wait for.
//
// Rather than reconciling field-by-field once fresh props arrive (tried
// first — needed either a useEffect calling setState directly in its
// body, or a render-phase "adjust state when a prop changes" setState
// call; the React Compiler refused to preserve this component's other
// memoized values, e.g. timelineExtent/visibleTasks, with either one in
// place, confirmed directly), every override is tagged with the exact
// `categories` array reference that was live when it was set, and
// **all** overrides expire together the instant that reference changes
// — which only happens when a fresh router.refresh() actually lands. A
// persist that succeeded is, by then, already reflected in the new
// props, so expiring the override right as it stops being read from
// prop data is invisible; nothing to reconcile field-by-field, and no
// setState call anywhere outside an event handler.
function usePendingScheduleOverrides(categories: CostCategory[]) {
  const [state, setState] = useState<{
    categoriesAtSet: CostCategory[];
    overrides: Map<number, ScheduleOverride>;
  } | null>(null);

  const overrides =
    state && state.categoriesAtSet === categories
      ? state.overrides
      : EMPTY_SCHEDULE_OVERRIDES;

  function setOverride(taskId: number, override: ScheduleOverride) {
    setState((prev) => {
      const base =
        prev && prev.categoriesAtSet === categories ? prev.overrides : new Map();
      const next = new Map(base);
      next.set(taskId, override);
      return { categoriesAtSet: categories, overrides: next };
    });
  }

  function clearOverride(taskId: number) {
    setState((prev) => {
      if (!prev || prev.categoriesAtSet !== categories || !prev.overrides.has(taskId)) {
        return prev;
      }
      const next = new Map(prev.overrides);
      next.delete(taskId);
      return { categoriesAtSet: categories, overrides: next };
    });
  }

  return [overrides, setOverride, clearOverride] as const;
}

/**
 * The Schedule tab: the project's planning workspace, built on
 * `gantt-task-react` (MIT-licensed, dependency-free). Third Gantt
 * engine tried this session — after SVAR (kept, then reverted back to
 * after a DHTMLX detour) — chosen this time specifically for its
 * TaskListHeader/TaskListTable props: unlike SVAR's string-based column
 * config or DHTMLX's HTML-string cell templates, these are plain React
 * components we supply outright, so the Task/Start/End/Days/Actions
 * grid below is real JSX — including mounting the actual Pencil-edit
 * buttons directly in a cell, which DHTMLX's HTML-template cells
 * couldn't do at all. Delete itself isn't a separate Actions-column
 * icon here (unlike the Cost Estimate Breakdown's own table) — it's a
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
 * Each phase (category) is a `type: "project"` row. Auto-rollup of a
 * project row's own start/end from its children is not something this
 * library computes for you (its `start`/`end` fields are required, not
 * derived) — same as the SVAR build, this component still computes each
 * phase's aggregate start/end/progress itself from its tasks.
 */
export function GanttChartView({
  projectId,
  categories,
  progress,
  projectStartDate,
  toolbarSlot,
}: {
  projectId: number;
  categories: CostCategory[];
  progress: ProjectProgress;
  projectStartDate: string | null;
  /** DOM node (rendered by the parent's sub-tabs row) this view's own
   * Day/Week/Month/Year + Expand all/Collapse all/Hide Task List
   * toolbar portals into — see SubTabsRow in project-detail-view.tsx. */
  toolbarSlot: HTMLDivElement | null;
}) {
  const router = useRouter();
  // Month is the default zoom: unlike Week, its column labels are plain
  // month names with no "W##" numbering that could read as resetting
  // each time the visible range crosses a year boundary (an ISO-8601
  // week-numbering quirk, not a bug, but confusing at a glance for a
  // non-technical viewer). Week is still one click away for anyone who
  // wants the finer granularity.
  const [view, setView] = useState<TimelineView>("month");
  const [categoryModal, setCategoryModal] = useState<
    | { mode: "add" }
    | { mode: "edit"; category: { id: number; name: string } }
    | null
  >(null);
  const [taskModal, setTaskModal] = useState<
    | { mode: "add"; defaultCategoryId?: number }
    | { mode: "edit"; task: CostTask }
    | null
  >(null);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(
    new Set()
  );
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [columnWidths, setColumnWidths] =
    useState<Record<ResizableColumnId, number>>(DEFAULT_COLUMN_WIDTHS);
  // Collapsing the grid to just the timeline is a documented
  // gantt-task-react pattern: an empty `listCellWidth` hides it
  // entirely (not a boolean prop) — useful for a wide project where the
  // Task/Start/End/etc columns aren't needed and the timeline could use
  // the room.
  const [showTaskList, setShowTaskList] = useState(true);

  const percentCompleteByTaskId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of progress.categories) {
      for (const task of category.tasks) {
        map.set(task.id, task.percentComplete);
      }
    }
    return map;
  }, [progress]);

  const percentCompleteByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of progress.categories) {
      map.set(category.id, category.percentComplete);
    }
    return map;
  }, [progress]);

  const fallbackStart = projectStartDate ? toDate(projectStartDate) : new Date();
  const fallbackEnd = new Date(fallbackStart.getTime() + 7 * 86_400_000);

  function resolvedDates(task: { plannedStartDate: string | null; plannedEndDate: string | null }) {
    return {
      start: task.plannedStartDate ? toDate(task.plannedStartDate) : fallbackStart,
      end: task.plannedEndDate ? toDate(task.plannedEndDate) : fallbackEnd,
    };
  }

  // Keyed by the same string ids used in the `tasks` array below, so the
  // custom TaskListTable can hand a clicked row's full record to the
  // Edit modal / delete button without needing anywhere to stash extra
  // fields on a GanttTask object (its type has no room for custom
  // properties, unlike SVAR's ITask or DHTMLX's Task).
  const taskById = useMemo(() => {
    const map = new Map<string, CostTask>();
    for (const category of categories) {
      for (const task of category.tasks) {
        map.set(String(task.id), task);
      }
    }
    return map;
  }, [categories]);

  const categoryById = useMemo(() => {
    const map = new Map<string, { id: number; name: string }>();
    for (const category of categories) {
      map.set(phaseRowId(category.id), { id: category.id, name: category.name });
    }
    return map;
  }, [categories]);

  const tasks: GanttTask[] = useMemo(() => {
    const result: GanttTask[] = [];
    for (const category of categories) {
      // A phase with no task items yet still gets its own row (with a
      // placeholder date range) rather than being skipped entirely —
      // otherwise there'd be nowhere in the Gantt itself to click "+"
      // and add that phase's very first task.
      const childDates =
        category.tasks.length > 0
          ? category.tasks.map(resolvedDates)
          : [{ start: fallbackStart, end: fallbackEnd }];

      result.push({
        id: phaseRowId(category.id),
        type: "project",
        name: category.name,
        start: new Date(Math.min(...childDates.map((d) => d.start.getTime()))),
        end: new Date(Math.max(...childDates.map((d) => d.end.getTime()))),
        progress: percentCompleteByCategoryId.get(category.id) ?? 0,
        hideChildren: collapsedPhaseIds.has(phaseRowId(category.id)),
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
          type: task.isMilestone ? "milestone" : "task",
          name: task.name,
          start: task.isMilestone ? milestoneDate : childDates[i].start,
          end: task.isMilestone ? milestoneDate : childDates[i].end,
          progress: percentCompleteByTaskId.get(task.id) ?? 0,
          project: phaseRowId(category.id),
          dependencies: task.predecessorTaskId
            ? [String(task.predecessorTaskId)]
            : undefined,
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    categories,
    percentCompleteByCategoryId,
    percentCompleteByTaskId,
    collapsedPhaseIds,
  ]);

  const [pendingScheduleOverrides, setScheduleOverride, clearScheduleOverride] =
    usePendingScheduleOverrides(categories);

  // Applies any pending optimistic overrides (see usePendingScheduleOverrides'
  // own doc comment) on top of the otherwise-unaware `tasks` above — kept
  // as a separate pass, rather than reading pendingScheduleOverrides
  // inside `tasks` itself, purely to satisfy the React Compiler: with the
  // override hook's own useState called any earlier than this (in
  // particular, anywhere before `tasks`'s own useMemo), it silently gave
  // up preserving memoization for timelineExtent/visibleTasks below,
  // confirmed directly by bisecting hook-call position. Phase ("project")
  // rows are deliberately left untouched — they're not directly
  // draggable (see this component's own doc comment below), so no
  // override is ever set for one; their own start/end stays a rollup of
  // their children's *persisted* dates until the real refresh lands,
  // which only affects how soon a phase bar's own edges visually catch
  // up, not the flicker this was written to fix.
  const effectiveTasks: GanttTask[] = useMemo(() => {
    if (pendingScheduleOverrides.size === 0) return tasks;
    return tasks.map((row) => {
      if (row.type === "project") return row;
      const override = pendingScheduleOverrides.get(Number(row.id));
      if (!override) return row;
      return { ...row, start: toDate(override.start), end: toDate(override.end) };
    });
  }, [tasks, pendingScheduleOverrides]);

  const hasAnyCategory = categories.length > 0;

  const totalColumnsWidth =
    RESIZABLE_COLUMN_IDS.reduce((sum, id) => sum + columnWidths[id], 0) +
    ACTIONS_COLUMN_WIDTH;

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
  const chartWrapRef = useRef<HTMLDivElement>(null);
  // Wraps *only* <Gantt>'s own rendered output. The connector-handle/
  // line overlay below renders as a `position: absolute` sibling
  // inside this same element (given `position: relative`), so it
  // scrolls in lockstep with the chart's own bars for free — no scroll
  // listener needed, unlike the old DOM-measurement version. Also the
  // reference point `getBoundingClientRect()` is read against for
  // converting a live mouse event's viewport coordinates into this
  // same local coordinate space (see handleConnectorDragStart /
  // handleChartMouseMove below).
  const ganttRootRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    const el = chartWrapRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      setContainerWidth(entries[0].contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveColumnWidth = useMemo(() => {
    const base = BASE_COLUMN_WIDTH[view];
    if (!timelineExtent || containerWidth === 0) return base;
    const chartAreaWidth =
      containerWidth - (showTaskList ? totalColumnsWidth : 0);
    if (chartAreaWidth <= 0) return base;
    const unitCount = estimateColumnCount(
      view,
      timelineExtent.min,
      timelineExtent.max
    );
    return Math.max(base, Math.floor(chartAreaWidth / unitCount));
  }, [view, containerWidth, timelineExtent, showTaskList, totalColumnsWidth]);

  // Mirrors gantt-task-react's own removeHiddenTasks: a collapsed
  // phase's own row still counts toward row height/index (it's still
  // drawn), but its children are skipped entirely — both for computing
  // the chart's date range below (collapsing a phase can shrink the
  // visible date span) and for each remaining row's own index (see
  // taskYCoordinate's derivation in the barPositions memo below).
  const visibleTasks = useMemo(
    () =>
      effectiveTasks.filter(
        (row) => row.type === "project" || !collapsedPhaseIds.has(row.project ?? "")
      ),
    [effectiveTasks, collapsedPhaseIds]
  );

  // Every visible task/milestone bar's position, computed directly from
  // task dates + the chart's own column width — see the long comment
  // above BarPosition for why this replaced DOM measurement. A plain
  // useMemo means this is exactly as "live" as the Days column: it
  // recomputes synchronously whenever the inputs it actually depends on
  // change, nothing more, nothing stale.
  const barPositions = useMemo<BarPosition[]>(() => {
    if (visibleTasks.length === 0) return [];
    const [rangeStart, rangeEnd] = computeChartDateRange(visibleTasks, view);
    const dates = seedGanttDates(rangeStart, rangeEnd, view);
    const xOffset = showTaskList ? totalColumnsWidth : 0;

    const positions: BarPosition[] = [];
    visibleTasks.forEach((row, index) => {
      if (row.type === "project") return; // no connector on phase rows
      const task = taskById.get(row.id);
      if (!task) return;

      const x1 = xOffset + computeTaskX(row.start, dates, effectiveColumnWidth);
      let left: number;
      let right: number;
      if (row.type === "milestone") {
        // A fixed-size diamond centered on its one date, not a
        // date-range-based bar — see convertToMilestone above.
        left = x1 - BAR_HEIGHT / 2;
        right = x1 + BAR_HEIGHT / 2;
      } else {
        let x2 = xOffset + computeTaskX(row.end, dates, effectiveColumnWidth);
        if (x2 - x1 < MIN_TASK_BAR_WIDTH) x2 = x1 + MIN_TASK_BAR_WIDTH;
        left = Math.min(x1, x2);
        right = Math.max(x1, x2);
      }

      // The taskHeight terms in gantt-task-react's own taskYCoordinate
      // cancel out for a bar's vertical *center* regardless of barFill,
      // leaving just this — see the derivation in the connector-handle
      // research this was ported from.
      const centerY = HEADER_HEIGHT + index * ROW_HEIGHT + ROW_HEIGHT / 2;
      positions.push({
        taskId: row.id,
        categoryId: task.categoryId,
        left,
        right,
        centerY,
        name: row.name,
        isMilestone: row.type === "milestone",
      });
    });
    return positions;
  }, [visibleTasks, view, effectiveColumnWidth, showTaskList, totalColumnsWidth, taskById]);

  // Only the bar currently under the cursor shows its handles — see
  // handleChartMouseMove below. A plain hit-test against the same
  // barPositions numbers used to draw everything else, not a second
  // DOM-based hover mechanism.
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [connectorDragState, setConnectorDragState] =
    useState<ConnectorDragState | null>(null);
  const connectorDragStateRef = useRef<ConnectorDragState | null>(null);
  // Where the dashed line/pointer-dot's own live position is written
  // to directly on every mousemove during a connector drag, bypassing
  // React state entirely — see handleConnectorDragStart's own doc
  // comment for why. connectorDragState (above) still drives the
  // *origin* endpoint (fixed for the whole drag) and mounts/unmounts
  // this SVG overlay at drag start/end, just not this hot path.
  const connectorLineRef = useRef<SVGLineElement>(null);
  const connectorPointerRef = useRef<SVGCircleElement>(null);
  // True for the duration of a *native* gantt-task-react bar drag
  // (move/resize/progress) — see handleChartMouseDown below. While
  // true, hover tracking is suppressed entirely: barPositions can't
  // track the dragged bar's own live, mid-drag position (that only
  // exists inside gantt-task-react's own internal state, which this
  // component has no access to — onDateChange fires once, on release,
  // not per frame), so a handle left showing during the drag would
  // visibly lag behind the bar it's supposed to belong to. A ref, not
  // state: read only from inside event handlers below, which don't
  // need a re-render to see the latest value.
  const barDragActiveRef = useRef(false);
  // Same flag, mirrored into actual state — the milestone label below
  // (unlike the hover-gated connector handles) is drawn unconditionally,
  // so hiding one during a drag needs an actual re-render, not just a
  // ref read some other state change happens to trigger. Same root
  // cause as the handles' own staleness: the label is this component's
  // own overlay, positioned from barPositions (which only updates once
  // the drag ends and settles), while the diamond itself is
  // gantt-task-react's own SVG, moving live all through the drag.
  const [isBarDragging, setIsBarDragging] = useState(false);

  function hitTestBar(clientX: number, clientY: number) {
    const root = ganttRootRef.current;
    if (!root) return null;
    const rect = root.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return (
      barPositions.find(
        (pos) =>
          x >= pos.left - CONNECTOR_HOVER_MARGIN &&
          x <= pos.right + CONNECTOR_HOVER_MARGIN &&
          Math.abs(y - pos.centerY) <= ROW_HEIGHT / 2
      ) ?? null
    );
  }

  function handleChartMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    // While a connector is actively being dragged, its own source bar
    // is kept visible explicitly (see handleConnectorDragStart) rather
    // than recomputed from cursor position on every move — the cursor
    // is usually nowhere near the source bar by then. Same idea for an
    // in-progress native bar drag — see barDragActiveRef above.
    if (connectorDragStateRef.current || barDragActiveRef.current) return;
    const hit = hitTestBar(e.clientX, e.clientY);
    setHoveredTaskId((prev) => {
      const next = hit ? hit.taskId : null;
      return next === prev ? prev : next;
    });
  }

  function handleChartMouseLeave() {
    if (connectorDragStateRef.current || barDragActiveRef.current) return;
    setHoveredTaskId(null);
  }

  // Detects a native gantt-task-react drag starting (move, resize, or
  // progress) so hover tracking can step aside for its duration — see
  // barDragActiveRef above. Every such interaction happens on the
  // chart's own <svg> content; this app's own connector handles are
  // plain HTML <button>s that stopPropagation() their own mousedown, so
  // they never reach this handler, and neither does anything in the
  // task-list panel (also plain HTML, not SVG).
  function handleChartMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.target instanceof Element) || !e.target.closest("svg")) return;
    barDragActiveRef.current = true;
    setIsBarDragging(true);
    setHoveredTaskId(null);

    function onUp(ev: MouseEvent) {
      window.removeEventListener("mouseup", onUp);
      barDragActiveRef.current = false;
      setIsBarDragging(false);
      // Re-evaluate immediately against wherever the cursor actually
      // is now, rather than waiting for the next physical mouse
      // twitch — by this point persistTaskDates has already set this
      // bar's optimistic override (see its own doc comment), so
      // barPositions already reflects the just-dropped position.
      const hit = hitTestBar(ev.clientX, ev.clientY);
      setHoveredTaskId(hit ? hit.taskId : null);
    }
    window.addEventListener("mouseup", onUp);
  }

  // Mousedown on one of a bar's own two connector handles — hand-built,
  // same mousedown/mousemove/mouseup pattern used throughout this file.
  // Either end works identically as a drag source (this app stores a
  // single undifferentiated predecessor link, not a finish-to-start /
  // start-to-start distinction, so which edge you grab only changes
  // where the dashed line starts from, not what dropping it does).
  // Dropping on another bar within the *same phase* sets that bar's
  // task as this one's successor (predecessor_task_id = the dragged-
  // from task). Dropping anywhere else (a different phase, empty
  // space, the bar it started on) is simply a no-op — nothing is
  // persisted unless the drop genuinely lands on a valid target.
  //
  // The live dashed-line tracking deliberately never touches React
  // state: the first version called setConnectorDragState (a full
  // re-render of this whole component) *and* re-read
  // getBoundingClientRect() (a synchronous layout flush) on every
  // single mousemove — plainly-visible lag, confirmed directly, since a
  // mouse can report well past 60 times a second and each one was
  // paying for both. ganttRootRef's own box never moves mid-drag, so
  // `rect` below is read exactly once, at mousedown; and the pointer's
  // own endpoint is written straight to the SVG <line>/<circle>
  // elements' attributes via connectorLineRef/connectorPointerRef (see
  // their own doc comment), coalesced through requestAnimationFrame so
  // a burst of mousemoves between two frames costs one DOM write, not
  // one each. connectorDragState (React state) only mounts the SVG
  // overlay at drag start and unmounts it at drag end — two renders
  // total per drag, not one per pixel moved.
  function handleConnectorDragStart(pos: BarPosition, edge: "left" | "right") {
    return (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const rect = ganttRootRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Captured as plain numbers (not `rect` itself) so the closures
      // below stay typed as definitely-defined — TS can't carry the
      // `if (!rect) return` narrowing above into a function that only
      // runs later, on a future event.
      const originLeft = rect.left;
      const originTop = rect.top;

      const initial: ConnectorDragState = {
        sourceTaskId: pos.taskId,
        originX: edge === "left" ? pos.left : pos.right,
        originY: pos.centerY,
        pointerX: e.clientX - originLeft,
        pointerY: e.clientY - originTop,
      };
      connectorDragStateRef.current = initial;
      setConnectorDragState(initial);
      // Keeps this bar's own handles visible for the whole drag,
      // regardless of where the cursor wanders — handleChartMouseMove
      // steps aside (see its own guard) while a drag is in progress.
      setHoveredTaskId(pos.taskId);

      let latestX = initial.pointerX;
      let latestY = initial.pointerY;
      let rafId: number | null = null;

      function paint() {
        rafId = null;
        connectorLineRef.current?.setAttribute("x2", String(latestX));
        connectorLineRef.current?.setAttribute("y2", String(latestY));
        connectorPointerRef.current?.setAttribute("cx", String(latestX));
        connectorPointerRef.current?.setAttribute("cy", String(latestY));
      }

      function onMove(ev: MouseEvent) {
        latestX = ev.clientX - originLeft;
        latestY = ev.clientY - originTop;
        if (rafId === null) rafId = requestAnimationFrame(paint);
      }

      async function onUp(ev: MouseEvent) {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (rafId !== null) cancelAnimationFrame(rafId);
        connectorDragStateRef.current = null;
        setConnectorDragState(null);

        const dropX = ev.clientX - originLeft;
        const dropY = ev.clientY - originTop;

        // Same forgiving vertical hit-test as a row's own slot (bars
        // are drawn shorter than ROW_HEIGHT, centered within it), but
        // strict horizontally — you have to drop ON the bar's own date
        // range, not just anywhere in its row.
        const target = barPositions.find(
          (candidate) =>
            candidate.taskId !== pos.taskId &&
            candidate.categoryId === pos.categoryId &&
            dropX >= candidate.left &&
            dropX <= candidate.right &&
            Math.abs(dropY - candidate.centerY) <= ROW_HEIGHT / 2
        );
        if (!target) return;

        setScheduleError(null);
        const result = await setPredecessor(
          Number(target.taskId),
          Number(pos.taskId),
          projectId
        );
        if (result.error) {
          setScheduleError(result.error);
          return;
        }
        router.refresh();
      }

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
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

  // Shared by both the drag-to-move/resize handler below and the
  // inline Start/End date inputs in the task list — same server action,
  // same error surfacing, same post-success refresh.
  async function persistTaskDates(
    taskId: number,
    startIso: string,
    endIso: string
  ): Promise<boolean> {
    setScheduleError(null);
    // Set *before* the await — see usePendingScheduleOverrides' own doc
    // comment above for why: this needs to land before gantt-task-react
    // resets its own drag visual state on this same mouseup, not after.
    setScheduleOverride(taskId, { start: startIso, end: endIso });
    const result = await updateTaskSchedule(taskId, projectId, startIso, endIso);
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
    if (task.type === "project") return false; // cheap insurance — see doc comment; project rows never reach here in practice
    // A milestone only moves (no resize handles on a zero-duration
    // diamond), so task.start/task.end are still equal after a drag —
    // both get persisted as the same planned_start_date/planned_end_date.
    return persistTaskDates(Number(task.id), toIsoDate(task.start), toIsoDate(task.end));
  }

  // Typing a new Start or End date directly in the task list is an
  // alternative to dragging the bar. A milestone has no duration — its
  // start and end are always kept equal — so editing either field moves
  // the whole diamond rather than stretching a (non-existent) duration.
  function handleTaskDateEdit(row: GanttTask, field: "start" | "end", value: string) {
    if (!value) return;
    const isMilestone = row.type === "milestone";
    const startIso =
      field === "start" ? value : isMilestone ? value : toIsoDate(row.start);
    const endIso =
      field === "end" ? value : isMilestone ? value : toIsoDate(row.end);
    persistTaskDates(Number(row.id), startIso, endIso);
  }

  // A phase row's own Start/End is a computed rollup (earliest child
  // start, latest child end) — there's no planned_start_date/
  // planned_end_date column on a category to write one directly into.
  // Editing it here instead shifts every task in the phase by the same
  // number of days, so the whole phase moves earlier/later as one block
  // while every task keeps its own duration and its spacing relative to
  // the others — the same thing dragging the phase bar itself would do,
  // if gantt-task-react's project bars were draggable (they deliberately
  // aren't; see the class doc comment). Editing Start anchors the shift
  // on the earliest child's current start; editing End anchors it on the
  // latest child's current end — either way it's one uniform shift, not
  // a per-child rescale, so the result is always just the same layout
  // moved in time, never compressed or stretched.
  async function handlePhaseDateEdit(
    categoryId: number,
    field: "start" | "end",
    value: string
  ) {
    if (!value) return;
    const category = categories.find((c) => c.id === categoryId);
    if (!category || category.tasks.length === 0) return;

    const childDates = category.tasks.map(resolvedDates);
    const anchor =
      field === "start"
        ? new Date(Math.min(...childDates.map((d) => d.start.getTime())))
        : new Date(Math.max(...childDates.map((d) => d.end.getTime())));
    const deltaMs = toDate(value).getTime() - anchor.getTime();
    if (deltaMs === 0) return;

    setScheduleError(null);
    const results = await Promise.all(
      category.tasks.map((task, i) => {
        const d = childDates[i];
        const newStart = new Date(d.start.getTime() + deltaMs);
        const newEnd = new Date(d.end.getTime() + deltaMs);
        return updateTaskSchedule(
          task.id,
          projectId,
          toIsoDate(newStart),
          toIsoDate(newEnd)
        );
      })
    );
    const failed = results.find((r) => r.error);
    if (failed) {
      setScheduleError(failed.error ?? "Could not shift the phase's schedule.");
      return;
    }
    router.refresh();
  }

  function setAllPhasesOpen(open: boolean) {
    setCollapsedPhaseIds((prev) => {
      const next = new Set(prev);
      for (const category of categories) {
        if (category.tasks.length === 0) continue;
        if (open) next.delete(phaseRowId(category.id));
        else next.add(phaseRowId(category.id));
      }
      return next;
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
      <div
        style={{ height: HEADER_HEIGHT, width: totalColumnsWidth }}
        className="flex items-center border-r border-b border-zinc-200 bg-zinc-50"
      >
        {RESIZABLE_COLUMN_IDS.map((id) =>
          id === "text" ? (
            <div
              key={id}
              className="relative flex h-full shrink-0 items-center justify-between gap-1 px-2 text-xs font-medium text-zinc-700"
              style={{ width: columnWidths[id] }}
            >
              <span>{COLUMN_LABEL[id]}</span>
              <button
                type="button"
                onClick={() => setCategoryModal({ mode: "add" })}
                aria-label="Add phase"
                title="Add phase"
                className="shrink-0 cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
              >
                <Plus className="size-3.5" />
              </button>
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
        <div
          className="flex h-full shrink-0 items-center justify-end px-2 text-xs font-medium text-zinc-700"
          style={{ width: ACTIONS_COLUMN_WIDTH }}
        >
          Actions
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
      <div style={{ width: totalColumnsWidth }} className="border-r border-zinc-200">
        {rows.map((row) => {
          const isProject = row.type === "project";
          const category = isProject ? categoryById.get(row.id) : undefined;
          const task = !isProject ? taskById.get(row.id) : undefined;
          const days = daysBetween(row.start, row.end);
          // A phase's Start/End is only editable once it actually has
          // tasks to shift — an empty phase's row shows a placeholder
          // date range with nothing behind it to persist a shift into.
          const canEditPhaseDates =
            isProject &&
            (categories.find((c) => phaseRowId(c.id) === row.id)?.tasks
              .length ?? 0) > 0;

          return (
            <div
              key={row.id}
              style={{ height: ROW_HEIGHT }}
              // Phase rows get a faint darker fill so the hierarchy reads
              // at a glance, not just from the bold name/chevron — task
              // rows stay plain (no class) rather than an explicit white,
              // so they still show through whatever the panel's own
              // background is.
              className={`flex items-center border-b border-zinc-100 text-xs text-zinc-600 ${
                isProject ? "bg-zinc-100" : ""
              }`}
            >
              <div
                className="flex h-full shrink-0 items-center gap-1 truncate px-2 text-zinc-800"
                style={{ width: columnWidths.text }}
              >
                {isProject && (
                  <button
                    type="button"
                    onClick={() => onExpanderClick(row)}
                    aria-label={row.hideChildren ? "Expand phase" : "Collapse phase"}
                    className="shrink-0 cursor-pointer text-zinc-400 hover:text-zinc-700"
                  >
                    {row.hideChildren ? (
                      <ChevronRight className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                )}
                {row.type === "milestone" && (
                  // Matches gantt-task-react's own default
                  // milestoneBackgroundColor (#f1c453) — the chart's own
                  // diamond can be easy to miss at typical zoom (its
                  // rendered width is often well under 20px), so this
                  // gives the task list an unmissable second cue rather
                  // than relying solely on the Days column's own "—".
                  <Diamond
                    aria-label="Milestone"
                    className="size-3 shrink-0 fill-amber-400 text-amber-500"
                  />
                )}
                <span
                  className={
                    isProject
                      ? "truncate font-bold"
                      // pl-4 nudges a sub-task's own name in from the
                      // cell's edge — phase names sit flush left of their
                      // own chevron, so an unindented task name read as
                      // the same hierarchy level instead of belonging
                      // *under* its phase. Scoped to just this span (not
                      // the row/cell) so it's only the name text that
                      // shifts, not the Milestone diamond before it.
                      : "truncate pl-4 font-medium"
                  }
                >
                  {row.name}
                </span>
              </div>
              <div
                className="flex h-full shrink-0 items-center"
                style={{ width: columnWidths.start }}
              >
                {isProject && !canEditPhaseDates ? (
                  <span className="px-2">{formatDateCell(row.start)}</span>
                ) : (
                  <input
                    // Forces a remount (and so a freshly-evaluated
                    // defaultValue) whenever the underlying date actually
                    // changes — including live, frame-by-frame, while
                    // dragging the bar. Without this the input is an
                    // ordinary uncontrolled field: it mounts once and
                    // never notices row.start changing on a later
                    // render, the same reason the Days column (plain
                    // text, recomputed every render — no such staleness)
                    // already tracked a drag live and this didn't.
                    // Typing a date is unaffected: that only changes the
                    // input's own DOM value, not row.start, so the key
                    // stays put and nothing remounts mid-edit.
                    key={toIsoDate(row.start)}
                    type="date"
                    defaultValue={toIsoDate(row.start)}
                    onChange={(e) =>
                      isProject && category
                        ? handlePhaseDateEdit(category.id, "start", e.target.value)
                        : handleTaskDateEdit(row, "start", e.target.value)
                    }
                    aria-label={`${row.name} start date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100 focus:bg-white focus:outline focus:-outline-offset-2 focus:outline-zinc-400"
                  />
                )}
              </div>
              <div
                className="flex h-full shrink-0 items-center"
                style={{ width: columnWidths.end }}
              >
                {isProject && !canEditPhaseDates ? (
                  <span className="px-2">{formatDateCell(row.end)}</span>
                ) : (
                  <input
                    // See the matching comment on the Start input above.
                    key={toIsoDate(row.end)}
                    type="date"
                    defaultValue={toIsoDate(row.end)}
                    onChange={(e) =>
                      isProject && category
                        ? handlePhaseDateEdit(category.id, "end", e.target.value)
                        : handleTaskDateEdit(row, "end", e.target.value)
                    }
                    aria-label={`${row.name} end date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100 focus:bg-white focus:outline focus:-outline-offset-2 focus:outline-zinc-400"
                  />
                )}
              </div>
              <div
                className="flex h-full shrink-0 items-center justify-end px-2"
                style={{ width: columnWidths.duration }}
              >
                {row.type === "milestone" ? "—" : days}
              </div>
              <div
                className="flex h-full shrink-0 items-center justify-end gap-1 px-2"
                style={{ width: ACTIONS_COLUMN_WIDTH }}
              >
                {isProject && category ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setTaskModal({
                          mode: "add",
                          defaultCategoryId: category.id,
                        })
                      }
                      aria-label={`Add task to ${category.name}`}
                      title="Add task"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    {/* Delete lives inside this modal now (see
                        CategoryForm's own showDeleteButton prop), not as
                        a second Actions-column icon next to Edit. */}
                    <button
                      type="button"
                      onClick={() => setCategoryModal({ mode: "edit", category })}
                      aria-label="Edit category"
                      title="Edit phase"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  </>
                ) : (
                  !isProject &&
                  task && (
                    // Same idea — see SubtaskForm's own built-in Delete
                    // button (edit mode only).
                    <button
                      type="button"
                      onClick={() => setTaskModal({ mode: "edit", task })}
                      aria-label="Edit task item"
                      title="Edit task"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                  )
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    // -mx-8 breaks out of the tab content wrapper's own px-8 (set in
    // project-detail-view.tsx, shared by every other tab) so the
    // toolbar and chart below reach the true left/right edges of the
    // page instead of sitting inset within it — scoped to just this
    // component, so every other tab keeps its normal padding.
    <div className="-mx-8 flex flex-col gap-3">
      {scheduleError && (
        <p role="alert" className="text-sm text-red-600">
          {scheduleError}
        </p>
      )}

      {!hasAnyCategory ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white py-16 text-center">
          <p className="text-sm font-medium text-zinc-700">
            No phases to schedule yet
          </p>
          <p className="mt-1 text-sm text-zinc-400">
            Add a phase to start building the schedule.
          </p>
          <button
            type="button"
            onClick={() => setCategoryModal({ mode: "add" })}
            className="mt-3 flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-950"
          >
            <Plus className="size-3.5" />
            Add Phase
          </button>
        </div>
      ) : (
        <>
          {/* Portaled into the sub-tabs row's own right-aligned slot
              (see SubTabsRow in project-detail-view.tsx) rather than
              rendered as this panel's own header — right-aligned next
              to Project Overview/Cost Estimate/Gantt Chart instead of
              sitting in its own row above the chart. */}
          {toolbarSlot &&
            createPortal(
              <div className="flex flex-wrap items-center gap-1.5">
                {(Object.keys(VIEW_LABELS) as TimelineView[]).map((v) => (
                  <button
                    key={v}
                    type="button"
                    className={
                      v === view ? TOOLBAR_BUTTON_ACTIVE_CLASS : TOOLBAR_BUTTON_CLASS
                    }
                    onClick={() => setView(v)}
                  >
                    {VIEW_LABELS[v]}
                  </button>
                ))}
                <span className="mx-1 h-4 w-px bg-zinc-200" />
                <button
                  type="button"
                  className={TOOLBAR_BUTTON_CLASS}
                  onClick={() => setAllPhasesOpen(true)}
                >
                  <ChevronsDown className="size-3.5" />
                  Expand all
                </button>
                <button
                  type="button"
                  className={TOOLBAR_BUTTON_CLASS}
                  onClick={() => setAllPhasesOpen(false)}
                >
                  <ChevronsUp className="size-3.5" />
                  Collapse all
                </button>
                <span className="mx-1 h-4 w-px bg-zinc-200" />
                <button
                  type="button"
                  onClick={() => setShowTaskList((s) => !s)}
                  aria-pressed={showTaskList}
                  className={
                    showTaskList ? TOOLBAR_BUTTON_ACTIVE_CLASS : TOOLBAR_BUTTON_CLASS
                  }
                >
                  {showTaskList ? "Hide" : "Show"} Task List
                </button>
              </div>,
              toolbarSlot
            )}

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div
            ref={chartWrapRef}
            className="gantt-task-react-root h-220 overflow-auto"
          >
            <div
              ref={ganttRootRef}
              className="relative"
              onMouseDown={handleChartMouseDown}
              onMouseMove={handleChartMouseMove}
              onMouseLeave={handleChartMouseLeave}
            >
              <Gantt
                tasks={effectiveTasks}
                viewMode={VIEW_MODE[view]}
                rowHeight={ROW_HEIGHT}
                headerHeight={HEADER_HEIGHT}
                listCellWidth={showTaskList ? `${totalColumnsWidth}px` : ""}
                columnWidth={effectiveColumnWidth}
                todayColor="rgba(252, 211, 77, 0.15)"
                TooltipContent={GanttTooltipContent}
                TaskListHeader={CustomTaskListHeader}
                TaskListTable={CustomTaskListTable}
                onDateChange={(task) => persistDrag(task)}
                onExpanderClick={(task) => {
                  setCollapsedPhaseIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(task.id)) next.delete(task.id);
                    else next.add(task.id);
                    return next;
                  });
                }}
              />
              {/* position: absolute (not fixed) — a normal-flow sibling
                  of <Gantt>'s own output inside this `relative`
                  wrapper, so native scrolling of chartWrapRef carries
                  every handle along for free, with no scroll listener
                  and no re-measurement. Left mounted at all times and
                  toggled by opacity/pointer-events rather than
                  conditionally rendered, so showing/hiding a handle on
                  hover is a plain className swap, not a mount/unmount. */}
              {barPositions.flatMap((pos) => {
                const isHovered = pos.taskId === hoveredTaskId;
                const handleClass = `absolute z-40 size-2.5 -translate-y-1/2 cursor-crosshair rounded-full border border-white bg-zinc-400 shadow transition hover:scale-125 hover:bg-zinc-600 ${
                  isHovered ? "opacity-100" : "pointer-events-none opacity-0"
                }`;
                return [
                  <button
                    key={`${pos.taskId}-start`}
                    type="button"
                    onMouseDown={handleConnectorDragStart(pos, "left")}
                    aria-label="Drag to link a predecessor task"
                    title="Drag to another task in this phase to set it as the successor"
                    className={handleClass}
                    style={{
                      left: pos.left - CONNECTOR_HANDLE_GAP - CONNECTOR_HANDLE_SIZE,
                      top: pos.centerY,
                    }}
                  />,
                  <button
                    key={`${pos.taskId}-end`}
                    type="button"
                    onMouseDown={handleConnectorDragStart(pos, "right")}
                    aria-label="Drag to link a successor task"
                    title="Drag to another task in this phase to set it as the successor"
                    className={handleClass}
                    style={{ left: pos.right + CONNECTOR_HANDLE_GAP, top: pos.centerY }}
                  />,
                ];
              })}
              {/* gantt-task-react's own per-row <text> is unreliable for
                  a milestone specifically (see BarPosition's own doc
                  comment) — hidden unconditionally now via the :has()
                  rule in globals.css, and replaced with this instead.
                  Always shown (not hover-gated like the connector
                  handles above, since there's no bar for the name to
                  sit inside of otherwise). Same zinc-800 every other
                  task/phase name in the task list uses. Hidden for the
                  length of any native bar drag — see isBarDragging's own
                  doc comment for why a label left showing here would lag
                  behind a dragged diamond, the same root cause the
                  connector handles above already guard against. */}
              {!isBarDragging &&
                barPositions
                  .filter((pos) => pos.isMilestone)
                  .map((pos) => (
                    <span
                      key={`${pos.taskId}-label`}
                      className="pointer-events-none absolute z-30 -translate-y-1/2 truncate text-xs font-medium text-zinc-800"
                      style={{ left: pos.right + 6, top: pos.centerY }}
                    >
                      {pos.name}
                    </span>
                  ))}
              {connectorDragState && (
                <svg className="pointer-events-none absolute inset-0 z-50 h-full w-full overflow-visible">
                  {/* x2/y2/cx/cy start at the mousedown position (this
                      render's own connectorDragState.pointer*) and are
                      then driven entirely by direct attribute writes in
                      handleConnectorDragStart's onMove — never by a
                      further React render — for as long as the drag
                      lasts. */}
                  <line
                    ref={connectorLineRef}
                    x1={connectorDragState.originX}
                    y1={connectorDragState.originY}
                    x2={connectorDragState.pointerX}
                    y2={connectorDragState.pointerY}
                    stroke="#2563eb"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                  />
                  <circle
                    cx={connectorDragState.originX}
                    cy={connectorDragState.originY}
                    r={4}
                    fill="#2563eb"
                  />
                  <circle
                    ref={connectorPointerRef}
                    cx={connectorDragState.pointerX}
                    cy={connectorDragState.pointerY}
                    r={4}
                    fill="#2563eb"
                  />
                </svg>
              )}
            </div>
          </div>
          </div>
        </>
      )}

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title={categoryModal?.mode === "edit" ? "Edit Phase" : "Add Phase"}
      >
        {categoryModal?.mode === "edit" ? (
          <CategoryForm
            projectId={projectId}
            category={categoryModal.category}
            showDeleteButton
            onSuccess={() => setCategoryModal(null)}
          />
        ) : (
          <AddPhaseForm
            projectId={projectId}
            onSuccess={() => setCategoryModal(null)}
          />
        )}
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title={taskModal?.mode === "edit" ? "Edit Task" : "Add Task"}
      >
        {taskModal?.mode === "edit" ? (
          <SubtaskForm
            projectId={projectId}
            categoryId={taskModal.task.categoryId}
            task={taskModal.task}
            siblingTasks={
              categories.find((c) => c.id === taskModal.task.categoryId)
                ?.tasks ?? []
            }
            onSuccess={() => setTaskModal(null)}
          />
        ) : (
          taskModal &&
          taskModal.defaultCategoryId !== undefined && (
            <SubtaskForm
              projectId={projectId}
              categoryId={taskModal.defaultCategoryId}
              siblingTasks={
                categories.find((c) => c.id === taskModal.defaultCategoryId)
                  ?.tasks ?? []
              }
              onSuccess={() => setTaskModal(null)}
            />
          )
        )}
      </Modal>
    </div>
  );
}
