"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";
import { deriveMaterialRequestStatus } from "@/lib/material-requests/status";
import { deriveEquipmentRequestStatus } from "@/lib/equipment-requests/status";
import { syncProjectStatusFromProgress } from "@/lib/projects/sync";
import { nextMaterialCode } from "@/lib/materials/codes";
import { listFlaggedEntryIds, type EntryType } from "@/lib/daily-logs/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { getProjectProgress } from "@/lib/progress/data";

export type DailyLogActionState = {
  error?: string;
  success?: boolean;
};

export type FlagActionState = {
  error?: string;
  success?: boolean;
};

function parseNumber(value: FormDataEntryValue | null) {
  const num = Number(String(value ?? "0").trim());
  return Number.isFinite(num) ? num : 0;
}

/**
 * An entry's own attachments can't fit the flat one-value-per-entry
 * parallel-array convention below (there can be zero, one, or several
 * files per entry) — so the client sends a `${prefix}Count` field per
 * entry (how many files it contributed) alongside a single flat
 * `${prefix}` field carrying every entry's files back to back, and this
 * re-chunks that flat list back into per-entry groups using the counts.
 */
function readAttachmentGroups(
  formData: FormData,
  countField: string,
  fileField: string
): File[][] {
  const counts = formData.getAll(countField).map((v) => Number(v) || 0);
  const allFiles = formData.getAll(fileField);
  const groups: File[][] = [];
  let cursor = 0;
  for (const count of counts) {
    const slice = allFiles.slice(cursor, cursor + count);
    cursor += count;
    groups.push(
      slice.filter((f): f is File => f instanceof File && f.size > 0)
    );
  }
  return groups;
}

/**
 * Reads the repeated per-work-item fields off the form. Every draft work
 * log added in the client (across possibly several open/close cycles of
 * the Add Work Log form) is appended as its own set of
 * workItemCategoryId/workItemTaskId/... entries sharing those names, so
 * the i-th value of each lines up with the i-th of every other — same
 * convention as Cost Estimate's Other Cost Items. Attachments ride along
 * separately (see readAttachmentGroups), since an entry can have more
 * than one.
 */
function buildWorkItemDrafts(formData: FormData) {
  const categoryIds = formData.getAll("workItemCategoryId");
  const taskIds = formData.getAll("workItemTaskId");
  const quantities = formData.getAll("workItemQuantity");
  const units = formData.getAll("workItemUnit");
  const activities = formData.getAll("workItemActivity");
  const attachmentGroups = readAttachmentGroups(
    formData,
    "workItemAttachmentCount",
    "workItemAttachment"
  );

  const drafts: {
    categoryId: number;
    taskId: number;
    quantityCompleted: number;
    unit: string;
    activity: string;
    attachments: File[];
  }[] = [];

  for (let i = 0; i < categoryIds.length; i++) {
    drafts.push({
      categoryId: Number(categoryIds[i]),
      taskId: Number(taskIds[i]),
      quantityCompleted: parseNumber(quantities[i] ?? null),
      unit: String(units[i] ?? "").trim(),
      activity: String(activities[i] ?? "").trim(),
      attachments: attachmentGroups[i] ?? [],
    });
  }

  return drafts;
}

/**
 * Same repeated-field convention as buildWorkItemDrafts, for the Labor
 * Logs fields added in the Add Daily Log modal.
 */
function buildLaborItemDrafts(formData: FormData) {
  const workerRoles = formData.getAll("laborWorkerRole");
  const workerCounts = formData.getAll("laborWorkerCount");
  const dailyRates = formData.getAll("laborDailyRate");
  const otHours = formData.getAll("laborOtHours");
  const rendersOvertime = formData.getAll("laborRendersOvertime");
  const rendersHalfday = formData.getAll("laborRendersHalfday");
  const remarksList = formData.getAll("laborRemarks");
  const attachmentGroups = readAttachmentGroups(
    formData,
    "laborAttachmentCount",
    "laborAttachment"
  );

  const drafts: {
    workerRole: string;
    workerCount: number;
    dailyRate: number;
    otHours: number;
    workersRenderedOvertime: number;
    workersRenderedHalfday: number;
    remarks: string;
    attachments: File[];
  }[] = [];

  for (let i = 0; i < workerRoles.length; i++) {
    drafts.push({
      workerRole: String(workerRoles[i] ?? "").trim(),
      workerCount: parseNumber(workerCounts[i] ?? null),
      dailyRate: parseNumber(dailyRates[i] ?? null),
      otHours: parseNumber(otHours[i] ?? null),
      workersRenderedOvertime: parseNumber(rendersOvertime[i] ?? null),
      workersRenderedHalfday: parseNumber(rendersHalfday[i] ?? null),
      remarks: String(remarksList[i] ?? "").trim(),
      attachments: attachmentGroups[i] ?? [],
    });
  }

  return drafts;
}

/**
 * Same repeated-field convention as buildWorkItemDrafts, for the Other
 * Expense fields added in the Add Daily Log modal.
 */
function buildExpenseItemDrafts(formData: FormData) {
  const categories = formData.getAll("expenseCategory");
  const amounts = formData.getAll("expenseAmount");
  const additionalFees = formData.getAll("expenseAdditionalFees");
  const descriptions = formData.getAll("expenseDescription");
  const remarksList = formData.getAll("expenseRemarks");
  const attachmentGroups = readAttachmentGroups(
    formData,
    "expenseAttachmentCount",
    "expenseAttachment"
  );

  const drafts: {
    expenseCategory: string;
    amount: number;
    additionalFees: number;
    description: string;
    remarks: string;
    attachments: File[];
  }[] = [];

  for (let i = 0; i < categories.length; i++) {
    drafts.push({
      expenseCategory: String(categories[i] ?? "").trim(),
      amount: parseNumber(amounts[i] ?? null),
      additionalFees: parseNumber(additionalFees[i] ?? null),
      description: String(descriptions[i] ?? "").trim(),
      remarks: String(remarksList[i] ?? "").trim(),
      attachments: attachmentGroups[i] ?? [],
    });
  }

  return drafts;
}

/**
 * Same repeated-field convention as buildWorkItemDrafts, for the
 * Material Usage fields added in the Add Daily Log modal. No attachment
 * — the reference design for this log type doesn't have one.
 */
function buildMaterialUsageDrafts(formData: FormData) {
  const projectMaterialIds = formData.getAll("usageProjectMaterialId");
  const statuses = formData.getAll("usageStatus");
  const activities = formData.getAll("usageActivity");
  const remarksList = formData.getAll("usageRemarks");

  const drafts: {
    projectMaterialId: number;
    status: string;
    activity: string;
    remarks: string;
  }[] = [];

  for (let i = 0; i < projectMaterialIds.length; i++) {
    drafts.push({
      projectMaterialId: Number(projectMaterialIds[i]),
      status: String(statuses[i] ?? "").trim(),
      activity: String(activities[i] ?? "").trim(),
      remarks: String(remarksList[i] ?? "").trim(),
    });
  }

  return drafts;
}

type ProcurementItemInput = {
  materialRequestItemId: number | null;
  materialName: string;
  specification: string;
  quantity: number;
  unit: string;
  cost: number;
};

/**
 * Same repeated-field convention as buildWorkItemDrafts, for the
 * Material Procurement fields added in the Add Daily Log modal — except
 * each procurement entry's own item list can't fit the flat parallel-
 * array shape (that only handles one value per entry, not a nested
 * list), so it rides along as one JSON string per entry instead, same
 * escape hatch as lib/material-requests/actions.ts's readItems.
 */
function buildProcurementDrafts(formData: FormData) {
  const types = formData.getAll("procurementType");
  const suppliers = formData.getAll("procurementSupplier");
  const materialRequestIds = formData.getAll("procurementMaterialRequestId");
  const additionalFees = formData.getAll("procurementAdditionalFees");
  const remarksList = formData.getAll("procurementRemarks");
  const attachmentGroups = readAttachmentGroups(
    formData,
    "procurementAttachmentCount",
    "procurementAttachment"
  );
  const itemsJsonList = formData.getAll("procurementItemsJson");

  const drafts: {
    procurementType: string;
    supplierName: string;
    materialRequestId: number | null;
    additionalFees: number;
    remarks: string;
    attachments: File[];
    items: ProcurementItemInput[];
  }[] = [];

  for (let i = 0; i < types.length; i++) {
    const materialRequestIdRaw = String(materialRequestIds[i] ?? "").trim();

    let items: ProcurementItemInput[] = [];
    try {
      const parsed = JSON.parse(String(itemsJsonList[i] ?? "[]"));
      if (Array.isArray(parsed)) {
        items = parsed.map((item) => {
          const record = item as Record<string, unknown>;
          return {
            materialRequestItemId:
              record.materialRequestItemId != null &&
              Number.isFinite(Number(record.materialRequestItemId))
                ? Number(record.materialRequestItemId)
                : null,
            materialName: String(record.materialName ?? "").trim(),
            specification: String(record.specification ?? "").trim(),
            quantity: parseNumber(record.quantity as FormDataEntryValue | null),
            unit: String(record.unit ?? "").trim(),
            cost: parseNumber(record.cost as FormDataEntryValue | null),
          };
        });
      }
    } catch {
      items = [];
    }

    drafts.push({
      procurementType: String(types[i] ?? "").trim(),
      supplierName: String(suppliers[i] ?? "").trim(),
      materialRequestId: materialRequestIdRaw
        ? Number(materialRequestIdRaw)
        : null,
      additionalFees: parseNumber(additionalFees[i] ?? null),
      remarks: String(remarksList[i] ?? "").trim(),
      attachments: attachmentGroups[i] ?? [],
      items: items.filter((item) => item.materialName.length > 0),
    });
  }

  return drafts;
}

/**
 * Same repeated-field convention as buildWorkItemDrafts, for the
 * Equipment Acquisition fields added in the Add Daily Log modal. Unlike
 * Material Procurement, an acquisition entry is always exactly one piece
 * of equipment (see 0021_daily_log_equipment_acquisition.sql) — no
 * nested items list, so this stays a flat parallel-array reader.
 */
function buildEquipmentAcquisitionDrafts(formData: FormData) {
  const equipmentRequestIds = formData.getAll("acqEquipmentRequestId");
  const equipmentRequestItemIds = formData.getAll("acqEquipmentRequestItemId");
  const equipmentNames = formData.getAll("acqEquipmentName");
  const specifications = formData.getAll("acqSpecification");
  const quantities = formData.getAll("acqQuantity");
  const types = formData.getAll("acqType");
  const amounts = formData.getAll("acqAmount");
  const remarksList = formData.getAll("acqRemarks");
  const attachmentGroups = readAttachmentGroups(
    formData,
    "acqAttachmentCount",
    "acqAttachment"
  );

  const drafts: {
    equipmentRequestId: number | null;
    equipmentRequestItemId: number | null;
    equipmentName: string;
    specification: string;
    quantity: number;
    acquisitionType: string;
    amount: number;
    remarks: string;
    attachments: File[];
  }[] = [];

  for (let i = 0; i < equipmentNames.length; i++) {
    const requestIdRaw = String(equipmentRequestIds[i] ?? "").trim();
    const requestItemIdRaw = String(equipmentRequestItemIds[i] ?? "").trim();
    drafts.push({
      equipmentRequestId: requestIdRaw ? Number(requestIdRaw) : null,
      equipmentRequestItemId: requestItemIdRaw ? Number(requestItemIdRaw) : null,
      equipmentName: String(equipmentNames[i] ?? "").trim(),
      specification: String(specifications[i] ?? "").trim(),
      quantity: parseNumber(quantities[i] ?? null),
      acquisitionType: String(types[i] ?? "").trim(),
      amount: parseNumber(amounts[i] ?? null),
      remarks: String(remarksList[i] ?? "").trim(),
      attachments: attachmentGroups[i] ?? [],
    });
  }

  return drafts;
}

function parseSurveyOccurred(
  value: FormDataEntryValue | null
): boolean | null {
  const raw = String(value ?? "");
  if (raw === "true") return true;
  if (raw === "false") return false;
  return null;
}

/**
 * Same repeated-field convention as buildWorkItemDrafts, for a
 * project's Survey questions (daily_log_survey_questions) — one row per
 * question the modal showed, in the same order every time since the
 * modal builds this list off the same listSurveyQuestions read that
 * ordered it by sort_order. Every project's questions (including the
 * three every project starts with — see seedDefaultSurveyQuestions)
 * answer into daily_log_survey_answers this same way; there's no
 * separate "fixed question" path anymore (see
 * 0034_daily_log_survey_defaults.sql).
 */
function buildSurveyAnswerDrafts(formData: FormData) {
  const questionIds = formData.getAll("surveyQuestionId");
  const occurredValues = formData.getAll("surveyOccurred");
  const notesValues = formData.getAll("surveyNotes");

  const drafts: { questionId: number; occurred: boolean | null; notes: string | null }[] =
    [];
  for (let i = 0; i < questionIds.length; i++) {
    drafts.push({
      questionId: Number(questionIds[i]),
      occurred: parseSurveyOccurred(occurredValues[i] ?? null),
      notes: String(notesValues[i] ?? "").trim() || null,
    });
  }
  return drafts;
}

/**
 * Seeds a freshly-created project with the same three Survey questions
 * every project has always asked (accidents/schedule delays/weather
 * delays — see 0011_daily_log_survey.sql's original three fixed
 * columns, folded into this dynamic table by
 * 0034_daily_log_survey_defaults.sql). An admin can rename, reorder, or
 * delete them afterward like any other question via the Survey
 * Questions settings modal — this only sets the starting point.
 * affects_delay_risk marks the two that feed the Delay Risk
 * Assessment's "Delay Reports (30d)" stat (see countRecentDelayIncidents
 * in lib/forecasting/data.ts); accidents doesn't affect it, matching
 * the original fixed-column behavior.
 */
export async function seedDefaultSurveyQuestions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { error } = await supabase.from("daily_log_survey_questions").insert([
    {
      project_id: projectId,
      question_text: "Any accidents on site today?",
      is_required: true,
      sort_order: 0,
      affects_delay_risk: false,
    },
    {
      project_id: projectId,
      question_text: "Any schedule delays occur?",
      is_required: true,
      sort_order: 1,
      affects_delay_risk: true,
    },
    {
      project_id: projectId,
      question_text: "Did weather cause any delays?",
      is_required: true,
      sort_order: 2,
      affects_delay_risk: true,
    },
  ]);
  if (error) {
    // The project itself already saved successfully — don't fail project
    // creation over its starter Survey questions, just leave a trail;
    // an admin can always add them by hand via the settings modal.
    console.error(
      "[seedDefaultSurveyQuestions] Supabase insert failed:",
      error.message
    );
  }
}

export async function createDailyLog(
  projectId: number,
  _prevState: DailyLogActionState,
  formData: FormData
): Promise<DailyLogActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to submit daily logs." };
  }

  const logDate = String(formData.get("logDate") ?? "").trim();
  if (!logDate) {
    return { error: "Select a date for this log." };
  }

  const workItems = buildWorkItemDrafts(formData);
  for (const item of workItems) {
    if (!item.categoryId || !item.taskId) {
      return {
        error: "Every work log needs a category and a work item selected.",
      };
    }
  }

  const laborItems = buildLaborItemDrafts(formData);
  for (const item of laborItems) {
    if (!item.workerRole) {
      return { error: "Every labor log needs a worker role." };
    }
  }

  const expenseItems = buildExpenseItemDrafts(formData);
  for (const item of expenseItems) {
    if (!item.expenseCategory) {
      return { error: "Every expense log needs an expense category." };
    }
  }

  const materialUsageItems = buildMaterialUsageDrafts(formData);
  for (const item of materialUsageItems) {
    if (!item.projectMaterialId || !item.status) {
      return {
        error: "Every material usage log needs a material and a usage status.",
      };
    }
  }

  const procurementLogs = buildProcurementDrafts(formData);
  for (const log of procurementLogs) {
    if (log.items.length === 0) {
      return {
        error: "Every material procurement log needs at least one item.",
      };
    }
  }

  const equipmentAcquisitionLogs = buildEquipmentAcquisitionDrafts(formData);
  for (const log of equipmentAcquisitionLogs) {
    if (!log.equipmentName) {
      return {
        error: "Every equipment acquisition log needs an equipment name.",
      };
    }
  }

  const supabase = await createClient();

  // Quantity Completed can't exceed a task's estimated quantity from the
  // Cost Estimate Breakdown — checked here, not just in the client form,
  // since the form's validation is a UX convenience, not the real
  // boundary (a crafted request could skip it entirely).
  const taskIds = Array.from(new Set(workItems.map((item) => item.taskId)));
  if (taskIds.length > 0) {
    const { data: taskRows } = await supabase
      .from("estimate_tasks")
      .select("id, task_name, estimated_quantity, unit")
      .in("id", taskIds);

    const taskById = new Map((taskRows ?? []).map((task) => [task.id, task]));

    for (const item of workItems) {
      const task = taskById.get(item.taskId);
      if (task && item.quantityCompleted > (task.estimated_quantity ?? 0)) {
        return {
          error: `Quantity completed for "${task.task_name}" can't exceed its estimated quantity (${task.estimated_quantity}${task.unit ? ` ${task.unit}` : ""}).`,
        };
      }
    }
  }

  // One daily log per project per date (see 0019_daily_logs_one_per_day
  // migration). Check up front so the user gets a clear message instead
  // of a raw unique-constraint failure — the modal routes them to edit
  // the existing log for that date instead.
  const { data: existing } = await supabase
    .from("daily_logs")
    .select("id")
    .eq("project_id", projectId)
    .eq("log_date", logDate)
    .maybeSingle();

  if (existing) {
    return {
      error:
        "A daily log already exists for this date. Open it from the Daily Logs list to add or remove entries.",
    };
  }

  const { data: dailyLog, error: dailyLogError } = await supabase
    .from("daily_logs")
    .insert({
      project_id: projectId,
      submitted_by: profile.id,
      log_date: logDate,
      status: "pending",
    })
    .select("id")
    .single();

  if (dailyLogError || !dailyLog) {
    console.error(
      "[createDailyLog] Supabase daily_logs insert failed:",
      dailyLogError
    );
    return { error: "Could not submit the daily log. Please try again." };
  }

  const entriesError = await insertDailyLogEntries(supabase, projectId, dailyLog.id, {
    workItems,
    laborItems,
    expenseItems,
    materialUsageItems,
    procurementLogs,
    equipmentAcquisitionLogs,
  });
  if (entriesError) return { error: entriesError };

  const surveyAnswers = buildSurveyAnswerDrafts(formData);
  if (surveyAnswers.length > 0) {
    const { error: surveyError } = await supabase
      .from("daily_log_survey_answers")
      .insert(
        surveyAnswers.map((answer) => ({
          daily_log_id: dailyLog.id,
          question_id: answer.questionId,
          occurred: answer.occurred,
          notes: answer.notes,
        }))
      );
    if (surveyError) {
      // The log itself already saved successfully — don't fail the whole
      // submission over the Survey answers, just leave a trail.
      console.error(
        "[createDailyLog] survey answers insert failed:",
        surveyError.message
      );
    }
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}

type DailyLogDrafts = {
  workItems: ReturnType<typeof buildWorkItemDrafts>;
  laborItems: ReturnType<typeof buildLaborItemDrafts>;
  expenseItems: ReturnType<typeof buildExpenseItemDrafts>;
  materialUsageItems: ReturnType<typeof buildMaterialUsageDrafts>;
  procurementLogs: ReturnType<typeof buildProcurementDrafts>;
  equipmentAcquisitionLogs: ReturnType<typeof buildEquipmentAcquisitionDrafts>;
};

/**
 * Writes every entry type into its table for one daily log — shared by
 * createDailyLog (fresh log) and updateDailyLog (which clears the log's
 * entries first, then re-inserts). Attachment uploads that fail are
 * logged and skipped rather than aborting the whole write, same as
 * before. Returns an error string on a row-write failure, undefined on
 * success.
 */
async function insertDailyLogEntries(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number,
  dailyLogId: number,
  drafts: DailyLogDrafts
): Promise<string | undefined> {
  async function uploadAttachments(
    prefix: string,
    files: File[]
  ): Promise<string[]> {
    const paths: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const path = `${projectId}/${dailyLogId}/${prefix}${Date.now()}-${i}-${file.name}`;
      const { error } = await supabase.storage
        .from("daily-log-attachments")
        .upload(path, file);
      if (error) {
        console.error("[insertDailyLogEntries] Storage upload failed:", error.message);
        continue;
      }
      paths.push(path);
    }
    return paths;
  }

  for (const item of drafts.workItems) {
    const attachmentPaths = await uploadAttachments("", item.attachments);
    const { error } = await supabase.from("daily_log_work_items").insert({
      daily_log_id: dailyLogId,
      category_id: item.categoryId,
      task_id: item.taskId,
      quantity_completed: item.quantityCompleted,
      unit: item.unit || null,
      activity: item.activity || null,
      attachment_paths: attachmentPaths,
    });
    if (error) {
      console.error("[insertDailyLogEntries] work item insert failed:", error.message);
      return "One of the work logs could not be saved. Please try again.";
    }
  }

  for (const item of drafts.laborItems) {
    const attachmentPaths = await uploadAttachments("labor-", item.attachments);
    const { error } = await supabase.from("daily_log_labor_items").insert({
      daily_log_id: dailyLogId,
      worker_role: item.workerRole,
      worker_count: item.workerCount,
      daily_rate: item.dailyRate,
      ot_hours: item.otHours,
      workers_rendered_overtime: item.workersRenderedOvertime,
      workers_rendered_halfday: item.workersRenderedHalfday,
      remarks: item.remarks || null,
      attachment_paths: attachmentPaths,
    });
    if (error) {
      console.error("[insertDailyLogEntries] labor item insert failed:", error.message);
      return "One of the labor logs could not be saved. Please try again.";
    }
  }

  for (const item of drafts.expenseItems) {
    const attachmentPaths = await uploadAttachments("expense-", item.attachments);
    const { error } = await supabase.from("daily_log_expense_items").insert({
      daily_log_id: dailyLogId,
      expense_category: item.expenseCategory,
      amount: item.amount,
      additional_fees: item.additionalFees,
      description: item.description || null,
      remarks: item.remarks || null,
      attachment_paths: attachmentPaths,
    });
    if (error) {
      console.error("[insertDailyLogEntries] expense item insert failed:", error.message);
      return "One of the expense logs could not be saved. Please try again.";
    }
  }

  for (const item of drafts.materialUsageItems) {
    const { error } = await supabase.from("daily_log_material_usage_items").insert({
      daily_log_id: dailyLogId,
      project_material_id: item.projectMaterialId,
      status: item.status as "available" | "low_stock" | "fully_consumed",
      activity: item.activity || null,
      remarks: item.remarks || null,
    });
    if (error) {
      console.error("[insertDailyLogEntries] usage item insert failed:", error.message);
      return "One of the material usage logs could not be saved. Please try again.";
    }
  }

  for (const log of drafts.procurementLogs) {
    const attachmentPaths = await uploadAttachments(
      "procurement-",
      log.attachments
    );
    const { data: procurement, error: procurementError } = await supabase
      .from("daily_log_material_procurement")
      .insert({
        daily_log_id: dailyLogId,
        procurement_type: log.procurementType as
          | "direct_purchase"
          | "supplier_delivery",
        supplier_name: log.supplierName || null,
        material_request_id: log.materialRequestId,
        additional_fees: log.additionalFees,
        attachment_paths: attachmentPaths,
        remarks: log.remarks || null,
      })
      .select("id")
      .single();

    if (procurementError || !procurement) {
      console.error(
        "[insertDailyLogEntries] procurement insert failed:",
        procurementError?.message
      );
      return "One of the procurement logs could not be saved. Please try again.";
    }

    const { error: procurementItemsError } = await supabase
      .from("daily_log_material_procurement_items")
      .insert(
        log.items.map((item) => ({
          procurement_id: procurement.id,
          material_request_item_id: item.materialRequestItemId,
          material_name: item.materialName,
          specification: item.specification || null,
          quantity: item.quantity,
          unit: item.unit || null,
          cost: item.cost,
        }))
      );

    if (procurementItemsError) {
      console.error(
        "[insertDailyLogEntries] procurement items insert failed:",
        procurementItemsError.message
      );
      return "One of the procurement logs could not be saved. Please try again.";
    }
  }

  for (const log of drafts.equipmentAcquisitionLogs) {
    const attachmentPaths = await uploadAttachments(
      "equipment-",
      log.attachments
    );
    const { error } = await supabase.from("daily_log_equipment_acquisition").insert({
      daily_log_id: dailyLogId,
      equipment_request_id: log.equipmentRequestId,
      equipment_request_item_id: log.equipmentRequestItemId,
      equipment_name: log.equipmentName,
      specification: log.specification || null,
      quantity: log.quantity,
      acquisition_type: log.acquisitionType as "rental" | "purchase",
      amount: log.amount,
      attachment_paths: attachmentPaths,
      remarks: log.remarks || null,
    });
    if (error) {
      console.error(
        "[insertDailyLogEntries] equipment acquisition insert failed:",
        error.message
      );
      return "One of the equipment acquisition logs could not be saved. Please try again.";
    }
  }

  return undefined;
}

/**
 * Adds entries to (and/or removes entries from) an existing daily log
 * that's still open for editing — pending or rejected. Approval locks a
 * log; an approved one can't be touched here. Resubmitting a rejected
 * log (or just adding to a pending one) puts it back to "pending" and
 * clears the previous review, so a reviewer sees it fresh.
 *
 * Individual entries are immutable once entered — this only inserts new
 * ones and deletes whole entries by id. "Edit a typo" = remove the
 * entry and add it again.
 */
export async function updateDailyLog(
  dailyLogId: number,
  projectId: number,
  _prevState: DailyLogActionState,
  formData: FormData
): Promise<DailyLogActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit daily logs." };
  }

  const supabase = await createClient();

  const { data: existingLog } = await supabase
    .from("daily_logs")
    .select("id, status")
    .eq("id", dailyLogId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (!existingLog) {
    return { error: "This daily log no longer exists." };
  }
  if (existingLog.status === "approved") {
    return {
      error: "This daily log has been approved and can no longer be edited.",
    };
  }

  const workItems = buildWorkItemDrafts(formData);
  for (const item of workItems) {
    if (!item.categoryId || !item.taskId) {
      return { error: "Every work log needs a category and a work item selected." };
    }
  }
  const laborItems = buildLaborItemDrafts(formData);
  for (const item of laborItems) {
    if (!item.workerRole) return { error: "Every labor log needs a worker role." };
  }
  const expenseItems = buildExpenseItemDrafts(formData);
  for (const item of expenseItems) {
    if (!item.expenseCategory) {
      return { error: "Every expense log needs an expense category." };
    }
  }
  const materialUsageItems = buildMaterialUsageDrafts(formData);
  for (const item of materialUsageItems) {
    if (!item.projectMaterialId || !item.status) {
      return {
        error: "Every material usage log needs a material and a usage status.",
      };
    }
  }
  const procurementLogs = buildProcurementDrafts(formData);
  for (const log of procurementLogs) {
    if (log.items.length === 0) {
      return { error: "Every material procurement log needs at least one item." };
    }
  }
  const equipmentAcquisitionLogs = buildEquipmentAcquisitionDrafts(formData);
  for (const log of equipmentAcquisitionLogs) {
    if (!log.equipmentName) {
      return { error: "Every equipment acquisition log needs an equipment name." };
    }
  }

  // Remove entries the user deleted, plus their Storage attachments.
  let removals: { workItems: number[]; laborItems: number[]; expenseItems: number[]; materialUsageItems: number[]; procurementLogs: number[]; equipmentAcquisitionLogs: number[] };
  try {
    const parsed = JSON.parse(String(formData.get("removeEntryIds") ?? "{}"));
    removals = {
      workItems: Array.isArray(parsed.workItems) ? parsed.workItems.map(Number) : [],
      laborItems: Array.isArray(parsed.laborItems) ? parsed.laborItems.map(Number) : [],
      expenseItems: Array.isArray(parsed.expenseItems) ? parsed.expenseItems.map(Number) : [],
      materialUsageItems: Array.isArray(parsed.materialUsageItems) ? parsed.materialUsageItems.map(Number) : [],
      procurementLogs: Array.isArray(parsed.procurementLogs) ? parsed.procurementLogs.map(Number) : [],
      equipmentAcquisitionLogs: Array.isArray(parsed.equipmentAcquisitionLogs) ? parsed.equipmentAcquisitionLogs.map(Number) : [],
    };
  } catch {
    removals = { workItems: [], laborItems: [], expenseItems: [], materialUsageItems: [], procurementLogs: [], equipmentAcquisitionLogs: [] };
  }

  const attachmentPaths: string[] = [];
  if (removals.workItems.length > 0) {
    const { data } = await supabase
      .from("daily_log_work_items")
      .select("attachment_paths")
      .in("id", removals.workItems);
    for (const row of data ?? []) attachmentPaths.push(...(row.attachment_paths ?? []));
    await supabase.from("daily_log_work_items").delete().in("id", removals.workItems);
  }
  if (removals.laborItems.length > 0) {
    const { data } = await supabase
      .from("daily_log_labor_items")
      .select("attachment_paths")
      .in("id", removals.laborItems);
    for (const row of data ?? []) attachmentPaths.push(...(row.attachment_paths ?? []));
    await supabase.from("daily_log_labor_items").delete().in("id", removals.laborItems);
  }
  if (removals.expenseItems.length > 0) {
    const { data } = await supabase
      .from("daily_log_expense_items")
      .select("attachment_paths")
      .in("id", removals.expenseItems);
    for (const row of data ?? []) attachmentPaths.push(...(row.attachment_paths ?? []));
    await supabase.from("daily_log_expense_items").delete().in("id", removals.expenseItems);
  }
  if (removals.materialUsageItems.length > 0) {
    await supabase
      .from("daily_log_material_usage_items")
      .delete()
      .in("id", removals.materialUsageItems);
  }
  if (removals.procurementLogs.length > 0) {
    const { data } = await supabase
      .from("daily_log_material_procurement")
      .select("attachment_paths")
      .in("id", removals.procurementLogs);
    for (const row of data ?? []) attachmentPaths.push(...(row.attachment_paths ?? []));
    // items cascade-delete with the procurement header
    await supabase
      .from("daily_log_material_procurement")
      .delete()
      .in("id", removals.procurementLogs);
  }
  if (removals.equipmentAcquisitionLogs.length > 0) {
    const { data } = await supabase
      .from("daily_log_equipment_acquisition")
      .select("attachment_paths")
      .in("id", removals.equipmentAcquisitionLogs);
    for (const row of data ?? []) attachmentPaths.push(...(row.attachment_paths ?? []));
    await supabase
      .from("daily_log_equipment_acquisition")
      .delete()
      .in("id", removals.equipmentAcquisitionLogs);
  }

  // Flags reference an entry by (entry_type, entry_id) with no FK — clean
  // up any flag left pointing at an entry just removed above, same
  // reasoning as the attachment cleanup: nothing does this automatically.
  const removedByType: [EntryType, number[]][] = [
    ["work_item", removals.workItems],
    ["labor_item", removals.laborItems],
    ["expense_item", removals.expenseItems],
    ["material_usage_item", removals.materialUsageItems],
    ["material_procurement", removals.procurementLogs],
    ["equipment_acquisition", removals.equipmentAcquisitionLogs],
  ];
  for (const [entryType, ids] of removedByType) {
    if (ids.length === 0) continue;
    await supabase
      .from("daily_log_entry_flags")
      .delete()
      .eq("entry_type", entryType)
      .in("entry_id", ids);
  }

  const entriesError = await insertDailyLogEntries(supabase, projectId, dailyLogId, {
    workItems,
    laborItems,
    expenseItems,
    materialUsageItems,
    procurementLogs,
    equipmentAcquisitionLogs,
  });
  if (entriesError) return { error: entriesError };

  const { error: statusError } = await supabase
    .from("daily_logs")
    .update({
      status: "pending",
      reviewed_by: null,
      reviewed_at: null,
    })
    .eq("id", dailyLogId);
  if (statusError) {
    console.error("[updateDailyLog] status reset failed:", statusError.message);
    return { error: "Could not save the daily log. Please try again." };
  }

  const surveyAnswers = buildSurveyAnswerDrafts(formData);
  if (surveyAnswers.length > 0) {
    const { error: surveyError } = await supabase
      .from("daily_log_survey_answers")
      .upsert(
        surveyAnswers.map((answer) => ({
          daily_log_id: dailyLogId,
          question_id: answer.questionId,
          occurred: answer.occurred,
          notes: answer.notes,
        })),
        { onConflict: "daily_log_id,question_id" }
      );
    if (surveyError) {
      console.error(
        "[updateDailyLog] survey answers upsert failed:",
        surveyError.message
      );
    }
  }

  if (attachmentPaths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("daily-log-attachments")
      .remove(attachmentPaths);
    if (storageError) {
      console.error("[updateDailyLog] Storage cleanup failed:", storageError.message);
    }
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

/**
 * The three "approval is what makes it real" syncs below were originally
 * inline in updateDailyLogStatus's approval branch, operating on
 * whichever ids that one bulk approval computed. Pulled out so
 * resolveDailyLogEntryFlag can run the exact same sync for a single
 * entry, retroactively, once an in-place-edited flagged entry gets
 * accepted after the fact — the two callers just pass different id
 * lists into the same logic, so there's no risk of the two ever
 * drifting apart.
 */
async function creditMaterialUsageItemIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  itemIds: number[]
) {
  if (itemIds.length === 0) return;
  const { data: usageItemRows } = await supabase
    .from("daily_log_material_usage_items")
    .select("project_material_id, status")
    .in("id", itemIds);

  for (const item of usageItemRows ?? []) {
    const { error } = await supabase
      .from("project_materials")
      .update({ status: item.status })
      .eq("id", item.project_material_id);
    if (error) {
      // The log is already approved — don't fail the whole review over
      // one material's status sync, just leave a trail for follow-up.
      console.error(
        "[creditMaterialUsageItemIds] project_materials status sync failed:",
        error.message
      );
    }
  }
}

async function creditMaterialProcurementIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number,
  recordedBy: string,
  procurementIds: number[]
) {
  if (procurementIds.length === 0) return;

  // Only items picked through the modal's request picker carry a
  // material_request_item_id; a plain Direct Purchase item has none and
  // is skipped entirely.
  const { data: procurementItems } = await supabase
    .from("daily_log_material_procurement_items")
    .select("material_request_item_id, quantity")
    .in("procurement_id", procurementIds)
    .not("material_request_item_id", "is", null);

  const deliveredByItemId = new Map<number, number>();
  for (const item of procurementItems ?? []) {
    if (item.material_request_item_id == null) continue;
    deliveredByItemId.set(
      item.material_request_item_id,
      (deliveredByItemId.get(item.material_request_item_id) ?? 0) +
        (item.quantity ?? 0)
    );
  }

  if (deliveredByItemId.size > 0) {
    const { data: requestItems } = await supabase
      .from("material_request_items")
      .select("id, material_request_id, quantity_needed, quantity_fulfilled")
      .in("id", Array.from(deliveredByItemId.keys()));

    const affectedRequestIds = new Set<number>();
    for (const requestItem of requestItems ?? []) {
      const delivered = deliveredByItemId.get(requestItem.id) ?? 0;
      const nextFulfilled = (requestItem.quantity_fulfilled ?? 0) + delivered;
      const { error: itemUpdateError } = await supabase
        .from("material_request_items")
        .update({ quantity_fulfilled: nextFulfilled })
        .eq("id", requestItem.id);

      if (itemUpdateError) {
        console.error(
          "[creditMaterialProcurementIds] material_request_items fulfillment sync failed:",
          itemUpdateError.message
        );
      } else {
        affectedRequestIds.add(requestItem.material_request_id);
      }
    }

    for (const requestId of affectedRequestIds) {
      const [{ data: request }, { data: allItems }] = await Promise.all([
        supabase
          .from("material_requests")
          .select("status")
          .eq("id", requestId)
          .single(),
        supabase
          .from("material_request_items")
          .select("quantity_needed, quantity_fulfilled")
          .eq("material_request_id", requestId),
      ]);

      if (!request || !allItems) continue;

      const nextStatus = deriveMaterialRequestStatus(
        request.status,
        allItems.map((item) => ({
          quantityNeeded: item.quantity_needed ?? 0,
          quantityFulfilled: item.quantity_fulfilled ?? 0,
        }))
      );

      if (nextStatus !== request.status) {
        const { error: statusUpdateError } = await supabase
          .from("material_requests")
          .update({ status: nextStatus })
          .eq("id", requestId);
        if (statusUpdateError) {
          console.error(
            "[creditMaterialProcurementIds] material_requests status sync failed:",
            statusUpdateError.message
          );
        }
      }
    }
  }

  // A "goods receipt" event, same as any construction PM/inventory
  // system: this is what puts the delivered material on-site.
  // Materials Monitoring's own Material Record Table (project_materials)
  // is otherwise a fully manual ledger, so this is the one place it
  // gets touched automatically. A Material Record is looked up by name
  // (trimmed, case-insensitive) since a procurement item is free-typed
  // text, not a link to a catalog entry; no match creates a fresh
  // Material Record rather than silently dropping the delivery. This
  // runs for every procurement item, not just ones linked to a Material
  // Request — an unlinked direct purchase still physically arrives.
  const { data: allProcurementItems } = await supabase
    .from("daily_log_material_procurement_items")
    .select("material_name, specification, quantity, unit")
    .in("procurement_id", procurementIds);

  if (allProcurementItems && allProcurementItems.length > 0) {
    const deliveredByName = new Map<
      string,
      {
        materialName: string;
        specification: string | null;
        unit: string | null;
        quantity: number;
      }
    >();
    for (const item of allProcurementItems) {
      const key = item.material_name.trim().toLowerCase();
      if (!key) continue;
      const existing = deliveredByName.get(key);
      if (existing) {
        existing.quantity += item.quantity ?? 0;
      } else {
        deliveredByName.set(key, {
          materialName: item.material_name.trim(),
          specification: item.specification,
          unit: item.unit,
          quantity: item.quantity ?? 0,
        });
      }
    }

    const { data: existingMaterials } = await supabase
      .from("project_materials")
      .select("id, material_name, quantity")
      .eq("project_id", projectId);

    const materialByName = new Map(
      (existingMaterials ?? []).map((m) => [
        m.material_name.trim().toLowerCase(),
        m,
      ])
    );

    for (const [key, delivered] of deliveredByName) {
      const match = materialByName.get(key);
      if (match) {
        const { error: stockUpdateError } = await supabase
          .from("project_materials")
          .update({
            quantity: (match.quantity ?? 0) + delivered.quantity,
            status: "available",
          })
          .eq("id", match.id);
        if (stockUpdateError) {
          console.error(
            "[creditMaterialProcurementIds] project_materials stock increment failed:",
            stockUpdateError.message
          );
        }
      } else {
        const materialCode = await nextMaterialCode(supabase, projectId);
        const { error: insertError } = await supabase
          .from("project_materials")
          .insert({
            project_id: projectId,
            material_code: materialCode,
            material_name: delivered.materialName,
            specification: delivered.specification,
            quantity: delivered.quantity,
            unit: delivered.unit,
            status: "available",
            recorded_by: recordedBy,
          });
        if (insertError) {
          console.error(
            "[creditMaterialProcurementIds] project_materials auto-create failed:",
            insertError.message
          );
        }
      }
    }
  }
}

async function creditEquipmentAcquisitionIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  acquisitionIds: number[]
) {
  if (acquisitionIds.length === 0) return;

  // Only entries picked through the modal's request picker carry an
  // equipment_request_item_id; a plain manually-typed entry has none
  // and is skipped entirely.
  const { data: acquisitionRows } = await supabase
    .from("daily_log_equipment_acquisition")
    .select("equipment_request_item_id, quantity")
    .in("id", acquisitionIds)
    .not("equipment_request_item_id", "is", null);

  const acquiredByItemId = new Map<number, number>();
  for (const row of acquisitionRows ?? []) {
    if (row.equipment_request_item_id == null) continue;
    acquiredByItemId.set(
      row.equipment_request_item_id,
      (acquiredByItemId.get(row.equipment_request_item_id) ?? 0) +
        (row.quantity ?? 0)
    );
  }

  if (acquiredByItemId.size === 0) return;

  const { data: requestItems } = await supabase
    .from("equipment_requisition_items")
    .select("id, equipment_request_id, quantity_needed, quantity_fulfilled")
    .in("id", Array.from(acquiredByItemId.keys()));

  const affectedRequestIds = new Set<number>();
  for (const requestItem of requestItems ?? []) {
    const acquired = acquiredByItemId.get(requestItem.id) ?? 0;
    const nextFulfilled = (requestItem.quantity_fulfilled ?? 0) + acquired;
    const { error: itemUpdateError } = await supabase
      .from("equipment_requisition_items")
      .update({ quantity_fulfilled: nextFulfilled })
      .eq("id", requestItem.id);

    if (itemUpdateError) {
      console.error(
        "[creditEquipmentAcquisitionIds] equipment_request_items fulfillment sync failed:",
        itemUpdateError.message
      );
    } else {
      affectedRequestIds.add(requestItem.equipment_request_id);
    }
  }

  for (const requestId of affectedRequestIds) {
    const [{ data: request }, { data: allItems }] = await Promise.all([
      supabase
        .from("equipment_requisitions")
        .select("status")
        .eq("id", requestId)
        .single(),
      supabase
        .from("equipment_requisition_items")
        .select("quantity_needed, quantity_fulfilled")
        .eq("equipment_request_id", requestId),
    ]);

    if (!request || !allItems) continue;

    const nextStatus = deriveEquipmentRequestStatus(
      request.status,
      allItems.map((item) => ({
        quantityNeeded: item.quantity_needed ?? 0,
        quantityFulfilled: item.quantity_fulfilled ?? 0,
      }))
    );

    if (nextStatus !== request.status) {
      const { error: statusUpdateError } = await supabase
        .from("equipment_requisitions")
        .update({ status: nextStatus })
        .eq("id", requestId);
      if (statusUpdateError) {
        console.error(
          "[creditEquipmentAcquisitionIds] equipment_requests status sync failed:",
          statusUpdateError.message
        );
      }
    }
  }
}

/**
 * Recomputes progress and syncs projects.status to match, after the two
 * events here that can actually move it: approving a daily log, and
 * resolving a flag on a work_item entry (the one entry type a flag can
 * exclude/re-include from the progress calculation itself). A flagged-
 * but-not-yet-resolved work item, or a still-pending log, never reaches
 * here, since neither counts toward progress in the first place.
 *
 * This isn't the only place status gets synced — see
 * lib/projects/sync.ts's own doc comment for why the project detail
 * page also does this on every load (progress can shift from a Cost
 * Estimate edit too, with no daily-log event at all).
 */
async function syncProjectStatus(projectId: number) {
  const costEstimate = await getCostEstimate(projectId);
  const progress = await getProjectProgress(projectId, costEstimate.categories);
  await syncProjectStatusFromProgress(projectId, progress.overallPercent);
}

export async function updateDailyLogStatus(
  dailyLogId: number,
  projectId: number,
  status: "approved" | "rejected",
  _prevState: DailyLogActionState,
  _formData: FormData
): Promise<DailyLogActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to review daily logs." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("daily_logs")
    .update({
      status,
      reviewed_by: profile.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", dailyLogId);

  if (error) {
    console.error("[updateDailyLogStatus] Supabase update failed:", error.message);
    return { error: "Could not update the daily log. Please try again." };
  }

  // Approving a Material Usage/Procurement/Equipment Acquisition entry
  // is what actually credits it — the same "approval is what makes it
  // real" convention across all three, now shared with
  // resolveDailyLogEntryFlag for the retroactive case (see the three
  // creditXIds helpers above). A rejected log leaves everything
  // untouched.
  //
  // An admin can flag individual entries as wrong while the log was
  // still pending (see flagDailyLogEntry) without rejecting the whole
  // log — a flagged entry is excluded from every credit below, same as
  // it's excluded from Progress/Expenses/Material Usage History reads
  // (see listFlaggedEntryIds), even though the log itself still gets
  // approved and everything else in it still takes effect.
  if (status === "approved") {
    const [
      flaggedUsageItemIds,
      flaggedProcurementIds,
      flaggedAcquisitionIds,
    ] = await Promise.all([
      listFlaggedEntryIds(supabase, "material_usage_item", [dailyLogId]),
      listFlaggedEntryIds(supabase, "material_procurement", [dailyLogId]),
      listFlaggedEntryIds(supabase, "equipment_acquisition", [dailyLogId]),
    ]);

    const [{ data: usageItemRows }, { data: procurementRows }, { data: acquisitionRows }] =
      await Promise.all([
        supabase
          .from("daily_log_material_usage_items")
          .select("id")
          .eq("daily_log_id", dailyLogId),
        supabase
          .from("daily_log_material_procurement")
          .select("id")
          .eq("daily_log_id", dailyLogId),
        supabase
          .from("daily_log_equipment_acquisition")
          .select("id")
          .eq("daily_log_id", dailyLogId),
      ]);

    const usageItemIds = (usageItemRows ?? [])
      .map((r) => r.id)
      .filter((id) => !flaggedUsageItemIds.has(id));
    const procurementIds = (procurementRows ?? [])
      .map((r) => r.id)
      .filter((id) => !flaggedProcurementIds.has(id));
    const acquisitionIds = (acquisitionRows ?? [])
      .map((r) => r.id)
      .filter((id) => !flaggedAcquisitionIds.has(id));

    await creditMaterialUsageItemIds(supabase, usageItemIds);
    await creditMaterialProcurementIds(supabase, projectId, profile.id, procurementIds);
    await creditEquipmentAcquisitionIds(supabase, acquisitionIds);
    await syncProjectStatus(projectId);
  }

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

export async function deleteDailyLog(
  dailyLogId: number,
  projectId: number,
  _prevState: DailyLogActionState,
  _formData: FormData
): Promise<DailyLogActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to delete daily logs." };
  }

  const supabase = await createClient();

  // Storage objects aren't cleaned up by the DB's `on delete cascade` on
  // daily_log_work_items/daily_log_labor_items/daily_log_expense_items/
  // daily_log_material_procurement (that only removes rows, not files),
  // so their paths need to be collected before the rows that reference
  // them are gone.
  const [
    { data: workItems },
    { data: laborItems },
    { data: expenseItems },
    { data: procurementLogs },
    { data: equipmentAcquisitionLogs },
  ] = await Promise.all([
    supabase
      .from("daily_log_work_items")
      .select("attachment_paths")
      .eq("daily_log_id", dailyLogId),
    supabase
      .from("daily_log_labor_items")
      .select("attachment_paths")
      .eq("daily_log_id", dailyLogId),
    supabase
      .from("daily_log_expense_items")
      .select("attachment_paths")
      .eq("daily_log_id", dailyLogId),
    supabase
      .from("daily_log_material_procurement")
      .select("attachment_paths")
      .eq("daily_log_id", dailyLogId),
    supabase
      .from("daily_log_equipment_acquisition")
      .select("attachment_paths")
      .eq("daily_log_id", dailyLogId),
  ]);

  const { error } = await supabase
    .from("daily_logs")
    .delete()
    .eq("id", dailyLogId);

  if (error) {
    console.error("[deleteDailyLog] Supabase delete failed:", error.message);
    return { error: "Could not delete the daily log. Please try again." };
  }

  const paths = [
    ...(workItems ?? []),
    ...(laborItems ?? []),
    ...(expenseItems ?? []),
    ...(procurementLogs ?? []),
    ...(equipmentAcquisitionLogs ?? []),
  ].flatMap((item) => item.attachment_paths ?? []);

  if (paths.length > 0) {
    const { error: storageError } = await supabase.storage
      .from("daily-log-attachments")
      .remove(paths);
    if (storageError) {
      // The log itself is already gone — don't fail the whole delete
      // over leftover files, just leave a trail for manual cleanup.
      console.error(
        "[deleteDailyLog] Supabase Storage cleanup failed:",
        storageError.message
      );
    }
  }

  revalidatePath(`/admin/projects/${projectId}`);
  redirect(`/admin/projects/${projectId}?tab=progress&subtab=daily-logs`);
}

/**
 * Flags one entry in a still-pending daily log as wrong, with a reason,
 * without rejecting the whole log. The flagged entry is permanently
 * excluded from counting as real project data (Progress, Expenses,
 * Material Usage History all check listFlaggedEntryIds) and, if this
 * log later gets approved, from every write-side-effect
 * updateDailyLogStatus otherwise runs for its entry type — everything
 * else in the same log still goes through normally.
 */
export async function flagDailyLogEntry(
  dailyLogId: number,
  projectId: number,
  entryType: EntryType,
  entryId: number,
  _prevState: FlagActionState,
  formData: FormData
): Promise<FlagActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to flag daily log entries." };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "Add a reason for the flag." };
  }

  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status")
    .eq("id", dailyLogId)
    .maybeSingle();
  if (!log) {
    return { error: "This daily log no longer exists." };
  }
  if (log.status !== "pending") {
    return { error: "Only a pending daily log's entries can be flagged." };
  }

  const { error } = await supabase.from("daily_log_entry_flags").insert({
    daily_log_id: dailyLogId,
    entry_type: entryType,
    entry_id: entryId,
    reason,
    flagged_by: profile.id,
  });

  if (error) {
    console.error("[flagDailyLogEntry] Supabase insert failed:", error.message);
    return { error: "Could not flag this entry. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

/**
 * Removes a flag outright — only while the log is still pending, i.e.
 * the admin changed their mind before approving. Once a log is
 * approved its flags are permanent (see resolveDailyLogEntryFlag for
 * what happens to them after that).
 */
export async function unflagDailyLogEntry(
  flagId: number,
  dailyLogId: number,
  projectId: number,
  _prevState: FlagActionState,
  _formData: FormData
): Promise<FlagActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to unflag daily log entries." };
  }

  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status")
    .eq("id", dailyLogId)
    .maybeSingle();
  if (!log) {
    return { error: "This daily log no longer exists." };
  }
  if (log.status !== "pending") {
    return {
      error: "A flag can only be removed while the log is still pending.",
    };
  }

  const { error } = await supabase
    .from("daily_log_entry_flags")
    .delete()
    .eq("id", flagId);

  if (error) {
    console.error("[unflagDailyLogEntry] Supabase delete failed:", error.message);
    return { error: "Could not remove the flag. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

/**
 * Marks a flag resolved — either the entry got fixed in place (see
 * updateFlaggedEntry, which sets entry_updated_at) and this is the
 * admin accepting that fix, or the admin is dismissing the flag
 * outright as a false alarm (entry_updated_at stays null). Either way
 * the entry was excluded from the log's original approval, so this
 * always runs the same per-entry-type credit it would have gotten then
 * (see the three creditXIds helpers above updateDailyLogStatus) — the
 * credit functions just re-sync from whatever the entry's current row
 * holds, so re-running them for an unedited entry is a harmless no-op
 * beyond making it count. listFlaggedEntryIds is what actually decides
 * whether the entry now counts for Progress/Expenses/Materials reads —
 * see its own doc comment.
 */
export async function resolveDailyLogEntryFlag(
  flagId: number,
  dailyLogId: number,
  projectId: number,
  _prevState: FlagActionState,
  _formData: FormData
): Promise<FlagActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to resolve flags." };
  }

  const supabase = await createClient();

  const { data: flag } = await supabase
    .from("daily_log_entry_flags")
    .select("entry_type, entry_id")
    .eq("id", flagId)
    .is("resolved_at", null)
    .maybeSingle();
  if (!flag) {
    return { error: "This flag no longer exists or is already resolved." };
  }

  const { error } = await supabase
    .from("daily_log_entry_flags")
    .update({ resolved_by: profile.id, resolved_at: new Date().toISOString() })
    .eq("id", flagId);

  if (error) {
    console.error(
      "[resolveDailyLogEntryFlag] Supabase update failed:",
      error.message
    );
    return { error: "Could not mark this flag resolved. Please try again." };
  }

  if (flag.entry_type === "material_usage_item") {
    await creditMaterialUsageItemIds(supabase, [flag.entry_id]);
  } else if (flag.entry_type === "material_procurement") {
    await creditMaterialProcurementIds(
      supabase,
      projectId,
      profile.id,
      [flag.entry_id]
    );
  } else if (flag.entry_type === "equipment_acquisition") {
    await creditEquipmentAcquisitionIds(supabase, [flag.entry_id]);
  } else if (flag.entry_type === "work_item") {
    // The one entry type resolving a flag can actually move progress
    // on: a work_item stops being excluded by listFlaggedEntryIds the
    // moment this resolves, so the project's overall % (and therefore
    // its derived status) can jump right here, not just on the next
    // daily log approval.
    await syncProjectStatus(projectId);
  }
  // labor_item / expense_item have no direct write side-effect and
  // don't factor into progress — they simply stop being excluded by
  // listFlaggedEntryIds's own check on the next Expenses read.

  revalidatePath(`/admin/projects/${projectId}`);
  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

/**
 * Rejects an in-place fix (see updateFlaggedEntry) and drops the flag
 * back to "open" with a fresh reason — reusing the same row rather than
 * inserting a new one, which is exactly what unique(entry_type,
 * entry_id) from 0023_daily_log_entry_flags.sql is for. Only valid on a
 * flag actually in the "updated" state; one with no submitted fix yet
 * is already open, nothing to reject.
 */
export async function reflagDailyLogEntry(
  flagId: number,
  dailyLogId: number,
  projectId: number,
  _prevState: FlagActionState,
  formData: FormData
): Promise<FlagActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to flag daily log entries." };
  }

  const reason = String(formData.get("reason") ?? "").trim();
  if (!reason) {
    return { error: "Add a reason for the flag." };
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("daily_log_entry_flags")
    .update({
      reason,
      flagged_by: profile.id,
      flagged_at: new Date().toISOString(),
      entry_updated_at: null,
    })
    .eq("id", flagId)
    .is("resolved_at", null)
    .not("entry_updated_at", "is", null);

  if (error) {
    console.error("[reflagDailyLogEntry] Supabase update failed:", error.message);
    return { error: "Could not re-flag this entry. Please try again." };
  }

  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

/**
 * Per-entry-type field validation/update for updateFlaggedEntry —
 * separated out mostly so that function reads as "check permissions,
 * check the flag, apply the update, mark it updated" without six
 * inline branches in the way. Mirrors the same field names/validation
 * the bulk create/edit forms use (buildWorkItemDrafts and friends)
 * where it made sense to, so a future foreman-facing form built the
 * same way can post here with minimal translation.
 */
async function applyEntryUpdate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entryType: EntryType,
  entryId: number,
  formData: FormData
): Promise<string | undefined> {
  switch (entryType) {
    case "work_item": {
      const categoryId = Number(formData.get("categoryId"));
      const taskId = Number(formData.get("taskId"));
      const quantityCompleted = parseNumber(formData.get("quantityCompleted"));
      const unit = String(formData.get("unit") ?? "").trim();
      const activity = String(formData.get("activity") ?? "").trim();
      if (!categoryId || !taskId) {
        return "Select a category and a work item.";
      }

      const { data: task } = await supabase
        .from("estimate_tasks")
        .select("task_name, estimated_quantity, unit")
        .eq("id", taskId)
        .maybeSingle();
      if (task && quantityCompleted > (task.estimated_quantity ?? 0)) {
        return `Quantity completed for "${task.task_name}" can't exceed its estimated quantity (${task.estimated_quantity}${task.unit ? ` ${task.unit}` : ""}).`;
      }

      const { error } = await supabase
        .from("daily_log_work_items")
        .update({
          category_id: categoryId,
          task_id: taskId,
          quantity_completed: quantityCompleted,
          unit: unit || null,
          activity: activity || null,
        })
        .eq("id", entryId);
      return error ? "Could not save the work log. Please try again." : undefined;
    }
    case "labor_item": {
      const workerRole = String(formData.get("workerRole") ?? "").trim();
      if (!workerRole) return "Every labor log needs a worker role.";
      const { error } = await supabase
        .from("daily_log_labor_items")
        .update({
          worker_role: workerRole,
          worker_count: parseNumber(formData.get("workerCount")),
          daily_rate: parseNumber(formData.get("dailyRate")),
          ot_hours: parseNumber(formData.get("otHours")),
          workers_rendered_overtime: parseNumber(
            formData.get("workersRenderedOvertime")
          ),
          workers_rendered_halfday: parseNumber(
            formData.get("workersRenderedHalfday")
          ),
          remarks: String(formData.get("remarks") ?? "").trim() || null,
        })
        .eq("id", entryId);
      return error ? "Could not save the labor log. Please try again." : undefined;
    }
    case "expense_item": {
      const expenseCategory = String(formData.get("expenseCategory") ?? "").trim();
      if (!expenseCategory) return "Every expense log needs an expense category.";
      const { error } = await supabase
        .from("daily_log_expense_items")
        .update({
          expense_category: expenseCategory,
          amount: parseNumber(formData.get("amount")),
          additional_fees: parseNumber(formData.get("additionalFees")),
          description: String(formData.get("description") ?? "").trim() || null,
          remarks: String(formData.get("remarks") ?? "").trim() || null,
        })
        .eq("id", entryId);
      return error ? "Could not save the expense log. Please try again." : undefined;
    }
    case "material_usage_item": {
      const projectMaterialId = Number(formData.get("projectMaterialId"));
      const usageStatus = String(formData.get("status") ?? "").trim();
      if (!projectMaterialId || !usageStatus) {
        return "Select a material and a usage status.";
      }
      const { error } = await supabase
        .from("daily_log_material_usage_items")
        .update({
          project_material_id: projectMaterialId,
          status: usageStatus as "available" | "low_stock" | "fully_consumed",
          activity: String(formData.get("activity") ?? "").trim() || null,
          remarks: String(formData.get("remarks") ?? "").trim() || null,
        })
        .eq("id", entryId);
      return error
        ? "Could not save the material usage log. Please try again."
        : undefined;
    }
    case "material_procurement": {
      // Header fields plus in-place edits to each existing item's own
      // fields (materialName/specification/quantity/unit/cost) — adding
      // or removing items isn't supported through this narrow edit
      // path; that still needs the full Add Daily Log modal before
      // approval, same as any other entry-count change.
      const procurementType = String(formData.get("procurementType") ?? "").trim();
      const supplierName = String(formData.get("supplierName") ?? "").trim();
      const additionalFees = parseNumber(formData.get("additionalFees"));
      const remarks = String(formData.get("remarks") ?? "").trim();

      const { error: headerError } = await supabase
        .from("daily_log_material_procurement")
        .update({
          procurement_type: (procurementType || "direct_purchase") as
            | "direct_purchase"
            | "supplier_delivery",
          supplier_name: supplierName || null,
          additional_fees: additionalFees,
          remarks: remarks || null,
        })
        .eq("id", entryId);
      if (headerError) {
        return "Could not save the procurement log. Please try again.";
      }

      let items: {
        id: number;
        materialName: string;
        specification: string;
        quantity: number;
        unit: string;
        cost: number;
      }[] = [];
      try {
        const parsed = JSON.parse(String(formData.get("itemsJson") ?? "[]"));
        if (Array.isArray(parsed)) {
          items = parsed.map((item) => {
            const record = item as Record<string, unknown>;
            return {
              id: Number(record.id),
              materialName: String(record.materialName ?? "").trim(),
              specification: String(record.specification ?? "").trim(),
              quantity: parseNumber(record.quantity as FormDataEntryValue | null),
              unit: String(record.unit ?? "").trim(),
              cost: parseNumber(record.cost as FormDataEntryValue | null),
            };
          });
        }
      } catch {
        items = [];
      }

      for (const item of items) {
        if (!item.id || !item.materialName) continue;
        const { error: itemError } = await supabase
          .from("daily_log_material_procurement_items")
          .update({
            material_name: item.materialName,
            specification: item.specification || null,
            quantity: item.quantity,
            unit: item.unit || null,
            cost: item.cost,
          })
          .eq("id", item.id)
          .eq("procurement_id", entryId);
        if (itemError) {
          console.error(
            "[applyEntryUpdate] procurement item update failed:",
            itemError.message
          );
        }
      }
      return undefined;
    }
    case "equipment_acquisition": {
      const equipmentName = String(formData.get("equipmentName") ?? "").trim();
      if (!equipmentName) {
        return "Every equipment acquisition log needs an equipment name.";
      }
      const acquisitionType = String(formData.get("acquisitionType") ?? "").trim();
      const { error } = await supabase
        .from("daily_log_equipment_acquisition")
        .update({
          equipment_name: equipmentName,
          specification: String(formData.get("specification") ?? "").trim() || null,
          quantity: parseNumber(formData.get("quantity")),
          acquisition_type: (acquisitionType || "rental") as "rental" | "purchase",
          amount: parseNumber(formData.get("amount")),
          remarks: String(formData.get("remarks") ?? "").trim() || null,
        })
        .eq("id", entryId);
      return error
        ? "Could not save the equipment acquisition log. Please try again."
        : undefined;
    }
  }
}

/**
 * Corrects one flagged entry's own data in place — today this is an
 * admin standing in for the foreman, since there's no Foreman portal
 * yet; once that portal exists, this same action should also accept a
 * call from the log's own submitted_by foreman, scoped to their own
 * logs, with no other change needed here. Deliberately narrow: only
 * usable on an entry that's currently flagged and unresolved, and only
 * touches that one entry's row — the log itself stays approved and
 * locked otherwise, this is not a reopen of the whole log. Marks the
 * flag "updated" so the admin sees it needs a fresh look (see
 * resolveDailyLogEntryFlag / reflagDailyLogEntry for what happens next).
 */
export async function updateFlaggedEntry(
  dailyLogId: number,
  projectId: number,
  entryType: EntryType,
  entryId: number,
  _prevState: FlagActionState,
  formData: FormData
): Promise<FlagActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit daily log entries." };
  }

  const supabase = await createClient();

  const { data: log } = await supabase
    .from("daily_logs")
    .select("status")
    .eq("id", dailyLogId)
    .maybeSingle();
  if (!log) {
    return { error: "This daily log no longer exists." };
  }
  if (log.status !== "approved") {
    return {
      error: "Only a flagged entry on an approved log can be corrected this way.",
    };
  }

  const { data: flag } = await supabase
    .from("daily_log_entry_flags")
    .select("id")
    .eq("daily_log_id", dailyLogId)
    .eq("entry_type", entryType)
    .eq("entry_id", entryId)
    .is("resolved_at", null)
    .maybeSingle();
  if (!flag) {
    return { error: "This entry isn't currently flagged." };
  }

  const updateError = await applyEntryUpdate(supabase, entryType, entryId, formData);
  if (updateError) {
    return { error: updateError };
  }

  const { error: flagUpdateError } = await supabase
    .from("daily_log_entry_flags")
    .update({ entry_updated_at: new Date().toISOString() })
    .eq("id", flag.id);
  if (flagUpdateError) {
    console.error(
      "[updateFlaggedEntry] flag update failed:",
      flagUpdateError.message
    );
  }

  revalidatePath(`/admin/projects/${projectId}/daily-logs/${dailyLogId}`);
  return { success: true };
}

export type SurveyQuestionsActionState = {
  error?: string;
  success?: boolean;
};

/**
 * Replaces a project's whole custom Survey question list in one go,
 * matching the settings modal's own Cancel/Save shape — nothing is
 * committed until Save, so this reconciles the submitted list against
 * what's stored rather than exposing separate add/edit/delete actions.
 * Same repeated-field convention as buildWorkItemDrafts and friends
 * above: questionId is empty string for a row added in this same
 * session (insert), or an existing id (update); any existing id not
 * present in the submission was deleted client-side and is removed here
 * too. Deleting a question cascades its daily_log_survey_answers rows
 * (0033_daily_log_survey_questions.sql) — no history kept past that,
 * same tradeoff every other daily-log child table already accepts.
 */
export async function saveSurveyQuestions(
  projectId: number,
  _prevState: SurveyQuestionsActionState,
  formData: FormData
): Promise<SurveyQuestionsActionState> {
  const profile = await getSessionProfile();
  if (!profile || profile.role !== "admin") {
    return { error: "You are not authorized to edit survey questions." };
  }

  const ids = formData.getAll("questionId");
  const texts = formData.getAll("questionText");
  const required = formData.getAll("questionRequired");

  const rows: { id: number | null; questionText: string; isRequired: boolean }[] =
    [];
  for (let i = 0; i < texts.length; i++) {
    const questionText = String(texts[i] ?? "").trim();
    if (!questionText) {
      return { error: "Every question needs its own text." };
    }
    const idRaw = String(ids[i] ?? "").trim();
    rows.push({
      id: idRaw ? Number(idRaw) : null,
      questionText,
      isRequired: String(required[i] ?? "false") === "true",
    });
  }

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("daily_log_survey_questions")
    .select("id")
    .eq("project_id", projectId);

  const existingIds = new Set((existing ?? []).map((r) => r.id));
  const submittedIds = new Set(
    rows.filter((r) => r.id != null).map((r) => r.id as number)
  );
  const removedIds = Array.from(existingIds).filter((id) => !submittedIds.has(id));

  if (removedIds.length > 0) {
    const { error } = await supabase
      .from("daily_log_survey_questions")
      .delete()
      .in("id", removedIds);
    if (error) {
      console.error("[saveSurveyQuestions] delete failed:", error.message);
      return { error: "Could not save the survey questions. Please try again." };
    }
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.id != null) {
      const { error } = await supabase
        .from("daily_log_survey_questions")
        .update({
          question_text: row.questionText,
          is_required: row.isRequired,
          sort_order: i,
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (error) {
        console.error("[saveSurveyQuestions] update failed:", error.message);
        return { error: "Could not save the survey questions. Please try again." };
      }
    } else {
      const { error } = await supabase.from("daily_log_survey_questions").insert({
        project_id: projectId,
        question_text: row.questionText,
        is_required: row.isRequired,
        sort_order: i,
      });
      if (error) {
        console.error("[saveSurveyQuestions] insert failed:", error.message);
        return { error: "Could not save the survey questions. Please try again." };
      }
    }
  }

  revalidatePath(`/admin/projects/${projectId}`);
  return { success: true };
}
