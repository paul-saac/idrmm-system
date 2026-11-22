"use server";

import { after } from "next/server";
import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { INCIDENT_TYPES, INCIDENT_SEVERITIES, validateIncidentFiles, isIncidentDate, parseIncidentDetails, validateIncidentCloseout, type Incident, type IncidentAttachment } from "./model";

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
  date?: string | null
): Promise<{ items: Incident[]; error?: string }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(context.id) || context.id <= 0 || !await requireProjectAccess(projectId, "view")) {
    return { items: [], error: "Incident records are not available." };
  }
  const client = await createClient();
  const targetDate = date === null ? null : date ?? manilaTimestamp().date;
  let query = client.from("project_safety_incidents").select("*")
    .eq("project_id", projectId);
  if (targetDate) query = query.eq("log_date", targetDate);
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
        [...attachments, ...(row.closeout?.attachments ?? [])].map(async (att) => {
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
        attachments: resolved.slice(0, attachments.length),
        ...(row.closeout ? {closeout: {...row.closeout, attachments: resolved.slice(attachments.length)}} : {}),
      } as Incident;
    })
  );
  return { items };
}

export async function listTaskIncidents(projectId:number,context:{kind:"task"|"category";id:number}) {
  return listTodayIncidents(projectId,context,null);
}

export const listIncidentsForDate = listTodayIncidents;

export async function reportIncident(projectId: number, form: FormData): Promise<{ error?: string; id?: number }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0) return { error: "Select a valid project." };
  const profile = await requireProjectAccess(projectId);
  if (!profile) return { error: "You do not have access to report an incident for this project." };
  const client = await createClient();
  const offlineId = String(form.get("offlineSubmissionId") ?? "");
  if (offlineId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(offlineId)) return { error: "Invalid offline report identity." };
  if (offlineId) {
    const { data, error } = await client.from("project_safety_incidents").select("id").eq("reported_by", profile.id).eq("offline_submission_id", offlineId).maybeSingle();
    if (error) return { error: "Offline incident synchronization is unavailable. Ask your administrator to apply migration 0149." };
    if (data) return { id: data.id };
  }
  const uploaded: string[] = [];
  try {
    let type = String(form.get("incidentType") ?? "") as Incident["incident_type"];
    const severity = String(form.get("severity") ?? "") as Incident["severity"];
    const reported = manilaTimestamp();
    const occurred = {date:String(form.get("occurredOn") ?? reported.date),time:String(form.get("occurredTime") ?? reported.time)};
    if(!isIncidentDate(occurred.date)||occurred.date>reported.date||!/^([01]\d|2[0-3]):[0-5]\d$/.test(occurred.time))return {error:"Enter a valid incident date and time. Future dates are not allowed."};
    const rawDetails=form.get("details");
    const details=typeof rawDetails==="string" ? parseIncidentDetails(rawDetails) : undefined;
    if(details)type=details.kinds.find(kind=>Object.hasOwn(INCIDENT_TYPES,kind)) as Incident["incident_type"] ?? "other";
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
      ...(offlineId ? { offline_submission_id: offlineId } : {}),
      project_id: projectId, task_id: kind === "task" ? contextId : null, category_id: kind === "category" ? contextId : null,
      log_date: occurred.date, incident_type: type, severity, occurred_on: occurred.date, occurred_time: occurred.time,
      location, description, attachments, reported_by: profile.id, ...(details ? {details} : {}),
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
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(id) || id <= 0 || !await requireProjectAccess(projectId, "view")) return { error: "Incident not available." };
  const client = await createClient();
  const { data, error } = await client.from("project_safety_incidents").select("*").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (error || !data) return { error: "This incident could not be loaded." };
  const evidence = await Promise.all(data.attachments.map(async attachment => {
    if (!attachment.path.startsWith(`${projectId}/`)) return { ...attachment, url: null };
    const { data: signed } = await client.storage.from("incident-evidence").createSignedUrl(attachment.path, 300, { download: attachment.name });
    return { ...attachment, url: signed?.signedUrl ?? null };
  }));
  const closeoutEvidence = await Promise.all((data.closeout?.attachments ?? []).map(async attachment => {
    if (!attachment.path.startsWith(`${projectId}/`)) return { ...attachment, url: null };
    const { data: signed } = await client.storage.from("incident-evidence").createSignedUrl(attachment.path, 300, { download: attachment.name });
    return { ...attachment, url: signed?.signedUrl ?? null };
  }));
  return { incident: { ...data, ...(data.closeout ? {closeout: {...data.closeout, attachments: closeoutEvidence}} : {}) }, evidence };
}

export async function deleteIncident(projectId: number, id: number): Promise<{ success?: true; error?: string }> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(id) || id <= 0 || !await requireProjectAccess(projectId)) {
    return { error: "You do not have access to delete this incident." };
  }
  const client = await createClient();
  const { data: incident, error: loadError } = await client.from("project_safety_incidents")
    .select("attachments, closeout").eq("id", id).eq("project_id", projectId).maybeSingle();
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

  const paths = [...incident.attachments, ...(incident.closeout?.attachments ?? [])]
    .map(attachment => attachment.path)
    .filter(path => path.startsWith(`${projectId}/`));
  if (paths.length) {
    after(async () => {
      try {
        const { error } = await client.storage.from("incident-evidence").remove(paths);
        if (error) console.error("[deleteIncident:evidence]", error);
      } catch (error) { console.error("[deleteIncident:evidence]", error); }
    });
  }
  return { success: true };
}


/** Only project managers and administrators may verify and close an incident. */
export async function closeIncident(projectId: number, id: number, form: FormData): Promise<{incident?: Incident; error?: string}> {
  if (!Number.isSafeInteger(projectId) || projectId <= 0 || !Number.isSafeInteger(id) || id <= 0) return {error: "Select a valid incident."};
  const profile = await requireProjectAccess(projectId, "edit");
  if (!profile || !["project_manager", "admin", "super_admin"].includes(profile.role)) return {error: "Only the Project Manager or Administrator can close this incident."};
  const findings = String(form.get("findings") ?? "").trim();
  const actionTaken = String(form.get("actionTaken") ?? "").trim();
  const invalid = validateIncidentCloseout(findings, actionTaken);
  if (invalid) return {error: invalid};
  const files = form.getAll("attachments").filter((value): value is File => value instanceof File && value.size > 0);
  const fileError = validateIncidentFiles(files);
  if (fileError) return {error: fileError};
  const client = await createClient();
  const {data: existing, error: readError} = await client.from("project_safety_incidents").select("id, closeout").eq("id", id).eq("project_id", projectId).maybeSingle();
  if (readError || !existing) return {error: "This incident could not be loaded."};
  if (existing.closeout) return {error: "This incident has already been closed."};
  const uploaded: string[] = [];
  const attachments: IncidentAttachment[] = [];
  try {
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const validSignature = file.type === "application/pdf" ? bytes.subarray(0, 5).toString() === "%PDF-"
        : file.type === "image/png" ? bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
      if (!validSignature) throw new Error("One attachment is not a valid JPG, PNG, or PDF file.");
      const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const path = `${projectId}/${profile.id}/${crypto.randomUUID()}.${ext}`;
      const {error} = await client.storage.from("incident-evidence").upload(path, bytes, {contentType: file.type, upsert: false});
      if (error) throw new Error("Could not upload the supporting attachment. Please try again.");
      uploaded.push(path); attachments.push({path, name: file.name.slice(0, 200), type: file.type, size: file.size});
    }
    const {data, error} = await client.rpc("close_safety_incident", {p_project_id: projectId, p_incident_id: id, p_findings: findings, p_action_taken: actionTaken, p_attachments: attachments});
    if (error || !data) throw new Error(error?.code === "P0001" ? error.message : "Could not close this incident. Please try again.");
    // Return the committed record immediately. Signed previews are refreshed separately.
    after(async () => { const {revalidateReports} = await import("@/lib/projects/revalidate"); revalidateReports(); });
    return {incident: data};
  } catch (cause) {
    if (uploaded.length) await client.storage.from("incident-evidence").remove(uploaded);
    return {error: cause instanceof Error ? cause.message : "Could not close this incident. Please try again."};
  }
}
