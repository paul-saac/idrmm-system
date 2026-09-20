"use client";

import { useActionState, useEffect, useState } from "react";
import { EditIcon } from "@/components/icons/edit-icon";
import { Modal } from "@/components/ui/modal";
import { updateFlaggedEntry, type FlagActionState } from "@/lib/daily-logs/actions";
import type {
  DailyLogWorkItemDetail,
  DailyLogLaborItemDetail,
  DailyLogExpenseItemDetail,
  DailyLogMaterialUsageItemDetail,
  DailyLogProcurementDetail,
  DailyLogEquipmentAcquisitionDetail,
} from "@/lib/daily-logs/data";
import type { CategoryOption } from "@/components/projects/daily-logs/add-daily-log-modal";
import type { ProjectMaterial } from "@/lib/materials/data";

const initialState: FlagActionState = {};
const fieldInput =
  "rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";
const fieldLabel = "text-sm font-medium text-zinc-800";

/**
 * The stand-in for a foreman-facing edit form — today only an admin can
 * reach this (see updateFlaggedEntry's own doc comment on why), so it's
 * deliberately plain: bare inputs/selects, no dropzones or multi-step
 * pickers, just enough to correct what a flag called out as wrong. When
 * the Foreman portal exists, it can either reuse this component as-is
 * or get a nicer one — updateFlaggedEntry's contract doesn't change
 * either way.
 */
type EditFlaggedEntryProps =
  | {
      entryType: "work_item";
      entry: DailyLogWorkItemDetail;
      categories: CategoryOption[];
    }
  | { entryType: "labor_item"; entry: DailyLogLaborItemDetail }
  | { entryType: "expense_item"; entry: DailyLogExpenseItemDetail }
  | {
      entryType: "material_usage_item";
      entry: DailyLogMaterialUsageItemDetail;
      materials: ProjectMaterial[];
    }
  | { entryType: "material_procurement"; entry: DailyLogProcurementDetail }
  | {
      entryType: "equipment_acquisition";
      entry: DailyLogEquipmentAcquisitionDetail;
    };

export function EditFlaggedEntryModal(
  props: EditFlaggedEntryProps & {
    dailyLogId: number;
    projectId: number;
    open: boolean;
    onClose: () => void;
  }
) {
  const { dailyLogId, projectId, open, onClose } = props;
  const boundAction = updateFlaggedEntry.bind(
    null,
    dailyLogId,
    projectId,
    props.entryType,
    props.entry.id
  );
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  useEffect(() => {
    if (state.success) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <Modal open={open} onClose={onClose} title="Correct Flagged Entry">
      <form action={formAction} className="flex flex-col gap-4">
        {props.entryType === "work_item" && (
          <WorkItemFields entry={props.entry} categories={props.categories} />
        )}
        {props.entryType === "labor_item" && (
          <LaborItemFields entry={props.entry} />
        )}
        {props.entryType === "expense_item" && (
          <ExpenseItemFields entry={props.entry} />
        )}
        {props.entryType === "material_usage_item" && (
          <MaterialUsageItemFields entry={props.entry} materials={props.materials} />
        )}
        {props.entryType === "material_procurement" && (
          <ProcurementFields entry={props.entry} />
        )}
        {props.entryType === "equipment_acquisition" && (
          <EquipmentAcquisitionFields entry={props.entry} />
        )}

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
          <button
            type="submit"
            disabled={pending}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? "Saving..." : "Save correction"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The small trigger + local open state most callers actually want —
 * rendered next to (not inside) FlagControl for a flagged entry that's
 * still open or awaiting re-review on an approved log, so the flag's
 * own status/actions and the "go fix it" affordance stay visually
 * distinct instead of crowding one control.
 */
export function EditFlaggedEntryButton(
  props: EditFlaggedEntryProps & { dailyLogId: number; projectId: number }
) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Edit this entry"
        title="Edit this entry"
        className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700"
      >
        <EditIcon className="size-3" />
      </button>
      <EditFlaggedEntryModal {...props} open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function WorkItemFields({
  entry,
  categories,
}: {
  entry: DailyLogWorkItemDetail;
  categories: CategoryOption[];
}) {
  const [categoryId, setCategoryId] = useState(entry.categoryId);
  const [taskId, setTaskId] = useState(entry.taskId);
  const [quantityCompleted, setQuantityCompleted] = useState(
    String(entry.quantityCompleted)
  );
  const [unit, setUnit] = useState(entry.unit ?? "");
  const [activity, setActivity] = useState(entry.activity ?? "");
  const tasksForCategory = categories.find((c) => c.id === categoryId)?.tasks ?? [];

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Phase Category</label>
        <select
          name="categoryId"
          value={categoryId}
          onChange={(e) => {
            setCategoryId(Number(e.target.value));
            setTaskId(0);
          }}
          className={`${fieldInput} cursor-pointer bg-white`}
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Work Item</label>
        <select
          name="taskId"
          value={taskId}
          onChange={(e) => {
            const id = Number(e.target.value);
            setTaskId(id);
            const task = tasksForCategory.find((t) => t.id === id);
            if (task) setUnit(task.unit ?? "");
          }}
          className={`${fieldInput} cursor-pointer bg-white`}
        >
          <option value={0} disabled>
            Select Work Item
          </option>
          {tasksForCategory.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Quantity Completed</label>
          <input
            name="quantityCompleted"
            type="number"
            min="0"
            step="0.01"
            value={quantityCompleted}
            onChange={(e) => setQuantityCompleted(e.target.value)}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Unit</label>
          <input
            name="unit"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Activity</label>
        <textarea
          name="activity"
          value={activity}
          onChange={(e) => setActivity(e.target.value)}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}

function LaborItemFields({ entry }: { entry: DailyLogLaborItemDetail }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Worker Role</label>
        <input
          name="workerRole"
          defaultValue={entry.workerRole}
          className={fieldInput}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>No. of Workers</label>
          <input
            name="workerCount"
            type="number"
            min="0"
            defaultValue={entry.workerCount}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Daily Rate</label>
          <input
            name="dailyRate"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.dailyRate}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>OT Hours</label>
          <input
            name="otHours"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.otHours}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Renders Overtime</label>
          <input
            name="workersRenderedOvertime"
            type="number"
            min="0"
            defaultValue={entry.workersRenderedOvertime}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Renders Halfday</label>
          <input
            name="workersRenderedHalfday"
            type="number"
            min="0"
            defaultValue={entry.workersRenderedHalfday}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Remarks</label>
        <textarea
          name="remarks"
          defaultValue={entry.remarks ?? ""}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}

function ExpenseItemFields({ entry }: { entry: DailyLogExpenseItemDetail }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Expense Category</label>
        <input
          name="expenseCategory"
          defaultValue={entry.expenseCategory}
          className={fieldInput}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Amount</label>
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.amount}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Additional Fees</label>
          <input
            name="additionalFees"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.additionalFees}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Description</label>
        <input
          name="description"
          defaultValue={entry.description ?? ""}
          className={fieldInput}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Remarks</label>
        <textarea
          name="remarks"
          defaultValue={entry.remarks ?? ""}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}

function MaterialUsageItemFields({
  entry,
  materials,
}: {
  entry: DailyLogMaterialUsageItemDetail;
  materials: ProjectMaterial[];
}) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Material</label>
        <select
          name="projectMaterialId"
          defaultValue={entry.projectMaterialId}
          className={`${fieldInput} cursor-pointer bg-white`}
        >
          {materials.map((m) => (
            <option key={m.id} value={m.id}>
              {m.materialCode} — {m.materialName}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Usage Status</label>
        <select
          name="status"
          defaultValue={entry.status}
          className={`${fieldInput} cursor-pointer bg-white`}
        >
          <option value="available">Available</option>
          <option value="low_stock">Low Stock</option>
          <option value="fully_consumed">Fully Consumed</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Activity</label>
        <input
          name="activity"
          defaultValue={entry.activity ?? ""}
          className={fieldInput}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Remarks</label>
        <textarea
          name="remarks"
          defaultValue={entry.remarks ?? ""}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}

function ProcurementFields({ entry }: { entry: DailyLogProcurementDetail }) {
  const [procurementType, setProcurementType] = useState(entry.procurementType);
  const [supplierName, setSupplierName] = useState(entry.supplierName ?? "");
  const [additionalFees, setAdditionalFees] = useState(String(entry.additionalFees));
  const [remarks, setRemarks] = useState(entry.remarks ?? "");
  const [items, setItems] = useState(
    entry.items.map((item) => ({
      id: item.id,
      materialName: item.materialName,
      specification: item.specification ?? "",
      quantity: String(item.quantity),
      unit: item.unit ?? "",
      cost: String(item.cost),
    }))
  );

  function updateItem(index: number, patch: Partial<(typeof items)[number]>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  return (
    <>
      <input
        type="hidden"
        name="itemsJson"
        value={JSON.stringify(
          items.map((item) => ({
            ...item,
            quantity: Number(item.quantity) || 0,
            cost: Number(item.cost) || 0,
          }))
        )}
        readOnly
      />
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Procurement Type</label>
          <select
            name="procurementType"
            value={procurementType}
            onChange={(e) =>
              setProcurementType(
                e.target.value as "direct_purchase" | "supplier_delivery"
              )
            }
            className={`${fieldInput} cursor-pointer bg-white`}
          >
            <option value="direct_purchase">Direct Purchase</option>
            <option value="supplier_delivery">Supplier Delivery</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Supplier / Store Name</label>
          <input
            name="supplierName"
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Additional Fees</label>
        <input
          name="additionalFees"
          type="number"
          min="0"
          step="0.01"
          value={additionalFees}
          onChange={(e) => setAdditionalFees(e.target.value)}
          className={fieldInput}
        />
      </div>

      {entry.materialRequestMrNo && (
        <p className="text-xs text-zinc-500">
          Fulfilling {entry.materialRequestMrNo} — the link itself can&apos;t
          be changed here.
        </p>
      )}

      <div className="flex flex-col gap-3">
        <p className="text-sm font-semibold text-zinc-900">Items</p>
        {items.map((item, index) => (
          <div key={item.id} className="rounded-lg border border-zinc-200 p-3">
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
                  className={fieldInput}
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
                  className={fieldInput}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Unit</label>
                <input
                  value={item.unit}
                  onChange={(e) => updateItem(index, { unit: e.target.value })}
                  className={fieldInput}
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
                  className={fieldInput}
                />
              </div>
              <div className="col-span-2 flex flex-col gap-1">
                <label className="text-xs font-medium text-zinc-500">Cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={item.cost}
                  onChange={(e) => updateItem(index, { cost: e.target.value })}
                  className={fieldInput}
                />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Remarks</label>
        <textarea
          name="remarks"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}

function EquipmentAcquisitionFields({
  entry,
}: {
  entry: DailyLogEquipmentAcquisitionDetail;
}) {
  return (
    <>
      {entry.equipmentRequestErNo && (
        <p className="text-xs text-zinc-500">
          Fulfilling {entry.equipmentRequestErNo} — the link itself can&apos;t
          be changed here.
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Equipment Name</label>
        <input
          name="equipmentName"
          defaultValue={entry.equipmentName}
          className={fieldInput}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Specification</label>
          <input
            name="specification"
            defaultValue={entry.specification ?? ""}
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Quantity</label>
          <input
            name="quantity"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.quantity}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Type</label>
          <select
            name="acquisitionType"
            defaultValue={entry.acquisitionType}
            className={`${fieldInput} cursor-pointer bg-white`}
          >
            <option value="rental">Rental</option>
            <option value="purchase">Purchase</option>
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <label className={fieldLabel}>Amount</label>
          <input
            name="amount"
            type="number"
            min="0"
            step="0.01"
            defaultValue={entry.amount}
            className={fieldInput}
          />
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={fieldLabel}>Remarks</label>
        <textarea
          name="remarks"
          defaultValue={entry.remarks ?? ""}
          rows={2}
          className={fieldInput}
        />
      </div>
    </>
  );
}
