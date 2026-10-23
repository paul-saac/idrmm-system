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
 * Recommended threshold for low stock in construction management:
 * - 20% remaining threshold: warns when inventory reaches 20% or less of total received supply.
 * - 5 units absolute threshold: catches smaller count items when used > 0 and balance <= 5.
 */
export const LOW_STOCK_THRESHOLD_PERCENT = 0.20;
export const LOW_STOCK_ABSOLUTE_THRESHOLD = 5;

export function getMaterialStockStatus(
  received: number,
  used: number
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
      badgeStyle: "bg-zinc-100 text-zinc-600",
    };
  }

  const isLowStock =
    (received > 0 && balance / received <= LOW_STOCK_THRESHOLD_PERCENT) ||
    (used > 0 && balance <= LOW_STOCK_ABSOLUTE_THRESHOLD);

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
      };
      byKey.set(key, item);
    }
    item.used += Number(entry.quantity) || 0;
    if (!item.lastUsed || entry.entryDate > item.lastUsed) {
      item.lastUsed = entry.entryDate;
    }
  }

  return [...byKey.values()]
    .map((item) => {
      const { status, balance, label, badgeStyle } = getMaterialStockStatus(
        item.received,
        item.used
      );
      return {
        ...item,
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
