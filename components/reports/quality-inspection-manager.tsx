"use client";

import { useState, useTransition, type FormEvent } from "react";
import { ChevronDown, ClipboardCheck, Plus } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { saveQualityInspection } from "@/lib/reports/quality-inspection-actions";
import { PUNCH_STATUS_LABELS } from "@/lib/reports/punch-list-model";
import {
  QUALITY_AUTHORITY_TYPES,
  QUALITY_AUTHORITY_TYPE_LABELS,
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
    const form = new FormData(event.currentTarget);
    const workKey = String(form.get("relatedWorkKey") ?? "");
    form.set("relatedWorkName", data.work.find(item => item.key === workKey)?.name ?? "");
    setError("");
    startTransition(async () => {
      const result = await saveQualityInspection(data.project.id, form);
      if (result.error) setError(result.error);
      else onSaved();
    });
  }

  return (
    <form key={selected?.id ?? "new"} id="quality-inspection-form" onSubmit={submit} className="grid h-full min-h-[38rem] md:grid-cols-[17rem_minmax(0,1fr)]">
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
        <fieldset disabled={pending} className="grid gap-4.5 p-6 disabled:opacity-60 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-start">
          <input type="hidden" name="inspectionId" value={selected?.id ?? ""} />
          <input type="hidden" name="relatedWorkName" value="" />

          <label htmlFor="qa-type" className="pt-2 text-sm font-medium">Inspection type</label>
          <div className="relative"><select id="qa-type" name="inspectionType" defaultValue={selected?.inspection_type ?? "architectural"} className={selectClass}>{QUALITY_INSPECTION_TYPES.map(value => <option key={value} value={value}>{QUALITY_INSPECTION_TYPE_LABELS[value]}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-scope" className="pt-2 text-sm font-medium">Inspection scope / system *</label>
          <input id="qa-scope" name="inspectionScope" required maxLength={300} defaultValue={selected?.inspection_scope ?? ""} placeholder="e.g. Concrete footings, electrical installation" className={input} />

          <label htmlFor="qa-work" className="pt-2 text-sm font-medium">Related task</label>
          <div className="relative"><select id="qa-work" name="relatedWorkKey" defaultValue={selected?.related_work_key ?? ""} className={selectClass}><option value="">Not linked to a task</option>{data.work.map(item => <option key={item.key} value={item.key}>{item.phase} — {item.name}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-area" className="pt-2 text-sm font-medium">Area / location *</label>
          <input id="qa-area" name="area" required maxLength={200} defaultValue={selected?.area ?? ""} className={input} />

          <label htmlFor="qa-date" className="pt-2 text-sm font-medium">Inspection date *</label>
          <input id="qa-date" name="inspectedOn" type="date" required defaultValue={selected?.inspected_on ?? data.asOf} className={input} />

          <label htmlFor="qa-inspector" className="pt-2 text-sm font-medium">Inspector name *</label>
          <input id="qa-inspector" name="inspectorName" required maxLength={200} defaultValue={selected?.inspector_name ?? ""} className={input} />

          <label htmlFor="qa-authority" className="pt-2 text-sm font-medium">Sign-off authority</label>
          <div className="relative"><select id="qa-authority" name="authorityType" defaultValue={selected?.authority_type ?? "third_party_inspector"} className={selectClass}>{QUALITY_AUTHORITY_TYPES.map(value => <option key={value} value={value}>{QUALITY_AUTHORITY_TYPE_LABELS[value]}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-role" className="pt-2 text-sm font-medium">Role / title</label>
          <input id="qa-role" name="inspectorRole" maxLength={200} defaultValue={selected?.inspector_role ?? ""} placeholder="Engineer, architect, authority inspector" className={input} />

          <label htmlFor="qa-org" className="pt-2 text-sm font-medium">Organization</label>
          <input id="qa-org" name="inspectorOrganization" maxLength={200} defaultValue={selected?.inspector_organization ?? ""} className={input} />

          <label htmlFor="qa-license" className="pt-2 text-sm font-medium">License / accreditation</label>
          <input id="qa-license" name="licenseNumber" maxLength={120} defaultValue={selected?.license_number ?? ""} className={input} />

          <label htmlFor="qa-certificate" className="pt-2 text-sm font-medium">Certificate / report number</label>
          <input id="qa-certificate" name="certificateNumber" maxLength={150} defaultValue={selected?.certificate_number ?? ""} className={input} />

          <label htmlFor="qa-issued" className="pt-2 text-sm font-medium">Certificate issue date</label>
          <input id="qa-issued" name="issuedOn" type="date" defaultValue={selected?.issued_on ?? ""} className={input} />

          <label htmlFor="qa-result" className="pt-2 text-sm font-medium">Inspection result</label>
          <div className="relative"><select id="qa-result" name="result" defaultValue={selected?.result ?? "pending"} className={selectClass}>{QUALITY_RESULTS.map(value => <option key={value} value={value}>{QUALITY_RESULT_LABELS[value]}</option>)}</select><SelectIcon /></div>

          <label htmlFor="qa-standard" className="pt-2 text-sm font-medium">Standard / specification</label>
          <input id="qa-standard" name="standardReference" maxLength={500} defaultValue={selected?.standard_reference ?? ""} placeholder="e.g. ACI 318, PEC 2017, drawing S-04" className={input} />

          <label htmlFor="qa-test" className="pt-2 text-sm font-medium">Test name</label>
          <input id="qa-test" name="testName" maxLength={200} defaultValue={selected?.test_name ?? ""} placeholder="Optional, e.g. concrete compressive strength" className={input} />

          <label htmlFor="qa-criteria" className="pt-2 text-sm font-medium">Acceptance criteria</label>
          <input id="qa-criteria" name="acceptanceCriteria" maxLength={500} defaultValue={selected?.acceptance_criteria ?? ""} className={input} />

          <label htmlFor="qa-actual" className="pt-2 text-sm font-medium">Actual result</label>
          <div className="grid gap-2 sm:grid-cols-[1fr_8rem]"><input id="qa-actual" name="actualResult" maxLength={500} defaultValue={selected?.actual_result ?? ""} className={input} /><input name="resultUnit" aria-label="Result unit" maxLength={50} defaultValue={selected?.result_unit ?? ""} placeholder="Unit" className={input} /></div>

          <label htmlFor="qa-document" className="pt-2 text-sm font-medium">Supporting document</label>
          <div className="space-y-1.5"><div className="relative"><select id="qa-document" name="relatedSheetId" defaultValue={selected?.related_sheet_id ?? ""} className={selectClass}><option value="">No linked signed document</option>{documents.map(sheet => <option key={sheet.id} value={sheet.id}>{sheet.sheet_number} — {sheet.title}</option>)}</select><SelectIcon /></div><p className="text-xs text-zinc-500">A linked accepted document is required for the report to show this as documented sign-off evidence.</p></div>

          <div className="sm:col-span-2 mt-2 border-t border-zinc-200 pt-5">
            <h3 className="text-sm font-semibold text-zinc-900">Nonconformance and corrective action</h3>
            <p className="mt-1 text-xs text-zinc-500">Complete these fields for failed, conditional, or reinspection-required results.</p>
          </div>

          <label htmlFor="qa-nonconformance" className="pt-2 text-sm font-medium">Nonconformance</label>
          <textarea id="qa-nonconformance" name="nonconformanceDescription" rows={3} maxLength={5000} defaultValue={selected?.nonconformance_description ?? ""} className={input} />

          <label htmlFor="qa-corrective-action" className="pt-2 text-sm font-medium">Corrective action required</label>
          <textarea id="qa-corrective-action" name="correctiveActionRequired" rows={3} maxLength={5000} defaultValue={selected?.corrective_action_required ?? ""} className={input} />

          <label htmlFor="qa-punch-item" className="pt-2 text-sm font-medium">Linked punch-list item</label>
          <div className="space-y-1.5"><div className="relative"><select id="qa-punch-item" name="punchItemId" defaultValue={selected?.punch_item_id ?? ""} className={selectClass}><option value="">No linked punch-list item</option>{data.punchItems.map(item => <option key={item.id} value={item.id}>PL-{String(item.id).padStart(4, "0")} — {item.title} ({PUNCH_STATUS_LABELS[item.status]})</option>)}</select><SelectIcon /></div><p className="text-xs text-zinc-500">The punch-list item supplies the responsible person, priority, due date, and resolution status.</p></div>

          <label htmlFor="qa-reinspection" className="pt-2 text-sm font-medium">Reinspection reference</label>
          <input id="qa-reinspection" name="reinspectionReference" maxLength={150} defaultValue={selected?.reinspection_reference ?? ""} placeholder="Inspection reference or certificate number" className={input} />

          <label htmlFor="qa-remarks" className="pt-2 text-sm font-medium">Remarks / findings</label>
          <textarea id="qa-remarks" name="remarks" rows={4} maxLength={5000} defaultValue={selected?.remarks ?? ""} className={input} />
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
