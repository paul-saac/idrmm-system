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
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="mb-4 text-sm font-semibold text-zinc-900">Recent Activity</h2>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No recent activity yet.</p>
      ) : (
        <ul className="-mx-2 flex flex-col gap-1">
          {items.map((item) => {
            const Icon = ICON[item.kind];
            const actor = item.actorName ?? (item.kind === "project" ? null : "Someone");
            return (
              <li key={item.key}>
                <Link
                  href={`${basePath}/projects/${item.projectId}${item.path}`}
                  className="flex gap-3 rounded-md px-2 py-2 transition hover:bg-zinc-50"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                    <Icon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-zinc-900">
                      {actor && <span className="font-semibold text-zinc-900">{actor} </span>}
                      {item.action}
                    </p>
                    <p className="mt-0.5 text-xs text-zinc-400">
                      {item.projectName} · {timeAgo(item.at)}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
