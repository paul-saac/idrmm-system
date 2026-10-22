import { createClient } from "@/lib/supabase/server";
import type { MaterialPurchase } from "./purchases-model";
export async function listMaterialPurchases(projectId: number): Promise<MaterialPurchase[]> {
  const client = await createClient();
  const rows: MaterialPurchase[] = [];
  for (let from = 0; ; from += 1000) {
    const {data,error} = await client.from("material_purchases").select("*").eq("project_id",projectId)
      .order("id",{ascending:false}).range(from,from+999);
    if (error) throw new Error("Could not load material purchases. Apply migration 0085 and retry.");
    rows.push(...data.map((row) => ({ ...row, amount: Number(row.price_amount ?? row.amount) })));
    if (data.length < 1000) return rows;
  }
}
