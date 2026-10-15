"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Plus, Search, Trash2 } from "lucide-react";
import {
  BLANK,
  BODY,
  CELL,
  HEAD_CELL,
  HEAD_ROW,
  InitialsAvatar,
  SelectAllCell,
  SelectCell,
  TABLE,
  TABLE_FRAME,
  rowClass,
} from "@/components/ui/list-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Modal } from "@/components/ui/modal";
import { MemberForm } from "@/components/team/member-form";
import { AssignmentsTable, MemberProfile } from "@/components/team/member-profile";
import { GroupCards } from "@/components/team/member-groups";
import {
  AvailabilityBadge,
  describeAssignment,
  groupAssignmentsByWorker,
} from "@/components/team/availability";
import { addMembersToGroup, deleteWorkers } from "@/lib/workers/actions";
import type {
  HoursWorked,
  LinkableAccount,
  MemberGroup,
  Worker,
  WorkerAssignment,
} from "@/lib/workers/data";
import { MEMBER_CATEGORIES, type EmploymentType, type MemberCategory } from "@/lib/workers/presets";

type AvailabilityFilter = "all" | "available" | "assigned";

// A tab per employee category, then one for Subcontractors.
type Tab = MemberCategory | "subcontractors";

type Panel =
  // `defaults`: Add Member (or an empty tab's "Add one") starts the form
  // in the open tab's category.
  | { mode: "add"; defaults?: { category: MemberCategory; employmentType: EmploymentType } }
  | { mode: "view"; memberId: number }
  | { mode: "edit"; memberId: number };

const COLUMNS = [
  "Name",
  "Role",
  "Contact Number",
  "Availability",
  "Currently Task Assigned To",
  "Currently Project Assigned To",
];

const SELECT =
  "cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

// A category tab — black and underlined while open.
const TAB =
  "shrink-0 cursor-pointer whitespace-nowrap border-b-2 px-1 pb-3 text-sm font-medium transition";

// Delete for every checked row — beside Add Member, its size.
const BULK_DELETE_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";


/**
 * The company Team — every member, their role and contact number, and
 * whether they're Assigned (on any open task or phase, any project — see
 * WorkerAssignment) or Available — a tab per category of employee
 * (Management, Skilled Workers, Engineers & Architects) plus one for
 * Subcontractors, each its own table. A row opens the member's form
 * (MemberForm) straight away, its ⋮ menu holding Delete — or, for
 * someone with a login account, Manage in Accounts; checked rows can be
 * removed together, or added to a group. The groups (crews) sit above the
 * tabs as cards (GroupCards), each one opening its group. Tasks get
 * members from the Gantt chart's Assigned column.
 *
 * A project manager's copy (canManageMembers false) views members only —
 * a row opens their profile (MemberProfile), with no adding, editing or
 * removing them — but manages groups the same.
 */
export function TeamBrowser({
  members,
  assignments,
  accounts,
  memberGroups,
  hoursWorked,
  canManageMembers = true,
}: {
  members: Worker[];
  assignments: WorkerAssignment[];
  /** Project manager and foreman accounts a member can be linked to. */
  accounts: LinkableAccount[];
  memberGroups: MemberGroup[];
  /** Everyone's recorded attendance, per project — their profiles. */
  hoursWorked: HoursWorked[];
  canManageMembers?: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>(MEMBER_CATEGORIES[0].value);
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

  // A tab per category for employees (MEMBER_CATEGORIES' own order), then
  // every subcontractor together, whatever their trade — by name within
  // each (listWorkers' own order). Searching and filtering apply to every
  // tab, so each one's count says how many of its members match.
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
      key: "subcontractors" as const,
      label: "Subcontractors",
      defaults: { category: "skilled" as const, employmentType: "subcontractor" as const },
      members: filtered.filter((member) => member.employmentType === "subcontractor"),
    },
  ];
  const activeGroup = groups.find((group) => group.key === tab) ?? groups[0];

  // Only what's on screen counts — a checked member on another tab, or
  // one the search or filter hides, isn't touched.
  const selectedMembers = activeGroup.members.filter((member) => selected.has(member.id));
  const allChecked = selectedMembers.length === activeGroup.members.length;
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
  // The open member's current tasks and phases (not the projects they
  // run), by start date — the full list under their form.
  const panelOpenTasks = panelMember
    ? (openByWorker.get(panelMember.id) ?? [])
        .filter((a) => a.kind !== "project")
        .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""))
    : [];

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

  async function handleAddToGroup(groupId: number) {
    const group = memberGroups.find((g) => g.id === groupId);
    if (!group) return;
    setDeleteError(null);
    const result = await addMembersToGroup(
      group.id,
      selectedMembers.map((member) => member.id)
    );
    if (result.error) {
      setDeleteError(result.error);
      return;
    }
    setSelected(new Set());
    router.refresh();
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
      {/* A white band under the page header: the group cards, then the
          tabs. -mx-8 px-8 takes back the page's own px-8, so it (and the
          gray line under the tabs — an inset shadow, so a narrow screen
          can still scroll the tabs sideways) runs edge to edge while
          everything stays in line with what's below; -mt-6 its py-6. The
          open tab's black underline covers its stretch of the line. */}
      <div className="-mx-8 -mt-6 bg-white px-8 pt-4 shadow-[inset_0_-1px_0_var(--color-zinc-200)]">
        <GroupCards groups={memberGroups} members={members} />
        <div className="flex gap-6 overflow-x-auto">
          {groups.map((group) => {
            const active = group.key === activeGroup.key;
            return (
              <button
                key={group.key}
                type="button"
                onClick={() => setTab(group.key)}
                aria-pressed={active}
                className={`${TAB} ${
                  active
                    ? "border-zinc-900 text-zinc-900"
                    : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                }`}
              >
                {group.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-55 max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, role, number or company"
            className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
          />
        </div>

        <FilterSelect
          label="Availability"
          value={availabilityFilter}
          options={[
            { value: "available", label: "Available" },
            { value: "assigned", label: "Assigned" },
          ]}
          onChange={setAvailabilityFilter}
        />

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
              {memberGroups.length > 0 && (
                <div className="relative">
                  {/* Picking a group adds the checked members to it. */}
                  <select
                    value=""
                    onChange={(e) => handleAddToGroup(Number(e.target.value))}
                    aria-label="Add to group"
                    className={SELECT}
                  >
                    <option value="" disabled>
                      Add to Group
                    </option>
                    {memberGroups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
                </div>
              )}
              {canManageMembers && deletableSelected.length > 0 && (
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
          {canManageMembers && (
            <button
              type="button"
              onClick={() => openPanel({ mode: "add", defaults: activeGroup.defaults })}
              className="flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-900 transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-900 hover:bg-zinc-900 hover:text-white active:translate-y-0"
            >
              <Plus className="size-4" />
              Add Member
            </button>
          )}
        </div>
      </div>

      {deleteError && !panel && (
        <p role="alert" className="text-sm text-red-600">
          {deleteError}
        </p>
      )}

      {activeGroup.members.length === 0 ? (
        <p className="rounded-lg border border-dashed border-zinc-200 bg-white py-10 text-center text-sm text-zinc-400">
          {filtering ? (
            "No members match."
          ) : !canManageMembers ? (
            "No members yet."
          ) : (
            <>
              No members yet.{" "}
              <button
                type="button"
                onClick={() => openPanel({ mode: "add", defaults: activeGroup.defaults })}
                className="cursor-pointer font-medium text-zinc-700 hover:underline"
              >
                Add one
              </button>
            </>
          )}
        </p>
      ) : (
        <div className={TABLE_FRAME}>
          {/* Fixed widths, so the columns stay put from tab to tab. */}
          <table className={`${TABLE} min-w-5xl table-fixed`}>
            <colgroup>
              <col className="w-10" />
              <col className="w-56" />
              <col className="w-48" />
              <col className="w-36" />
              <col className="w-28" />
              <col />
              <col />
            </colgroup>
            <thead>
              <tr className={HEAD_ROW}>
                <SelectAllCell
                  checked={allChecked}
                  indeterminate={selectedMembers.length > 0 && !allChecked}
                  onChange={() =>
                    setChecked(
                      activeGroup.members.map((member) => member.id),
                      !allChecked
                    )
                  }
                  label={`Select all ${activeGroup.label}`}
                />
                {COLUMNS.map((label) => (
                  <th key={label} className={HEAD_CELL}>
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className={BODY}>
              {activeGroup.members.map((member) => {
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
                    onClick={() =>
                      openPanel({ mode: canManageMembers ? "edit" : "view", memberId: member.id })
                    }
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
                    {/* One line each, so every row keeps the same height —
                        cut off with "…" (soonest-ending first, so what
                        they're on now leads); the member's form lists
                        them in full, and hovering shows them too. */}
                    <td
                      className={`${CELL} truncate`}
                      title={openTasks.map(describeAssignment).join("\n") || undefined}
                    >
                      {openTasks.length === 0
                        ? BLANK
                        : openTasks.map((assignment) => assignment.itemName).join(", ")}
                    </td>
                    <td
                      className={`${CELL} truncate`}
                      title={projects.map(([, name]) => name).join(", ") || undefined}
                    >
                      {projects.length === 0 ? BLANK : projects.map(([, name]) => name).join(", ")}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={panel !== null}
        onClose={closePanel}
        title={panelMember ? panelMember.fullName : "Add Member"}
        menuItems={
          canManageMembers && panelMember
            ? panelMember.profileId
              ? [
                  // Someone with a login account (Management's project
                  // managers and foremen) is managed in Accounts — this
                  // opens it, searched to them.
                  {
                    label: "Manage in Accounts",
                    onSelect: () =>
                      router.push(
                        `/admin/accounts?search=${encodeURIComponent(
                          accountById.get(panelMember.profileId ?? "")?.email ??
                            panelMember.fullName
                        )}`
                      ),
                  },
                ]
              : [
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
            groups={memberGroups
              .filter((group) => group.memberIds.includes(panelMember.id))
              .map((group) => group.name)}
            hoursWorked={hoursWorked.filter((entry) => entry.workerId === panelMember.id)}
            onEdit={
              canManageMembers
                ? () => setPanel({ mode: "edit", memberId: panelMember.id })
                : undefined
            }
          />
        )}
        {panel?.mode === "edit" && panelMember && (
          <MemberForm
            key={panelMember.id}
            member={panelMember}
            onSuccess={closePanel}
            onCancel={closePanel}
          >
            {/* Edge to edge: -mx-6 takes back the modal body's own px-6. */}
            <div aria-hidden="true" className="-mx-6 my-1 border-t border-zinc-200 sm:col-span-2" />
            {/* Everything in the row's Currently Task Assigned To, in
                full — by start date, with the project, dates and status. */}
            <section className="flex flex-col gap-2 sm:col-span-2">
              <h3 className="text-sm font-semibold text-zinc-900">Currently Task Assigned To</h3>
              {panelOpenTasks.length === 0 ? (
                <p className="text-sm text-zinc-400">Not assigned to any task right now.</p>
              ) : (
                <AssignmentsTable assignments={panelOpenTasks} />
              )}
            </section>
          </MemberForm>
        )}
      </Modal>
    </div>
  );
}
