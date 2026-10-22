"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths, revalidateReports } from "@/lib/projects/revalidate";
import { listMaterialPurchases } from "./purchases";
import { validatePurchaseLines } from "./purchases-model";

export async function loadMaterialPurchases(projectId: number) {
  if (!(await requireProjectAccess(projectId))) throw new Error("Project access denied.");
  return listMaterialPurchases(projectId);
}

export async function saveMaterialPurchase(projectId: number, form: FormData) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "Project access denied." };

    const date = String(form.get("date") ?? "").trim();
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      return { error: "Enter a valid purchase date." };
    }

    const itemsCount = Number(form.get("itemsCount") ?? 0);
    const client = await createClient();
    const batchId = crypto.randomUUID();

    if (itemsCount > 0) {
      const rawItems: { supplier: string; invoice: string; material_name: string; unit: string; quantity: number; received_quantity: number; unit_price: number }[] = [];

      for (let i = 0; i < itemsCount; i++) {
        const supplier = String(form.get(`item_${i}_supplier`) ?? "").trim();
        const materialName = String(form.get(`item_${i}_material`) ?? "").trim();
        const unit = String(form.get(`item_${i}_unit`) ?? "").trim();
        const quantity = Number(form.get(`item_${i}_quantity`) ?? 0);
        const unitPrice = Number(form.get(`item_${i}_unitPrice`) ?? 0);
        const price = Number(form.get(`item_${i}_price`) ?? 0);
        const invoice = String(form.get(`item_${i}_invoice`) ?? "").trim();
        if (!supplier || supplier.length > 200 || invoice.length > 100) return { error: "Enter a valid supplier and invoice reference." };
        if (!Number.isFinite(price) || price <= 0 || price > 1e9 || Math.abs(price * 100 - Math.round(price * 100)) > 0.001) return { error: "Enter a valid positive Price with up to 2 decimal places." };
        rawItems.push({ supplier, invoice, material_name: materialName, unit, quantity, received_quantity: quantity, unit_price: unitPrice });
      }
      const lines = validatePurchaseLines(rawItems);

      // Handle file uploads for each item
      const insertRows = [];
      for (let i = 0; i < lines.length; i++) {
        const item = lines[i];
        let receiptUrl = "";
        let receiptPath = "";

        const file = form.get(`item_${i}_receipt`);
        if (file && typeof file === "object" && "size" in file && file.size > 0) {
          const fileObj = file as File;
          const ext =
            fileObj.type === "application/pdf"
              ? "pdf"
              : fileObj.type === "image/png"
              ? "png"
              : fileObj.type === "image/webp"
              ? "webp"
              : "jpg";
          const path = `${projectId}/${crypto.randomUUID()}.${ext}`;

          try {
            const buffer = Buffer.from(await fileObj.arrayBuffer());
            const { error: uploadError } = await client.storage
              .from("purchase-receipts")
              .upload(path, buffer, {
                contentType: fileObj.type || "image/jpeg",
                upsert: false,
              });

            if (!uploadError) {
              receiptPath = path;
              const { data: pubData } = client.storage
                .from("purchase-receipts")
                .getPublicUrl(path);
              receiptUrl = pubData.publicUrl;
            }
          } catch (storageErr) {
            console.error("Storage upload failed, continuing with purchase record:", storageErr);
          }
        }

        insertRows.push({
          project_id: projectId,
          batch_id: batchId,
          line_number: i + 1,
          purchase_date: date,
          supplier: rawItems[i].supplier,
          invoice_number: rawItems[i].invoice,
          material_name: item.material_name,
          unit: item.unit,
          quantity: item.quantity,
          unit_price: item.unit_price,
          received_quantity: item.received_quantity,
          price_amount: Number(form.get(`item_${i}_price`) ?? 0),
          receipt_url: receiptUrl,
          receipt_path: receiptPath,
          recorded_by: profile.id,
        });
      }

      const { error } = await client.from("material_purchases").insert(insertRows);
      if (error) {
        console.error("[saveMaterialPurchase] Insert failed:", error);
        // If receipt_url column doesn't exist yet, retry without receipt columns for resilience
        if (error.message?.includes("receipt_url") || error.code === "42703") {
          const fallbackRows = insertRows.map(({ receipt_url: _url, receipt_path: _path, ...rest }) => rest);
          const { error: retryError } = await client.from("material_purchases").insert(fallbackRows);
          if (retryError) {
            console.error("[saveMaterialPurchase] Fallback insert failed:", retryError);
            return {
              error: retryError.message?.includes("price_amount")
                ? "Could not save the purchase because migration 0091 has not been applied. Run migration 0091 and try again."
                : "Could not save purchases. Check migrations 0085, 0090, and 0091, then try again.",
            };
          }
        } else {
          return {
            error:
              error.code === "23505"
                ? "This submission was already recorded. Refresh the purchases list."
                : error.message?.includes("price_amount")
                  ? "Could not save the purchase because migration 0091 has not been applied. Run migration 0091 and try again."
                  : "Could not save purchases. Check migrations 0085, 0090, and 0091, then try again.",
          };
        }
      }

      revalidateProjectPaths(projectId);
      revalidateReports();
      return { success: true };
    }

    // Legacy JSON lines fallback
    const supplier = String(form.get("supplier") ?? "").trim();
    const invoice = String(form.get("invoice") ?? "").trim();
    const batch = String(form.get("batch") ?? batchId);
    if (!supplier || supplier.length > 200 || invoice.length > 100) {
      return { error: "Enter a valid date, supplier and invoice reference." };
    }
    const lines = validatePurchaseLines(JSON.parse(String(form.get("lines") ?? "[]")));
    const { error } = await client.from("material_purchases").insert(
      lines.map((line, i) => ({
        ...line,
        project_id: projectId,
        batch_id: batch,
        line_number: i + 1,
        purchase_date: date,
        supplier,
        invoice_number: invoice,
        recorded_by: profile.id,
      }))
    );
    if (error) {
      return {
        error:
          error.code === "23505"
            ? "This submission was already recorded. Refresh the purchases list."
            : "Could not save purchases. Check migration 0085 and try again.",
      };
    }

    revalidateProjectPaths(projectId);
    revalidateReports();
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not save purchase." };
  }
}

export async function deleteMaterialPurchase(projectId: number, id: number) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "Project access denied." };

    const client = await createClient();
    const { error } = await client
      .from("material_purchases")
      .delete()
      .eq("id", id)
      .eq("project_id", projectId);

    if (error) {
      return { error: "Could not delete purchase record." };
    }

    revalidateProjectPaths(projectId);
    revalidateReports();
    return { success: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not delete purchase." };
  }
}

export async function updateMaterialReceipt(
  projectId: number,
  id: number,
  received: number,
  previous: number
) {
  if (!(await requireProjectAccess(projectId))) return { error: "Project access denied." };
  if (
    !Number.isFinite(received) ||
    received < 0 ||
    Math.abs(received * 1000 - Math.round(received * 1000)) > 0.001
  ) {
    return { error: "Enter a nonnegative received quantity with up to 3 decimal places." };
  }
  const client = await createClient();
  const { data, error } = await client
    .from("material_purchases")
    .update({ received_quantity: received })
    .eq("id", id)
    .eq("project_id", projectId)
    .eq("received_quantity", previous)
    .select("id");
  if (error || !data?.length) {
    return {
      error:
        "Could not update receipt. It may have changed, or the quantity exceeds the purchase. Refresh and retry.",
    };
  }
  revalidateProjectPaths(projectId);
  return { success: true };
}
