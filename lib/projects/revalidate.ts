import { revalidatePath } from "next/cache";

// Every project page exists under both portals, so a write has to refresh
// both — otherwise whichever portal didn't make the change keeps serving
// stale data until something else happens to invalidate it.
const PORTAL_BASES = ["/admin", "/foreman", "/project-manager"] as const;

/** `subPath` is anything after the project id, e.g. "/equipment/requests/7". */
export function revalidateProjectPaths(projectId: number, subPath = "") {
  for (const base of PORTAL_BASES) {
    revalidatePath(`${base}/projects/${projectId}${subPath}`);
  }
}

export function revalidateProjectLists() {
  for (const base of PORTAL_BASES) {
    revalidatePath(`${base}/projects`);
  }
}

export function revalidateInventory() {
  for (const base of PORTAL_BASES) {
    revalidatePath(`${base}/inventory`);
  }
}

export function revalidateReports() {
  for (const base of PORTAL_BASES) {
    revalidatePath(`${base}/reports`);
  }
}
