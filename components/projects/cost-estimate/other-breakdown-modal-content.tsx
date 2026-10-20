"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { saveOtherCostBreakdown } from "@/lib/cost-estimate/actions";
import type { CostCategory, OtherCostItem } from "@/lib/cost-estimate/data";
import { otherCostAmount, validOtherCostChanges, type OtherCostChange } from "@/lib/cost-estimate/other-cost-lines";
import {
  DIVIDER, GROUP_ROW, GroupLabel, MAIN_TASK_ROW, STICKY_FOOTER,
  SUBTASK_NAME_CELL, TREE_CELL, TreeLine,
} from "./breakdown-table-shared";

type DraftLine = {
  key: string;
  costName: string;
  quantity: string;
  unit: string;
  unitCost: string;
  amountOverride: string;
};
type Owner = { kind: "task" | "category"; id: number; name: string; total: number; items: OtherCostItem[] };
const currency = (n: number) => `₱${n.toLocaleString("en-PH", { maximumFractionDigits: 2 })}`;
const number = (value: string) => Number(value.replaceAll(",", "").trim());
const ownerKey = (owner: Owner) => `${owner.kind}-${owner.id}`;
function inputLine(line: DraftLine) {
  return {
    costName: line.costName.trim(), quantity: number(line.quantity), unit: line.unit.trim(),
    unitCost: number(line.unitCost),
    amountOverride: number(line.amountOverride),
  };
}
function amount(line: DraftLine) {
  const result = otherCostAmount(inputLine(line));
  return Number.isFinite(result) ? result : 0;
}
function initialLines(owner: Owner): DraftLine[] {
  if (owner.items.length) return owner.items.map((item) => ({
    key: `saved-${item.id}`, costName: item.costName, quantity: String(item.quantity ?? 1),
    unit: item.unit ?? "", unitCost: String(item.unitCost ?? item.amount),
    amountOverride: String(item.amount),
  }));
  // Keep legacy lump sums intact; only persist them when this owner is edited.
  return owner.total ? [{
    key: "legacy", costName: "Other cost", quantity: "1", unit: "lot",
    unitCost: String(owner.total), amountOverride: String(owner.total),
  }] : [];
}

export function OtherBreakdownModalContent({
  projectId, categories, onClose,
}: { projectId: number; categories: CostCategory[]; onClose: () => void }) {
  const router = useRouter();
  const [drafts, setDrafts] = useState<Record<string, DraftLine[]>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owners = categories.flatMap<Owner>((category) => category.tasks.length
    ? category.tasks.map((task) => ({ kind: "task" as const, id: task.id, name: task.name, total: task.otherCostEstimate, items: task.otherCostItems }))
    : [{ kind: "category" as const, id: category.id, name: category.name, total: category.categoryOtherEstimate, items: category.otherCostItems ?? [] }]);
  const lines = (owner: Owner) => drafts[ownerKey(owner)] ?? initialLines(owner);
  const total = (owner: Owner) => lines(owner).reduce((sum, line) => sum + amount(line), 0);
  function change(owner: Owner, key: string, field: "costName" | "amountOverride", value: string) {
    setDrafts((previous) => ({
      ...previous,
      [ownerKey(owner)]: (previous[ownerKey(owner)] ?? initialLines(owner)).map((line) =>
        line.key === key ? {
          ...line, [field]: value,
        } : line),
    }));
  }
  async function save() {
    const changes: OtherCostChange[] = owners.filter((owner) => drafts[ownerKey(owner)] !== undefined)
      .map((owner) => ({ kind: owner.kind, id: owner.id, lines: lines(owner).map(inputLine) }));
    if (!validOtherCostChanges(changes)) {
      setError("Enter a cost name and a valid nonnegative amount for every row.");
      return;
    }
    setPending(true);
    setError(null);
    try {
      const result = await saveOtherCostBreakdown(projectId, changes);
      if (result.error) { setError(result.error); return; }
      router.refresh();
      onClose();
    } catch {
      setError("Could not save Other costs. Your edits are still here; please try again.");
    } finally { setPending(false); }
  }
  function addButton(owner: Owner) {
    return <button type="button" disabled={pending}
      onClick={() => setDrafts((previous) => ({
        ...previous, [ownerKey(owner)]: [...(previous[ownerKey(owner)] ?? initialLines(owner)),
          { key: crypto.randomUUID(), costName: "", quantity: "1", unit: "", unitCost: "0", amountOverride: "" }],
      }))}
      className="inline-flex h-6 shrink-0 cursor-pointer items-center rounded-sm border border-zinc-200 bg-white px-2.5 text-xs font-medium text-zinc-600 opacity-0 transition group-hover:opacity-100 hover:border-zinc-300 hover:bg-zinc-50 hover:text-zinc-900 focus-visible:opacity-100 disabled:opacity-50">
      Add Other Cost
    </button>;
  }
  function detailRows(owner: Owner, tree: boolean, lastTask = false) {
    return <Fragment>
      {lines(owner).map((line) => <tr key={line.key} className="group border-y border-zinc-200 bg-[rgba(252,211,77,0.08)] transition-colors hover:bg-[rgba(252,211,77,0.15)]">
        <td className={TREE_CELL}>{tree && !lastTask && <TreeLine />}</td>
          <td className={`${DIVIDER} border-l-3 border-l-zinc-300 pr-2 pl-4`}>
            <div className="flex items-center">
            <input
              aria-label={`${owner.name} cost name`}
              disabled={pending} value={line.costName}
              onChange={(event) => change(owner, line.key, "costName", event.target.value)}
              placeholder="Cost name"
              className="h-9 min-w-0 flex-1 bg-transparent text-xs font-medium text-zinc-700 outline-none placeholder:font-normal placeholder:text-zinc-300"
            />
            <button type="button" disabled={pending}
              aria-label={`Remove ${line.costName || "other cost"} from ${owner.name}`}
              onClick={() => setDrafts((previous) => ({ ...previous, [ownerKey(owner)]: (previous[ownerKey(owner)] ?? initialLines(owner)).filter((item) => item.key !== line.key) }))}
              className="shrink-0 cursor-pointer rounded p-1 text-zinc-400 opacity-0 transition group-hover:opacity-100 hover:bg-red-50 hover:text-red-600 focus-visible:opacity-100 disabled:opacity-50"><Trash2 className="size-3.5" /></button>
            </div>
          </td>
        <td>
          <input aria-label={`${owner.name} ${line.costName || "Other cost"} amount`}
            disabled={pending} inputMode="decimal"
            value={line.amountOverride}
            onChange={(event) => change(owner, line.key, "amountOverride", event.target.value)}
            className="h-9 w-full min-w-0 bg-transparent px-4 text-right text-xs font-medium text-zinc-700 outline-none transition hover:bg-zinc-900 hover:text-white focus:bg-transparent focus:text-zinc-700" />
        </td>
      </tr>)}
    </Fragment>;
  }
  return <div className="flex min-h-full flex-col gap-5">
    <div className="overflow-x-auto border border-zinc-200 bg-white">
      <table className="w-full min-w-[480px] table-fixed text-left text-xs">
        <colgroup><col className="w-9" /><col /><col className="w-44" /></colgroup>
        <thead className="bg-zinc-50 font-medium text-zinc-500"><tr>
          <th colSpan={2} className={`${DIVIDER} border-b border-zinc-200 px-4 py-2.5`}>Task / Other cost</th>
          <th className="border-b border-zinc-200 px-4 py-2.5 text-right">Amount</th>
        </tr></thead>
        <tbody>{categories.map((category) => {
          const categoryOwners = owners.filter((owner) => category.tasks.length
            ? owner.kind === "task" && category.tasks.some((task) => task.id === owner.id)
            : owner.kind === "category" && owner.id === category.id);
          return <Fragment key={category.id}>
            <tr className={MAIN_TASK_ROW}>
              <td colSpan={2} className={`${DIVIDER} px-4 py-2.5`}><div className="flex items-center justify-between gap-2"><GroupLabel label={category.name} />{!category.tasks.length && addButton(categoryOwners[0])}</div></td>
              <td className="px-4 py-2.5 text-right font-medium">{currency(categoryOwners.reduce((sum, owner) => sum + total(owner), 0))}</td>
            </tr>
            {category.tasks.length ? categoryOwners.map((owner, index) => <Fragment key={owner.id}>
              <tr className={`${GROUP_ROW} bg-white`}>
                <td className={TREE_CELL}><TreeLine branch end={index === categoryOwners.length - 1} /></td>
                <td className={`${SUBTASK_NAME_CELL} py-2.5`}><div className="flex items-center justify-between gap-2"><GroupLabel label={owner.name} />{addButton(owner)}</div></td>
                <td className="px-4 py-2.5 text-right font-medium">{currency(total(owner))}</td>
              </tr>
              {detailRows(owner, true, index === categoryOwners.length - 1)}
            </Fragment>) : categoryOwners.map((owner) => <Fragment key={owner.id}>{detailRows(owner, false)}</Fragment>)}
          </Fragment>;
        })}</tbody>
      </table>
    </div>
    <div className={STICKY_FOOTER}>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm"><span className="font-medium text-zinc-500">Total Other Cost (Project)</span>{" "}
          <span className="font-semibold text-zinc-900">{currency(owners.reduce((sum, owner) => sum + total(owner), 0))}</span></div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={onClose} disabled={pending} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-60">Cancel</button>
          <button type="button" onClick={save} disabled={pending || !Object.keys(drafts).length}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60">{pending ? "Saving..." : "Save Changes"}</button>
        </div>
      </div>
    </div>
  </div>;
}
