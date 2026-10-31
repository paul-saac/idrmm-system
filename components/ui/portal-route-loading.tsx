"use client";

import { usePathname } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/page-header";

const PAGE_TITLES: Record<string, string> = {
  projects: "Projects",
  team: "Team",
  accounts: "Manage Accounts",
  inventory: "Tools and Equipment",
  reports: "Reports",
};

const PAGE_DESCRIPTIONS: Partial<Record<string, string>> = {
  projects: "An overview of your projects.",
  reports: "Per-project cost, progress, and expense reporting.",
};

function SkeletonLine({ className = "" }: { className?: string }) {
  return <span className={`block h-2.5 rounded bg-zinc-200 ${className}`} />;
}

function LoadingRow() {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className="size-9 shrink-0 rounded-md bg-zinc-200" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <SkeletonLine className="w-2/5" />
        <SkeletonLine className="w-3/5" />
      </div>
    </div>
  );
}

function ToolbarSkeleton({ title = true }: { title?: boolean }) {
  return (
    <div className="flex h-10 items-center gap-3">
      {title && <SkeletonLine className="w-28" />}
      <span className="ml-auto h-9 w-72 max-w-[40%] rounded-md bg-zinc-200" />
      <span className="h-9 w-24 rounded-md bg-zinc-200" />
      <span className="h-9 w-28 rounded-md bg-zinc-200" />
    </div>
  );
}

function TableSkeleton({ rows = 7 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="grid h-11 grid-cols-[3rem_1.4fr_1fr_1fr_8rem] items-center gap-4 border-b border-zinc-200 bg-zinc-50 px-4">
        {Array.from({ length: 5 }, (_, index) => (
          <SkeletonLine key={index} className={index === 0 ? "w-4" : "w-2/3"} />
        ))}
      </div>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="grid h-16 grid-cols-[3rem_1.4fr_1fr_1fr_8rem] items-center gap-4 border-b border-zinc-100 px-4 last:border-0">
          <span className="size-4 rounded-sm bg-zinc-200" />
          <div className="flex items-center gap-3">
            <span className="size-8 rounded-[1px] bg-zinc-200" />
            <SkeletonLine className="w-28" />
          </div>
          <SkeletonLine className="w-3/4" />
          <SkeletonLine className="w-2/3" />
          <SkeletonLine className="w-16" />
        </div>
      ))}
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {Array.from({ length: 4 }, (_, index) => (
        <div key={index} className="rounded-lg border border-zinc-200 bg-white p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-1 flex-col gap-3">
              <SkeletonLine className="w-2/3" />
              <span className="block h-7 w-16 rounded bg-zinc-200" />
            </div>
            <span className="size-10 rounded-md bg-zinc-200" />
          </div>
        </div>
      ))}
    </div>
  );
}

function DashboardSkeleton({ showApprovals }: { showApprovals: boolean }) {
  return (
    <>
      <StatsSkeleton />
      <div className="mt-5 grid min-h-80 grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2.25fr)_minmax(19rem,1fr)]">
        <div className="flex flex-col gap-5">
          {[3, 2].map((rows) => (
            <section key={rows} className="rounded border border-zinc-200 bg-white p-5">
              <SkeletonLine className="mb-4 w-32" />
              {Array.from({ length: rows }, (_, index) => <LoadingRow key={index} />)}
            </section>
          ))}
        </div>
        <div className="flex flex-col gap-5">
          {showApprovals && <section className="rounded border border-zinc-200 bg-white p-5">
            <SkeletonLine className="mb-4 w-32" />
            <LoadingRow /><LoadingRow /><LoadingRow />
          </section>}
          <section className="rounded border border-zinc-200 bg-white p-5">
            <SkeletonLine className="mb-4 w-24" />
            <div className="grid grid-cols-7 gap-2">{Array.from({ length: 42 }, (_, index) => <span key={index} className="mx-auto size-6 rounded-full bg-zinc-100" />)}</div>
          </section>
          <section className="rounded border border-zinc-200 bg-white p-5">
            <SkeletonLine className="mb-4 w-24" />
            <div className="grid grid-cols-2 gap-3">
              <span className="h-16 rounded-md bg-zinc-200" />
              <span className="h-16 rounded-md bg-zinc-200" />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function ProjectsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <ToolbarSkeleton />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="h-56 rounded-lg border border-zinc-200 bg-white p-5">
            <div className="flex items-start justify-between"><SkeletonLine className="w-40" /><span className="h-5 w-16 rounded bg-zinc-200" /></div>
            <SkeletonLine className="mt-3 w-56" />
            <div className="mt-8 grid grid-cols-2 gap-5"><SkeletonLine className="w-28" /><SkeletonLine className="w-24" /></div>
            <span className="mt-7 block h-2 w-full rounded-full bg-zinc-200" />
          </div>
        ))}
      </div>
    </div>
  );
}

function TeamSkeleton() {
  return (
    <div className="-mx-8 -my-6 grid min-h-[42rem] lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="border-r border-zinc-200 bg-white p-6">
        <SkeletonLine className="mb-6 w-24" />
        {Array.from({ length: 6 }, (_, index) => <SkeletonLine key={index} className="mb-5 w-3/4" />)}
      </aside>
      <div className="flex min-w-0 flex-col gap-3 p-8">
        <ToolbarSkeleton />
        <div className="h-14 rounded-t-lg border border-zinc-200 bg-white px-6 py-5"><SkeletonLine className="w-1/2" /></div>
        <div className="-mt-3"><TableSkeleton rows={8} /></div>
      </div>
    </div>
  );
}

function AccountsSkeleton() {
  return <div className="flex flex-col gap-4"><StatsSkeleton /><ToolbarSkeleton /><TableSkeleton rows={7} /></div>;
}

function InventorySkeleton() {
  return <div className="flex flex-col gap-4"><ToolbarSkeleton title={false} /><TableSkeleton rows={8} /></div>;
}

function ReportsSkeleton() {
  return (
    <div className="-mx-8 -my-6 flex min-h-[42rem] bg-white">
      <aside className="w-64 shrink-0 border-r border-zinc-200 py-5">
        <SkeletonLine className="mx-6 mb-6 w-24" />
        {Array.from({ length: 7 }, (_, index) => <span key={index} className="mx-3 mb-2 block h-10 rounded bg-zinc-100" />)}
      </aside>
      <div className="min-w-0 flex-1">
        <div className="border-b border-zinc-200 px-8 py-5"><SkeletonLine className="w-48" /><SkeletonLine className="mt-3 w-80" /></div>
        <div className="grid gap-8 p-8 xl:grid-cols-2">
          <div className="flex flex-col gap-5">{Array.from({ length: 5 }, (_, index) => <span key={index} className="h-10 rounded-md bg-zinc-200" />)}</div>
          <div className="border-l border-zinc-200 pl-8">{Array.from({ length: 7 }, (_, index) => <SkeletonLine key={index} className="mb-5 w-2/3" />)}</div>
        </div>
      </div>
    </div>
  );
}

function RouteSkeleton({ section, isAdmin }: { section: string; isAdmin: boolean }) {
  if (section === "projects") return <ProjectsSkeleton />;
  if (section === "team") return <TeamSkeleton />;
  if (section === "accounts") return <AccountsSkeleton />;
  if (section === "inventory") return <InventorySkeleton />;
  if (section === "reports") return <ReportsSkeleton />;
  return <DashboardSkeleton showApprovals={isAdmin} />;
}

/** Keeps the real header usable while only the destination content is
 * represented by a lightweight loading skeleton. */
export function PortalRouteLoading() {
  const pathname = usePathname();
  const [portal, targetSection = ""] = pathname.split("/").filter(Boolean);
  const isAdmin = portal === "admin";
  const section = targetSection === "accounts" && !isAdmin ? "" : targetSection;
  const title = PAGE_TITLES[section] ?? "Dashboard";

  return (
    <>
      <AdminPageHeader title={title} description={PAGE_DESCRIPTIONS[section]} />
      <main
        className="relative min-h-0 flex-1 overflow-hidden bg-zinc-50 px-8 py-6"
        role="status"
        aria-live="polite"
        aria-label={`Loading ${title}`}
      >
        <div className="absolute inset-x-0 top-0 h-0.5 overflow-hidden bg-zinc-200">
          <span className="route-progress-indicator block h-full rounded-r-full bg-zinc-900" />
        </div>

        <div className="animate-pulse" aria-hidden>
          <RouteSkeleton section={section} isAdmin={isAdmin} />
        </div>
        <span className="sr-only">Loading {title}…</span>
      </main>
    </>
  );
}
