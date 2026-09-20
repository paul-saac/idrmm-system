"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import { LogoutButton } from "@/components/auth/logout-button";
import { MaterialRequestEditForm } from "@/components/projects/materials/material-request-edit-form";
import {
  approveMaterialRequest,
  cancelMaterialRequest,
  type MaterialRequestActionState,
} from "@/lib/material-requests/actions";
import type {
  MaterialRequestDetail,
  MaterialRequestItemFulfilment,
  MaterialRequestPriority,
  MaterialRequestStatus,
} from "@/lib/material-requests/data";

// Where the back chevron returns to — the Materials tab's Material
// Requests sub-tab specifically, not just the project root.
function materialRequestsListHref(projectId: number) {
  return `/admin/projects/${projectId}?tab=materials&subtab=requests`;
}

function StatusBadge({ status }: { status: MaterialRequestStatus }) {
  const styles: Record<MaterialRequestStatus, string> = {
    submitted: "bg-zinc-100 text-zinc-600",
    approved: "bg-sky-50 text-sky-700",
    partially_fulfilled: "bg-amber-50 text-amber-700",
    fulfilled: "bg-emerald-50 text-emerald-700",
    canceled: "bg-red-50 text-red-600",
  };
  const labels: Record<MaterialRequestStatus, string> = {
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

function PriorityBadge({ priority }: { priority: MaterialRequestPriority }) {
  const styles: Record<MaterialRequestPriority, string> = {
    routine: "bg-zinc-100 text-zinc-600",
    urgent: "bg-amber-50 text-amber-700",
    emergency: "bg-red-50 text-red-700",
  };
  const labels: Record<MaterialRequestPriority, string> = {
    routine: "Routine",
    urgent: "Urgent",
    emergency: "Emergency",
  };
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${styles[priority]}`}>
      {labels[priority]}
    </span>
  );
}

function FulfilmentBadge({ fulfilment }: { fulfilment: MaterialRequestItemFulfilment }) {
  const styles: Record<MaterialRequestItemFulfilment, string> = {
    not_fulfilled: "bg-zinc-100 text-zinc-500",
    partially_fulfilled: "bg-amber-50 text-amber-700",
    fulfilled: "bg-emerald-50 text-emerald-700",
  };
  const labels: Record<MaterialRequestItemFulfilment, string> = {
    not_fulfilled: "Not Fulfilled",
    partially_fulfilled: "Partially Fulfilled",
    fulfilled: "Fulfilled",
  };
  return (
    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${styles[fulfilment]}`}>
      {labels[fulfilment]}
    </span>
  );
}

function formatDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-US", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

const actionInitialState: MaterialRequestActionState = {};

function ApproveButton({ requestId, projectId }: { requestId: number; projectId: number }) {
  const boundAction = approveMaterialRequest.bind(null, requestId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, actionInitialState);
  return (
    <span className="relative inline-flex">
      <form action={formAction}>
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Approve
        </button>
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
  const boundAction = cancelMaterialRequest.bind(null, requestId, projectId);
  const [state, formAction, pending] = useActionState(boundAction, actionInitialState);
  return (
    <span className="relative inline-flex">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (!window.confirm("Cancel this material request?")) {
            e.preventDefault();
          }
        }}
      >
        <button
          type="submit"
          disabled={pending}
          className="cursor-pointer rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Cancel
        </button>
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

export function MaterialRequestDetailView({
  request,
}: {
  request: MaterialRequestDetail;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const isTerminal = request.status === "fulfilled" || request.status === "canceled";
  const projectId = request.projectId;

  return (
    <>
      <header className="flex items-center justify-between border-b border-zinc-200 bg-white px-8 py-5">
        <nav className="flex items-center gap-1.5 text-sm">
          <Link
            href="/admin/projects"
            className="text-zinc-500 transition hover:text-zinc-900"
          >
            Projects
          </Link>
          <span className="text-zinc-300">/</span>
          <Link
            href={materialRequestsListHref(projectId)}
            className="text-zinc-500 transition hover:text-zinc-900"
          >
            Materials
          </Link>
          <span className="text-zinc-300">/</span>
          <Link
            href={materialRequestsListHref(projectId)}
            className="text-zinc-500 transition hover:text-zinc-900"
          >
            Material Requests
          </Link>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">{request.mrNo}</span>
        </nav>
        <LogoutButton />
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <Link
                href={materialRequestsListHref(projectId)}
                className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 transition hover:text-zinc-600"
              >
                <ChevronLeft className="size-4" />
                {request.mrNo}
                <StatusBadge status={request.status} />
                <PriorityBadge priority={request.priority} />
              </Link>
              <div className="flex items-center gap-2">
                {request.status === "submitted" && (
                  <ApproveButton requestId={request.id} projectId={projectId} />
                )}
                {!isTerminal && (
                  <CancelButton requestId={request.id} projectId={projectId} />
                )}
                <button
                  type="button"
                  onClick={() => setEditOpen(true)}
                  className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-500 transition hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900"
                >
                  <EditIcon className="size-3.5" />
                  Edit
                </button>
              </div>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-xs font-medium text-zinc-400">Date Requested</p>
                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {formatDateTime(request.requestDate)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Date Required</p>
                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {formatDate(request.dateRequired)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Requested By</p>
                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {request.requestedByName}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-400">Approved By</p>
                <p className="mt-1 text-sm font-medium text-zinc-900">
                  {request.approvedByName ?? "—"}
                </p>
              </div>
            </div>

            {request.remarks && (
              <div className="mt-4 border-t border-zinc-100 pt-4">
                <p className="text-xs font-medium text-zinc-400">Remarks</p>
                <p className="mt-1 text-sm text-zinc-700">{request.remarks}</p>
              </div>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="border-b border-zinc-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-zinc-900">
                Requested Material Items
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5">Material Name</th>
                    <th className="px-4 py-2.5">Specification</th>
                    <th className="px-4 py-2.5">Quantity</th>
                    <th className="px-4 py-2.5">UOM</th>
                    <th className="px-4 py-2.5">Purpose of Request</th>
                    <th className="px-4 py-2.5">Quantity Remaining</th>
                    <th className="px-4 py-2.5">Fulfilment</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {request.items.map((item) => (
                    <tr key={item.id} className="transition-colors hover:bg-zinc-50">
                      <td className="px-4 py-2.5 font-medium text-zinc-900">
                        {item.materialName}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {item.specification || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {String(item.quantityNeeded).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">{item.uom || "—"}</td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {item.purpose || "—"}
                      </td>
                      <td className="px-4 py-2.5 text-zinc-600">
                        {String(item.quantityRemaining).padStart(2, "0")}
                      </td>
                      <td className="px-4 py-2.5">
                        <FulfilmentBadge fulfilment={item.fulfilment} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <MaterialRequestEditForm
        key={request.id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        projectId={projectId}
        request={request}
        onSuccess={() => setEditOpen(false)}
      />
    </>
  );
}
