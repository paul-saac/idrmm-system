"use client";

import { useActionState, useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import {
  createMaterialRequest,
  updateMaterialRequest,
  type MaterialRequestActionState,
} from "@/lib/material-requests/actions";
import { OTHER_UNIT, UNIT_OPTIONS } from "@/lib/cost-estimate/units";
import type {
  MaterialRequestDetail,
  MaterialRequestPriority,
} from "@/lib/material-requests/data";

const initialState: MaterialRequestActionState = {};

const PRIORITY_OPTIONS: {
  value: MaterialRequestPriority;
  label: string;
  hint: string;
}[] = [
  {
    value: "routine",
    label: "Routine",
    hint: "Standard request — can be scheduled and delivered as usual.",
  },
  {
    value: "urgent",
    label: "Urgent",
    hint: "Needed soon to keep the schedule from slipping.",
  },
  {
    value: "emergency",
    label: "Emergency",
    hint: "Immediate — addresses a safety issue or critical stoppage.",
  },
];

type EditableItem = {
  id: number | null;
  materialName: string;
  specification: string;
  quantityNeeded: string;
  uom: string;
  purpose: string;
  quantityFulfilled: string;
};

const blankItem: EditableItem = {
  id: null,
  materialName: "",
  specification: "",
  quantityNeeded: "",
  uom: "",
  purpose: "",
  quantityFulfilled: "0",
};

function toEditable(request: MaterialRequestDetail): EditableItem[] {
  return request.items.map((item) => ({
    id: item.id,
    materialName: item.materialName,
    specification: item.specification ?? "",
    quantityNeeded: String(item.quantityNeeded),
    uom: item.uom ?? "",
    purpose: item.purpose ?? "",
    quantityFulfilled: String(item.quantityFulfilled),
  }));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

const fieldLabel = "text-xs font-medium text-zinc-500";
const fieldInput =
  "rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

/** The "+ Add Item" sub-screen — a small local-only form (nothing here
 * has a `name` attribute, so none of it submits directly; committing it
 * writes into the parent's `items` state instead, same "step inside the
 * modal" pattern as Add Daily Log's Work Log/Labor Log/etc. sub-screens). */
function ItemForm({
  showFulfilled,
  initial,
  onCancel,
  onSave,
}: {
  showFulfilled: boolean;
  initial: EditableItem;
  onCancel: () => void;
  onSave: (item: EditableItem) => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const initialUnitIsKnown =
    !initial.uom || (UNIT_OPTIONS as readonly string[]).includes(initial.uom);
  const [selectedUnit, setSelectedUnit] = useState(
    initialUnitIsKnown ? initial.uom : OTHER_UNIT
  );

  function patch(fields: Partial<EditableItem>) {
    setDraft((prev) => ({ ...prev, ...fields }));
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-zinc-800">
            Material Name
          </label>
          <input
            value={draft.materialName}
            onChange={(e) => patch({ materialName: e.target.value })}
            placeholder="e.g., Plywood"
            className={fieldInput}
            autoFocus
          />
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-zinc-800">
            Specification / Size
          </label>
          <input
            value={draft.specification}
            onChange={(e) => patch({ specification: e.target.value })}
            placeholder="e.g., 3/8 in. x 4 ft x 8ft"
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-800">
            Quantity Needed
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={draft.quantityNeeded}
            onChange={(e) => patch({ quantityNeeded: e.target.value })}
            placeholder="00"
            className={fieldInput}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-sm font-medium text-zinc-800">UOM</label>
          <select
            value={selectedUnit}
            onChange={(e) => {
              setSelectedUnit(e.target.value);
              if (e.target.value !== OTHER_UNIT) patch({ uom: e.target.value });
              else patch({ uom: "" });
            }}
            className={`${fieldInput} cursor-pointer bg-white`}
          >
            <option value="">Select unit</option>
            {UNIT_OPTIONS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
            <option value={OTHER_UNIT}>Other (specify)</option>
          </select>
          {selectedUnit === OTHER_UNIT && (
            <input
              value={draft.uom}
              onChange={(e) => patch({ uom: e.target.value })}
              placeholder="Enter custom unit"
              className={`${fieldInput} mt-1`}
            />
          )}
        </div>
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label className="text-sm font-medium text-zinc-800">
            Purpose of Request
          </label>
          <input
            value={draft.purpose}
            onChange={(e) => patch({ purpose: e.target.value })}
            placeholder="e.g., Formwork for column casting"
            className={fieldInput}
          />
        </div>
        {showFulfilled && (
          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-zinc-800">
              Quantity Fulfilled
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={draft.quantityFulfilled}
              onChange={(e) => patch({ quantityFulfilled: e.target.value })}
              className={fieldInput}
            />
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

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
          onClick={() => {
            if (!draft.materialName.trim()) {
              setError("Material Name is required.");
              return;
            }
            onSave(draft);
          }}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800"
        >
          Add Item
        </button>
      </div>
    </div>
  );
}

export function MaterialRequestEditForm({
  open,
  onClose,
  projectId,
  request,
  currentUserName,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  projectId: number;
  /** Omitted for the "Request Material" create flow; passed for Edit. */
  request?: MaterialRequestDetail;
  /** The signed-in user's display name — shown as Requested By when
   * creating (an existing request already has its own requestedByName,
   * so Edit callers don't need to pass this). */
  currentUserName?: string;
  onSuccess?: () => void;
}) {
  const boundAction = request
    ? updateMaterialRequest.bind(null, request.id, projectId)
    : createMaterialRequest.bind(null, projectId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);

  // The first item is always right there on the main screen as a normal
  // editable form — a request needs at least one, so it starts pre-
  // populated rather than behind an empty "no items yet" state or an
  // extra step. The "+ Add Item" pop-up (see ItemForm) is only for
  // additional items beyond this one.
  const [items, setItems] = useState<EditableItem[]>(() =>
    request ? toEditable(request) : [{ ...blankItem }]
  );
  const [dateRequired, setDateRequired] = useState(request?.dateRequired ?? "");
  const [priority, setPriority] = useState<MaterialRequestPriority>(
    request?.priority ?? "routine"
  );
  const [remarks, setRemarks] = useState(request?.remarks ?? "");
  const [addingItem, setAddingItem] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  // Which inline item rows currently have "Other (specify)" picked in
  // their UOM dropdown with nothing typed yet — a plain `item.uom ===
  // ""` can't distinguish that from "no unit chosen at all", so that one
  // transient state needs tracking separately from the item data itself.
  const [customUnitIndices, setCustomUnitIndices] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function updateItem(index: number, patch: Partial<EditableItem>) {
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, ...patch } : item))
    );
  }

  function removeItem(index: number) {
    setItems((prev) => prev.filter((_, i) => i !== index));
    setCustomUnitIndices((prev) => {
      const next = new Set<number>();
      for (const i of prev) {
        if (i < index) next.add(i);
        else if (i > index) next.add(i - 1);
      }
      return next;
    });
  }

  function addItem(item: EditableItem) {
    setItems((prev) => [...prev, item]);
    setAddingItem(false);
    setListError(null);
  }

  const itemsJson = JSON.stringify(
    items.map((item) => ({
      id: item.id,
      materialName: item.materialName,
      specification: item.specification,
      quantityNeeded: Number(item.quantityNeeded) || 0,
      uom: item.uom,
      purpose: item.purpose,
      quantityFulfilled: Number(item.quantityFulfilled) || 0,
    }))
  );

  const selectedPriority = PRIORITY_OPTIONS.find((opt) => opt.value === priority);

  return (
    <Modal
      open={open}
      onClose={() => {
        setAddingItem(false);
        onClose();
      }}
      onBack={addingItem ? () => setAddingItem(false) : undefined}
      title={
        addingItem
          ? "Add Item Request"
          : request
            ? "Edit Material Request"
            : "Request Material"
      }
    >
      {addingItem ? (
        <ItemForm
          showFulfilled={Boolean(request)}
          initial={blankItem}
          onCancel={() => setAddingItem(false)}
          onSave={addItem}
        />
      ) : (
        <form
          action={formAction}
          className="flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            if (items.length === 0) {
              e.preventDefault();
              setListError("Add at least one material item to the request.");
            }
          }}
        >
          <input type="hidden" name="items" value={itemsJson} readOnly />

          {/* Requisition header — Requested By (and, once the record
              exists, MR No./Date Requested) reads as a fixed record, same
              as a paper requisition's letterhead fields; Date Required/
              Priority are the only fields anyone fills in here. */}
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 sm:grid-cols-3">
            {request && (
              <>
                <div>
                  <p className={fieldLabel}>MR No.</p>
                  <p className="mt-1 text-sm font-medium text-zinc-700">
                    {request.mrNo}
                  </p>
                </div>
                <div>
                  <p className={fieldLabel}>Date Requested</p>
                  <p className="mt-1 text-sm font-medium text-zinc-700">
                    {formatDate(request.requestDate)}
                  </p>
                </div>
              </>
            )}
            <div>
              <p className={fieldLabel}>Requested By</p>
              <p className="mt-1 text-sm font-medium text-zinc-700">
                {request?.requestedByName ?? currentUserName ?? "You"}
              </p>
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mrf-dateRequired" className={fieldLabel}>
                Date Required
              </label>
              <input
                id="mrf-dateRequired"
                type="date"
                name="dateRequired"
                value={dateRequired}
                onChange={(e) => setDateRequired(e.target.value)}
                className={`${fieldInput} bg-white px-2.5 py-1.5`}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="mrf-priority" className={fieldLabel}>
                Priority
              </label>
              <select
                id="mrf-priority"
                name="priority"
                value={priority}
                onChange={(e) =>
                  setPriority(e.target.value as MaterialRequestPriority)
                }
                className={`${fieldInput} cursor-pointer bg-white px-2.5 py-1.5`}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            {selectedPriority && (
              <p className="col-span-2 -mt-2 text-xs text-zinc-400 sm:col-span-3">
                {selectedPriority.hint}
              </p>
            )}
          </div>

          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-zinc-900">
              Requested Material Items
            </h3>
            <button
              type="button"
              onClick={() => setAddingItem(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-2.5 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50"
            >
              <Plus className="size-3.5" />
              Add Item
            </button>
          </div>

          <div className="flex flex-col gap-3">
            {items.map((item, index) => (
              <div
                key={index}
                className="rounded-lg border border-zinc-200 bg-white p-3"
              >
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div className="col-span-2 flex flex-col gap-1">
                    <label className={fieldLabel}>Material Name</label>
                    <input
                      value={item.materialName}
                      onChange={(e) =>
                        updateItem(index, { materialName: e.target.value })
                      }
                      placeholder="e.g., Plywood"
                      className={fieldInput}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>Qty Needed</label>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantityNeeded}
                      onChange={(e) =>
                        updateItem(index, { quantityNeeded: e.target.value })
                      }
                      className={fieldInput}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className={fieldLabel}>UOM</label>
                    {(() => {
                      const isCustom =
                        customUnitIndices.has(index) ||
                        (!!item.uom &&
                          !(UNIT_OPTIONS as readonly string[]).includes(item.uom));
                      return (
                        <>
                          <select
                            value={isCustom ? OTHER_UNIT : item.uom}
                            onChange={(e) => {
                              const value = e.target.value;
                              if (value === OTHER_UNIT) {
                                setCustomUnitIndices((prev) =>
                                  new Set(prev).add(index)
                                );
                                updateItem(index, { uom: "" });
                              } else {
                                setCustomUnitIndices((prev) => {
                                  const next = new Set(prev);
                                  next.delete(index);
                                  return next;
                                });
                                updateItem(index, { uom: value });
                              }
                            }}
                            className={`${fieldInput} cursor-pointer bg-white`}
                          >
                            <option value="">Select unit</option>
                            {UNIT_OPTIONS.map((unit) => (
                              <option key={unit} value={unit}>
                                {unit}
                              </option>
                            ))}
                            <option value={OTHER_UNIT}>Other (specify)</option>
                          </select>
                          {isCustom && (
                            <input
                              value={item.uom}
                              onChange={(e) =>
                                updateItem(index, { uom: e.target.value })
                              }
                              placeholder="Enter custom unit"
                              className={`${fieldInput} mt-1`}
                            />
                          )}
                        </>
                      );
                    })()}
                  </div>

                  <div className="col-span-2 flex flex-col gap-1">
                    <label className={fieldLabel}>Specification / Size</label>
                    <input
                      value={item.specification}
                      onChange={(e) =>
                        updateItem(index, { specification: e.target.value })
                      }
                      placeholder="e.g., 3/8 in. x 4 ft x 8ft"
                      className={fieldInput}
                    />
                  </div>
                  <div
                    className={`col-span-2 flex flex-col gap-1 ${request ? "sm:col-span-1" : ""}`}
                  >
                    <label className={fieldLabel}>Purpose of Request</label>
                    <input
                      value={item.purpose}
                      onChange={(e) =>
                        updateItem(index, { purpose: e.target.value })
                      }
                      placeholder="e.g., Formwork for column casting"
                      className={fieldInput}
                    />
                  </div>
                  {request && (
                    <div className="flex flex-col gap-1">
                      <label className={fieldLabel}>Qty Fulfilled</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.quantityFulfilled}
                        onChange={(e) =>
                          updateItem(index, { quantityFulfilled: e.target.value })
                        }
                        className={fieldInput}
                      />
                    </div>
                  )}
                </div>

                {items.length > 1 && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      className="flex cursor-pointer items-center gap-1 text-xs font-medium text-zinc-400 transition hover:text-red-600"
                    >
                      <Trash2 className="size-3.5" />
                      Remove item
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {listError && <p className="text-sm text-red-600">{listError}</p>}

          <div className="flex flex-col gap-1.5">
            <label
              htmlFor="mrf-remarks"
              className="text-sm font-medium text-zinc-800"
            >
              Remarks{" "}
              <span className="font-normal text-zinc-400">(optional)</span>
            </label>
            <textarea
              id="mrf-remarks"
              name="remarks"
              rows={2}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Overall justification or context for this request — e.g. “needed before Monday's pour”"
              className={fieldInput}
            />
          </div>

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
              {pending ? "Saving..." : request ? "Save" : "Submit Request"}
            </button>
          </div>

          {state?.error && (
            <p role="alert" className="text-sm text-red-600">
              {state.error}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
