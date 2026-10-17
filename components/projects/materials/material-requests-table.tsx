"use client";

import { Fragment } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { InitialsAvatar } from "@/components/ui/list-table";
import { MaterialRequestDetails } from "@/components/projects/materials/material-request-detail-view";
import type {
  MaterialRequestDetail,
  MaterialRequestPriority,
  MaterialRequestStatus,
} from "@/lib/material-requests/data";

// Where a request stands — its badge's label and colors.
export const REQUEST_STATUSES: {
  status: MaterialRequestStatus;
  label: string;
  style: string;
}[] = [
  { status: "submitted", label: "Submitted", style: "bg-zinc-100 text-zinc-600" },
  { status: "approved", label: "Approved", style: "bg-sky-50 text-sky-700" },
  {
    status: "partially_fulfilled",
    label: "Partially Fulfilled",
    style: "bg-amber-50 text-amber-700",
  },
  { status: "fulfilled", label: "Fulfilled", style: "bg-emerald-50 text-emerald-700" },
  { status: "canceled", label: "Canceled", style: "bg-red-50 text-red-600" },
];

const PRIORITIES: Record<MaterialRequestPriority, { label: string; style: string }> = {
  routine: { label: "Routine", style: "text-zinc-700" },
  urgent: { label: "Urgent", style: "font-medium text-amber-700" },
  emergency: { label: "Emergency", style: "font-medium text-red-600" },
};

/** "Oct 16, 2026" — from a date ("2026-10-16") or a timestamp. */
function formatDate(value: string) {
  const date = value.length === 10 ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** How a row opens its request: right under itself — which ones are open
 * being the caller's, so they stay open across its own changes — or
 * somewhere else entirely (onOpen). */
type RowOpening =
  | { openIds: ReadonlySet<number>; onToggle: (requestId: number) => void; onOpen?: undefined }
  | { onOpen: (requestId: number) => void; openIds?: undefined; onToggle?: undefined };

/**
 * Material requests as a table — each one's MR number and date, who
 * asked, how urgently, and where it stands. In the Material record's
 * Material requests view, every row opens right under itself to the
 * request in full (MaterialRequestDetails), the way its materials open to
 * their task breakdown; in the Material overview's panel, a row points
 * off to that instead (onOpen), the request already open there. Listed
 * as given.
 */
export function MaterialRequestsTable({
  requests,
  openIds,
  onToggle,
  onOpen,
  topBorder = true,
}: {
  requests: MaterialRequestDetail[];
  /** A line along the header's top — left off right under a toolbar that
   * already draws one, so the two don't double up. */
  topBorder?: boolean;
} & RowOpening) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead
          className={`${topBorder ? "border-y" : "border-b"} border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500`}
        >
          <tr>
            <th className="px-5 py-2.5">Request / Date</th>
            <th className="px-5 py-2.5">Requested by</th>
            <th className="px-5 py-2.5">Priority</th>
            <th className="px-5 py-2.5">Status</th>
            <th className="w-14 py-2.5 pr-5">
              <span className="sr-only">Open</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {requests.map((request) => {
            const status = REQUEST_STATUSES.find((s) => s.status === request.status);
            const priority = PRIORITIES[request.priority];
            const open = openIds?.has(request.id) ?? false;
            return (
              <Fragment key={request.id}>
                {/* scroll-mt clears the sticky tabs bar when a link to the
                    request scrolls here (see ProjectDetailView). Opened,
                    it stays white (no hover gray either), with no line
                    between it and its dropdown — a line along its top
                    instead, setting each opened one apart from what's
                    above it. On its cells: where rows meet, a cell's line
                    is drawn over the row above's own. */}
                <tr
                  data-request-id={request.id}
                  onClick={() => (onOpen ? onOpen(request.id) : onToggle?.(request.id))}
                  aria-expanded={onOpen ? undefined : open}
                  className={`scroll-mt-16 cursor-pointer transition-colors ${
                    open ? "border-b-0 [&>td]:border-t [&>td]:border-zinc-200" : "hover:bg-zinc-50"
                  }`}
                >
                  <td className="px-5 py-3">
                    <p className="font-semibold text-zinc-900">{request.mrNo}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{formatDate(request.requestDate)}</p>
                  </td>
                  <td className="px-5 py-3">
                    <span className="flex items-center gap-2">
                      <InitialsAvatar name={request.requestedByName} />
                      <span className="truncate text-zinc-900">{request.requestedByName}</span>
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={priority.style}>{priority.label}</span>
                  </td>
                  <td className="px-5 py-3">
                    {status && (
                      <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${status.style}`}>
                        {status.label}
                      </span>
                    )}
                  </td>
                  {/* The row's arrow, at its right end — down, opening it
                      right here; right, pointing off to it (onOpen). */}
                  <td className="py-3 pr-5">
                    <span
                      aria-hidden
                      className={`ml-auto flex size-7 items-center justify-center rounded transition ${
                        open ? "text-[var(--material-dropdown-accent)]" : "text-zinc-400"
                      }`}
                    >
                      {onOpen ? (
                        <ChevronRight className="size-4" />
                      ) : (
                        <ChevronDown
                          className={`size-4 transition-transform ${open ? "rotate-180" : ""}`}
                        />
                      )}
                    </span>
                  </td>
                </tr>

                {/* The request in full, in the Material record dropdown's
                    own tint, so it reads apart from the rows. */}
                {open && (
                  <tr className="bg-[var(--material-dropdown)]">
                    <td colSpan={5} className="px-5 pb-4">
                      <MaterialRequestDetails request={request} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
