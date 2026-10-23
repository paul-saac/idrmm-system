"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { INCIDENT_TYPES, INCIDENT_SEVERITIES, validateIncidentFiles, type Incident, type IncidentAttachment } from "./model";

function manilaTimestamp(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Manila", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

export async function listTodayIncidents(
  projectId: number,
  context: { kind: "task" | "category"; id: number },
  date?: string
): Promise<{ items: Incident[]; error?: string }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(context.id) || context.id <= 0 || !await requireProjectAccess(projectId)) {
    return { items: [], error: "Incident records are not available." };
  }
  const client = await createClient();
  const targetDate = date ?? manilaTimestamp().date;
  let query = client.from("project_safety_incidents").select("*")
    .eq("project_id", projectId).eq("log_date", targetDate);
  query = query.eq(context.kind === "task" ? "task_id" : "category_id", context.id);
  const { data, error } = await query.order("created_at", { ascending: false });
  if (error) {
    console.error("[listTodayIncidents]", error);
    return { items: [], error: ["42P01", "PGRST205"].includes(error.code)
      ? "Apply migration 0096 to load incident reports."
      : "Could not load incident reports." };
  }
  const items: Incident[] = await Promise.all(
    (data ?? []).map(async (row) => {
      const attachments = (Array.isArray(row.attachments) ? row.attachments : []) as IncidentAttachment[];
      const resolved = await Promise.all(
        attachments.map(async (att) => {
          if (!att.path || !att.path.startsWith(`${projectId}/`)) {
            return { ...att, url: null };
          }
          const { data: signed } = await client.storage
            .from("incident-evidence")
            .createSignedUrl(att.path, 3600, { download: att.name });
          return { ...att, url: signed?.signedUrl ?? null };
        })
      );
      return {
        ...row,
        attachments: resolved,
      } as Incident;
    })
  );
  return { items };
}

export const listIncidentsForDate = listTodayIncidents;

export async function reportIncident(projectId: number, form: FormData): Promise<{ error?: string; id?: number }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return { error: "Select a valid project." };
  const profile = await requireProjectAccess(projectId);
  if (!profile) return { error: "You do not have access to report an incident for this project." };
  const client = await createClient();
  const uploaded: string[] = [];
  try {
    const type = String(form.get("incidentType") ?? "") as Incident["incident_type"];
    const severity = String(form.get("severity") ?? "") as Incident["severity"];
    const occurred = manilaTimestamp();
    const location = String(form.get("location") ?? "").trim();
    const description = String(form.get("description") ?? "").trim();
    if (!Object.hasOwn(INCIDENT_TYPES, type) || !Object.hasOwn(INCIDENT_SEVERITIES, severity)) return { error: "Select an incident type and severity." };
    if (!description || description.length > 5000) return { error: "Describe what happened using up to 5,000 characters." };
    if (location.length > 300) return { error: "Keep the location within 300 characters." };
    const kind = String(form.get("contextKind") ?? "");
    const contextId = Number(form.get("contextId"));
    if (!["task", "category"].includes(kind) || !Number.isSafeInteger(contextId) || contextId <= 0) return { error: "Reopen the progress log before reporting this incident." };
    const { data: context, error: contextError } = await client.from(kind === "task" ? "estimate_tasks" : "estimate_categories")
      .select("id").eq("id", contextId).eq("project_id", projectId).maybeSingle();
    if (contextError || !context) return { error: "The linked work could not be verified for this project." };
    const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
    const fileError = validateIncidentFiles(files);
    if (fileError) return { error: fileError };

    // Check storage availability before uploading any evidence.
    const { error: schemaError } = await client.from("project_safety_incidents").select("id").eq("project_id", projectId).limit(1);
    if (schemaError) {
      console.error("[reportIncident]", schemaError);
      return { error: ["42P01", "PGRST205"].includes(schemaError.code)
        ? "Incident reporting is not set up yet. Apply migration 0096 in Supabase, then try again."
        : "Could not access incident records. Please try again." };
    }
    const attachments: IncidentAttachment[] = [];
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const validSignature = file.type === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
        : file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!validSignature) throw new Error("One attachment is not a valid JPG, PNG, or PDF file.");
      const extension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const path = `${projectId}/${profile.id}/${crypto.randomUUID()}.${extension}`;
      const { error } = await client.storage.from("incident-evidence").upload(path, bytes, { contentType: file.type, upsert: false });
      if (error) { console.error("[reportIncident:upload]", error); throw new Error("Could not upload the evidence. Please try again."); }
      uploaded.push(path);
      attachments.push({ path, name: file.name.slice(0, 200), type: file.type, size: file.size });
    }
    const { data, error } = await client.from("project_safety_incidents").insert({
      project_id: projectId, task_id: kind === "task" ? contextId : null, category_id: kind === "category" ? contextId : null,
      log_date: occurred.date, incident_type: type, severity, occurred_on: occurred.date, occurred_time: occurred.time,
      location, description, attachments, reported_by: profile.id,
    }).select("id").single();
    if (error) { console.error("[reportIncident:save]", error); throw new Error("Could not submit the incident. Your progress entries have not changed. Please try again."); }
    // No progress mutation or route refresh: preserve the unsaved progress draft.
    return { id: data.id };
  } catch (cause) {
    if (uploaded.length) {
      const { error } = await client.storage.from("incident-evidence").remove(uploaded);
      if (error) console.error("[reportIncident:cleanup]", error);
    }
    return { error: cause instanceof Error ? cause.message : "Could not submit the incident. Please try again." };
  }
}

export async function loadIncident(projectId: number, id: number) {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(id) || id <= 0 || !await requireProjectAccess(projectId)) return { error: "Incident not available." };
  const client = await createClient();
  const { data, error } = await client.from("project_safety_incidents").select("*").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error || !data) return { error: "This incident could not be loaded." };
  const evidence = await Promise.all(data.attachments.map(async attachment => {
    if (!attachment.path.startsWith(`${projectId}/`)) return { ...attachment, url: null };
    const { data: signed } = await client.storage.from("incident-evidence").createSignedUrl(attachment.path, 300, { download: attachment.name });
    return { ...attachment, url: signed?.signedUrl ?? null };
  }));
  return { incident: data, evidence };
}

export async function deleteIncident(projectId: number, id: number): Promise<{ success?: true; error?: string }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(id) || id <= 0 || !await requireProjectAccess(projectId)) {
    return { error: "You do not have access to delete this incident." };
  }
  const client = await createClient();
  const { data: incident, error: loadError } = await client.from("project_safety_incidents")
    .select("attachments").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (loadError) {
    console.error("[deleteIncident:load]", loadError);
    return { error: "Could not load this incident for deletion." };
  }
  if (!incident) return { error: "This incident no longer exists." };

  const { error: deleteError } = await client.from("project_safety_incidents")
    .delete().eq("id", id).eq("project_id", projectId);
  if (deleteError) {
    console.error("[deleteIncident:delete]", deleteError);
    return { error: ["42501", "PGRST301"].includes(deleteError.code)
      ? "Apply migration 0097 in Supabase, then try again."
      : "Could not delete this incident. Please try again." };
  }

  const paths = (incident.attachments as IncidentAttachment[])
    .map(attachment => attachment.path)
    .filter(path => path.startsWith(`${projectId}/`));
  if (paths.length) {
    const { error } = await client.storage.from("incident-evidence").remove(paths);
    if (error) console.error("[deleteIncident:evidence]", error);
  }
  return { success: true };
}
