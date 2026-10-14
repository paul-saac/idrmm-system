"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2, UserCog } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import {
  BLANK,
  BODY,
  CELL,
  HEAD_CELL,
  HEAD_ROW,
  ICON_BUTTON,
  InitialsAvatar,
  SelectAllCell,
  SelectCell,
  TABLE,
  TABLE_FRAME,
  rowClass,
} from "@/components/ui/list-table";
import { Modal } from "@/components/ui/modal";
import { MemberForm } from "@/components/team/member-form";
import { MemberProfile } from "@/components/team/member-profile";
import {
  AvailabilityBadge,
  describeAssignment,
  groupAssignmentsByWorker,
} from "@/components/team/availability";
import { deleteWorkers } from "@/lib/workers/actions";
import type { LinkableAccount, Worker, WorkerAssignment } from "@/lib/workers/data";
import { MEMBER_CATEGORIES, type EmploymentType, type MemberCategory } from "@/lib/workers/presets";

type AvailabilityFilter = "all" | "available" | "assigned";

type Panel =
  // `defaults`: an empty section's own "Add one" starts the form in it.
  | { mode: "add"; defaults?: { category: MemberCategory; employmentType: EmploymentType } }
  | { mode: "view"; memberId: number }
  | { mode: "edit"; memberId: number };

const COLUMNS = [
  "Name",
  "Role",
  "Contact Number",
  "Availability",
  "Task Assigned To",
  "Project Assigned To",
];

const SELECT =
  "cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

// Delete for every checked row — beside Add Member, its size.
const BULK_DELETE_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

// A row's own Edit and Delete (see list-table's ICON_BUTTON).
const EDIT_BUTTON = `${ICON_BUTTON} hover:bg-zinc-100 hover:text-zinc-700`;
const DELETE_BUTTON = `${ICON_BUTTON} hover:bg-red-50 hover:text-red-600`;

/**
 * The company Team — every member, their role and contact number, and
 * whether they're Assigned (on any open task or phase, any project — see
 * WorkerAssignment) or Available — one table per category of employee
 * (Management, Skilled Workers, Engineers & Architects) plus one for
 * Subcontractors. A row opens the member's profile
 * (MemberProfile: details and every assignment); its Edit opens their
 * form straight away, and its Delete (or the profile's ⋮ menu) removes
 * them — checked rows can be removed together. Tasks get members from
 * the Gantt chart's Assigned column.
 */
export function TeamBrowser({
  members,
  assignments,
  accounts,
}: {
  members: Worker[];
  assignments: WorkerAssignment[];
  /** Project manager and foreman accounts a member can be linked to. */
  accounts: LinkableAccount[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const allByWorker = useMemo(() => groupAssignmentsByWorker(assignments), [assignments]);
  const openByWorker = useMemo(
    () => groupAssignmentsByWorker(assignments.filter((a) => a.open)),
    [assignments]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members.filter((member) => {
      const assigned = (openByWorker.get(member.id)?.length ?? 0) > 0;
      if (availabilityFilter === "assigned" && !assigned) return false;
      if (availabilityFilter === "available" && assigned) return false;
      return (
        !q ||
        member.fullName.toLowerCase().includes(q) ||
        (member.title ?? "").toLowerCase().includes(q) ||
        (member.contactNumber ?? "").toLowerCase().includes(q) ||
        (member.subcontractorCompany ?? "").toLowerCase().includes(q)
      );
    });
  }, [members, openByWorker, query, availabilityFilter]);

  // A section per category for employees (MEMBER_CATEGORIES' own order),
  // then every subcontractor together, whatever their trade — by name
  // within each (listWorkers' own order). All of them show, empty or not
  // — only while searching or filtering do the empty ones step aside.
  const filtering = query.trim() !== "" || availabilityFilter !== "all";
  const groups = [
    ...MEMBER_CATEGORIES.map((category) => ({
      key: category.value,
      label: category.label,
      defaults: { category: category.value, employmentType: "employee" as const },
      members: filtered.filter(
        (member) => member.employmentType !== "subcontractor" && member.category === category.value
      ),
    })),
    {
      key: "subcontractors",
      label: "Subcontractors",
      defaults: { category: "skilled" as const, employmentType: "subcontractor" as const },
      members: filtered.filter((member) => member.employmentType === "subcontractor"),
    },
  ].filter((group) => !filtering || group.members.length > 0);

  // Only what's on screen counts — a checked member the search or filter
  // hides isn't touched.
  const selectedMembers = filtered.filter((member) => selected.has(member.id));
  // Anyone with a login account (Management's project managers and
  // foremen) is managed in Accounts — never deleted from here.
  const deletableSelected = selectedMembers.filter((member) => !member.profileId);

  const accountById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts]
  );

  // Looked up fresh from `members`, so the panel reflects a save the
  // moment the page's data refreshes.
  const panelMember =
    panel && panel.mode !== "add"
      ? members.find((member) => member.id === panel.memberId)
      : undefined;

  function setChecked(ids: number[], checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openPanel(next: Panel) {
    setDeleteError(null);
    setPanel(next);
  }

  function closePanel() {
    setPanel(null);
    setDeleteError(null);
  }

  async function handleDelete(targets: Worker[]) {
    const open = targets.reduce(
      (sum, member) => sum + (openByWorker.get(member.id)?.length ?? 0),
      0
    );
    const who = targets.length === 1 ? targets[0].fullName : `${targets.length} members`;
    const message = open
      ? `Remove ${who} from the team? They'll also be taken off ${open} open assignment${open === 1 ? "" : "s"}.`
      : `Remove ${who} from the team?`;
    if (!window.confirm(message)) return;
    setDeleting(true);
    const result = await deleteWorkers(targets.map((member) => member.id));
    setDeleting(false);
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    setChecked(
      targets.map((member) => member.id),
      false
    );
    closePanel();
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-55 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role, number or company"
            className="w-full rounded-md border border-zinc-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <div className="relative">
          <select
            value={availabilityFilter}
            onChange={(e) => setAvailabilityFilter(e.target.value as AvailabilityFilter)}
            aria-label="Availability"
            className={SELECT}
          >
            <option value="all">Availability</option>
            <option value="available">Available</option>
            <option value="assigned">Assigned</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        </div>

        <div className="ml-auto flex items-center gap-3">
          {selectedMembers.length > 0 && (
            <>
              <span className="text-sm font-medium text-zinc-900">
                {selectedMembers.length} selected
              </span>
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="cursor-pointer text-sm font-medium text-zinc-500 transition hover:text-zinc-900"
              >
                Clear
              </button>
              {deletableSelected.length > 0 && (
                <button
                  type="button"
                  onClick={() => handleDelete(deletableSelected)}
                  disabled={deleting}
                  className={BULK_DELETE_BUTTON}
                >
                  <Trash2 className="size-4" />
                  Delete
                </button>
              )}
            </>
          )}
          <button
            type="button"
            onClick={() => openPanel({ mode: "add" })}
            className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-900 hover:bg-zinc-900 hover:text-white active:translate-y-0"
          >
            <Plus className="size-4" />
            Add Member
          </button>
        </div>
      </div>

      {deleteError && !panel && (
        <p role="alert" className="text-sm text-red-600">
          {deleteError}
        </p>
      )}

      {groups.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-white py-10 text-center text-sm text-zinc-400">
          No members match.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => {
            const heading = (
              <h2 className="text-lg font-semibold text-zinc-700">
                {group.label}{" "}
                <span className="font-normal text-zinc-400">({group.members.length})</span>
              </h2>
            );
            if (group.members.length === 0) {
              return (
                <section key={group.key} className="flex flex-col gap-3">
                  {heading}
                  <p className="rounded-lg border border-dashed border-zinc-200 bg-white py-6 text-center text-sm text-zinc-400">
                    No members yet.{" "}
                    <button
                      type="button"
                      onClick={() => openPanel({ mode: "add", defaults: group.defaults })}
                      className="cursor-pointer font-medium text-zinc-700 hover:underline"
                    >
                      Add one
                    </button>
                  </p>
                </section>
              );
            }
            const ids = group.members.map((member) => member.id);
            const checkedCount = ids.filter((id) => selected.has(id)).length;
            const allChecked = checkedCount === ids.length;
            return (
              <section key={group.key} className="flex flex-col gap-3">
                {heading}
                <div className={TABLE_FRAME}>
                  {/* Fixed widths, so every section's columns line up. */}
                  <table className={`${TABLE} min-w-5xl table-fixed`}>
                    <colgroup>
                      <col className="w-10" />
                      <col className="w-56" />
                      <col className="w-48" />
                      <col className="w-36" />
                      <col className="w-28" />
                      <col />
                      <col />
                      <col className="w-24" />
                    </colgroup>
                    <thead>
                      <tr className={HEAD_ROW}>
                        <SelectAllCell
                          checked={allChecked}
                          indeterminate={checkedCount > 0 && !allChecked}
                          onChange={() => setChecked(ids, !allChecked)}
                          label={`Select all ${group.label}`}
                        />
                        {COLUMNS.map((label) => (
                          <th key={label} className={HEAD_CELL}>
                            {label}
                          </th>
                        ))}
                        <th className={HEAD_CELL}>Actions</th>
                      </tr>
                    </thead>
                    <tbody className={BODY}>
                      {group.members.map((member) => {
                        const open = openByWorker.get(member.id) ?? [];
                        // Tasks and phases; a project they run shows only
                        // under its project.
                        const openTasks = open.filter((a) => a.kind !== "project");
                        // Each project once, [id, name].
                        const projects = Array.from(
                          new Map(open.map((a) => [a.projectId, a.projectName] as const))
                        );
                        const company =
                          member.employmentType === "subcontractor"
                            ? member.subcontractorCompany
                            : null;
                        return (
                          <tr
                            key={member.id}
                            onClick={() => openPanel({ mode: "view", memberId: member.id })}
                            className={`cursor-pointer ${rowClass(selected.has(member.id))}`}
                          >
                            <SelectCell
                              checked={selected.has(member.id)}
                              onChange={() => setChecked([member.id], !selected.has(member.id))}
                              label={`Select ${member.fullName}`}
                            />
                            <td className={CELL}>
                              <div className="flex items-center gap-2.5">
                                <InitialsAvatar name={member.fullName} />
                                {/* Its click is the row's (bubbles up). */}
                                <button
                                  type="button"
                                  className="min-w-0 cursor-pointer truncate text-left font-medium text-zinc-900"
                                >
                                  {member.fullName}
                                </button>
                              </div>
                            </td>
                            {/* A subcontractor's company follows their role. */}
                            <td
                              className={`${CELL} truncate`}
                              title={
                                company
                                  ? [member.title, company].filter(Boolean).join(" · ")
                                  : undefined
                              }
                            >
                              {member.title}
                              {company && (
                                <span className="text-zinc-400">
                                  {member.title && " · "}
                                  {company}
                                </span>
                              )}
                              {!member.title && !company && BLANK}
                            </td>
                            <td className={`${CELL} truncate`}>{member.contactNumber || BLANK}</td>
                            <td className={CELL}>
                              <AvailabilityBadge assigned={open.length > 0} />
                            </td>
                            <td className={CELL}>
                              {openTasks.length === 0 ? (
                                BLANK
                              ) : (
                                <ul className="flex flex-col gap-0.5">
                                  {openTasks.map((assignment) => (
                                    <li
                                      key={`${assignment.kind}-${assignment.itemId}`}
                                      className="truncate"
                                      title={describeAssignment(assignment)}
                                    >
                                      {assignment.itemName}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            <td className={CELL}>
                              {projects.length === 0 ? (
                                BLANK
                              ) : (
                                <ul className="flex flex-col gap-0.5">
                                  {projects.map(([id, name]) => (
                                    <li key={id} className="truncate" title={name}>
                                      {name}
                                    </li>
                                  ))}
                                </ul>
                              )}
                            </td>
                            <td className={CELL}>
                              <div className="flex items-center gap-1">
                                {!member.profileId && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleDelete([member]);
                                    }}
                                    disabled={deleting}
                                    title="Delete"
                                    aria-label={`Delete ${member.fullName}`}
                                    className={DELETE_BUTTON}
                                  >
                                    <Trash2 className="size-3.5" />
                                  </button>
                                )}
                                {member.profileId ? (
                                  // Someone with a login account (Management's
                                  // project managers and foremen) is managed in
                                  // Accounts — this opens it, searched to them.
                                  <Link
                                    href={`/admin/accounts?search=${encodeURIComponent(
                                      accountById.get(member.profileId)?.email ?? member.fullName
                                    )}`}
                                    onClick={(e) => e.stopPropagation()}
                                    title="Manage in Accounts"
                                    aria-label={`Manage ${member.fullName} in Accounts`}
                                    className={EDIT_BUTTON}
                                  >
                                    <UserCog className="size-3.5" />
                                  </Link>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      openPanel({ mode: "edit", memberId: member.id });
                                    }}
                                    title="Edit"
                                    aria-label={`Edit ${member.fullName}`}
                                    className={EDIT_BUTTON}
                                  >
                                    <EditIcon className="size-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })}
        </div>
      )}

      <Modal
        open={panel !== null}
        onClose={closePanel}
        title={panelMember ? panelMember.fullName : "Add Member"}
        menuItems={
          panelMember && !panelMember.profileId
            ? [
                {
                  label: "Delete",
                  destructive: true,
                  onSelect: () => handleDelete([panelMember]),
                },
              ]
            : undefined
        }
      >
        {deleteError && (
          <p role="alert" className="mb-4 text-sm text-red-600">
            {deleteError}
          </p>
        )}
        {panel?.mode === "add" && (
          <MemberForm
            key="add"
            defaults={panel.defaults}
            accounts={accounts}
            linkedProfileIds={members.flatMap((m) => (m.profileId ? [m.profileId] : []))}
            onSuccess={closePanel}
            onCancel={closePanel}
          />
        )}
        {panel?.mode === "view" && panelMember && (
          <MemberProfile
            member={panelMember}
            linkedAccount={
              panelMember.profileId ? (accountById.get(panelMember.profileId) ?? null) : null
            }
            assignments={allByWorker.get(panelMember.id) ?? []}
            onEdit={() => setPanel({ mode: "edit", memberId: panelMember.id })}
          />
        )}
        {panel?.mode === "edit" && panelMember && (
          <MemberForm
            key={panelMember.id}
            member={panelMember}
            accounts={accounts}
            linkedProfileIds={members.flatMap((m) =>
              m.profileId && m.id !== panelMember.id ? [m.profileId] : []
            )}
            onSuccess={() => setPanel({ mode: "view", memberId: panelMember.id })}
            onCancel={() => setPanel({ mode: "view", memberId: panelMember.id })}
          />
        )}
      </Modal>
    </div>
  );
}
