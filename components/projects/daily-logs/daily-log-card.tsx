import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { DailyLogSummary } from "@/lib/daily-logs/data";

const COUNT_LABELS: Record<keyof DailyLogSummary["counts"], string> = {
  workLogs: "Work Log",
  laborLogs: "Labor Log",
  materialUsage: "Material Usage",
  materialProcurement: "Deliveries",
  equipmentAcquisition: "Equipment Acquisition",
  otherExpense: "Other Expense",
};

function formatDateLong(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "long",
    day: "2-digit",
    year: "numeric",
  });
}

function isToday(iso: string) {
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  return iso === todayIso;
}

function StatusBadge({ log }: { log: DailyLogSummary }) {
  if (log.status === "approved") {
    return (
      <span className="flex items-center gap-1.5">
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          Approved
        </span>
        {log.unresolvedFlagCount > 0 && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {log.unresolvedFlagCount} flagged
          </span>
        )}
      </span>
    );
  }
  if (log.status === "rejected") {
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
        Rejected
      </span>
    );
  }
  // status === "pending" — "Submitted" is purely a display label for
  // today's entry, not a separate stored status.
  return isToday(log.logDate) ? (
    <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700">
      Submitted
    </span>
  ) : (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
      Pending
    </span>
  );
}

export function DailyLogCard({
  projectId,
  log,
}: {
  projectId: number;
  log: DailyLogSummary;
}) {
  const nonZeroCounts = (
    Object.entries(log.counts) as [keyof DailyLogSummary["counts"], number][]
  ).filter(([, count]) => count > 0);

  return (
    <Link
      href={`/admin/projects/${projectId}/daily-logs/${log.id}`}
      className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white p-5 transition hover:border-zinc-300 hover:bg-zinc-50"
    >
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold text-zinc-900">
            {formatDateLong(log.logDate)}
          </h3>
          <StatusBadge log={log} />
        </div>
        <p className="mt-1 text-sm text-zinc-500">
          Submitted By: {log.submittedByName}
        </p>
        {nonZeroCounts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-6">
            {nonZeroCounts.map(([key, count]) => (
              <div key={key}>
                <p className="text-xs text-zinc-500">{COUNT_LABELS[key]}</p>
                <p className="text-sm font-medium text-zinc-800">
                  {String(count).padStart(2, "0")}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
      <ChevronRight className="size-5 flex-shrink-0 text-zinc-300" />
    </Link>
  );
}
