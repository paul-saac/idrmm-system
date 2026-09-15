"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { LogoutButton } from "@/components/auth/logout-button";
import {
  AddDailyLogModal,
  type CategoryOption,
} from "@/components/projects/daily-logs/add-daily-log-modal";
import {
  deleteDailyLog,
  updateDailyLogStatus,
  type DailyLogActionState,
} from "@/lib/daily-logs/actions";
import { FlagControl, findFlag } from "@/components/projects/daily-logs/flag-control";
import { EditFlaggedEntryButton } from "@/components/projects/daily-logs/edit-flagged-entry-modal";
import {
  type DailyLogDetail,
  type DailyLogEquipmentAcquisitionDetail,
  type DailyLogExpenseItemDetail,
  type DailyLogLaborItemDetail,
  type DailyLogMaterialUsageItemDetail,
  type DailyLogProcurementDetail,
  type DailyLogStatus,
  type MaterialUsageStatus,
  type SurveyAnswer,
  type SurveyQuestion,
} from "@/lib/daily-logs/data";
import {
  flagState,
  entryDomId,
  type EntryFlag,
  type EntryType,
} from "@/lib/daily-logs/flag-state";
import type { ProjectMaterial } from "@/lib/materials/data";
import type { MaterialRequestDetail } from "@/lib/material-requests/data";
import type { EquipmentRequestDetail } from "@/lib/equipment-requests/data";

/** Threaded down into every entry-list section so each row can render
 * its own FlagControl — one shared shape rather than four near-
 * identical prop lists. */
type FlagSectionProps = {
  dailyLogId: number;
  projectId: number;
  logStatus: DailyLogStatus;
  flags: EntryFlag[];
};

/** Background highlight for the one row/block whose id matches the
 * entry this page was navigated to highlight (see entryDomId and
 * DailyLogDetailView's own scroll+highlight effect). transition-colors
 * stays on unconditionally so the highlight fades back out smoothly
 * once highlightedId clears a couple seconds after landing, rather than
 * disappearing abruptly. */
function highlightClass(id: string, highlightedId: string | null) {
  return `transition-colors duration-1000 ${id === highlightedId ? "bg-amber-50" : ""}`;
}

/** Whether a flagged entry can still be corrected in place — only while
 * its flag hasn't been resolved yet and the log is approved (a pending
 * log's entries just get edited normally through the Add Daily Log
 * modal instead). */
function canCorrectEntry(
  flag: EntryFlag | undefined,
  logStatus: DailyLogStatus
): flag is EntryFlag {
  return Boolean(flag) && logStatus === "approved" && flagState(flag!) !== "resolved";
}

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
}

// Where the back button (and the delete redirect) return to — the
// Daily Logs list specifically, not just the project root, which
// defaults to the Overview tab.
function dailyLogsListHref(projectId: number) {
  return `/admin/projects/${projectId}?tab=progress&subtab=daily-logs`;
}

const dailyLogActionInitialState: DailyLogActionState = {};

function formatDateLong(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function formatDateWithWeekday(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

function StatusBadge({
  status,
  unresolvedFlagCount = 0,
}: {
  status: DailyLogDetail["status"];
  /** An approved log can still have open flags on some of its entries
   * (see flagDailyLogEntry) — shown alongside the badge so "Approved"
   * never reads as "everything in this log is clean" when it isn't. */
  unresolvedFlagCount?: number;
}) {
  if (status === "approved") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          Approved
        </span>
        {unresolvedFlagCount > 0 && (
          <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {unresolvedFlagCount} flagged
          </span>
        )}
      </span>
    );
  }
  if (status === "rejected") {
    return (
      <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        Rejected
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      Submitted
    </span>
  );
}

function ReviewActions({
  dailyLogId,
  projectId,
  status,
}: {
  dailyLogId: number;
  projectId: number;
  status: DailyLogDetail["status"];
}) {
  const approveAction = updateDailyLogStatus.bind(
    null,
    dailyLogId,
    projectId,
    "approved"
  );
  const rejectAction = updateDailyLogStatus.bind(
    null,
    dailyLogId,
    projectId,
    "rejected"
  );
  const [approveState, approveFormAction, approvePending] = useActionState(
    approveAction,
    dailyLogActionInitialState
  );
  const [rejectState, rejectFormAction, rejectPending] = useActionState(
    rejectAction,
    dailyLogActionInitialState
  );

  if (status !== "pending") {
    return null;
  }

  return (
    <>
      <form action={approveFormAction}>
        <button
          type="submit"
          disabled={approvePending || rejectPending}
          className="cursor-pointer px-3 py-1.5 text-sm font-medium text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {approvePending ? "..." : "Approve"}
        </button>
      </form>
      <form action={rejectFormAction}>
        <button
          type="submit"
          disabled={approvePending || rejectPending}
          className="cursor-pointer px-3 py-1.5 text-sm font-medium text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {rejectPending ? "..." : "Reject"}
        </button>
      </form>
      {(approveState?.error || rejectState?.error) && (
        <p
          role="alert"
          className="absolute top-full left-0 mt-1 w-48 border-l-0 text-xs text-red-600"
        >
          {approveState?.error ?? rejectState?.error}
        </p>
      )}
    </>
  );
}

function DeleteButton({
  dailyLogId,
  projectId,
  logDateLabel,
}: {
  dailyLogId: number;
  projectId: number;
  logDateLabel: string;
}) {
  const boundAction = deleteDailyLog.bind(null, dailyLogId, projectId);
  const [state, formAction, pending] = useActionState(
    boundAction,
    dailyLogActionInitialState
  );

  return (
    <div className="relative">
      <form
        action={formAction}
        onSubmit={(e) => {
          if (
            !window.confirm(
              `Delete the daily log for ${logDateLabel}? This cannot be undone.`
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
          {pending ? "..." : "Delete"}
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

function LaborLogsSection({
  items,
  flagProps,
  highlightedId,
}: {
  items: DailyLogLaborItemDetail[];
  flagProps: FlagSectionProps;
  highlightedId: string | null;
}) {
  return (
    <div className="p-4">
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No labor logs recorded for this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-2 font-medium">Worker Role</th>
                <th className="px-2 py-2 font-medium">No. of Worker</th>
                <th className="px-2 py-2 font-medium">Daily Rate</th>
                <th className="px-2 py-2 font-medium">OT Hours</th>
                <th className="px-2 py-2 font-medium">Renders Overtime</th>
                <th className="px-2 py-2 font-medium">Renders Halfday</th>
                <th className="px-2 py-2 font-medium">Remarks</th>
                <th className="px-2 py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => {
                const flag = findFlag(flagProps.flags, "labor_item", item.id);
                const id = entryDomId("labor_item", item.id);
                return (
                  <tr key={item.id} id={id} className={highlightClass(id, highlightedId)}>
                    <td className="px-2 py-2.5 font-medium text-zinc-900">
                      {item.workerRole}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-700">{item.workerCount}</td>
                    <td className="px-2 py-2.5 text-zinc-700">
                      {formatCurrency(item.dailyRate)}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-700">{item.otHours}</td>
                    <td className="px-2 py-2.5 text-zinc-700">
                      {item.workersRenderedOvertime}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-700">
                      {item.workersRenderedHalfday}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-600">
                      {item.remarks || "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        <FlagControl
                          {...flagProps}
                          entryType="labor_item"
                          entryId={item.id}
                          flag={flag}
                        />
                        {canCorrectEntry(flag, flagProps.logStatus) && (
                          <EditFlaggedEntryButton
                            dailyLogId={flagProps.dailyLogId}
                            projectId={flagProps.projectId}
                            entryType="labor_item"
                            entry={item}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExpenseLogsSection({
  items,
  flagProps,
  highlightedId,
}: {
  items: DailyLogExpenseItemDetail[];
  flagProps: FlagSectionProps;
  highlightedId: string | null;
}) {
  return (
    <div className="p-4">
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No expenses recorded for this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-2 font-medium">Expense Category</th>
                <th className="px-2 py-2 font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Additional Fees</th>
                <th className="px-2 py-2 font-medium">Description</th>
                <th className="px-2 py-2 font-medium">Remarks</th>
                <th className="px-2 py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => {
                const flag = findFlag(flagProps.flags, "expense_item", item.id);
                const id = entryDomId("expense_item", item.id);
                return (
                  <tr key={item.id} id={id} className={highlightClass(id, highlightedId)}>
                    <td className="px-2 py-2.5 font-medium text-zinc-900">
                      {item.expenseCategory}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-700">
                      {formatCurrency(item.amount)}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-700">
                      {formatCurrency(item.additionalFees)}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-600">
                      {item.description || "—"}
                    </td>
                    <td className="px-2 py-2.5 text-zinc-600">
                      {item.remarks || "—"}
                    </td>
                    <td className="px-2 py-2.5">
                      <div className="flex items-center gap-1">
                        <FlagControl
                          {...flagProps}
                          entryType="expense_item"
                          entryId={item.id}
                          flag={flag}
                        />
                        {canCorrectEntry(flag, flagProps.logStatus) && (
                          <EditFlaggedEntryButton
                            dailyLogId={flagProps.dailyLogId}
                            projectId={flagProps.projectId}
                            entryType="expense_item"
                            entry={item}
                          />
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const PROCUREMENT_TYPE_LABELS: Record<string, string> = {
  direct_purchase: "Direct Purchase",
  supplier_delivery: "Supplier Delivery",
};

function ProcurementLogsSection({
  logs,
  flagProps,
  highlightedId,
}: {
  logs: DailyLogProcurementDetail[];
  flagProps: FlagSectionProps;
  highlightedId: string | null;
}) {
  return (
    <div className="p-4">
      {logs.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No material procurement recorded for this day.
        </p>
      ) : (
        <div className="flex flex-col divide-y divide-zinc-100">
          {logs.map((procurement) => {
            const flag = findFlag(
              flagProps.flags,
              "material_procurement",
              procurement.id
            );
            const id = entryDomId("material_procurement", procurement.id);
            return (
            <div
              key={procurement.id}
              id={id}
              className={`${logs.length > 1 ? "py-4 first:pt-0 last:pb-0" : ""} ${highlightClass(id, highlightedId)}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-zinc-900">
                    {procurement.supplierName ||
                      PROCUREMENT_TYPE_LABELS[procurement.procurementType]}
                  </span>
                  {procurement.materialRequestMrNo && (
                    <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                      Fulfilling {procurement.materialRequestMrNo}
                    </span>
                  )}
                  <FlagControl
                    {...flagProps}
                    entryType="material_procurement"
                    entryId={procurement.id}
                    flag={flag}
                  />
                  {canCorrectEntry(flag, flagProps.logStatus) && (
                    <EditFlaggedEntryButton
                      dailyLogId={flagProps.dailyLogId}
                      projectId={flagProps.projectId}
                      entryType="material_procurement"
                      entry={procurement}
                    />
                  )}
                </div>
                {procurement.additionalFees > 0 && (
                  <span className="text-xs text-zinc-500">
                    + {formatCurrency(procurement.additionalFees)} fees
                  </span>
                )}
              </div>
              {procurement.remarks && (
                <p className="mt-1 text-xs text-zinc-500">{procurement.remarks}</p>
              )}
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-zinc-500">
                    <tr>
                      <th className="px-2 py-2 font-medium">Material Name</th>
                      <th className="px-2 py-2 font-medium">Specification</th>
                      <th className="px-2 py-2 font-medium">Quantity</th>
                      <th className="px-2 py-2 font-medium">Unit</th>
                      <th className="px-2 py-2 font-medium">Cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {procurement.items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-2 py-2.5 font-medium text-zinc-900">
                          {item.materialName}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-600">
                          {item.specification || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-700">{item.quantity}</td>
                        <td className="px-2 py-2.5 text-zinc-600">
                          {item.unit || "—"}
                        </td>
                        <td className="px-2 py-2.5 text-zinc-700">
                          {formatCurrency(item.cost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

const ACQUISITION_TYPE_LABELS: Record<string, string> = {
  rental: "Rental",
  purchase: "Purchase",
};

function EquipmentAcquisitionLogsSection({
  logs,
  flagProps,
  highlightedId,
}: {
  logs: DailyLogEquipmentAcquisitionDetail[];
  flagProps: FlagSectionProps;
  highlightedId: string | null;
}) {
  return (
    <div className="p-4">
      {logs.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No equipment acquisition recorded for this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-2 font-medium">Equipment Name</th>
                <th className="px-2 py-2 font-medium">Specification</th>
                <th className="px-2 py-2 font-medium">Quantity</th>
                <th className="px-2 py-2 font-medium">Type</th>
                <th className="px-2 py-2 font-medium">Amount</th>
                <th className="px-2 py-2 font-medium">Equipment Request</th>
                <th className="px-2 py-2 font-medium">Remarks</th>
                <th className="px-2 py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {logs.map((item) => {
                const flag = findFlag(
                  flagProps.flags,
                  "equipment_acquisition",
                  item.id
                );
                const id = entryDomId("equipment_acquisition", item.id);
                return (
                <tr key={item.id} id={id} className={highlightClass(id, highlightedId)}>
                  <td className="px-2 py-2.5 font-medium text-zinc-900">
                    {item.equipmentName}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.specification || "—"}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-700">{item.quantity}</td>
                  <td className="px-2 py-2.5 text-zinc-700">
                    {ACQUISITION_TYPE_LABELS[item.acquisitionType]}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-700">
                    {formatCurrency(item.amount)}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.equipmentRequestErNo ? (
                      <span className="rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
                        Fulfilling {item.equipmentRequestErNo}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.remarks || "—"}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1">
                      <FlagControl
                        {...flagProps}
                        entryType="equipment_acquisition"
                        entryId={item.id}
                        flag={flag}
                      />
                      {canCorrectEntry(flag, flagProps.logStatus) && (
                        <EditFlaggedEntryButton
                          dailyLogId={flagProps.dailyLogId}
                          projectId={flagProps.projectId}
                          entryType="equipment_acquisition"
                          entry={item}
                        />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UsageStatusBadge({ status }: { status: MaterialUsageStatus }) {
  if (status === "available") {
    return (
      <span className="rounded-sm bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
        Available
      </span>
    );
  }
  if (status === "low_stock") {
    return (
      <span className="rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
        Low Stock
      </span>
    );
  }
  return (
    <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Fully Consumed
    </span>
  );
}

function MaterialUsageSection({
  items,
  flagProps,
  materials,
  highlightedId,
}: {
  items: DailyLogMaterialUsageItemDetail[];
  flagProps: FlagSectionProps;
  materials: ProjectMaterial[];
  highlightedId: string | null;
}) {
  return (
    <div className="p-4">
      {items.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No material usage recorded for this day.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="px-2 py-2 font-medium">Material ID</th>
                <th className="px-2 py-2 font-medium">Material Name</th>
                <th className="px-2 py-2 font-medium">Specification / Size</th>
                <th className="px-2 py-2 font-medium">Usage Status</th>
                <th className="px-2 py-2 font-medium">Activity</th>
                <th className="px-2 py-2 font-medium">Remarks</th>
                <th className="px-2 py-2 font-medium">Flag</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {items.map((item) => {
                const flag = findFlag(
                  flagProps.flags,
                  "material_usage_item",
                  item.id
                );
                const id = entryDomId("material_usage_item", item.id);
                return (
                <tr key={item.id} id={id} className={highlightClass(id, highlightedId)}>
                  <td className="px-2 py-2.5 font-medium text-zinc-900">
                    {item.materialCode}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-700">
                    {item.materialName}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.specification || "—"}
                  </td>
                  <td className="px-2 py-2.5">
                    <UsageStatusBadge status={item.status} />
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.activity || "—"}
                  </td>
                  <td className="px-2 py-2.5 text-zinc-600">
                    {item.remarks || "—"}
                  </td>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-1">
                      <FlagControl
                        {...flagProps}
                        entryType="material_usage_item"
                        entryId={item.id}
                        flag={flag}
                      />
                      {canCorrectEntry(flag, flagProps.logStatus) && (
                        <EditFlaggedEntryButton
                          dailyLogId={flagProps.dailyLogId}
                          projectId={flagProps.projectId}
                          entryType="material_usage_item"
                          entry={item}
                          materials={materials}
                        />
                      )}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function AttachmentGallery({
  title,
  items,
}: {
  title: string;
  items: { id: number; label: string; attachmentUrls: string[] }[];
}) {
  const withPhotos = items.filter((item) => item.attachmentUrls.length > 0);
  if (withPhotos.length === 0) return null;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white">
      <div className="bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-800">
        {title}
      </div>
      <div className="flex flex-col gap-4 p-4">
        {withPhotos.map((item) => (
          <div key={item.id}>
            <p className="mb-2 text-sm font-medium text-zinc-700">{item.label}</p>
            <div className="flex flex-wrap gap-3">
              {item.attachmentUrls.map((url, index) => (
                <div
                  key={url}
                  className="relative size-32 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                >
                  {/* Signed Storage URLs are dynamic per request, so
                      next/image can't optimize them at build time — a plain
                      <img> avoids fighting that. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={url}
                    alt={`${item.label} ${index + 1}`}
                    className="size-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SurveyRow({
  question,
  answer,
}: {
  question: string;
  answer: SurveyAnswer;
}) {
  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="px-4 py-3 text-sm text-zinc-800">{question}</td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          readOnly
          checked={answer.occurred === false}
          className="size-4"
        />
      </td>
      <td className="px-4 py-3 text-center">
        <input
          type="checkbox"
          readOnly
          checked={answer.occurred === true}
          className="size-4"
        />
      </td>
      <td className="px-4 py-3 text-sm text-zinc-600">
        {answer.notes ?? (
          <span className="text-zinc-400 italic">Not yet recorded</span>
        )}
      </td>
    </tr>
  );
}

export function DailyLogDetailView({
  log,
  categories,
  materials,
  materialRequests,
  equipmentRequests,
  surveyQuestions,
  highlightEntryType,
  highlightEntryId,
}: {
  log: DailyLogDetail;
  categories: CategoryOption[];
  materials: ProjectMaterial[];
  materialRequests: MaterialRequestDetail[];
  equipmentRequests: EquipmentRequestDetail[];
  surveyQuestions: SurveyQuestion[];
  /** Set when this page was reached from a ledger table's own record —
   * Material Usage History or one of the Expenses tables — pointing at
   * the specific entry that record came from (see dailyLogEntryHref).
   * Scrolled to and briefly highlighted once below, so the user lands
   * right on the entry they clicked through for instead of the top of
   * a possibly long page. */
  highlightEntryType?: EntryType;
  highlightEntryId?: number | null;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const canEdit = log.status === "pending" || log.status === "rejected";
  const flagProps: FlagSectionProps = {
    dailyLogId: log.id,
    projectId: log.projectId,
    logStatus: log.status,
    flags: log.flags,
  };

  // Cleared automatically a couple seconds after landing — the target
  // row's own highlight classes fade out via transition-colors once
  // this goes back to null, not an abrupt disappearance.
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightEntryType || highlightEntryId == null) return;
    const id = entryDomId(highlightEntryType, highlightEntryId);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHighlightedId(id);
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => setHighlightedId(null), 2500);
    return () => clearTimeout(timeout);
  }, [highlightEntryType, highlightEntryId]);

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
          <span className="text-zinc-500">Progress</span>
          <span className="text-zinc-300">/</span>
          <span className="text-zinc-500">Daily Log</span>
          <span className="text-zinc-300">/</span>
          <span className="font-medium text-zinc-900">
            {formatDateLong(log.logDate)}
          </span>
        </nav>
        <LogoutButton />
      </header>

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex flex-col gap-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-6">
            <div className="flex items-center justify-between">
              <Link
                href={dailyLogsListHref(log.projectId)}
                className="flex items-center gap-1.5 text-sm font-medium text-zinc-600 transition hover:text-zinc-900"
              >
                <ChevronLeft className="size-4" />
                {formatDateLong(log.logDate)}
                <StatusBadge
                  status={log.status}
                  unresolvedFlagCount={
                    log.flags.filter((f) => !f.resolvedAt).length
                  }
                />
              </Link>
              <div className="flex flex-shrink-0 items-center gap-2">
                <div className="relative flex items-center divide-x divide-zinc-200 rounded border border-zinc-200">
                  <ReviewActions
                    dailyLogId={log.id}
                    projectId={log.projectId}
                    status={log.status}
                  />
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    disabled={!canEdit}
                    title={
                      canEdit
                        ? undefined
                        : "An approved daily log can no longer be edited"
                    }
                    className={
                      canEdit
                        ? "flex cursor-pointer items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-600 transition hover:bg-zinc-50 hover:text-zinc-900"
                        : "flex cursor-not-allowed items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-zinc-300"
                    }
                  >
                    <Pencil className="size-4" />
                    Edit
                  </button>
                </div>
                <DeleteButton
                  dailyLogId={log.id}
                  projectId={log.projectId}
                  logDateLabel={formatDateLong(log.logDate)}
                />
              </div>
            </div>

            <h1 className="mt-3 text-lg font-semibold text-zinc-900">
              {log.projectName}
            </h1>
            {log.projectLocation && (
              <p className="mt-1 text-sm text-zinc-500">
                {log.projectLocation}
              </p>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="flex items-center justify-between bg-zinc-800 px-4 py-2.5 text-xs text-white">
              <span>Date: {formatDateWithWeekday(log.logDate)}</span>
              <span>Prepared By: {log.submittedByName}</span>
            </div>

            <div className="p-4">
              <h3 className="mb-2 text-sm font-semibold text-zinc-900">
                Work Logs
              </h3>
              {log.workItems.length === 0 ? (
                <p className="py-4 text-center text-sm text-zinc-400">
                  No work logs recorded for this day.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="text-xs text-zinc-500">
                      <tr>
                        <th className="px-2 py-2 font-medium">Phase Category</th>
                        <th className="px-2 py-2 font-medium">Work Item</th>
                        <th className="px-2 py-2 font-medium">Activity</th>
                        <th className="px-2 py-2 font-medium">
                          Quantity Completed
                        </th>
                        <th className="px-2 py-2 font-medium">Unit</th>
                        <th className="px-2 py-2 font-medium">Flag</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-100">
                      {log.workItems.map((item) => {
                        const flag = findFlag(flagProps.flags, "work_item", item.id);
                        const id = entryDomId("work_item", item.id);
                        return (
                        <tr key={item.id} id={id} className={highlightClass(id, highlightedId)}>
                          <td className="px-2 py-2.5 text-zinc-700">
                            {item.categoryName}
                          </td>
                          <td className="px-2 py-2.5 font-medium text-zinc-900">
                            {item.taskName}
                          </td>
                          <td className="px-2 py-2.5 text-zinc-600">
                            {item.activity || "—"}
                          </td>
                          <td className="px-2 py-2.5 text-zinc-700">
                            {item.quantityCompleted}
                          </td>
                          <td className="px-2 py-2.5 text-zinc-600">
                            {item.unit || "—"}
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-1">
                              <FlagControl
                                {...flagProps}
                                entryType="work_item"
                                entryId={item.id}
                                flag={flag}
                              />
                              {canCorrectEntry(flag, flagProps.logStatus) && (
                                <EditFlaggedEntryButton
                                  dailyLogId={flagProps.dailyLogId}
                                  projectId={flagProps.projectId}
                                  entryType="work_item"
                                  entry={item}
                                  categories={categories}
                                />
                              )}
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {log.workItems.some((item) => item.attachmentUrls.length > 0) && (
            <div className="rounded-lg border border-zinc-200 bg-white">
              <div className="bg-zinc-100 px-4 py-2 text-sm font-medium text-zinc-800">
                Work Log Photos
              </div>
              <div className="flex flex-col gap-4 p-4">
                {log.workItems
                  .filter((item) => item.attachmentUrls.length > 0)
                  .map((item) => (
                    <div key={item.id}>
                      <p className="mb-2 text-sm font-medium text-zinc-700">
                        {item.taskName}
                      </p>
                      <div className="flex flex-wrap gap-3">
                        {item.attachmentUrls.map((url, index) => (
                          <div
                            key={url}
                            className="relative size-32 overflow-hidden rounded-md border border-zinc-200 bg-zinc-50"
                          >
                            {/* Signed Storage URLs are dynamic per request,
                                so next/image can't optimize them at build
                                time — a plain <img> avoids fighting that. */}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={`${item.taskName} ${index + 1}`}
                              className="size-full object-cover"
                            />
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-xs text-zinc-400">
                        {item.attachmentUrls.length} photo
                        {item.attachmentUrls.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  ))}
              </div>
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
              Material Usage
            </div>
            <MaterialUsageSection
              items={log.materialUsageItems}
              flagProps={flagProps}
              materials={materials}
              highlightedId={highlightedId}
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
              Labor Logs
            </div>
            <LaborLogsSection
              items={log.laborItems}
              flagProps={flagProps}
              highlightedId={highlightedId}
            />
          </div>
          <AttachmentGallery
            title="Labor Log Photos"
            items={log.laborItems.map((item) => ({
              id: item.id,
              label: item.workerRole,
              attachmentUrls: item.attachmentUrls,
            }))}
          />

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
              Material Procurement Logs
            </div>
            <ProcurementLogsSection
              logs={log.procurementLogs}
              flagProps={flagProps}
              highlightedId={highlightedId}
            />
          </div>
          <AttachmentGallery
            title="Material Procurement Photos"
            items={log.procurementLogs.map((procurement) => ({
              id: procurement.id,
              label:
                procurement.supplierName ||
                PROCUREMENT_TYPE_LABELS[procurement.procurementType],
              attachmentUrls: procurement.attachmentUrls,
            }))}
          />

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
              Equipment Acquisition Logs
            </div>
            <EquipmentAcquisitionLogsSection
              logs={log.equipmentAcquisitionLogs}
              flagProps={flagProps}
              highlightedId={highlightedId}
            />
          </div>
          <AttachmentGallery
            title="Equipment Acquisition Photos"
            items={log.equipmentAcquisitionLogs.map((acquisition) => ({
              id: acquisition.id,
              label: acquisition.equipmentName,
              attachmentUrls: acquisition.attachmentUrls,
            }))}
          />

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <div className="bg-zinc-800 px-4 py-2 text-sm font-medium text-white">
              Other Expense
            </div>
            <ExpenseLogsSection
              items={log.expenseItems}
              flagProps={flagProps}
              highlightedId={highlightedId}
            />
          </div>
          <AttachmentGallery
            title="Other Expense Photos"
            items={log.expenseItems.map((item) => ({
              id: item.id,
              label: item.expenseCategory,
              attachmentUrls: item.attachmentUrls,
            }))}
          />

          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-zinc-800 px-4 py-2 text-sm font-semibold text-white">
            Survey
          </div>
          <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
            <table className="w-full text-left">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs text-zinc-500">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Questions</th>
                  <th className="px-4 py-2.5 text-center font-medium">No</th>
                  <th className="px-4 py-2.5 text-center font-medium">Yes</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody>
                {surveyQuestions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-6 text-center text-sm text-zinc-400">
                      This project has no Survey questions configured yet.
                    </td>
                  </tr>
                ) : (
                  surveyQuestions.map((question) => {
                    const answer = log.surveyAnswers.find(
                      (a) => a.questionId === question.id
                    );
                    return (
                      <SurveyRow
                        key={question.id}
                        question={question.questionText}
                        answer={{
                          occurred: answer?.occurred ?? null,
                          notes: answer?.notes ?? null,
                        }}
                      />
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>

      {canEdit && (
        <AddDailyLogModal
          key={log.status}
          projectId={log.projectId}
          categories={categories}
          materials={materials}
          materialRequests={materialRequests}
          equipmentRequests={equipmentRequests}
          surveyQuestions={surveyQuestions}
          editLog={log}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}
