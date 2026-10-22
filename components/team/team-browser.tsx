"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Folder,
  MoreHorizontal,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { BLANK, InitialsAvatar, SelectAllCell, SelectCell } from "@/components/ui/list-table";
import { FilterSelect } from "@/components/ui/filter-select";
import { Modal, type ModalMenuItem } from "@/components/ui/modal";
import { usePortal } from "@/components/portal/portal-context";
import { MemberForm } from "@/components/team/member-form";
import { AssignmentsTable, MemberProfile } from "@/components/team/member-profile";
import { GroupsPanel } from "@/components/team/member-groups";
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

// What the footer counts on each tab — one of them, and more.
const TAB_NOUN: Record<Tab, [one: string, many: string]> = {
  management: ["management member", "management members"],
  skilled: ["skilled worker", "skilled workers"],
  professional: ["engineer or architect", "engineers & architects"],
  subcontractors: ["subcontractor", "subcontractors"],
};

// The members table: lines between its rows only, and roomier rows than
// the app's shared list-table (Manage Accounts keeps that one).
const TH = "px-4 py-3 font-medium";
const TD = "px-4 py-3.5";

const SELECT =
  "cursor-pointer appearance-none rounded-md border border-zinc-200 bg-white py-2 pl-3 pr-8 text-sm font-medium text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";

// Delete for every checked row — beside the selection's other actions.
const BULK_DELETE_BUTTON =
  "flex cursor-pointer items-center gap-1.5 rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

/** Whether a member is on a tab: a subcontractor on Subcontractors,
 * whatever their trade; anyone else on their own category's. */
function inTab(member: Worker, tab: Tab) {
  return tab === "subcontractors"
    ? member.employmentType === "subcontractor"
    : member.employmentType !== "subcontractor" && member.category === tab;
}

/**
 * A row's ⋯ menu — its actions in a small list by the button, in the
 * Modal's own ⋮ menu's look. Fixed to the screen rather than placed in
 * the table, whose scrolling would cut it off at the table's edge; under
 * the button, or over it near the bottom of the screen. It closes on a
 * click anywhere else, Escape, or any scrolling.
 */
function RowMenu({ label, items }: { label: string; items: ModalMenuItem[] }) {
  const [at, setAt] = useState<{ top?: number; bottom?: number; right: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    function handlePointerDown(e: MouseEvent) {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setAt(null);
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setAt(null);
    }
    function close() {
      setAt(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [at]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={at !== null}
        onClick={(e) => {
          // Its own click, not the row's.
          e.stopPropagation();
          if (at) {
            setAt(null);
            return;
          }
          const rect = e.currentTarget.getBoundingClientRect();
          const right = window.innerWidth - rect.right;
          const fitsBelow = rect.bottom + 8 + items.length * 40 < window.innerHeight;
          setAt(
            fitsBelow
              ? { top: rect.bottom + 4, right }
              : { bottom: window.innerHeight - rect.top + 4, right }
          );
        }}
        className={`cursor-pointer rounded p-1 transition hover:bg-zinc-100 hover:text-zinc-700 ${
          at ? "bg-zinc-100 text-zinc-700" : "text-zinc-400"
        }`}
      >
        <MoreHorizontal className="size-4" />
      </button>
      {at && (
        <div
          ref={menuRef}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          style={{ top: at.top, bottom: at.bottom, right: at.right }}
          className="fixed z-30 min-w-44 overflow-hidden rounded border border-zinc-200 bg-white py-1 shadow-lg"
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setAt(null);
                item.onSelect();
              }}
              className={`block w-full cursor-pointer px-3 py-2 text-left text-sm transition ${
                item.destructive ? "text-red-600 hover:bg-red-50" : "text-zinc-700 hover:bg-zinc-50"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/**
 * The company Team — its groups down the left (GroupsPanel), and every
 * member in a card beside them: their role and contact number, whether
 * they're Assigned (on any open task or phase, any project — see
 * WorkerAssignment) or Available, and the tasks and project they're on —
 * a tab per category of employee (Management, Skilled Workers, Engineers
 * & Architects) plus one for Subcontractors, searchable, filtered by
 * availability, sorted by name, scrolling within the card. A row opens
 * the member's form (MemberForm) straight away, its ⋯ menu holding Edit
 * and Delete — or, for someone with a login account, Manage in Accounts;
 * checked rows can be removed together, or added to a group. Tasks get
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
  const { basePath } = usePortal();
  const [tab, setTab] = useState<Tab>(MEMBER_CATEGORIES[0].value);
  const [query, setQuery] = useState("");
  const [availabilityFilter, setAvailabilityFilter] = useState<AvailabilityFilter>("all");
  const [ascending, setAscending] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<number>>(() => new Set());
  const [panel, setPanel] = useState<Panel | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Where a member's project opens.
  const projectsHref = `${basePath}/projects`;

  const allByWorker = useMemo(() => groupAssignmentsByWorker(assignments), [assignments]);
  const openByWorker = useMemo(
    () => groupAssignmentsByWorker(assignments.filter((a) => a.open)),
    [assignments]
  );

  // By name, A to Z or Z to A.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = members
      .filter((member) => {
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
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
    return ascending ? matches : matches.reverse();
  }, [members, openByWorker, query, availabilityFilter, ascending]);

  // A tab per category for employees (MEMBER_CATEGORIES' own order), then
  // every subcontractor together. Searching and filtering apply to every
  // tab, so the open one's count says how many of its members match.
  const filtering = query.trim() !== "" || availabilityFilter !== "all";
  const groups = [
    ...MEMBER_CATEGORIES.map((category) => ({
      key: category.value as Tab,
      label: category.label,
      defaults: { category: category.value, employmentType: "employee" as const },
    })),
    {
      key: "subcontractors" as Tab,
      label: "Subcontractors",
      defaults: { category: "skilled" as const, employmentType: "subcontractor" as const },
    },
  ].map((group) => ({
    ...group,
    members: filtered.filter((member) => inTab(member, group.key)),
  }));
  const activeGroup = groups.find((group) => group.key === tab) ?? groups[0];
  const total = activeGroup.members.length;
  // Everyone on the tab, whatever the search and filter hide — the
  // footer's "of".
  const tabTotal = members.filter((member) => inTab(member, activeGroup.key)).length;
  const [noun, nounPlural] = TAB_NOUN[activeGroup.key];

  // Only what's on screen counts — a checked member on another tab, or
  // one the search or filter hides, isn't touched.
  const selectedMembers = activeGroup.members.filter((member) => selected.has(member.id));
  const allChecked = total > 0 && selectedMembers.length === total;
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

  // Someone with a login account is managed in Accounts — opened,
  // searched to them.
  function manageInAccounts(member: Worker) {
    router.push(
      `/admin/accounts?search=${encodeURIComponent(
        accountById.get(member.profileId ?? "")?.email ?? member.fullName
      )}`
    );
  }

  // A row's ⋯ menu: its form, and Delete or Manage in Accounts — or, for a
  // project manager, the member's profile.
  function rowMenuItems(member: Worker): ModalMenuItem[] {
    if (!canManageMembers) {
      return [
        { label: "View profile", onSelect: () => openPanel({ mode: "view", memberId: member.id }) },
      ];
    }
    return [
      { label: "Edit", onSelect: () => openPanel({ mode: "edit", memberId: member.id }) },
      member.profileId
        ? { label: "Manage in Accounts", onSelect: () => manageInAccounts(member) }
        : { label: "Delete", destructive: true, onSelect: () => handleDelete([member]) },
    ];
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
    // The groups on the left; the members beside them — one above the
    // other on a narrow screen. The members under their own heading, the
    // Material record's kind, how many there are beside it; the groups'
    // sidebar separated from the member content by a single divider.
    <div className="grid flex-1 items-stretch lg:grid-cols-[17rem_minmax(0,1fr)]">
      <GroupsPanel groups={memberGroups} members={members} />

      <div className="flex min-w-0 flex-col gap-3 border-t border-zinc-200 p-6 sm:p-8 lg:border-t-0 lg:border-l">
        <div className="flex min-h-9 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-baseline gap-2">
            <h2 className="text-base font-semibold text-zinc-900">All members</h2>
            <span className="text-xs text-zinc-400 tabular-nums">{members.length}</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-3">
            {selectedMembers.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-zinc-900">{selectedMembers.length} selected</span>
                <button type="button" onClick={() => setSelected(new Set())} className="cursor-pointer text-sm font-medium text-zinc-500 transition hover:text-zinc-900">
                  Clear
                </button>
                {memberGroups.length > 0 && (
                  <div className="relative">
                    <select value="" onChange={(e) => handleAddToGroup(Number(e.target.value))} aria-label="Add to group" className={SELECT}>
                      <option value="" disabled>Add to Group</option>
                      {memberGroups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 text-zinc-400" />
                  </div>
                )}
                {canManageMembers && deletableSelected.length > 0 && (
                  <button type="button" onClick={() => handleDelete(deletableSelected)} disabled={deleting} className={BULK_DELETE_BUTTON}>
                    <Trash2 className="size-4" />
                    Delete
                  </button>
                )}
              </div>
            )}
            <div className="relative w-full sm:w-72">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                autoComplete="off"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, role, number or company"
                aria-label="Search members"
                className="w-full rounded-md border border-zinc-200 bg-white py-2 pr-3 pl-9 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
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
          {canManageMembers && (
            <button
              type="button"
              onClick={() => openPanel({ mode: "add", defaults: activeGroup.defaults })}
              className="flex shrink-0 cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-zinc-800"
            >
              <Plus className="size-4" />
              Add Member
            </button>
          )}
          </div>
        </div>

        <section className="min-w-0 rounded-lg border border-zinc-200 bg-white">
          {/* The open tab underlined in black; the
              gray line under them all an inset shadow, so a narrow screen
              can still scroll the tabs sideways. */}
          <div className="flex gap-6 overflow-x-auto px-6 pt-4 shadow-[inset_0_-1px_0_var(--color-zinc-200)]">
            {groups.map((group) => {
              const active = group.key === activeGroup.key;
              return (
                <button
                  key={group.key}
                  type="button"
                  onClick={() => setTab(group.key)}
                  aria-pressed={active}
                  className={`flex shrink-0 cursor-pointer items-center gap-2 border-b-2 pb-3 text-sm font-medium whitespace-nowrap transition ${
                    active
                      ? "border-zinc-900 text-zinc-900"
                      : "border-transparent text-zinc-500 hover:border-zinc-300 hover:text-zinc-900"
                  }`}
                >
                  {group.label}
                </button>
              );
            })}
            <span className="ml-auto shrink-0 pb-3 text-sm text-zinc-500">
              {total} {total === 1 ? "member" : "members"}
            </span>
          </div>

          {deleteError && !panel && (
            <p role="alert" className="border-b border-zinc-200 px-6 py-2 text-sm text-red-600">
              {deleteError}
            </p>
          )}

          {total === 0 ? (
            <p className="py-12 text-center text-sm text-zinc-400">
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
            <>
              {/* Every member of the tab, scrolling within the card past
                  about eight rows — its header row staying put on top
                  (sticky, which also keeps the header's hidden label in
                  its cell rather than placed against the page). */}
              <div className="max-h-[34rem] overflow-auto">
                {/* Fixed widths, so the columns stay put from tab to tab. */}
                <table className="w-full min-w-5xl table-fixed text-left text-[13px] text-zinc-600">
                  <colgroup>
                    <col className="w-12" />
                    <col className="w-64" />
                    <col className="w-48" />
                    <col className="w-40" />
                    <col className="w-32" />
                    <col />
                    <col className="w-52" />
                    <col className="w-14" />
                  </colgroup>
                  <thead>
                    <tr className="text-xs text-zinc-500 [&>th]:sticky [&>th]:top-0 [&>th]:z-10 [&>th]:bg-zinc-50 [&>th]:shadow-[inset_0_-1px_0_var(--color-zinc-200)]">
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
                      <th className={TH}>
                        <button
                          type="button"
                          onClick={() => setAscending((value) => !value)}
                          className="flex cursor-pointer items-center gap-1 font-medium transition hover:text-zinc-900"
                        >
                          Name
                          {ascending ? (
                            <ArrowDown aria-label="A to Z" className="size-3.5" />
                          ) : (
                            <ArrowUp aria-label="Z to A" className="size-3.5" />
                          )}
                        </button>
                      </th>
                      <th className={TH}>Role</th>
                      <th className={TH}>Contact number</th>
                      <th className={TH}>Availability</th>
                      <th className={TH}>Current task</th>
                      <th className={TH}>Current project</th>
                      <th className={TH}>
                        <span className="sr-only">Actions</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-100">
                    {activeGroup.members.map((member) => {
                      const checked = selected.has(member.id);
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
                            openPanel({
                              mode: canManageMembers ? "edit" : "view",
                              memberId: member.id,
                            })
                          }
                          className={`cursor-pointer transition-colors ${
                            checked ? "bg-zinc-100" : "hover:bg-zinc-50"
                          }`}
                        >
                          <SelectCell
                            checked={checked}
                            onChange={() => setChecked([member.id], !checked)}
                            label={`Select ${member.fullName}`}
                          />
                          <td className={TD}>
                            <div className="flex items-center gap-3">
                              <InitialsAvatar name={member.fullName} large neutral />
                              {/* Its click is the row's (bubbles up). */}
                              <button
                                type="button"
                                className="min-w-0 cursor-pointer truncate text-left font-semibold text-zinc-900"
                              >
                                {member.fullName}
                              </button>
                            </div>
                          </td>
                          {/* A subcontractor's company follows their role. */}
                          <td
                            className={`${TD} truncate text-zinc-500`}
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
                          <td className={`${TD} truncate text-zinc-700 tabular-nums`}>
                            {member.contactNumber || BLANK}
                          </td>
                          <td className={TD}>
                            <AvailabilityBadge assigned={open.length > 0} />
                          </td>
                          {/* One line each, so every row keeps the same
                              height — cut off with "…" (soonest-ending
                              first, so what they're on now leads); the
                              member's form lists them in full, and hovering
                              shows them too. */}
                          <td
                            className={`${TD} truncate text-zinc-700`}
                            title={openTasks.map(describeAssignment).join("\n") || undefined}
                          >
                            {openTasks.length === 0
                              ? BLANK
                              : openTasks.map((assignment) => assignment.itemName).join(", ")}
                          </td>
                          {/* Their first project, opening it; how many more
                              after it, every one of them on hover. */}
                          <td className={TD}>
                            {projects.length === 0 ? (
                              BLANK
                            ) : (
                              <span
                                className="flex min-w-0 items-center gap-1.5"
                                title={projects.map(([, name]) => name).join(", ")}
                              >
                                <Folder
                                  aria-hidden
                                  className="size-3.5 shrink-0 text-[var(--team-accent)]"
                                />
                                {projectsHref ? (
                                  <Link
                                    href={`${projectsHref}/${projects[0][0]}`}
                                    onClick={(e) => e.stopPropagation()}
                                    className="truncate font-medium text-[var(--team-accent)] hover:underline"
                                  >
                                    {projects[0][1]}
                                  </Link>
                                ) : (
                                  <span className="truncate font-medium text-[var(--team-accent)]">
                                    {projects[0][1]}
                                  </span>
                                )}
                                {projects.length > 1 && (
                                  <span className="shrink-0 text-xs text-zinc-400">
                                    +{projects.length - 1}
                                  </span>
                                )}
                              </span>
                            )}
                          </td>
                          <td className={`${TD} text-right`}>
                            <RowMenu
                              label={`Actions for ${member.fullName}`}
                              items={rowMenuItems(member)}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500">
                Showing <span className="font-semibold text-zinc-700">{total}</span> of{" "}
                <span className="font-semibold text-zinc-700">{tabTotal}</span>{" "}
                {tabTotal === 1 ? noun : nounPlural}
              </div>
            </>
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
                      // managers and foremen) is managed in Accounts.
                      {
                        label: "Manage in Accounts",
                        onSelect: () => manageInAccounts(panelMember),
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
                {/* Everything in the row's Current task, in full — by start
                    date, with the project, dates and status. */}
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
        </section>
      </div>
    </div>
  );
}
