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
