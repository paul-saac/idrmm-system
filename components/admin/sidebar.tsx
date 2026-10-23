"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutGrid, Folder, HardHat, Users, FileText, Wrench } from "lucide-react";
import type { PortalBasePath } from "@/components/portal/portal-context";

// Paths are relative to the portal's own base path, each item in the
// portals that have it: a foreman manages the projects assigned to them,
// not the company's people or users; a project manager's portal so far
// is the Team (members to view, groups to manage).
const NAV_ITEMS: {
  path: string;
  label: string;
  icon: typeof LayoutGrid;
  portals: PortalBasePath[];
}[] = [
  { path: "", label: "Dashboard", icon: LayoutGrid, portals: ["/admin", "/foreman", "/project-manager"] },
  { path: "/projects", label: "Projects", icon: Folder, portals: ["/admin", "/foreman", "/project-manager"] },
  { path: "/team", label: "Team", icon: HardHat, portals: ["/admin", "/project-manager"] },
  { path: "/accounts", label: "Accounts", icon: Users, portals: ["/admin"] },
  { path: "/inventory", label: "Inventory", icon: Wrench, portals: ["/admin", "/foreman", "/project-manager"] },
  { path: "/reports", label: "Reports", icon: FileText, portals: ["/admin", "/foreman", "/project-manager"] },
];

export function PortalSidebar({ basePath }: { basePath: PortalBasePath }) {
  const pathname = usePathname();
  const navItems = NAV_ITEMS.filter((item) => item.portals.includes(basePath));

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
      // border-black/20 — its own black a shade darker along the edge, so
      // it stays apart from the content even beside a dark header (the
      // project page's) of the very same black.
      className={`flex h-full shrink-0 flex-col border-r-2 border-black/20 bg-zinc-900 transition-[width] duration-300 ease-in-out ${
        collapsed ? "w-20" : "w-64"
      }`}
    >
      {/* The company's own name — who's signed in lives in the page
          header's profile menu now; same serif as the login page. The
          whole row folds away (height, padding, border) along with the
          sidebar's own width, so the nav slides up into its space while
          collapsed and back down once hovered. */}
      <div
        className={`flex items-center overflow-hidden border-b px-5 transition-all duration-300 ease-in-out ${
          collapsed
            ? "max-h-0 border-transparent py-0 opacity-0"
            : "max-h-24 border-white/10 py-5 opacity-100"
        }`}
      >
        <p className="flex h-9 min-w-0 items-center truncate font-serif text-xl whitespace-nowrap text-white">
          IDR M&amp;M
        </p>
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
                  ? "bg-white/10 font-semibold text-white"
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
