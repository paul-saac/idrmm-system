"use client";

import {
  startTransition,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Boxes,
  Calendar,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ClipboardList,
  CloudUpload,
  Hammer,
  Plus,
  Receipt,
  Truck,
  Users,
  Wrench,
  X,
} from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import {
  createDailyLog,
  updateDailyLog,
  type DailyLogActionState,
} from "@/lib/daily-logs/actions";
import type { MaterialStatus, ProjectMaterial } from "@/lib/materials/data";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";
import type { EquipmentRequestDetail } from "@/lib/equipment-requests/data";
import type { DailyLogDetail, SurveyQuestion } from "@/lib/daily-logs/data";

type WorkItemOption = {
  id: number;
  name: string;
  unit: string | null;
  estimatedQuantity: number;
};
export type CategoryOption = {
  id: number;
  name: string;
  tasks: WorkItemOption[];
};

type WorkLogDraft = {
  categoryId: number;
  taskId: number;
  quantityCompleted: string;
  unit: string;
  activity: string;
  attachments: File[];
};

type LaborLogDraft = {
  workerRole: string;
  workerCount: string;
  dailyRate: string;
  otHours: string;
  workersRenderedOvertime: string;
  workersRenderedHalfday: string;
  remarks: string;
  attachments: File[];
};

type ExpenseLogDraft = {
  expenseCategory: string;
  amount: string;
  additionalFees: string;
  description: string;
  remarks: string;
  attachments: File[];
};

type MaterialUsageLogDraft = {
  projectMaterialId: number;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unit: string | null;
  status: MaterialStatus;
  activity: string;
  remarks: string;
};

const USAGE_STATUS_LABELS: Record<MaterialStatus, string> = {
  available: "Available",
  low_stock: "Low Stock",
  fully_consumed: "Fully Consumed",
};

type ProcurementItemDraft = {
  /** Set only when this item was picked through the Material Request
   * picker (see RequestItemPickerScreen) — a manually typed "+ Add Item"
   * row leaves this null, so approving the log won't credit anything. */
  materialRequestItemId: number | null;
  materialName: string;
  specification: string;
  quantity: string;
  unit: string;
  cost: string;
};

type ProcurementLogDraft = {
  procurementType: string;
  supplierName: string;
  materialRequestId: number | null;
  /** Display-only convenience so the form doesn't need to look the MR
   * back up from `materialRequests` just to show its number. */
  materialRequestMrNo: string | null;
  additionalFees: string;
  remarks: string;
  attachments: File[];
  items: ProcurementItemDraft[];
};

const blankProcurementItem: ProcurementItemDraft = {
  materialRequestItemId: null,
  materialName: "",
  specification: "",
  quantity: "",
  unit: "",
  cost: "",
};

/** Unlike Material Procurement, one Equipment Acquisition Log entry is
 * always exactly one piece of equipment — no items sub-list, matching
 * the reference form (Equipment Name/Quantity/Specification/Type/
 * Amount all sit directly on the entry, not inside an "Items" list). */
type EquipmentAcquisitionLogDraft = {
  /** Set only when this entry was picked through the Equipment Request
   * picker (see EquipmentRequestPickerScreen/EquipmentRequestItemPickerScreen)
   * — a manually typed entry leaves these null, so approving the log
   * won't credit anything. */
  equipmentRequestId: number | null;
  /** Display-only convenience so the form doesn't need to look the ER
   * back up from `equipmentRequests` just to show its number. */
  equipmentRequestErNo: string | null;
  equipmentRequestItemId: number | null;
  equipmentName: string;
  specification: string;
  quantity: string;
  acquisitionType: string;
  amount: string;
  remarks: string;
  attachments: File[];
};

type Screen =
  | "main"
  | "survey"
  | "work-log-list"
  | "work-log-form"
  | "labor-log-list"
  | "labor-log-form"
  | "expense-log-list"
  | "expense-log-form"
  | "material-usage-list"
  | "material-usage-form"
  | "procurement-list"
  | "procurement-form"
  | "equipment-acquisition-list"
  | "equipment-acquisition-form";

const LOG_TYPES = [
  { key: "workLogs", label: "Work Logs", icon: Hammer, available: true },
  { key: "laborLogs", label: "Labor Logs", icon: Users, available: true },
  { key: "materialUsage", label: "Material Usage", icon: Boxes, available: true },
  {
    key: "materialProcurement",
    label: "Material Procurement Log",
    icon: Truck,
    available: true,
  },
  {
    key: "equipmentAcquisition",
    label: "Equipment Acquisition Log",
    icon: Wrench,
    available: true,
  },
  { key: "otherExpense", label: "Other Expense", icon: Receipt, available: true },
] as const;

type LogTypeKey = (typeof LOG_TYPES)[number]["key"];

function isoOf(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function todayIso() {
  return isoOf(new Date());
}

const WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/**
 * The 6-week (42-cell) grid for the month that `anchorIso` falls in,
 * starting on the Sunday on or before the 1st. `inMonth` flags the
 * leading/trailing days that spill in from the neighbouring months.
 */
function monthMatrix(anchorIso: string) {
  const anchor = new Date(`${anchorIso}T00:00:00`);
  const month = anchor.getMonth();
  const start = new Date(anchor.getFullYear(), month, 1);
  start.setDate(1 - start.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return { iso: isoOf(d), day: d.getDate(), inMonth: d.getMonth() === month };
  });
}

/** Same day-of-month in the month `delta` away, clamped to that
 * month's length (Jan 31 + 1 month → Feb 28/29, not March 3). */
function shiftMonth(iso: string, delta: number) {
  const d = new Date(`${iso}T00:00:00`);
  const target = new Date(d.getFullYear(), d.getMonth() + delta, 1);
  const lastDay = new Date(
    target.getFullYear(),
    target.getMonth() + 1,
    0
  ).getDate();
  target.setDate(Math.min(d.getDate(), lastDay));
  return isoOf(target);
}

function monthYearLabel(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function formatSelectedDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const dailyLogInitialState: DailyLogActionState = {};

type SurveyAnswerDraft = { occurred: boolean; notes: string };
type SurveyDraft = { questionId: number; occurred: boolean; notes: string };

type RemovedEntries = {
  workItems: Set<number>;
  laborItems: Set<number>;
  expenseItems: Set<number>;
  materialUsageItems: Set<number>;
  procurementLogs: Set<number>;
  equipmentAcquisitionLogs: Set<number>;
};

const emptyRemoved = (): RemovedEntries => ({
  workItems: new Set(),
  laborItems: new Set(),
  expenseItems: new Set(),
  materialUsageItems: new Set(),
  procurementLogs: new Set(),
  equipmentAcquisitionLogs: new Set(),
});

export function AddDailyLogModal({
  projectId,
  categories,
  materials,
  materialRequests,
  equipmentRequests,
  surveyQuestions,
  editLog,
  existingLogDates,
  open,
  onClose,
}: {
  projectId: number;
  categories: CategoryOption[];
  materials: ProjectMaterial[];
  /** Only requests that can still receive a delivery (approved or
   * partially fulfilled) — see listFulfillableMaterialRequests. */
  materialRequests: MaterialRequestDetail[];
  /** Only requests that can still receive an acquisition (approved or
   * partially fulfilled) — see listFulfillableEquipmentRequests. */
  equipmentRequests: EquipmentRequestDetail[];
  /** This project's own custom Survey questions, asked alongside the
   * three fixed ones below — see 0033_daily_log_survey_questions.sql. */
  surveyQuestions: SurveyQuestion[];
  /** When set, the modal edits this existing (pending/rejected) log
   * instead of creating a new one — the date is fixed, existing entries
   * can be removed, and submitting resets it to "pending" for a fresh
   * review. */
  editLog?: DailyLogDetail;
  /** Dates (YYYY-MM-DD) that already have a log — used only in create
   * mode to warn before the user fills out a whole log for a taken date
   * (one log per project per date). */
  existingLogDates?: string[];
  open: boolean;
  onClose: () => void;
}) {
  const isEditing = editLog != null;
  const [screen, setScreen] = useState<Screen>("main");
  const [selectedDate, setSelectedDate] = useState(
    editLog ? editLog.logDate : todayIso
  );
  const [workLogDrafts, setWorkLogDrafts] = useState<WorkLogDraft[]>([]);
  const [laborLogDrafts, setLaborLogDrafts] = useState<LaborLogDraft[]>([]);
  const [expenseLogDrafts, setExpenseLogDrafts] = useState<ExpenseLogDraft[]>([]);
  const [materialUsageDrafts, setMaterialUsageDrafts] = useState<
    MaterialUsageLogDraft[]
  >([]);
  const [procurementDrafts, setProcurementDrafts] = useState<
    ProcurementLogDraft[]
  >([]);
  const [equipmentAcquisitionDrafts, setEquipmentAcquisitionDrafts] = useState<
    EquipmentAcquisitionLogDraft[]
  >([]);
  const [removed, setRemoved] = useState<RemovedEntries>(emptyRemoved);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [surveyDrafts, setSurveyDrafts] = useState<SurveyDraft[]>(() =>
    surveyQuestions.map((question) => {
      const existing = editLog?.surveyAnswers.find(
        (answer) => answer.questionId === question.id
      );
      return {
        questionId: question.id,
        occurred: existing?.occurred ?? false,
        notes: existing?.notes ?? "",
      };
    })
  );

  /** Back to editLog's saved values in edit mode (discarding any unsaved
   * survey edits, same as ExistingEntriesSection's removal marks below),
   * or back to blank in create mode — shared by the post-submit reset
   * and handleClose (Cancel/X). */
  function resetSurveyState() {
    setSurveyDrafts(
      surveyQuestions.map((question) => {
        const existing = editLog?.surveyAnswers.find(
          (answer) => answer.questionId === question.id
        );
        return {
          questionId: question.id,
          occurred: existing?.occurred ?? false,
          notes: existing?.notes ?? "",
        };
      })
    );
  }

  function updateSurveyDraft(questionId: number, patch: Partial<SurveyAnswerDraft>) {
    setSurveyDrafts((current) =>
      current.map((draft) =>
        draft.questionId === questionId ? { ...draft, ...patch } : draft
      )
    );
  }

  const boundAction = editLog
    ? updateDailyLog.bind(null, editLog.id, projectId)
    : createDailyLog.bind(null, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    dailyLogInitialState
  );

  useEffect(() => {
    if (state.success) {
      // One-shot reset back to the modal's initial screen once the
      // server action completes, not a render loop — there's no native
      // form to .reset() here since the log drafts live in state,
      // not DOM fields.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScreen("main");
      setWorkLogDrafts([]);
      setLaborLogDrafts([]);
      setExpenseLogDrafts([]);
      setMaterialUsageDrafts([]);
      setProcurementDrafts([]);
      setEquipmentAcquisitionDrafts([]);
      setRemoved(emptyRemoved());
      if (!isEditing) setSelectedDate(todayIso());
      resetSurveyState();
      onClose();
    }
    // Only re-run when the action produces a new result — `onClose` is
    // passed inline by the parent and would otherwise re-run this every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function handleClose() {
    setScreen("main");
    setWorkLogDrafts([]);
    setLaborLogDrafts([]);
    setExpenseLogDrafts([]);
    setMaterialUsageDrafts([]);
    setProcurementDrafts([]);
    setEquipmentAcquisitionDrafts([]);
    setRemoved(emptyRemoved());
    resetSurveyState();
    onClose();
  }

  function toggleRemoved(key: keyof RemovedEntries, id: number) {
    setRemoved((prev) => {
      const next = { ...prev, [key]: new Set(prev[key]) };
      if (next[key].has(id)) next[key].delete(id);
      else next[key].add(id);
      return next;
    });
  }

  function openLogType(key: LogTypeKey) {
    if (key === "workLogs") setScreen("work-log-list");
    else if (key === "laborLogs") setScreen("labor-log-list");
    else if (key === "otherExpense") setScreen("expense-log-list");
    else if (key === "materialUsage") setScreen("material-usage-list");
    else if (key === "materialProcurement") setScreen("procurement-list");
    else if (key === "equipmentAcquisition") setScreen("equipment-acquisition-list");
  }

  function handleSubmit() {
    const formData = new FormData();
    formData.append("logDate", selectedDate);
    for (const draft of surveyDrafts) {
      formData.append("surveyQuestionId", String(draft.questionId));
      formData.append("surveyOccurred", String(draft.occurred));
      formData.append("surveyNotes", draft.notes);
    }
    for (const draft of workLogDrafts) {
      formData.append("workItemCategoryId", String(draft.categoryId));
      formData.append("workItemTaskId", String(draft.taskId));
      formData.append("workItemQuantity", draft.quantityCompleted);
      formData.append("workItemUnit", draft.unit);
      formData.append("workItemActivity", draft.activity);
      formData.append("workItemAttachmentCount", String(draft.attachments.length));
      for (const file of draft.attachments) formData.append("workItemAttachment", file);
    }
    for (const draft of laborLogDrafts) {
      formData.append("laborWorkerRole", draft.workerRole);
      formData.append("laborWorkerCount", draft.workerCount);
      formData.append("laborDailyRate", draft.dailyRate);
      formData.append("laborOtHours", draft.otHours);
      formData.append("laborRendersOvertime", draft.workersRenderedOvertime);
      formData.append("laborRendersHalfday", draft.workersRenderedHalfday);
      formData.append("laborRemarks", draft.remarks);
      formData.append("laborAttachmentCount", String(draft.attachments.length));
      for (const file of draft.attachments) formData.append("laborAttachment", file);
    }
    for (const draft of expenseLogDrafts) {
      formData.append("expenseCategory", draft.expenseCategory);
      formData.append("expenseAmount", draft.amount);
      formData.append("expenseAdditionalFees", draft.additionalFees);
      formData.append("expenseDescription", draft.description);
      formData.append("expenseRemarks", draft.remarks);
      formData.append("expenseAttachmentCount", String(draft.attachments.length));
      for (const file of draft.attachments) formData.append("expenseAttachment", file);
    }
    for (const draft of materialUsageDrafts) {
      formData.append("usageProjectMaterialId", String(draft.projectMaterialId));
      formData.append("usageStatus", draft.status);
      formData.append("usageActivity", draft.activity);
      formData.append("usageRemarks", draft.remarks);
    }
    for (const draft of procurementDrafts) {
      formData.append("procurementType", draft.procurementType);
      formData.append("procurementSupplier", draft.supplierName);
      formData.append(
        "procurementMaterialRequestId",
        draft.materialRequestId != null ? String(draft.materialRequestId) : ""
      );
      formData.append("procurementAdditionalFees", draft.additionalFees);
      formData.append("procurementRemarks", draft.remarks);
      formData.append("procurementAttachmentCount", String(draft.attachments.length));
      for (const file of draft.attachments) formData.append("procurementAttachment", file);
      formData.append(
        "procurementItemsJson",
        JSON.stringify(
          draft.items.map((item) => ({
            materialRequestItemId: item.materialRequestItemId,
            materialName: item.materialName,
            specification: item.specification,
            quantity: item.quantity,
            unit: item.unit,
            cost: item.cost,
          }))
        )
      );
    }
    for (const draft of equipmentAcquisitionDrafts) {
      formData.append(
        "acqEquipmentRequestId",
        draft.equipmentRequestId != null ? String(draft.equipmentRequestId) : ""
      );
      formData.append(
        "acqEquipmentRequestItemId",
        draft.equipmentRequestItemId != null
          ? String(draft.equipmentRequestItemId)
          : ""
      );
      formData.append("acqEquipmentName", draft.equipmentName);
      formData.append("acqSpecification", draft.specification);
      formData.append("acqQuantity", draft.quantity);
      formData.append("acqType", draft.acquisitionType);
      formData.append("acqAmount", draft.amount);
      formData.append("acqRemarks", draft.remarks);
      formData.append("acqAttachmentCount", String(draft.attachments.length));
      for (const file of draft.attachments) formData.append("acqAttachment", file);
    }
    if (isEditing) {
      formData.append(
        "removeEntryIds",
        JSON.stringify({
          workItems: [...removed.workItems],
          laborItems: [...removed.laborItems],
          expenseItems: [...removed.expenseItems],
          materialUsageItems: [...removed.materialUsageItems],
          procurementLogs: [...removed.procurementLogs],
          equipmentAcquisitionLogs: [...removed.equipmentAcquisitionLogs],
        })
      );
    }
    // formAction (useActionState's dispatch) is normally invoked by React
    // itself when passed as a <form>'s action prop, which wraps the call
    // in a transition automatically. Calling it directly from a plain
    // onClick — needed here since the FormData is built by hand from
    // client-side draft state, not collected from the DOM — has to be
    // wrapped in startTransition explicitly, or `pending` stops tracking
    // correctly (this was a real console error, not just a lint nit).
    startTransition(() => {
      formAction(formData);
    });
  }

  const titleByScreen: Record<Screen, string> = {
    main: isEditing ? "Edit Daily Log" : "Add Daily Log",
    survey: "Survey",
    "work-log-list": "Work Logs",
    "work-log-form": editingIndex !== null ? "Edit Work Log" : "Add Work Log",
    "labor-log-list": "Labor Logs",
    "labor-log-form": editingIndex !== null ? "Edit Labor Log" : "Add Labor Log",
    "expense-log-list": "Other Expense Logs",
    "expense-log-form":
      editingIndex !== null ? "Edit Other Expense Log" : "Add Other Expense Log",
    "material-usage-list": "Material Usage Logs",
    "material-usage-form":
      editingIndex !== null ? "Edit Usage Log" : "Add Usage Log",
    "procurement-list": "Material Procurement Logs",
    "procurement-form":
      editingIndex !== null
        ? "Edit Material Procurement"
        : "Add Material Procurement",
    "equipment-acquisition-list": "Equipment Acquisition Logs",
    "equipment-acquisition-form":
      editingIndex !== null
        ? "Edit Equipment Acquisition"
        : "Add Equipment Acquisition",
  };

  const backByScreen: Partial<Record<Screen, () => void>> = {
    survey: () => setScreen("main"),
    "work-log-list": () => setScreen("main"),
    "work-log-form": () => setScreen("work-log-list"),
    "labor-log-list": () => setScreen("main"),
    "labor-log-form": () => setScreen("labor-log-list"),
    "expense-log-list": () => setScreen("main"),
    "expense-log-form": () => setScreen("expense-log-list"),
    "material-usage-list": () => setScreen("main"),
    "material-usage-form": () => setScreen("material-usage-list"),
    "procurement-list": () => setScreen("main"),
    "procurement-form": () => setScreen("procurement-list"),
    "equipment-acquisition-list": () => setScreen("main"),
    "equipment-acquisition-form": () => setScreen("equipment-acquisition-list"),
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      onBack={backByScreen[screen]}
      title={titleByScreen[screen]}
    >
      {screen === "main" && (
        <MainScreen
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          isEditing={isEditing}
          editLog={editLog}
          existingLogDates={existingLogDates ?? []}
          removed={removed}
          onToggleRemoved={toggleRemoved}
          counts={{
            workLogs:
              workLogDrafts.length +
              (editLog?.workItems.filter((i) => !removed.workItems.has(i.id))
                .length ?? 0),
            laborLogs:
              laborLogDrafts.length +
              (editLog?.laborItems.filter((i) => !removed.laborItems.has(i.id))
                .length ?? 0),
            otherExpense:
              expenseLogDrafts.length +
              (editLog?.expenseItems.filter(
                (i) => !removed.expenseItems.has(i.id)
              ).length ?? 0),
            materialUsage:
              materialUsageDrafts.length +
              (editLog?.materialUsageItems.filter(
                (i) => !removed.materialUsageItems.has(i.id)
              ).length ?? 0),
            materialProcurement:
              procurementDrafts.length +
              (editLog?.procurementLogs.filter(
                (p) => !removed.procurementLogs.has(p.id)
              ).length ?? 0),
            equipmentAcquisition:
              equipmentAcquisitionDrafts.length +
              (editLog?.equipmentAcquisitionLogs.filter(
                (a) => !removed.equipmentAcquisitionLogs.has(a.id)
              ).length ?? 0),
          }}
          onOpenLogType={openLogType}
          surveyAnsweredCount={surveyDrafts.filter((draft) => draft.occurred).length}
          onOpenSurvey={() => setScreen("survey")}
          onCancel={handleClose}
          onSubmit={handleSubmit}
          pending={pending}
          error={state.error}
        />
      )}

      {screen === "survey" && (
        <SurveyScreen
          surveyQuestions={surveyQuestions}
          surveyDrafts={surveyDrafts}
          onSurveyChange={updateSurveyDraft}
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "work-log-list" && (
        <WorkLogListScreen
          categories={categories}
          drafts={workLogDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("work-log-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("work-log-form");
          }}
          onRemove={(index) =>
            setWorkLogDrafts((drafts) => drafts.filter((_, i) => i !== index))
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "work-log-form" && (
        <WorkLogFormScreen
          categories={categories}
          initial={editingIndex !== null ? workLogDrafts[editingIndex] : undefined}
          onCancel={() => setScreen("work-log-list")}
          onSave={(draft) => {
            setWorkLogDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("work-log-list");
          }}
        />
      )}

      {screen === "labor-log-list" && (
        <LaborLogListScreen
          drafts={laborLogDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("labor-log-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("labor-log-form");
          }}
          onRemove={(index) =>
            setLaborLogDrafts((drafts) => drafts.filter((_, i) => i !== index))
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "labor-log-form" && (
        <LaborLogFormScreen
          initial={editingIndex !== null ? laborLogDrafts[editingIndex] : undefined}
          onCancel={() => setScreen("labor-log-list")}
          onSave={(draft) => {
            setLaborLogDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("labor-log-list");
          }}
        />
      )}

      {screen === "expense-log-list" && (
        <ExpenseLogListScreen
          drafts={expenseLogDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("expense-log-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("expense-log-form");
          }}
          onRemove={(index) =>
            setExpenseLogDrafts((drafts) => drafts.filter((_, i) => i !== index))
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "expense-log-form" && (
        <ExpenseLogFormScreen
          initial={editingIndex !== null ? expenseLogDrafts[editingIndex] : undefined}
          onCancel={() => setScreen("expense-log-list")}
          onSave={(draft) => {
            setExpenseLogDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("expense-log-list");
          }}
        />
      )}

      {screen === "material-usage-list" && (
        <MaterialUsageListScreen
          drafts={materialUsageDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("material-usage-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("material-usage-form");
          }}
          onRemove={(index) =>
            setMaterialUsageDrafts((drafts) =>
              drafts.filter((_, i) => i !== index)
            )
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "material-usage-form" && (
        <MaterialUsageFormScreen
          materials={materials}
          initial={
            editingIndex !== null ? materialUsageDrafts[editingIndex] : undefined
          }
          onCancel={() => setScreen("material-usage-list")}
          onSave={(draft) => {
            setMaterialUsageDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("material-usage-list");
          }}
        />
      )}

      {screen === "procurement-list" && (
        <ProcurementLogListScreen
          drafts={procurementDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("procurement-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("procurement-form");
          }}
          onRemove={(index) =>
            setProcurementDrafts((drafts) => drafts.filter((_, i) => i !== index))
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "procurement-form" && (
        <ProcurementLogFormScreen
          materialRequests={materialRequests}
          initial={
            editingIndex !== null ? procurementDrafts[editingIndex] : undefined
          }
          onCancel={() => setScreen("procurement-list")}
          onSave={(draft) => {
            setProcurementDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("procurement-list");
          }}
        />
      )}

      {screen === "equipment-acquisition-list" && (
        <EquipmentAcquisitionListScreen
          drafts={equipmentAcquisitionDrafts}
          onAdd={() => {
            setEditingIndex(null);
            setScreen("equipment-acquisition-form");
          }}
          onEdit={(index) => {
            setEditingIndex(index);
            setScreen("equipment-acquisition-form");
          }}
          onRemove={(index) =>
            setEquipmentAcquisitionDrafts((drafts) =>
              drafts.filter((_, i) => i !== index)
            )
          }
          onDone={() => setScreen("main")}
        />
      )}

      {screen === "equipment-acquisition-form" && (
        <EquipmentAcquisitionFormScreen
          equipmentRequests={equipmentRequests}
          initial={
            editingIndex !== null
              ? equipmentAcquisitionDrafts[editingIndex]
              : undefined
          }
          onCancel={() => setScreen("equipment-acquisition-list")}
          onSave={(draft) => {
            setEquipmentAcquisitionDrafts((drafts) => {
              if (editingIndex !== null) {
                const copy = [...drafts];
                copy[editingIndex] = draft;
                return copy;
              }
              return [...drafts, draft];
            });
            setScreen("equipment-acquisition-list");
          }}
        />
      )}
    </Modal>
  );
}

function MainScreen({
  selectedDate,
  onSelectDate,
  isEditing,
  editLog,
  existingLogDates,
  removed,
  onToggleRemoved,
  counts,
  onOpenLogType,
  surveyAnsweredCount,
  onOpenSurvey,
  onCancel,
  onSubmit,
  pending,
  error,
}: {
  selectedDate: string;
  onSelectDate: (iso: string) => void;
  isEditing: boolean;
  editLog?: DailyLogDetail;
  existingLogDates: string[];
  removed: RemovedEntries;
  onToggleRemoved: (key: keyof RemovedEntries, id: number) => void;
  counts: Partial<Record<LogTypeKey, number>>;
  onOpenLogType: (key: LogTypeKey) => void;
  /** How many Survey questions (fixed + custom) are currently marked
   * "Yes" — shown as this row's own badge count, same spot every other
   * entry type shows how many entries it has, since "questions flagged
   * Yes" is the number worth glancing at without opening the screen. */
  surveyAnsweredCount: number;
  onOpenSurvey: () => void;
  onCancel: () => void;
  onSubmit: () => void;
  pending: boolean;
  error?: string;
}) {
  const takenDates = useMemo(
    () => new Set(existingLogDates),
    [existingLogDates]
  );
  const today = todayIso();
  const dateTaken = !isEditing && takenDates.has(selectedDate);
  const dateInputRef = useRef<HTMLInputElement>(null);

  // Which month the grid displays. Kept separate from `selectedDate` so the
  // ‹ › arrows can browse other months without moving the selection (and
  // without dragging its highlight along). Any change to the selected date
  // — a day click, Today, Jump to date, a parent reset — snaps the view
  // back to that date's month; done during render, not in an effect
  // (react-hooks/set-state-in-effect).
  const [viewMonth, setViewMonth] = useState(selectedDate);
  const [prevSelectedDate, setPrevSelectedDate] = useState(selectedDate);
  if (selectedDate !== prevSelectedDate) {
    setPrevSelectedDate(selectedDate);
    setViewMonth(selectedDate);
  }

  const matrix = useMemo(() => monthMatrix(viewMonth), [viewMonth]);

  function openCalendar() {
    const input = dateInputRef.current;
    if (!input) return;
    // showPicker() is broadly supported (Chrome/Edge, Firefox 116+, Safari
    // 17+) but not guaranteed everywhere — .click() is the fallback for a
    // native <input type="date">, which still opens its picker on click.
    try {
      input.showPicker();
    } catch {
      input.click();
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {isEditing ? (
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2">
          <p className="text-xs font-medium text-zinc-400">Log date</p>
          <p className="mt-0.5 text-sm font-medium text-zinc-800">
            {formatSelectedDate(selectedDate)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Saving puts this log back to “pending” for a fresh review.
          </p>
        </div>
      ) : (
        <div className="rounded-md border border-zinc-200 p-2.5">
          <div className="mb-5 flex items-center justify-between gap-2">
            {/* The one title line doubles as the month indicator: the full
                selected date while its month is in view, otherwise just
                the month/year you've browsed to with the ‹ › arrows. */}
            <p className="min-w-0 truncate text-sm font-semibold text-zinc-900">
              {viewMonth.slice(0, 7) === selectedDate.slice(0, 7)
                ? formatSelectedDate(selectedDate)
                : monthYearLabel(viewMonth)}
            </p>
            <div className="flex flex-shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  onSelectDate(today);
                  // Also reset the view directly: if today is already the
                  // selection, onSelectDate is a no-op and wouldn't pull the
                  // grid back from whatever month is being browsed.
                  setViewMonth(today);
                }}
                className="cursor-pointer rounded-[3px] border border-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
              >
                Today
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={openCalendar}
                  className="flex cursor-pointer items-center gap-1 rounded-[3px] bg-zinc-100 px-2 py-1 text-xs font-medium text-zinc-600 transition hover:bg-zinc-200 hover:text-zinc-800"
                >
                  <Calendar className="size-3.5" />
                  Jump to date
                </button>
                {/* Programmatic picker host only — pointer-events-none so
                    clicks fall through to the button above, whose onClick
                    calls showPicker(). A bare <input type="date"> doesn't
                    open its picker on a plain click anyway. */}
                <input
                  ref={dateInputRef}
                  type="date"
                  tabIndex={-1}
                  value={selectedDate}
                  onChange={(e) => {
                    if (e.target.value) onSelectDate(e.target.value);
                  }}
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 size-full opacity-0"
                />
              </div>
              <button
                type="button"
                onClick={() => setViewMonth(shiftMonth(viewMonth, -1))}
                aria-label="Previous month"
                className="cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setViewMonth(shiftMonth(viewMonth, 1))}
                aria-label="Next month"
                className="cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-7 text-center">
            {WEEKDAY_LABELS.map((label) => (
              <span
                key={label}
                className="pb-1 text-[10px] font-semibold tracking-wide text-zinc-400 uppercase"
              >
                {label}
              </span>
            ))}
          </div>

          <div className="grid grid-cols-7">
            {matrix.map((cell) => {
              const isSelected = cell.iso === selectedDate;
              const isToday = cell.iso === today;
              const hasLog = takenDates.has(cell.iso);
              return (
                <button
                  key={cell.iso}
                  type="button"
                  onClick={() => onSelectDate(cell.iso)}
                  className={`relative m-0.5 flex h-7 items-center justify-center rounded text-[13px] transition ${
                    isSelected
                      ? "bg-zinc-900 font-semibold text-white"
                      : cell.inMonth
                        ? "text-zinc-700 hover:bg-zinc-100"
                        : "text-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  {cell.day}
                  {isToday && !isSelected && (
                    <span className="pointer-events-none absolute inset-0 rounded ring-1 ring-inset ring-zinc-300" />
                  )}
                  {hasLog && (
                    <span
                      className={`pointer-events-none absolute bottom-0.5 size-1 rounded-full ${
                        isSelected ? "bg-white" : "bg-amber-400"
                      }`}
                    />
                  )}
                </button>
              );
            })}
          </div>

          {dateTaken && (
            <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              A daily log already exists for this date. Open it from the Daily
              Logs list to add or remove entries — there&apos;s one log per day.
            </p>
          )}
        </div>
      )}

      {isEditing && editLog && (
        <ExistingEntriesSection
          editLog={editLog}
          removed={removed}
          onToggleRemoved={onToggleRemoved}
        />
      )}

      <div className="flex flex-col gap-2">
        {isEditing && (
          <p className="text-xs font-medium text-zinc-500">Add more entries</p>
        )}
        {LOG_TYPES.map((type) => {
          const Icon = type.icon;
          return (
            <button
              key={type.key}
              type="button"
              disabled={!type.available}
              onClick={type.available ? () => onOpenLogType(type.key) : undefined}
              className={`flex items-center justify-between rounded border border-zinc-200 px-3 py-2.5 text-left text-sm transition ${
                type.available
                  ? "cursor-pointer text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50"
                  : "cursor-not-allowed text-zinc-400"
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Icon className="size-4" />
                {type.label}
                <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                  {counts[type.key] ?? 0}
                </span>
              </span>
              {!type.available && (
                <span className="text-xs text-zinc-400">Coming soon</span>
              )}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onOpenSurvey}
          className="flex cursor-pointer items-center justify-between rounded border border-zinc-200 px-3 py-2.5 text-left text-sm text-zinc-800 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          <span className="flex items-center gap-2.5">
            <ClipboardList className="size-4" />
            Survey
            <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
              {surveyAnsweredCount}
            </span>
          </span>
        </button>
      </div>

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || dateTaken}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending
            ? "Saving..."
            : isEditing
              ? "Save changes"
              : "Submit for review"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Its own screen (opened from the "Survey" row on the main screen,
 * same drill-down pattern as Work Logs/Labor Logs/etc.) rather than
 * inline on the main screen — five-plus questions inline made the form
 * scroll long even before a project added its own custom ones. Answers
 * live in the parent's surveyDrafts state either way, so navigating
 * here and back via "Done" doesn't lose anything. Every question shown
 * here comes from the project's own listSurveyQuestions — including
 * the three every project starts with (see seedDefaultSurveyQuestions)
 * — there's no separate hardcoded set anymore.
 */
function SurveyScreen({
  surveyQuestions,
  surveyDrafts,
  onSurveyChange,
  onDone,
}: {
  surveyQuestions: SurveyQuestion[];
  surveyDrafts: SurveyDraft[];
  onSurveyChange: (questionId: number, patch: Partial<SurveyAnswerDraft>) => void;
  onDone: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        {surveyQuestions.length === 0 ? (
          <p className="rounded border border-dashed border-zinc-300 py-6 text-center text-sm text-zinc-400">
            This project has no Survey questions configured yet.
          </p>
        ) : (
          surveyQuestions.map((question) => {
            const draft = surveyDrafts.find((d) => d.questionId === question.id);
            if (!draft) return null;
            return (
              <SurveyQuestionField
                key={question.id}
                question={question.questionText}
                required={question.isRequired}
                answer={draft}
                onChange={(patch) => onSurveyChange(question.id, patch)}
              />
            );
          })
        )}
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Done
        </button>
      </div>
    </div>
  );
}

/**
 * One Survey question — a No/Yes segmented toggle plus an optional
 * notes field that only appears once "Yes" is picked, matching the
 * No/Yes/Description columns the detail view's own Survey table reads
 * these same answers back into (see SurveyRow in
 * daily-log-detail-view.tsx).
 */
function SurveyQuestionField({
  question,
  required,
  answer,
  onChange,
}: {
  question: string;
  required?: boolean;
  answer: SurveyAnswerDraft;
  onChange: (patch: Partial<SurveyAnswerDraft>) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-zinc-800">
          {question}
          {required && <span className="ml-0.5 text-red-500">*</span>}
        </p>
        <div className="flex flex-shrink-0 overflow-hidden rounded border border-zinc-200">
          <button
            type="button"
            onClick={() => onChange({ occurred: false })}
            className={`cursor-pointer px-3 py-1 text-xs font-medium transition ${
              !answer.occurred
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            No
          </button>
          <button
            type="button"
            onClick={() => onChange({ occurred: true })}
            className={`cursor-pointer border-l border-zinc-200 px-3 py-1 text-xs font-medium transition ${
              answer.occurred
                ? "bg-zinc-900 text-white"
                : "bg-white text-zinc-600 hover:bg-zinc-50"
            }`}
          >
            Yes
          </button>
        </div>
      </div>
      {answer.occurred && (
        <input
          type="text"
          value={answer.notes}
          onChange={(e) => onChange({ notes: e.target.value })}
          placeholder="Add details..."
          className="w-full rounded border border-zinc-200 px-2.5 py-1.5 text-sm text-zinc-800 outline-none focus:border-zinc-400"
        />
      )}
    </div>
  );
}

function ExistingEntry({
  label,
  detail,
  removed,
  onToggle,
}: {
  label: string;
  detail: string;
  removed: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={`flex items-center justify-between rounded-md border px-3 py-2 ${
        removed
          ? "border-red-100 bg-red-50/50"
          : "border-zinc-200 bg-white"
      }`}
    >
      <div className={removed ? "line-through opacity-60" : undefined}>
        <p className="text-sm font-medium text-zinc-800">{label}</p>
        <p className="text-xs text-zinc-500">{detail}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        className={`cursor-pointer rounded px-2 py-1 text-xs font-medium transition ${
          removed
            ? "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"
            : "text-red-500 hover:bg-red-50"
        }`}
      >
        {removed ? "Undo" : "Remove"}
      </button>
    </div>
  );
}

function ExistingEntriesSection({
  editLog,
  removed,
  onToggleRemoved,
}: {
  editLog: DailyLogDetail;
  removed: RemovedEntries;
  onToggleRemoved: (key: keyof RemovedEntries, id: number) => void;
}) {
  const hasAny =
    editLog.workItems.length +
      editLog.laborItems.length +
      editLog.expenseItems.length +
      editLog.materialUsageItems.length +
      editLog.procurementLogs.length +
      editLog.equipmentAcquisitionLogs.length >
    0;

  if (!hasAny) {
    return (
      <p className="rounded-md border border-dashed border-zinc-200 py-4 text-center text-xs text-zinc-400">
        This log has no entries yet.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-zinc-500">Entries in this log</p>
      {editLog.workItems.map((item) => (
        <ExistingEntry
          key={`w-${item.id}`}
          label={`Work Log — ${item.taskName}`}
          detail={`${item.categoryName} · ${item.quantityCompleted}${item.unit ? ` ${item.unit}` : ""}`}
          removed={removed.workItems.has(item.id)}
          onToggle={() => onToggleRemoved("workItems", item.id)}
        />
      ))}
      {editLog.laborItems.map((item) => (
        <ExistingEntry
          key={`l-${item.id}`}
          label={`Labor Log — ${item.workerRole}`}
          detail={`${item.workerCount} worker(s) · ₱${item.dailyRate}/day`}
          removed={removed.laborItems.has(item.id)}
          onToggle={() => onToggleRemoved("laborItems", item.id)}
        />
      ))}
      {editLog.expenseItems.map((item) => (
        <ExistingEntry
          key={`e-${item.id}`}
          label={`Other Expense — ${item.expenseCategory}`}
          detail={`₱${item.amount}${item.additionalFees ? ` + ₱${item.additionalFees} fees` : ""}`}
          removed={removed.expenseItems.has(item.id)}
          onToggle={() => onToggleRemoved("expenseItems", item.id)}
        />
      ))}
      {editLog.materialUsageItems.map((item) => (
        <ExistingEntry
          key={`u-${item.id}`}
          label={`Material Usage — ${item.materialName}`}
          detail={USAGE_STATUS_LABELS[item.status]}
          removed={removed.materialUsageItems.has(item.id)}
          onToggle={() => onToggleRemoved("materialUsageItems", item.id)}
        />
      ))}
      {editLog.procurementLogs.map((procurement) => (
        <ExistingEntry
          key={`p-${procurement.id}`}
          label={`Material Procurement — ${procurement.supplierName || "Direct Purchase"}`}
          detail={[
            procurement.items.length === 1
              ? procurement.items[0].materialName
              : `${procurement.items.length} items`,
            procurement.materialRequestMrNo
              ? `Fulfilling ${procurement.materialRequestMrNo}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          removed={removed.procurementLogs.has(procurement.id)}
          onToggle={() => onToggleRemoved("procurementLogs", procurement.id)}
        />
      ))}
      {editLog.equipmentAcquisitionLogs.map((acquisition) => (
        <ExistingEntry
          key={`a-${acquisition.id}`}
          label={`Equipment Acquisition — ${acquisition.equipmentName}`}
          detail={[
            `${acquisition.quantity} · ${ACQUISITION_TYPE_LABELS[acquisition.acquisitionType]}`,
            acquisition.equipmentRequestErNo
              ? `Fulfilling ${acquisition.equipmentRequestErNo}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          removed={removed.equipmentAcquisitionLogs.has(acquisition.id)}
          onToggle={() =>
            onToggleRemoved("equipmentAcquisitionLogs", acquisition.id)
          }
        />
      ))}
    </div>
  );
}

// --- Shared bits used by more than one log type's form -----------------

/**
 * Multi-file — picking again adds to the existing selection rather than
 * replacing it (the native <input multiple> only replaces because
 * there's nowhere else to hold a running list), so the input's own value
 * is cleared after every pick to let the same file be re-added if it's
 * ever removed by mistake. Each picked file gets its own remove button.
 */
function AttachmentDropzone({
  id,
  files,
  onChange,
}: {
  id: string;
  files: File[];
  onChange: (files: File[]) => void;
}) {
  return (
    <div>
      <label
        htmlFor={id}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-4 py-6 text-center transition hover:border-zinc-400 hover:bg-zinc-50"
      >
        <CloudUpload className="size-5 text-zinc-400" />
        <span className="text-sm text-zinc-500">Click to upload</span>
        <span className="rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">
          Browse files
        </span>
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length > 0) onChange([...files, ...picked]);
          e.target.value = "";
        }}
        className="sr-only"
      />
      {files.length > 0 && (
        <ul className="mt-1.5 flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1"
            >
              <span className="truncate text-xs text-zinc-600">
                {file.name}
              </span>
              <button
                type="button"
                onClick={() => onChange(files.filter((_, i) => i !== index))}
                aria-label={`Remove ${file.name}`}
                className="cursor-pointer rounded p-0.5 text-zinc-400 transition hover:bg-red-100 hover:text-red-600"
              >
                <X className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CurrencyInput({
  id,
  value,
  onChange,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 rounded-md border border-zinc-200 px-3 py-2 focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
      <span className="text-sm text-zinc-400">₱</span>
      <input
        id={id}
        type="number"
        min="0"
        step="0.01"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="00.0"
        className="w-full border-0 bg-transparent p-0 text-sm outline-none"
      />
    </div>
  );
}

function FormActions({
  onCancel,
  onSave,
  saveLabel = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  saveLabel?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-3">
      <button
        type="button"
        onClick={onCancel}
        className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
      >
        {saveLabel}
      </button>
    </div>
  );
}

function DraftRow({
  title,
  subtitle,
  onEdit,
  onRemove,
}: {
  title: string;
  subtitle: string;
  onEdit: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2.5">
      <div>
        <p className="text-sm font-medium text-zinc-800">{title}</p>
        <p className="text-xs text-zinc-500">{subtitle}</p>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={onEdit}
          aria-label="Edit entry"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700"
        >
          <EditIcon className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove entry"
          className="cursor-pointer rounded p-1.5 text-zinc-400 transition hover:bg-red-100 hover:text-red-600"
        >
          <X className="size-3.5" />
        </button>
      </div>
    </div>
  );
}

function ListScreenShell({
  emptyLabel,
  children,
  onDone,
  onAdd,
  addLabel,
}: {
  emptyLabel: string;
  children: React.ReactNode;
  onDone: () => void;
  onAdd: () => void;
  addLabel: string;
}) {
  return (
    <div className="flex flex-col gap-4">
      {Array.isArray(children) && children.length === 0 ? (
        <p className="py-6 text-center text-sm text-zinc-400">{emptyLabel}</p>
      ) : (
        <div className="flex flex-col gap-2">{children}</div>
      )}

      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onAdd}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          {addLabel}
        </button>
      </div>
    </div>
  );
}

// --- Work Logs -----------------------------------------------------------

function WorkLogListScreen({
  categories,
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  categories: CategoryOption[];
  drafts: WorkLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  function categoryName(id: number) {
    return categories.find((c) => c.id === id)?.name ?? "—";
  }
  function taskName(categoryId: number, taskId: number) {
    return (
      categories
        .find((c) => c.id === categoryId)
        ?.tasks.find((t) => t.id === taskId)?.name ?? "—"
    );
  }

  return (
    <ListScreenShell
      emptyLabel="No work logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Work Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={categoryName(draft.categoryId)}
          subtitle={taskName(draft.categoryId, draft.taskId)}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

function WorkLogFormScreen({
  categories,
  initial,
  onCancel,
  onSave,
}: {
  categories: CategoryOption[];
  initial?: WorkLogDraft;
  onCancel: () => void;
  onSave: (draft: WorkLogDraft) => void;
}) {
  const formId = useId();
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? 0);
  const [taskId, setTaskId] = useState(initial?.taskId ?? 0);
  const [quantityCompleted, setQuantityCompleted] = useState(
    initial?.quantityCompleted ?? ""
  );
  const [activity, setActivity] = useState(initial?.activity ?? "");
  const [attachments, setAttachments] = useState<File[]>(
    initial?.attachments ?? []
  );
  const [error, setError] = useState<string | null>(null);

  const tasksForCategory = categories.find((c) => c.id === categoryId)?.tasks ?? [];
  const selectedTask = tasksForCategory.find((t) => t.id === taskId);
  const unit = selectedTask?.unit ?? "";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-category`} className="text-sm font-medium text-zinc-800">
          Phase Category
        </label>
        <select
          id={`${formId}-category`}
          value={categoryId || ""}
          onChange={(e) => {
            setCategoryId(Number(e.target.value));
            setTaskId(0);
          }}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <option value="" disabled>
            Select Phase Category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-task`} className="text-sm font-medium text-zinc-800">
          Work Item
        </label>
        <select
          id={`${formId}-task`}
          value={taskId || ""}
          onChange={(e) => setTaskId(Number(e.target.value))}
          disabled={!categoryId}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200 disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400"
        >
          <option value="" disabled>
            {categoryId ? "Select Work Item" : "Select a category first"}
          </option>
          {tasksForCategory.map((task) => (
            <option key={task.id} value={task.id}>
              {task.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-quantity`}
            className="text-sm font-medium text-zinc-800"
          >
            Quantity Completed
          </label>
          <input
            id={`${formId}-quantity`}
            type="number"
            min="0"
            max={selectedTask ? selectedTask.estimatedQuantity : undefined}
            step="0.01"
            value={quantityCompleted}
            onChange={(e) => setQuantityCompleted(e.target.value)}
            placeholder="00.0"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
          {selectedTask && (
            <p className="text-xs text-zinc-400">
              Estimated quantity for this task: {selectedTask.estimatedQuantity}
              {selectedTask.unit ? ` ${selectedTask.unit}` : ""}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-800">Unit</label>
          <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
            {unit || "—"}
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-activity`} className="text-sm font-medium text-zinc-800">
          Activity
        </label>
        <textarea
          id={`${formId}-activity`}
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          rows={3}
          placeholder="Describe what was done"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-attachment`} className="text-sm font-medium text-zinc-800">
          Attachments
        </label>
        <AttachmentDropzone
          id={`${formId}-attachment`}
          files={attachments}
          onChange={setAttachments}
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          if (!categoryId || !taskId) {
            setError("Select a category and a work item.");
            return;
          }
          const quantity = Number(quantityCompleted);
          if (quantityCompleted !== "" && !Number.isFinite(quantity)) {
            setError("Enter a valid quantity.");
            return;
          }
          if (
            selectedTask &&
            quantityCompleted !== "" &&
            quantity > selectedTask.estimatedQuantity
          ) {
            setError(
              `Quantity completed can't exceed the estimated quantity for this task (${selectedTask.estimatedQuantity}${selectedTask.unit ? ` ${selectedTask.unit}` : ""}).`
            );
            return;
          }
          setError(null);
          onSave({
            categoryId,
            taskId,
            quantityCompleted,
            unit,
            activity,
            attachments,
          });
        }}
      />
    </div>
  );
}

// --- Labor Logs ------------------------------------------------------------

function LaborLogListScreen({
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  drafts: LaborLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  return (
    <ListScreenShell
      emptyLabel="No labor logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Labor Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={draft.workerRole || "—"}
          subtitle={`${draft.workerCount || "0"} worker(s) · ₱${draft.dailyRate || "0"}/day`}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

function LaborLogFormScreen({
  initial,
  onCancel,
  onSave,
}: {
  initial?: LaborLogDraft;
  onCancel: () => void;
  onSave: (draft: LaborLogDraft) => void;
}) {
  const formId = useId();
  const [workerRole, setWorkerRole] = useState(initial?.workerRole ?? "");
  const [workerCount, setWorkerCount] = useState(initial?.workerCount ?? "");
  const [dailyRate, setDailyRate] = useState(initial?.dailyRate ?? "");
  const [otHours, setOtHours] = useState(initial?.otHours ?? "");
  const [workersRenderedOvertime, setWorkersRenderedOvertime] = useState(
    initial?.workersRenderedOvertime ?? ""
  );
  const [workersRenderedHalfday, setWorkersRenderedHalfday] = useState(
    initial?.workersRenderedHalfday ?? ""
  );
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [attachments, setAttachments] = useState<File[]>(
    initial?.attachments ?? []
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-role`} className="text-sm font-medium text-zinc-800">
            Worker Role
          </label>
          <input
            id={`${formId}-role`}
            type="text"
            value={workerRole}
            onChange={(e) => setWorkerRole(e.target.value)}
            placeholder="e.g., Mason"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-count`} className="text-sm font-medium text-zinc-800">
            No. of Worker
          </label>
          <input
            id={`${formId}-count`}
            type="number"
            min="0"
            step="1"
            value={workerCount}
            onChange={(e) => setWorkerCount(e.target.value)}
            placeholder="00"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-rate`} className="text-sm font-medium text-zinc-800">
            Daily Rate
          </label>
          <CurrencyInput id={`${formId}-rate`} value={dailyRate} onChange={setDailyRate} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-ot`} className="text-sm font-medium text-zinc-800">
            OT Hours
          </label>
          <input
            id={`${formId}-ot`}
            type="number"
            min="0"
            step="0.5"
            value={otHours}
            onChange={(e) => setOtHours(e.target.value)}
            placeholder="00"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-overtime`} className="text-sm font-medium text-zinc-800">
            Renders Overtime
          </label>
          <input
            id={`${formId}-overtime`}
            type="number"
            min="0"
            step="1"
            value={workersRenderedOvertime}
            onChange={(e) => setWorkersRenderedOvertime(e.target.value)}
            placeholder="00"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-halfday`} className="text-sm font-medium text-zinc-800">
            Renders Halfday
          </label>
          <input
            id={`${formId}-halfday`}
            type="number"
            min="0"
            step="1"
            value={workersRenderedHalfday}
            onChange={(e) => setWorkersRenderedHalfday(e.target.value)}
            placeholder="00"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">Attachments</label>
        <AttachmentDropzone
          id={`${formId}-attachment`}
          files={attachments}
          onChange={setAttachments}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-remarks`} className="text-sm font-medium text-zinc-800">
          Remarks
        </label>
        <textarea
          id={`${formId}-remarks`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Add any notes"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          if (!workerRole.trim()) {
            setError("Enter a worker role.");
            return;
          }
          setError(null);
          onSave({
            workerRole: workerRole.trim(),
            workerCount,
            dailyRate,
            otHours,
            workersRenderedOvertime,
            workersRenderedHalfday,
            remarks,
            attachments,
          });
        }}
      />
    </div>
  );
}

// --- Other Expense -----------------------------------------------------

function ExpenseLogListScreen({
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  drafts: ExpenseLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  return (
    <ListScreenShell
      emptyLabel="No expense logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Other Expense Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={draft.expenseCategory || "—"}
          subtitle={`₱${draft.amount || "0"}${draft.additionalFees ? ` + ₱${draft.additionalFees} fees` : ""}`}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

function ExpenseLogFormScreen({
  initial,
  onCancel,
  onSave,
}: {
  initial?: ExpenseLogDraft;
  onCancel: () => void;
  onSave: (draft: ExpenseLogDraft) => void;
}) {
  const formId = useId();
  const [expenseCategory, setExpenseCategory] = useState(
    initial?.expenseCategory ?? ""
  );
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [additionalFees, setAdditionalFees] = useState(
    initial?.additionalFees ?? ""
  );
  const [description, setDescription] = useState(initial?.description ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [attachments, setAttachments] = useState<File[]>(
    initial?.attachments ?? []
  );
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-category`} className="text-sm font-medium text-zinc-800">
          Expense Category
        </label>
        <input
          id={`${formId}-category`}
          type="text"
          value={expenseCategory}
          onChange={(e) => setExpenseCategory(e.target.value)}
          placeholder="Subcontractor Fee, Rental, Permit & Licensing…"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-amount`} className="text-sm font-medium text-zinc-800">
            Amount
          </label>
          <CurrencyInput id={`${formId}-amount`} value={amount} onChange={setAmount} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${formId}-fees`} className="text-sm font-medium text-zinc-800">
            Additional Fees
          </label>
          <CurrencyInput
            id={`${formId}-fees`}
            value={additionalFees}
            onChange={setAdditionalFees}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-description`} className="text-sm font-medium text-zinc-800">
          Description
        </label>
        <textarea
          id={`${formId}-description`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe this expense"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">Attachments</label>
        <AttachmentDropzone
          id={`${formId}-attachment`}
          files={attachments}
          onChange={setAttachments}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={`${formId}-remarks`} className="text-sm font-medium text-zinc-800">
          Remarks
        </label>
        <textarea
          id={`${formId}-remarks`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Add any notes"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          if (!expenseCategory.trim()) {
            setError("Enter an expense category.");
            return;
          }
          setError(null);
          onSave({
            expenseCategory: expenseCategory.trim(),
            amount,
            additionalFees,
            description,
            remarks,
            attachments,
          });
        }}
      />
    </div>
  );
}

// --- Material Usage --------------------------------------------------------

function MaterialUsageListScreen({
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  drafts: MaterialUsageLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  return (
    <ListScreenShell
      emptyLabel="No material usage logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Usage Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={draft.materialName}
          subtitle={USAGE_STATUS_LABELS[draft.status]}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

/**
 * The "Select Material" picker — a table of the project's Materials
 * Monitoring records (see components/projects/materials/materials-
 * monitoring-view.tsx, same data). Rendered as a swapped-in view inside
 * MaterialUsageFormScreen rather than its own top-level Screen, so the
 * rest of the form (status/activity/remarks the user may have already
 * typed) survives the round-trip instead of being unmounted.
 */
function MaterialPickerScreen({
  materials,
  onSelect,
  onCancel,
}: {
  materials: ProjectMaterial[];
  onSelect: (material: ProjectMaterial) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">Material ID</th>
              <th className="px-3 py-2">Material Name</th>
              <th className="px-3 py-2">Specification / Size</th>
              <th className="px-3 py-2">Quantity</th>
              <th className="px-3 py-2">Unit</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {materials.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  No materials recorded yet — add one from Materials Monitoring
                  first.
                </td>
              </tr>
            ) : (
              materials.map((material) => (
                <tr
                  key={material.id}
                  onClick={() => onSelect(material)}
                  className="cursor-pointer transition hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5 font-medium text-zinc-900">
                    {material.materialCode}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-700">
                    {material.materialName}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {material.specification || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {String(material.quantity).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {material.unit || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function MaterialUsageFormScreen({
  materials,
  initial,
  onCancel,
  onSave,
}: {
  materials: ProjectMaterial[];
  initial?: MaterialUsageLogDraft;
  onCancel: () => void;
  onSave: (draft: MaterialUsageLogDraft) => void;
}) {
  const formId = useId();
  const [selected, setSelected] = useState<{
    id: number;
    materialCode: string;
    materialName: string;
    specification: string | null;
    unit: string | null;
  } | null>(
    initial
      ? {
          id: initial.projectMaterialId,
          materialCode: initial.materialCode,
          materialName: initial.materialName,
          specification: initial.specification,
          unit: initial.unit,
        }
      : null
  );
  const [status, setStatus] = useState<MaterialStatus>(
    initial?.status ?? "available"
  );
  const [activity, setActivity] = useState(initial?.activity ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [error, setError] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);

  if (showPicker) {
    return (
      <MaterialPickerScreen
        materials={materials}
        onSelect={(material) => {
          setSelected({
            id: material.id,
            materialCode: material.materialCode,
            materialName: material.materialName,
            specification: material.specification,
            unit: material.unit,
          });
          setShowPicker(false);
        }}
        onCancel={() => setShowPicker(false)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">
          Select Material
        </label>
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <span className={selected ? "text-zinc-900" : "text-zinc-400"}>
            {selected ? selected.materialName : "Select a material"}
          </span>
          {selected?.unit && (
            <span className="flex-shrink-0 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-600">
              {selected.unit}
            </span>
          )}
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">
          Specification
        </label>
        <div className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-500">
          {selected?.specification || "—"}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-status`}
          className="text-sm font-medium text-zinc-800"
        >
          Usage Status
        </label>
        <select
          id={`${formId}-status`}
          value={status}
          onChange={(e) => setStatus(e.target.value as MaterialStatus)}
          className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <option value="available">Available</option>
          <option value="low_stock">Low Stock</option>
          <option value="fully_consumed">Fully Consumed</option>
        </select>
        <div className="flex flex-col gap-1 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs text-zinc-500">
          <p>
            <span className="font-semibold text-zinc-700">Available:</span>{" "}
            Enough for current and next activity
          </p>
          <p>
            <span className="font-semibold text-zinc-700">Low Stock:</span>{" "}
            Not enough for next activity
          </p>
          <p>
            <span className="font-semibold text-zinc-700">
              Fully Consumed:
            </span>{" "}
            No remaining usable material
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-activity`}
          className="text-sm font-medium text-zinc-800"
        >
          Activity
        </label>
        <textarea
          id={`${formId}-activity`}
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          rows={3}
          placeholder="Describe what was done"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-remarks`}
          className="text-sm font-medium text-zinc-800"
        >
          Remarks
        </label>
        <textarea
          id={`${formId}-remarks`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Add any notes"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          if (!selected) {
            setError("Select a material.");
            return;
          }
          setError(null);
          onSave({
            projectMaterialId: selected.id,
            materialCode: selected.materialCode,
            materialName: selected.materialName,
            specification: selected.specification,
            unit: selected.unit,
            status,
            activity,
            remarks,
          });
        }}
      />
    </div>
  );
}

// --- Material Procurement ------------------------------------------------

const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  direct_purchase: "Direct Purchase",
  supplier_delivery: "Supplier Delivery",
};

function ProcurementLogListScreen({
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  drafts: ProcurementLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  return (
    <ListScreenShell
      emptyLabel="No material procurement logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={
            draft.supplierName ||
            PROCUREMENT_TYPE_LABELS[draft.procurementType] ||
            "—"
          }
          subtitle={[
            draft.items.length > 1
              ? `${draft.items[0]?.materialName ?? "—"} +${draft.items.length - 1} more`
              : (draft.items[0]?.materialName ?? "No items"),
            draft.materialRequestMrNo ? `Fulfilling ${draft.materialRequestMrNo}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

function RequestStatusBadge({ status }: { status: MaterialRequestDetail["status"] }) {
  const styles: Record<string, string> = {
    submitted: "bg-zinc-100 text-zinc-600",
    approved: "bg-sky-50 text-sky-700",
    partially_fulfilled: "bg-amber-50 text-amber-700",
    fulfilled: "bg-emerald-50 text-emerald-700",
    canceled: "bg-red-50 text-red-600",
  };
  const labels: Record<string, string> = {
    submitted: "Submitted",
    approved: "Approved",
    partially_fulfilled: "Partially Fulfilled",
    fulfilled: "Fulfilled",
    canceled: "Canceled",
  };
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}

function formatRequestDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * Step 1 of the "Material Request Number" picker — every request on this
 * project that can still receive a delivery (see listFulfillableMaterial
 * Requests), same table shape as the Materials tab's own Material
 * Requests list. Picking a row moves on to RequestItemPickerScreen
 * rather than selecting anything itself, since a procurement item needs
 * one specific item off the request, not the request as a whole.
 */
function RequestPickerScreen({
  requests,
  onSelect,
  onCancel,
}: {
  requests: MaterialRequestDetail[];
  onSelect: (request: MaterialRequestDetail) => void;
  onCancel: () => void;
}) {
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = [...requests].sort((a, b) => {
    const cmp = a.requestDate.localeCompare(b.requestDate);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() =>
                    setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
                  }
                  className="flex cursor-pointer items-center gap-1 transition-colors hover:text-zinc-900"
                >
                  Request Date
                  {sortDir === "asc" ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
              </th>
              <th className="px-3 py-2">MR-No</th>
              <th className="px-3 py-2">Requested By</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  No material requests can receive a delivery right now.
                </td>
              </tr>
            ) : (
              sorted.map((request) => (
                <tr
                  key={request.id}
                  onClick={() => onSelect(request)}
                  className="cursor-pointer transition hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-500">
                    {formatRequestDate(request.requestDate)}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-zinc-900">
                    {request.mrNo}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {request.requestedByName}
                  </td>
                  <td className="px-3 py-2.5">
                    <RequestStatusBadge status={request.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Step 2 — the chosen request's own items, already-fulfilled ones still
 * shown but distinguishable via the fulfilment column so it's obvious
 * there's nothing left to deliver against them.
 */
function RequestItemPickerScreen({
  request,
  onSelect,
  onCancel,
}: {
  request: MaterialRequestDetail;
  onSelect: (item: MaterialRequestDetail["items"][number]) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-zinc-900">{request.mrNo}</p>
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">Material Name</th>
              <th className="px-3 py-2">Specification</th>
              <th className="px-3 py-2">Quantity</th>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2">Purpose of Request</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {request.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  This request has no items.
                </td>
              </tr>
            ) : (
              request.items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="cursor-pointer transition hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5 font-medium text-zinc-900">
                    {item.materialName}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {item.specification || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {String(item.quantityNeeded).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">{item.uom || "—"}</td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {item.purpose || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function ProcurementLogFormScreen({
  materialRequests,
  initial,
  onCancel,
  onSave,
}: {
  materialRequests: MaterialRequestDetail[];
  initial?: ProcurementLogDraft;
  onCancel: () => void;
  onSave: (draft: ProcurementLogDraft) => void;
}) {
  const formId = useId();
  const [procurementType, setProcurementType] = useState(
    initial?.procurementType ?? "direct_purchase"
  );
  const [supplierName, setSupplierName] = useState(initial?.supplierName ?? "");
  const [materialRequestId, setMaterialRequestId] = useState(
    initial?.materialRequestId ?? null
  );
  const [materialRequestMrNo, setMaterialRequestMrNo] = useState(
    initial?.materialRequestMrNo ?? null
  );
  const [additionalFees, setAdditionalFees] = useState(
    initial?.additionalFees ?? ""
  );
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [attachments, setAttachments] = useState<File[]>(
    initial?.attachments ?? []
  );
  const [items, setItems] = useState<ProcurementItemDraft[]>(
    initial?.items ?? [{ ...blankProcurementItem }]
  );
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"none" | "request" | "item">("none");
  const [pickedRequest, setPickedRequest] = useState<MaterialRequestDetail | null>(
    null
  );

  function updateItem(index: number, patch: Partial<ProcurementItemDraft>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  if (picker === "request") {
    return (
      <RequestPickerScreen
        requests={materialRequests}
        onSelect={(request) => {
          setPickedRequest(request);
          setPicker("item");
        }}
        onCancel={() => setPicker("none")}
      />
    );
  }

  if (picker === "item" && pickedRequest) {
    return (
      <RequestItemPickerScreen
        request={pickedRequest}
        onSelect={(item) => {
          setMaterialRequestId(pickedRequest.id);
          setMaterialRequestMrNo(pickedRequest.mrNo);
          setItems((prev) => {
            const newItem: ProcurementItemDraft = {
              materialRequestItemId: item.id,
              materialName: item.materialName,
              specification: item.specification ?? "",
              quantity: String(item.quantityRemaining || item.quantityNeeded),
              unit: item.uom ?? "",
              cost: "",
            };
            // The default blank first row (never touched) gets replaced
            // rather than left dangling as an empty item alongside it.
            if (
              prev.length === 1 &&
              !prev[0].materialName &&
              prev[0].materialRequestItemId === null
            ) {
              return [newItem];
            }
            return [...prev, newItem];
          });
          setPicker("none");
        }}
        onCancel={() => setPicker("none")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-type`}
            className="text-sm font-medium text-zinc-800"
          >
            Procurement Type
          </label>
          <select
            id={`${formId}-type`}
            value={procurementType}
            onChange={(e) => setProcurementType(e.target.value)}
            className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="direct_purchase">Direct Purchase</option>
            <option value="supplier_delivery">Supplier Delivery</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-supplier`}
            className="text-sm font-medium text-zinc-800"
          >
            Supplier / Store Name
          </label>
          <input
            id={`${formId}-supplier`}
            type="text"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            placeholder="e.g., Coco Hardware"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-800">
            Material Request Number{" "}
            <span className="font-normal text-zinc-400">(optional)</span>
          </label>
          <button
            type="button"
            onClick={() => setPicker("request")}
            className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <span className={materialRequestMrNo ? "text-zinc-900" : "text-zinc-400"}>
              {materialRequestMrNo ?? "MR-000"}
            </span>
          </button>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-fees`}
            className="text-sm font-medium text-zinc-800"
          >
            Additional Fees
          </label>
          <CurrencyInput
            id={`${formId}-fees`}
            value={additionalFees}
            onChange={setAdditionalFees}
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-zinc-900">Items</h3>
        <button
          type="button"
          onClick={() => setItems((prev) => [...prev, { ...blankProcurementItem }])}
          className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
        >
          <Plus className="size-3.5" />
          Add Item
        </button>
      </div>

      <div className="flex flex-col gap-3">
        {items.map((item, index) => (
          <div key={index} className="rounded-lg border border-zinc-200 bg-white p-3">
            {item.materialRequestItemId != null && (
              <p className="mb-2 text-xs font-medium text-sky-600">
                Fulfilling {materialRequestMrNo}
              </p>
            )}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">
                  Material Name
                </label>
                <input
                  value={item.materialName}
                  onChange={(e) =>
                    updateItem(index, { materialName: e.target.value })
                  }
                  placeholder="e.g., Plywood"
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">
                  Quantity
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: e.target.value })}
                  placeholder="00"
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Unit</label>
                <input
                  value={item.unit}
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                  placeholder="pcs"
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                />
              </div>

              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">
                  Specification
                </label>
                <input
                  value={item.specification}
                  onChange={(e) =>
                    updateItem(index, { specification: e.target.value })
                  }
                  placeholder="e.g., 3/8 in. x 4 ft x 8ft"
                  className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Cost</label>
                <CurrencyInput
                  id={`${formId}-cost-${index}`}
                  value={item.cost}
                  onChange={(value) => updateItem(index, { cost: value })}
                />
              </div>
            </div>

            {items.length > 1 && (
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => removeItem(index)}
                  className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-400 transition hover:text-red-600"
                >
                  <X className="size-3.5" />
                  Remove item
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">Attachments</label>
        <AttachmentDropzone
          id={`${formId}-attachment`}
          files={attachments}
          onChange={setAttachments}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-remarks`}
          className="text-sm font-medium text-zinc-800"
        >
          Remarks
        </label>
        <textarea
          id={`${formId}-remarks`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Add any notes"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          const validItems = items.filter((item) => item.materialName.trim());
          if (validItems.length === 0) {
            setError("Add at least one item with a material name.");
            return;
          }
          setError(null);
          onSave({
            procurementType,
            supplierName: supplierName.trim(),
            materialRequestId,
            materialRequestMrNo,
            additionalFees,
            remarks,
            attachments,
            items: validItems,
          });
        }}
      />
    </div>
  );
}

// --- Equipment Acquisition -------------------------------------------------

const ACQUISITION_TYPE_LABELS: Record<string, string> = {
  rental: "Rental",
  purchase: "Purchase",
};

function EquipmentAcquisitionListScreen({
  drafts,
  onAdd,
  onEdit,
  onRemove,
  onDone,
}: {
  drafts: EquipmentAcquisitionLogDraft[];
  onAdd: () => void;
  onEdit: (index: number) => void;
  onRemove: (index: number) => void;
  onDone: () => void;
}) {
  return (
    <ListScreenShell
      emptyLabel="No equipment acquisition logs added yet."
      onDone={onDone}
      onAdd={onAdd}
      addLabel="Add Log"
    >
      {drafts.map((draft, index) => (
        <DraftRow
          key={index}
          title={draft.equipmentName || "—"}
          subtitle={[
            `${draft.quantity || "0"} · ${ACQUISITION_TYPE_LABELS[draft.acquisitionType] ?? draft.acquisitionType}`,
            draft.equipmentRequestErNo
              ? `Fulfilling ${draft.equipmentRequestErNo}`
              : null,
          ]
            .filter(Boolean)
            .join(" · ")}
          onEdit={() => onEdit(index)}
          onRemove={() => onRemove(index)}
        />
      ))}
    </ListScreenShell>
  );
}

/**
 * Step 1 of the "Equipment Request Number" picker — every request on
 * this project that can still receive an acquisition (see
 * listFulfillableEquipmentRequests), same table shape (and same
 * RequestStatusBadge/formatRequestDate) as Material Procurement's own
 * request picker. Picking a row moves on to
 * EquipmentRequestItemPickerScreen rather than selecting anything
 * itself, since an acquisition needs one specific item off the request,
 * not the request as a whole.
 */
function EquipmentRequestPickerScreen({
  requests,
  onSelect,
  onCancel,
}: {
  requests: EquipmentRequestDetail[];
  onSelect: (request: EquipmentRequestDetail) => void;
  onCancel: () => void;
}) {
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = [...requests].sort((a, b) => {
    const cmp = a.requestDate.localeCompare(b.requestDate);
    return sortDir === "asc" ? cmp : -cmp;
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">
                <button
                  type="button"
                  onClick={() =>
                    setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
                  }
                  className="flex cursor-pointer items-center gap-1 transition-colors hover:text-zinc-900"
                >
                  Request Date
                  {sortDir === "asc" ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </button>
              </th>
              <th className="px-3 py-2">ER-No</th>
              <th className="px-3 py-2">Requested By</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {sorted.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-zinc-400">
                  No equipment requests can receive an acquisition right now.
                </td>
              </tr>
            ) : (
              sorted.map((request) => (
                <tr
                  key={request.id}
                  onClick={() => onSelect(request)}
                  className="cursor-pointer transition hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-zinc-500">
                    {formatRequestDate(request.requestDate)}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-zinc-900">
                    {request.erNo}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {request.requestedByName}
                  </td>
                  <td className="px-3 py-2.5">
                    <RequestStatusBadge status={request.status} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/**
 * Step 2 — the chosen request's own items, same "already-fulfilled ones
 * still shown, distinguishable via the fulfilment column" reasoning as
 * Material Procurement's own item picker (fulfilment column omitted
 * here purely for column-count parity with the reference form, not a
 * deliberate difference).
 */
function EquipmentRequestItemPickerScreen({
  request,
  onSelect,
  onCancel,
}: {
  request: EquipmentRequestDetail;
  onSelect: (item: EquipmentRequestDetail["items"][number]) => void;
  onCancel: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold text-zinc-900">{request.erNo}</p>
      <div className="max-h-80 overflow-auto rounded-lg border border-zinc-200">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-xs font-medium text-zinc-500">
            <tr>
              <th className="px-3 py-2">Equipment Name</th>
              <th className="px-3 py-2">Specification</th>
              <th className="px-3 py-2">Quantity</th>
              <th className="px-3 py-2">UOM</th>
              <th className="px-3 py-2">Purpose of Request</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {request.items.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-400">
                  This request has no items.
                </td>
              </tr>
            ) : (
              request.items.map((item) => (
                <tr
                  key={item.id}
                  onClick={() => onSelect(item)}
                  className="cursor-pointer transition hover:bg-zinc-50"
                >
                  <td className="px-3 py-2.5 font-medium text-zinc-900">
                    {item.equipmentName}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {item.specification || "—"}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {String(item.quantityNeeded).padStart(2, "0")}
                  </td>
                  <td className="px-3 py-2.5 text-zinc-600">{item.uom || "—"}</td>
                  <td className="px-3 py-2.5 text-zinc-600">
                    {item.purpose || "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function EquipmentAcquisitionFormScreen({
  equipmentRequests,
  initial,
  onCancel,
  onSave,
}: {
  equipmentRequests: EquipmentRequestDetail[];
  initial?: EquipmentAcquisitionLogDraft;
  onCancel: () => void;
  onSave: (draft: EquipmentAcquisitionLogDraft) => void;
}) {
  const formId = useId();
  const [equipmentRequestId, setEquipmentRequestId] = useState(
    initial?.equipmentRequestId ?? null
  );
  const [equipmentRequestErNo, setEquipmentRequestErNo] = useState(
    initial?.equipmentRequestErNo ?? null
  );
  const [equipmentRequestItemId, setEquipmentRequestItemId] = useState(
    initial?.equipmentRequestItemId ?? null
  );
  const [equipmentName, setEquipmentName] = useState(initial?.equipmentName ?? "");
  const [specification, setSpecification] = useState(
    initial?.specification ?? ""
  );
  const [quantity, setQuantity] = useState(initial?.quantity ?? "");
  const [acquisitionType, setAcquisitionType] = useState(
    initial?.acquisitionType ?? "rental"
  );
  const [amount, setAmount] = useState(initial?.amount ?? "");
  const [remarks, setRemarks] = useState(initial?.remarks ?? "");
  const [attachments, setAttachments] = useState<File[]>(
    initial?.attachments ?? []
  );
  const [error, setError] = useState<string | null>(null);
  const [picker, setPicker] = useState<"none" | "request" | "item">("none");
  const [pickedRequest, setPickedRequest] = useState<EquipmentRequestDetail | null>(
    null
  );

  if (picker === "request") {
    return (
      <EquipmentRequestPickerScreen
        requests={equipmentRequests}
        onSelect={(request) => {
          setPickedRequest(request);
          setPicker("item");
        }}
        onCancel={() => setPicker("none")}
      />
    );
  }

  if (picker === "item" && pickedRequest) {
    return (
      <EquipmentRequestItemPickerScreen
        request={pickedRequest}
        onSelect={(item) => {
          setEquipmentRequestId(pickedRequest.id);
          setEquipmentRequestErNo(pickedRequest.erNo);
          setEquipmentRequestItemId(item.id);
          setEquipmentName(item.equipmentName);
          setSpecification(item.specification ?? "");
          setQuantity(String(item.quantityRemaining || item.quantityNeeded));
          setPicker("none");
        }}
        onCancel={() => setPicker("none")}
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {equipmentRequestErNo != null && (
        <p className="text-xs font-medium text-sky-600">
          Fulfilling {equipmentRequestErNo}
        </p>
      )}

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-name`}
          className="text-sm font-medium text-zinc-800"
        >
          Equipment Name
        </label>
        <input
          id={`${formId}-name`}
          type="text"
          value={equipmentName}
          onChange={(e) => setEquipmentName(e.target.value)}
          placeholder="e.g., Concrete Mixer"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-quantity`}
            className="text-sm font-medium text-zinc-800"
          >
            Quantity
          </label>
          <input
            id={`${formId}-quantity`}
            type="number"
            min="0"
            step="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="00"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-spec`}
            className="text-sm font-medium text-zinc-800"
          >
            Specification
          </label>
          <input
            id={`${formId}-spec`}
            type="text"
            value={specification}
            onChange={(e) => setSpecification(e.target.value)}
            placeholder="e.g., Model X120"
            className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-type`}
            className="text-sm font-medium text-zinc-800"
          >
            Type
          </label>
          <select
            id={`${formId}-type`}
            value={acquisitionType}
            onChange={(e) => setAcquisitionType(e.target.value)}
            className="cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          >
            <option value="rental">Rental</option>
            <option value="purchase">Purchase</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            htmlFor={`${formId}-amount`}
            className="text-sm font-medium text-zinc-800"
          >
            Amount
          </label>
          <CurrencyInput id={`${formId}-amount`} value={amount} onChange={setAmount} />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">
          Equipment Request Number{" "}
          <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <button
          type="button"
          onClick={() => setPicker("request")}
          className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-zinc-200 bg-white px-3 py-2 text-left text-sm outline-none transition hover:border-zinc-300 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        >
          <span className={equipmentRequestErNo ? "text-zinc-900" : "text-zinc-400"}>
            {equipmentRequestErNo ?? "ER-000"}
          </span>
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-zinc-800">Attachments</label>
        <AttachmentDropzone
          id={`${formId}-attachment`}
          files={attachments}
          onChange={setAttachments}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <label
          htmlFor={`${formId}-remarks`}
          className="text-sm font-medium text-zinc-800"
        >
          Remarks
        </label>
        <textarea
          id={`${formId}-remarks`}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={3}
          placeholder="Add any notes"
          className="rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <FormActions
        onCancel={onCancel}
        onSave={() => {
          if (!equipmentName.trim()) {
            setError("Equipment Name is required.");
            return;
          }
          setError(null);
          onSave({
            equipmentRequestId,
            equipmentRequestErNo,
            equipmentRequestItemId,
            equipmentName: equipmentName.trim(),
            specification,
            quantity,
            acquisitionType,
            amount,
            remarks,
            attachments,
          });
        }}
      />
    </div>
  );
}
