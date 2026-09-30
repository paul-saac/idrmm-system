"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Folder, Users, BarChart3, Wrench } from "lucide-react";
import type { PortalBasePath } from "@/components/portal/portal-context";

// Paths are relative to the portal's own base path. Accounts is admin-only
// — a foreman only manages the projects assigned to them, not users.
const NAV_ITEMS = [
  { path: "", label: "Dashboard", icon: LayoutGrid, adminOnly: false },
  { path: "/projects", label: "Projects", icon: Folder, adminOnly: false },
  { path: "/accounts", label: "Accounts", icon: Users, adminOnly: true },
  { path: "/reports", label: "Reports", icon: BarChart3, adminOnly: false },
  { path: "/inventory", label: "Inventory", icon: Wrench, adminOnly: false },
];

export function PortalSidebar({
  basePath,
  name,
  email,
}: {
  basePath: PortalBasePath;
  name: string;
  email: string | null;
}) {
  const pathname = usePathname();
  const initials = getInitials(name, email);
  const isAdmin = basePath === "/admin";
  const navItems = NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly);

  // Sits collapsed (icon rail) at rest, expands on hover. No
  // localStorage here — unlike a click-to-toggle preference, "currently
  // hovered" isn't something to persist across page loads, it's just
  // mouse position, so plain useState is enough (and avoids the
  // server/client hydration mismatch a stored preference would need to
  // account for).
  const [collapsed, setCollapsed] = useState(true);

  return (
    // A normal flex item (not absolutely positioned) — its width
    // change pushes/reflows the main content area's flex-1 sibling
    // rather than floating over it. An overlay approach was tried first
    // but hid real page content underneath the expanded panel while
    // hovering, which is worse than a reflow on a dense dashboard like
    // this one's project detail page.
    //
    // bg-zinc-900 — the app's own warm #3B3939 "black" (see globals.css's
    // own --color-zinc-900 override), same token the project header and
    // every other "black" surface already use. The sidebar used to
    // deliberately keep Tailwind's original cold near-black (#222225)
    // instead, per an earlier explicit choice — now aligned per a later
    // explicit request instead.
    <aside
      onMouseEnter={() => setCollapsed(false)}
      onMouseLeave={() => setCollapsed(true)}
      // border-zinc-950 — the app's own slightly-darker warm black (see
      // globals.css), reads as a clean, visible edge against the
      // sidebar's own zinc-900 without introducing an unrelated color.
      className={`flex h-full shrink-0 flex-col border-r-2 border-zinc-950 bg-zinc-900 transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      <div
        className={`flex items-center gap-3 border-b border-white/10 px-5 py-5 ${
          collapsed ? "justify-center px-0" : ""
        }`}
      >
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-white">
          {initials}
        </div>
        <div
          className={`min-w-0 overflow-hidden transition-all duration-300 ease-in-out ${
            collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
          }`}
        >
          <p className="truncate text-sm font-semibold text-white">
            {name || (isAdmin ? "Admin" : "Foreman")}
          </p>
          <p className="truncate text-xs text-zinc-400">{email}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
        {navItems.map(({ path, label, icon: Icon }) => {
          const href = `${basePath}${path}`;
          const active =
            path === "" ? pathname === basePath : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                collapsed ? "justify-center px-0" : ""
              } ${
                active
                  ? "bg-zinc-800 font-semibold text-white"
                  : "font-medium text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              <Icon className="size-4 shrink-0" strokeWidth={active ? 2.5 : 2} />
              <span
                className={`overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out ${
                  collapsed ? "max-w-0 opacity-0" : "max-w-40 opacity-100"
                }`}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}

function getInitials(name: string, email: string | null) {
  const trimmed = name.trim();
  if (trimmed) {
    return trimmed
      .split(/\s+/)
      .map((part) => part[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  return email ? email[0]!.toUpperCase() : "A";
}
