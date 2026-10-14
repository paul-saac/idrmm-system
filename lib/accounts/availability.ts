import type { AccountRow, AssignedProject } from "@/lib/accounts/data";

/**
 * A project manager or foreman is only ever on one project at a time:
 * this is the unfinished project (other than `projectId`, the one being
 * edited) they're already on — null when they're free. Once it's
 * completed, they can be assigned again. updateProject/createProject
 * hold the same rule on the server.
 */
export function projectElsewhere(
  person: AccountRow,
  projectId?: number
): AssignedProject | null {
  return (
    person.assignedProjects.find(
      (project) => !project.completed && project.id !== projectId
    ) ?? null
  );
}
