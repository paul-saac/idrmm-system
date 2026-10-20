"use client";

import { useState, useTransition, type ReactNode, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { TABLE, HEAD_ROW, HEAD_CELL, BODY, CELL } from "@/components/ui/list-table";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { CLOSEOUT_FIELDS, dayVariance, type CloseoutNotes } from "@/lib/reports/closeout-model";
import { saveCloseoutReport } from "@/lib/reports/closeout-actions";

const date = (value: string | null | undefined) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not recorded";
const variance = (days: number | null) => days === null ? "Not recorded" : days === 0 ? "On time" : `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ${days > 0 ? "late" : "early"}`;
const inputClass = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500";

function Section({ title, count, children }: { title: string; count?: number; children: ReactNode }) {
  return <section className="overflow-hidden rounded border border-zinc-200 bg-white">
    <h3 className="flex items-center gap-2 border-b border-zinc-200 px-5 py-3 text-sm font-medium text-zinc-900">{title}{count !== undefined && <span className="text-xs font-normal text-zinc-400">{count}</span>}</h3>
    {children}
  </section>;
}

function ReportTable({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: string }) {
  return <div className="overflow-x-auto"><table className={TABLE}>
    <thead><tr className={HEAD_ROW}>{headers.map((header) => <th key={header} scope="col" className={`${HEAD_CELL} whitespace-nowrap`}>{header}</th>)}</tr></thead>
    <tbody className={BODY}>{empty ? <tr><td colSpan={headers.length} className="px-5 py-7 text-center text-zinc-400">{empty}</td></tr> : children}</tbody>
  </table></div>;
}

function Notes({ notes, keys }: { notes: CloseoutNotes; keys: (keyof CloseoutNotes)[] }) {
  return <dl className="grid gap-x-8 gap-y-5 p-5">{keys.map((key) => <div key={key}>
    <dt className="mb-1 text-xs text-zinc-500">{CLOSEOUT_FIELDS.find((field) => field.key === key)?.label}</dt>
    <dd className={`whitespace-pre-wrap break-words text-sm leading-relaxed ${notes[key] ? "text-zinc-700" : "text-zinc-400"}`}>{notes[key] || "Not recorded"}</dd>
  </div>)}</dl>;
}

export function CloseoutEditor({ data, onClose }: { data: CloseoutReportData; onClose: () => void }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string>();
  const sections = [...new Set(CLOSEOUT_FIELDS.map((field) => field.section))];
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await saveCloseoutReport(data.project.id, {}, form);
        if (result.error) setError(result.error);
        else onClose();
      } catch {
        setError("Could not save the report. Your entries are still here; please try again.");
      }
    });
  }
  return <form id="closeout-details" onSubmit={submit}>
    <input type="hidden" name="version" value={data.record?.version ?? 0} />
    <fieldset disabled={pending} className="space-y-7 disabled:opacity-70">
      <p className="text-xs leading-relaxed text-zinc-500">Summarize the project lifecycle, final outcomes, key milestones met, and overall performance.</p>
      {sections.map((section) => <div key={section}>
        <h4 className="mb-4 border-b border-zinc-200 pb-2 text-sm font-medium">{section}</h4>
        <div className="grid gap-4">{CLOSEOUT_FIELDS.filter((field) => field.section === section).map((field) => <label key={field.key} className="space-y-1.5 text-xs text-zinc-600">
          <span>{field.label}</span>
          <textarea name={field.key} defaultValue={data.record?.notes[field.key] ?? ""} maxLength={10000} rows={4} className={inputClass} />
        </label>)}</div>
      </div>)}
      {data.work.some((item) => item.milestone) && <div>
        <h4 className="mb-4 border-b border-zinc-200 pb-2 text-sm font-medium">Recorded milestone achievement dates</h4>
        <p className="mb-3 text-xs text-zinc-500">Enter the confirmed date each milestone was achieved. Leave blank when unconfirmed.</p>
        <div className="grid gap-4 md:grid-cols-2">{data.work.filter((item) => item.milestone).map((item) => <label key={item.key} className="space-y-1.5 text-xs text-zinc-600">
          <span>{item.name}</span><input type="date" name={`milestone:${item.key}`} max={data.asOf} defaultValue={data.record?.milestone_dates[item.key] ?? ""} className={inputClass} />
        </label>)}</div>
      </div>}
    </fieldset>
    <ModalFooter><div className="flex w-full flex-wrap items-center justify-end gap-3">
      {error && <p role="alert" className="mr-auto max-w-lg text-sm text-red-600">{error}</p>}
      <button type="button" disabled={pending} onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
      <button type="submit" form="closeout-details" disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save report details"}</button>
    </div></ModalFooter>
  </form>;
}

export function CloseoutReport({ data }: { data: CloseoutReportData }) {
  const [editing, setEditing] = useState(false);
  const notes = data.record?.notes ?? {};
  const milestonesMet = data.work.filter((item) => item.milestone && data.record?.milestone_dates[item.key]);
  const completed = data.work.filter((item) => item.percent >= 100).length;
  const scheduleVariance = dayVariance(data.project.targetEndDate, data.project.actualEndDate);
  return <div className="flex flex-col gap-5 px-4 py-6 sm:px-8">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h2 className="text-base font-semibold text-zinc-900">Project closeout report</h2>
        <p className="mt-1 text-xs text-zinc-500">Master summary of the project lifecycle · As of {date(data.asOf)}</p>
        <p className="mt-1 text-xs text-zinc-400">{data.record ? `Review last saved ${date(data.record.updated_at)}${data.savedBy ? ` by ${data.savedBy}` : ""}` : "Closeout review has not been saved yet."}</p>
      </div>
      <button disabled={!data.storageAvailable} onClick={() => setEditing(true)} className="flex items-center gap-2 rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"><Pencil className="size-3.5" />Edit closeout details</button>
    </div>
    {!data.storageAvailable && <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">Closeout detail saving is not available yet. Contact your administrator to enable it. Project figures remain available below.</p>}
    <Section title="Project lifecycle summary">
      <dl className="grid gap-4 border-b border-zinc-200 p-5 sm:grid-cols-3">{[
        ["Project start", date(data.project.startDate)],
        ["Target completion", date(data.project.targetEndDate)],
        ["Recorded actual completion", date(data.project.actualEndDate)],
      ].map(([label, value]) => <div key={label}><dt className="text-xs text-zinc-500">{label}</dt><dd className="mt-1 text-sm font-medium">{value}</dd></div>)}</dl>
      <Notes notes={notes} keys={["summary"]} />
    </Section>
    <Section title="Final outcomes"><Notes notes={notes} keys={["outcomes"]} /></Section>
    <Section title="Key milestones met" count={milestonesMet.length}>
      <ReportTable headers={["Milestone", "Phase", "Planned date", "Recorded achievement", "Variance"]} empty={!milestonesMet.length ? "No milestone achievements have been recorded yet." : undefined}>
        {milestonesMet.map((item) => <tr key={item.key}><td className={CELL}>{item.name}</td><td className={CELL}>{item.phase}</td><td className={CELL}>{date(item.end)}</td><td className={CELL}>{date(data.record?.milestone_dates[item.key])}</td><td className={CELL}>{variance(dayVariance(item.end, data.record?.milestone_dates[item.key] ?? null))}</td></tr>)}
      </ReportTable>
    </Section>
    <Section title="Overall performance">
      <div className="grid gap-4 border-b border-zinc-200 bg-zinc-50/50 p-5 sm:grid-cols-3">
        <div><p className="text-xs text-zinc-500">Gantt completion</p><p className="mt-1 text-lg font-semibold">{data.progressPercent.toFixed(2)}%</p></div>
        <div><p className="text-xs text-zinc-500">Tracked work completed</p><p className="mt-1 text-lg font-semibold">{completed} / {data.work.length}</p></div>
        <div><p className="text-xs text-zinc-500">Completion variance</p><p className="mt-1 text-lg font-semibold">{variance(scheduleVariance)}</p></div>
      </div>
      <Notes notes={notes} keys={["performance"]} />
      <p className="px-5 pb-4 text-xs text-zinc-500">Completion follows the Gantt chart, including automatic progress. Milestones met use recorded achievement dates.</p>
    </Section>
    <Modal open={editing} onClose={() => setEditing(false)} title="Edit project closeout details" size="wide">
      <CloseoutEditor data={data} onClose={() => setEditing(false)} />
    </Modal>
  </div>;
}
