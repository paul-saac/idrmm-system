import { createClient } from "@/lib/supabase/server";
import {
  flagState,
  entryDomId,
  dailyLogEntryHref,
  type EntryFlag,
  type EntryType,
  type FlagState,
} from "@/lib/daily-logs/flag-state";

export type { EntryType, EntryFlag, FlagState };
export { flagState, entryDomId, dailyLogEntryHref };

export type DailyLogStatus = "pending" | "approved" | "rejected";

export type MaterialUsageStatus = "available" | "low_stock" | "fully_consumed";
export type ProcurementType = "direct_purchase" | "supplier_delivery";
export type EquipmentAcquisitionType = "rental" | "purchase";

// Lightweight, list-view-only shapes for each entry type: no signed
// attachment URLs (see signAttachmentUrls' own doc comment — minting
// those is a real network round trip per attachment, worth paying for
// on a single log's own detail page but not for every entry of every
// log in the whole list at once) and no raw foreign-key ids beyond what
// display needs. getDailyLogDetail below stays the full, heavier shape
// the detail page itself uses.
export type DailyLogWorkEntry = {
  id: number;
  categoryName: string;
  taskName: string;
  quantityCompleted: number;
  unit: string | null;
  activity: string | null;
};

export type DailyLogLaborEntry = {
  id: number;
  workerRole: string;
  workerCount: number;
  dailyRate: number;
  otHours: number;
};

export type DailyLogMaterialUsageEntry = {
  id: number;
  materialName: string;
  specification: string | null;
  unit: string | null;
  status: MaterialUsageStatus;
  activity: string | null;
};

export type DailyLogProcurementEntry = {
  id: number;
  procurementType: ProcurementType;
  supplierName: string | null;
  additionalFees: number;
  items: {
    id: number;
    materialName: string;
    specification: string | null;
    quantity: number;
    unit: string | null;
    cost: number;
  }[];
};

export type DailyLogEquipmentAcquisitionEntry = {
  id: number;
  equipmentName: string;
  specification: string | null;
  quantity: number;
  acquisitionType: EquipmentAcquisitionType;
  amount: number;
};

export type DailyLogOtherExpenseEntry = {
  id: number;
  expenseCategory: string;
  amount: number;
  additionalFees: number;
  description: string | null;
};

export type DailyLogSummary = {
  id: number;
  logDate: string;
  status: DailyLogStatus;
  submittedByName: string;
  /** Who approved this log (updateDailyLogStatus sets reviewed_by on
   * both an approval and a rejection, but this is only ever populated
   * for "approved" — a rejection has nothing worth labeling "Approved
   * By" for). Null for a log that's still pending, even if reviewed_by
   * is already set some other way. */
  approvedByName: string | null;
  /** Flags on this log's entries still awaiting a fix — see EntryFlag.
   * Shown alongside status ("Approved — 2 flagged") since an approved
   * log can still have open flags on it. */
  unresolvedFlagCount: number;
  /** Every entry actually recorded on this log, grouped by type — the
   * list view's own breakdown drills into these directly instead of
   * just showing a bare count per type. */
  entries: {
    workLogs: DailyLogWorkEntry[];
    laborLogs: DailyLogLaborEntry[];
    materialUsage: DailyLogMaterialUsageEntry[];
    materialProcurement: DailyLogProcurementEntry[];
    equipmentAcquisition: DailyLogEquipmentAcquisitionEntry[];
    otherExpense: DailyLogOtherExpenseEntry[];
  };
};

/**
 * The set of entry ids of one type that are still excluded from real
 * project data, across a set of daily logs — shared by every place that
 * reads approved daily logs' entries (Progress's work-item quantities,
 * Expenses' four ledgers, Materials' usage history) so a flagged entry
 * is excluded consistently everywhere, not just from the one-time
 * approval sync in updateDailyLogStatus.
 *
 * An entry stops being excluded once its flag is resolved — whether the
 * admin accepted an in-place fix (entry_updated_at set) or resolved it
 * outright as a false alarm (entry_updated_at still null; there's no
 * "the fix landed elsewhere" flow to wait on since flagged entries can
 * only ever be corrected in place, see updateFlaggedEntry). Only a flag
 * still awaiting a decision (resolved_at null) keeps its entry excluded.
 */
export async function listFlaggedEntryIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  entryType: EntryType,
  dailyLogIds: number[]
): Promise<Set<number>> {
  if (dailyLogIds.length === 0) return new Set();
  const { data } = await supabase
    .from("daily_log_entry_flags")
    .select("entry_id")
    .eq("entry_type", entryType)
    .in("daily_log_id", dailyLogIds)
    .is("resolved_at", null);
  return new Set((data ?? []).map((r) => r.entry_id));
}

function formatName(
  profile: { first_name: string; last_name: string } | undefined
) {
  if (!profile) return "—";
  const name = `${profile.first_name} ${profile.last_name}`.trim();
  return name || "—";
}

/**
 * Every daily log for a project, each carrying its own full (but
 * lightweight — see DailyLogWorkEntry's own doc comment) breakdown of
 * entries by type. Every query below is batched across *all* of the
 * project's logs at once — one round trip per entry type, not one per
 * log — the same shape listDailyLogs always had when it was only
 * counting rows; this just selects more columns off those same rows,
 * plus two more batched lookups (task/category names for work items,
 * material names for usage items, procurement's own items) needed to
 * actually display them instead of just counting them.
 */
export async function listDailyLogs(
  projectId: number
): Promise<DailyLogSummary[]> {
  const supabase = await createClient();

  const { data: logs, error } = await supabase
    .from("daily_logs")
    .select("id, log_date, status, submitted_by, reviewed_by")
    .eq("project_id", projectId)
    .order("log_date", { ascending: false })
    .order("id", { ascending: false });

  if (error || !logs) return [];

  const logIds = logs.map((log) => log.id);

  const [
    { data: profiles },
    { data: workItemRows },
    { data: laborItemRows },
    { data: expenseItemRows },
    { data: materialUsageRows },
    { data: procurementRows },
    { data: equipmentAcquisitionRows },
    { data: unresolvedFlags },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in(
        "id",
        Array.from(
          new Set(
            logs.flatMap((log) =>
              log.reviewed_by ? [log.submitted_by, log.reviewed_by] : [log.submitted_by]
            )
          )
        )
      ),
    logIds.length > 0
      ? supabase
          .from("daily_log_work_items")
          .select("id, daily_log_id, category_id, task_id, quantity_completed, unit, activity")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_labor_items")
          .select("id, daily_log_id, worker_role, worker_count, daily_rate, ot_hours")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_expense_items")
          .select("id, daily_log_id, expense_category, amount, additional_fees, description")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_material_usage_items")
          .select("id, daily_log_id, project_material_id, status, activity")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_material_procurement")
          .select("id, daily_log_id, procurement_type, supplier_name, additional_fees")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_equipment_acquisition")
          .select("id, daily_log_id, equipment_name, specification, quantity, acquisition_type, amount")
          .in("daily_log_id", logIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
    logIds.length > 0
      ? supabase
          .from("daily_log_entry_flags")
          .select("daily_log_id")
          .in("daily_log_id", logIds)
          .is("resolved_at", null)
      : Promise.resolve({ data: [] as { daily_log_id: number }[] }),
  ]);

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));

  const categoryIds = Array.from(
    new Set((workItemRows ?? []).map((item) => item.category_id))
  );
  const taskIds = Array.from(
    new Set((workItemRows ?? []).map((item) => item.task_id))
  );
  const materialIds = Array.from(
    new Set((materialUsageRows ?? []).map((item) => item.project_material_id))
  );
  const procurementIds = (procurementRows ?? []).map((p) => p.id);

  const [
    { data: categories },
    { data: tasks },
    { data: usageMaterials },
    { data: procurementItemRows },
  ] = await Promise.all([
    categoryIds.length > 0
      ? supabase.from("estimate_categories").select("id, category_name").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: number; category_name: string }[] }),
    taskIds.length > 0
      ? supabase.from("estimate_tasks").select("id, task_name").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: number; task_name: string }[] }),
    materialIds.length > 0
      ? supabase
          .from("project_materials")
          .select("id, material_name, specification, unit")
          .in("id", materialIds)
      : Promise.resolve({
          data: [] as {
            id: number;
            material_name: string;
            specification: string | null;
            unit: string | null;
          }[],
        }),
    procurementIds.length > 0
      ? supabase
          .from("daily_log_material_procurement_items")
          .select("id, procurement_id, material_name, specification, quantity, unit, cost")
          .in("procurement_id", procurementIds)
          .order("id", { ascending: true })
      : Promise.resolve({ data: [] as never[] }),
  ]);

  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.category_name]));
  const taskNameById = new Map((tasks ?? []).map((t) => [t.id, t.task_name]));
  const materialById = new Map((usageMaterials ?? []).map((m) => [m.id, m]));

  function groupByLog<T extends { daily_log_id: number }>(
    rows: T[] | null
  ): Map<number, T[]> {
    const map = new Map<number, T[]>();
    for (const row of rows ?? []) {
      const list = map.get(row.daily_log_id) ?? [];
      list.push(row);
      map.set(row.daily_log_id, list);
    }
    return map;
  }

  const workItemsByLog = groupByLog(workItemRows);
  const laborItemsByLog = groupByLog(laborItemRows);
  const expenseItemsByLog = groupByLog(expenseItemRows);
  const materialUsageItemsByLog = groupByLog(materialUsageRows);
  const procurementByLog = groupByLog(procurementRows);
  const equipmentAcquisitionByLog = groupByLog(equipmentAcquisitionRows);

  const procurementItemsByProcurementId = new Map<
    number,
    DailyLogProcurementEntry["items"]
  >();
  for (const item of procurementItemRows ?? []) {
    const list = procurementItemsByProcurementId.get(item.procurement_id) ?? [];
    list.push({
      id: item.id,
      materialName: item.material_name,
      specification: item.specification,
      quantity: item.quantity ?? 0,
      unit: item.unit,
      cost: item.cost ?? 0,
    });
    procurementItemsByProcurementId.set(item.procurement_id, list);
  }

  function countByLog(rows: { daily_log_id: number }[] | null) {
    const map = new Map<number, number>();
    for (const row of rows ?? []) {
      map.set(row.daily_log_id, (map.get(row.daily_log_id) ?? 0) + 1);
    }
    return map;
  }

  const unresolvedFlagCountByLog = countByLog(unresolvedFlags);

  return logs.map((log) => ({
    id: log.id,
    logDate: log.log_date,
    status: log.status,
    submittedByName: formatName(profileById.get(log.submitted_by)),
    approvedByName:
      log.status === "approved" && log.reviewed_by
        ? formatName(profileById.get(log.reviewed_by))
        : null,
    unresolvedFlagCount: unresolvedFlagCountByLog.get(log.id) ?? 0,
    entries: {
      workLogs: (workItemsByLog.get(log.id) ?? []).map((item) => ({
        id: item.id,
        categoryName: categoryNameById.get(item.category_id) ?? "—",
        taskName: taskNameById.get(item.task_id) ?? "—",
        quantityCompleted: item.quantity_completed ?? 0,
        unit: item.unit,
        activity: item.activity,
      })),
      laborLogs: (laborItemsByLog.get(log.id) ?? []).map((item) => ({
        id: item.id,
        workerRole: item.worker_role,
        workerCount: item.worker_count ?? 0,
        dailyRate: item.daily_rate ?? 0,
        otHours: item.ot_hours ?? 0,
      })),
      materialUsage: (materialUsageItemsByLog.get(log.id) ?? []).map((item) => {
        const material = materialById.get(item.project_material_id);
        return {
          id: item.id,
          materialName: material?.material_name ?? "—",
          specification: material?.specification ?? null,
          unit: material?.unit ?? null,
          status: item.status,
          activity: item.activity,
        };
      }),
      materialProcurement: (procurementByLog.get(log.id) ?? []).map((row) => ({
        id: row.id,
        procurementType: row.procurement_type,
        supplierName: row.supplier_name,
        additionalFees: row.additional_fees ?? 0,
        items: procurementItemsByProcurementId.get(row.id) ?? [],
      })),
      equipmentAcquisition: (equipmentAcquisitionByLog.get(log.id) ?? []).map(
        (row) => ({
          id: row.id,
          equipmentName: row.equipment_name,
          specification: row.specification,
          quantity: row.quantity ?? 0,
          acquisitionType: row.acquisition_type,
          amount: row.amount ?? 0,
        })
      ),
      otherExpense: (expenseItemsByLog.get(log.id) ?? []).map((item) => ({
        id: item.id,
        expenseCategory: item.expense_category,
        amount: item.amount ?? 0,
        additionalFees: item.additional_fees ?? 0,
        description: item.description,
      })),
    },
  }));
}

export type DailyLogWorkItemDetail = {
  id: number;
  /** Raw ids alongside the joined display names — needed to prefill the
   * category/task pickers when editing a flagged entry in place (see
   * updateFlaggedEntry), not just to render this read-only view. */
  categoryId: number;
  taskId: number;
  categoryName: string;
  taskName: string;
  quantityCompleted: number;
  unit: string | null;
  activity: string | null;
  attachmentUrls: string[];
};

export type DailyLogLaborItemDetail = {
  id: number;
  workerRole: string;
  workerCount: number;
  dailyRate: number;
  otHours: number;
  workersRenderedOvertime: number;
  workersRenderedHalfday: number;
  remarks: string | null;
  attachmentUrls: string[];
};

export type DailyLogExpenseItemDetail = {
  id: number;
  expenseCategory: string;
  amount: number;
  additionalFees: number;
  description: string | null;
  remarks: string | null;
  attachmentUrls: string[];
};

export type DailyLogProcurementItemDetail = {
  id: number;
  materialRequestItemId: number | null;
  materialName: string;
  specification: string | null;
  quantity: number;
  unit: string | null;
  cost: number;
};

export type DailyLogProcurementDetail = {
  id: number;
  procurementType: ProcurementType;
  supplierName: string | null;
  materialRequestId: number | null;
  materialRequestMrNo: string | null;
  additionalFees: number;
  remarks: string | null;
  attachmentUrls: string[];
  items: DailyLogProcurementItemDetail[];
};

export type DailyLogEquipmentAcquisitionDetail = {
  id: number;
  equipmentRequestId: number | null;
  equipmentRequestErNo: string | null;
  equipmentRequestItemId: number | null;
  equipmentName: string;
  specification: string | null;
  quantity: number;
  acquisitionType: EquipmentAcquisitionType;
  amount: number;
  attachmentUrls: string[];
  remarks: string | null;
};

export type DailyLogMaterialUsageItemDetail = {
  id: number;
  projectMaterialId: number;
  materialCode: string;
  materialName: string;
  specification: string | null;
  unit: string | null;
  status: MaterialUsageStatus;
  activity: string | null;
  remarks: string | null;
};

export type SurveyAnswer = {
  occurred: boolean | null;
  notes: string | null;
};

export type SurveyQuestion = {
  id: number;
  questionText: string;
  isRequired: boolean;
  sortOrder: number;
};

/**
 * A project's Survey questions (0033_daily_log_survey_questions.sql,
 * folded into the single source of truth by
 * 0034_daily_log_survey_defaults.sql) — every question asked on that
 * project's Daily Logs, including the three defaults every project
 * starts with (accidents/schedule delays/weather delays, seeded by
 * createProject/the 0034 backfill) alongside anything an admin adds of
 * their own. Ordered by sort_order so the settings modal and the Add
 * Daily Log Survey screen show them in the same order every time.
 */
export async function listSurveyQuestions(
  projectId: number
): Promise<SurveyQuestion[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("daily_log_survey_questions")
    .select("id, question_text, is_required, sort_order")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id,
    questionText: row.question_text,
    isRequired: row.is_required,
    sortOrder: row.sort_order,
  }));
}

export type DailyLogSurveyAnswer = {
  questionId: number;
  occurred: boolean | null;
  notes: string | null;
};

export type DailyLogDetail = {
  id: number;
  projectId: number;
  projectName: string;
  projectLocation: string | null;
  logDate: string;
  status: DailyLogStatus;
  submittedByName: string;
  /** One row per project question (daily_log_survey_questions) this log
   * actually has an answer for — a question added after this log was
   * submitted simply has no row here, shown as "Not yet recorded".
   * Matched to its question by id against the project's own
   * listSurveyQuestions, not embedded here, same "options come from a
   * separate prop" convention as categories/materials. */
  surveyAnswers: DailyLogSurveyAnswer[];
  workItems: DailyLogWorkItemDetail[];
  laborItems: DailyLogLaborItemDetail[];
  expenseItems: DailyLogExpenseItemDetail[];
  materialUsageItems: DailyLogMaterialUsageItemDetail[];
  procurementLogs: DailyLogProcurementDetail[];
  equipmentAcquisitionLogs: DailyLogEquipmentAcquisitionDetail[];
  /** Every flag on this log's entries, resolved or not — the detail
   * view matches these to their entry by entryType+entryId. */
  flags: EntryFlag[];
};

/**
 * Signed URLs for attachments: the bucket is private, so a bare stored
 * path can't be linked to directly — every read has to mint a
 * short-lived signed URL through the same authenticated client that's
 * already allowed to see it (see the storage.objects RLS policies in
 * 0010_daily_log_work_items.sql). An entry can now carry more than one
 * attachment (0022_daily_log_multiple_attachments.sql), so this signs
 * the whole list at once — a failed individual sign is dropped rather
 * than failing the others, same fail-soft convention as everywhere else
 * attachments are handled.
 */
async function signAttachmentUrls(
  supabase: Awaited<ReturnType<typeof createClient>>,
  paths: string[]
): Promise<string[]> {
  const urls = await Promise.all(
    paths.map(async (path) => {
      const { data, error } = await supabase.storage
        .from("daily-log-attachments")
        .createSignedUrl(path, 60 * 60);
      if (error) {
        console.error("[getDailyLogDetail] Signed URL failed:", error.message);
        return null;
      }
      return data.signedUrl;
    })
  );
  return urls.filter((url): url is string => url != null);
}

export async function getDailyLogDetail(
  dailyLogId: number
): Promise<DailyLogDetail | null> {
  const supabase = await createClient();

  const { data: log, error } = await supabase
    .from("daily_logs")
    .select("*")
    .eq("id", dailyLogId)
    .single();

  if (error || !log) return null;

  const [
    { data: profile },
    { data: workItemRows },
    { data: laborItemRows },
    { data: expenseItemRows },
    { data: materialUsageRows },
    { data: project },
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("first_name, last_name")
      .eq("id", log.submitted_by)
      .single(),
    supabase
      .from("daily_log_work_items")
      .select("id, category_id, task_id, quantity_completed, unit, activity, attachment_paths")
      .eq("daily_log_id", dailyLogId)
      .order("id", { ascending: true }),
    supabase
      .from("daily_log_labor_items")
      .select(
        "id, worker_role, worker_count, daily_rate, ot_hours, workers_rendered_overtime, workers_rendered_halfday, remarks, attachment_paths"
      )
      .eq("daily_log_id", dailyLogId)
      .order("id", { ascending: true }),
    supabase
      .from("daily_log_expense_items")
      .select(
        "id, expense_category, amount, additional_fees, description, remarks, attachment_paths"
      )
      .eq("daily_log_id", dailyLogId)
      .order("id", { ascending: true }),
    supabase
      .from("daily_log_material_usage_items")
      .select("id, project_material_id, status, activity, remarks")
      .eq("daily_log_id", dailyLogId)
      .order("id", { ascending: true }),
    supabase
      .from("projects")
      .select("project_name, location")
      .eq("id", log.project_id)
      .single(),
  ]);

  const { data: procurementRows } = await supabase
    .from("daily_log_material_procurement")
    .select(
      "id, procurement_type, supplier_name, material_request_id, additional_fees, attachment_paths, remarks"
    )
    .eq("daily_log_id", dailyLogId)
    .order("id", { ascending: true });

  const procurementIds = (procurementRows ?? []).map((p) => p.id);
  const materialRequestIds = Array.from(
    new Set(
      (procurementRows ?? [])
        .map((p) => p.material_request_id)
        .filter((id): id is number => id != null)
    )
  );

  const [{ data: procurementItemRows }, { data: linkedRequests }] =
    await Promise.all([
      procurementIds.length > 0
        ? supabase
            .from("daily_log_material_procurement_items")
            .select(
              "id, procurement_id, material_request_item_id, material_name, specification, quantity, unit, cost"
            )
            .in("procurement_id", procurementIds)
            .order("id", { ascending: true })
        : Promise.resolve({ data: [] as never[] }),
      materialRequestIds.length > 0
        ? supabase
            .from("material_requests")
            .select("id, mr_no")
            .in("id", materialRequestIds)
        : Promise.resolve({ data: [] as { id: number; mr_no: string }[] }),
    ]);

  const mrNoById = new Map((linkedRequests ?? []).map((r) => [r.id, r.mr_no]));
  const procurementItemsByProcurementId = new Map<
    number,
    DailyLogProcurementItemDetail[]
  >();
  for (const item of procurementItemRows ?? []) {
    const list = procurementItemsByProcurementId.get(item.procurement_id) ?? [];
    list.push({
      id: item.id,
      materialRequestItemId: item.material_request_item_id,
      materialName: item.material_name,
      specification: item.specification,
      quantity: item.quantity ?? 0,
      unit: item.unit,
      cost: item.cost ?? 0,
    });
    procurementItemsByProcurementId.set(item.procurement_id, list);
  }

  const procurementLogs: DailyLogProcurementDetail[] = await Promise.all(
    (procurementRows ?? []).map(async (row) => ({
      id: row.id,
      procurementType: row.procurement_type,
      supplierName: row.supplier_name,
      materialRequestId: row.material_request_id,
      materialRequestMrNo: row.material_request_id
        ? (mrNoById.get(row.material_request_id) ?? null)
        : null,
      additionalFees: row.additional_fees ?? 0,
      remarks: row.remarks,
      attachmentUrls: await signAttachmentUrls(supabase, row.attachment_paths),
      items: procurementItemsByProcurementId.get(row.id) ?? [],
    }))
  );

  const { data: equipmentAcquisitionRows } = await supabase
    .from("daily_log_equipment_acquisition")
    .select(
      "id, equipment_request_id, equipment_request_item_id, equipment_name, specification, quantity, acquisition_type, amount, attachment_paths, remarks"
    )
    .eq("daily_log_id", dailyLogId)
    .order("id", { ascending: true });

  const equipmentRequestIds = Array.from(
    new Set(
      (equipmentAcquisitionRows ?? [])
        .map((row) => row.equipment_request_id)
        .filter((id): id is number => id != null)
    )
  );
  const { data: linkedEquipmentRequests } =
    equipmentRequestIds.length > 0
      ? await supabase
          .from("equipment_requisitions")
          .select("id, er_no")
          .in("id", equipmentRequestIds)
      : { data: [] as { id: number; er_no: string }[] };
  const erNoById = new Map(
    (linkedEquipmentRequests ?? []).map((r) => [r.id, r.er_no])
  );

  const equipmentAcquisitionLogs: DailyLogEquipmentAcquisitionDetail[] =
    await Promise.all(
      (equipmentAcquisitionRows ?? []).map(async (row) => ({
        id: row.id,
        equipmentRequestId: row.equipment_request_id,
        equipmentRequestErNo: row.equipment_request_id
          ? (erNoById.get(row.equipment_request_id) ?? null)
          : null,
        equipmentRequestItemId: row.equipment_request_item_id,
        equipmentName: row.equipment_name,
        specification: row.specification,
        quantity: row.quantity ?? 0,
        acquisitionType: row.acquisition_type,
        amount: row.amount ?? 0,
        attachmentUrls: await signAttachmentUrls(supabase, row.attachment_paths),
        remarks: row.remarks,
      }))
    );

  const items = workItemRows ?? [];
  const categoryIds = Array.from(new Set(items.map((item) => item.category_id)));
  const taskIds = Array.from(new Set(items.map((item) => item.task_id)));

  const [{ data: categories }, { data: tasks }] = await Promise.all([
    categoryIds.length > 0
      ? supabase.from("estimate_categories").select("id, category_name").in("id", categoryIds)
      : Promise.resolve({ data: [] as { id: number; category_name: string }[] }),
    taskIds.length > 0
      ? supabase.from("estimate_tasks").select("id, task_name").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: number; task_name: string }[] }),
  ]);

  const categoryNameById = new Map((categories ?? []).map((c) => [c.id, c.category_name]));
  const taskNameById = new Map((tasks ?? []).map((t) => [t.id, t.task_name]));

  const workItems: DailyLogWorkItemDetail[] = await Promise.all(
    items.map(async (item) => ({
      id: item.id,
      categoryId: item.category_id,
      taskId: item.task_id,
      categoryName: categoryNameById.get(item.category_id) ?? "—",
      taskName: taskNameById.get(item.task_id) ?? "—",
      quantityCompleted: item.quantity_completed ?? 0,
      unit: item.unit,
      activity: item.activity,
      attachmentUrls: await signAttachmentUrls(supabase, item.attachment_paths),
    }))
  );

  const laborItems: DailyLogLaborItemDetail[] = await Promise.all(
    (laborItemRows ?? []).map(async (item) => ({
      id: item.id,
      workerRole: item.worker_role,
      workerCount: item.worker_count ?? 0,
      dailyRate: item.daily_rate ?? 0,
      otHours: item.ot_hours ?? 0,
      workersRenderedOvertime: item.workers_rendered_overtime ?? 0,
      workersRenderedHalfday: item.workers_rendered_halfday ?? 0,
      remarks: item.remarks,
      attachmentUrls: await signAttachmentUrls(supabase, item.attachment_paths),
    }))
  );

  const expenseItems: DailyLogExpenseItemDetail[] = await Promise.all(
    (expenseItemRows ?? []).map(async (item) => ({
      id: item.id,
      expenseCategory: item.expense_category,
      amount: item.amount ?? 0,
      additionalFees: item.additional_fees ?? 0,
      description: item.description,
      remarks: item.remarks,
      attachmentUrls: await signAttachmentUrls(supabase, item.attachment_paths),
    }))
  );

  const materialIds = Array.from(
    new Set((materialUsageRows ?? []).map((item) => item.project_material_id))
  );
  const { data: usageMaterials } =
    materialIds.length > 0
      ? await supabase
          .from("project_materials")
          .select("id, material_code, material_name, specification, unit")
          .in("id", materialIds)
      : { data: [] as { id: number; material_code: string; material_name: string; specification: string | null; unit: string | null }[] };

  const usageMaterialById = new Map((usageMaterials ?? []).map((m) => [m.id, m]));

  const materialUsageItems: DailyLogMaterialUsageItemDetail[] = (
    materialUsageRows ?? []
  ).map((item) => {
    const material = usageMaterialById.get(item.project_material_id);
    return {
      id: item.id,
      projectMaterialId: item.project_material_id,
      materialCode: material?.material_code ?? "—",
      materialName: material?.material_name ?? "—",
      specification: material?.specification ?? null,
      unit: material?.unit ?? null,
      status: item.status,
      activity: item.activity,
      remarks: item.remarks,
    };
  });

  const { data: surveyAnswerRows } = await supabase
    .from("daily_log_survey_answers")
    .select("question_id, occurred, notes")
    .eq("daily_log_id", dailyLogId);

  const surveyAnswers: DailyLogSurveyAnswer[] = (surveyAnswerRows ?? []).map(
    (row) => ({
      questionId: row.question_id,
      occurred: row.occurred,
      notes: row.notes,
    })
  );

  const { data: flagRows } = await supabase
    .from("daily_log_entry_flags")
    .select(
      "id, entry_type, entry_id, reason, flagged_by, flagged_at, resolved_by, resolved_at, entry_updated_at"
    )
    .eq("daily_log_id", dailyLogId)
    .order("flagged_at", { ascending: true });

  const flagProfileIds = Array.from(
    new Set(
      (flagRows ?? [])
        .flatMap((f) => [f.flagged_by, f.resolved_by])
        .filter((id): id is string => Boolean(id))
    )
  );
  const { data: flagProfiles } =
    flagProfileIds.length > 0
      ? await supabase
          .from("profiles")
          .select("id, first_name, last_name")
          .in("id", flagProfileIds)
      : { data: [] as { id: string; first_name: string; last_name: string }[] };
  const flagProfileById = new Map((flagProfiles ?? []).map((p) => [p.id, p]));

  const flags: EntryFlag[] = (flagRows ?? []).map((row) => ({
    id: row.id,
    entryType: row.entry_type,
    entryId: row.entry_id,
    reason: row.reason,
    flaggedByName: formatName(flagProfileById.get(row.flagged_by)),
    flaggedAt: row.flagged_at,
    resolvedByName: row.resolved_by
      ? formatName(flagProfileById.get(row.resolved_by))
      : null,
    resolvedAt: row.resolved_at,
    entryUpdatedAt: row.entry_updated_at,
  }));

  return {
    id: log.id,
    projectId: log.project_id,
    projectName: project?.project_name ?? "—",
    projectLocation: project?.location ?? null,
    logDate: log.log_date,
    status: log.status,
    submittedByName: formatName(profile ?? undefined),
    surveyAnswers,
    workItems,
    laborItems,
    expenseItems,
    materialUsageItems,
    procurementLogs,
    equipmentAcquisitionLogs,
    flags,
  };
}
