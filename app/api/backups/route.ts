import { getBackupStatus } from "@/lib/backups/actions";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try { return Response.json(await getBackupStatus(), { headers: { "Cache-Control": "private, no-store" } }); }
  catch { return Response.json({ error: "Backup access denied." }, { status: 403 }); }
}
