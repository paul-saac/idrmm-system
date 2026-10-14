"use client";

import { ArrowUpRight, TrendingUp, XCircle } from "lucide-react";
import type { AppNotification } from "@/lib/notifications/actions";
import { initials } from "@/lib/initials";
import { notificationTime } from "@/lib/time-ago";

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

// Text sizes — "small" for the bell's panel, "base" for the dashboard card.
const TEXT = {
  base: { title: "text-sm", detail: "text-xs", button: "text-xs", time: "text-xs", empty: "text-sm" },
  small: {
    title: "text-xs",
    detail: "text-[11px]",
    button: "text-[11px]",
    time: "text-[11px]",
    empty: "text-xs",
  },
} as const;

type TextSize = keyof typeof TEXT;

/** One notification card — who did what (with their initials, badged
 * with what kind of notice it is), the project and day it's about, then
 * View Progress / Dismiss and when it happened. Unread ones carry a dot. */
function NotificationCard({
  notification,
  onOpen,
  onDismiss,
  textSize,
}: {
  notification: AppNotification;
  onOpen: (notification: AppNotification) => void;
  onDismiss: (notification: AppNotification) => void;
  textSize: TextSize;
}) {
  const text = TEXT[textSize];
  return (
    <li
      className={`rounded-md border border-zinc-200 p-4 ${
        notification.read ? "bg-white" : "bg-zinc-50"
      }`}
    >
      <span
        aria-label={notification.read ? undefined : "Unread"}
        className={`mb-2 block size-1.5 rounded-full ${
          notification.read ? "bg-transparent" : "bg-orange-500"
        }`}
      />
      <div className="flex items-start gap-3">
        <span className="relative shrink-0">
          <span className="flex size-9 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">
            {initials(notification.actorName)}
          </span>
          <span className="absolute -right-1 -bottom-1 flex size-4 items-center justify-center rounded-full border border-white bg-orange-100 text-orange-600">
            <TrendingUp className="size-2.5" />
          </span>
        </span>
        <div className="min-w-0">
          <p className={`${text.title} text-zinc-900`}>
            <span className="font-semibold">{notification.actorName ?? "Someone"}</span>{" "}
            overrode the progress of{" "}
            <span className="font-semibold">{notification.itemName}</span>
          </p>
          <p className={`mt-0.5 ${text.detail} text-zinc-500`}>
            {notification.projectName} · progress for {formatDay(notification.entryDate)}
          </p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => onOpen(notification)}
          className={`flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 ${text.button} font-medium text-white transition hover:bg-zinc-800`}
        >
          <ArrowUpRight className="size-3.5" />
          View Progress
        </button>
        <button
          type="button"
          onClick={() => onDismiss(notification)}
          className={`flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-1.5 ${text.button} font-medium text-zinc-500 transition hover:bg-zinc-50 hover:text-zinc-900`}
        >
          <XCircle className="size-3.5" />
          Dismiss
        </button>
        <span className={`ml-auto ${text.time} whitespace-nowrap text-zinc-400`}>
          {notificationTime(notification.createdAt)}
        </span>
      </div>
    </li>
  );
}

/** The bell's and the dashboard card's own list of notification cards. */
export function NotificationList({
  items,
  onOpen,
  onDismiss,
  emptyText = "No notifications.",
  textSize = "base",
  className = "",
}: {
  items: AppNotification[];
  onOpen: (notification: AppNotification) => void;
  onDismiss: (notification: AppNotification) => void;
  emptyText?: string;
  textSize?: TextSize;
  className?: string;
}) {
  if (items.length === 0) {
    return (
      <p className={`py-10 text-center ${TEXT[textSize].empty} text-zinc-400`}>{emptyText}</p>
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
          textSize={textSize}
        />
      ))}
    </ul>
  );
}
