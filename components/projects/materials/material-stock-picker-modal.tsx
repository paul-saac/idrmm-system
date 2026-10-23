"use client";

import { useMemo, useState } from "react";
import { Package, Search, X } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import type { MaterialStockItem } from "@/lib/materials/purchases-model";

export function MaterialStockPickerModal({
  open,
  stocks,
  selectedMaterialName,
  title = "Select material from stock",
  description = "Choose a material from existing stocks.",
  icon = <Package className="size-5" />,
  variant = "centered",
  onSelect,
  onClose,
}: {
  open: boolean;
  stocks: readonly MaterialStockItem[];
  selectedMaterialName?: string;
  title?: string;
  description?: string;
  icon?: React.ReactNode;
  variant?: "panel" | "centered";
  onSelect: (stock: MaterialStockItem) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filteredStocks = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return stocks;
    return stocks.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.unit.toLowerCase().includes(q) ||
        s.statusLabel.toLowerCase().includes(q)
    );
  }, [stocks, search]);

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      icon={icon}
      variant={variant}
      size="wide"
      onClose={onClose}
    >
      <div className="flex flex-col gap-4">
        <div className="relative w-full">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search material by name or unit..."
            className="h-[38px] w-full rounded-md border border-zinc-200 bg-white pr-9 pl-9 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-0"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700"
              title="Clear search"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          {filteredStocks.length === 0 ? (
            <div className="py-10 text-center text-sm text-zinc-400">
              {stocks.length === 0 ? (
                <p>No material stock movements recorded yet.</p>
              ) : (
                <p>No materials matching &ldquo;{search}&rdquo;</p>
              )}
            </div>
          ) : (
            <div className="max-h-[50vh] overflow-x-auto overflow-y-auto">
              <table className="w-full min-w-[38rem] text-left text-sm">
                <thead className="sticky top-0 z-10 border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                  <tr>
                    <th className="px-5 py-3">Material</th>
                    <th className="px-4 py-3">Unit</th>
                    <th className="px-4 py-3 text-right">Purchased</th>
                    <th className="px-4 py-3 text-right">Used</th>
                    <th className="px-4 py-3 text-right">Stock on hand</th>
                    <th className="px-5 py-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {filteredStocks.map((stock) => {
                    const isSelected =
                      Boolean(selectedMaterialName) &&
                      selectedMaterialName?.trim().toLowerCase() ===
                        stock.name.toLowerCase();
                    return (
                      <tr
                        key={stock.key}
                        onClick={() => {
                          onSelect(stock);
                          onClose();
                        }}
                        className={`cursor-pointer transition-colors hover:bg-zinc-50 ${
                          isSelected ? "bg-zinc-50/80" : ""
                        }`}
                      >
                        <td className="px-5 py-3 font-semibold text-zinc-900">
                          <div className="flex items-center gap-2">
                            <Package className="size-4 shrink-0 text-zinc-400" />
                            <span>{stock.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-zinc-600">{stock.unit || "—"}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                          {stock.purchased.toLocaleString("en-PH", {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-zinc-600">
                          {stock.used.toLocaleString("en-PH", {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td
                          className={`px-4 py-3 text-right font-semibold tabular-nums ${
                            stock.status === "over_issued"
                              ? "text-red-600"
                              : stock.status === "low_stock"
                              ? "text-amber-700"
                              : stock.status === "out_of_stock"
                              ? "text-zinc-500"
                              : "text-zinc-900"
                          }`}
                        >
                          {stock.balance.toLocaleString("en-PH", {
                            maximumFractionDigits: 3,
                          })}
                        </td>
                        <td className="px-5 py-3">
                          <span
                            className={`inline-block rounded-sm px-2 py-0.5 text-xs font-medium ${stock.badgeStyle}`}
                          >
                            {stock.statusLabel}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ModalFooter>
        <button
          type="button"
          onClick={onClose}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Close
        </button>
      </ModalFooter>
    </Modal>
  );
}
