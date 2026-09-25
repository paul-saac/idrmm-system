"use client";

import { useActionState, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Trash2, LayoutGrid, CircleDollarSign, CalendarDays, PiggyBank, ChevronDown } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { LogoutButton } from "@/components/auth/logout-button";
import { EditProjectForm } from "@/components/projects/edit-project-form";
import { CostEstimateView } from "@/components/projects/cost-estimate/cost-estimate-view";
import { ImportBomModalContent } from "@/components/projects/cost-estimate/import-bom-modal-content";
import { ProgressView } from "@/components/projects/progress/progress-view";
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
import { MaterialsMonitoringView } from "@/components/projects/materials/materials-monitoring-view";
import { MaterialUsageHistoryView } from "@/components/projects/materials/material-usage-history-view";
import { MaterialRequestsView } from "@/components/projects/materials/material-requests-view";
import { ProjectEquipmentView } from "@/components/projects/equipment/project-equipment-view";
import { EquipmentRequestsView } from "@/components/projects/equipment/equipment-requests-view";
import { ExpenseOverviewView } from "@/components/projects/expenses/expense-overview-view";
import { LaborExpensesView } from "@/components/projects/expenses/labor-expenses-view";
import { MaterialExpensesView } from "@/components/projects/expenses/material-expenses-view";
import { EquipmentExpensesView } from "@/components/projects/expenses/equipment-expenses-view";
import { OtherExpensesView } from "@/components/projects/expenses/other-expenses-view";
import type {
  MaterialsOverviewCounts,
  MaterialUsageHistoryEntry,
  ProjectMaterial,
  TodayProcurementEntry,
} from "@/lib/materials/data";
import type {
  MaterialRequestDetail,
  MaterialRequestListItem,
} from "@/lib/material-requests/data";
import type {
  EquipmentRequestDetail,
  EquipmentRequestListItem,
} from "@/lib/equipment-requests/data";
import type { EquipmentAssignmentRow } from "@/lib/equipment/data";
import type {
  ExpenseOverview,
  LaborExpenseGroup,
  MaterialExpenseGroup,
  EquipmentExpenseGroup,
  OtherExpenseGroup,
} from "@/lib/expenses/data";
import { deleteProject, type ProjectActionState } from "@/lib/projects/actions";
import {
  projectStatusLabel,
  projectStatusBadgeClasses,
} from "@/lib/projects/status";
import type { ProjectRow } from "@/lib/projects/data";
import type { AccountRow } from "@/lib/accounts/data";
import type { CostEstimate } from "@/lib/cost-estimate/data";
import type { ProjectProgress } from "@/lib/progress/data";
import type { DelayRiskAssessment } from "@/lib/forecasting/data";
import type { DailyLogSummary, SurveyQuestion } from "@/lib/daily-logs/data";
import type {
  Worker,
  TaskWorkerAssignments,
  CategoryWorkerAssignments,
} from "@/lib/workers/data";
import type { TaskProgressToday } from "@/lib/task-progress/data";

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

const MATERIALS_SUB_TABS = [
  { value: "overview", label: "Overview" },
  { value: "monitoring", label: "Materials" },
  { value: "usage-logs", label: "Usage logs" },
  { value: "requests", label: "Requests" },
] as const;
type MaterialsSubTab = (typeof MATERIALS_SUB_TABS)[number]["value"];

const EQUIPMENT_SUB_TABS = [
  { value: "assigned", label: "Assigned" },
  { value: "requests", label: "Requests" },
] as const;
type EquipmentSubTab = (typeof EQUIPMENT_SUB_TABS)[number]["value"];

const EXPENSES_SUB_TABS = [
  { value: "overview", label: "Expense Overview" },
  { value: "labor", label: "Labor Expenses" },
  { value: "material", label: "Material Expenses" },
  { value: "equipment", label: "Equipment Expenses" },
  { value: "other", label: "Other Expenses" },
] as const;
type ExpensesSubTab = (typeof EXPENSES_SUB_TABS)[number]["value"];

const deleteInitialState: ProjectActionState = {};

function formatCurrency(amount: number | null) {
  return amount != null ? `₱${amount.toLocaleString("en-PH")}` : "—";
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
// alert. Opened only from EditProjectForm's own Delete button, which
// closes the Edit Project modal in the same click that opens this one
// (see onRequestDelete's own wiring below) so the two never stack.
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
  materialUsageHistory,
  todayProcurement,
  materialRequests,
  fulfillableMaterialRequests,
  equipmentRequests,
  fulfillableEquipmentRequests,
  expenseOverview,
  laborExpenses,
  materialExpenses,
  equipmentExpenses,
  otherExpenses,
  currentUserName,
  projectEquipmentAssignments,
  ganttCanUndo,
  ganttCanRedo,
  workers,
  taskWorkerAssignments,
  categoryWorkerAssignments,
  taskProgressToday,
  categoryProgressToday,
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
  materialUsageHistory: MaterialUsageHistoryEntry[];
  todayProcurement: TodayProcurementEntry[];
  materialRequests: MaterialRequestListItem[];
  /** Requests that can still receive a delivery — for the Add Daily
   * Log modal's Material Procurement "Select Material Request" picker. */
  fulfillableMaterialRequests: MaterialRequestDetail[];
  equipmentRequests: EquipmentRequestListItem[];
  /** Requests that can still receive an acquisition — for the Add Daily
   * Log modal's Equipment Acquisition "Select Equipment Request" picker. */
  fulfillableEquipmentRequests: EquipmentRequestDetail[];
  /** Roll-up of the four expense ledgers below, plus the Cost Estimate's
   * planned totals — see summarizeExpenses in lib/expenses/data.ts. */
  expenseOverview: ExpenseOverview;
  laborExpenses: LaborExpenseGroup[];
  materialExpenses: MaterialExpenseGroup[];
  equipmentExpenses: EquipmentExpenseGroup[];
  otherExpenses: OtherExpenseGroup[];
  currentUserName: string;
  projectEquipmentAssignments: EquipmentAssignmentRow[];
  /** Whether the Gantt Chart's own Undo/Redo toolbar buttons should be
   * enabled — see lib/cost-estimate/undo-redo.ts's getGanttUndoRedoState,
   * fetched alongside costEstimate/progress in page.tsx. */
  ganttCanUndo: boolean;
  ganttCanRedo: boolean;
  /** The project's own Members roster + each task's current
   * assignments from it — see lib/workers/data.ts, fetched alongside
   * costEstimate/progress in page.tsx. */
  workers: Worker[];
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

  const [activeTab, setActiveTab] = useState<MainTab>(initialTab);
  const [activeProgressSubTab, setActiveProgressSubTab] =
    useState<ProgressSubTab>(
      initialTab === "progress" &&
        PROGRESS_SUB_TABS.some((tab) => tab.value === subtabParam)
        ? (subtabParam as ProgressSubTab)
        : "overview"
    );
  const [activeMaterialsSubTab, setActiveMaterialsSubTab] =
    useState<MaterialsSubTab>(
      initialTab === "materials" &&
        MATERIALS_SUB_TABS.some((tab) => tab.value === subtabParam)
        ? (subtabParam as MaterialsSubTab)
        : "overview"
    );
  const [activeEquipmentSubTab, setActiveEquipmentSubTab] =
    useState<EquipmentSubTab>(
      initialTab === "equipment" &&
        EQUIPMENT_SUB_TABS.some((tab) => tab.value === subtabParam)
        ? (subtabParam as EquipmentSubTab)
        : "assigned"
    );
  const [activeExpensesSubTab, setActiveExpensesSubTab] =
    useState<ExpensesSubTab>(
      initialTab === "expenses" &&
        EXPENSES_SUB_TABS.some((tab) => tab.value === subtabParam)
        ? (subtabParam as ExpensesSubTab)
        : "overview"
    );
  const [editOpen, setEditOpen] = useState(false);
  // The Delete Project confirmation modal — a separate piece of state
  // from editOpen (not a second "screen" inside the same Modal) so the
  // two can never both be true at once and stack; onRequestDelete below
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
  // which already shows all of it.
  const [costOverviewOpen, setCostOverviewOpen] = useState(true);
  // Opens the shared "Import Bill of Materials" modal from the Material
  // Breakdown modal's own footer (see MaterialBreakdownModalContent) —
  // lifted up here rather than owned by CostEstimateView so the same
  // modal instance could still be reused if another entry point needs
  // one later.
  const [importBomModalOpen, setImportBomModalOpen] = useState(false);
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

  // Live sum of the four expense ledgers — not project.actualExpense,
  // which was a static number an admin typed into the Edit Project form
  // and is gone now that the form no longer exposes it (see
  // 0026_projects_column_cleanup.sql). This is the same computation the
  // Reports page uses for its own "Actual Expense" card.
  const actualExpenseTotal =
    expenseOverview.actual.labor +
    expenseOverview.actual.material +
    expenseOverview.actual.equipment +
    expenseOverview.actual.other;

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
    <div className="flex-1 overflow-y-auto">
      <header className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50 px-8 py-5">
        <nav className="flex items-center gap-1.5 text-base">
          <Link
            href="/admin/projects"
            className="text-zinc-500 transition hover:text-zinc-900"
          >
            Projects
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">{breadcrumbLabel}</span>
        </nav>
        <LogoutButton />
      </header>

      <main>
        {/* The app's own "black" (bg-zinc-900, remapped in globals.css
            to a warm #3B3939 — see AdminSidebar's own doc comment on
            why the sidebar itself deliberately opts OUT of this token)
            — same color as the active SubTabsRow pill (e.g. "Progress
            Overview"), applied here too so both read as the same
            "black" rather than two different near-blacks. A one-off
            dark header purely for visual variety, not tied to any
            state (status, theme, etc). */}
        {/* No rounding at all — this block sits flush against the
            breadcrumb header directly above it (bg-zinc-50, no gap
            between them) and against the sticky tabs block directly
            below it (same bg-zinc-900), so any rounded corner here —
            top or bottom — just pokes a stray notch of the page's own
            background through rather than reading as a deliberate
            floating card. */}
        <div className="border border-none pt-6 bg-zinc-900">
          <div className="flex items-start justify-between gap-3 mx-8">
            <div className="flex flex-wrap items-center gap-3.5">
              <h1 className="text-2xl font-semibold text-white">
                {project.name}
              </h1>
              <span
                className={`rounded-xs px-2.5 py-1 text-xs font-medium ${projectStatusBadgeClasses(project.status)}`}
              >
                {projectStatusLabel(project.status)}
              </span>
            </div>
            {/* Delete now lives inside the Edit Project modal instead of
                sitting here as its own button — same "Delete lives inside
                this modal" convention as the Gantt Chart's SubtaskForm. */}
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              aria-label="Edit project"
              title="Edit project"
              className="flex flex-shrink-0 cursor-pointer items-center justify-center rounded border border-white/15 p-2 text-zinc-400 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
            >
              <EditIcon className="size-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm mx-8">
            {project.location && (
              <span className="text-zinc-400">{project.location}</span>
            )}
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">
              <span className="text-zinc-200">Project Manager:</span>{" "}
              {project.projectManagerName ?? "—"}
            </span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">
              <span className="text-zinc-200">Foreman:</span>{" "}
              {project.foremanName ?? "—"}
            </span>
          </div>

        </div>

        {/* Pinned so the main tabs stay reachable while everything below
            (the active sub-tabs row included) scrolls underneath —
            switching pages no longer requires scrolling back up. pt-3
            keeps it from sitting flush against the very top edge once
            stuck (padding, not margin — a margin on the child here would
            collapse away and leave no gap once actually stuck). Same
            dark bg as the block above so the two read as one continuous
            header once stuck; z-20 is well below the Modal (native
            <dialog>, browser top layer) so Edit Project etc. are
            unaffected. */}
        <div className="sticky top-0 z-20 bg-zinc-900 pt-3">
          <div className="mt-5">
            <div className="flex gap-10 px-8">
              {VISIBLE_MAIN_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`cursor-pointer border-b-2 pb-2 text-xs font-medium transition ${activeTab === tab.value
                    ? "border-white text-white"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                    }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="px-8 pb-8">
        {/* Overview no longer has its own sub-tab pills (Project
            Overview/Cost Estimate/Gantt Chart all merged into this one
            page) or a toolbar row — the Gantt Chart's own toolbar was
            removed pending a later design pass. */}

        {activeTab === "progress" && (
          <SubTabsRow
            tabs={PROGRESS_SUB_TABS}
            active={activeProgressSubTab}
            onChange={setActiveProgressSubTab}
            toolbarRef={setToolbarSlotEl}
          />
        )}

        {activeTab === "materials" && (
          <SubTabsRow
            tabs={MATERIALS_SUB_TABS}
            active={activeMaterialsSubTab}
            onChange={setActiveMaterialsSubTab}
            toolbarRef={setToolbarSlotEl}
          />
        )}

        {activeTab === "equipment" && (
          <SubTabsRow
            tabs={EQUIPMENT_SUB_TABS}
            active={activeEquipmentSubTab}
            onChange={setActiveEquipmentSubTab}
            toolbarRef={setToolbarSlotEl}
          />
        )}

        {activeTab === "expenses" && (
          <SubTabsRow
            tabs={EXPENSES_SUB_TABS}
            active={activeExpensesSubTab}
            onChange={setActiveExpensesSubTab}
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
          activeMaterialsSubTab === "overview" ? (
            <MaterialsOverviewView
              projectId={project.id}
              counts={materialsCounts}
              materialUsageHistory={materialUsageHistory}
              todayProcurement={todayProcurement}
            />
          ) : activeMaterialsSubTab === "monitoring" ? (
            <MaterialsMonitoringView
              projectId={project.id}
              materials={materials}
              toolbarSlot={toolbarSlotEl}
            />
          ) : activeMaterialsSubTab === "usage-logs" ? (
            <MaterialUsageHistoryView
              projectId={project.id}
              entries={materialUsageHistory}
            />
          ) : (
            <MaterialRequestsView
              projectId={project.id}
              requests={materialRequests}
              currentUserName={currentUserName}
              toolbarSlot={toolbarSlotEl}
            />
          )
        ) : activeTab === "equipment" ? (
          activeEquipmentSubTab === "assigned" ? (
            <ProjectEquipmentView
              projectId={project.id}
              assignments={projectEquipmentAssignments}
            />
          ) : (
            <EquipmentRequestsView
              projectId={project.id}
              requests={equipmentRequests}
              currentUserName={currentUserName}
              toolbarSlot={toolbarSlotEl}
            />
          )
        ) : activeTab === "expenses" ? (
          activeExpensesSubTab === "overview" ? (
            <ExpenseOverviewView overview={expenseOverview} />
          ) : activeExpensesSubTab === "labor" ? (
            <LaborExpensesView projectId={project.id} groups={laborExpenses} />
          ) : activeExpensesSubTab === "material" ? (
            <MaterialExpensesView
              projectId={project.id}
              groups={materialExpenses}
            />
          ) : activeExpensesSubTab === "equipment" ? (
            <EquipmentExpensesView
              projectId={project.id}
              groups={equipmentExpenses}
            />
          ) : (
            <OtherExpensesView projectId={project.id} groups={otherExpenses} />
          )
        ) : (
          // -mx-8 cancels the parent's own px-8 so this tab's content
          // (unlike every other tab's) runs edge-to-edge instead of
          // sitting inset — only this Overview tab was asked to bleed
          // full-width. No gap between children either — the Cost
          // Overview card sits flush against the Gantt Chart below it,
          // no divider line between them.
          <div className="-mx-8 flex flex-col">
            {/* No border on any side — the sticky tabs bar right above
                already has its own bottom border (a top border here
                would double it), the Gantt Chart sits flush against
                this card's bottom with nothing dividing them, and it's
                already edge-to-edge left/right with nothing beside it
                to divide from either. */}
            <div className="bg-zinc-50">
              <button
                type="button"
                onClick={() => setCostOverviewOpen((open) => !open)}
                aria-expanded={costOverviewOpen}
                className={`flex w-full cursor-pointer items-center justify-between px-5 py-3.5 text-left transition hover:bg-zinc-200 ${costOverviewOpen ? "border-b border-zinc-200" : ""}`}
              >
                <span className="text-sm font-semibold text-zinc-900">
                  Cost Overview
                </span>
                <ChevronDown
                  className={`size-4 flex-shrink-0 text-zinc-400 transition-transform ${costOverviewOpen ? "" : "-rotate-90"}`}
                />
              </button>

              {costOverviewOpen && (
                <div>
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
                    onImportBom={() => setImportBomModalOpen(true)}
                    materialBreakdownOpen={materialBreakdownOpen}
                    materialBreakdownHighlightTaskId={materialBreakdownHighlightTaskId}
                    onOpenMaterialBreakdown={() => openMaterialBreakdown()}
                    onCloseMaterialBreakdown={() => setMaterialBreakdownOpen(false)}
                  />
                </div>
              )}
            </div>

            <GanttChartView
              projectId={project.id}
              categories={costEstimate.categories}
              projectStartDate={project.startDate}
              canUndo={ganttCanUndo}
              canRedo={ganttCanRedo}
              workers={workers}
              taskWorkerAssignments={taskWorkerAssignments}
              categoryWorkerAssignments={categoryWorkerAssignments}
              materials={materials}
              taskProgressToday={taskProgressToday}
              categoryProgressToday={categoryProgressToday}
              onOpenMaterialBreakdown={openMaterialBreakdown}
            />
          </div>
        )}

        <Modal
          open={importBomModalOpen}
          onClose={() => setImportBomModalOpen(false)}
          title="Import Bill of Materials"
          variant="centered"
        >
          <ImportBomModalContent onClose={() => setImportBomModalOpen(false)} />
        </Modal>
        </div>
      </main>

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
    </div>
  );
}
