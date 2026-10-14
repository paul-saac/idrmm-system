"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  dismissNotification,
  listMyNotifications,
  markNotificationsRead,
  type AppNotification,
} from "@/lib/notifications/actions";

// Fired after marking read, so every other place showing notifications
// (the bell, the dashboard's card) reloads too.
const CHANGED_EVENT = "notifications-changed";

/**
 * The signed-in user's notifications (see 0061_notifications.sql) —
 * loaded on mount, whenever the window regains focus or another
 * instance marks some read, and live on every new one (Supabase
 * Realtime, one channel per instance).
 */
export function useNotifications() {
  const instanceId = useId();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const load = useCallback(() => {
    listMyNotifications().then((result) => {
      setItems(result.items);
      setUnreadCount(result.unreadCount);
    });
  }, []);

  useEffect(() => {
    load();
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (cancelled || !session) return;
      supabase.realtime.setAuth(session.access_token);
      channel = supabase
        .channel(`notifications:${session.user.id}:${instanceId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `recipient_id=eq.${session.user.id}`,
          },
          () => {
            load();
          }
        )
        .subscribe();
    });
    window.addEventListener("focus", load);
    window.addEventListener(CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      window.removeEventListener(CHANGED_EVENT, load);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  /** One notification read — or every one, with no id. */
  const markRead = useCallback(async (id?: number) => {
    setItems((prev) =>
      prev.map((n) => (id === undefined || n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((count) => (id === undefined ? 0 : Math.max(0, count - 1)));
    await markNotificationsRead(id);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);

  /** Removes one notification for good (Dismiss). */
  const dismiss = useCallback(async (notification: AppNotification) => {
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    if (!notification.read) setUnreadCount((count) => Math.max(0, count - 1));
    await dismissNotification(notification.id);
    window.dispatchEvent(new Event(CHANGED_EVENT));
  }, []);

  return { items, unreadCount, load, markRead, dismiss };
}
