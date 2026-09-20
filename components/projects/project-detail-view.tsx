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

const MAIN_TABS = [
  { value: "overview", label: "Overview" },
  { value: "progress", label: "Progress" },
  { value: "materials", label: "Materials" },
  { value: "equipment", label: "Equipment" },
  { value: "expenses", label: "Expenses" },
] as const;
type MainTab = (typeof MAIN_TABS)[number]["value"];

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

function DeleteProjectButton({
  projectId,
  projectName,
}: {
  projectId: number;
  projectName: string;
}) {
  const boundAction = deleteProject.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    deleteInitialState
  );

  return (
    <div className="relative">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Delete "${projectName}"? This cannot be undone.`
            )
          ) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Trash2 className="size-4" />
          Delete
        </button>
      </form>
      {state?.error && (
        <p
          role="alert"
          className="absolute top-full right-0 mt-1 w-48 text-right text-xs text-red-600"
        >
          {state.error}
        </p>
      )}
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
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5">
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
        <div className="rounded-lg border border-none pt-6 bg-white">
          <div className="flex items-start justify-between gap-3 mx-8">
            <div className="flex flex-wrap items-center gap-3.5">
              <h1 className="text-2xl font-semibold text-zinc-900">
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
              className="flex flex-shrink-0 cursor-pointer items-center justify-center rounded border border-zinc-200 p-2 text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
            >
              <EditIcon className="size-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-sm mx-8">
            {project.location && (
              <span className="text-zinc-500">{project.location}</span>
            )}
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">
              <span className="text-zinc-900">Project Manager:</span>{" "}
              {project.projectManagerName ?? "—"}
            </span>
            <span className="text-zinc-300">|</span>
            <span className="text-zinc-500">
              <span className="text-zinc-900">Foreman:</span>{" "}
              {project.foremanName ?? "—"}
            </span>
          </div>

          {/* Same overall-progress figure as the Overview sub-tab's own
              "Overall Progress" card below (and the Progress tab's) —
              surfaced here too since it's the one number worth seeing
              no matter which tab is open, not just on Overview. */}
          <div className="mt-4 mx-8">
            <div className="relative h-8 w-full overflow-hidden rounded-xs bg-zinc-100">
              <div
                className="h-full rounded-sm bg-emerald-100 transition-all"
                style={{ width: `${progress.overallPercent}%` }}
              />
              <span className="absolute inset-y-0 left-3 flex items-center text-sm font-semibold text-emerald-700">
                {Math.round(progress.overallPercent)}%
              </span>
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-zinc-500">
              <span>
                <span className="font-medium text-zinc-700">Start Date:</span>{" "}
                {formatDateLong(project.startDate)}
              </span>
              <span>
                <span className="font-medium text-zinc-700">Target End Date:</span>{" "}
                {formatDateLong(project.targetEndDate)}
              </span>
            </div>
          </div>
        </div>

        {/* Pinned so the main tabs stay reachable while everything below
            (the active sub-tabs row included) scrolls underneath —
            switching pages no longer requires scrolling back up. pt-3
            keeps it from sitting flush against the very top edge once
            stuck (padding, not margin — a margin on the child here would
            collapse away and leave no gap once actually stuck). bg-white
            keeps scrolled-away content from showing through; z-20 is
            well below the Modal (native <dialog>, browser top layer) so
            Edit Project etc. are unaffected. */}
        <div className="sticky top-0 z-20 bg-white pt-3">
          <div className="mt-5 border-b border-zinc-300">
            <div className="flex gap-10 px-8">
              {MAIN_TABS.map((tab) => (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setActiveTab(tab.value)}
                  className={`cursor-pointer border-b-2 pb-2 text-xs font-medium transition ${activeTab === tab.value
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-500 hover:text-zinc-700"
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
                  />
                </div>
              )}
            </div>

            <GanttChartView
              projectId={project.id}
              categories={costEstimate.categories}
              progress={progress}
              projectStartDate={project.startDate}
              projectTargetEndDate={project.targetEndDate}
              canUndo={ganttCanUndo}
              canRedo={ganttCanRedo}
            />
          </div>
        )}
        </div>
      </main>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Project"
      >
        <div className="flex flex-col gap-5">
          <EditProjectForm
            project={project}
            projectManagers={projectManagers}
            foremen={foremen}
            onSuccess={() => setEditOpen(false)}
          />
          <div className="flex items-center justify-between gap-3 border-t border-zinc-200 pt-4">
            <p className="text-xs text-zinc-400">
              Deleting a project can&apos;t be undone.
            </p>
            <DeleteProjectButton
              projectId={project.id}
              projectName={project.name}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
}
