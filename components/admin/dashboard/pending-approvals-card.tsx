import { ClipboardCheck } from "lucide-react";
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
    <section className="overflow-hidden rounded border border-zinc-200 bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-200 px-5 py-4">
        <h2 className="text-sm font-semibold text-zinc-900">Pending approvals</h2>
        <span className="text-xs tabular-nums text-zinc-400">
          {total}
        </span>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center px-5 py-6 text-center">
          <span className="mb-3 flex size-9 items-center justify-center rounded bg-zinc-100 text-zinc-400">
            <ClipboardCheck className="size-5" strokeWidth={1.5} aria-hidden="true" />
          </span>
          <p className="text-xs font-medium text-zinc-800">You&apos;re all caught up</p>
          <p className="mt-1 text-[11px] text-zinc-400">Nothing waiting on approval.</p>
        </div>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {items.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex items-center justify-between gap-3 px-5 py-4"
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
                // A request opens in its row of the project's Materials or
                // Equipment tab.
                href={`${basePath}/projects/${item.projectId}?tab=${
                  item.kind === "material" ? "materials" : "equipment"
                }&subtab=requests&request=${item.id}`}
                className="shrink-0 rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                View
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
