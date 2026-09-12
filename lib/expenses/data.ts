import { createClient } from "@/lib/supabase/server";
import { listFlaggedEntryIds } from "@/lib/daily-logs/data";

/**
 * The Expenses tab's four ledgers (Labor/Material/Equipment/Other) plus
 * the Overview sub-tab's roll-up — every figure here is built from
 * *approved* daily logs only. A pending or rejected log hasn't had its
 * numbers reviewed yet (see the Option A daily-log lifecycle in
 * lib/daily-logs/actions.ts), so counting it here would let un-reviewed
 * data show up as if it were a real, booked expense. An individual
 * entry an admin flagged as wrong during review is excluded too, even
 * though its log was still approved as a whole (see listFlaggedEntryIds).
 *
 * Grouped by daily_log_id rather than by a bare date string — the
 * project.id/log_date pair is already unique (0019_daily_logs_one_per_
 * day.sql), so the two amount to the same grouping, but the id is also
 * exactly what "View Details" needs to link to that day's Daily Log
 * detail page.
 */

async function approvedDailyLogIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: number
) {
  const { data } = await supabase
    .from("daily_logs")
    .select("id, log_date")
    .eq("project_id", projectId)
    .eq("status", "approved")
    .order("log_date", { ascending: false });
  return data ?? [];
}

// --- Labor Expenses ---------------------------------------------------

export type LaborExpenseItem = {
  id: number;
  workerRole: string;
  workerCount: number;
  dailyRate: number;
  workersRenderedHalfday: number;
  workersRenderedOvertime: number;
  otHours: number;
  total: number;
};

export type LaborExpenseGroup = {
  dailyLogId: number;
  logDate: string;
  items: LaborExpenseItem[];
  groupTotal: number;
};

/**
 * Half-day workers are paid half their daily rate instead of the full
 * rate; overtime-rendering workers are paid double their effective
 * hourly rate (dailyRate / 8) for their OT hours on top of a full day.
 * The two are independent head-counts (a worker can render OT without
 * being marked half-day and vice versa) so both are subtracted/added
 * against the same workerCount base rather than against each other.
 */
function laborItemTotal(item: {
  workerCount: number;
  dailyRate: number;
  workersRenderedHalfday: number;
  workersRenderedOvertime: number;
  otHours: number;
}) {
  const fullDayWorkers = Math.max(item.workerCount - item.workersRenderedHalfday, 0);
  const regularPay =
    fullDayWorkers * item.dailyRate +
    item.workersRenderedHalfday * (item.dailyRate / 2);
  const hourlyRate = item.dailyRate / 8;
  const otPay = item.workersRenderedOvertime * item.otHours * hourlyRate * 2;
  return regularPay + otPay;
}

export async function listLaborExpenses(
  projectId: number
): Promise<LaborExpenseGroup[]> {
  const supabase = await createClient();
  const logs = await approvedDailyLogIds(supabase, projectId);
  if (logs.length === 0) return [];

  const logIds = logs.map((l) => l.id);
  const [{ data: rows }, flaggedIds] = await Promise.all([
    supabase
      .from("daily_log_labor_items")
      .select(
        "id, daily_log_id, worker_role, worker_count, daily_rate, workers_rendered_halfday, workers_rendered_overtime, ot_hours"
      )
      .in("daily_log_id", logIds)
      .order("id", { ascending: true }),
    listFlaggedEntryIds(supabase, "labor_item", logIds),
  ]);

  const itemsByLog = new Map<number, LaborExpenseItem[]>();
  for (const row of rows ?? []) {
    if (flaggedIds.has(row.id)) continue;
    const item: LaborExpenseItem = {
      id: row.id,
      workerRole: row.worker_role,
      workerCount: row.worker_count ?? 0,
      dailyRate: row.daily_rate ?? 0,
      workersRenderedHalfday: row.workers_rendered_halfday ?? 0,
      workersRenderedOvertime: row.workers_rendered_overtime ?? 0,
      otHours: row.ot_hours ?? 0,
      total: 0,
    };
    item.total = laborItemTotal(item);
    const list = itemsByLog.get(row.daily_log_id) ?? [];
    list.push(item);
    itemsByLog.set(row.daily_log_id, list);
  }

  return logs
    .map((log) => {
      const items = itemsByLog.get(log.id) ?? [];
      return {
        dailyLogId: log.id,
        logDate: log.log_date,
        items,
        groupTotal: items.reduce((sum, i) => sum + i.total, 0),
      };
    })
    .filter((group) => group.items.length > 0);
}

// --- Material Expenses --------------------------------------------------

export type MaterialExpenseItem = {
  id: number;
  materialName: string;
  specification: string | null;
  quantity: number;
  unit: string | null;
  /** Derived (subTotal / quantity) for display — the modal only ever
   * captures one cost figure per line, stored as that line's total. */
  unitCost: number;
  subTotal: number;
};

export type MaterialExpenseProcurement = {
  id: number;
  procurementType: "direct_purchase" | "supplier_delivery";
  supplierName: string | null;
  additionalFees: number;
  items: MaterialExpenseItem[];
  /** Sum of item sub-totals plus this procurement's own additional fees. */
  procurementTotal: number;
};

export type MaterialExpenseGroup = {
  dailyLogId: number;
  logDate: string;
  procurements: MaterialExpenseProcurement[];
  groupTotal: number;
};

export async function listMaterialExpenses(
  projectId: number
): Promise<MaterialExpenseGroup[]> {
  const supabase = await createClient();
  const logs = await approvedDailyLogIds(supabase, projectId);
  if (logs.length === 0) return [];

  const logIds = logs.map((l) => l.id);
  const [{ data: allProcurementRows }, flaggedProcurementIds] = await Promise.all([
    supabase
      .from("daily_log_material_procurement")
      .select("id, daily_log_id, procurement_type, supplier_name, additional_fees")
      .in("daily_log_id", logIds)
      .order("id", { ascending: true }),
    listFlaggedEntryIds(supabase, "material_procurement", logIds),
  ]);
  const procurementRows = (allProcurementRows ?? []).filter(
    (p) => !flaggedProcurementIds.has(p.id)
  );

  const procurementIds = procurementRows.map((p) => p.id);
  const { data: itemRows } =
    procurementIds.length > 0
      ? await supabase
          .from("daily_log_material_procurement_items")
          .select("id, procurement_id, material_name, specification, quantity, unit, cost")
          .in("procurement_id", procurementIds)
          .order("id", { ascending: true })
      : { data: [] as never[] };

  const itemsByProcurementId = new Map<number, MaterialExpenseItem[]>();
  for (const row of itemRows ?? []) {
    const quantity = row.quantity ?? 0;
    const subTotal = row.cost ?? 0;
    const list = itemsByProcurementId.get(row.procurement_id) ?? [];
    list.push({
      id: row.id,
      materialName: row.material_name,
      specification: row.specification,
      quantity,
      unit: row.unit,
      unitCost: quantity > 0 ? subTotal / quantity : subTotal,
      subTotal,
    });
    itemsByProcurementId.set(row.procurement_id, list);
  }

  const procurementsByLog = new Map<number, MaterialExpenseProcurement[]>();
  for (const row of procurementRows) {
    const items = itemsByProcurementId.get(row.id) ?? [];
    const additionalFees = row.additional_fees ?? 0;
    const list = procurementsByLog.get(row.daily_log_id) ?? [];
    list.push({
      id: row.id,
      procurementType: row.procurement_type,
      supplierName: row.supplier_name,
      additionalFees,
      items,
      procurementTotal:
        items.reduce((sum, i) => sum + i.subTotal, 0) + additionalFees,
    });
    procurementsByLog.set(row.daily_log_id, list);
  }

  return logs
    .map((log) => {
      const procurements = procurementsByLog.get(log.id) ?? [];
      return {
        dailyLogId: log.id,
        logDate: log.log_date,
        procurements,
        groupTotal: procurements.reduce((sum, p) => sum + p.procurementTotal, 0),
      };
    })
    .filter((group) => group.procurements.length > 0);
}

// --- Equipment Expenses --------------------------------------------------

export type EquipmentExpenseItem = {
  id: number;
  equipmentName: string;
  specification: string | null;
  quantity: number;
  acquisitionType: "rental" | "purchase";
  amount: number;
  equipmentRequestErNo: string | null;
};

export type EquipmentExpenseGroup = {
  dailyLogId: number;
  logDate: string;
  items: EquipmentExpenseItem[];
  groupTotal: number;
};

export async function listEquipmentExpenses(
  projectId: number
): Promise<EquipmentExpenseGroup[]> {
  const supabase = await createClient();
  const logs = await approvedDailyLogIds(supabase, projectId);
  if (logs.length === 0) return [];

  const logIds = logs.map((l) => l.id);
  const [{ data: allRows }, flaggedIds] = await Promise.all([
    supabase
      .from("daily_log_equipment_acquisition")
      .select(
        "id, daily_log_id, equipment_request_id, equipment_name, specification, quantity, acquisition_type, amount"
      )
      .in("daily_log_id", logIds)
      .order("id", { ascending: true }),
    listFlaggedEntryIds(supabase, "equipment_acquisition", logIds),
  ]);
  const rows = (allRows ?? []).filter((r) => !flaggedIds.has(r.id));

  const requestIds = Array.from(
    new Set(rows.map((r) => r.equipment_request_id).filter((id): id is number => id != null))
  );
  const { data: requests } =
    requestIds.length > 0
      ? await supabase.from("equipment_requisitions").select("id, er_no").in("id", requestIds)
      : { data: [] as { id: number; er_no: string }[] };
  const erNoById = new Map((requests ?? []).map((r) => [r.id, r.er_no]));

  const itemsByLog = new Map<number, EquipmentExpenseItem[]>();
  for (const row of rows) {
    const list = itemsByLog.get(row.daily_log_id) ?? [];
    list.push({
      id: row.id,
      equipmentName: row.equipment_name,
      specification: row.specification,
      quantity: row.quantity ?? 0,
      acquisitionType: row.acquisition_type,
      amount: row.amount ?? 0,
      equipmentRequestErNo: row.equipment_request_id
        ? (erNoById.get(row.equipment_request_id) ?? null)
        : null,
    });
    itemsByLog.set(row.daily_log_id, list);
  }

  return logs
    .map((log) => {
      const items = itemsByLog.get(log.id) ?? [];
      return {
        dailyLogId: log.id,
        logDate: log.log_date,
        items,
        groupTotal: items.reduce((sum, i) => sum + i.amount, 0),
      };
    })
    .filter((group) => group.items.length > 0);
}

// --- Other Expenses --------------------------------------------------

export type OtherExpenseItem = {
  id: number;
  expenseCategory: string;
  description: string | null;
  amount: number;
  additionalFees: number;
  remarks: string | null;
  total: number;
};

export type OtherExpenseGroup = {
  dailyLogId: number;
  logDate: string;
  items: OtherExpenseItem[];
  groupTotal: number;
};

export async function listOtherExpenses(
  projectId: number
): Promise<OtherExpenseGroup[]> {
  const supabase = await createClient();
  const logs = await approvedDailyLogIds(supabase, projectId);
  if (logs.length === 0) return [];

  const logIds = logs.map((l) => l.id);
  const [{ data: rows }, flaggedIds] = await Promise.all([
    supabase
      .from("daily_log_expense_items")
      .select("id, daily_log_id, expense_category, amount, additional_fees, description, remarks")
      .in("daily_log_id", logIds)
      .order("id", { ascending: true }),
    listFlaggedEntryIds(supabase, "expense_item", logIds),
  ]);

  const itemsByLog = new Map<number, OtherExpenseItem[]>();
  for (const row of rows ?? []) {
    if (flaggedIds.has(row.id)) continue;
    const amount = row.amount ?? 0;
    const additionalFees = row.additional_fees ?? 0;
    const list = itemsByLog.get(row.daily_log_id) ?? [];
    list.push({
      id: row.id,
      expenseCategory: row.expense_category,
      description: row.description,
      amount,
      additionalFees,
      remarks: row.remarks,
      total: amount + additionalFees,
    });
    itemsByLog.set(row.daily_log_id, list);
  }

  return logs
    .map((log) => {
      const items = itemsByLog.get(log.id) ?? [];
      return {
        dailyLogId: log.id,
        logDate: log.log_date,
        items,
        groupTotal: items.reduce((sum, i) => sum + i.total, 0),
      };
    })
    .filter((group) => group.items.length > 0);
}

// --- Overview -------------------------------------------------------------

export type ExpenseOverview = {
  counts: {
    total: number;
    labor: number;
    material: number;
    equipment: number;
    other: number;
  };
  actual: {
    labor: number;
    material: number;
    equipment: number;
    other: number;
  };
  planned: {
    labor: number;
    material: number;
    equipment: number;
    other: number;
  };
};

/**
 * Rolls the four ledgers above (already fetched for their own sub-tabs)
 * up into the Overview sub-tab's stat cards, bar chart, and per-category
 * Planned/Actual/Balance donuts — no separate query, just arithmetic
 * over data the page already has. "Planned" comes from the Cost
 * Estimate's own per-column totals (lib/cost-estimate/data.ts), the only
 * place a "planned" figure exists in this project.
 */
export function summarizeExpenses(
  labor: LaborExpenseGroup[],
  material: MaterialExpenseGroup[],
  equipment: EquipmentExpenseGroup[],
  other: OtherExpenseGroup[],
  plannedTotals: { labor: number; material: number; equipment: number; other: number }
): ExpenseOverview {
  const laborCount = labor.reduce((sum, g) => sum + g.items.length, 0);
  const materialCount = material.reduce(
    (sum, g) => sum + g.procurements.reduce((s, p) => s + p.items.length, 0),
    0
  );
  const equipmentCount = equipment.reduce((sum, g) => sum + g.items.length, 0);
  const otherCount = other.reduce((sum, g) => sum + g.items.length, 0);

  return {
    counts: {
      total: laborCount + materialCount + equipmentCount + otherCount,
      labor: laborCount,
      material: materialCount,
      equipment: equipmentCount,
      other: otherCount,
    },
    actual: {
      labor: labor.reduce((sum, g) => sum + g.groupTotal, 0),
      material: material.reduce((sum, g) => sum + g.groupTotal, 0),
      equipment: equipment.reduce((sum, g) => sum + g.groupTotal, 0),
      other: other.reduce((sum, g) => sum + g.groupTotal, 0),
    },
    planned: plannedTotals,
  };
}
