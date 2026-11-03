"use client";

import { equipmentRequestIssue } from "@/lib/equipment-requests/validation";
import { RequiredMark } from "@/components/ui/required-mark";
import { useActionState, useEffect, useId, useState, type ReactNode } from "react";
import {
  ArrowRight,
  ChevronDown,
  Lock,
  Package,
  PackagePlus,
  Plus,
  Trash2,
} from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import {
  createEquipmentRequest,
  updateEquipmentRequest,
  type EquipmentRequestActionState,
} from "@/lib/equipment-requests/actions";
import { OTHER_UNIT, UNIT_OPTIONS } from "@/lib/cost-estimate/units";
import type {
  EquipmentRequestDetail,
  EquipmentRequestPriority,
} from "@/lib/equipment-requests/data";

const initialState: EquipmentRequestActionState = {};

const PRIORITY_OPTIONS: { value: EquipmentRequestPriority; label: string }[] = [
  { value: "routine", label: "Routine" },
  { value: "urgent", label: "Urgent" },
  { value: "emergency", label: "Emergency" },
];

type EditableItem = {
  id: number | null;
  equipmentName: string;
  specification: string;
  quantityNeeded: string;
  uom: string;
  purpose: string;
  quantityFulfilled: string;
};

const blankItem: EditableItem = {
  id: null,
  equipmentName: "",
  specification: "",
  quantityNeeded: "",
  uom: "",
  purpose: "",
  quantityFulfilled: "0",
};

function toEditable(request: EquipmentRequestDetail): EditableItem[] {
  return request.items.map((item) => ({
    id: item.id,
    equipmentName: item.equipmentName,
    specification: item.specification ?? "",
    quantityNeeded: String(item.quantityNeeded),
    uom: item.uom ?? "",
    purpose: item.purpose ?? "",
    quantityFulfilled: String(item.quantityFulfilled),
  }));
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

const fieldInput =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

/** A select with its own chevron, inset from the right edge, in place
 * of the browser's arrow. */
function Select({ children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className="relative">
      <select {...props} className={`${fieldInput} cursor-pointer appearance-none pr-9`}>
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-500"
      />
    </div>
  );
}

/** A field's label over its input — a red asterisk when it's required,
 * a gray "(optional)" when it says so. */
function Field({
  htmlFor,
  label,
  required = false,
  optional = false,
  className = "",
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1.5 ${className}`}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-900">
        {label}
        {required && <RequiredMark />}
        {optional && <span className="ml-1 font-normal text-zinc-400">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

/** Equipment requests use the same inline item-card flow as material requests. */
export function EquipmentRequestEditForm({
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
  /** Omitted for the "Request Equipment" create flow; passed for Edit. */
  request?: EquipmentRequestDetail;
  /** The signed-in user's display name — shown as Requested By when
   * creating (an existing request already has its own requestedByName,
   * so Edit callers don't need to pass this). */
  currentUserName?: string;
  onSuccess?: () => void;
}) {
  const boundAction = request
    ? updateEquipmentRequest.bind(null, request.id, projectId)
    : createEquipmentRequest.bind(null, projectId);
  const [state, formAction, pending] = useActionState(boundAction, initialState);
  const formId = useId();

  // A request needs at least one item, so it starts with one, blank —
  // + Add item adds more below it.
  const [items, setItems] = useState<EditableItem[]>(() =>
    request ? toEditable(request) : [{ ...blankItem }]
  );
  const [dateRequired, setDateRequired] = useState(request?.dateRequired ?? "");
  const [priority, setPriority] = useState<EquipmentRequestPriority>(
    request?.priority ?? "routine"
  );
  const [remarks, setRemarks] = useState(request?.remarks ?? "");
  const [formError, setFormError] = useState<string | null>(null);
  // Which item cards currently have "Other (specify)" picked in their UOM
  // dropdown with nothing typed yet — a plain `item.uom === ""` can't
  // distinguish that from "no unit chosen at all", so that one transient
  // state needs tracking separately from the item data itself.
  const [customUnitIndices, setCustomUnitIndices] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (state.success) {
      onSuccess?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  function updateItem(index: number, patch: Partial<EditableItem>) {
    setFormError(null);
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
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

  const itemsJson = JSON.stringify(
    items.map((item) => ({
      id: item.id,
      equipmentName: item.equipmentName,
      specification: item.specification,
      quantityNeeded: Number(item.quantityNeeded) || 0,
      uom: item.uom,
      purpose: item.purpose,
      quantityFulfilled: Number(item.quantityFulfilled) || 0,
    }))
  );


  return (
    <Modal
      open={open}
      onClose={onClose}
      title={request ? "Edit equipment request" : "Request equipment"}
      description={
        request ? `${request.erNo} · requested ${formatDate(request.requestDate)}` : undefined
      }
      icon={<PackagePlus className="size-5" />}
    >
      <form
        id={formId}
        action={formAction}
        className="flex flex-col gap-6"
        noValidate
        onSubmit={(e) => {
          const issue = equipmentRequestIssue(dateRequired, items);
          setFormError(issue?.message ?? null);
          if (issue) {
            e.preventDefault();
            const id = issue.field === "dateRequired" ? `${formId}-dateRequired` : `${formId}-item-${issue.index}-${issue.field}`;
            document.getElementById(id)?.focus();
          }
        }}
      >
        <input type="hidden" name="items" value={itemsJson} readOnly />

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-base font-semibold text-zinc-900">Request details</h3>
            <span className="text-xs text-zinc-500">
              <RequiredMark /> Required
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Requested By">
              <div className="relative">
                <input
                  value={`${request?.requestedByName ?? currentUserName ?? "You"}${request ? "" : " (you)"}`}
                  readOnly
                  tabIndex={-1}
                  aria-readonly
                  className={`${fieldInput} cursor-default bg-zinc-50 pr-9 text-zinc-600 focus:border-zinc-200 focus:ring-0`}
                />
                <Lock
                  aria-hidden
                  className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400"
                />
              </div>
            </Field>
            <Field htmlFor={`${formId}-dateRequired`} label="Date Required" required>
              <DatePicker
                id={`${formId}-dateRequired`}
                name="dateRequired"
                ariaLabel="Date required"
                value={dateRequired}
                onChange={setDateRequired}
                className={fieldInput}
              />
            </Field>
            <Field htmlFor={`${formId}-priority`} label="Priority" required>
              <Select
                id={`${formId}-priority`}
                name="priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as EquipmentRequestPriority)}
              >
                {PRIORITY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
              Requested Equipment Items
              <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                {items.length} {items.length === 1 ? "item" : "items"}
              </span>
            </h3>
            <button
              type="button"
              onClick={() => {
                setItems((prev) => [...prev, { ...blankItem }]);
                setFormError(null);
              }}
              className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100"
            >
              <Plus className="size-4" />
              Add item
            </button>
          </div>

          {items.map((item, index) => {
            const isCustom =
              customUnitIndices.has(index) ||
              (!!item.uom && !(UNIT_OPTIONS as readonly string[]).includes(item.uom));
            const id = `${formId}-item-${index}`;
            return (
              <div key={index} className="overflow-hidden rounded-md border border-zinc-200 bg-white">
                <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
                  <Package aria-hidden className="size-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                    {item.equipmentName.trim() || `Item ${index + 1}`}
                  </span>
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      aria-label="Remove item"
                      title="Remove item"
                      className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>

                <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_7rem_9rem]">
                  <Field htmlFor={`${id}-name`} label="Equipment Name" required>
                    <input
                      id={`${id}-name`}
                      value={item.equipmentName}
                      onChange={(e) => updateItem(index, { equipmentName: e.target.value })}
                      placeholder="e.g., Concrete Mixer"
                      className={fieldInput}
                    />
                  </Field>
                  <Field htmlFor={`${id}-qty`} label="Qty Needed" required>
                    <input
                      id={`${id}-qty`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={item.quantityNeeded}
                      onChange={(e) => updateItem(index, { quantityNeeded: e.target.value })}
                      placeholder="0"
                      className={fieldInput}
                    />
                  </Field>
                  <Field htmlFor={`${id}-uom`} label="UOM" required>
                    <Select
                      id={`${id}-uom`}
                      value={isCustom ? OTHER_UNIT : item.uom}
                      onChange={(e) => {
                        const value = e.target.value;
                        if (value === OTHER_UNIT) {
                          setCustomUnitIndices((prev) => new Set(prev).add(index));
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
                    >
                      <option value="" hidden>Select unit</option>
                      {UNIT_OPTIONS.map((unit) => (
                        <option key={unit} value={unit}>
                          {unit}
                        </option>
                      ))}
                      <option value={OTHER_UNIT}>Other (specify)</option>
                    </Select>
                    {isCustom && (
                      <input
                        value={item.uom}
                        onChange={(e) => updateItem(index, { uom: e.target.value })}
                        placeholder="Enter custom unit"
                        aria-label="Custom unit"
                        className={fieldInput}
                      />
                    )}
                  </Field>

                  <div
                    className={`grid gap-4 sm:col-span-3 ${
                      request ? "sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_9rem]" : "sm:grid-cols-2"
                    }`}
                  >
                    <Field htmlFor={`${id}-spec`} label="Specification / Model">
                      <input
                        id={`${id}-spec`}
                        value={item.specification}
                        onChange={(e) => updateItem(index, { specification: e.target.value })}
                        placeholder="e.g., Model X120"
                        className={fieldInput}
                      />
                    </Field>
                    <Field htmlFor={`${id}-purpose`} label="Purpose of Request" required>
                      <input
                        id={`${id}-purpose`}
                        value={item.purpose}
                        onChange={(e) => updateItem(index, { purpose: e.target.value })}
                        placeholder="e.g., Slab pouring for Level 2"
                        className={fieldInput}
                      />
                    </Field>
                    {request && (
                      <Field htmlFor={`${id}-fulfilled`} label="Qty Fulfilled">
                        <input
                          id={`${id}-fulfilled`}
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.quantityFulfilled}
                          onChange={(e) =>
                            updateItem(index, { quantityFulfilled: e.target.value })
                          }
                          className={fieldInput}
                        />
                      </Field>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <Field htmlFor={`${formId}-remarks`} label="Remarks" optional>
          <textarea
            id={`${formId}-remarks`}
            name="remarks"
            rows={3}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="e.g., Please deliver before the morning concrete pour."
            className={fieldInput}
          />
        </Field>

        {(formError || state?.error) && (
          <p role="alert" className="text-sm text-red-600">
            {formError ?? state.error}
          </p>
        )}
      </form>

      {/* The modal's bottom bar: what happens on submit, then Cancel and
          Submit — outside the form, so Submit names it (form=). */}
      <ModalFooter>
        <div className="mr-auto min-w-0">
          {request ? (
            <p className="text-xs text-zinc-500">Changes apply to this request only.</p>
          ) : (
            <>
              <p className="text-xs font-medium text-zinc-700">Sent for review after submission</p>
              <p className="text-xs text-zinc-500">This request does not assign equipment.</p>
            </>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          form={formId}
          disabled={pending}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {!pending && !request && <ArrowRight className="size-4" />}
          {pending ? "Saving..." : request ? "Save" : "Submit Request"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
