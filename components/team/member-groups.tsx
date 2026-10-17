"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Search, Users } from "lucide-react";
import { EditIcon } from "@/components/icons/edit-icon";
import {
  Checkbox,
  ICON_BUTTON,
  InitialsAvatar,
  SectionLabel,
} from "@/components/ui/list-table";
import { Modal } from "@/components/ui/modal";
import { deleteMemberGroup, saveMemberGroup } from "@/lib/workers/actions";
import type { MemberGroup, Worker } from "@/lib/workers/data";
import { memberSections } from "@/lib/workers/sections";

const INPUT =
  "w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";
const LABEL = "text-sm font-medium text-zinc-900";

// How many faces a card shows (its count says the rest).
const FACES = 5;

type Panel =
  | { mode: "add" }
  | { mode: "view"; groupId: number }
  | { mode: "edit"; groupId: number };

/**
 * The Team page's left side: "All members" — the members' card beside
 * it, the page's one view — then its groups, crews like "Mason Crew A"
 * made by admins, super admins and project managers, as cards one under
 * another, and New Group under them. A card opens its group to view
 * (description, members by section), its pencil straight to the group's
 * form; editing and deleting are also in the view's ⋮ menu. Someone can
 * be in any number of groups, and the Gantt chart's Assign picker can put
 * a whole one on a task at once.
 */
export function GroupsPanel({
  groups,
  members,
}: {
  groups: MemberGroup[];
  members: Worker[];
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<Panel | null>(null);

  const memberById = new Map(members.map((member) => [member.id, member]));

  // Fresh from `groups`, so the window follows a refresh — and closes
  // once the group's gone.
  const panelGroup =
    panel && panel.mode !== "add" ? groups.find((group) => group.id === panel.groupId) : undefined;
  const open = panel !== null && (panel.mode === "add" || panelGroup !== undefined);

  async function handleDelete(group: MemberGroup) {
    if (!window.confirm(`Delete the group "${group.name}"? Its members stay on the team.`)) {
      return;
    }
    const result = await deleteMemberGroup(group.id);
    if (result.error) {
      window.alert(result.error);
      return;
    }
    setPanel(null);
    router.refresh();
  }

  return (
    <div className="min-w-0">
      <aside className="flex flex-col rounded-lg border border-zinc-200 bg-white p-3">
        <div className="flex items-center gap-2.5 rounded-md bg-[var(--team-accent-soft)] px-3 py-2.5 text-sm font-semibold text-[var(--team-accent)]">
          <Users aria-hidden className="size-4 shrink-0" />
          All members
        </div>

        <div className="mt-5 mb-2 flex items-center justify-between px-1">
          <span className="text-[11px] font-semibold tracking-wider text-zinc-400 uppercase">
            Team groups
          </span>
          <span className="text-xs text-zinc-400 tabular-nums">{groups.length}</span>
        </div>

        <div className="flex flex-col gap-2">
          {groups.map((group) => {
            const people = group.memberIds.flatMap((id) => {
              const member = memberById.get(id);
              return member ? [member] : [];
            });
            return (
              // A div, not a button — its pencil is a button of its own.
              <div
                key={group.id}
                role="button"
                tabIndex={0}
                aria-label={`View ${group.name}`}
                onClick={() => setPanel({ mode: "view", groupId: group.id })}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
                    e.preventDefault();
                    setPanel({ mode: "view", groupId: group.id });
                  }
                }}
                className="flex w-full cursor-pointer flex-col items-start gap-2.5 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left transition hover:border-zinc-400"
              >
                <div className="flex w-full items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-zinc-900">{group.name}</p>
                    <p className="text-xs text-zinc-500">
                      {people.length} member{people.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPanel({ mode: "edit", groupId: group.id });
                    }}
                    title="Edit group"
                    aria-label={`Edit ${group.name}`}
                    className={`${ICON_BUTTON} -mt-0.5 -mr-1.5 hover:bg-zinc-100 hover:text-zinc-700`}
                  >
                    <EditIcon className="size-3.5" />
                  </button>
                </div>
                {people.length > 0 && (
                  <div className="flex -space-x-1.5">
                    {people.slice(0, FACES).map((member) => (
                      <span
                        key={member.id}
                        title={member.fullName}
                        className="rounded-full ring-2 ring-white"
                      >
                        <InitialsAvatar name={member.fullName} />
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 border-t border-zinc-200 pt-2">
          <button
            type="button"
            onClick={() => setPanel({ mode: "add" })}
            className="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded py-2 text-sm font-medium text-[var(--team-accent)] transition hover:bg-[var(--team-accent-soft)]"
          >
            <Plus className="size-4" />
            New Group
          </button>
        </div>
      </aside>

      <Modal
        open={open}
        onClose={() => setPanel(null)}
        title={panelGroup ? panelGroup.name : "New Group"}
        menuItems={
          panel?.mode === "view" && panelGroup
            ? [
                {
                  label: "Edit",
                  onSelect: () => setPanel({ mode: "edit", groupId: panelGroup.id }),
                },
                {
                  label: "Delete",
                  destructive: true,
                  onSelect: () => handleDelete(panelGroup),
                },
              ]
            : undefined
        }
      >
        {panel?.mode === "view" && panelGroup && (
          <GroupView group={panelGroup} members={members} />
        )}
        {panel?.mode === "edit" && panelGroup && (
          <GroupForm
            key={panelGroup.id}
            group={panelGroup}
            members={members}
            onDone={() => setPanel({ mode: "view", groupId: panelGroup.id })}
          />
        )}
        {panel?.mode === "add" && (
          <GroupForm key="new" members={members} onDone={() => setPanel(null)} />
        )}
      </Modal>
    </div>
  );
}

/** One group, to look at: its description, who made it, and its members
 * under the Team's own section labels. */
function GroupView({ group, members }: { group: MemberGroup; members: Worker[] }) {
  const people = members.filter((member) => group.memberIds.includes(member.id));
  const sections = memberSections(people);

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-sm">
        <dt className="text-zinc-500">Description</dt>
        <dd className="text-zinc-900">{group.description || "—"}</dd>
        <dt className="text-zinc-500">Created By</dt>
        <dd className="text-zinc-900">{group.createdByName || "—"}</dd>
      </dl>

      {/* Edge to edge: -mx-6 takes back the modal body's own px-6. */}
      <div aria-hidden="true" className="-mx-6 border-t border-zinc-200" />

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-zinc-900">Members</h3>
          <span className="text-xs text-zinc-500">
            {people.length} member{people.length === 1 ? "" : "s"}
          </span>
        </div>
        {people.length === 0 ? (
          <p className="text-sm text-zinc-400">No members yet.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {sections.map((section) => (
              <div key={section.key} className="flex flex-col gap-0.5">
                <SectionLabel label={section.label} />
                {section.members.map((member) => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2.5 px-2 py-1.5 text-sm"
                  >
                    <InitialsAvatar name={member.fullName} />
                    <span className="truncate font-medium text-zinc-900">{member.fullName}</span>
                    {member.title && (
                      <span className="shrink-0 text-xs text-zinc-400">{member.title}</span>
                    )}
                    {member.employmentType === "subcontractor" &&
                      member.subcontractorCompany && (
                        <span className="ml-auto shrink-0 text-xs text-zinc-400">
                          {member.subcontractorCompany}
                        </span>
                      )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** A group's name, description and members — the members picked from the
 * whole Team. */
function GroupForm({
  group,
  members,
  onDone,
}: {
  group?: MemberGroup;
  members: Worker[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(group?.name ?? "");
  const [description, setDescription] = useState(group?.description ?? "");
  const [picked, setPicked] = useState<ReadonlySet<number>>(() => new Set(group?.memberIds));
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const sections = memberSections(
    members.filter(
      (member) =>
        !q ||
        member.fullName.toLowerCase().includes(q) ||
        (member.title ?? "").toLowerCase().includes(q)
    )
  );

  function toggle(id: number) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSave() {
    setError(null);
    setPending(true);
    const result = await saveMemberGroup(group?.id ?? null, {
      name,
      description,
      memberIds: Array.from(picked),
    });
    setPending(false);
    if (result.error) {
      setError(result.error);
      return;
    }
    router.refresh();
    onDone();
  }

  return (
    <div className="flex h-full min-h-full flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Group Name</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Mason Crew A"
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className={LABEL}>Description</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Optional"
          className={INPUT}
        />
      </label>

      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className={LABEL}>Members</span>
          <span className="text-xs text-zinc-500">{picked.size} selected</span>
        </div>
        {members.length === 0 ? (
          <p className="py-4 text-center text-sm text-zinc-400">No team members yet.</p>
        ) : (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name or role"
                aria-label="Search the team"
                className="w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>
            {/* Labeled by the Team's own sections. */}
            <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
              {sections.length === 0 && (
                <p className="py-4 text-center text-sm text-zinc-400">No members match.</p>
              )}
              {sections.map((section) => (
                <div key={section.key} className="flex flex-col gap-0.5">
                  <SectionLabel label={section.label} />
                  {section.members.map((member) => (
                    <label
                      key={member.id}
                      className="flex cursor-pointer items-center gap-2.5 rounded px-2 py-1.5 text-sm text-zinc-700 transition hover:bg-zinc-50"
                    >
                      <Checkbox
                        checked={picked.has(member.id)}
                        onChange={() => toggle(member.id)}
                        label={`Select ${member.fullName}`}
                      />
                      <span className="truncate">{member.fullName}</span>
                      {member.title && (
                        <span className="shrink-0 text-xs text-zinc-400">{member.title}</span>
                      )}
                      {member.employmentType === "subcontractor" &&
                        member.subcontractorCompany && (
                          <span className="ml-auto shrink-0 text-xs text-zinc-400">
                            {member.subcontractorCompany}
                          </span>
                        )}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}

      <div className="mt-auto flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={onDone}
          className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={pending || !name.trim()}
          className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? "Saving..." : group ? "Save Group" : "Create Group"}
        </button>
      </div>
    </div>
  );
}
