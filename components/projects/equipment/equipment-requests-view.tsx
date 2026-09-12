"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, ChevronRight, ChevronUp, Plus } from "lucide-react";
import { EquipmentRequestEditForm } from "@/components/projects/equipment/equipment-request-edit-form";
import type {
  EquipmentRequestListItem,
  EquipmentRequestStatus,
} from "@/lib/equipment-requests/data";

const STATUS_GROUPS: { status: EquipmentRequestStatus; label: string; defaultOpen: boolean }[] = [
  { status: "submitted", label: "Submitted", defaultOpen: true },
  { status: "approved", label: "Approved", defaultOpen: true },
  { status: "partially_fulfilled", label: "Partially Fulfilled", defaultOpen: true },
  { status: "fulfilled", label: "Fulfilled", defaultOpen: false },
  { status: "canceled", label: "Canceled", defaultOpen: false },
];

function StatusBadge({ status }: { status: EquipmentRequestStatus }) {
  const styles: Record<EquipmentRequestStatus, string> = {
    submitted: "bg-zinc-100 text-zinc-600",
    approved: "bg-sky-50 text-sky-700",
    partially_fulfilled: "bg-amber-50 text-amber-700",
    fulfilled: "bg-emerald-50 text-emerald-700",
    canceled: "bg-red-50 text-red-600",
  };
  const labels: Record<EquipmentRequestStatus, string> = {
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

// e.g. "08 April 2026, 11:30 am" — same convention as
// MaterialRequestsView's formatDateTime.
function formatDateTime(iso: string) {
  const date = new Date(iso);
  const datePart = date.toLocaleDateString("en-US", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const timePart = date
    .toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .toLowerCase();
  return `${datePart}, ${timePart}`;
}

export function EquipmentRequestsView({
  projectId,
  requests,
  currentUserName,
}: {
  projectId: number;
  requests: EquipmentRequestListItem[];
  currentUserName: string;
}) {
  const [collapsed, setCollapsed] = useState<Set<EquipmentRequestStatus>>(
    new Set(
      STATUS_GROUPS.filter((group) => !group.defaultOpen).map((g) => g.status)
    )
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const router = useRouter();

  const grouped = useMemo(() => {
    const map = new Map<EquipmentRequestStatus, EquipmentRequestListItem[]>();
    for (const group of STATUS_GROUPS) map.set(group.status, []);
    for (const request of requests) {
      map.get(request.status)?.push(request);
    }
    for (const rows of map.values()) {
      rows.sort((a, b) => {
        const cmp = a.requestDate.localeCompare(b.requestDate);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return map;
  }, [requests, sortDir]);

  function toggle(status: EquipmentRequestStatus) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          Request Equipment
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="border-b border-zinc-200 px-4 py-3">
        <h3 className="text-sm font-semibold text-zinc-900">Equipment Requests</h3>
      </div>

      {requests.length === 0 ? (
        <p className="py-10 text-center text-sm text-zinc-400">
          No equipment requests have been submitted for this project yet.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full table-fixed text-left text-sm">
            <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
              <tr>
                {/* table-fixed sizes every row's columns off this header
                    row alone, same reasoning as MaterialRequestsView. */}
                <th className="w-56 border-r border-zinc-200 px-4 py-2.5 whitespace-nowrap">
                  <button
                    type="button"
                    onClick={() =>
                      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"))
                    }
                    className="flex cursor-pointer items-center gap-1 transition-colors hover:text-zinc-900"
                  >
                    Request Date
                    <span className="flex flex-col -space-y-1">
                      <ChevronUp
                        className={`size-3 ${sortDir === "asc" ? "text-zinc-900" : "text-zinc-300"}`}
                      />
                      <ChevronDown
                        className={`size-3 ${sortDir === "desc" ? "text-zinc-900" : "text-zinc-300"}`}
                      />
                    </span>
                  </button>
                </th>
                <th className="w-32 border-r border-zinc-200 px-4 py-2.5">ER-No</th>
                <th className="border-r border-zinc-200 px-4 py-2.5">Requested By</th>
                <th className="w-44 border-r border-zinc-200 px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {STATUS_GROUPS.map((group) => {
                const rows = grouped.get(group.status) ?? [];
                const isOpen = !collapsed.has(group.status);
                return (
                  <Fragment key={group.status}>
                    <tr className="border-y border-zinc-100 border-l-2 border-l-zinc-900 bg-zinc-50/60">
                      <td colSpan={4} className="px-4 py-3.5">
                        <button
                          type="button"
                          onClick={() => toggle(group.status)}
                          className="flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-zinc-600 transition hover:text-zinc-900"
                        >
                          {isOpen ? (
                            <ChevronDown className="size-3.5" />
                          ) : (
                            <ChevronRight className="size-3.5" />
                          )}
                          {group.label}
                          <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-600">
                            {rows.length}
                          </span>
                        </button>
                      </td>
                    </tr>
                    {isOpen &&
                      rows.map((request) => {
                        const href = `/admin/projects/${projectId}/equipment/requests/${request.id}`;
                        return (
                          <tr
                            key={request.id}
                            role="link"
                            tabIndex={0}
                            onClick={() => router.push(href)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") router.push(href);
                            }}
                            className="cursor-pointer border-y border-zinc-100 transition-colors hover:bg-zinc-100"
                          >
                            <td className="whitespace-nowrap border-r border-zinc-100 px-4 py-2.5 text-zinc-500">
                              {formatDateTime(request.requestDate)}
                            </td>
                            <td className="border-r border-zinc-100 px-4 py-2.5 font-medium text-zinc-900">
                              {request.erNo}
                            </td>
                            <td className="truncate border-r border-zinc-100 px-4 py-2.5 text-zinc-600">
                              {request.requestedByName}
                            </td>
                            <td className="border-r border-zinc-100 px-4 py-2.5">
                              <StatusBadge status={request.status} />
                            </td>
                          </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>

      <EquipmentRequestEditForm
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        projectId={projectId}
        currentUserName={currentUserName}
        onSuccess={() => setRequestOpen(false)}
      />
    </div>
  );
}
