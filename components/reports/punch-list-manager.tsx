"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ChevronDown, ClipboardList, Plus } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { savePunchItem } from "@/lib/reports/punch-list-actions";
import {
  ISSUE_TYPE_LABELS,
  PUNCH_ISSUE_TYPES,
  PUNCH_STATUSES,
  PUNCH_STATUS_LABELS,
  type PunchIssueType,
  type PunchItem,
} from "@/lib/reports/punch-list-model";

const input =
  "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500";
const selectClass = `${input} cursor-pointer appearance-none pr-9`;
const blank = null;

export function PunchListManager({
  data,
  onClose,
  onSaved,
}: {
  data: CloseoutReportData;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selected, setSelected] = useState<PunchItem | null>(blank);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const formKey = selected?.id ?? "new";
  const assignees = [
    { id: data.project.projectManagerId, name: data.project.projectManagerName, role: "Project Manager" },
    { id: data.project.foremanId, name: data.project.foremanName, role: "Foreman" },
  ].filter((person, index, list) => person.id && list.findIndex((other) => other.id === person.id) === index);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const issueType = String(form.get("issueType") ?? "") as PunchIssueType;
    const title = ISSUE_TYPE_LABELS[issueType] || "Punch item";
    form.set("title", title);

    const workKey = String(form.get("relatedWorkKey") ?? "");
    form.set("relatedWorkName", data.work.find((item) => item.key === workKey)?.name ?? "");
    setError("");
    startTransition(async () => {
      const result = await savePunchItem(data.project.id, form);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <form
      key={formKey}
      id="punch-item-form"
      onSubmit={submit}
      className="grid h-full min-h-[34rem] md:grid-cols-[16rem_minmax(0,1fr)]"
    >
      <aside className="flex flex-col border-b border-zinc-200 bg-zinc-50 md:border-b-0 md:border-r">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className={`flex w-full cursor-pointer items-center gap-2 border-b border-zinc-200 px-4 py-3.5 text-left text-sm font-medium transition ${
            selected === null ? "bg-white text-zinc-900" : "text-zinc-600 hover:bg-white"
          }`}
        >
          <Plus className="size-4" />
          <span>New punch item</span>
        </button>
        <div className="flex-1 overflow-y-auto">
          {data.punchItems.map((item) => {
            const active = selected?.id === item.id;
            const itemDisplayName = ISSUE_TYPE_LABELS[item.issue_type] || item.title;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelected(item)}
                className={`block w-full cursor-pointer border-b border-zinc-200 px-4 py-3.5 text-left transition ${
                  active ? "bg-white" : "hover:bg-white"
                }`}
              >
                <span className="block truncate text-sm font-medium text-zinc-900">
                  PL-{String(item.id).padStart(4, "0")} · {itemDisplayName}
                </span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs text-zinc-500">
                  <span className="truncate">{item.area}</span>
                  <span className="shrink-0">{PUNCH_STATUS_LABELS[item.status]}</span>
                </span>
              </button>
            );
          })}
          {!data.punchItems.length && (
            <p className="px-4 py-8 text-center text-xs text-zinc-400">No punch-list items yet.</p>
          )}
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        <fieldset
          disabled={pending}
          className="grid gap-4.5 p-6 disabled:opacity-60 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start"
        >
          <input type="hidden" name="itemId" value={selected?.id ?? ""} />
          <input type="hidden" name="priority" value={selected?.priority ?? "medium"} />
          <input type="hidden" name="relatedWorkKey" value="" />
          <input type="hidden" name="dueDate" value="" />
          <input type="hidden" name="correctionNotes" value={selected?.correction_notes ?? ""} />
          <input type="hidden" name="verificationNotes" value={selected?.verification_notes ?? ""} />

          <label htmlFor="punch-type" className="pt-2 text-sm font-medium text-zinc-900">
            Type of issue
          </label>
          <div className="relative">
            <select
              id="punch-type"
              name="issueType"
              defaultValue={selected?.issue_type ?? "incomplete"}
              className={selectClass}
            >
              {PUNCH_ISSUE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ISSUE_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
          </div>

          <label htmlFor="punch-trade" className="pt-2 text-sm font-medium text-zinc-900">
            Trade and party responsible
          </label>
          <input
            id="punch-trade"
            name="responsibleTrade"
            maxLength={200}
            defaultValue={selected?.responsible_trade ?? ""}
            placeholder="e.g., Electrical team"
            className={input}
          />

          <label htmlFor="punch-area" className="pt-2 text-sm font-medium text-zinc-900">
            Area *
          </label>
          <input
            id="punch-area"
            name="area"
            required
            maxLength={120}
            defaultValue={selected?.area ?? ""}
            placeholder="Floor, room, or site area"
            className={input}
          />

          <label htmlFor="punch-location" className="pt-2 text-sm font-medium text-zinc-900">
            Specific location
          </label>
          <input
            id="punch-location"
            name="specificLocation"
            maxLength={500}
            defaultValue={selected?.specific_location ?? ""}
            className={input}
          />

          <label htmlFor="punch-date" className="pt-2 text-sm font-medium text-zinc-900">
            Date identified
          </label>
          <input
            id="punch-date"
            type="date"
            name="identifiedOn"
            required
            defaultValue={selected?.identified_on ?? data.asOf}
            className={input}
          />

          <label htmlFor="punch-description" className="pt-2 text-sm font-medium text-zinc-900">
            Description *
          </label>
          <textarea
            id="punch-description"
            name="description"
            required
            rows={4}
            maxLength={5000}
            defaultValue={selected?.description ?? ""}
            className={input}
          />

          <label htmlFor="punch-evidence" className="pt-2 text-sm font-medium text-zinc-900">
            Photo and video
          </label>
          <div className="space-y-2">
            <input
              id="punch-evidence"
              type="file"
              name="beforePhoto"
              accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime"
              className={input}
            />
            {selected?.before_photo_url && (
              <a
                href={selected.before_photo_url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-zinc-500 underline"
              >
                View attached file
              </a>
            )}
          </div>

          <label htmlFor="punch-assignee" className="pt-2 text-sm font-medium text-zinc-900">
            Action person
          </label>
          <div className="relative">
            <select
              id="punch-assignee"
              name="assignedTo"
              defaultValue={selected?.assigned_to ?? ""}
              className={selectClass}
            >
              <option value="">Unassigned</option>
              {assignees.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name || person.role} — {person.role}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
          </div>

          <label htmlFor="punch-status" className="pt-2 text-sm font-medium text-zinc-900">
            Current status
          </label>
          <div className="relative">
            <select
              id="punch-status"
              name="status"
              defaultValue={selected?.status === "closed" ? "closed" : "open"}
              className={selectClass}
            >
              {PUNCH_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {PUNCH_STATUS_LABELS[value]}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400"
            />
          </div>
        </fieldset>

        <ModalFooter>
          {error && (
            <p role="alert" className="mr-auto text-sm text-red-600">
              {error}
            </p>
          )}
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            form="punch-item-form"
            disabled={pending}
            className="inline-flex cursor-pointer items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800 disabled:opacity-50"
          >
            <ClipboardList className="size-4" />
            {pending ? "Saving…" : selected ? "Save changes" : "Add punch item"}
          </button>
        </ModalFooter>
      </div>
    </form>
  );
}
