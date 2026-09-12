import Link from "next/link";

export function RecentActivityCard({
  items,
}: {
  items: { id: string; message: string; meta: string }[];
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-900">
          Recent Activity
        </h2>
        <Link
          href="/admin/reports"
          className="text-xs font-medium text-zinc-500 hover:text-zinc-900"
        >
          See all
        </Link>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No recent activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li key={item.id} className="flex gap-3">
              <span className="mt-0.5 size-8 flex-shrink-0 rounded-md bg-zinc-100" />
              <div className="min-w-0">
                <p className="text-sm text-zinc-800">{item.message}</p>
                <p className="mt-0.5 text-xs text-zinc-400">{item.meta}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
