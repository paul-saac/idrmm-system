"use client";

import { ProjectWriteButton } from "@/components/projects/project-access-context";
import { useActionState, useState, type ReactNode } from "react";
import { PackageCheck } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { usePortal } from "@/components/portal/portal-context";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { EquipmentRequestEditForm } from "@/components/projects/equipment/equipment-request-edit-form";
import {
  approveEquipmentRequest,
  cancelEquipmentRequest,
  recordEquipmentRequestDelivery,
  type EquipmentRequestActionState,
} from "@/lib/equipment-requests/actions";
import type {
  EquipmentRequestDetail,
  EquipmentRequestItemFulfilment,
} from "@/lib/equipment-requests/data";

// An item's own fulfilment — the request status badges' colors.
const FULFILMENT: Record<EquipmentRequestItemFulfilment, { label: string; style: string }> = {
  not_fulfilled: { label: "Not Fulfilled", style: "bg-zinc-100 text-zinc-500" },
  partially_fulfilled: { label: "Partially Fulfilled", style: "bg-amber-50 text-amber-700" },
  fulfilled: { label: "Fulfilled", style: "bg-emerald-50 text-emerald-700" },
};

// An opened request's items: the equipment, what it's for, then its figures.
const ITEM_COLUMNS =
  "grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_7rem_7rem_7rem_9rem] items-center gap-3 px-4";

/** "Oct 31, 2026" — from a day (YYYY-MM-DD). */
function formatDay(day: string | null) {
  if (!day) return "—";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** "2 units" — a quantity and its unit. */
function formatQuantity(value: number, uom: string | null) {
  return `${value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}${uom ? ` ${uom}` : ""}`;
}

/** A quantity — the number bold, its unit after it in gray, as the
 * Material record's own. */
function Quantity({ value, unit }: { value: number; unit: string | null }) {
  return (
    <span className="whitespace-nowrap tabular-nums">
      <span className="font-semibold text-zinc-900">
        {value.toLocaleString("en-PH", { maximumFractionDigits: 2 })}
      </span>
      {unit && <span className="text-zinc-400"> {unit}</span>}
    </span>
  );
}

const Dash = () => <span className="text-zinc-300">—</span>;

/** One of the request's facts — its label over its value. */
function Fact({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs font-medium text-zinc-400">{label}</dt>
      <dd className="mt-1 text-sm font-medium text-zinc-900">{children}</dd>
    </div>
  );
}

/**
 * Fulfilling it: how much of each item still owed arrived — each starting
 * at what's left of it. Saved as what's been received (never past what
 * was asked for), the request's status following it.
 */
function FulfillForm({
  request,
  onDone,
}: {
  request: EquipmentRequestDetail;
  onDone: () => void;
}) {
  const owed = request.items.filter((item) => item.quantityRemaining > 0);
  const [received, setReceived] = useState<Record<number, string>>(() =>
    Object.fromEntries(owed.map((item) => [item.id, String(item.quantityRemaining)]))
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setError(null);
    const deliveries = owed.map((item) => ({
      itemId: item.id,
      quantity: received[item.id]?.trim() ? Number(received[item.id]) : 0,
    }));
    if (deliveries.some((delivery) => !Number.isFinite(delivery.quantity) || delivery.quantity < 0)) {
      setError("Received quantities must be 0 or more.");
      return;
    }
    setPending(true);
    // Its revalidation refreshes the page with the delivery in it.
    const result = await recordEquipmentRequestDelivery(request.id, request.projectId, deliveries);
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    onDone();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-md border border-zinc-200">
        <div className="grid grid-cols-[minmax(0,1fr)_7rem_9rem] items-center gap-3 border-b border-zinc-200 bg-zinc-50 px-4 py-2 text-xs font-medium text-zinc-500">
          <span>Equipment</span>
          <span>Left</span>
          <span>Received</span>
        </div>
        <ul className="divide-y divide-zinc-100">
          {owed.map((item) => (
            <li
              key={item.id}
              className="grid grid-cols-[minmax(0,1fr)_7rem_9rem] items-center gap-3 px-4 py-2.5 text-sm"
            >
              <span className="min-w-0">
                <label
                  htmlFor={`equipment-delivery-${item.id}`}
                  className="block truncate font-medium text-zinc-900"
                >
                  {item.equipmentName}
                </label>
                {item.specification && (
                  <span className="block truncate text-xs text-zinc-400">{item.specification}</span>
                )}
              </span>
              <span className="text-zinc-600 tabular-nums">
                {formatQuantity(item.quantityRemaining, item.uom)}
              </span>
              <span className="flex items-center rounded-md border border-zinc-200 bg-white focus-within:border-zinc-400 focus-within:ring-2 focus-within:ring-zinc-200">
                <input
                  id={`equipment-delivery-${item.id}`}
                  type="text"
                  inputMode="decimal"
                  value={received[item.id] ?? ""}
                  onChange={(e) =>
                    setReceived((prev) => ({ ...prev, [item.id]: e.target.value }))
                  }
                  placeholder="0"
                  className="w-full min-w-0 bg-transparent py-1.5 pl-2.5 text-sm text-zinc-700 tabular-nums outline-none"
                />
                {item.uom && <span className="shrink-0 pr-2.5 pl-1 text-xs text-zinc-400">{item.uom}</span>}
              </span>
            </li>
          ))}
        </ul>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <ModalFooter>
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? "Saving..." : "Fulfill"}
        </button>
      </ModalFooter>
    </div>
  );
}

const actionInitialState: EquipmentRequestActionState = {};

function ApproveButton({ requestId, projectId }: { requestId: number; projectId: number }) {
  const boundAction = approveEquipmentRequest.bind(null, requestId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, actionInitialState);
  return (
    <span className="relative inline-flex">
      <form action={formAction}>
        <ProjectWriteButton
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Approve
        </ProjectWriteButton>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

function CancelButton({ requestId, projectId }: { requestId: number; projectId: number }) {
  const boundAction = cancelEquipmentRequest.bind(null, requestId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, actionInitialState);
  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm("Cancel this equipment request?")) {
            e.preventDefault();
          }
        }}
      >
        <ProjectWriteButton
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel request
        </ProjectWriteButton>
      </form>
      {state?.error && (
        <span
          role="alert"
          className="absolute top-full right-0 z-10 mt-1 w-48 rounded-md border border-red-200 bg-white px-2 py-1 text-right text-xs font-normal text-red-600 shadow-sm"
        >
          {state.error}
        </span>
      )}
    </span>
  );
}

/**
 * An equipment request in full, opened in its row of a request table
 * (EquipmentRequestsTable) rather than on a page of its own: when it's
 * needed, who approved it and its remarks, then every item — requested,
 * received, what's left — and what can be done with it next: approving
 * it, fulfilling it, canceling or editing it.
 */
export function EquipmentRequestDetails({ request }: { request: EquipmentRequestDetail }) {
  const { isAdmin } = usePortal();
  const [editOpen, setEditOpen] = useState(false);
  // Counted up each time Edit opens, so its form starts from the request
  // as it is now — it reads the items in only once, and saving writes
  // their received amounts back, so a fulfillment since would otherwise
  // be undone by the next edit.
  const [editSession, setEditSession] = useState(0);
  const [fulfillOpen, setFulfillOpen] = useState(false);
  const isTerminal = request.status === "fulfilled" || request.status === "canceled";
  // Deliveries come in once it's approved, until all of it has.
  const canFulfill = request.status === "approved" || request.status === "partially_fulfilled";
  const projectId = request.projectId;
  const itemCount = request.items.length;

  return (
    <div className="flex flex-col gap-4 border-l-2 border-[var(--material-dropdown-line)] pt-4 pl-4">
      {/* Its facts on the left; what can be done with it on the right. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <dl className="flex min-w-0 flex-wrap gap-x-10 gap-y-3">
          <Fact label="Date required">{formatDay(request.dateRequired)}</Fact>
          {request.approvedByName && <Fact label="Approved by">{request.approvedByName}</Fact>}
          {request.remarks && (
            <Fact label="Remarks" className="max-w-md">
              <span className="font-normal text-zinc-700">{request.remarks}</span>
            </Fact>
          )}
        </dl>
        <div className="flex shrink-0 items-center gap-2">
          {isAdmin && request.status === "submitted" && (
            <ApproveButton requestId={request.id} projectId={projectId} />
          )}
          {canFulfill && (
            <button
              type="button"
              onClick={() => setFulfillOpen(true)}
              className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              <PackageCheck className="size-4" />
              Fulfill
            </button>
          )}
          {!isTerminal && <CancelButton requestId={request.id} projectId={projectId} />}
          <ProjectWriteButton
            type="button"
            onClick={() => {
              setEditSession((session) => session + 1);
              setEditOpen(true);
            }}
            className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
          >
            <EditIcon className="size-3.5" />
            Edit
          </ProjectWriteButton>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-[11px] font-semibold tracking-wider text-[var(--material-dropdown-accent)] uppercase">
          Requested items
          <span className="font-normal tracking-normal text-zinc-400 normal-case">
            {" "}
            · {itemCount} {itemCount === 1 ? "item" : "items"}
          </span>
        </p>
        <div className="overflow-x-auto rounded-md border border-zinc-200">
          <div className="min-w-[44rem]">
            <div
              className={`${ITEM_COLUMNS} border-b border-zinc-200 bg-[var(--material-dropdown-header)] py-2 text-xs font-medium text-zinc-600`}
            >
              <span>Equipment</span>
              <span>Purpose</span>
              <span className="text-center">Requested</span>
              <span className="text-center">Received</span>
              <span className="text-center">Remaining</span>
              <span>Fulfilment</span>
            </div>
            {request.items.map((item) => (
              <div
                key={item.id}
                className={`${ITEM_COLUMNS} border-b border-zinc-200/70 bg-[var(--material-dropdown-row)] py-2.5 last:border-b-0`}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium text-zinc-900" title={item.equipmentName}>
                    {item.equipmentName}
                  </span>
                  {item.specification && (
                    <span className="block truncate text-xs text-zinc-400" title={item.specification}>
                      {item.specification}
                    </span>
                  )}
                </span>
                <span className="truncate text-zinc-600" title={item.purpose ?? undefined}>
                  {item.purpose || <Dash />}
                </span>
                <span className="text-center">
                  <Quantity value={item.quantityNeeded} unit={item.uom} />
                </span>
                <span className="text-center">
                  {item.quantityFulfilled > 0 ? (
                    <Quantity value={item.quantityFulfilled} unit={item.uom} />
                  ) : (
                    <Dash />
                  )}
                </span>
                <span className="text-center">
                  {item.quantityRemaining > 0 ? (
                    <Quantity value={item.quantityRemaining} unit={item.uom} />
                  ) : (
                    <Dash />
                  )}
                </span>
                <span>
                  <span
                    className={`rounded-sm px-2 py-0.5 text-xs font-medium whitespace-nowrap ${FULFILMENT[item.fulfilment].style}`}
                  >
                    {FULFILMENT[item.fulfilment].label}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Modal
        open={fulfillOpen}
        onClose={() => setFulfillOpen(false)}
        title="Fulfill request"
        description={request.erNo}
        icon={<PackageCheck className="size-5" />}
      >
        <FulfillForm request={request} onDone={() => setFulfillOpen(false)} />
      </Modal>

      <EquipmentRequestEditForm
        key={`${request.id}-${editSession}`}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        projectId={projectId}
        request={request}
        onSuccess={() => setEditOpen(false)}
      />
    </div>
  );
}
