"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Bell, ChevronDown, Flag, MapPin, Paperclip, Send, X } from "lucide-react";
import { ModalFooter } from "@/components/ui/modal";
import { reportIncident } from "@/lib/incidents/actions";
import { INCIDENT_TYPES, INCIDENT_SEVERITIES, validateIncidentFiles, type IncidentContext } from "@/lib/incidents/model";

const input = "h-10 w-full min-w-0 rounded border border-zinc-200 bg-white px-3 text-sm text-zinc-700 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100";

export function IncidentReportPanel({ projectId, context, active, onSubmitted }: {
  projectId: number; context: IncidentContext; active: boolean; onSubmitted?: (id: number) => void;
}) {
  const formId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { if (active) heading.current?.focus(); }, [active]);

  function addFiles(incoming: File[]) {
    const next = [...files, ...incoming];
    const validation = validateIncidentFiles(next);
    if (validation) { setError(validation); return; }
    setError(""); setFiles(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const validation = validateIncidentFiles(files);
    if (validation) { setError(validation); return; }
    files.forEach(file => form.append("attachments", file));
    setPending(true); setError("");
    try {
      const result = await reportIncident(projectId, form);
      if (result.error) setError(result.error);
      else if (result.id) { setFiles([]); formRef.current?.reset(); onSubmitted?.(result.id); }
    } catch { setError("Could not submit the incident. Your entries are still here; please try again."); }
    finally { setPending(false); }
  }

  return (
    <section id="progress-incident-form" hidden={!active} className="h-full min-h-0 border-t border-zinc-200 bg-white lg:overflow-y-auto lg:border-t-0 lg:border-l">
      <div className="px-6 py-5">
        <h3 ref={heading} tabIndex={-1} className="flex items-center gap-2 text-base font-semibold text-zinc-900 outline-none"><Flag className="size-4 text-amber-700" />Report incident</h3>

        <>
            <form id={formId} ref={formRef} onSubmit={submit} className="mt-6">
              <input type="hidden" name="contextKind" value={context.kind} />
              <input type="hidden" name="contextId" value={context.id} />
              <fieldset disabled={pending} className="grid grid-cols-2 gap-x-3 gap-y-5 disabled:opacity-60">
                <label className="grid min-w-0 gap-2 text-xs font-medium text-zinc-800"><span>Incident type <span className="text-red-600">*</span></span><span className="relative"><select name="incidentType" required defaultValue="injury" className={`${input} flex appearance-none items-center pr-7 text-left leading-normal`}>{Object.entries(INCIDENT_TYPES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /></span></label>
                <label className="grid min-w-0 gap-2 text-xs font-medium text-zinc-800"><span>Severity <span className="text-red-600">*</span></span><span className="relative"><select name="severity" required defaultValue="minor" className={`${input} flex appearance-none items-center pr-7 text-left leading-normal`}>{Object.entries(INCIDENT_SEVERITIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown className="pointer-events-none absolute right-2 top-1/2 size-4 -translate-y-1/2 text-zinc-400" /></span></label>
                <label className="col-span-2 grid gap-2 text-xs font-medium text-zinc-800">Location<span className="relative"><input name="location" maxLength={300} placeholder="e.g. Site entrance · unloading area" className={`${input} pr-9`} /><MapPin className="pointer-events-none absolute right-3 top-3 size-4 text-zinc-400" /></span></label>
                <label className="col-span-2 grid gap-2 text-xs font-medium text-zinc-800"><span>What happened? <span className="text-red-600">*</span></span><textarea name="description" required maxLength={5000} rows={5} placeholder="Describe what happened and any immediate action taken." className={`${input} h-auto resize-y py-3 leading-relaxed`} /></label>
                <div className="col-span-2">
                  <div className="mb-2 flex justify-between text-xs"><span className="font-medium text-zinc-800">Photos or documents</span><span className="text-zinc-400">Optional</span></div>
                  <input ref={fileInput} type="file" multiple accept="image/jpeg,image/png,application/pdf" aria-label="Add incident photos or documents" className="sr-only" tabIndex={-1} onChange={event => { addFiles(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
                  <button type="button" disabled={pending} onClick={() => fileInput.current?.click()}
                    onDragOver={event => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); if (!pending) addFiles(Array.from(event.dataTransfer.files)); }}
                    className={`flex w-full flex-col items-center gap-2 rounded border border-dashed px-4 py-6 text-xs transition ${dragging ? "border-amber-400 bg-amber-50" : "border-zinc-300 bg-zinc-50 hover:bg-zinc-100"}`}>
                    <span className="flex items-center gap-2 font-medium text-zinc-800"><Paperclip className="size-4" />Add photos or files</span>
                    <span className="text-zinc-500">JPG, PNG or PDF · up to 10 MB each</span>
                    <span className="text-[10px] text-zinc-400">Up to 5 files · 15 MB total</span>
                  </button>
                  {!!files.length && <ul className="mt-2 divide-y divide-zinc-100">{files.map((file, index) => <li key={`${file.name}-${index}`} className="flex items-center gap-2 py-2 text-xs"><Paperclip className="size-3 shrink-0 text-zinc-400" /><span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles(current => current.filter((_, position) => position !== index))} className="p-1 text-zinc-500 hover:text-red-600"><X className="size-4" /></button></li>)}</ul>}
                </div>
              </fieldset>
            </form>
            <p className="mt-5 flex items-start gap-2 text-xs leading-relaxed text-zinc-500"><Bell className="mt-0.5 size-4 shrink-0" />Your supervisor will be notified in the system. Progress entries stay unchanged.</p>
            {error && <p role="alert" className="mt-4 rounded border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</p>}
        </>
      </div>
      {active && <ModalFooter>
        <div className="flex w-full items-center justify-between gap-3 lg:w-[25rem]">
          <p className="text-xs text-zinc-800">Separate incident report<span className="mt-1 block text-[10px] text-zinc-500">Does not save progress</span></p>
          <button type="submit" form={formId} disabled={pending} className="inline-flex shrink-0 items-center gap-2 rounded bg-zinc-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"><Send className="size-4" />{pending ? "Submitting…" : "Submit incident"}</button>
        </div>
      </ModalFooter>}
    </section>
  );
}
