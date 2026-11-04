/** A fixed daily subcontractor amount is independent of hourly attendance. */
export function laborEntryCost(row: { hours: number; rate: number; amount?: number | null }) {
  return row.amount ?? row.hours * row.rate;
}
