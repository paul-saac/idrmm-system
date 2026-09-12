"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Folder,
  Users,
  BarChart3,
  Wrench,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutGrid },
  { href: "/admin/projects", label: "Projects", icon: Folder },
  { href: "/admin/accounts", label: "Accounts", icon: Users },
  { href: "/admin/reports", label: "Reports", icon: BarChart3 },
  { href: "/admin/inventory", label: "Inventory", icon: Wrench },
];

export function AdminSidebar({
  name,
  email,
}: {
  name: string;
  email: string | null;
}) {
  const pathname = usePathname();
  const initials = getInitials(name, email);

  return (
    // Explicit Tailwind-default zinc-900 rather than the `bg-zinc-900`
    // utility — globals.css remaps that token to the app's warmer
    // #3B3939 "black", but the sidebar keeps the original cold near-black.
    <aside className="flex h-full w-64 flex-shrink-0 flex-col bg-[#18181b]">
      <div className="flex items-center gap-3 border-b border-white/10 px-5 py-5">
        <div className="flex size-9 flex-shrink-0 items-center justify-center rounded-full bg-zinc-700 text-sm font-semibold text-white">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white">
            {name || "Admin"}
          </p>
          <p className="truncate text-xs text-zinc-400">{email}</p>
        </div>
      </div>

      <nav className="flex flex-1 flex-col gap-1 overflow-y-auto px-3 py-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active =
            href === "/admin"
              ? pathname === "/admin"
              : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition ${
                active
                  ? "bg-zinc-800 font-semibold text-white"
                  : "font-medium text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              <Icon className="size-4" strokeWidth={active ? 2.5 : 2} />
              {label}
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
