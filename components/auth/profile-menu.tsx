"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, LogOut, Settings } from "lucide-react";
import { usePortal } from "@/components/portal/portal-context";
import { logout } from "@/lib/auth/actions";
import { initials } from "@/lib/initials";
import { avatarColor } from "@/components/ui/list-table";

const ITEM =
  "flex w-full cursor-pointer items-center gap-2.5 rounded px-3 py-2 text-left text-sm transition";

/**
 * The signed-in user's initials beside the notification bell — opens a
 * panel (same look as the bell's) with who they are, Settings, and Log
 * out.
 */
export function ProfileMenu() {
  const { basePath, user } = usePortal();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const userInitials = initials(user.name, user.email?.[0]?.toUpperCase() ?? "?");
  const displayName = user.name || user.email?.split("@")[0] || "";
  const profileColor = avatarColor(user.name || user.email || "?");

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

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label="Account"
        aria-expanded={open}
        className="flex cursor-pointer items-center gap-2 py-1 pr-1.5 pl-1 text-sm font-medium text-zinc-700 transition hover:text-zinc-900"
      >
        <span className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${profileColor}`}>
          {userInitials}
        </span>
        {/* Name, and their role under it. */}
        <span className="flex min-w-0 flex-col items-start leading-tight">
          <span className="max-w-48 truncate" title={displayName}>
            {displayName}
          </span>
          <span className="max-w-48 truncate text-xs font-normal text-zinc-400">
            {user.roleLabel}
          </span>
        </span>
        <ChevronDown
          className={`size-4 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-72 rounded-md border border-zinc-200 bg-white p-2 shadow-xl">
          <div className="flex items-center gap-3 border-b border-zinc-200 px-3 pt-2 pb-3">
            <span className={`flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${profileColor}`}>
              {userInitials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-900">
                {user.name || user.email}
              </p>
              {user.email && user.name && (
                <p className="truncate text-xs text-zinc-500">{user.email}</p>
              )}
              <p className="mt-0.5 text-[11px] font-medium text-zinc-400">{user.roleLabel}</p>
            </div>
          </div>

          <div className="flex flex-col pt-2">
            <Link
              href={`${basePath}/settings`}
              onClick={() => setOpen(false)}
              className={`${ITEM} text-zinc-700 hover:bg-zinc-50 hover:text-zinc-900`}
            >
              <Settings className="size-4 text-zinc-400" />
              Settings
            </Link>
            <form action={logout}>
              <button type="submit" className={`${ITEM} text-red-600 hover:bg-red-50`}>
                <LogOut className="size-4" />
                Log out
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
