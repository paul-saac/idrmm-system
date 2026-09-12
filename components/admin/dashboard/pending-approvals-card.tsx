export function PendingApprovalsCard({
  items,
}: {
  items: { id: string; title: string; subtitle: string }[];
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5">
      <div className="mb-4 flex items-center gap-2">
        <h2 className="text-sm font-semibold text-zinc-900">
          Pending Approvals
        </h2>
        <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
          {items.length}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">
          Nothing waiting on you right now.
        </p>
      ) : (
        <ul className="flex flex-col gap-4">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-zinc-900">
                  {item.title}
                </p>
                <p className="truncate text-xs text-zinc-500">
                  {item.subtitle}
                </p>
              </div>
              <button
                type="button"
                disabled
                title="Coming soon"
                className="flex-shrink-0 rounded border border-zinc-200 px-3 py-1 text-xs font-medium text-zinc-400"
              >
                View
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
