import Link from "next/link";
import type { PortalBasePath } from "@/components/portal/portal-context";
import type { DashboardData } from "@/lib/dashboard/data";

type Segment = { label: string; value: number; color: string };

/** One resource's split — a stacked bar and its counts. */
function ResourceRow({
  title,
  href,
  total,
  segments,
}: {
  title: string;
  href: string | null;
  total: number;
  segments: Segment[];
}) {
  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        {href ? (
          <Link href={href} className="font-medium text-zinc-900 hover:underline">
            {title}
          </Link>
        ) : (
          <span className="font-medium text-zinc-900">{title}</span>
        )}
        <span className="text-xs text-zinc-500">{total} total</span>
      </div>
      <div className="mt-2 flex h-1.5 w-full overflow-hidden rounded-sm bg-zinc-100">
        {total > 0 &&
          segments.map((segment) => (
            <div
              key={segment.label}
              className={segment.color}
              style={{ width: `${(segment.value / total) * 100}%` }}
            />
          ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500">
        {segments.map((segment) => (
          <span key={segment.label} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${segment.color}`} />
            {segment.label} <span className="font-medium text-zinc-900">{segment.value}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Who and what's free right now — the Team's availability and the
 * equipment inventory's status. */
export function ResourcesCard({
  basePath,
  isAdmin,
  team,
  equipment,
}: {
  basePath: PortalBasePath;
  isAdmin: boolean;
  team: DashboardData["team"];
  equipment: DashboardData["equipment"];
}) {
  return (
    <div className="flex flex-col gap-5 rounded-lg border border-zinc-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-zinc-900">Resources</h2>
      <ResourceRow
        title="Team"
        href={isAdmin ? "/admin/team" : null}
        total={team.total}
        segments={[
          { label: "Available", value: team.available, color: "bg-emerald-500" },
          { label: "Assigned", value: team.assigned, color: "bg-amber-500" },
        ]}
      />
      <ResourceRow
        title="Equipment"
        href={`${basePath}/inventory`}
        total={equipment.total}
        segments={[
          { label: "Available", value: equipment.available, color: "bg-emerald-500" },
          { label: "Assigned", value: equipment.assigned, color: "bg-amber-500" },
          { label: "Maintenance", value: equipment.maintenance, color: "bg-red-500" },
        ]}
      />
    </div>
  );
}
