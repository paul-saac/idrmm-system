import { createClient } from "@/lib/supabase/server";
import type { MaterialPurchase } from "./purchases-model";

export async function listMaterialPurchases(projectId: number): Promise<MaterialPurchase[]> {
  try {
    const client = await createClient();
    const rows: MaterialPurchase[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await client
        .from("material_purchases")
        .select("*")
        .eq("project_id", projectId)
        .order("id", { ascending: false })
        .range(from, from + 999);
      if (error) {
        console.error("Could not load material purchases:", error);
        return rows;
      }
      rows.push(...(data ?? []).map((row) => ({ ...row, amount: Number(row.price_amount ?? row.amount) })));
      if (!data || data.length < 1000) return rows;
    }
  } catch (err) {
    console.error("Failed to load material purchases:", err);
    return [];
  }
}
