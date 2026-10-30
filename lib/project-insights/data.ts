import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { buildInsightContext } from "./context";

const MAX_ROWS = 1000;
function rows<T>(result: { data: T[] | null; error: unknown }): T[] {
  if (result.error || !result.data) throw new Error("Could not load the project's saved records. Please refresh and try again.");
  // Supabase's default response ceiling must not become a misleading partial
  // review. The existing workspace data source has the same row ceiling.
  if (result.data.length >= MAX_ROWS) throw new Error("This project has too many records for one AI review.");
  return result.data;
}

/** Called only after project authorization; all reads use the caller's RLS session. */
export async function loadInsightContext(projectId: number) {
  const client = await createClient();
  const [projectResult, estimate] = await Promise.all([
    client.from("projects").select("id,project_name,start_date,target_end_date,actual_end_date,allocated_budget,archived_at,working_days,holidays").eq("id",projectId).maybeSingle(),
    getCostEstimate(projectId, true),
  ]);
  if (projectResult.error || !projectResult.data) throw new Error("This project is unavailable or you no longer have access.");
  const taskIds = estimate.categories.flatMap(category => category.tasks.map(task => task.id));
  const categoryIds = estimate.categories.filter(category => !category.tasks.length).map(category => category.id);
  if (taskIds.length + categoryIds.length >= MAX_ROWS) throw new Error("This project has too many work items for one AI review.");
  const [taskLogs, categoryLogs, taskWorkers, categoryWorkers, equipmentPlans, documents] = await Promise.all([
    taskIds.length ? client.from("task_progress_entries").select("task_id,entry_date").in("task_id",taskIds) : Promise.resolve({data:[],error:null}),
    categoryIds.length ? client.from("category_progress_entries").select("category_id,entry_date").in("category_id",categoryIds) : Promise.resolve({data:[],error:null}),
    taskIds.length ? client.from("task_worker_assignments").select("task_id,worker_id").in("task_id",taskIds) : Promise.resolve({data:[],error:null}),
    categoryIds.length ? client.from("category_worker_assignments").select("category_id,worker_id").in("category_id",categoryIds) : Promise.resolve({data:[],error:null}),
    client.from("equipment_task_plans").select("item_key,equipment_id").eq("project_id",projectId),
    client.from("project_sheets").select("id,sheet_number,document_type,revision,status").eq("project_id",projectId),
  ]);
  const logs = [
    ...rows(taskLogs).map(row => ({itemKey:`task-${row.task_id}`,entryDate:row.entry_date})),
    ...rows(categoryLogs).map(row => ({itemKey:`category-${row.category_id}`,entryDate:row.entry_date})),
  ];
  const assigned = [
    ...rows(taskWorkers).map(row => ({itemKey:`task-${row.task_id}`,workerId:row.worker_id})),
    ...rows(categoryWorkers).map(row => ({itemKey:`category-${row.category_id}`,workerId:row.worker_id})),
  ];
  const plans = rows(equipmentPlans);
  const workerIds = [...new Set(assigned.map(row => row.workerId))];
  const equipmentIds = [...new Set(plans.map(row => row.equipment_id))];
  const [workerResult, equipmentResult] = await Promise.all([
    workerIds.length ? client.from("workers").select("id,category,employment_type").in("id",workerIds) : Promise.resolve({data:[],error:null}),
    equipmentIds.length ? client.from("equipment").select("id,name").in("id",equipmentIds) : Promise.resolve({data:[],error:null}),
  ]);
  const fieldWorkers = new Set(rows(workerResult).filter(row => row.category === "skilled" || row.employment_type === "subcontractor").map(row => row.id));
  const equipmentNames = new Map(rows(equipmentResult).map(row => [row.id,row.name]));
  return buildInsightContext({
    project:projectResult.data,
    estimate,
    logs,
    workers:assigned.filter(row => fieldWorkers.has(row.workerId)),
    equipment:plans.filter(row => equipmentNames.has(row.equipment_id)).map(row => ({itemKey:row.item_key,equipmentId:row.equipment_id,name:equipmentNames.get(row.equipment_id)!})),
    documents:rows(documents),
  });
}
