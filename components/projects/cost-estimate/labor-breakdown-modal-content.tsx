"use client";

import type { CostCategory } from "@/lib/cost-estimate/data";

function formatCurrency(amount: number | null | undefined) {
  return `₱${(amount ?? 0).toLocaleString("en-PH", { maximumFractionDigits: 0 })}`;
}

/**
 * Same purpose as MaterialBreakdownModalContent, for the "Labor" column
 * header instead — a project-wide, read-only view of every task's
 * planned manpower (task.laborAssignments), grouped by category then
 * task.
 *
 * Deliberately unrelated to the Gantt Chart's own "Assigned" column
 * (task_worker_assignments, real named workers for on-site
 * accountability) — this is the cost-estimation planning side, a role +
 * headcount tally, not who specifically is doing the work.
 */
export function LaborBreakdownModalContent({
  categories,
}: {
  categories: CostCategory[];
}) {
  const categoriesWithLabor = categories
    .map((category) => ({
      ...category,
      tasks: category.tasks.filter((t) => t.laborAssignments.length > 0),
    }))
    .filter((category) => category.tasks.length > 0);

  const grandTotal = categories.reduce(
    (sum, c) => sum + c.tasks.reduce((s, t) => s + t.laborEstimate, 0),
    0
  );

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-zinc-500">
        Manpower planned across every task in this project.
      </p>

      {categoriesWithLabor.length === 0 ? (
        <p className="py-4 text-center text-sm text-zinc-400">
          No manpower has been listed for any task yet.
        </p>
      ) : (
        <div className="flex flex-col gap-5">
          {categoriesWithLabor.map((category) => (
            <div key={category.id} className="flex flex-col gap-3">
              <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                {category.name}
              </p>
              {category.tasks.map((task) => (
                <div key={task.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-zinc-700">
                      {task.name}
                    </p>
                    <p className="text-sm font-semibold text-zinc-900">
                      {formatCurrency(task.laborEstimate)}
                    </p>
                  </div>
                  <div className="overflow-hidden rounded-md border border-zinc-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
                        <tr>
                          <th className="border-b border-zinc-200 px-3 py-2">
                            Role
                          </th>
                          <th className="border-b border-zinc-200 px-3 py-2 text-right">
                            Workers
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {task.laborAssignments.map((item, index) => (
                          <tr
                            key={item.id}
                            className={
                              index !== task.laborAssignments.length - 1
                                ? "border-b border-zinc-100"
                                : ""
                            }
                          >
                            <td className="px-3 py-2 text-zinc-700">
                              {item.workerRole}
                            </td>
                            <td className="px-3 py-2 text-right text-zinc-600">
                              {item.plannedWorkerCount}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between rounded-md bg-zinc-50 px-3 py-2 text-sm">
        <span className="font-medium text-zinc-500">
          Total Labor Cost (Project)
        </span>
        <span className="font-semibold text-zinc-900">
          {formatCurrency(grandTotal)}
        </span>
      </div>
    </div>
  );
}
