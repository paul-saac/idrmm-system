export type OtherCostLineInput = {
  costName: string;
  quantity: number;
  unit: string;
  unitCost: number;
  amountOverride: number | null;
};
export type OtherCostChange = {
  kind: "task" | "category";
  id: number;
  lines: OtherCostLineInput[];
};
export function otherCostAmount(line: Pick<OtherCostLineInput, "quantity" | "unitCost" | "amountOverride">) {
  return Math.round(((line.amountOverride ?? line.quantity * line.unitCost) + Number.EPSILON) * 100) / 100;
}
export function validOtherCostChanges(changes: OtherCostChange[]): boolean {
  return Array.isArray(changes) && changes.every((owner) =>
    owner && (owner.kind === "task" || owner.kind === "category") &&
    Number.isSafeInteger(owner.id) && owner.id > 0 &&
    Array.isArray(owner.lines) && owner.lines.every((line) =>
      line && typeof line.costName === "string" && line.costName.trim().length > 0 &&
      typeof line.unit === "string" &&
      [line.quantity, line.unitCost].every((n) => Number.isFinite(n) && n >= 0 && n < 1e12) &&
      (line.amountOverride === null ||
        (Number.isFinite(line.amountOverride) && line.amountOverride >= 0 && line.amountOverride < 1e15))
    )
  );
}
