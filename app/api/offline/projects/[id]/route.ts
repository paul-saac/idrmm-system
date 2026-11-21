import { requireProjectAccess } from "@/lib/auth/project-access";
import { createClient } from "@/lib/supabase/server";
import { getProjectById } from "@/lib/projects/data";
import { getCostEstimate } from "@/lib/cost-estimate/data";
import { listWorkers, listTaskWorkerAssignments, listCategoryWorkerAssignments } from "@/lib/workers/data";
import { offlineHeaders as headers } from "@/lib/offline/http";
import type { OfflineItem, OfflineProject } from "@/lib/offline/types";
import { listMaterialPurchases } from "@/lib/materials/purchases";
import { listProgressMaterialUsage } from "@/lib/materials/data";
import { computeMaterialStocks } from "@/lib/materials/purchases-model";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const projectId = Number((await context.params).id);
  const profile = await requireProjectAccess(projectId);
  if (!profile) return Response.json({ error: "Sign in with project edit access to prepare offline logging." }, { status: 403, headers });
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Manila" });
  const date = new URL(request.url).searchParams.get("workDate") ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
    new Date(date).toISOString().slice(0, 10) !== date || date > today)
    return Response.json({ error: "Choose a valid work date." }, { status: 400, headers });
  try {
    const db = await createClient();
    const [project, estimate, workers, taskWorkers, categoryWorkers, state, purchases, usage] = await Promise.all([
      getProjectById(projectId), getCostEstimate(projectId, true), listWorkers(), listTaskWorkerAssignments(projectId),
      listCategoryWorkerAssignments(projectId), db.rpc("offline_project_progress", { p_project_id: projectId, p_date: date }),
      listMaterialPurchases(projectId), listProgressMaterialUsage(projectId),
    ]);
    if (!project || project.archivedAt) return Response.json({ error: "This project is unavailable for offline logging." }, { status: 403, headers });
    if (state.error) return Response.json({ error: "Offline preparation is temporarily unavailable. Please contact your administrator." }, { status: 503, headers });
    const items: OfflineItem[] = [];
    for (const category of estimate.categories) for (const item of category.tasks.length ? category.tasks : [category]) {
      if (item.isMilestone || item.id <= 0) continue;
      const kind = category.tasks.length ? "task" : "category";
      items.push({ key: `${kind}-${item.id}`, kind, id: item.id,
        name: item.name, phase: kind === "task" ? category.name : "",
        quantity: Number(item.estimatedQuantity ?? 0), unit: item.unit ?? "", startDate: item.plannedStartDate, endDate: item.plannedEndDate,
        materials: item.materialAssignments.map(m => ({ name: m.materialName, unit: m.unit })),
        equipment: (item.equipmentCostItems ?? []).map(r => ({ name: r.costName, amount: r.amount })),
        other: (item.otherCostItems ?? []).map(r => ({ name: r.costName, amount: r.amount })),
        workerIds: (kind === "task" ? taskWorkers[item.id] : categoryWorkers[item.id]) ?? [],
      });
    }
    const snapshot: OfflineProject = {
      id: projectId, name: project.name, ownerId: profile.id, ownerName: `${profile.firstName} ${profile.lastName}`.trim() || profile.email || "Project member",
      preparedAt: new Date().toISOString(), workDate: date, items,
      materialStocks: computeMaterialStocks(purchases, usage).map(stock => ({
        name: stock.name, unit: stock.unit, purchased: stock.purchased, used: stock.used, balance: stock.balance,
        status: stock.statusLabel,
        unitCost: Number(purchases.find(row => row.material_name.trim().toLowerCase() === stock.name.toLowerCase() && row.unit.toLowerCase() === stock.unit.toLowerCase())?.unit_price ?? 0),
      })),
      workers: workers.filter(w => w.category === "skilled" || w.employmentType === "subcontractor").map(w => ({ id: w.id, name: w.fullName,
        rate: Number(w.hourlyRate ?? 0), subcontractor: w.employmentType === "subcontractor", title: w.title, company: w.subcontractorCompany })), states: state.data,
    };
    return Response.json(snapshot, { headers });
  } catch {
    return Response.json({ error: "Could not download this project. Check your connection and retry." }, { status: 503, headers });
  }
}
