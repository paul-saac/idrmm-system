"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ChevronDown, ClipboardCheck, Plus } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { saveQualityInspection } from "@/lib/reports/quality-inspection-actions";
import {
  QUALITY_INSPECTION_TYPES,
  QUALITY_INSPECTION_TYPE_LABELS,
  QUALITY_RESULTS,
  QUALITY_RESULT_LABELS,
  type QualityInspection,
} from "@/lib/reports/quality-inspection-model";

const input = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500";
const selectClass = `${input} cursor-pointer appearance-none pr-9`;
const SelectIcon = () => <ChevronDown aria-hidden className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />;

export function QualityInspectionManager({ data, onClose, onSaved }: { data: CloseoutReportData; onClose: () => void; onSaved: () => void }) {
  const [selected, setSelected] = useState<QualityInspection | null>(null);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const documents = (data.sheets ?? []).filter(sheet => sheet.status === "accepted");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    startTransition(async () => {
      const result = await saveQualityInspection(data.project.id, new FormData(event.currentTarget));
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <form key={selected?.id ?? "new"} id="quality-inspection-form" onSubmit={submit} className="grid h-full min-h-[34rem] md:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="flex flex-col border-b border-zinc-200 bg-zinc-50 md:border-r md:border-b-0">
        <button type="button" onClick={() => setSelected(null)} className={`flex items-center gap-2 border-b border-zinc-200 px-4 py-3.5 text-left text-sm font-medium ${selected === null ? "bg-white" : "hover:bg-white"}`}>
          <Plus className="size-4" />New inspection
        </button>
        <div className="flex-1 overflow-y-auto">
          {data.qualityInspections.map(item => (
            <button key={item.id} type="button" onClick={() => setSelected(item)} className={`block w-full border-b border-zinc-200 px-4 py-3.5 text-left hover:bg-white ${selected?.id === item.id ? "bg-white" : ""}`}>
              <span className="block truncate text-sm font-medium">INS-{String(item.id).padStart(4, "0")} · {QUALITY_INSPECTION_TYPE_LABELS[item.inspection_type]}</span>
              <span className="mt-1 flex justify-between gap-2 text-xs text-zinc-500"><span className="truncate">{item.area}</span><span>{QUALITY_RESULT_LABELS[item.result]}</span></span>
            </button>
          ))}
          {!data.qualityInspections.length && <p className="px-4 py-8 text-center text-xs text-zinc-400">No inspections recorded yet.</p>}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col overflow-y-auto">
        <fieldset disabled={pending} className="grid gap-4.5 p-6 disabled:opacity-60 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-start">
          <input type="hidden" name="inspectionId" value={selected?.id ?? ""} />

          <label htmlFor="qa-type" className="pt-2 text-sm font-medium">Inspection type</label>
          <div className="relative"><select id="qa-type" name="inspectionType" defaultValue={selected?.inspection_type ?? "architectural"} className={selectClass}>{QUALITY_INSPECTION_TYPES.map(value => <option key={value} value={value}>{QUALITY_INSPECTION_TYPE_LABELS[value]}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-scope" className="pt-2 text-sm font-medium">Work inspected *</label>
          <input id="qa-scope" name="inspectionScope" required maxLength={300} defaultValue={selected?.inspection_scope ?? ""} placeholder="e.g. Concrete footings" className={input} />

          <label htmlFor="qa-area" className="pt-2 text-sm font-medium">Area / location *</label>
          <input id="qa-area" name="area" required maxLength={200} defaultValue={selected?.area ?? ""} placeholder="e.g. Grid A1–A5" className={input} />

          <label htmlFor="qa-date" className="pt-2 text-sm font-medium">Inspection date *</label>
          <DatePicker id="qa-date" name="inspectedOn" ariaLabel="Inspection date" required defaultValue={selected?.inspected_on ?? data.asOf} className={input} />

          <label htmlFor="qa-inspector" className="pt-2 text-sm font-medium">Inspector name *</label>
          <input id="qa-inspector" name="inspectorName" required maxLength={200} defaultValue={selected?.inspector_name ?? ""} className={input} />

          <label htmlFor="qa-org" className="pt-2 text-sm font-medium">Organization</label>
          <input id="qa-org" name="inspectorOrganization" maxLength={200} defaultValue={selected?.inspector_organization ?? ""} placeholder="Company, laboratory, or authority" className={input} />

          <label htmlFor="qa-result" className="pt-2 text-sm font-medium">Result</label>
          <div className="relative"><select id="qa-result" name="result" defaultValue={selected?.result ?? "pending"} className={selectClass}>{QUALITY_RESULTS.map(value => <option key={value} value={value}>{QUALITY_RESULT_LABELS[value]}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-test" className="pt-2 text-sm font-medium">Test name</label>
          <input id="qa-test" name="testName" maxLength={200} defaultValue={selected?.test_name ?? ""} placeholder="Optional, e.g. concrete strength" className={input} />

          <label htmlFor="qa-criteria" className="pt-2 text-sm font-medium">Required result</label>
          <input id="qa-criteria" name="acceptanceCriteria" maxLength={500} defaultValue={selected?.acceptance_criteria ?? ""} placeholder="Optional, e.g. minimum 28 MPa" className={input} />

          <label htmlFor="qa-actual" className="pt-2 text-sm font-medium">Actual result</label>
          <div className="grid gap-2 sm:grid-cols-[1fr_7rem]"><input id="qa-actual" name="actualResult" maxLength={500} defaultValue={selected?.actual_result ?? ""} className={input} /><input name="resultUnit" aria-label="Result unit" maxLength={50} defaultValue={selected?.result_unit ?? ""} placeholder="Unit" className={input} /></div>

          <label htmlFor="qa-document" className="pt-2 text-sm font-medium">Supporting document</label>
          <div className="relative"><select id="qa-document" name="relatedSheetId" defaultValue={selected?.related_sheet_id ?? ""} className={selectClass}><option value="">No supporting document</option>{documents.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.sheet_number} — {sheet.title}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-remarks" className="pt-2 text-sm font-medium">Findings / remarks</label>
          <textarea id="qa-remarks" name="remarks" rows={4} maxLength={5000} defaultValue={selected?.remarks ?? ""} placeholder="Inspection findings or notes" className={input} />
        </fieldset>

        <ModalFooter>
          {error && <p role="alert" className="mr-auto text-sm text-red-600">{error}</p>}
          <button type="button" disabled={pending} onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm font-medium hover:bg-zinc-50">Cancel</button>
          <button type="submit" form="quality-inspection-form" disabled={pending} className="inline-flex items-center gap-2 rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><ClipboardCheck className="size-4" />{pending ? "Saving…" : selected ? "Save changes" : "Add inspection"}</button>
        </ModalFooter>
      </div>
    </form>
  );
}
