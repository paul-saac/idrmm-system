"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { readSheetMetadata, type Sheet } from "./model";
import { revalidateProjectPaths } from "@/lib/projects/revalidate";

async function access(projectId: number) {
  const profile = await getSessionProfile();
  if (!profile || !Number.isSafeInteger(projectId) || projectId <= 0) throw new Error("Project access denied.");
  const client = await createClient();
  const { data, error } = await client.from("projects").select("id,foreman_id,project_manager_id").eq("id", projectId).maybeSingle();
  if (error || !data || (!isAdminRole(profile.role) && !(profile.role === "foreman" && data.foreman_id === profile.id) && !(profile.role === "project_manager" && data.project_manager_id === profile.id))) throw new Error("Project access denied.");
  return { client, profile };
}
const message = (e: unknown) => e instanceof Error ? e.message : "The operation failed. Please try again.";

export async function listSheets(projectId: number) {
  try {
    const { client, profile } = await access(projectId);
    const { data, error } = await client.from("project_sheets").select("*").eq("project_id", projectId).order("created_at", { ascending: false });
    if (error) throw new Error(["42P01", "PGRST205"].includes(error.code) ? "Sheets is not enabled yet. Apply migration 0077 in Supabase." : "Could not load sheets.");
    return { sheets: data ?? [], canReview: isAdminRole(profile.role), error: null };
  } catch (e) { return { sheets: [], canReview: false, error: message(e) }; }
}

async function validateFile(file: FormDataEntryValue | null, required: boolean): Promise<File | null> {
  if (!(file instanceof File) || !file.size) { if (required) throw new Error("Choose a drawing file."); return null; }
  if (file.size > 8 * 1024 * 1024) throw new Error("Each file must be 8 MB or smaller.");
  const bytes = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const valid = file.type === "application/pdf" ? new TextDecoder().decode(bytes).startsWith("%PDF-") : file.type === "image/png" ? bytes.slice(0,8).join(",") === "137,80,78,71,13,10,26,10" : file.type === "image/jpeg" && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!valid) throw new Error("Upload a valid PDF, PNG, or JPEG file.");
  return file;
}

export async function submitSheet(projectId: number, form: FormData) {
  try {
    const { client, profile } = await access(projectId);
    const metadata = readSheetMetadata(form);
    const drawing = (await validateFile(form.get("drawing"), true))!;
    const evidence = form.get("signed_document") === "on" ? drawing : await validateFile(form.get("evidence"), false);
    if ((evidence || metadata.external_name || metadata.external_role || metadata.approval_date) && !(evidence && metadata.external_name && metadata.external_role && metadata.approval_date)) throw new Error("Supply the professional's name, role, approval date, and evidence together, or leave all four blank for a pending submission.");
    const paths: string[] = [];
    const upload = async (file: File) => {
      const ext = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
      const path = `${projectId}/${profile.id}/${crypto.randomUUID()}.${ext}`;
      const { error } = await client.storage.from("project-sheets").upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw new Error("Could not upload file. Check that Sheets migration 0077 has been applied, then retry.");
      paths.push(path); return path;
    };
    try {
      const file_path = await upload(drawing);
      const evidence_path = evidence === drawing ? file_path : evidence ? await upload(evidence) : null;
      const { error } = await client.from("project_sheets").insert({ ...metadata, project_id: projectId, revision: 1, file_path, file_name: drawing.name.slice(0, 255), evidence_path, status: "submitted", submitted_by: profile.id, submitted_name: `${profile.firstName} ${profile.lastName}` });
      if (error) throw new Error(error.code === "P0001" ? error.message : "Could not save the sheet. Please retry.");
    } catch (e) { if (paths.length) await client.storage.from("project-sheets").remove(paths); throw e; }
    revalidateProjectPaths(projectId); return { success: true, error: null };
  } catch (e) { return { success: false, error: message(e) }; }
}

export async function reviewSheet(projectId: number, sheetId: number, status: Sheet["status"], notes: string, expectedReview: string | null) {
  try {
    const { client, profile } = await access(projectId);
    if (!isAdminRole(profile.role)) throw new Error("Only administrators can review submissions.");
    if (!["accepted", "changes_requested", "rejected"].includes(status) || !notes.trim() || notes.length > 2000) throw new Error("Choose a decision and enter review comments (up to 2,000 characters).");
    let query = client.from("project_sheets").update({ status, review_notes: notes.trim() }).eq("id", sheetId).eq("project_id", projectId);
    query = expectedReview ? query.eq("reviewed_at", expectedReview) : query.is("reviewed_at", null);
    const { data, error } = await query.select("id");
    if (error) throw new Error(error.code === "P0001" ? error.message : "Could not save the review.");
    if (!data?.length) throw new Error("This sheet changed. Close and reopen it before reviewing.");
    revalidateProjectPaths(projectId); return { error: null };
  } catch (e) { return { error: message(e) }; }
}

export async function sheetDetails(projectId: number, sheetId: number) {
  try {
    const { client } = await access(projectId);
    const { data: sheet, error } = await client.from("project_sheets").select("*").eq("id", sheetId).eq("project_id", projectId).single();
    if (error || !sheet) throw new Error("Sheet not found or access denied.");
    const sign = async (path: string) => {
      const { data, error } = await client.storage.from("project-sheets").createSignedUrl(path, 300, { download: true });
      if (error) throw new Error("Could not open the file. Please retry."); return data.signedUrl;
    };
    const [drawingUrl, evidenceUrl, history] = await Promise.all([sign(sheet.file_path), sheet.evidence_path ? sign(sheet.evidence_path) : null, client.from("project_sheet_reviews").select("*").eq("sheet_id", sheetId).order("created_at", { ascending: false })]);
    if (history.error) throw new Error("Could not load review history.");
    return { sheet, drawingUrl, evidenceUrl, reviews: history.data ?? [], error: null };
  } catch (e) { return { sheet: null, drawingUrl: null, evidenceUrl: null, reviews: [], error: message(e) }; }
}
