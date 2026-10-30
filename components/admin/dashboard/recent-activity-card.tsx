import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { FolderPlus, PackageSearch, TrendingUp, Wrench } from "lucide-react";
import type { PortalBasePath } from "@/components/portal/portal-context";
import type { ActivityItem } from "@/lib/dashboard/data";
import { timeAgo } from "@/lib/time-ago";

const ICON = {
  progress: TrendingUp,
  material_request: PackageSearch,
  equipment_request: Wrench,
  project: FolderPlus,
} as const;

/** The latest things done across the projects — progress updates,
 * material and equipment requests, new projects — each opening where it
 * happened. */
export function RecentActivityCard({
  basePath,
  items,
}: {
  basePath: PortalBasePath;
  items: ActivityItem[];
}) {
  return (
    <section className="overflow-hidden rounded border border-zinc-200 bg-white">
      <h2 className="border-b border-zinc-200 px-5 py-4 text-sm font-semibold text-zinc-900">Recent activity</h2>

      {items.length === 0 ? (
        <EmptyState compact className="px-5 py-6 text-sm text-zinc-500">No recent activity yet.</EmptyState>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => {
            const Icon = ICON[item.kind];
            const actor = item.actorName ?? (item.kind === "project" ? null : "Someone");
            return (
              <li key={item.key}>
                <Link
                  href={`${basePath}/projects/${item.projectId}${item.path}`}
                  className="flex items-start gap-3 px-5 py-4 transition hover:bg-zinc-50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-zinc-900">
                      {actor && <span className="font-semibold text-zinc-900">{actor} </span>}
                      {item.action}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {item.projectName}
                    </p>
                  </div>
                  <time dateTime={item.at} className="shrink-0 pt-0.5 text-[11px] text-zinc-400">{timeAgo(item.at)}</time>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
