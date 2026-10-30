import { createClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";

export async function GET() {
  const client = await createClient();
  const { data, error } = await client.rpc("system_backup_maintenance");
  if (error && !["PGRST202", "42883"].includes(error.code)) return Response.json({ error: "Maintenance status unavailable." }, { status: 503 });
  return Response.json({ maintenance: data === true }, { headers: { "Cache-Control": "private, no-store" } });
}
