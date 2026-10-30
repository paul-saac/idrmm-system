import type { AppNotification } from "./actions";

export function notificationLink(basePath: string, notification: AppNotification) {
  const root = `${basePath}/projects/${notification.projectId}`;
  if (notification.kind === "safety_incident") return `${root}?incident=${notification.itemId}`;
  if (notification.kind === "sheet_submitted") return `${root}?tab=overview&sheet=${notification.itemId}`;
  if (notification.kind === "material_request") return `${root}?tab=materials&subtab=requests&request=${notification.itemId}`;
  if (notification.kind === "equipment_request") return `${root}?tab=equipment&subtab=requests&request=${notification.itemId}`;
  const params = new URLSearchParams({ progress: `${notification.itemKind}-${notification.itemId}` });
  if (/^\d{4}-\d{2}-\d{2}$/.test(notification.entryDate)) {
    params.set("progressDate", notification.entryDate);
  }
  return `${root}?${params}`;
}
