type ActiveProject = {
  name: string;
  address: string;
  completion: number;
  budget: number;
  spent: number;
  remaining: number;
};

function formatCurrency(amount: number) {
  return `₱${amount.toLocaleString("en-PH")}`;
}

export function ActiveProjectCard({
  project,
}: {
  project: ActiveProject | null;
}) {
  if (!project) {
    return (
      <div className="rounded-lg border border-zinc-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold text-zinc-900">
          Active Project
        </h2>
        <p className="text-sm text-zinc-500">No active project yet.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-zinc-900 p-5 text-white">
      <h2 className="mb-3 text-sm font-semibold text-zinc-300">
        Active Project
      </h2>
      <p className="text-sm font-semibold">{project.name}</p>
      <p className="mt-1 text-xs text-zinc-400">{project.address}</p>

      <div className="mt-4 flex items-center justify-between text-xs text-zinc-400">
        <span>Completion</span>
        <span className="font-medium text-white">{project.completion}%</span>
      </div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-sm bg-zinc-700">
        <div
          className="h-full rounded-sm bg-emerald-400"
          style={{ width: `${project.completion}%` }}
        />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div>
          <p className="text-zinc-400">Budget</p>
          <p className="mt-0.5 font-medium">
            {formatCurrency(project.budget)}
          </p>
        </div>
        <div>
          <p className="text-zinc-400">Spent</p>
          <p className="mt-0.5 font-medium text-amber-400">
            {formatCurrency(project.spent)}
          </p>
        </div>
        <div>
          <p className="text-zinc-400">Remaining</p>
          <p className="mt-0.5 font-medium">
            {formatCurrency(project.remaining)}
          </p>
        </div>
      </div>
    </div>
  );
}
