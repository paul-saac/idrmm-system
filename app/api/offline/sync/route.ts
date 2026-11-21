import type { NextRequest } from "next/server";
import { getSessionProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { syncProjectStatusFromProgress } from "@/lib/projects/sync";
import { revalidateProjectLists, revalidateProjectPaths } from "@/lib/projects/revalidate";
import { sameOfflineOrigin, offlineHeaders as headers } from "@/lib/offline/http";
import { validOfflineSubmission } from "@/lib/offline/validate";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  if (!sameOfflineOrigin(request) || !request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Invalid synchronization request." }, { status: 403, headers });
  const profile = await getSessionProfile();
  if (!profile) return Response.json({ error: "Sign in again to synchronize." }, { status: 401, headers });
  // Bound the streamed body as well as Content-Length; never accept an unbounded upload.
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: "Missing daily log." }, { status: 400, headers });
  let size = 0, text = "";
  try {
    const decoder = new TextDecoder();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length;
      if (size > 1024 * 1024) { await reader.cancel(); return Response.json({ error: "Daily log is too large." }, { status: 413, headers }); }
      text += decoder.decode(chunk.value, { stream: true }); }
    text += decoder.decode();
    const submission: unknown = JSON.parse(text);
    if (!validOfflineSubmission(submission)) return Response.json({ error: "Check the saved daily log fields and work date." }, { status: 400, headers });
    if (submission.ownerId !== profile.id) return Response.json({ error: "Sign in with the account that recorded this offline entry." }, { status: 403, headers });
    const db = await createClient();
    const { data, error } = await db.rpc("synchronize_offline_progress", {
      p_id: submission.id, p_owner: submission.ownerId, p_project_id: submission.projectId,
      p_kind: submission.kind, p_item_id: submission.itemId, p_work_date: submission.workDate,
      p_captured_at: submission.capturedAt, p_expected_version: submission.expectedVersion, p_input: submission.input,
    });
    if (error) {
      const status = error.code === "40001" ? 409 : error.code === "42501" ? 403 : error.code === "22023" || error.code === "22P02" || error.code === "23514" ? 422 : 503;
      return Response.json({ error: status === 503 ? "Synchronization is temporarily unavailable. Your offline entry is still saved on this device." : error.message }, { status, headers });
    }
    await syncProjectStatusFromProgress(submission.projectId);
    revalidateProjectPaths(submission.projectId); revalidateProjectLists();
    return Response.json(data, { headers });
  } catch (error) {
    if (error instanceof SyntaxError) return Response.json({ error: "The saved daily log could not be read. Review its details before retrying." }, { status: 400, headers });
    return Response.json({ error: "Could not confirm synchronization. The saved entry can be retried safely." }, { status: 503, headers });
  }
}
