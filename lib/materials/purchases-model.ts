export type MaterialPurchase = {
  id: number;
  project_id: number;
  batch_id: string;
  line_number: number;
  purchase_date: string;
  supplier: string;
  invoice_number: string;
  material_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  received_quantity: number;
  amount: number;
  price_amount?: number;
  receipt_url?: string | null;
  receipt_path?: string | null;
  recorded_by: string;
  created_at: string;
};

export type PurchaseLine = Pick<
  MaterialPurchase,
  "material_name" | "unit" | "quantity" | "unit_price" | "received_quantity"
>;

export type MaterialPurchaseItemInput = {
  particular: string;
  description: string;
  price: number;
  invoice_number?: string;
  receipt_url?: string;
  receipt_path?: string;
};

export function stockBalance(opening: number, received: number, used: number) {
  return Math.round((opening + received - used) * 1000) / 1000;
}

export function validateMaterialPurchaseItems(items: unknown): MaterialPurchaseItemInput[] {
  if (!Array.isArray(items) || !items.length || items.length > 100) {
    throw new Error("Enter between 1 and 100 purchase items.");
  }
  return items.map((row) => {
    const particular = String(row?.particular ?? "").trim();
    const description = String(row?.description ?? "").trim();
    const price = Number(row?.price);
    const invoiceNumber = String(row?.invoice_number ?? "").trim();
    const receiptUrl = String(row?.receipt_url ?? "").trim();
    const receiptPath = String(row?.receipt_path ?? "").trim();

    if (!particular || particular.length > 200) {
      throw new Error("Enter a valid Particular (1-200 characters).");
    }
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      price > 1e9 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.001
    ) {
      throw new Error("Enter a valid positive price with up to 2 decimal places.");
    }
    if (description.length > 500) {
      throw new Error("Description must not exceed 500 characters.");
    }
    if (invoiceNumber.length > 100) {
      throw new Error("Invoice # must not exceed 100 characters.");
    }

    return {
      particular,
      description,
      price,
      invoice_number: invoiceNumber,
      receipt_url: receiptUrl,
      receipt_path: receiptPath,
    };
  });
}

export function validatePurchaseLines(value: unknown): PurchaseLine[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) {
    throw new Error("Enter between 1 and 100 material items.");
  }
  return value.map((row) => {
    const name = String(row?.material_name ?? "").trim();
    const unit = String(row?.unit ?? "").trim();
    const quantity = Number(row?.quantity);
    const price = Number(row?.unit_price);
    const received = Number(row?.received_quantity);
    if (
      !name ||
      name.length > 200 ||
      !unit ||
      unit.length > 40 ||
      ![quantity, price, received].every(Number.isFinite) ||
      quantity <= 0 ||
      price < 0 ||
      received < 0 ||
      received > quantity ||
      quantity > 1e9 ||
      price > 1e9 ||
      Math.abs(quantity * 1000 - Math.round(quantity * 1000)) > 0.001 ||
      Math.abs(received * 1000 - Math.round(received * 1000)) > 0.001 ||
      Math.abs(price * 100 - Math.round(price * 100)) > 0.001
    ) {
      throw new Error(
        "Enter a material, unit, positive quantity, nonnegative price, and received quantity between zero and purchased quantity. Use up to 3 quantity decimals and 2 price decimals."
      );
    }
    return {
      material_name: name,
      unit,
      quantity,
      unit_price: price,
      received_quantity: received,
    };
  });
}

export type MaterialStockStatus = "available" | "low_stock" | "out_of_stock" | "over_issued";

/**
 * Company stock-warning policy: 5% of the balance after the latest receipt.
 * Consumption does not reset this reference; the next receipt does.
 */
export const LOW_STOCK_THRESHOLD_PERCENT = 0.05;

// Counted items/containers use whole-unit warning levels. Measured and custom
// units retain the exact percentage rather than guessing their divisibility.
const WHOLE_MATERIAL_UNITS = new Set([
  "pc", "pcs", "piece", "pieces", "no", "nos", "number", "numbers", "ea", "each",
  "set", "sets", "lot", "lots", "bag", "bags", "box", "boxes", "roll", "rolls",
  "sheet", "sheets", "length", "lengths", "pair", "pairs", "unit", "units",
  "pack", "packs", "bundle", "bundles",
]);

export function getMaterialLowStockThreshold(referenceQuantity: number, unit = ""): number {
  if (referenceQuantity <= 0) return 0;
  const wholeUnit = WHOLE_MATERIAL_UNITS.has(unit.trim().toLowerCase().replace(/\.+$/, ""));
  if (!wholeUnit) return referenceQuantity * LOW_STOCK_THRESHOLD_PERCENT;
  if (referenceQuantity <= 1) return 0; // One available item is sufficient; zero is out of stock.
  // Quantities have three decimal places. Integer scaling avoids rounding an
  // exact whole-number threshold up again because of floating-point noise.
  return Math.ceil(Math.round(referenceQuantity * 1000) / 20000);
}

export function getMaterialStockStatus(
  received: number,
  used: number,
  referenceQuantity = received,
  unit = ""
): {
  status: MaterialStockStatus;
  balance: number;
  label: string;
  badgeStyle: string;
} {
  const balance = Math.round((received - used) * 1000) / 1000;

  if (balance < 0) {
    return {
      status: "over_issued",
      balance,
      label: "Over-issued",
      badgeStyle: "bg-red-50 text-red-600",
    };
  }

  if (balance === 0) {
    return {
      status: "out_of_stock",
      balance,
      label: "Out of stock",
      badgeStyle: "bg-red-50 text-red-600",
    };
  }

  const threshold = getMaterialLowStockThreshold(referenceQuantity, unit);
  const isLowStock = threshold > 0 && balance <= threshold;

  if (isLowStock) {
    return {
      status: "low_stock",
      balance,
      label: "Low stock",
      badgeStyle: "bg-amber-50 text-amber-700",
    };
  }

  return {
    status: "available",
    balance,
    label: "Available",
    badgeStyle: "bg-emerald-50 text-emerald-700",
  };
}

export type MaterialStockItem = {
  key: string;
  name: string;
  unit: string;
  purchased: number;
  received: number;
  used: number;
  balance: number;
  status: MaterialStockStatus;
  statusLabel: string;
  badgeStyle: string;
  lastReceived: string | null;
  lastUsed: string | null;
  /** Stock after the latest dated receipt, before that day's usage. */
  referenceQuantity?: number;
  lowStockThreshold?: number;
};

export function computeMaterialStocks(
  purchases: readonly MaterialPurchase[],
  usage: readonly { materialName: string; unit: string | null; quantity: number; entryDate: string }[]
): MaterialStockItem[] {
  const byKey = new Map<
    string,
    {
      key: string;
      name: string;
      unit: string;
      purchased: number;
      received: number;
      used: number;
      lastReceived: string | null;
      lastUsed: string | null;
      usageByDate: Map<string, number>;
    }
  >();

  for (const row of purchases) {
    const name = (row.material_name ?? "").trim();
    if (!name) continue;
    const unit = row.unit ?? "";
    const key = `${name.toLowerCase()}:${unit.toLowerCase()}`;
    let item = byKey.get(key);
    if (!item) {
      item = {
        key,
        name,
        unit,
        purchased: 0,
        received: 0,
        used: 0,
        lastReceived: null,
        lastUsed: null,
        usageByDate: new Map(),
      };
      byKey.set(key, item);
    }
    const qty = Number(row.quantity) || 0;
    const rQty = Number(row.received_quantity ?? row.quantity) || 0;
    item.purchased += qty;
    item.received += rQty;
    if (rQty > 0 && (!item.lastReceived || row.purchase_date > item.lastReceived)) {
      item.lastReceived = row.purchase_date;
    }
  }

  for (const entry of usage) {
    const name = (entry.materialName ?? "").trim();
    if (!name) continue;
    const unit = entry.unit ?? "";
    const key = `${name.toLowerCase()}:${unit.toLowerCase()}`;
    let item = byKey.get(key);
    if (!item) {
      item = {
        key,
        name,
        unit,
        purchased: 0,
        received: 0,
        used: 0,
        lastReceived: null,
        lastUsed: null,
        usageByDate: new Map(),
      };
      byKey.set(key, item);
    }
    item.used += Number(entry.quantity) || 0;
    item.usageByDate.set(entry.entryDate, (item.usageByDate.get(entry.entryDate) ?? 0) + (Number(entry.quantity) || 0));
    if (!item.lastUsed || entry.entryDate > item.lastUsed) {
      item.lastUsed = entry.entryDate;
    }
  }

  return [...byKey.values()]
    .map((item) => {
      // All received quantities are part of the stock as of its latest receipt.
      // Subtract only usage before that date to reconstruct the replenished
      // balance (100%). Daily logs do not establish intraday receipt order:
      // same-date receipts are grouped before that day's consumption.
      const usedBeforeReceipt = [...item.usageByDate].reduce((total, [date, quantity]) =>
        item.lastReceived && date < item.lastReceived ? total + quantity : total, 0);
      const referenceQuantity = Math.max(0, stockBalance(0, item.received, usedBeforeReceipt));
      const { status, balance, label, badgeStyle } = getMaterialStockStatus(
        item.received,
        item.used,
        referenceQuantity,
        item.unit
      );
      const { usageByDate: _usageByDate, ...stock } = item;
      return {
        ...stock,
        referenceQuantity,
        lowStockThreshold: getMaterialLowStockThreshold(referenceQuantity, item.unit),
        balance,
        status,
        statusLabel: label,
        badgeStyle,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function summarizeMaterialStocks(stocks: readonly MaterialStockItem[]): {
  totalMaterials: number;
  availableMaterials: number;
  lowStockMaterials: number;
  outOfStockMaterials: number;
} {
  let available = 0;
  let lowStock = 0;
  let outOfStock = 0;

  for (const item of stocks) {
    if (item.status === "available") {
      available++;
    } else if (item.status === "low_stock") {
      lowStock++;
    } else {
      outOfStock++;
    }
  }

  return {
    totalMaterials: stocks.length,
    availableMaterials: available,
    // The "Low Stock Materials" overview card reflects low stocks and out of stocks / over-issued
    lowStockMaterials: lowStock + outOfStock,
    outOfStockMaterials: outOfStock,
  };
}
