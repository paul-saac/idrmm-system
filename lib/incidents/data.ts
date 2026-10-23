import "server-only";

import { createClient } from "@/lib/supabase/server";
import type { Incident, IncidentAttachment } from "./model";

export async function listProjectIncidents(
  projectId: number
): Promise<{ items: Incident[]; available: boolean }> {
  try {
    const client = await createClient();
    const { data, error } = await client
      .from("project_safety_incidents")
      .select("*")
      .eq("project_id", projectId)
      .order("occurred_on", { ascending: false })
      .order("occurred_time", { ascending: false })
      .order("id", { ascending: false });

    if (error) return { items: [], available: false };

    const items = await Promise.all(
      (data ?? []).map(async row => {
        const attachments = (Array.isArray(row.attachments) ? row.attachments : []) as IncidentAttachment[];
        const resolved = await Promise.all(
          attachments.map(async attachment => {
            if (!attachment.path?.startsWith(`${projectId}/`)) return { ...attachment, url: null };
            const { data: signed } = await client.storage
              .from("incident-evidence")
              .createSignedUrl(attachment.path, 3600, { download: attachment.name });
            return { ...attachment, url: signed?.signedUrl ?? null };
          })
        );
        return { ...row, attachments: resolved } as Incident;
      })
    );

    return { items, available: true };
  } catch {
    return { items: [], available: false };
  }
}
