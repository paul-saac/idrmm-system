"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Flag, Mail, MoreHorizontal, Package, Trash2, TrendingUp, Wrench } from "lucide-react";
import type { AppNotification } from "@/lib/notifications/actions";
import { initials } from "@/lib/initials";
import { avatarColor } from "@/components/ui/list-table";
import { EmptyState } from "@/components/ui/empty-state";
import { notificationTime } from "@/lib/time-ago";

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Text sizes — "small" for the bell's panel, "base" for the dashboard card.
const TEXT = {
  base: { title: "text-sm", detail: "text-xs", time: "text-xs", empty: "text-sm" },
  small: {
    title: "text-xs",
    detail: "text-[11px]",
    time: "text-[11px]",
    empty: "text-xs",
  },
} as const;

type TextSize = keyof typeof TEXT;

/** One notification card — who did what (with their initials, badged
 * with what kind of notice it is), the project and day it's about, then
 * when it happened. The card opens the record; its overflow menu owns
 * read/unread and deletion actions. Unread ones carry a dot. */
function NotificationCard({
  notification,
  onOpen,
  onDismiss,
  onMarkRead,
  onMarkUnread,
  textSize,
}: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDismiss: (notification: AppNotification) => void;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
  textSize: TextSize;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const text = TEXT[textSize];
  const request = notification.kind !== "progress_override";
  const sheet = notification.kind === "sheet_submitted";
  const incident = notification.kind === "safety_incident";
  const Icon = incident ? Flag : notification.kind === "material_request" ? Package : notification.kind === "equipment_request" ? Wrench : TrendingUp;

  useEffect(() => {
    if (!menuOpen) return;
    function closeMenu(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [menuOpen]);

  return (
    <li
      role="button"
      tabIndex={0}
      onClick={() => onOpen(notification)}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen(notification);
        }
      }}
      className={`cursor-pointer rounded-md border border-zinc-200 p-4 transition hover:bg-zinc-50 ${
        notification.read ? "bg-white" : "bg-zinc-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <span className={`flex size-9 items-center justify-center rounded-[1px] text-xs font-semibold ${avatarColor(notification.actorName ?? "?")}`}>
            {initials(notification.actorName)}
          </span>
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-[1px] border border-white bg-orange-100 text-orange-600">
            <Icon className="size-2.5" />
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <p className={`${text.title} text-zinc-900`}>
            {!incident && <><span className="font-semibold">{notification.actorName ?? "Someone"}</span>{" "}</>}
            {incident ? "Reported a safety incident: " : sheet ? "uploaded a document for admin review: " : request ? `submitted ${notification.kind === "material_request" ? "material" : "equipment"} request ` : "overrode the progress of "}
            <span className="font-semibold">{notification.itemName}</span>
          </p>
          <p className={`mt-0.5 ${text.detail} text-zinc-500`}>
            {notification.projectName} · {incident ? "occurred" : request ? "requested" : "progress for"} {formatDay(notification.entryDate)}
          </p>
          <p className={`mt-1 ${text.time} text-zinc-400`}>
            {notificationTime(notification.createdAt)}
          </p>
        </div>
        <div ref={menuRef} className="relative flex shrink-0 items-center gap-2">
          {!notification.read && (
            <span
              aria-label="Unread"
              className="block size-2 min-h-2 min-w-2 shrink-0 rounded-full bg-zinc-700"
            />
          )}
          <button
            type="button"
            aria-label="Notification actions"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((value) => !value);
            }}
            className="cursor-pointer rounded p-1 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900"
          >
            <MoreHorizontal className="size-4" />
          </button>
          {menuOpen && (
            <div role="menu" className="absolute top-full right-0 z-20 mt-1 w-44 overflow-hidden rounded-md border border-zinc-200 bg-white py-1 shadow-lg">
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  if (notification.read) onMarkUnread(notification.id);
                  else onMarkRead(notification.id);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-zinc-700 hover:bg-zinc-50"
              >
                {notification.read ? <Mail className="size-3.5" /> : <Check className="size-3.5" />}
                {notification.read ? "Mark as unread" : "Mark as read"}
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen(false);
                  onDismiss(notification);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" />
                Delete notification
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

/** The bell's and the dashboard card's own list of notification cards. */
export function NotificationList({
  items,
  onOpen,
  onDismiss,
  onMarkRead,
  onMarkUnread,
  emptyText = "No notifications.",
  textSize = "base",
  className = "",
}: {
  items: AppNotification[];
  onOpen: (notification: AppNotification) => void;
  onDismiss: (notification: AppNotification) => void;
  onMarkRead: (id: number) => void;
  onMarkUnread: (id: number) => void;
  emptyText?: string;
  textSize?: TextSize;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <EmptyState compact={textSize === "small"} className={`py-10 ${className}`}>{emptyText}</EmptyState>
    );
  }
  return (
    <ul className={`flex flex-col gap-3 ${className}`}>
      {items.map((notification) => (
        <NotificationCard
          key={notification.id}
          notification={notification}
          onOpen={onOpen}
          onDismiss={onDismiss}
          onMarkRead={onMarkRead}
          onMarkUnread={onMarkUnread}
          textSize={textSize}
        />
      ))}
    </ul>
  );
}
