"use server";

import { requireProjectAccess } from "@/lib/auth/project-access";
import { revalidateProjectPaths, revalidateReports } from "@/lib/projects/revalidate";
import { createClient } from "@/lib/supabase/server";
import {
  ISSUE_TYPE_LABELS,
  PUNCH_ISSUE_TYPES,
  PUNCH_PRIORITIES,
  PUNCH_STATUSES,
  type PunchIssueType,
  type PunchPriority,
  type PunchStatus,
} from "./punch-list-model";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const text = (form: FormData, name: string, max: number) => String(form.get(name) ?? "").trim().slice(0, max);

async function uploadEvidence(client: Awaited<ReturnType<typeof createClient>>, projectId: number, file: FormDataEntryValue | null) {
  if (!(file instanceof File) || file.size === 0) return null;
  const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
  const allowedVideoTypes = ["video/mp4", "video/webm", "video/quicktime"];
  const allowedTypes = [...allowedImageTypes, ...allowedVideoTypes];
  if (file.size > 50 * 1024 * 1024 || !allowedTypes.includes(file.type)) {
    throw new Error("Evidence must be an image (JPG, PNG, WebP) or video (MP4, WebM, MOV) up to 50 MB.");
  }
  const extensionMap: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
  };
  const extension = extensionMap[file.type] || "bin";
  const path = `${projectId}/${crypto.randomUUID()}.${extension}`;
  const { error } = await client.storage.from("punch-list-evidence").upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error("Could not upload punch-list evidence. Check migration 0092 and try again.");
  return { path, url: client.storage.from("punch-list-evidence").getPublicUrl(path).data.publicUrl };
}

export async function savePunchItem(projectId: number, form: FormData) {
  try {
    const profile = await requireProjectAccess(projectId);
    if (!profile) return { error: "Project access denied." };
    const client = await createClient();
    const itemId = Number(form.get("itemId") ?? 0);
    const description = text(form, "description", 5000);
    const area = text(form, "area", 120);
    const specificLocation = text(form, "specificLocation", 500);
    const relatedWorkKey = text(form, "relatedWorkKey", 80);
    const relatedWorkName = text(form, "relatedWorkName", 200);
    const responsibleTrade = text(form, "responsibleTrade", 200);
    const correctionNotes = text(form, "correctionNotes", 5000);
    const verificationNotes = text(form, "verificationNotes", 5000);
    const issueType = String(form.get("issueType") ?? "") as PunchIssueType;
    const priority = String(form.get("priority") ?? "") as PunchPriority;
    const status = String(form.get("status") ?? "") as PunchStatus;
    const identifiedOn = String(form.get("identifiedOn") ?? "");
    const dueDate = String(form.get("dueDate") ?? "");
    const assignedTo = String(form.get("assignedTo") ?? "").trim() || null;
    const title = ISSUE_TYPE_LABELS[issueType] || text(form, "title", 200) || "Punch item";

    if (!description || !area) return { error: "Enter the issue description and area." };
    if (!PUNCH_ISSUE_TYPES.includes(issueType) || !PUNCH_PRIORITIES.includes(priority) || !PUNCH_STATUSES.includes(status)) return { error: "Select valid issue, priority, and status values." };
    if (!datePattern.test(identifiedOn) || (dueDate && (!datePattern.test(dueDate) || dueDate < identifiedOn))) return { error: "Enter valid identification and due dates." };

    const { data: project, error: projectError } = await client.from("projects")
      .select("project_manager_id, foreman_id").eq("id", projectId).single();
    if (projectError || !project) return { error: "Could not verify the project assignment." };
    if (assignedTo && ![project.project_manager_id, project.foreman_id].includes(assignedTo)) return { error: "Assign the item to this project's PM or foreman." };

    let existing: { before_photo_url: string; before_photo_path: string; after_photo_url: string; after_photo_path: string } | null = null;
    if (itemId > 0) {
      const result = await client.from("project_punch_items")
        .select("before_photo_url, before_photo_path, after_photo_url, after_photo_path")
        .eq("id", itemId).eq("project_id", projectId).maybeSingle();
      if (result.error || !result.data) return { error: "Punch-list item not found." };
      existing = result.data;
    }

    const [beforeUpload, afterUpload] = await Promise.all([
      uploadEvidence(client, projectId, form.get("beforePhoto")),
      uploadEvidence(client, projectId, form.get("afterPhoto")),
    ]);
    const values = {
      title,
      description,
      area,
      specific_location: specificLocation,
      related_work_key: relatedWorkKey,
      related_work_name: relatedWorkName,
      issue_type: issueType,
      priority,
      status,
      responsible_trade: responsibleTrade,
      assigned_to: assignedTo,
      identified_on: identifiedOn,
      due_date: dueDate || null,
      correction_notes: correctionNotes,
      verification_notes: verificationNotes,
      before_photo_url: beforeUpload?.url ?? existing?.before_photo_url ?? "",
      before_photo_path: beforeUpload?.path ?? existing?.before_photo_path ?? "",
      after_photo_url: afterUpload?.url ?? existing?.after_photo_url ?? "",
      after_photo_path: afterUpload?.path ?? existing?.after_photo_path ?? "",
      ...(status === "closed"
        ? {
            resolved_at: new Date().toISOString(),
            verified_at: new Date().toISOString(),
            verified_by: profile.id,
          }
        : {
            resolved_at: null,
            verified_at: null,
            verified_by: null,
          }),
    };

    const result = itemId > 0
      ? await client.from("project_punch_items").update(values).eq("id", itemId).eq("project_id", projectId)
      : await client.from("project_punch_items").insert({ ...values, project_id: projectId, identified_by: profile.id });
    if (result.error) {
      console.error("[savePunchItem]", result.error);
      return { error: "Could not save the punch-list item. Check migration 0092 and try again." };
    }
    revalidateReports();
    revalidateProjectPaths(projectId);
    return { success: true };
  } catch (cause) {
    return { error: cause instanceof Error ? cause.message : "Could not save the punch-list item." };
  }
}
