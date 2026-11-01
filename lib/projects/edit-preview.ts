import type { ProjectRow } from "./data";
import type { AccountRow } from "@/lib/accounts/data";

/** Only fields exposed by Edit Project; preserve status, holidays and archives. */
export function projectEditPreview(project: ProjectRow, data: FormData, people: AccountRow[]): ProjectRow {
  const text = (key: string) => String(data.get(key) ?? "").trim();
  const nameOf = (id: string, current: string | null) => {
    const person = people.find(row => row.id === id);
    return person ? `${person.firstName} ${person.lastName}`.trim() || person.email : current;
  };
  const projectManagerId = text("projectManagerId");
  const foremanId = text("foremanId");
  const budget = text("allocatedBudget");
  return { ...project, name: text("projectName"), location: text("location") || null,
    startDate: text("startDate") || null, targetEndDate: text("targetEndDate") || null,
    actualEndDate: text("actualEndDate") || null,
    allocatedBudget: budget && Number.isFinite(Number(budget)) ? Number(budget) : null,
    projectManagerId, projectManagerName: nameOf(projectManagerId, project.projectManagerName),
    foremanId, foremanName: nameOf(foremanId, project.foremanName),
    workingDays: data.getAll("workingDays").map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 7),
  };
}
