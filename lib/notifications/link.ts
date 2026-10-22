import type { AppNotification } from "./actions";

export function notificationLink(basePath: string, notification: AppNotification) {
  const root = `${basePath}/projects/${notification.projectId}`;
  if (notification.kind === "sheet_submitted") return `${root}?tab=overview&sheet=${notification.itemId}`;
  if (notification.kind === "material_request") return `${root}?tab=materials&subtab=requests&request=${notification.itemId}`;
  if (notification.kind === "equipment_request") return `${root}?tab=equipment&subtab=requests&request=${notification.itemId}`;
  return `${root}?progress=${notification.itemKind}-${notification.itemId}`;
}
