import type { EquipmentRequestStatus } from "@/lib/equipment-requests/data";

/**
 * Derives an equipment request's overall status from its items'
 * fulfillment, same reasoning (and same logic) as
 * deriveMaterialRequestStatus in lib/material-requests/status.ts — kept
 * as its own copy rather than a shared generic helper since the two
 * request types' tables and callers are otherwise independent, and a
 * shared helper would just be an extra indirection for a few lines of
 * logic.
 *
 * Plain sync helper, deliberately kept out of actions.ts — that file is
 * "use server", and Next.js requires every export from a "use server"
 * file to be an async Server Action, which this isn't (it does no I/O).
 * Shared between lib/equipment-requests/actions.ts (editing a request's
 * own items) and lib/daily-logs/actions.ts (crediting fulfillment when a
 * linked Equipment Acquisition Log entry is approved).
 */
export function deriveEquipmentRequestStatus(
  currentStatus: EquipmentRequestStatus,
  items: { quantityNeeded: number; quantityFulfilled: number }[]
): EquipmentRequestStatus {
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
