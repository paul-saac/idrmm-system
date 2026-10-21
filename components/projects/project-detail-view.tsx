"use client";
import { SheetsSection } from "@/components/projects/sheets/sheets-section";
import type { listSheets } from "@/lib/sheets/actions";

import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Trash2, LayoutGrid, CircleDollarSign, CalendarDays, PiggyBank, ChevronRight, Wallet } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { HeaderActions } from "@/components/auth/header-actions";
import { usePortal } from "@/components/portal/portal-context";
import { EditProjectForm } from "@/components/projects/edit-project-form";
import { ProjectHeader } from "@/components/projects/project-header";
import { CostEstimateView } from "@/components/projects/cost-estimate/cost-estimate-view";
import {
  ImportBomModalContent,
  type ImportBomStep,
} from "@/components/projects/cost-estimate/import-bom-modal-content";
import { ProgressView } from "@/components/projects/progress/progress-view";
import { ProgressTrackingModal, type ProgressModalTarget } from "@/components/projects/progress/progress-tracking-modal";
// gantt-task-react renders its timeline as an SVG sized from
// client-measured container layout, computed post-mount — loaded with
// ssr:false so that mismatch never reaches hydration at all, instead of
// rendering it on the server just to have the client patch it over.
const GanttChartView = dynamic(
  () =>
    import("@/components/projects/progress/gantt-chart-view").then(
      (mod) => mod.GanttChartView
    ),
  {
    ssr: false,
    loading: () => (
      <div className="h-140 animate-pulse rounded-lg border border-zinc-200 bg-zinc-50" />
    ),
  }
);
import { DailyLogsView } from "@/components/projects/daily-logs/daily-logs-view";
import { MaterialsOverviewView } from "@/components/projects/materials/materials-overview-view";
import {
  MaterialsMonitoringView,
  type MaterialsRecordView,
} from "@/components/projects/materials/materials-monitoring-view";
import { EquipmentOverviewView } from "@/components/projects/equipment/equipment-overview-view";
import {
  EquipmentRecordView,
  type EquipmentRecordList,
} from "@/components/projects/equipment/equipment-record-view";
import { ProgressExpensesView } from "@/components/projects/expenses/progress-expenses-view";
import type { ProgressExpense } from "@/lib/expenses/progress";
import type {
  MaterialsOverviewCounts,
  ProgressMaterialUsage,
  ProjectMaterial,
} from "@/lib/materials/data";
import type { MaterialRecord } from "@/lib/materials/records";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";
import type { EquipmentRequestDetail } from "@/lib/equipment-requests/data";
import type { EquipmentAssignmentRow, EquipmentTaskMovementRow, ProgressEquipmentCost } from "@/lib/equipment/data";
import type { EquipmentCostRecord } from "@/lib/equipment/records";
import { deleteProject, type ProjectActionState } from "@/lib/projects/actions";
import type { ProjectRow } from "@/lib/projects/data";
import type { AccountRow } from "@/lib/accounts/data";
import type { CostEstimate } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";
import type { DelayRiskAssessment } from "@/lib/forecasting/data";
import type { DailyLogSummary, SurveyQuestion } from "@/lib/daily-logs/data";
import type {
  Worker,
  WorkerAssignment,
  MemberGroup,
  TaskWorkerAssignments,
  CategoryWorkerAssignments,
} from "@/lib/workers/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";
import type { ProjectOverrideHistory } from "@/lib/progress-logs/types";
import { sumCosts } from "@/lib/task-progress/calculate";
import type { ProjectEvent } from "@/lib/project-events/types";

const MAIN_TABS = [
  { value: "overview", label: "Overview" },
  { value: "progress", label: "Progress" },
  { value: "materials", label: "Materials" },
  { value: "equipment", label: "Equipment" },
  { value: "expenses", label: "Expenses" },
] as const;
type MainTab = (typeof MAIN_TABS)[number]["value"];

// "Progress" (the Gantt Chart, Daily Logs, Progress Tracking, etc.) is
// on hold per an explicit request — everything underneath it stays in
// the codebase untouched (this is purely a nav-visibility change, not a
// removal), since where each of its own features eventually lands is
// still undecided. Only the visible tab BAR filters it out below;
// MAIN_TABS itself (and MainTab/activeTab's own type) still includes
// "progress" so the tab's own content-rendering branch, the breadcrumb
// label lookup, and a deep link into it (e.g. a Daily Log detail page's
// own back button, see initialTab below) all keep working exactly as
// before — there's just no button here to click into it from.
const VISIBLE_MAIN_TABS = MAIN_TABS.filter((tab) => tab.value !== "progress");

const PROGRESS_SUB_TABS = [
  { value: "overview", label: "Progress Overview" },
  { value: "daily-logs", label: "Daily Logs" },
] as const;
type ProgressSubTab = (typeof PROGRESS_SUB_TABS)[number]["value"];


const deleteInitialState: ProjectActionState = {};

function formatCurrency(amount: number | null) {
  return amount != null ? `₱${amount.toLocaleString("en-PH")}` : "—";
}

/**
 * Scrolls `area` — and only it — to put `target` at its top, below what
 * its scroll-mt clears (the sticky tabs bar). Not scrollIntoView, which
 * also moves whatever's around the area when the area can't scroll that
 * far — the whole app sliding up, a blank strip under it.
 */
function scrollAreaTo(area: HTMLElement, target: Element, behavior: ScrollBehavior = "auto") {
  const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
  area.scrollTo({
    top: area.scrollTop + target.getBoundingClientRect().top - area.getBoundingClientRect().top - margin,
    behavior,
  });
}

/**
 * A main tab's row of sub-tab pills, plus a slot on the right for that
 * sub-tab's own toolbar (filters, "Add X" buttons) to portal into — see
 * DailyLogsView/MaterialsMonitoringView/MaterialRequestsView/
 * EquipmentRequestsView's own `toolbarSlot` prop. Portaling instead of
 * lifting each view's filter/modal state up here keeps every one of
 * those views' internals untouched; only where their existing toolbar
 * JSX renders changes. `items-start` (not `items-center`) is
 * deliberate: the toolbar's buttons should align to the tabs' top edge,
 * not float centered against them.
 */
function SubTabsRow<T extends string>({
  tabs,
  active,
  onChange,
  toolbarRef,
}: {
  tabs: readonly { value: T; label: string }[];
  active: T;
  onChange: (value: T) => void;
  toolbarRef: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div className="mt-4 mb-4 flex flex-wrap items-start justify-between gap-3">
      <div className="flex items-center gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => onChange(tab.value)}
            className={`cursor-pointer rounded border px-4 py-0.5 text-xs font-medium transition ${active === tab.value
              ? "border-zinc-900 bg-zinc-900 text-white"
              : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"
              }`}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div ref={toolbarRef} className="flex flex-wrap items-center gap-2" />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: ReactNode;
}) {
  return (
    <div className="p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-zinc-500">{label}</p>
        <span className="flex-shrink-0 text-zinc-400">{icon}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-zinc-900">{value}</p>
    </div>
  );
}

// Rendered inside a centered Modal (see the delete-confirm Modal below),
// never a window.confirm() — an admin deleting an entire project is a
// real, hard-to-reverse action worth a proper dialog, not a bare browser
// alert. Opened only from the Edit Project panel's own Delete button,
// which closes the Edit Project modal in the same click that opens this
// one (see EditProjectForm's onRequestDelete below) so the two never
// stack.
function DeleteProjectModalContent({
  projectId,
  projectName,
  onClose,
}: {
  projectId: number;
  projectName: string;
  onClose: () => void;
}) {
  const boundAction = deleteProject.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <div className="flex flex-col gap-5">
      <p className="text-sm text-zinc-600">
        Delete <span className="font-medium text-zinc-900">{projectName}</span>
        ? This cannot be undone.
      </p>
      {state?.error && (
        <p role="alert" className="text-sm text-red-600">
          {state.error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <form action={formAction}>
          <button
            type="submit"
            disabled={pending}
            className="flex cursor-pointer items-center gap-1.5 rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Trash2 className="size-3.5" />
            {pending ? "Deleting..." : "Delete"}
          </button>
        </form>
      </div>
    </div>
  );
}

export function ProjectDetailView({
  project,
  projectManagers,
  foremen,
  costEstimate,
  progress,
  risk,
  dailyLogs,
  surveyQuestions,
  materials,
  materialsCounts,
  materialRecords,
  recentMaterialUsage,
  materialRequests,
  fulfillableMaterialRequests,
  equipmentRequests,
  fulfillableEquipmentRequests,
  progressExpenses,
  currentUserName,
  projectEquipmentAssignments,
  equipmentTaskMovements,
  equipmentCostRecords,
  equipmentCostLogs,
  recentEquipmentCosts,
  ganttCanUndo,
  ganttCanRedo,
  workers,
  workerAssignments,
  memberGroups,
  taskWorkerAssignments,
  categoryWorkerAssignments,
  taskProgressToday,
  categoryProgressToday,
  overrideHistory,
  events,
  sheetsResult,
}: {
  project: ProjectRow;
  projectManagers: AccountRow[];
  foremen: AccountRow[];
  costEstimate: CostEstimate;
  progress: ProjectProgress;
  risk: DelayRiskAssessment;
  dailyLogs: DailyLogSummary[];
  surveyQuestions: SurveyQuestion[];
  materials: ProjectMaterial[];
  materialsCounts: MaterialsOverviewCounts;
  /** Every material the project has, each once — planned, used, in
   * stock (buildMaterialRecords) — the Materials tab's Material record. */
  materialRecords: MaterialRecord[];
  /** The Materials tab's recent activity — the newest materials used,
   * from the progress window (listProgressMaterialUsage). */
  recentMaterialUsage: ProgressMaterialUsage[];
  /** The project's material requests, newest first, in full — the
   * Materials tab's count, its Material requests panel and its Material
   * record's requests, each opening in its row. */
  materialRequests: MaterialRequestDetail[];
  /** Requests that can still receive a delivery — for the Add Daily
   * Log modal's Material Procurement "Select Material Request" picker. */
  fulfillableMaterialRequests: MaterialRequestDetail[];
  /** The project's equipment requests, newest first, in full — the
   * Equipment tab's count, its requests panel and its record's requests,
   * each opening in its row. */
  equipmentRequests: EquipmentRequestDetail[];
  /** Requests that can still receive an acquisition — for the Add Daily
   * Log modal's Equipment Acquisition "Select Equipment Request" picker. */
  fulfillableEquipmentRequests: EquipmentRequestDetail[];
  progressExpenses: ProgressExpense[];
  currentUserName: string;
  projectEquipmentAssignments: EquipmentAssignmentRow[];
  equipmentTaskMovements: EquipmentTaskMovementRow[];
  /** Every task's equipment cost — the Equipment record's Equipment cost
   * view (buildEquipmentCostRecords). */
  equipmentCostRecords: EquipmentCostRecord[];
  /** Every non-zero equipment cost saved in a Progress Tracking Override,
   * newest first. The Equipment record lists these as individual rows. */
  equipmentCostLogs: ProgressEquipmentCost[];
  /** The newest equipment costs typed into progress updates — the
   * Equipment overview's recent activity. */
  recentEquipmentCosts: ProgressEquipmentCost[];
  /** Whether the Gantt Chart's own Undo/Redo toolbar buttons should be
   * enabled — see lib/cost-estimate/undo-redo.ts's getGanttUndoRedoState,
   * fetched alongside costEstimate/progress in page.tsx. */
  ganttCanUndo: boolean;
  ganttCanRedo: boolean;
  /** The company Team (the Team page) + each task's current
   * assignments from it — see lib/workers/data.ts, fetched alongside
   * costEstimate/progress in page.tsx. */
  workers: Worker[];
  /** Every Team member's open assignments — see lib/workers/data.ts. */
  workerAssignments: WorkerAssignment[];
  /** The Team's groups (crews) — the Assign picker adds a whole one at
   * once. */
  memberGroups: MemberGroup[];
  taskWorkerAssignments: TaskWorkerAssignments;
  /** Same idea, one level up — see CategoryWorkerAssignments's own doc
   * comment. */
  categoryWorkerAssignments: CategoryWorkerAssignments;
  /** Every task's own cumulative-to-date total plus whatever's already
   * recorded for today — see lib/task-progress/data.ts, fetched
   * alongside costEstimate/progress in page.tsx. Powers the Gantt
   * Chart's own Progress Tracking modal. */
  taskProgressToday: Record<number, TaskProgressToday>;
  /** Same idea, one level up, for a task-less category's own Progress
   * Tracking Override — see lib/category-progress/data.ts, fetched
   * alongside costEstimate/progress in page.tsx. */
  categoryProgressToday: Record<number, TaskProgressToday>;
  /** All override histories, preloaded so the Gantt modal has no loading state. */
  overrideHistory: ProjectOverrideHistory;
  /** The project's calendar events — see lib/project-events/data.ts. */
  events: ProjectEvent[];
  /** Preloaded sheets so opening the Sheets dropdown has no loading state. */
  sheetsResult?: Awaited<ReturnType<typeof listSheets>>;
}) {
  // Reading the initial tab/sub-tab from the URL lets a link *into* this
  // page (e.g. a Daily Log detail page's back button) land on the exact
  // tab it came from, instead of always resetting to Overview — this is
  // otherwise a fully client-state tabbed view with no URL sync per tab
  // click, so this is only ever read once, on mount.
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const subtabParam = searchParams.get("subtab");
  const initialTab: MainTab = MAIN_TABS.some((tab) => tab.value === tabParam)
    ? (tabParam as MainTab)
    : "overview";

  // In the foreman portal the project itself is read-only (no Edit/Delete
  // Project), and — DAILY LOGS ON HOLD — the Daily Logs sub-tab is left out
  // entirely, even for a deep link straight into it.
  const { basePath, isAdmin } = usePortal();
  const progressSubTabs = isAdmin
    ? PROGRESS_SUB_TABS
    : PROGRESS_SUB_TABS.filter((tab) => tab.value !== "daily-logs");

  const [activeTab, setActiveTab] = useState<MainTab>(initialTab);
  // Shared progress URLs still land on the Gantt chart in Overview.
  // Equipment-row clicks open the shared modal directly below.
  const progressTarget = searchParams.get("progress");
  const [handledProgressTarget, setHandledProgressTarget] = useState<string | null>(null);
  if (progressTarget !== handledProgressTarget) {
    setHandledProgressTarget(progressTarget);
    if (progressTarget) setActiveTab("overview");
  }
  const [activeProgressSubTab, setActiveProgressSubTab] =
    useState<ProgressSubTab>(
      initialTab === "progress" &&
        progressSubTabs.some((tab) => tab.value === subtabParam)
        ? (subtabParam as ProgressSubTab)
        : "overview"
    );
  const [editOpen, setEditOpen] = useState(false);
  // The Delete Project confirmation modal — a separate piece of state
  // from editOpen (not a second "screen" inside the same Modal) so the
  // two can never both be true at once and stack; the ⋮ menu's Delete below
  // always flips both in the same click.
  const [deleteProjectConfirmOpen, setDeleteProjectConfirmOpen] =
    useState(false);
  // The DOM node the active sub-tab's own toolbar (filters, "Add X"
  // buttons) portals into — see SubTabsRow below. Only one sub-view is
  // ever mounted at a time, so one shared slot is enough; a callback
  // ref (not useRef) so its first non-null value still triggers the
  // re-render the portaled child needs to actually appear.
  const [toolbarSlotEl, setToolbarSlotEl] = useState<HTMLDivElement | null>(
    null
  );
  // The Project Overview sub-tab's stat cards + cost chart are merged
  // into one collapsible card (per adviser feedback) — PM/Foreman/
  // progress/dates used to sit in their own "General Information" card
  // above this, but that's now redundant with the sticky project header,
  // which already shows all of it. Closed until "View breakdown".
  const [costOverviewOpen, setCostOverviewOpen] = useState(false);
  // The Materials tab's Material record: its materials, or its material
  // requests — the Material overview's See all opens the latter, and
  // scrolls down to it, as does a link to them
  // (?tab=materials&subtab=requests), or to one of them, which it opens
  // (&request=7 — the dashboard's).
  const landOnRequests = initialTab === "materials" && subtabParam === "requests";
  const landOnRequestId = landOnRequests
    ? Number(searchParams.get("request")) || undefined
    : undefined;
  const [materialsRecordView, setMaterialsRecordView] =
    useState<MaterialsRecordView>(landOnRequests ? "requests" : "materials");
  const materialsRecordRef = useRef<HTMLDivElement>(null);
  // The page's own scrolling area — everything here scrolls in it.
  const pageScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!landOnRequests) return;
    // Instant, not smooth — it's where the page opens, not a move. To the
    // request's own row when there's one, the record's top otherwise.
    const row = landOnRequestId
      ? materialsRecordRef.current?.querySelector(`[data-request-id="${landOnRequestId}"]`)
      : null;
    const target = row ?? materialsRecordRef.current;
    if (pageScrollRef.current && target) scrollAreaTo(pageScrollRef.current, target);
  }, [landOnRequests, landOnRequestId]);
  // The record's requests opened to their details — here, not in the
  // record, so a request in the Material overview can open there too.
  const [openRequestIds, setOpenRequestIds] = useState<ReadonlySet<number>>(
    () => new Set(landOnRequestId ? [landOnRequestId] : [])
  );
  function toggleRequest(id: number) {
    setOpenRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // A request's row in the Material overview: the record's requests, that
  // one open, scrolled to — committed first (flushSync) so its row is
  // there to scroll to; the record's top if a filter there hides it.
  function openRequestInRecord(id: number) {
    flushSync(() => {
      setMaterialsRecordView("requests");
      setOpenRequestIds((prev) => new Set(prev).add(id));
    });
    const target =
      materialsRecordRef.current?.querySelector(`[data-request-id="${id}"]`) ??
      materialsRecordRef.current;
    if (pageScrollRef.current && target) scrollAreaTo(pageScrollRef.current, target, "smooth");
  }

  // The Equipment tab's Equipment record, the Material record's twin: its
  // cost, its assigned equipment, or its requests. A link to the latter
  // two (?tab=equipment&subtab=assigned|requests) opens that list, scrolled
  // to — and a request in it (&request=7, the dashboard's), opened.
  const landOnEquipmentList: EquipmentRecordList | null =
    initialTab === "equipment" && (subtabParam === "assigned" || subtabParam === "monitoring" || subtabParam === "requests")
      ? subtabParam
      : null;
  const landOnEquipmentRequestId =
    landOnEquipmentList === "requests"
      ? Number(searchParams.get("request")) || undefined
      : undefined;
  const [equipmentRecordList, setEquipmentRecordList] = useState<EquipmentRecordList>(
    landOnEquipmentList ?? "cost"
  );
  const equipmentRecordRef = useRef<HTMLDivElement>(null);
  const requestTarget = `${tabParam}:${subtabParam}:${searchParams.get("request")}`;
  const [handledRequestTarget, setHandledRequestTarget] = useState(requestTarget);
  if (requestTarget !== handledRequestTarget) {
    setHandledRequestTarget(requestTarget);
    if (subtabParam === "requests" && (tabParam === "materials" || tabParam === "equipment")) {
      setActiveTab(tabParam);
      if (tabParam === "materials") setMaterialsRecordView("requests");
      else setEquipmentRecordList("requests");
    }
  }
  useEffect(() => {
    if (!landOnEquipmentList) return;
    // As the Material record's own landing above: to the request's row
    // when there's one, the record's top otherwise.
    const row = landOnEquipmentRequestId
      ? equipmentRecordRef.current?.querySelector(`[data-request-id="${landOnEquipmentRequestId}"]`)
      : null;
    const target = row ?? equipmentRecordRef.current;
    if (pageScrollRef.current && target) scrollAreaTo(pageScrollRef.current, target);
  }, [landOnEquipmentList, landOnEquipmentRequestId]);
  // The record's requests opened to their details — here, so a request in
  // the Equipment overview can open there too.
  const [openEquipmentRequestIds, setOpenEquipmentRequestIds] = useState<ReadonlySet<number>>(
    () => new Set(landOnEquipmentRequestId ? [landOnEquipmentRequestId] : [])
  );
  function toggleEquipmentRequest(id: number) {
    setOpenEquipmentRequestIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // A request's row in the Equipment overview — openRequestInRecord, for
  // equipment.
  function openEquipmentRequestInRecord(id: number) {
    flushSync(() => {
      setEquipmentRecordList("requests");
      setOpenEquipmentRequestIds((prev) => new Set(prev).add(id));
    });
    const target =
      equipmentRecordRef.current?.querySelector(`[data-request-id="${id}"]`) ??
      equipmentRecordRef.current;
    if (pageScrollRef.current && target) scrollAreaTo(pageScrollRef.current, target, "smooth");
  }

  const [equipmentProgressTarget, setEquipmentProgressTarget] =
    useState<ProgressModalTarget | null>(null);

  function openEquipmentProgressLog(itemKey: string, entryDate: string) {
    // Open the same modal as Gantt directly, without a route round trip
    // or waiting for the chart to mount. Its history is already loaded.
    const [kind, rawId] = itemKey.split("-");
    const id = Number(rawId);
    if (kind === "task") {
      const task = costEstimate.categories.flatMap((category) => category.tasks)
        .find((task) => task.id === id);
      if (task && !task.isMilestone) {
        setEquipmentProgressTarget({ kind, task, highlightEntryDate: entryDate });
      }
    } else if (kind === "category") {
      const category = costEstimate.categories.find((category) => category.id === id);
      if (category && category.tasks.length === 0 && !category.isMilestone) {
        setEquipmentProgressTarget({ kind, category, highlightEntryDate: entryDate });
      }
    }
  }

  // Opens the shared "Import with AI" modal from the Material Breakdown
  // modal's own footer (see MaterialBreakdownModalContent) — lifted up
  // here rather than owned by CostEstimateView so the same modal
  // instance could still be reused if another entry point needs one
  // later (now also the Gantt Chart's own toolbar — see onImportBom
  // below). Still named "Bom" internally (the file/component/action
  // names) even though the modal no longer calls itself that anywhere a
  // user sees — a Bill of Materials just happens to be the first
  // document shape this was built for, not the only one it accepts.
  const [importBomModalOpen, setImportBomModalOpen] = useState(false);
  // Which step ImportBomModalContent is currently showing — reported up
  // via its own onStepChange so this Modal can widen itself (size=
  // "large") only for "review" (a spreadsheet-sized draft genuinely
  // needs the room) and stay at the ordinary default width for every
  // other step (upload, a spinner, a done message), which would
  // otherwise look lost stretched that wide. Reset to "upload" directly
  // in each open-call below (not left to ImportBomModalContent's own
  // mount-time report) so the dialog never opens one frame wide from a
  // previous session's leftover "review" step.
  const [importBomStep, setImportBomStep] = useState<ImportBomStep>("upload");
  // The Material Breakdown modal's own open state, lifted up here (same
  // reasoning as importBomModalOpen above) since the Gantt Chart's own
  // Edit Task form needs to open it too, from a completely different
  // subtree than CostEstimateView's own "Material" column header
  // trigger — see openMaterialBreakdown below. highlightTaskId carries
  // which task's own row (if any) to scroll to and flash once it opens;
  // null means "just open it plain," same as the header trigger already
  // did before this existed.
  const [materialBreakdownOpen, setMaterialBreakdownOpen] = useState(false);
  const [materialBreakdownHighlightTaskId, setMaterialBreakdownHighlightTaskId] =
    useState<number | null>(null);

  function openMaterialBreakdown(taskId?: number) {
    setMaterialBreakdownHighlightTaskId(taskId ?? null);
    setMaterialBreakdownOpen(true);
  }

  // The breadcrumb tracks only the main tab (Overview/Progress/
  // Materials/Equipment/Expenses) — switching a sub-tab within one of
  // those (e.g. Progress Overview -> Daily Logs) must not change it.
  const breadcrumbLabel = MAIN_TABS.find((tab) => tab.value === activeTab)!
    .label;

  // What's been spent, from the Daily Progress Updates: every task's (and
  // task-less phase's) cost to date — the labor, equipment and other cost
  // typed into its updates and the materials logged there, plus each
  // working day without an update counting its planned share (see
  // CostEstimateSummary.costsToDate). Not the Expenses tab's ledgers,
  // which only daily logs (on hold) fill.
  const actualExpenseTotal = sumCosts(costEstimate.summary.costsToDate);

  const remainingBudget =
    project.allocatedBudget != null
      ? project.allocatedBudget - actualExpenseTotal
      : null;

  return (
    // The header used to be a flex sibling of <main>, outside its own
    // overflow-y-auto — that kept it pinned in place (visually "fixed")
    // no matter how far the content below scrolled. Both now live inside
    // this one scroll container instead, so the header scrolls away with
    // everything else, same as a plain document.
    // Gray under the white project header — the content area every tab
    // sits on. relative: anything absolutely positioned in it (the tables'
    // screen-reader-only labels, ...) is placed in — and scrolls with —
    // this area, not against the page itself, which it would otherwise
    // stretch past the screen: invisibly (no scrollbars), but enough for a
    // scroll to slide the whole app up, a blank strip under it.
    <div ref={pageScrollRef} className="relative flex-1 overflow-y-auto bg-zinc-200/28">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5">
        <nav className="flex items-center gap-1.5 text-base">
          <Link
            href={`${basePath}/projects`}
            className="text-zinc-500 transition hover:text-zinc-900"
          >
            Projects
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">{breadcrumbLabel}</span>
        </nav>
        <HeaderActions />
      </header>

      <main>
        {/* Project workspace header above the sticky navigation. */}
        <ProjectHeader
          project={project}
          categories={costEstimate.categories}
          workers={workers}
          workerAssignments={workerAssignments}
          onEdit={isAdmin ? () => setEditOpen(true) : undefined}
        />

        {/* Pinned so the main tabs stay reachable while everything below
            (the active sub-tabs row included) scrolls underneath —
            switching pages no longer requires scrolling back up. pt-3
            keeps it from sitting flush against the very top edge once
            stuck (padding, not margin — a margin on the child here would
            collapse away and leave no gap once actually stuck). Same
            white bg as the block above so the two read as one continuous
            header; the line along its bottom is an inset shadow so the
            open tab's underline covers its stretch of it (as on Team).
            z-20 is well below the Modal (native <dialog>, browser top
            layer) so Edit Project etc. are unaffected. */}
        <div className="sticky top-0 z-20 bg-white pt-3 shadow-[inset_0_-1px_0_var(--color-zinc-200)]">
          <div className="flex gap-10 px-8">
            {VISIBLE_MAIN_TABS.map((tab) => (
              <button
                key={tab.value}
                type="button"
                onClick={() => setActiveTab(tab.value)}
                className={`cursor-pointer border-b-2 pb-2 text-xs font-medium transition ${activeTab === tab.value
                  ? "border-zinc-900 text-zinc-900"
                  : "border-transparent text-zinc-400 hover:border-zinc-300 hover:text-zinc-900"
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="px-8 pb-8">
        {/* Overview no longer has its own sub-tab pills (Project
            Overview/Cost Estimate/Gantt Chart all merged into this one
            page) or a toolbar row — the Gantt Chart's own toolbar was
            removed pending a later design pass. */}

        {activeTab === "progress" && (
          <SubTabsRow
            tabs={progressSubTabs}
            active={activeProgressSubTab}
            onChange={setActiveProgressSubTab}
            toolbarRef={setToolbarSlotEl}
          />
        )}


        {activeTab === "progress" ? (
          activeProgressSubTab === "overview" ? (
            <ProgressView
              startDate={project.startDate}
              targetEndDate={project.targetEndDate}
              progress={progress}
              risk={risk}
            />
          ) : (
            <DailyLogsView
              projectId={project.id}
              categories={costEstimate.categories}
              materials={materials}
              materialRequests={fulfillableMaterialRequests}
              equipmentRequests={fulfillableEquipmentRequests}
              logs={dailyLogs}
              surveyQuestions={surveyQuestions}
              toolbarSlot={toolbarSlotEl}
            />
          )
        ) : activeTab === "materials" ? (
          // One page, no sub-tabs: the Material overview bar, then
          // every material in the project.
          <div className="flex flex-col gap-6">
            <MaterialsOverviewView
              counts={materialsCounts}
              requests={materialRequests}
              recentUsage={recentMaterialUsage}
              onOpenRequest={openRequestInRecord}
              onSeeAllRequests={() => {
                setMaterialsRecordView("requests");
                if (pageScrollRef.current && materialsRecordRef.current) {
                  scrollAreaTo(pageScrollRef.current, materialsRecordRef.current, "smooth");
                }
              }}
            />
            {/* scroll-mt clears the sticky tabs bar when See all scrolls here. */}
            <div ref={materialsRecordRef} className="scroll-mt-16">
              <MaterialsMonitoringView
                projectId={project.id}
                records={materialRecords}
                view={materialsRecordView}
                onViewChange={setMaterialsRecordView}
                requests={materialRequests}
                openRequestIds={openRequestIds}
                onToggleRequest={toggleRequest}
                currentUserName={currentUserName}
              />
            </div>
          </div>
        ) : activeTab === "equipment" ? (
          // One page, no sub-tabs, as the Materials tab: the Equipment
          // overview bar, then the Equipment record.
          <div className="flex flex-col gap-6">
            <EquipmentOverviewView
              costRecords={equipmentCostRecords}
              requests={equipmentRequests}
              recentCosts={recentEquipmentCosts}
              onOpenRequest={openEquipmentRequestInRecord}
              onSeeAllRequests={() => {
                setEquipmentRecordList("requests");
                if (pageScrollRef.current && equipmentRecordRef.current) {
                  scrollAreaTo(pageScrollRef.current, equipmentRecordRef.current, "smooth");
                }
              }}
            />
            {/* scroll-mt clears the sticky tabs bar when See all scrolls here. */}
            <div ref={equipmentRecordRef} className="scroll-mt-16">
              <EquipmentRecordView
                projectId={project.id}
                costLogs={equipmentCostLogs}
                assignments={projectEquipmentAssignments}
                taskMovements={equipmentTaskMovements}
                tasks={costEstimate.categories.flatMap((category) =>
                  category.tasks
                    .filter((task) => !task.isMilestone)
                    .map((task) => ({ id: task.id, name: task.name, phaseName: category.name }))
                )}
                requests={equipmentRequests}
                view={equipmentRecordList}
                onViewChange={setEquipmentRecordList}
                onOpenProgressLog={openEquipmentProgressLog}
                openRequestIds={openEquipmentRequestIds}
                onToggleRequest={toggleEquipmentRequest}
                currentUserName={currentUserName}
              />
            </div>
          </div>
        ) : activeTab === "expenses" ? (
          <ProgressExpensesView
            entries={progressExpenses}
            planned={costEstimate.summary.totalsByColumn}
            onOpenProgressLog={openEquipmentProgressLog}
          />
        ) : (
          // Inset in the page's padding on the gray content area: the
          // Cost overview card, then the Gantt Chart's own section.
          <div className="flex flex-col gap-6 pt-6">
            <div className="flex flex-col">
            <div className="rounded border border-zinc-200 bg-white">
              <button
                type="button"
                onClick={() => setCostOverviewOpen((open) => !open)}
                aria-expanded={costOverviewOpen}
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-3.5 text-left transition hover:bg-zinc-50"
              >
                <Wallet aria-hidden className="size-4 shrink-0 text-zinc-400" />
                <span className="shrink-0 text-sm font-semibold text-zinc-900">
                  Cost overview
                </span>
                <span className="min-w-0 truncate text-sm text-zinc-400">
                  Estimated cost, budget & actual spend
                </span>
                <span className="ml-auto flex shrink-0 items-center gap-1 text-sm font-medium text-zinc-700">
                  {costOverviewOpen ? "Hide breakdown" : "View breakdown"}
                  <ChevronRight
                    aria-hidden
                    className={`size-4 transition-transform ${costOverviewOpen ? "rotate-90" : ""}`}
                  />
                </span>
              </button>

              {costOverviewOpen && (
                <div className="border-t border-zinc-200">
                  <div className="grid grid-cols-1 divide-y divide-zinc-200 border-b-2 border-zinc-900 sm:grid-cols-2 sm:divide-x sm:divide-y-0 lg:grid-cols-4">
                    <StatCard
                      label="Total Estimated Cost"
                      value={formatCurrency(costEstimate.summary.totalEstimatedCost)}
                      icon={<LayoutGrid className="size-4" />}
                    />
                    <StatCard
                      label="Allocated Budget"
                      value={formatCurrency(project.allocatedBudget)}
                      icon={<CircleDollarSign className="size-4" />}
                    />
                    <StatCard
                      label="Actual Expense"
                      value={formatCurrency(actualExpenseTotal)}
                      icon={<CalendarDays className="size-4" />}
                    />
                    <StatCard
                      label="Remaining Budget"
                      value={formatCurrency(remainingBudget)}
                      icon={<PiggyBank className="size-4" />}
                    />
                  </div>

                  {/* The Cost Estimate sub-tab was folded into this card
                      (in place of the Total Costs bar chart, which was
                      removed) — rendered un-boxed, as a direct extension
                      of this dropdown rather than its own nested card;
                      see CostEstimateView's own root element. */}
                  <CostEstimateView
                    projectId={project.id}
                    estimate={costEstimate}
                    defaultLaborCostPercent={project.defaultLaborCostPercent}
                    onImportBom={() => {
                      // Closes Material Breakdown in the same click that
                      // opens Import with AI — otherwise both dialogs
                      // render at once (two stacked <dialog> backdrops),
                      // since each Modal here is its own independent
                      // open/close state. Same non-stacking pattern as
                      // the Delete Project confirmation modal.
                      setMaterialBreakdownOpen(false);
                      setImportBomStep("upload");
                      setImportBomModalOpen(true);
                    }}
                    materialBreakdownOpen={materialBreakdownOpen}
                    materialBreakdownHighlightTaskId={materialBreakdownHighlightTaskId}
                    onOpenMaterialBreakdown={openMaterialBreakdown}
                    onCloseMaterialBreakdown={() => setMaterialBreakdownOpen(false)}
                  />
                </div>
              )}
            </div>

              <div className="mt-2">
                <SheetsSection
                  projectId={project.id}
                  initialSheets={sheetsResult?.sheets}
                  initialCanReview={sheetsResult?.canReview}
                  initialError={sheetsResult?.error}
                />
              </div>
            </div>

            <GanttChartView
              projectId={project.id}
              categories={costEstimate.categories}
              projectStartDate={project.startDate}
              workingDays={project.workingDays}
              holidays={project.holidays}
              canUndo={ganttCanUndo}
              canRedo={ganttCanRedo}
              workers={workers}
              workerAssignments={workerAssignments}
              memberGroups={memberGroups}
              taskWorkerAssignments={taskWorkerAssignments}
              categoryWorkerAssignments={categoryWorkerAssignments}
              taskProgressToday={taskProgressToday}
              categoryProgressToday={categoryProgressToday}
              overrideHistory={overrideHistory}
              events={events}
              onOpenMaterialBreakdown={openMaterialBreakdown}
              onImportBom={() => {
                setImportBomStep("upload");
                setImportBomModalOpen(true);
              }}
            />
          </div>
        )}

        <Modal
          open={importBomModalOpen}
          onClose={() => setImportBomModalOpen(false)}
          title="Import with AI"
          variant="centered"
          size={importBomStep === "review" ? "large" : "default"}
        >
          <ImportBomModalContent
            projectId={project.id}
            onClose={() => setImportBomModalOpen(false)}
            onStepChange={setImportBomStep}
          />
        </Modal>
        </div>
      </main>

      <ProgressTrackingModal
        target={equipmentProgressTarget}
        readOnly
        projectId={project.id}
        categories={costEstimate.categories}
        workingDays={project.workingDays}
        holidays={project.holidays}
        taskProgressToday={taskProgressToday}
        categoryProgressToday={categoryProgressToday}
        overrideHistory={overrideHistory}
        onClose={() => setEquipmentProgressTarget(null)}
      />

      {isAdmin && (
        <>
          <Modal
            open={editOpen}
            onClose={() => setEditOpen(false)}
            title="Edit Project"
          >
            <EditProjectForm
              project={project}
              projectManagers={projectManagers}
              foremen={foremen}
              onSuccess={() => setEditOpen(false)}
              // Closes this panel in the same click that opens the Delete
              // Project confirmation, so the two never stack.
              onRequestDelete={() => {
                setEditOpen(false);
                setDeleteProjectConfirmOpen(true);
              }}
            />
          </Modal>

          <Modal
            open={deleteProjectConfirmOpen}
            onClose={() => setDeleteProjectConfirmOpen(false)}
            title="Delete Project"
            variant="centered"
          >
            <DeleteProjectModalContent
              projectId={project.id}
              projectName={project.name}
              onClose={() => setDeleteProjectConfirmOpen(false)}
            />
          </Modal>
        </>
      )}
    </div>
  );
}
