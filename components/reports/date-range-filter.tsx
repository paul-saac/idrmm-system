import Link from "next/link";
import type { DateRange } from "@/lib/reports/data";

/**
 * Plain GET form — no client JS needed, submitting just re-navigates
 * this page with `from`/`to` search params, and the server component
 * re-fetches the three expense tables scoped to that range. Only the
 * three summary tables are scoped by this filter; the Monthly Expense
 * trend chart always shows the project's full history (see
 * lib/reports/data.ts's buildMonthlySeries).
 */
export function DateRangeFilter({
  projectId,
  range,
}: {
  projectId: number;
  range: DateRange;
}) {
  const hasFilter = Boolean(range.from || range.to);

  return (
    <form
      action="/admin/reports"
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex items-center gap-1.5 text-zinc-600">
        From
        <input
          type="date"
          name="from"
          defaultValue={range.from ?? ""}
          className="rounded border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-zinc-400"
        />
      </label>
      <label className="flex items-center gap-1.5 text-zinc-600">
        To
        <input
          type="date"
          name="to"
          defaultValue={range.to ?? ""}
          className="rounded border border-zinc-200 px-2 py-1 text-sm outline-none focus:border-zinc-400"
        />
      </label>
      <button
        type="submit"
        className="cursor-pointer rounded border border-zinc-200 px-3 py-1 font-medium text-zinc-700 transition hover:bg-zinc-50"
      >
        Apply
      </button>
      {hasFilter && (
        <Link
          href={`/admin/reports?projectId=${projectId}`}
          className="text-xs font-medium text-zinc-400 transition hover:text-zinc-700"
        >
          Clear
        </Link>
      )}
    </form>
  );
}
