"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { createClient } from "@/lib/supabase/client";
import {
  dismissNotification,
  listMyNotifications,
  markNotificationUnread,
  markNotificationsRead,
  type AppNotification,
} from "@/lib/notifications/actions";

type Notifications = {
  items: AppNotification[];
  unreadCount: number;
  load: () => void;
  /** One notification read — or every one, with no id. */
  markRead: (id?: number) => Promise<void>;
  markUnread: (id: number) => Promise<void>;
  /** Removes one notification for good (Dismiss). */
  dismiss: (notification: AppNotification) => Promise<void>;
};

const NotificationsContext = createContext<Notifications | null>(null);

/**
 * The signed-in user's notifications (see 0061_notifications.sql), held
 * once for the whole portal — PortalProvider wraps every page in it, and
 * the portal layout outlives page changes, so the bell (redrawn with each
 * page's own header) never starts over empty and blinks its dot out and
 * back. Loaded on mount and whenever the window regains focus, and live on
 * every new one (Supabase Realtime).
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
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
    return () => {
      cancelled = true;
      window.removeEventListener("focus", load);
      if (channel) supabase.removeChannel(channel);
    };
  }, [load, instanceId]);

  const markRead = useCallback(async (id?: number) => {
    setItems((prev) =>
      prev.map((n) => (id === undefined || n.id === id ? { ...n, read: true } : n))
    );
    setUnreadCount((count) => (id === undefined ? 0 : Math.max(0, count - 1)));
    await markNotificationsRead(id);
  }, []);

  const dismiss = useCallback(async (notification: AppNotification) => {
    setItems((prev) => prev.filter((n) => n.id !== notification.id));
    if (!notification.read) setUnreadCount((count) => Math.max(0, count - 1));
    await dismissNotification(notification.id);
  }, []);

  const markUnread = useCallback(async (id: number) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: false } : n)));
    setUnreadCount((count) => count + 1);
    await markNotificationUnread(id);
  }, []);

  const value = useMemo(
    () => ({ items, unreadCount, load, markRead, markUnread, dismiss }),
    [items, unreadCount, load, markRead, markUnread, dismiss]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

/** The portal's own notifications — see NotificationsProvider. */
export function useNotifications(): Notifications {
  const value = useContext(NotificationsContext);
  if (!value) {
    throw new Error("useNotifications must be used inside a NotificationsProvider (see PortalProvider).");
  }
  return value;
}
