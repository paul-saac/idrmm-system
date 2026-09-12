import type { MaterialRequestStatus } from "@/lib/material-requests/data";

/**
 * Derives a material request's overall status from its items'
 * fulfillment rather than leaving it admin-set alongside
 * quantity_fulfilled edits — so the two can never disagree (e.g. a
 * request showing "Approved" while every item already reads
 * "Fulfilled"). Approval itself (moving off "submitted") is still an
 * explicit action (see approveMaterialRequest in
 * lib/material-requests/actions.ts) since recording fulfillment against
 * a request no one has reviewed yet shouldn't silently count as
 * approving it.
 *
 * Plain sync helper, deliberately kept out of actions.ts — that file is
 * "use server", and Next.js requires every export from a "use server"
 * file to be an async Server Action, which this isn't (it does no I/O).
 * Shared between lib/material-requests/actions.ts (editing a request's
 * own items) and lib/daily-logs/actions.ts (crediting fulfillment when a
 * linked Material Procurement Log entry is approved).
 */
export function deriveMaterialRequestStatus(
  currentStatus: MaterialRequestStatus,
  items: { quantityNeeded: number; quantityFulfilled: number }[]
): MaterialRequestStatus {
  if (currentStatus === "canceled" || currentStatus === "submitted") {
    return currentStatus;
  }
  if (items.length === 0) return currentStatus;

  const allFulfilled = items.every(
    (item) => item.quantityFulfilled >= item.quantityNeeded && item.quantityNeeded > 0
  );
  if (allFulfilled) return "fulfilled";

  const anyFulfilled = items.some((item) => item.quantityFulfilled > 0);
  return anyFulfilled ? "partially_fulfilled" : "approved";
}
