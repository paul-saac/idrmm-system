"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { AvailabilityBadge } from "@/components/team/availability";
import { WEEKDAY_LABELS, formatHours } from "@/lib/workers/schedule";
import { toIsoDate } from "@/lib/task-progress/calculate";
import type { LinkableAccount, Worker, WorkerAssignment } from "@/lib/workers/data";
import { categoryLabel } from "@/lib/workers/presets";

function formatDate(iso: string, withYear = false) {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(withYear && { year: "numeric" }),
  });
}

function dateRange(assignment: WorkerAssignment) {
  const { startDate, endDate } = assignment;
  if (!startDate && !endDate) return "—";
  return `${startDate ? formatDate(startDate) : "—"} – ${endDate ? formatDate(endDate) : "—"}`;
}

type Status = "ongoing" | "upcoming" | "ended";

const STATUS: Record<Status, { label: string; className: string }> = {
  ongoing: { label: "Ongoing", className: "text-amber-700" },
  upcoming: { label: "Upcoming", className: "text-sky-700" },
  ended: { label: "Ended", className: "text-zinc-400" },
};

function statusOf(assignment: WorkerAssignment, today: string): Status {
  if (!assignment.open) return "ended";
  if (assignment.startDate && assignment.startDate > today) return "upcoming";
  return "ongoing";
}

/**
 * One Team member's profile — their details, then every task or phase
 * they're on or have been on (any project): open ones first by start
 * date, then ended ones latest first. Edit swaps the same panel to the
 * member's form (see TeamBrowser).
 */
export function MemberProfile({
  member,
  linkedAccount,
  assignments,
  groups = [],
  hoursWorked = [],
  onEdit,
}: {
  member: Worker;
  /** Their own login account, when linked. */
  linkedAccount: LinkableAccount | null;
  assignments: WorkerAssignment[];
  /** Names of the groups (crews) they're in. */
  groups?: string[];
  /** Their recorded attendance, per project. */
  hoursWorked?: { projectId: number; projectName: string; hours: number }[];
  /** Left out where members can only be viewed (a project manager's Team). */
  onEdit?: () => void;
}) {
  const open = assignments
    .filter((a) => a.open)
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
  const ended = assignments
    .filter((a) => !a.open)
    .sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-sm">
          <dt className="text-zinc-500">Role</dt>
          <dd className="font-medium text-zinc-900">{member.title || "—"}</dd>
          <dt className="text-zinc-500">Category</dt>
          <dd className="text-zinc-900">{categoryLabel(member.category)}</dd>
          <dt className="text-zinc-500">Type</dt>
          <dd className="text-zinc-900">
            {member.employmentType === "subcontractor"
              ? `Subcontractor${member.subcontractorCompany ? ` · ${member.subcontractorCompany}` : ""}`
              : "Employee"}
          </dd>
          <dt className="text-zinc-500">Contact Number</dt>
          <dd className="text-zinc-900">
            {member.contactNumber ? (
              <a href={`tel:${member.contactNumber.replace(/\s/g, "")}`} className="hover:underline">
                {member.contactNumber}
              </a>
            ) : (
              "—"
            )}
          </dd>
          <dt className="text-zinc-500">Date Hired</dt>
          <dd className="text-zinc-900">
            {member.dateHired ? formatDate(member.dateHired, true) : "—"}
          </dd>
          {member.employmentType === "employee" && member.category === "skilled" && (
            <>
              <dt className="text-zinc-500">Default Rate</dt>
              <dd className="text-zinc-900">
                {member.hourlyRate === null
                  ? "—"
                  : `₱${member.hourlyRate.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / hour`}
              </dd>
              <dt className="text-zinc-500">Working Days</dt>
              <dd className="flex flex-col gap-1">
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAY_LABELS.map((day, index) => {
                    const hours = member.workHours[index] ?? 0;
                    return (
                      <span
                        key={day}
                        className="flex w-10 shrink-0 flex-col items-center gap-1"
                      >
                        <span className="text-[10px] font-medium text-zinc-400 uppercase">{day}</span>
                        <span
                          className={`w-full rounded-sm border bg-white px-1 py-2 text-center text-sm tabular-nums ${
                            hours > 0 ? "border-zinc-200 text-zinc-900" : "border-zinc-100 text-zinc-300"
                          }`}
                        >
                          {hours}
                        </span>
                      </span>
                    );
                  })}
                </div>
                <span className="text-xs text-zinc-400">
                  {formatHours(member.workHours.reduce((sum, hours) => sum + hours, 0))} a week
                </span>
              </dd>
              <dt className="text-zinc-500">Hours Worked</dt>
              <dd className="text-zinc-900">
                {hoursWorked.length === 0 ? (
                  "—"
                ) : (
                  <ul className="flex flex-col gap-0.5">
                    {hoursWorked.map((entry) => (
                      <li key={entry.projectId}>
                        {formatHours(entry.hours)}{" "}
                        <span className="text-zinc-500">on {entry.projectName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </>
          )}
          {linkedAccount && (
            <>
              <dt className="text-zinc-500">Login Account</dt>
              <dd className="text-zinc-900">{linkedAccount.email}</dd>
            </>
          )}
          <dt className="text-zinc-500">Groups</dt>
          <dd className="text-zinc-900">{groups.length > 0 ? groups.join(", ") : "—"}</dd>
          <dt className="text-zinc-500">Availability</dt>
          <dd>
            <AvailabilityBadge assigned={open.length > 0} />
          </dd>
        </dl>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="shrink-0 cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Edit
          </button>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold text-zinc-900">Assignments</h3>
        {open.length + ended.length === 0 ? (
          <EmptyState compact className="text-sm text-zinc-400">No assignments yet.</EmptyState>
        ) : (
          <AssignmentsTable assignments={[...open, ...ended]} />
        )}
      </section>
    </div>
  );
}

/**
 * Assignments in full, one row each, in the order given: what it is, its
 * project, its dates, and whether it's ongoing, upcoming or ended — to
 * read, not to click. Also under a member's form (TeamBrowser), for what
 * they're on right now.
 */
export function AssignmentsTable({ assignments }: { assignments: WorkerAssignment[] }) {
  const today = toIsoDate(new Date());

  return (
    <div className="overflow-hidden rounded-md border border-zinc-200">
      <table className="w-full text-left text-sm">
        <thead className="bg-zinc-50 text-xs font-medium text-zinc-500">
          <tr>
            <th className="px-4 py-2.5">Assignment</th>
            <th className="px-4 py-2.5">Project</th>
            <th className="px-4 py-2.5">Dates</th>
            <th className="px-4 py-2.5 text-right">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {assignments.map((assignment) => {
            const status = STATUS[statusOf(assignment, today)];
            return (
              <tr key={`${assignment.kind}-${assignment.itemId}`}>
                <td className="px-4 py-2.5 text-zinc-900">{assignment.itemName}</td>
                <td className="px-4 py-2.5 text-zinc-600">{assignment.projectName}</td>
                <td className="px-4 py-2.5 whitespace-nowrap text-zinc-600">
                  {dateRange(assignment)}
                </td>
                <td
                  className={`px-4 py-2.5 text-right text-xs font-medium whitespace-nowrap ${status.className}`}
                >
                  {status.label}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
