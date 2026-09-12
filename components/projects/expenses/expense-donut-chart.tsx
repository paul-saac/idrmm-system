import { formatCurrency } from "@/components/projects/expenses/expense-table-shared";

function LegendRow({
  dotClass,
  label,
  value,
  valueClassName,
}: {
  dotClass: string;
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-1.5 text-zinc-500">
        <span className={`size-2 flex-shrink-0 rounded-full ${dotClass}`} />
        {label}
      </span>
      <span className={`font-medium ${valueClassName ?? "text-zinc-700"}`}>
        {value}
      </span>
    </div>
  );
}

/**
 * Planned vs. Actual vs. Balance for one cost category — the ring always
 * spans max(planned, actual) so it never over/underflows a full circle:
 * under (or at) budget draws Actual in blue with the unspent Planned
 * remainder in mint; over budget draws the full Planned amount in blue
 * with the overage on top in rose, since there's nothing "remaining" to
 * show mint for once spending has passed what was planned.
 */
export function ExpenseDonutCard({
  title,
  planned,
  actual,
}: {
  title: string;
  planned: number;
  actual: number;
}) {
  const balance = planned - actual;
  const total = Math.max(planned, actual, 1);
  const actualPct = (actual / total) * 100;
  const plannedPct = (planned / total) * 100;
  const overBudget = actual > planned;
  const gradient =
    planned === 0 && actual === 0
      ? "#f4f4f5"
      : overBudget
        ? `conic-gradient(#38bdf8 0% ${plannedPct}%, #fb7185 ${plannedPct}% 100%)`
        : `conic-gradient(#38bdf8 0% ${actualPct}%, #a7f3d0 ${actualPct}% 100%)`;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      <div className="mt-4 flex items-center gap-5">
        <div className="relative size-24 flex-shrink-0">
          <div className="size-full rounded-full" style={{ background: gradient }} />
          <div className="absolute inset-3 rounded-full bg-white" />
        </div>
        <div className="flex flex-1 flex-col gap-2 text-xs">
          <LegendRow
            dotClass="bg-emerald-200"
            label="Planned Costs"
            value={formatCurrency(planned)}
          />
          <LegendRow
            dotClass="bg-sky-400"
            label="Actual Costs"
            value={formatCurrency(actual)}
          />
          <LegendRow
            dotClass="bg-rose-400"
            label="Balance"
            value={`${balance < 0 ? "-" : "+"}${formatCurrency(Math.abs(balance))}`}
            valueClassName={balance < 0 ? "text-rose-600" : "text-zinc-700"}
          />
        </div>
      </div>
    </div>
  );
}
