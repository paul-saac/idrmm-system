"use client";

/* eslint-disable @next/next/no-img-element */

import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, FileText, Image as ImageIcon, Package, Plus, Trash2 } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { ViewMenu, type ViewOption } from "@/components/ui/view-menu";
import {
  deleteMaterialPurchase,
  loadMaterialPurchases,
  saveMaterialPurchase,
} from "@/lib/materials/purchase-actions";
import { type MaterialPurchase } from "@/lib/materials/purchases-model";
import type { ProgressMaterialUsage } from "@/lib/materials/data";
import { materialKey } from "@/lib/task-progress/calculate";

const fieldInput =
  "w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

type ItemDraft = {
  supplier: string;
  materialName: string;
  unit: string;
  quantity: number | "";
  unitPrice: number | "";
  invoice_number: string;
  receiptFile: File | null;
  receiptPreviewUrl: string | null;
};

const blankItem = (): ItemDraft => ({
  supplier: "",
  materialName: "",
  unit: "",
  quantity: "",
  unitPrice: "",
  invoice_number: "",
  receiptFile: null,
  receiptPreviewUrl: null,
});

function formatPeso(value: number) {
  return `₱${value.toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDay(day: string) {
  if (!day) return "—";
  return new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Field({
  htmlFor,
  label,
  required,
  children,
}: {
  htmlFor?: string;
  label: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-900">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
    </div>
  );
}

type PurchaseView = "purchases" | "stocks";
const PURCHASE_VIEWS: ViewOption<PurchaseView>[] = [
  { value: "purchases", label: "Material purchases" },
  { value: "stocks", label: "Material stocks" },
];

export function MaterialPurchasesView({ projectId, usage }: { projectId: number; usage: ProgressMaterialUsage[] }) {
  const router = useRouter();
  const formId = useId();

  const [rows, setRows] = useState<MaterialPurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);

  const [openModal, setOpenModal] = useState(false);
  const [purchaseDate, setPurchaseDate] = useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);
  const [viewingReceiptUrl, setViewingReceiptUrl] = useState<string | null>(null);
  const [view, setView] = useState<PurchaseView>("purchases");

  async function refresh() {
    const data = await loadMaterialPurchases(projectId);
    setRows(data);
    router.refresh();
  }

  useEffect(() => {
    let canceled = false;
    loadMaterialPurchases(projectId)
      .then((data) => {
        if (!canceled) setRows(data);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [projectId]);

  function updateItem(index: number, patch: Partial<ItemDraft>) {
    setItems((current) =>
      current.map((item, j) => (j === index ? { ...item, ...patch } : item))
    );
  }

  function handleFileSelect(index: number, file: File) {
    const previewUrl = file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
    updateItem(index, { receiptFile: file, receiptPreviewUrl: previewUrl });
  }

  function handleRemoveFile(index: number) {
    const current = items[index];
    if (current?.receiptPreviewUrl) {
      URL.revokeObjectURL(current.receiptPreviewUrl);
    }
    updateItem(index, { receiptFile: null, receiptPreviewUrl: null });
  }

  function addItem() {
    setItems((current) => [...current, blankItem()]);
  }

  function removeItem(index: number) {
    const current = items[index];
    if (current?.receiptPreviewUrl) {
      URL.revokeObjectURL(current.receiptPreviewUrl);
    }
    setItems((itemsList) => itemsList.filter((_, j) => j !== index));
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.set("date", purchaseDate);
      formData.set("itemsCount", String(items.length));

      items.forEach((item, i) => {
        formData.set(`item_${i}_supplier`, item.supplier);
        formData.set(`item_${i}_material`, item.materialName);
        formData.set(`item_${i}_unit`, item.unit);
        formData.set(`item_${i}_quantity`, String(item.quantity === "" ? 0 : item.quantity));
        formData.set(`item_${i}_unitPrice`, String(item.unitPrice === "" ? 0 : item.unitPrice));
        formData.set(`item_${i}_price`, String((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0)));
        formData.set(`item_${i}_invoice`, item.invoice_number);
        if (item.receiptFile) {
          formData.set(`item_${i}_receipt`, item.receiptFile);
        }
      });

      const result = await saveMaterialPurchase(projectId, formData);
      if (result.error) {
        setError(result.error);
      } else {
        // Cleanup preview object URLs
        items.forEach((it) => {
          if (it.receiptPreviewUrl) URL.revokeObjectURL(it.receiptPreviewUrl);
        });
        setOpenModal(false);
        setItems([blankItem()]);
        await refresh();
      }
    } catch {
      setError("Could not save purchase. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Are you sure you want to delete this purchase record?")) {
      return;
    }
    setBusyId(id);
    setError(null);
    try {
      const result = await deleteMaterialPurchase(projectId, id);
      if (result.error) {
        setError(result.error);
      } else {
        await refresh();
      }
    } catch {
      setError("Could not delete purchase record.");
    } finally {
      setBusyId(null);
    }
  }

  const totalSpent = rows.reduce(
    (sum, r) => sum + Number(r.amount || r.unit_price || 0),
    0
  );
  const stocks = useMemo(() => {
    const byKey = new Map<string, { key: string; name: string; unit: string; purchased: number; received: number; used: number; lastReceived: string | null; lastUsed: string | null }>();
    const get = (name: string, unit: string | null) => {
      const key = materialKey(name, unit);
      let stock = byKey.get(key);
      if (!stock) {
        stock = { key, name: name.trim(), unit: unit ?? "", purchased: 0, received: 0, used: 0, lastReceived: null, lastUsed: null };
        byKey.set(key, stock);
      }
      return stock;
    };
    for (const row of rows) {
      const stock = get(row.material_name, row.unit);
      stock.purchased += Number(row.quantity) || 0;
      stock.received += Number(row.received_quantity) || 0;
      if (Number(row.received_quantity) > 0 && (!stock.lastReceived || row.purchase_date > stock.lastReceived)) stock.lastReceived = row.purchase_date;
    }
    for (const entry of usage) {
      const stock = get(entry.materialName, entry.unit);
      stock.used += entry.quantity;
      if (!stock.lastUsed || entry.entryDate > stock.lastUsed) stock.lastUsed = entry.entryDate;
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [rows, usage]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-3">
          <h2 className="text-base font-semibold text-zinc-900">{view === "purchases" ? "Material purchases" : "Material stocks"}</h2>
          <span className="text-xs text-zinc-400">
            {view === "purchases" ? `${rows.length} ${rows.length === 1 ? "purchase" : "purchases"}` : `${stocks.length} ${stocks.length === 1 ? "material" : "materials"}`}
          </span>
        </div>
        {view === "purchases" && <button
          type="button"
          onClick={() => {
            setPurchaseDate(new Date().toISOString().slice(0, 10));
            setItems([blankItem()]);
            setError(null);
            setOpenModal(true);
          }}
          className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
        >
          <Plus className="size-4" />
          Record Purchase
        </button>}
      </div>

      {error && !openModal && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="border-b border-zinc-200 px-4 py-3"><ViewMenu views={PURCHASE_VIEWS} value={view} onChange={setView} /></div>
        {view === "stocks" ? (
          stocks.length === 0 ? <p className="py-10 text-center text-sm text-zinc-400">No material stock movements recorded yet.</p> :
          <div className="overflow-x-auto"><table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500"><tr>
              <th className="px-5 py-3">Material</th><th className="px-4 py-3">Unit</th>
              <th className="px-4 py-3 text-right">Purchased</th>
              <th className="px-4 py-3 text-right">Used</th><th className="px-4 py-3 text-right">Stock on hand</th>
              <th className="px-4 py-3">Status</th><th className="px-5 py-3">Last movement</th>
            </tr></thead><tbody className="divide-y divide-zinc-100">{stocks.map((stock) => {
              const balance = Math.round((stock.received - stock.used) * 1000) / 1000;
              const lastMovement = [stock.lastReceived, stock.lastUsed].filter(Boolean).sort().at(-1) ?? null;
              const status = balance < 0 ? ["Over-issued", "bg-red-50 text-red-600"] : balance === 0 ? ["Out of stock", "bg-zinc-100 text-zinc-600"] : ["Available", "bg-emerald-50 text-emerald-700"];
              return <tr key={stock.key} className="hover:bg-zinc-50">
                <td className="px-5 py-3.5 font-semibold text-zinc-900">{stock.name}</td><td className="px-4 py-3.5 text-zinc-600">{stock.unit || "—"}</td>
                <td className="px-4 py-3.5 text-right tabular-nums">{stock.purchased.toLocaleString("en-PH", { maximumFractionDigits: 3 })}</td>
                <td className="px-4 py-3.5 text-right tabular-nums">{stock.used.toLocaleString("en-PH", { maximumFractionDigits: 3 })}</td>
                <td className={`px-4 py-3.5 text-right font-semibold tabular-nums ${balance < 0 ? "text-red-600" : "text-zinc-900"}`}>{balance.toLocaleString("en-PH", { maximumFractionDigits: 3 })}</td>
                <td className="px-4 py-3.5"><span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${status[1]}`}>{status[0]}</span></td>
                <td className="px-5 py-3.5 text-zinc-600">{lastMovement ? formatDay(lastMovement) : "—"}</td>
              </tr>;
            })}</tbody></table></div>
        ) : rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-400">
            {loading ? "Loading purchases…" : "No material purchases recorded yet."}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[50rem] text-left text-sm">
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium text-zinc-500">
                <tr>
                  <th className="px-5 py-3">Date</th>
                  <th className="px-4 py-3">Particular</th>
                  <th className="px-4 py-3 text-right">Price</th>
                  <th className="px-4 py-3">Description</th>
                  <th className="px-4 py-3 text-right">Purchased</th>
                  <th className="px-4 py-3">Invoice #</th>
                  <th className="px-4 py-3 text-center">Receipt</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {rows.map((r) => {
                  const displayDesc =
                    r.material_name && r.material_name !== r.supplier ? r.material_name : "";
                  return (
                    <tr key={r.id} className="transition-colors hover:bg-zinc-50">
                      <td className="px-5 py-3.5 font-medium whitespace-nowrap text-zinc-900 tabular-nums">
                        {formatDay(r.purchase_date)}
                      </td>
                      <td className="max-w-64 px-4 py-3.5 font-semibold text-zinc-900">
                        <span className="block truncate" title={r.supplier}>
                          {r.supplier}
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-right font-semibold whitespace-nowrap text-zinc-900 tabular-nums">
                        {formatPeso(Number(r.amount || r.unit_price))}
                      </td>
                      <td className="max-w-72 px-4 py-3.5 text-zinc-600">
                        {displayDesc ? (
                          <span className="block truncate" title={displayDesc}>
                            {displayDesc}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap tabular-nums">{Number(r.quantity).toLocaleString("en-PH", { maximumFractionDigits: 3 })} <span className="text-zinc-400">{r.unit}</span></td>
                      <td className="px-4 py-3.5 whitespace-nowrap text-zinc-600">
                        {r.invoice_number ? (
                          <span className="font-mono text-xs text-zinc-700">
                            {r.invoice_number}
                          </span>
                        ) : (
                          <span className="text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-center whitespace-nowrap">
                        {r.receipt_url ? (
                          <button
                            type="button"
                            onClick={() => setViewingReceiptUrl(r.receipt_url!)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded bg-sky-50 px-2 py-1 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                          >
                            <ImageIcon className="size-3.5" />
                            View
                          </button>
                        ) : (
                          <span className="text-xs text-zinc-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => handleDelete(r.id)}
                          title="Delete purchase"
                          className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {view === "purchases" && <div className="flex items-center justify-between border-t border-zinc-200 px-5 py-3 text-xs text-zinc-500">
          <div>
            Showing <span className="font-semibold text-zinc-700">{rows.length}</span> of{" "}
            <span className="font-semibold text-zinc-700">{rows.length}</span>{" "}
            {rows.length === 1 ? "purchase" : "purchases"}
          </div>
          {totalSpent > 0 && (
            <div>
              Total: <span className="font-semibold text-zinc-900">{formatPeso(totalSpent)}</span>
            </div>
          )}
        </div>}
      </div>

      <Modal
        open={openModal}
        title="Record material purchase"
        icon={<FileText className="size-5" />}
        onClose={() => {
          if (!busy) setOpenModal(false);
        }}
      >
        <form id={formId} onSubmit={submit} className="flex flex-col gap-6">
          {/* Purchase details: only outside input is Date */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-base font-semibold text-zinc-900">Purchase details</h3>
              <span className="text-xs text-zinc-500">
                <span className="text-red-500">*</span> Required
              </span>
            </div>
            <div className="max-w-xs">
              <Field htmlFor={`${formId}-date`} label="Date" required>
                <input
                  id={`${formId}-date`}
                  type="date"
                  required
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                  className={fieldInput}
                />
              </Field>
            </div>
          </section>

          {/* Purchased Items */}
          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-900">
                Purchased Items
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs font-medium text-zinc-600">
                  {items.length} {items.length === 1 ? "item" : "items"}
                </span>
              </h3>
              <button
                type="button"
                disabled={busy || items.length >= 100}
                onClick={addItem}
                className="flex cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-sm font-medium text-zinc-900 transition hover:bg-zinc-100 disabled:opacity-50"
              >
                <Plus className="size-4" />
                Add item
              </button>
            </div>

            {items.map((item, index) => {
              const id = `${formId}-item-${index}`;
              return (
                <div
                  key={index}
                  className="overflow-hidden rounded-md border border-zinc-200 bg-white"
                >
                  <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-4 py-2.5">
                    <Package aria-hidden className="size-4 shrink-0 text-zinc-400" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-900">
                      {item.materialName.trim() || `Item ${index + 1}`}
                    </span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => removeItem(index)}
                        aria-label="Remove item"
                        title="Remove item"
                        className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>

                  <div className="grid gap-4 p-4 sm:grid-cols-2">
                    <Field htmlFor={`${id}-supplier`} label="Supplier" required>
                      <input
                        id={`${id}-supplier`}
                        required
                        maxLength={200}
                        value={item.supplier}
                        onChange={(e) => updateItem(index, { supplier: e.target.value })}
                        placeholder="e.g., MARIKIT CONSTRUCTION SUPPLY"
                        className={fieldInput}
                      />
                    </Field>

                    <Field htmlFor={`${id}-material`} label="Description" required>
                      <input id={`${id}-material`} required maxLength={200} value={item.materialName} onChange={(e) => updateItem(index, { materialName: e.target.value })} placeholder="e.g., Portland cement" className={fieldInput} />
                    </Field>
                    <Field htmlFor={`${id}-unit`} label="Unit" required>
                      <input id={`${id}-unit`} required maxLength={40} value={item.unit} onChange={(e) => updateItem(index, { unit: e.target.value })} placeholder="e.g., bag" className={fieldInput} />
                    </Field>
                    <Field htmlFor={`${id}-quantity`} label="Quantity" required>
                      <input
                        id={`${id}-quantity`}
                        type="number"
                        required
                        min={0.01}
                        step={0.001}
                        value={item.quantity}
                        onChange={(e) =>
                          updateItem(index, {
                            quantity: e.target.value === "" ? "" : Number(e.target.value),
                          })
                        }
                        placeholder="0.00"
                        className={fieldInput}
                      />
                    </Field>

                    <Field htmlFor={`${id}-unit-price`} label="Unit price" required>
                      <input id={`${id}-unit-price`} type="number" required min={0} step={0.01} value={item.unitPrice} onChange={(e) => updateItem(index, { unitPrice: e.target.value === "" ? "" : Number(e.target.value) })} placeholder="0.00" className={fieldInput} />
                    </Field>
                    <Field htmlFor={`${id}-price`} label="Price">
                      <div id={`${id}-price`} className="rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm font-semibold text-zinc-900 tabular-nums">
                        {formatPeso((Number(item.quantity) || 0) * (Number(item.unitPrice) || 0))}
                      </div>
                    </Field>

                    <Field htmlFor={`${id}-invoice`} label="Invoice #">
                      <input
                        id={`${id}-invoice`}
                        maxLength={100}
                        value={item.invoice_number}
                        onChange={(e) => updateItem(index, { invoice_number: e.target.value })}
                        placeholder="e.g., 588597"
                        className={fieldInput}
                      />
                    </Field>

                    <div className="sm:col-span-2">
                      <Field label="Invoice / Receipt Image">
                        {item.receiptFile ? (
                          <div className="flex items-center gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-2.5">
                            {item.receiptPreviewUrl ? (
                              <img
                                src={item.receiptPreviewUrl}
                                alt="Receipt preview"
                                className="size-12 rounded border border-zinc-200 object-cover"
                              />
                            ) : (
                              <FileText className="size-6 text-zinc-400" />
                            )}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-xs font-medium text-zinc-900">
                                {item.receiptFile.name}
                              </p>
                              <p className="text-[11px] text-zinc-400">
                                {(item.receiptFile.size / 1024).toFixed(1)} KB
                              </p>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemoveFile(index)}
                              className="cursor-pointer rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-red-600"
                              title="Remove image"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        ) : (
                          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-zinc-300 bg-white px-3 py-2.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:bg-zinc-50">
                            <ImageIcon className="size-4 text-zinc-400" />
                            <span>Attach invoice or receipt image</span>
                            <input
                              type="file"
                              accept="image/*,application/pdf"
                              className="sr-only"
                              onChange={(e) => {
                                const file = e.target.files?.[0];
                                if (file) handleFileSelect(index, file);
                              }}
                            />
                          </label>
                        )}
                      </Field>
                    </div>
                  </div>
                </div>
              );
            })}
          </section>

          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
        </form>

        <ModalFooter>
          <button
            type="button"
            disabled={busy}
            onClick={() => setOpenModal(false)}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            disabled={busy}
            className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Saving…" : "Save Purchase"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Image Preview Modal */}
      <Modal
        open={viewingReceiptUrl !== null}
        title="Invoice / Receipt"
        icon={<FileText className="size-5" />}
        onClose={() => setViewingReceiptUrl(null)}
      >
        {viewingReceiptUrl ? (
          <div className="flex flex-col items-center gap-4">
            <div className="max-h-[70vh] w-full overflow-auto rounded border border-zinc-200 bg-zinc-50 p-2">
              <img
                src={viewingReceiptUrl}
                alt="Invoice / Receipt"
                className="mx-auto max-h-[65vh] w-auto object-contain"
              />
            </div>
            <div className="flex w-full justify-end">
              <a
                href={viewingReceiptUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline"
              >
                <ExternalLink className="size-3.5" /> Open original in new tab
              </a>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}
