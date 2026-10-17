import Link from "next/link";
import type { PortalBasePath } from "@/components/portal/portal-context";
import type { PendingRequest } from "@/lib/dashboard/data";

const PRIORITY_STYLE = {
  urgent: "bg-amber-50 text-amber-700",
  emergency: "bg-red-50 text-red-600",
} as const;

function formatDate(iso: string) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Material and equipment requests still waiting on approval, newest
 * first — each opens its own request. */
export function PendingApprovalsCard({
  basePath,
  items,
  total,
}: {
  basePath: PortalBasePath;
  items: PendingRequest[];
  total: number;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">Pending Approvals</h2>
        <span className="rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
          {total}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing waiting on approval.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-sm font-medium text-zinc-900">
                  <span className="truncate">
                    {item.number} · {item.kind === "material" ? "Materials" : "Equipment"}
                  </span>
                  {item.priority !== "routine" && (
                    <span
                      className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[10px] font-semibold capitalize ${PRIORITY_STYLE[item.priority]}`}
                    >
                      {item.priority}
                    </span>
                  )}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {[item.projectName, item.requestedByName, formatDate(item.requestDate)]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <Link
                href={
                  // A material request opens in its row of the project's
                  // Materials tab; an equipment one has its own page.
                  item.kind === "material"
                    ? `${basePath}/projects/${item.projectId}?tab=materials&subtab=requests&request=${item.id}`
                    : `${basePath}/projects/${item.projectId}/equipment/requests/${item.id}`
                }
                className="shrink-0 rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
