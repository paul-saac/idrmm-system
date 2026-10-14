"use server";

import { createClient } from "@/lib/supabase/server";
import { getSessionProfile } from "@/lib/auth/session";

/** One notification in the bell — see 0061_notifications.sql. */
export type AppNotification = {
  id: number;
  actorName: string | null;
  projectId: number;
  projectName: string;
  itemKind: "task" | "category";
  itemId: number;
  itemName: string;
  /** The day whose progress was overridden, YYYY-MM-DD. */
  entryDate: string;
  read: boolean;
  createdAt: string;
};

// The bell shows the latest ones; older ones simply drop off its list.
const LIST_SIZE = 30;

/** The signed-in user's latest notifications and how many are unread —
 * both empty until 0061 has run. */
export async function listMyNotifications(): Promise<{
  items: AppNotification[];
  unreadCount: number;
}> {
  const profile = await getSessionProfile();
  if (!profile) return { items: [], unreadCount: 0 };

  const supabase = await createClient();
  const [{ data }, { count }] = await Promise.all([
    supabase
      .from("notifications")
      .select("*")
      .eq("recipient_id", profile.id)
      .order("created_at", { ascending: false })
      .limit(LIST_SIZE),
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", profile.id)
      .is("read_at", null),
  ]);

  return {
    items: (data ?? []).map((row) => ({
      id: row.id,
      actorName: row.actor_name,
      projectId: row.project_id,
      projectName: row.project_name,
      itemKind: row.item_kind,
      itemId: row.item_id,
      itemName: row.item_name,
      entryDate: row.entry_date,
      read: row.read_at !== null,
      createdAt: row.created_at,
    })),
    unreadCount: count ?? 0,
  };
}

/** Marks one of the user's notifications read — or all of them, with no
 * id. RLS keeps it to their own either way. */
export async function markNotificationsRead(id?: number): Promise<void> {
  const profile = await getSessionProfile();
  if (!profile) return;

  const supabase = await createClient();
  let query = supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("recipient_id", profile.id)
    .is("read_at", null);
  if (id !== undefined) query = query.eq("id", id);
  const { error } = await query;
  if (error) {
    console.error("[markNotificationsRead] Supabase update failed", {
      message: error.message,
      code: error.code,
    });
  }
}

/** Removes one of the user's notifications (Dismiss). RLS keeps it to
 * their own. */
export async function dismissNotification(id: number): Promise<void> {
  const profile = await getSessionProfile();
  if (!profile) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("notifications")
    .delete()
    .eq("id", id)
    .eq("recipient_id", profile.id);
  if (error) {
    console.error("[dismissNotification] Supabase delete failed", {
      message: error.message,
      code: error.code,
    });
  }
}
