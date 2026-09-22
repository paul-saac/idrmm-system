"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Gantt, ViewMode, type Task as GanttTask } from "gantt-task-react";
import "gantt-task-react/dist/index.css";
import { ChevronDown, ChevronRight, HardHat, Plus, Redo2, Sparkles, Undo2 } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { CategoryForm } from "@/components/projects/cost-estimate/category-form";
import { SubtaskForm } from "@/components/projects/progress/subtask-form";
import { MembersModalContent } from "@/components/projects/progress/members-modal-content";
import { AssignWorkersModalContent } from "@/components/projects/progress/assign-workers-modal-content";
import { ProgressTrackingModalContent } from "@/components/projects/progress/progress-tracking-modal-content";
import {
  updateTaskSchedule,
  updateTaskPriority,
  setPredecessor,
  createCategory,
  updateCategory,
  renameTask,
  createTask,
} from "@/lib/cost-estimate/actions";
import {
  undoGanttAction,
  redoGanttAction,
  resetGanttHistory,
} from "@/lib/cost-estimate/undo-redo-actions";
import type { CostCategory, CostTask } from "@/lib/cost-estimate/data";
import type { Worker, TaskWorkerAssignments } from "@/lib/workers/data";
import type { ProjectMaterial } from "@/lib/materials/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";

function toDate(iso: string) {
  return new Date(`${iso}T00:00:00`);
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

// The toolbar's own zoom buttons — deliberately excludes "week" (see
// the `view` state's own doc comment in GanttChartView for why), even
// though TimelineView itself still includes it (every date-range/
// column-width calculation in this file already handles it, this is
// just not offering it as a pickable option).
const TIMELINE_VIEW_OPTIONS: readonly TimelineView[] = ["day", "month", "year"];

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
const RESIZABLE_COLUMN_IDS = [
  "text",
  "start",
  "end",
  "duration",
  "priority",
  "assigned",
  "percentComplete",
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
  assigned: 78,
  percentComplete: 122,
};

const MIN_COLUMN_WIDTH: Record<ResizableColumnId, number> = {
  text: 140,
  start: 84,
  end: 84,
  duration: 38,
  priority: 68,
  assigned: 58,
  percentComplete: 90,
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
  assigned: "Assigned",
  percentComplete: "Percent Complete",
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
// Rather than reconciling field-by-field once fresh props arrive (tried
// first — needed either a useEffect calling setState directly in its
// body, or a render-phase "adjust state when a prop changes" setState
// call; the React Compiler refused to preserve this component's other
// memoized values, e.g. timelineExtent/visibleTasks, with either one in
// place, confirmed directly), every override is tagged with the exact
// `categories` array reference that was live when it was set, and
// **all** overrides (of whichever field this particular hook instance
// tracks) expire together the instant that reference changes — which
// only happens when a fresh router.refresh() actually lands. A persist
// that succeeded is, by then, already reflected in the new props, so
// expiring the override right as it stops being read from prop data is
// invisible; nothing to reconcile field-by-field, and no setState call
// anywhere outside an event handler.
//
// Generic (not schedule-specific) so each field gets its own isolated
// Map via its own hook call — e.g. renaming a task while a priority
// change for a *different* task is still in flight can't clobber it,
// since they're never sharing one Map/state slot.
function usePendingOverrides<T>(categories: CostCategory[]) {
  const [state, setState] = useState<{
    categoriesAtSet: CostCategory[];
    overrides: Map<number, T>;
  } | null>(null);

  const overrides =
    state && state.categoriesAtSet === categories
      ? state.overrides
      : (EMPTY_OVERRIDES as ReadonlyMap<number, T>);

  function setOverride(taskId: number, override: T) {
    setState((prev) => {
      const base =
        prev && prev.categoriesAtSet === categories
          ? prev.overrides
          : new Map<number, T>();
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
  projectStartDate,
  canUndo,
  canRedo,
  workers,
  taskWorkerAssignments,
  materials,
  taskProgressToday,
  onImportBom,
}: {
  projectId: number;
  /** Each task's own percentComplete (see CostTask's own doc comment)
   * is the sole source of progress here — deliberately not fed by
   * lib/progress/data.ts's own ProjectProgress (still used elsewhere,
   * e.g. the Progress Overview tab, entirely unrelated to this view). */
  categories: CostCategory[];
  /** Only ever used as a fallback for a task/phase with no dates of its
   * own yet (see fallbackStart/fillerDate below) — a task's own typed
   * Start/End is otherwise unbounded, see handleTaskDateEdit's own doc
   * comment for why. */
  projectStartDate: string | null;
  /** From lib/cost-estimate/undo-redo.ts's getGanttUndoRedoState, fetched
   * server-side alongside categories/progress — refreshes for free
   * through the same revalidatePath/router.refresh() flow every Gantt
   * mutation already triggers, no separate polling needed. */
  canUndo: boolean;
  canRedo: boolean;
  /** The project's own Members roster and each task's current
   * assignments from it — see lib/workers/data.ts. Fetched alongside
   * categories/progress, same revalidatePath-driven refresh as
   * everything else here. */
  workers: Worker[];
  taskWorkerAssignments: TaskWorkerAssignments;
  /** The project's own material stock roster — the Progress Tracking
   * modal's own "materials consumed" picker (see
   * progress-tracking-modal-content.tsx) reads from this same list and
   * its Save deducts directly from it, same roster the Materials
   * Monitoring tab and the Cost Estimate Breakdown's Material Breakdown
   * modal already use. */
  materials: ProjectMaterial[];
  /** Every task's own cumulative-to-date progress plus whatever's
   * already recorded for today — see lib/task-progress/data.ts, fetched
   * alongside categories/progress. Pre-fills the Progress Tracking
   * modal instead of it needing its own per-open fetch. */
  taskProgressToday: Record<number, TaskProgressToday>;
  /** Opens the shared "Import Bill of Materials" modal — owned by
   * project-detail-view.tsx, same instance the Cost Estimate
   * Breakdown's own entry points open, see that component's own doc
   * comment on this same prop. */
  onImportBom: () => void;
}) {
  const router = useRouter();
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
  // NOT in this file's other usual "new hooks go after barPositions"
  // safe zone, since those three are computed earlier in render order
  // than barPositions and can't read state declared after themselves.
  // Verified directly this doesn't break the React Compiler's own
  // memoization of effectiveTasks/timelineExtent/visibleTasks/
  // barPositions downstream (the exact failure mode this file's other
  // doc comments describe) via eslint's react-hooks/preserve-manual-
  // memoization rule before considering this safe to ship.
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
  const effectiveCanUndo = activeUndoRedoOverride?.canUndo ?? canUndo;
  const effectiveCanRedo = activeUndoRedoOverride?.canRedo ?? canRedo;
  const [pendingNewPhase, setPendingNewPhase] = useState<{
    categoriesAtSet: CostCategory[];
    category: CostCategory;
  } | null>(null);
  const activeNewPhase =
    pendingNewPhase && pendingNewPhase.categoriesAtSet === categories
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
    pendingNewTask && pendingNewTask.categoriesAtSet === categories
      ? pendingNewTask
      : null;
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
  const categoriesForDisplay = useMemo(() => {
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
    return result;
  }, [categories, activeCategoriesOverride, activeNewPhase, activeNewTask]);
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
  const [membersModalOpen, setMembersModalOpen] = useState(false);
  const [assignWorkersModal, setAssignWorkersModal] = useState<{
    taskId: number;
    taskName: string;
  } | null>(null);
  // Opened by a single click on a task's own bar (see handleBarClick
  // below) — the Progress Tracking Override modal. Carries the whole
  // task, not just its id, since the modal needs its own
  // estimatedQuantity/unit/percentComplete for display alongside the
  // form.
  const [progressModal, setProgressModal] = useState<CostTask | null>(null);
  const [collapsedPhaseIds, setCollapsedPhaseIds] = useState<Set<string>>(
    new Set()
  );
  // Read side (the message itself) is intentionally unused — validation
  // still rejects/snaps back bad input at every setScheduleError(...)
  // call site below, only the visible error text was removed.
  const [, setScheduleError] = useState<string | null>(null);
  // No existing "disable while a direct server-action call is in
  // flight" convention in this component to reuse (updateTaskSchedule/
  // setPredecessor below are called directly, not through
  // useActionState — only the 3 modal forms get a `pending` flag for
  // free that way), so this is its own local state, same as those two
  // already manage their own optimistic/error state by hand.
  const [isUndoRedoPending, setIsUndoRedoPending] = useState(false);

  // Undo/Redo is scoped to "actions taken in the current Gantt Chart
  // session" per an explicit request — reloading the page, or leaving
  // this tab and coming back (this component unmounts on every tab
  // switch away from Overview, the only place it renders — see
  // project-detail-view.tsx), should always start both buttons with
  // nothing available, never carrying history over from an earlier
  // visit. The actual history storage (gantt_snapshots) is still
  // server-side, so a fresh mount wipes it there too (resetGanttHistory
  // below), rather than just hiding stale entries locally — nothing else
  // reads that table, so there's no reason to keep them around once a
  // new session has started.
  //
  // historyReady starts false and gates both buttons to "nothing to
  // undo/redo" (see the disabled props further down) specifically to
  // cover the brief window between this component mounting (with
  // whatever canUndo/canRedo the *previous* session left behind, still
  // baked into this render's own props) and the reset call below
  // actually landing — without this gate, a leftover "Undo" from a
  // past visit could flash as clickable for a moment on every fresh
  // mount, which is exactly what this feature is meant to prevent.
  const [historyReady, setHistoryReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    resetGanttHistory(projectId).finally(() => {
      if (cancelled) return;
      setHistoryReady(true);
      router.refresh();
    });
    return () => {
      cancelled = true;
    };
    // Deliberately mount-only (empty deps) — this is a once-per-session
    // reset, not something that should re-fire on every projectId
    // identity change this component doesn't actually experience (it's
    // always rendered for one fixed project) or any other prop change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUndo() {
    if (!historyReady || !effectiveCanUndo || isUndoRedoPending) return;
    setIsUndoRedoPending(true);
    setScheduleError(null);
    const categoriesAtSet = categories;
    const result = await undoGanttAction(projectId);
    setIsUndoRedoPending(false);
    if (result.error) {
      setScheduleError(result.error);
      return;
    }
    // Show the actual restored schedule — and the actual post-undo
    // canUndo/canRedo — the instant this resolves, rather than
    // router.refresh()'s much slower ~23-query round trip. See
    // undoRedoOverride's own doc comment above for why *both* matter,
    // not just categories.
    if (result.categories) {
      setUndoRedoOverride({
        categoriesAtSet,
        categories: result.categories,
        canUndo: result.canUndo ?? false,
        canRedo: result.canRedo ?? false,
      });
    }
    // A phase/subtask add still mid-flight (its own round trip hasn't
    // settled yet) is tied to the *old* `categoriesAtSet` too, same as
    // every override here — but unlike the rest, it isn't superseded by
    // undoRedoOverride just being set above (that only replaces the
    // *base* categoriesForDisplay layers on top of, and a pending add
    // is one of those layers, see categoriesForDisplay's own doc
    // comment). Left alone, an add-in-flight at the exact moment an
    // undo/redo lands would keep showing its own placeholder row
    // overlaid on top of the just-restored (unrelated) schedule.
    // Dropping it here doesn't lose the add itself — createCategory/
    // createTask's own round trip is still running independently and
    // will still land for real once it resolves.
    setPendingNewPhase(null);
    setPendingNewTask(null);
    router.refresh();
  }

  async function handleRedo() {
    if (!historyReady || !effectiveCanRedo || isUndoRedoPending) return;
    setIsUndoRedoPending(true);
    setScheduleError(null);
    const categoriesAtSet = categories;
    const result = await redoGanttAction(projectId);
    setIsUndoRedoPending(false);
    if (result.error) {
      setScheduleError(result.error);
      return;
    }
    // Same as handleUndo's own comment above.
    if (result.categories) {
      setUndoRedoOverride({
        categoriesAtSet,
        categories: result.categories,
        canUndo: result.canUndo ?? false,
        canRedo: result.canRedo ?? false,
      });
    }
    // Same as handleUndo's own comment above.
    setPendingNewPhase(null);
    setPendingNewTask(null);
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
  }, [
    historyReady,
    effectiveCanUndo,
    effectiveCanRedo,
    isUndoRedoPending,
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
  const fallbackEnd = new Date(fallbackStart.getTime() + 7 * 86_400_000);

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
  // weight is its planned duration in days (same daysBetween() the
  // Days column itself already shows), so a short 100%-done task pulls
  // the phase's own percent up less than a long one would. Empty of
  // tasks (a fresh phase with nothing added yet), or every task
  // resolving to 0 total duration (shouldn't happen in practice —
  // daysBetween always returns at least 1 — but guarded rather than
  // dividing by zero), reads as 0.
  const percentCompleteByCategoryId = useMemo(() => {
    const map = new Map<number, number>();
    for (const category of categoriesForDisplay) {
      let weightedSum = 0;
      let totalDuration = 0;
      for (const task of category.tasks) {
        const { start, end } = resolvedDates(task);
        const duration = daysBetween(start, end);
        weightedSum += duration * task.percentComplete;
        totalDuration += duration;
      }
      map.set(
        category.id,
        totalDuration > 0 ? Math.round(weightedSum / totalDuration) : 0
      );
    }
    return map;
    // fallbackStart/fallbackEnd (read indirectly through resolvedDates)
    // deliberately omitted — see the identical omission (and its own
    // doc comment) on the `tasks` useMemo elsewhere in this file; same
    // reasoning applies here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesForDisplay]);

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

  const categoryById = useMemo(() => {
    const map = new Map<string, { id: number; name: string }>();
    for (const category of categoriesForDisplay) {
      map.set(phaseRowId(category.id), { id: category.id, name: category.name });
    }
    return map;
  }, [categoriesForDisplay]);

  const workerById = useMemo(() => {
    const map = new Map<number, Worker>();
    for (const worker of workers) {
      map.set(worker.id, worker);
    }
    return map;
  }, [workers]);

  const tasks: GanttTask[] = useMemo(() => {
    const result: GanttTask[] = [];
    // A fresh local date, deliberately not fallbackStart (see
    // fillerDate's own doc comment elsewhere in this file for the exact
    // same reasoning/hazard) — a brand-new, still-childless phase's own
    // placeholder date range below is today/today specifically (a
    // freshly created phase has no schedule of its own yet, so "right
    // now" reads better than fallbackStart's own project-start-or-today
    // plus a week), not the wider single-task fallback range
    // resolvedDates still uses for a genuinely dateless *task*.
    const emptyPhaseDate = new Date();
    for (const category of categoriesForDisplay) {
      // A phase with no task items yet still gets its own row (with a
      // placeholder date range) rather than being skipped entirely —
      // otherwise there'd be nowhere in the Gantt itself to click "+"
      // and add that phase's very first task.
      const childDates =
        category.tasks.length > 0
          ? category.tasks.map(resolvedDates)
          : [{ start: emptyPhaseDate, end: emptyPhaseDate }];

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
          progress: task.percentComplete,
          project: phaseRowId(category.id),
          dependencies: task.predecessorTaskId
            ? [String(task.predecessorTaskId)]
            : undefined,
        });
      });
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesForDisplay, percentCompleteByCategoryId, collapsedPhaseIds]);

  const [pendingScheduleOverrides, setScheduleOverride, clearScheduleOverride] =
    usePendingOverrides<ScheduleOverride>(categories);

  // Applies any pending optimistic overrides (see usePendingOverrides'
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
      const newWidth = entries[0].contentRect.width;
      // A functional update, comparing against the *previous* width
      // rather than always setting the newly-observed one — cheap
      // insurance against any sub-pixel layout noise feeding back
      // through effectiveColumnWidth into a further tiny width change:
      // any change under 2px is ignored outright, since
      // effectiveColumnWidth's own Math.floor(chartAreaWidth /
      // unitCount) already can't possibly react to a sub-2px difference
      // in chartAreaWidth once there's more than a couple of date
      // columns, the normal case.
      setContainerWidth((prev) =>
        Math.abs(prev - newWidth) < 2 ? prev : newWidth
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const effectiveColumnWidth = useMemo(() => {
    const base = BASE_COLUMN_WIDTH[view];
    if (!timelineExtent || containerWidth === 0) return base;
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
    const xOffset = showTaskList ? visiblePanelWidth : 0;

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
  }, [visibleTasks, view, effectiveColumnWidth, showTaskList, visiblePanelWidth, taskById]);

  // Optimistic overrides for the task-list panel's own Priority/Task-name/
  // Phase-name cells — same usePendingOverrides mechanism
  // pendingScheduleOverrides above uses for the chart's bars, just three
  // more independent instances (each its own isolated Map, see the
  // hook's own doc comment) since these read directly in
  // CustomTaskListTable's row JSX further down, not through
  // `tasks`/`effectiveTasks`. Positioned here (after barPositions, not
  // up near pendingScheduleOverrides itself) for the same React
  // Compiler memoization reason handleBarDoubleClick/handleBarClick
  // below are — see either one's own doc comment.
  //
  // Task name and phase (category) name are deliberately two *separate*
  // Maps, not one shared by id — a task id and a category id are
  // different id spaces (e.g. task 1 and category 1 can both exist at
  // once), so sharing one Map risked a phase-name override silently
  // showing up on an unrelated same-numbered task, or vice versa.
  const [pendingPriorityOverrides, setPriorityOverride, clearPriorityOverride] =
    usePendingOverrides<string>(categories);
  const [pendingNameOverrides, setNameOverride, clearNameOverride] =
    usePendingOverrides<string>(categories);
  const [
    pendingCategoryNameOverrides,
    setCategoryNameOverride,
    clearCategoryNameOverride,
  ] = usePendingOverrides<string>(categories);

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

  // Double-click a bar (phase or task) to see/edit its full details —
  // same modal the row's own edit button already opens, just reachable
  // straight from the chart itself too.
  //
  // Deliberately positioned here, after barPositions rather than up
  // near categoryById/taskById (which it reads from) — the React
  // Compiler failed to preserve effectiveTasks' own memoization with
  // this (and handleBarClick right below it) placed any earlier,
  // confirmed directly by bisecting hook position, the exact same
  // hazard usePendingOverrides' own doc comment describes for
  // the same reason.
  function handleBarDoubleClick(row: GanttTask) {
    if (barClickTimerRef.current !== null) {
      // Cancel the pending single-click action below — see its own doc
      // comment for why this guard has to exist at all.
      window.clearTimeout(barClickTimerRef.current);
      barClickTimerRef.current = null;
    }
    if (row.type === "project") {
      const category = categoryById.get(row.id);
      if (category) setCategoryModal(category);
      return;
    }
    const task = taskById.get(row.id);
    // task.id > 0 excludes handleAddSubtask's own brief placeholder row
    // (negative id) — nothing real to edit yet at that point, same
    // reasoning as its rename button's own guard further down.
    if (task && task.id > 0) setTaskModal(task);
  }

  // A *single* click on a task's own bar opens Progress Tracking
  // Override — the flow this whole feature is centered on ("the user
  // simply clicks the Gantt Chart schedule bar"). Phase rows are
  // excluded (a phase's own percent complete is only ever a rollup of
  // its tasks, never directly trackable — see percentCompleteByCategoryId's
  // own doc comment), and so are filler rows (never real tasks at all).
  //
  // Debounced against handleBarDoubleClick above by hand: gantt-task-
  // react wires onClick/onDoubleClick directly to the underlying DOM's
  // own click/dblclick events (confirmed directly by reading the
  // compiled bundle — no debounce of its own anywhere in there), and a
  // real double-click always fires two plain "click" events before its
  // own "dblclick" — so without this, double-clicking a bar to edit it
  // would also flash this modal open first. A short setTimeout is the
  // standard fix: wait to see whether a second click (i.e. a dblclick)
  // arrives before actually opening anything, and if handleBarDoubleClick
  // fires in the meantime, it cancels this pending timer instead.
  const barClickTimerRef = useRef<number | null>(null);
  function handleBarClick(row: GanttTask) {
    // Suppress the click that follows a real bar drag (move/resize/
    // progress) — see barJustDraggedRef's own doc comment above for why
    // this has to exist at all.
    if (barJustDraggedRef.current) return;
    if (row.type !== "task" && row.type !== "milestone") return;
    if (barClickTimerRef.current !== null) return;
    barClickTimerRef.current = window.setTimeout(() => {
      barClickTimerRef.current = null;
      const task = taskById.get(row.id);
      // Same placeholder-id exclusion as handleBarDoubleClick above —
      // recording progress against a not-yet-real task doesn't make
      // sense.
      if (task && task.id > 0) setProgressModal(task);
    }, 250);
  }
  useEffect(() => {
    return () => {
      if (barClickTimerRef.current !== null) {
        window.clearTimeout(barClickTimerRef.current);
      }
    };
  }, []);

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
  // Deliberately positioned here, after barPositions rather than right
  // next to visibleTasks (which it reads from) — the React Compiler
  // failed to preserve effectiveTasks' own memoization with it placed
  // any earlier, confirmed directly by bisecting hook position (the
  // exact same hazard usePendingOverrides' own doc comment
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
  const fillerTasks: GanttTask[] = Array.from(
    { length: fillerTaskCount },
    (_, i) => ({
      id: `${FILLER_ROW_ID_PREFIX}${i}`,
      type: "milestone",
      name: "",
      start: fillerDate,
      end: fillerDate,
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
  // effectiveTasks/visibleTasks (used everywhere else: barPositions,
  // connector hit-testing, the chart's own date-range calculation) so
  // none of that ever has to know filler rows exist.
  const chartTasks = [...effectiveTasks, ...fillerTasks];

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
  // awareness of its own). barDragActiveRef above can't be reused for
  // this — it's already reset to false by the time a click fires, since
  // click always comes after mouseup, not before it.
  const barJustDraggedRef = useRef(false);
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

    const startX = e.clientX;
    const startY = e.clientY;

    function onUp(ev: MouseEvent) {
      window.removeEventListener("mouseup", onUp);
      barDragActiveRef.current = false;
      setIsBarDragging(false);

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
    if (!taskById.has(task.id)) return false; // defensive — every real dragged row should already be in taskById
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
      inputEl.value = toIsoDate(field === "start" ? row.start : row.end);
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
      field === "end" ? value : isMilestone ? value : toIsoDate(row.end);
    persistTaskDates(Number(row.id), startIso, endIso);
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
    const result = await updateTaskPriority(taskId, projectId, priority);
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

  // The header's own "+" (Add task, next to the Task column label) —
  // creates a phase directly, no modal, per an explicit request that
  // adding one shouldn't need a form popup at all. "New Task" is a
  // placeholder, not a real name anyone's expected to keep: the newly
  // created row drops straight into its own inline rename input (see
  // editingCategoryId above) the instant this succeeds, so the very
  // next thing that happens is the admin typing over it.
  async function handleAddPhase() {
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
    setPendingNewPhase({
      categoriesAtSet,
      category: { id: tempId, name: "New Task", weight: 0, tasks: [] },
    });

    const formData = new FormData();
    formData.set("categoryName", "New Task");
    const result = await createCategory(projectId, {}, formData);
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually created — drop both markers so the button
      // re-enables and the placeholder row disappears immediately,
      // instead of staying stuck (neither `categories` nor
      // `categoriesAtSet` change on a failed create, so both would
      // otherwise keep reading as still in-flight forever).
      setAddingPhaseAt(null);
      setPendingNewPhase(null);
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
        category: { id: result.categoryId, name: "New Task", weight: 0, tasks: [] },
      });
      setEditingCategoryId(result.categoryId);
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
    if (activeNewTask) return;
    setScheduleError(null);

    // Same negative-id placeholder convention as handleAddPhase's own
    // tempId above — see its own comment for why.
    const tempId = -Date.now();
    const categoriesAtSet = categories;
    const placeholderTask: CostTask = {
      id: tempId,
      categoryId,
      name: "New Task",
      estimatedQuantity: 0,
      unit: null,
      laborEstimate: 0,
      materialEstimate: 0,
      equipmentEstimate: 0,
      otherCostEstimate: 0,
      otherCostItems: [],
      totalEstimateCost: 0,
      weight: 0,
      // Left dateless rather than guessing today/today the way an
      // empty *phase*'s own placeholder range does — resolvedDates()
      // inside the `tasks` memo already has a real fallback for a
      // dateless task (fallbackStart/fallbackEnd, project-start-or-
      // today plus a week), the same one any other dateless task
      // already renders with, so this doesn't need its own special
      // case.
      plannedStartDate: null,
      plannedEndDate: null,
      predecessorTaskId: null,
      isMilestone: false,
      priority: "medium",
      percentComplete: 0,
      materialAssignments: [],
      laborAssignments: [],
    };
    setPendingNewTask({ categoriesAtSet, categoryId, task: placeholderTask });

    const formData = new FormData();
    formData.set("taskName", "New Task");
    formData.set("categoryId", String(categoryId));
    const result = await createTask(projectId, {}, formData);
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually created — drop the placeholder so it
      // disappears immediately instead of staying stuck (`categories`
      // never changes on a failed create, so it'd otherwise keep
      // reading as still in-flight forever).
      setPendingNewTask(null);
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
      setEditingTaskId(result.taskId);
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
  async function handleCategoryRename(
    categoryId: number,
    value: string,
    previousValue: string
  ) {
    setEditingCategoryId(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed === previousValue) return;

    setScheduleError(null);
    setCategoryNameOverride(categoryId, trimmed);
    const formData = new FormData();
    formData.set("categoryName", trimmed);
    const result = await updateCategory(categoryId, projectId, {}, formData);
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually saved — drop the optimistic override so
      // the name falls back to the last-confirmed (server) value
      // instead of getting stuck showing a rename that never persisted.
      clearCategoryNameOverride(categoryId);
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
  async function handleTaskRename(
    taskId: number,
    value: string,
    previousValue: string
  ) {
    setEditingTaskId(null);
    const trimmed = value.trim();
    if (!trimmed || trimmed === previousValue) return;

    setScheduleError(null);
    setNameOverride(taskId, trimmed);
    const result = await renameTask(taskId, projectId, trimmed);
    if (result.error) {
      setScheduleError(result.error);
      // Nothing was actually saved — drop the optimistic override so
      // the name falls back to the last-confirmed (server) value
      // instead of getting stuck showing a rename that never persisted.
      clearNameOverride(taskId);
      return;
    }
    router.refresh();
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
                <button
                  type="button"
                  onClick={handleAddPhase}
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
          const isProject = row.type === "project";
          const isFiller = row.id.startsWith(FILLER_ROW_ID_PREFIX);
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
                className="flex h-full shrink-0 items-center gap-1 border-r border-zinc-200 px-2 text-zinc-800"
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
                  <input
                    key={category.id}
                    type="text"
                    autoFocus
                    defaultValue={
                      pendingCategoryNameOverrides.get(category.id) ?? category.name
                    }
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) =>
                      handleCategoryRename(category.id, e.target.value, category.name)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") setEditingCategoryId(null);
                    }}
                    aria-label="Phase name"
                    className="h-full min-w-0 flex-1 border-none bg-white px-1 text-xs font-bold text-zinc-800 outline-1 -outline-offset-1 outline-zinc-400"
                  />
                ) : isProject && category && category.id > 0 ? (
                  <button
                    type="button"
                    onClick={() => setEditingCategoryId(category.id)}
                    title="Click to rename"
                    className="min-w-0 flex-1 cursor-pointer truncate text-left font-bold transition hover:text-zinc-600"
                  >
                    {/* pendingCategoryNameOverrides' own doc comment (see
                        usePendingOverrides) — without this, closing the
                        rename input flashed back to the *old* row.name
                        for the whole router.refresh() round trip. */}
                    {pendingCategoryNameOverrides.get(category.id) ?? row.name}
                  </button>
                ) : isProject && category ? (
                  // The brief placeholder window (see handleAddPhase's
                  // own tempId comment) — a negative id means this row's
                  // real one hasn't come back from the server yet, so
                  // renaming here has nothing real to persist against.
                  // Plain, not clickable, same look otherwise; swaps to
                  // the button above itself the instant the real id
                  // lands (categoryById/tasks re-derive from the exact
                  // same pendingNewPhase update that swaps it in).
                  <span className="min-w-0 flex-1 truncate text-left font-bold">
                    {row.name}
                  </span>
                ) : !isProject && task && editingTaskId === task.id ? (
                  // Same inline rename input as a phase's own name above,
                  // just indented to match a task row's own nesting level.
                  // ml-6 (margin, not the pl-6 padding the static span/
                  // button below use) so the input's own outline box
                  // starts at the indent instead of spanning the full
                  // cell width with blank padded space inside it — with
                  // padding instead, the visible outline wrapped that
                  // empty space too, reading as oversized/misaligned
                  // against the indent it's supposed to match.
                  <input
                    key={task.id}
                    type="text"
                    autoFocus
                    defaultValue={pendingNameOverrides.get(task.id) ?? task.name}
                    onFocus={(e) => e.currentTarget.select()}
                    onBlur={(e) =>
                      handleTaskRename(task.id, e.target.value, task.name)
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                      else if (e.key === "Escape") setEditingTaskId(null);
                    }}
                    aria-label="Task name"
                    className="h-full min-w-0 flex-1 border-none bg-white ml-6 px-1 text-xs font-medium text-zinc-800 outline-1 -outline-offset-1 outline-zinc-400"
                  />
                ) : !isProject && task && task.id > 0 ? (
                  <button
                    type="button"
                    onClick={() => setEditingTaskId(task.id)}
                    title="Click to rename"
                    className={
                      // Same pl-6 nesting-indent reasoning as the former
                      // plain span here (phase names sit flush left of
                      // their own chevron, so an unindented task name
                      // read as the same hierarchy level instead of
                      // belonging *under* its phase), now on a button
                      // since the name itself is clickable-to-rename —
                      // same convention as a phase's own name button
                      // just above, not bold since a task row isn't.
                      "min-w-0 flex-1 cursor-pointer truncate pl-6 text-left font-medium transition hover:text-zinc-600"
                    }
                  >
                    {/* pendingNameOverrides' own doc comment (see
                        usePendingOverrides) — without this, closing the
                        rename input (editingTaskId clears immediately)
                        flashed back to the *old* row.name for the whole
                        router.refresh() round trip before jumping to the
                        new one. */}
                    {pendingNameOverrides.get(task.id) ?? row.name}
                  </button>
                ) : (
                  // Filler rows, or a brand new subtask's own temporary
                  // placeholder id (see handleAddSubtask's own tempId
                  // comment — renaming it here would have nothing real
                  // to persist against yet) — plain, unclickable either
                  // way.
                  <span className="min-w-0 flex-1 truncate pl-6 font-medium">
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
                    <button
                      type="button"
                      onClick={() => handleAddSubtask(category.id)}
                      aria-label={`Add task to ${category.name}`}
                      title="Add task"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setCategoryModal(category)}
                      aria-label="Edit category"
                      title="Edit phase"
                      className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
                    >
                      <EditIcon className="size-3.5" />
                    </button>
                  </>
                ) : isProject ? null : (
                  !isProject &&
                  task &&
                  task.id > 0 && (
                    <button
                      type="button"
                      onClick={() => setTaskModal(task)}
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
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.start }}
                data-phase-info-cell={isProject ? true : undefined}
                onClick={
                  isProject
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
                ) : isFiller ? null : (
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
                      handleTaskDateEdit(row, "start", e.target.value, e.target);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`${row.name} start date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100"
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
                data-phase-info-cell={isProject ? true : undefined}
                onClick={
                  isProject
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
                ) : isFiller ? null : (
                  <input
                    // See the matching comment on the Start input above.
                    key={toIsoDate(row.end)}
                    type="date"
                    defaultValue={toIsoDate(row.end)}
                    onFocus={(e) => {
                      e.currentTarget.dataset.cellActive = "true";
                    }}
                    onBlur={(e) => {
                      delete e.currentTarget.dataset.cellActive;
                      handleTaskDateEdit(row, "end", e.target.value, e.target);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    aria-label={`${row.name} end date`}
                    className="h-full w-full cursor-pointer border-none bg-transparent px-2 text-xs text-zinc-600 scheme-light hover:bg-zinc-100"
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
                {isFiller ? null : row.type === "milestone" ? "—" : days}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.priority }}
              >
                {/* Phase rows have no priority of their own (task ===
                    undefined here) — a phase's priority, if it needs
                    one, is a rollup question for later, not something
                    stored directly on the category. A plain <select>,
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
                {task &&
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
                        <select
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
                          className={`h-full w-full cursor-pointer appearance-none border-none bg-transparent px-2 pr-6 text-xs hover:bg-zinc-100 ${
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
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-2 size-3.5 text-zinc-400" />
                      </>
                    );
                  })()}
              </div>
              <div
                className="flex h-full shrink-0 items-center border-r border-zinc-200"
                style={{ width: columnWidths.assigned }}
              >
                {/* Same reasoning as Priority above — phase rows have no
                    assignment of their own, only their tasks do. */}
                {task &&
                  task.id > 0 &&
                  (() => {
                    const assignedIds = taskWorkerAssignments[task.id] ?? [];
                    const names = assignedIds
                      .map((id) => workerById.get(id)?.fullName)
                      .filter((name): name is string => Boolean(name));
                    return (
                      <button
                        type="button"
                        onClick={() =>
                          setAssignWorkersModal({
                            taskId: task.id,
                            taskName: task.name,
                          })
                        }
                        title="Assign workers"
                        className={`h-full w-full cursor-pointer truncate px-2 text-left transition hover:bg-zinc-100 ${
                          names.length > 0 ? "text-zinc-700" : "text-zinc-400"
                        }`}
                      >
                        {names.length > 0 ? names.join(", ") : "Assign"}
                      </button>
                    );
                  })()}
              </div>
              <div
                className="relative flex h-full shrink-0 items-center"
                style={{ width: columnWidths.percentComplete }}
                data-phase-info-cell={isProject ? true : undefined}
                onClick={
                  isFiller
                    ? undefined
                    : isProject
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
                      : // Task/milestone rows: same destination as clicking
                        // the task's own bar in the chart (handleBarClick
                        // above) — open Progress Tracking directly instead
                        // of an info tooltip, since there's now a real
                        // action to take here, not just something to
                        // explain. task.id > 0 excludes handleAddSubtask's
                        // own brief placeholder row, same reasoning as
                        // handleBarClick's own guard.
                        () => {
                          if (task && task.id > 0) setProgressModal(task);
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
                {!isFiller && (
                  <span className="flex h-full w-full cursor-pointer items-center truncate px-2 text-xs text-zinc-600 transition hover:bg-zinc-100">
                    {row.progress}%
                  </span>
                )}
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
                          above. Only ever reachable for a phase row now —
                          a task/milestone row opens Progress Tracking
                          directly on click instead (see the onClick above),
                          so this text no longer needs a task-row branch. */}
                      <div className="absolute -top-1.5 left-4 size-3 rotate-45 bg-zinc-900" />
                      This is calculated automatically and shows the
                      cumulative percent complete of all subtasks.
                    </div>,
                    document.body
                  )}
              </div>
            </div>
          );
        })}
      </div>
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
        {/* Deliberately just Undo/Redo/Members — a reference toolbar
            image with ~25 icons (text color, cut/copy/paste, zoom,
            print, share, lock, settings, ...) was the original ask, but
            none of those other actions have a real feature behind them
            in this app, so they're not here as decoration. */}
        <div className="flex items-center gap-1 border border-t-2 border-zinc-200 border-t-zinc-900 bg-zinc-50 px-2 py-1.5">
          <button
            type="button"
            onClick={handleUndo}
            disabled={!historyReady || !effectiveCanUndo || isUndoRedoPending}
            aria-label="Undo"
            title="Undo (Ctrl+Z)"
            className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Undo2 className="size-4" />
          </button>
          <button
            type="button"
            onClick={handleRedo}
            disabled={!historyReady || !effectiveCanRedo || isUndoRedoPending}
            aria-label="Redo"
            title="Redo (Ctrl+Y)"
            className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900 disabled:cursor-not-allowed disabled:text-zinc-300 disabled:hover:bg-transparent"
          >
            <Redo2 className="size-4" />
          </button>
          <div className="mx-1 h-5 w-px bg-zinc-200" />
          {/* Week isn't offered here — see the `view` state's own doc
              comment above for why. */}
          {TIMELINE_VIEW_OPTIONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setView(option)}
              aria-pressed={view === option}
              title={`Zoom to ${option}`}
              className={`cursor-pointer rounded px-2 py-1 text-xs font-medium capitalize transition ${
                view === option
                  ? "bg-zinc-900 text-white"
                  : "text-zinc-500 hover:bg-zinc-200 hover:text-zinc-900"
              }`}
            >
              {option}
            </button>
          ))}
          <div className="mx-1 h-5 w-px bg-zinc-200" />
          <button
            type="button"
            onClick={() => setMembersModalOpen(true)}
            aria-label="Members"
            title="Manage the project's members"
            className="cursor-pointer rounded p-1.5 text-zinc-500 transition hover:bg-zinc-200 hover:text-zinc-900"
          >
            <HardHat className="size-4" />
          </button>
          {/* ml-auto on the last item pushes just itself (nothing else
              in this row needs to move) to the toolbar's own right
              edge — the one action here that starts something new
              (drafting a whole schedule from a document) rather than
              adjusting the existing one, so it reads as visually
              distinct from the Undo/Redo/zoom/Members cluster on the
              left. Opens the same shared modal instance the Cost
              Estimate Breakdown's own entry points do — see this
              component's own onImportBom prop doc comment. */}
          <button
            type="button"
            onClick={onImportBom}
            className="ml-auto flex cursor-pointer items-center gap-1.5 rounded border border-zinc-800 bg-zinc-800 px-2.5 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-950"
          >
            <Sparkles className="size-3.5" />
            Import BOM
          </button>
        </div>

        {/* Always the real chart, even with zero phases yet — a plain
            "add your first phase" placeholder here used to replace the
            whole chart outright, but the chart already renders as a
            full, real-looking grid with nothing in it (the filler-row
            system below pads a short/empty project out to a minimum
            height on its own, same mechanism a short *populated*
            project already relies on), so there's no need to swap in a
            separate empty state — the header's own "+" (Add task, see
            CustomTaskListHeader) and the toolbar's Import BOM button
            above are both already reachable with zero phases, same as
            with any number of them. */}
        <>
            {/* Expand/Collapse-all and Show/Hide Task List are still
                removed for now — the Gantt chart's own toolbar gets a
                fuller design pass later. Day/Month/Year zoom is live
                (see the toolbar row above); showTaskList itself stays
                at its own default (true) with no UI to change it yet. */}

            <div
              ref={chartOuterRef}
              // isolate: gives everything inside this box its own
              // stacking context, so none of its internal z-index
              // values (the panel-resize handle, connector handles,
              // milestone labels, the connector-drag svg — z-10 through
              // z-50) can ever compete with page-level elements outside
              // this box, like project-detail-view.tsx's own sticky
              // tabs bar (z-20). Confirmed directly this was a real bug
              // without it: the panel-resize handle's own z-20 tied
              // with the tabs bar's z-20, and being later in the DOM,
              // won that tie and painted over the tabs once scrolled
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
            >
              <div
                ref={ganttRootRef}
                className="relative"
                onMouseDown={handleChartMouseDown}
                onMouseMove={handleChartMouseMove}
                onMouseLeave={handleChartMouseLeave}
              >
                <Gantt
                  tasks={chartTasks}
                  viewMode={VIEW_MODE[view]}
                  rowHeight={ROW_HEIGHT}
                  headerHeight={HEADER_HEIGHT}
                  listCellWidth={showTaskList ? `${visiblePanelWidth}px` : ""}
                  columnWidth={effectiveColumnWidth}
                  todayColor="rgba(252, 211, 77, 0.15)"
                  TooltipContent={GanttTooltipContent}
                  TaskListHeader={CustomTaskListHeader}
                  TaskListTable={CustomTaskListTable}
                  onDateChange={(task) => persistDrag(task)}
                  onClick={handleBarClick}
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
                {/* The whole task-list panel's own resize handle — see
                    handlePanelResizeMouseDown's own doc comment. Height
                    computed directly (header + one row per currently
                    visible row, filler rows included so it reaches the
                    same padded-out minimum height those give the rest
                    of the chart) rather than a percentage, since this
                    element's own containing block (ganttRootRef) is
                    auto-height, and percentage heights don't resolve
                    against an auto-height ancestor. */}
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
      </div>

      <Modal
        open={categoryModal !== null}
        onClose={() => setCategoryModal(null)}
        title="Edit Phase"
      >
        {categoryModal && (
          <CategoryForm
            projectId={projectId}
            category={categoryModal}
            showDeleteButton
            onSuccess={() => setCategoryModal(null)}
          />
        )}
      </Modal>

      <Modal
        open={taskModal !== null}
        onClose={() => setTaskModal(null)}
        title="Edit Task"
      >
        {taskModal && (
          <SubtaskForm
            projectId={projectId}
            categoryId={taskModal.categoryId}
            task={taskModal}
            siblingTasks={
              categories.find((c) => c.id === taskModal.categoryId)?.tasks ??
              []
            }
            onSuccess={() => setTaskModal(null)}
          />
        )}
      </Modal>

      <Modal
        open={membersModalOpen}
        onClose={() => setMembersModalOpen(false)}
        title="Members"
      >
        <MembersModalContent
          projectId={projectId}
          workers={workers}
          onClose={() => setMembersModalOpen(false)}
        />
      </Modal>

      <Modal
        open={assignWorkersModal !== null}
        onClose={() => setAssignWorkersModal(null)}
        title="Assign Workers"
      >
        {assignWorkersModal && (
          <AssignWorkersModalContent
            projectId={projectId}
            taskId={assignWorkersModal.taskId}
            taskName={assignWorkersModal.taskName}
            workers={workers}
            assignedWorkerIds={taskWorkerAssignments[assignWorkersModal.taskId] ?? []}
            onClose={() => setAssignWorkersModal(null)}
          />
        )}
      </Modal>

      <Modal
        open={progressModal !== null}
        onClose={() => setProgressModal(null)}
        title="Progress Tracking"
      >
        {progressModal && (
          <ProgressTrackingModalContent
            projectId={projectId}
            task={progressModal}
            materials={materials}
            progressToday={
              taskProgressToday[progressModal.id] ?? {
                cumulativeQuantityCompleted: 0,
                today: null,
              }
            }
            onClose={() => setProgressModal(null)}
          />
        )}
      </Modal>
    </div>
  );
}
