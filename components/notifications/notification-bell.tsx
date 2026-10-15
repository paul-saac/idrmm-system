"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { usePortal } from "@/components/portal/portal-context";
import { NotificationList } from "@/components/notifications/notification-list";
import { useNotifications } from "@/components/notifications/notifications-provider";
import type { AppNotification } from "@/lib/notifications/actions";
import { dateBucket } from "@/lib/time-ago";

type Tab = "all" | "unread";
type Range = "today" | "yesterday" | "week";

const RANGES: { value: Range; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "yesterday", label: "Yesterday" },
  { value: "week", label: "Last 7 Days" },
];

/**
 * The bell beside Log out — the signed-in user's notifications (see
 * useNotifications) in a panel: All/Unread, an optional date filter
 * (click the active one again to clear it), each notification's own card
 * (View Progress opens the project's page — its Overview, where the Gantt
 * chart is — and marks it read; Dismiss removes it), then a link to the
 * dashboard's activity and Mark all as read.
 */
export function NotificationBell() {
  const router = useRouter();
  const { basePath } = usePortal();
  const { items, unreadCount, load, markRead, dismiss } = useNotifications();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [range, setRange] = useState<Range | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const visible = useMemo(
    () =>
      items.filter((notification) => {
        if (tab === "unread" && notification.read) return false;
        if (!range) return true;
        const bucket = dateBucket(notification.createdAt);
        return range === "week" ? bucket !== null : bucket === range;
      }),
    [items, tab, range]
  );

  function toggle() {
    if (!open) load();
    setOpen((value) => !value);
  }

  async function openNotification(notification: AppNotification) {
    setOpen(false);
    if (!notification.read) await markRead(notification.id);
    // Opens that row's Daily Progress Update, its Last override highlighted
    // (see GanttChartView's own ?progress handling).
    router.push(
      `${basePath}/projects/${notification.projectId}?progress=${notification.itemKind}-${notification.itemId}`
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label={unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-expanded={open}
        className="flex size-10 cursor-pointer items-center justify-center text-zinc-400 transition hover:text-zinc-700"
      >
        {/* A red badge with the unread count (99+ past that) on the bell's
            own top-right — no ring, since headers differ in background
            (white, or the project page's zinc-50) and a ring would show as
            a halo on one of them. The button's aria-label already says the
            count, so the badge is hidden from screen readers. */}
        <span className="relative flex">
          <Bell className="size-5" />
          {unreadCount > 0 && (
            <span
              aria-hidden
              className="absolute -top-1.5 -right-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] leading-none font-semibold text-white tabular-nums"
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </span>
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-160 max-w-[calc(100vw-2rem)] rounded-md border border-zinc-200 bg-white p-6 shadow-xl">
          <h2 className="text-lg font-semibold tracking-tight text-zinc-900">Notifications</h2>

          <div className="mt-5 flex items-center justify-between gap-3 border-b border-zinc-200 pb-5">
            <div className="flex rounded bg-zinc-100 p-1">
              {(["all", "unread"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  aria-pressed={tab === value}
                  className={`cursor-pointer rounded-sm px-5 py-1.5 text-xs transition ${
                    tab === value
                      ? "bg-white font-medium text-zinc-900 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-900"
                  }`}
                >
                  {value === "all" ? "All" : "Unread"}
                </button>
              ))}
            </div>
            <div className="flex items-center text-xs">
              {RANGES.map((option, index) => (
                <Fragment key={option.value}>
                  {index > 0 && <span aria-hidden className="mx-2 h-4 w-px bg-zinc-200" />}
                  <button
                    type="button"
                    onClick={() =>
                      setRange((current) => (current === option.value ? null : option.value))
                    }
                    aria-pressed={range === option.value}
                    className={`cursor-pointer whitespace-nowrap transition ${
                      range === option.value
                        ? "font-medium text-zinc-900"
                        : "text-zinc-400 hover:text-zinc-700"
                    }`}
                  >
                    {option.label}
                  </button>
                </Fragment>
              ))}
            </div>
          </div>

          <NotificationList
            items={visible}
            onOpen={openNotification}
            onDismiss={dismiss}
            emptyText={
              tab === "unread"
                ? "No unread notifications."
                : range
                  ? "Nothing in this period."
                  : "No notifications."
            }
            textSize="small"
            className="mt-5 max-h-160 overflow-y-auto pr-1"
          />

          <div className="mt-5 flex items-center justify-between border-t border-zinc-200 pt-4 text-xs">
            <Link
              href={basePath}
              onClick={() => setOpen(false)}
              className="text-zinc-500 transition hover:text-zinc-900"
            >
              See all activities
            </Link>
            <button
              type="button"
              onClick={() => markRead()}
              disabled={unreadCount === 0}
              className="flex cursor-pointer items-center gap-1.5 font-medium text-zinc-700 transition hover:text-zinc-900 disabled:cursor-default disabled:text-zinc-300"
            >
              <CheckCheck className="size-4" />
              Mark all as read
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
