import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import { Readable } from "node:stream";
import { getBackupStatus } from "@/lib/backups/actions";
import { artifactPath, backupConfig, hashFile, UUID } from "@/lib/backups/package.mjs";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const profile = await getSessionProfile();
  if (profile?.role !== "super_admin") return Response.json({ error: "Backup access denied." }, { status: 403 });
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ error: "Backup not found." }, { status: 404 });
  try {
    // This independent database check also protects downloads if the caller's
    // role is changed between the page load and the request.
    await getBackupStatus();
    const client = await createClient();
    const { data, error } = await client.rpc("system_backup_status");
    const snapshot = !error && (data as unknown as { snapshots: { id: string; artifact_sha256: string }[] })?.snapshots.find(item => item.id === id);
    if (!snapshot) return Response.json({ error: "Backup not found." }, { status: 404 });
    const file = artifactPath(backupConfig().directory, id);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || await hashFile(file) !== snapshot.artifact_sha256) return Response.json({ error: "Backup integrity verification failed." }, { status: 409 });
    return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { headers: {
      "Content-Type": "application/octet-stream", "Content-Length": String(info.size),
      "Content-Disposition": `attachment; filename="IDRMM-backup-${id}.idrmm"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch { return Response.json({ error: "The backup file is unavailable on this server. Check the shared backup directory." }, { status: 503 }); }
}
