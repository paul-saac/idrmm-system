const CHART_HEIGHT = 240;
const TICKS = 4;

export type CostBar = {
  label: string;
  value: number;
  /** Solid fill for both the bar and its matching legend dot, e.g. "bg-sky-300". */
  colorClass: string;
};

function formatAxisValue(value: number) {
  if (value >= 1_000_000) {
    return `₱${(value / 1_000_000).toLocaleString("en-PH", { maximumFractionDigits: 1 })}M`;
  }
  if (value >= 1_000) {
    return `₱${(value / 1_000).toLocaleString("en-PH", { maximumFractionDigits: 0 })}K`;
  }
  return `₱${Math.round(value).toLocaleString("en-PH")}`;
}

function formatFullValue(value: number) {
  return `₱${Math.round(value).toLocaleString("en-PH")}`;
}

/**
 * Picks a "nice" round axis max (e.g. 6,000,000 rather than 5,680,000) so
 * gridlines land on clean numbers, the same way charting libraries do.
 */
function niceAxisMax(rawMax: number) {
  if (rawMax <= 0) return TICKS;
  const rawStep = rawMax / TICKS;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const residual = rawStep / magnitude;

  let niceResidual: number;
  if (residual > 5) niceResidual = 10;
  else if (residual > 2) niceResidual = 5;
  else if (residual > 1) niceResidual = 2;
  else niceResidual = 1;

  return niceResidual * magnitude * TICKS;
}

/**
 * Simple bar chart built from flex/absolute positioning — no charting
 * library needed for four static bars. Originally just the Overview
 * tab's estimated/allocated/actual/remaining figures; the Expenses tab's
 * Overview sub-tab reuses it for its own four category totals (Material/
 * Labor/Equipment/Other), hence `title`/`subtitle` being overridable
 * rather than hardcoded to the first caller's wording.
 */
export function TotalCostsChart({
  bars,
  title = "Total Costs",
  subtitle = "Estimated vs. Allocated vs. Actual vs. Remaining",
}: {
  bars: CostBar[];
  title?: string;
  subtitle?: string;
}) {
  const rawMax = Math.max(...bars.map((bar) => bar.value), 0);
  const axisMax = niceAxisMax(rawMax);
  const tickValues = Array.from(
    { length: TICKS + 1 },
    (_, i) => axisMax - (axisMax / TICKS) * i
  );

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-6">
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
          <p className="text-xs text-zinc-400">{subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {bars.map((bar) => (
            <span
              key={bar.label}
              className="flex items-center gap-1.5 text-xs text-zinc-500"
            >
              <span className={`size-2 rounded-full ${bar.colorClass}`} />
              {bar.label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <div
          className="flex flex-col justify-between text-right text-xs text-zinc-400"
          style={{ height: CHART_HEIGHT }}
        >
          {tickValues.map((tick) => (
            <span key={tick}>{formatAxisValue(tick)}</span>
          ))}
        </div>

        <div
          className="relative flex flex-1 justify-around border-l border-zinc-200"
          style={{ height: CHART_HEIGHT }}
        >
          {tickValues.map((tick, i) => (
            <div
              key={tick}
              className={`absolute right-0 left-0 ${i === TICKS ? "border-t border-zinc-200" : "border-t border-dashed border-zinc-100"}`}
              style={{ bottom: (tick / axisMax) * CHART_HEIGHT }}
            />
          ))}

          {bars.map((bar) => {
            const heightPx =
              axisMax > 0 ? (bar.value / axisMax) * CHART_HEIGHT : 0;
            return (
              <div
                key={bar.label}
                className="z-10 flex w-20 flex-col items-center justify-end"
                style={{ height: CHART_HEIGHT }}
              >
                {bar.value > 0 && (
                  <span className="mb-1.5 text-xs font-semibold text-zinc-700">
                    {formatFullValue(bar.value)}
                  </span>
                )}
                <div
                  className={`w-12 rounded-t-lg shadow-sm transition-all duration-300 hover:brightness-110 ${bar.colorClass}`}
                  style={{ height: Math.max(heightPx, bar.value > 0 ? 3 : 0) }}
                  title={formatFullValue(bar.value)}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-3 flex justify-around border-t border-zinc-100 pt-3 pl-14 text-xs font-medium text-zinc-600">
        {bars.map((bar) => (
          <span key={bar.label} className="w-20 text-center">
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}
