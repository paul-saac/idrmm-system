"use client";

import { useRouter } from "next/navigation";
import { usePortal } from "@/components/portal/portal-context";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/components/notifications/notifications-provider";
import type { AppNotification } from "@/lib/notifications/actions";

const SHOWN = 5;

/** The dashboard's summary of the bell — the latest few notifications
 * and how many are unread, kept in step with the bell itself (see
 * useNotifications). */
export function NotificationsCard() {
  const router = useRouter();
  const { basePath } = usePortal();
  const { items, unreadCount, markRead, dismiss } = useNotifications();

  async function openNotification(notification: AppNotification) {
    if (!notification.read) await markRead(notification.id);
    // Opens that row's Daily Progress Update, its Last override highlighted
    // (see GanttChartView's own ?progress handling).
    router.push(
      `${basePath}/projects/${notification.projectId}?progress=${notification.itemKind}-${notification.itemId}`
    );
  }

  return (
    <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-zinc-900">Notifications</h2>
          {unreadCount > 0 && (
            <span className="rounded-sm bg-red-50 px-2 py-0.5 text-xs font-medium text-red-600">
              {unreadCount} unread
            </span>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => markRead()}
            className="cursor-pointer text-xs font-medium text-zinc-500 transition hover:text-zinc-900"
          >
            Mark all as read
          </button>
        )}
      </div>
      <NotificationList
        items={items.slice(0, SHOWN)}
        onOpen={openNotification}
        onDismiss={dismiss}
        className="p-4"
      />
    </div>
  );
}
