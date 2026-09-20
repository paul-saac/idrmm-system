"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { ChevronDown, ChevronRight, Plus, Redo2, Undo2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { AddPhaseForm } from "@/components/projects/progress/add-phase-form";
import { SubtaskForm } from "@/components/projects/progress/subtask-form";
import { updateTaskSchedule, setPredecessor } from "@/lib/cost-estimate/actions";
import { undoGanttAction, redoGanttAction } from "@/lib/cost-estimate/undo-redo-actions";
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
const RESIZABLE_COLUMN_IDS = ["text", "start", "end", "duration", "priority"] as const;
type ResizableColumnId = (typeof RESIZABLE_COLUMN_IDS)[number];

// Start/end are wider than a plain date label needs — the native
// <input type="date"> that renders in those columns (see
// CustomTaskListTable) wants more room for its "MM/DD/YYYY" segments
// plus the calendar-icon affordance than static text like "Jan 5" did.
// text is wider than a name alone needs, too — its own add/edit buttons
// (moved into this cell, see CustomTaskListTable) now share the space
// with the name, not a separate Actions column.
const DEFAULT_COLUMN_WIDTHS: Record<ResizableColumnId, number> = {
  text: 220,
  start: 108,
  end: 108,
  duration: 60,
  priority: 84,
};

const MIN_COLUMN_WIDTH: Record<ResizableColumnId, number> = {
  text: 140,
  start: 84,
  end: 84,
  duration: 40,
  priority: 64,
};

const COLUMN_LABEL: Record<ResizableColumnId, string> = {
  text: "Task",
  start: "Start",
  end: "End",
  duration: "Days",
  priority: "Priority",
};

const RIGHT_ALIGNED_COLUMNS = new Set<ResizableColumnId>(["duration"]);

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
  projectTargetEndDate,
  canUndo,
  canRedo,
}: {
  projectId: number;
  categories: CostCategory[];
  progress: ProjectProgress;
  projectStartDate: string | null;
  /** Bounds a task's own typed Start/End edits below — a date outside
   * this window reverts instead of saving (see handleTaskDateEdit). */
  projectTargetEndDate: string | null;
  /** From lib/cost-estimate/undo-redo.ts's getGanttUndoRedoState, fetched
   * server-side alongside categories/progress — refreshes for free
   * through the same revalidatePath/router.refresh() flow every Gantt
   * mutation already triggers, no separate polling needed. */
  canUndo: boolean;
  canRedo: boolean;
}) {
  const router = useRouter();
  // Month is the default (and, for now, only — the Day/Week/Month/Year
  // toolbar was removed pending a later design pass): unlike Week, its
  // column labels are plain month names with no "W##" numbering that
  // could read as resetting each time the visible range crosses a year
  // boundary (an ISO-8601 week-numbering quirk, not a bug, but
  // confusing at a glance for a non-technical viewer).
  const view: TimelineView = "month";
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
  // No existing "disable while a direct server-action call is in
  // flight" convention in this component to reuse (updateTaskSchedule/
  // setPredecessor below are called directly, not through
  // useActionState — only the 3 modal forms get a `pending` flag for
  // free that way), so this is its own local state, same as those two
  // already manage their own optimistic/error state by hand.
  const [isUndoRedoPending, setIsUndoRedoPending] = useState(false);

  async function handleUndo() {
    if (!canUndo || isUndoRedoPending) return;
    setIsUndoRedoPending(true);
    setScheduleError(null);
    const result = await undoGanttAction(projectId);
    setIsUndoRedoPending(false);
    if (result.error) {
      setScheduleError(result.error);
      return;
    }
    router.refresh();
  }

  async function handleRedo() {
    if (!canRedo || isUndoRedoPending) return;
    setIsUndoRedoPending(true);
    setScheduleError(null);
    const result = await redoGanttAction(projectId);
    setIsUndoRedoPending(false);
    if (result.error) {
      setScheduleError(result.error);
      return;
    }
    router.refresh();
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
  }, [canUndo, canRedo, isUndoRedoPending, categoryModal, taskModal]);

  // Which phase row's Start/End cell currently has its "why can't I
  // edit this" info bubble open — a phase's date input is inert
  // (pointer-events-none, see CustomTaskListTable), so this is driven
  // by a click on the *cell* wrapping it instead of the input itself.
  // top/left are the clicked cell's own getBoundingClientRect(), taken
  // once at click time — the bubble itself is portaled straight to
  // <body> and positioned from these instead of living in-flow inside
  // the task list panel, since that panel's own horizontal scroll
  // clipping was cutting the bubble off the moment it grew wider than
  // the panel (confirmed directly: the text was cut off mid-word).
  const [dateInfoTooltip, setDateInfoTooltip] = useState<{
    rowId: string;
    field: "start" | "end";
    top: number;
    left: number;
  } | null>(null);

  useEffect(() => {
    if (!dateInfoTooltip) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-phase-date-cell]")) {
        setDateInfoTooltip(null);
      }
    }
    // Dismiss rather than drift out of place — a portaled, fixed-
    // position bubble positioned from a one-time getBoundingClientRect()
    // can't follow the cell live the way an in-flow tooltip would if
    // the chart (or the page) scrolls while it's open.
    function handleScroll() {
      setDateInfoTooltip(null);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [dateInfoTooltip]);
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

  // Double-click a bar (phase or task) to see/edit its full details —
  // same modal the row's own edit button already opens, just reachable
  // straight from the chart itself too. gantt-task-react's own
  // onDoubleClick prop already debounces this against a single click
  // (used elsewhere for drag-start), so no extra timing logic is needed
  // here.
  function handleBarDoubleClick(row: GanttTask) {
    if (row.type === "project") {
      const category = categoryById.get(row.id);
      if (category) setCategoryModal({ mode: "edit", category });
      return;
    }
    const task = taskById.get(row.id);
    if (task) setTaskModal({ mode: "edit", task });
  }

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

  const totalColumnsWidth = RESIZABLE_COLUMN_IDS.reduce(
    (sum, id) => sum + columnWidths[id],
    0
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
  // Deliberately a *separate* ref from chartWrapRef below, both pointing
  // at nested elements (this one the outer overflow-hidden box,
  // chartWrapRef the inner overflow-auto one) that normally report the
  // same width — except right at the edge where effectiveColumnWidth's
  // own output causes chartWrapRef's content to just barely need (or
  // just barely stop needing) a scrollbar. A scrollbar's own width
  // shrinks chartWrapRef's *content-box* width, which is exactly what
  // ResizeObserver reports — so observing chartWrapRef itself closes a
  // feedback loop: containerWidth -> effectiveColumnWidth -> content
  // width -> scrollbar toggles -> containerWidth changes again,
  // indefinitely, tripping React's "Maximum update depth exceeded"
  // (confirmed directly: reproducible whenever a project's real column
  // count sits within a few pixels of that threshold, since
  // estimateColumnCount above is only an estimate — its own "+3" fudge
  // factor doesn't always land on gantt-task-react's actual rendered
  // count). This outer box has overflow-hidden, not overflow-auto — it
  // never grows a scrollbar of its own no matter what its content does,
  // so its width is stable and immune to this loop, while still
  // matching the same visible area chartWrapRef fills.
  const chartOuterRef = useRef<HTMLDivElement>(null);
  // The inner, actually-scrolling element (overflow-auto) — unrelated to
  // the ResizeObserver above; see its own doc comment for why that
  // observes chartOuterRef instead of this one.
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
    const el = chartOuterRef.current;
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
  // chart's own <svg> content, so "target is inside an svg" was the
  // original check here — but the task list's own Edit/Add/Expand
  // buttons render a lucide-react icon too, which is *also* an <svg>,
  // and (unlike the connector handles, which stopPropagation() their
  // own mousedown) those buttons don't opt out. Confirmed directly:
  // clicking dead-center on an Edit button's icon (not its padding)
  // matched this "inside an svg" check, which called setIsBarDragging —
  // a state update on this component, which CustomTaskListTable/Header
  // are declared *inside* (so every render passes React a brand-new
  // component reference for them), forcing gantt-task-react to unmount
  // and remount the whole task list before the browser's mouseup/click
  // could fire on that now-destroyed button — per standard DOM
  // semantics, no `click` event is dispatched once its mousedown target
  // has been removed, so the button's onClick silently never ran. Right
  // at the icon's own edge (the button's padding) the click worked fine
  // — exactly the "sometimes" a user clicking anywhere on a small icon
  // button would see. `svg.closest("button")` excludes exactly this
  // case: none of gantt-task-react's own bar/grid SVG content is ever
  // inside an HTML <button>, only this app's own icon buttons are.
  function handleChartMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    if (!(e.target instanceof Element)) return;
    const svg = e.target.closest("svg");
    if (!svg || svg.closest("button")) return;
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
  //
  // A typed value outside the project's own Start Date -> Target End
  // Date window is rejected rather than saved — task-level dates are
  // meant to fall within the project's overall span, and this is the
  // one independently-stored "parent" range there actually is (a
  // phase/category's own start/end is purely a rollup of its tasks, not
  // a stored value — see handlePhaseDateEdit's own comment, now removed
  // along with phase date editing entirely). Since the input is
  // uncontrolled (see its own key comment below), rejecting a value
  // doesn't visually undo it on its own — inputEl.value is set back to
  // the field's last known-good date directly so the field snaps back
  // instead of quietly keeping the rejected value on screen.
  function handleTaskDateEdit(
    row: GanttTask,
    field: "start" | "end",
    value: string,
    inputEl: HTMLInputElement
  ) {
    if (!value) return;

    if (projectStartDate && projectTargetEndDate) {
      const typedMs = toDate(value).getTime();
      const minMs = toDate(projectStartDate).getTime();
      const maxMs = toDate(projectTargetEndDate).getTime();
      if (typedMs < minMs || typedMs > maxMs) {
        inputEl.value = toIsoDate(field === "start" ? row.start : row.end);
        setScheduleError(
          `Date must be between ${formatDateCell(toDate(projectStartDate))} and ${formatDateCell(toDate(projectTargetEndDate))} (the project's own Start/Target End Date).`
        );
        return;
      }
    }

    setScheduleError(null);
    const isMilestone = row.type === "milestone";
    const startIso =
      field === "start" ? value : isMilestone ? value : toIsoDate(row.start);
    const endIso =
      field === "end" ? value : isMilestone ? value : toIsoDate(row.end);
    persistTaskDates(Number(row.id), startIso, endIso);
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
                aria-label="Add task"
                title="Add task"
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
                className="flex h-full shrink-0 items-center gap-1 px-2 text-zinc-800"
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
                <span
                  className={
                    isProject
                      ? "min-w-0 flex-1 truncate font-bold"
                      // pl-6 nudges a sub-task's own name in from the
                      // cell's edge — phase names sit flush left of their
                      // own chevron, so an unindented task name read as
                      // the same hierarchy level instead of belonging
                      // *under* its phase. Scoped to just this span (not
                      // the row/cell) so it's only the name text that
                      // shifts. A full pl-6 (not pl-4) so it reads as
                      // clearly nested a level beyond the phase's own
                      // chevron+name, not just barely offset from it.
                      // min-w-0 + flex-1 (not just truncate) since this
                      // cell is no longer just a name — it also holds the
                      // add/edit buttons below (formerly their own
                      // Actions column), and a flex item needs an
                      // explicit min-width of 0 to truncate at all rather
                      // than pushing those buttons out past the column's
                      // own width.
                      : "min-w-0 flex-1 truncate pl-6 font-medium"
                  }
                >
                  {row.name}
                </span>
                {/* Formerly their own Actions column, moved in here per
                    an explicit user request — a phase row's add-task/
                    edit pair, or a task row's own single edit button.
                    Delete lives inside each row's own Edit modal (see
                    CategoryForm's/SubtaskForm's own showDeleteButton /
                    built-in Delete button), not a button here. */}
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
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryModal({ mode: "edit", category })}
                      aria-label="Edit category"
                      title="Edit phase"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </button>
                  </>
                ) : (
                  !isProject &&
                  task && (
                    <button
                      type="button"
                      onClick={() => setTaskModal({ mode: "edit", task })}
                      aria-label="Edit task item"
                      title="Edit task"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </button>
                  )
                )}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center"
                style={{ width: columnWidths.start }}
                data-phase-date-cell={isProject ? true : undefined}
                onClick={
                  isProject
                    ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDateInfoTooltip((current) =>
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
                {isProject ? (
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
                  <input
                    key={toIsoDate(row.start)}
                    type="date"
                    readOnly
                    tabIndex={-1}
                    defaultValue={toIsoDate(row.start)}
                    aria-label={`${row.name} start date`}
                    className="pointer-events-none h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light"
                  />
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
                    key={toIsoDate(row.start)}
                    type="date"
                    defaultValue={toIsoDate(row.start)}
                    onChange={(e) =>
                      handleTaskDateEdit(row, "start", e.target.value, e.target)
                    }
                    onFocus={(e) => {
                      e.currentTarget.dataset.cellActive = "true";
                    }}
                    onBlur={(e) => {
                      delete e.currentTarget.dataset.cellActive;
                    }}
                    aria-label={`${row.name} start date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100"
                  />
                )}
                {dateInfoTooltip?.rowId === row.id &&
                  dateInfoTooltip.field === "start" &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        top: dateInfoTooltip.top + 8,
                        left: dateInfoTooltip.left,
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
                className="relative flex h-full shrink-0 items-center"
                style={{ width: columnWidths.end }}
                data-phase-date-cell={isProject ? true : undefined}
                onClick={
                  isProject
                    ? (e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setDateInfoTooltip((current) =>
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
                {isProject ? (
                  // See the matching comment on the Start input above.
                  <input
                    key={toIsoDate(row.end)}
                    type="date"
                    readOnly
                    tabIndex={-1}
                    defaultValue={toIsoDate(row.end)}
                    aria-label={`${row.name} end date`}
                    className="pointer-events-none h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light"
                  />
                ) : (
                  <input
                    // See the matching comment on the Start input above.
                    key={toIsoDate(row.end)}
                    type="date"
                    defaultValue={toIsoDate(row.end)}
                    onChange={(e) =>
                      handleTaskDateEdit(row, "end", e.target.value, e.target)
                    }
                    onFocus={(e) => {
                      e.currentTarget.dataset.cellActive = "true";
                    }}
                    onBlur={(e) => {
                      delete e.currentTarget.dataset.cellActive;
                    }}
                    aria-label={`${row.name} end date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100"
                  />
                )}
                {dateInfoTooltip?.rowId === row.id &&
                  dateInfoTooltip.field === "end" &&
                  createPortal(
                    <div
                      role="tooltip"
                      style={{
                        top: dateInfoTooltip.top + 8,
                        left: dateInfoTooltip.left,
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
                className="flex h-full shrink-0 items-center justify-end px-2"
                style={{ width: columnWidths.duration }}
              >
                {row.type === "milestone" ? "—" : days}
              </div>
              <div
                className="flex h-full shrink-0 items-center px-2"
                style={{ width: columnWidths.priority }}
              >
                {/* Phase rows have no priority of their own (task ===
                    undefined here) — a phase's priority, if it needs
                    one, is a rollup question for later, not something
                    stored directly on the category. Replaces the old
                    dot-in-the-name-cell indicator (only shown for
                    non-Medium) with its own column instead, now that
                    there's room for the actual word rather than just a
                    color cue. */}
                {task && (
                  <span
                    className={
                      task.priority === "high"
                        ? "font-medium text-red-600"
                        : task.priority === "low"
                          ? "text-zinc-400"
                          : "text-zinc-600"
                    }
                  >
                    {task.priority === "high"
                      ? "High"
                      : task.priority === "low"
                        ? "Low"
                        : "Medium"}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    // No -mx-8 of its own — the Overview tab's whole content block
    // (project-detail-view.tsx) already breaks out to the page's true
    // left/right edges, this component included, so adding it again
    // here would double the offset and push this chart's content past
    // the edge (clipped by its own overflow-hidden wrapper below).
    <div className="flex flex-col gap-3">
      {scheduleError && (
        <p role="alert" className="text-sm text-red-600">
          {scheduleError}
        </p>
      )}

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
        {/* Deliberately just Undo/Redo — a reference toolbar image with
            ~25 icons (text color, cut/copy/paste, zoom, print, share,
            lock, settings, ...) was the original ask, but none of those
            other actions have a real feature behind them in this app, so
            they're not here as decoration. */}
        <div className="flex items-center gap-1 border border-zinc-200 bg-zinc-50 px-2 py-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!canUndo || isUndoRedoPending}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!canRedo || isUndoRedoPending}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Redo2 className="size-4" />
          </button>
        </div>

        {!hasAnyCategory ? (
          <div className="flex flex-col items-center justify-center border border-dashed border-zinc-300 bg-white py-16 text-center">
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
            {/* Toolbar (Day/Week/Month/Year, Expand/Collapse all, Show/
                Hide Task List) removed for now — the Gantt chart and its
                tooling get their own design pass later. view/showTaskList
                stay at their defaults ("month"/true) with no UI to change
                them until then. */}

            <div
              ref={chartOuterRef}
              className="overflow-hidden border border-zinc-200 bg-white"
            >
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
                  onDoubleClick={handleBarDoubleClick}
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
      </div>

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title={categoryModal?.mode === "edit" ? "Edit Phase" : "Add Task"}
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
