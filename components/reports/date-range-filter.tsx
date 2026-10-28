import Link from "next/link";
import type { DateRange } from "@/lib/reports/data";
import type { PortalBasePath } from "@/components/portal/portal-context";
import { DatePicker } from "@/components/ui/date-picker";

/**
 * Plain GET form — no client JS needed, submitting just re-navigates
 * this page with `from`/`to` search params, and the server component
 * re-fetches the three expense tables scoped to that range. Only the
 * three summary tables are scoped by this filter; the Monthly Expense
 * trend chart always shows the project's full history (see
 * lib/reports/data.ts's buildMonthlySeries).
 */
export function DateRangeFilter({
  basePath,
  projectId,
  range,
}: {
  basePath: PortalBasePath;
  projectId: number;
  range: DateRange;
}) {
  const hasFilter = Boolean(range.from || range.to);

  return (
    <form
      action={`${basePath}/reports`}
      className="flex flex-wrap items-center gap-2 text-sm"
    >
      <input type="hidden" name="projectId" value={projectId} />
      <label className="flex items-center gap-1.5 text-zinc-600">
        From
        <DatePicker
          name="from"
          defaultValue={range.from ?? ""}
          ariaLabel="From date"
        />
      </label>
      <label className="flex items-center gap-1.5 text-zinc-600">
        To
        <DatePicker
          name="to"
          defaultValue={range.to ?? ""}
          ariaLabel="To date"
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
          href={`${basePath}/reports?projectId=${projectId}`}
          className="text-xs font-medium text-zinc-400 transition hover:text-zinc-700"
        >
          Clear
        </Link>
      )}
    </form>
  );
}
