"use client";

/* eslint-disable @next/next/no-img-element */

import { ProjectWriteButton, useProjectCanEdit } from "@/components/projects/project-access-context";
import { useState, useTransition, type FormEvent } from "react";
import { Pencil } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { DatePicker } from "@/components/ui/date-picker";
import type { CloseoutReportData } from "@/lib/reports/closeout-data";
import { CLOSEOUT_FIELDS } from "@/lib/reports/closeout-model";
import { saveCloseoutReport } from "@/lib/reports/closeout-actions";
import { generateReport, REPORT_SECTIONS, MILESTONE_COLUMNS, type GeneratedReport } from "@/lib/reports/generated-report";

const date = (value: string | null | undefined) => value ? new Date(`${value.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "Not recorded";
const inputClass = "w-full rounded border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-500";

function punchTimestamp(value: string | Date) {
  const timestamp = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(timestamp.getTime())) return "Not recorded";
  return timestamp.toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  }).replace(" at ", ", ").replace(" AM", " am").replace(" PM", " pm");
}

function punchDate(value: string) {
  const timestamp = new Date(value.length === 10 ? `${value}T00:00:00+08:00` : value);
  if (Number.isNaN(timestamp.getTime())) return value;
  return timestamp.toLocaleDateString("en-GB", {
    timeZone: "Asia/Manila",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ReportDocumentHeader() {
  return (
    <div className="grid grid-cols-[16%_minmax(0,1fr)] items-center gap-x-[3.2%] text-xs leading-snug text-zinc-700">
      <img src="/logo.png" alt="IDR M&M Logo" className="h-auto w-full object-contain" />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
        <div className="space-y-1">
          <div><span className="font-bold text-zinc-900">Organisation:</span> IDR M&amp;M Construction</div>
          <div><span className="font-bold text-zinc-900">Address:</span> D. Mariano St., Concepcion Uno, Marikina City</div>
        </div>
        <div className="text-right"><span className="font-bold text-zinc-900">Contact Number:</span> +63 967 217 3481</div>
      </div>
    </div>
  );
}

export function PunchListDocumentSheet({ report }: { report: GeneratedReport }) {
  const meta = report.metadata;
  const items =
    report.punchDetails && report.punchDetails.length > 0
      ? report.punchDetails
      : report.sections.map((section, idx) => {
          const rows = Object.fromEntries(section.rows.map(([k, v]) => [String(k), String(v)]));
          const photoP = section.paragraphs.find(
            (p) => p.startsWith("Photo and video:") || p.startsWith("Photo evidence:")
          );
          const photoUrl = photoP
            ? photoP.replace(/^Photo (?:and video|evidence):\s*/, "").replace("Not attached", "").trim()
            : "";
          const descP = section.paragraphs.find((p) => p.startsWith("Description:"));
          const description = descP
            ? descP.replace(/^Description:\s*/, "").trim()
            : section.paragraphs[0] || "Not recorded";
          return {
            id: idx + 1,
            itemNumber: section.title.includes("·")
              ? section.title.split("·")[1]?.trim() || `PL-${String(idx + 1).padStart(4, "0")}`
              : `PL-${String(idx + 1).padStart(4, "0")}`,
            formNumber: `IDR M&M - ${report.project} - DP-QUAL-${String(idx + 1).padStart(4, "0")}`,
            trade: rows["Trade and party responsible"] || "Not specified",
            area: rows["Area"] || "Not specified",
            specificLocation: rows["Specific location"] || "Not specified",
            issueType: rows["Type of issue"] || "Punch item",
            identifiedOn: rows["Date identified"] || report.asOf,
            description,
            photoUrl: photoUrl.startsWith("http") ? photoUrl : undefined,
            actionPerson: rows["Action person"] || "Unassigned",
            inspectorName:
              rows["Resolution verified by"]?.split(",")[0] ||
              rows["Inspected / reported by"] ||
              meta?.foreman ||
              "Authorized Inspector",
            inspectorSignedAt: rows["Date identified"] || report.asOf,
            formCreatedAt: `${report.asOf}T00:00:00+08:00`,
            status: rows["Current status"] || "Open",
          };
        });

  const formCreatedTimestamp = punchTimestamp(items[0]?.formCreatedAt ?? `${report.asOf}T00:00:00+08:00`);

  return (
    <div className="mx-auto w-full max-w-[850px] bg-white text-zinc-900 border border-zinc-200 shadow-lg p-6 sm:p-12 font-sans print:p-0 print:border-none print:shadow-none">
      <ReportDocumentHeader />

      <div className="mt-2 mb-6 h-[2px] w-full bg-zinc-900" />

      {/* Document Title */}
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
        Punch List Report
      </h1>

      {/* Punch List Items */}
      {items.length > 0 ? (
        items.map((item, idx) => (
          <div key={item.id ?? idx} className={idx > 0 ? "mt-8 pt-8 border-t border-zinc-200" : ""}>
            <div className="space-y-5 text-sm">
              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Automated Form Number:</span>
                <span className="font-medium text-zinc-800">{item.formNumber}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Trade and Party Responsible:</span>
                <span>{item.trade}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Area:</span>
                <span>{item.area}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Specific Location:</span>
                <span>{item.specificLocation}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Type of issue:</span>
                <span>{item.issueType}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Date identified:</span>
                <span>{punchDate(item.identifiedOn)}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6 pt-1">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Description:</span>
                <div className="flex-1 whitespace-pre-wrap leading-relaxed text-zinc-800">
                  {item.description}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6 pt-2">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Photo and video:</span>
                <div className="flex-1 space-y-1.5">
                  {item.photoUrl ? (
                    <>
                      <div className="flex flex-wrap gap-2.5">
                        <a href={item.photoUrl} target="_blank" rel="noreferrer" className="block">
                          <img
                            src={item.photoUrl}
                            alt="Punch-list photo evidence"
                            className="h-20 w-24 rounded border border-zinc-200 object-cover shadow-sm transition hover:opacity-90"
                          />
                        </a>
                      </div>
                    </>
                  ) : (
                    <span className="text-sm italic text-zinc-400">No media attached</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 pt-2">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Action Person:</span>
                <span>{item.actionPerson}</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-6 pt-2">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Inspector Signoff:</span>
                <span className="inline-block w-64 border-b border-zinc-700 pb-1 text-transparent">Signature</span>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 pt-2">
                <span className="w-52 shrink-0 font-bold text-zinc-900">Current Status:</span>
                <span className="capitalize">{item.status}</span>
              </div>
            </div>
          </div>
        ))
      ) : (
        <div className="py-12 text-center text-sm text-zinc-400">
          No punch-list items recorded for this selection.
        </div>
      )}

      <div className="mt-14 mb-3 h-[2px] w-full bg-zinc-900" />

      {/* Footer Details */}
      <div className="grid grid-cols-3 gap-4 text-xs leading-snug text-zinc-500">
        <div><span className="font-bold text-zinc-900">Prepared By:</span>{" "}{meta?.preparedBy || "Authorized user"}</div>
        <div className="text-center"><span className="font-bold text-zinc-900">Project:</span>{" "}{report.project}</div>
        <div className="text-right"><span className="font-bold text-zinc-900">Form created:</span><br />{formCreatedTimestamp}</div>
      </div>
      <p className="mt-6 text-center text-[10px] text-zinc-500">Page 1 of 1</p>
    </div>
  );
}

export function ReportDocumentSheet({ report }: { report: GeneratedReport }) {
  if (
    report.reportType === "punch" ||
    (report.punchDetails && report.punchDetails.length > 0) ||
    report.title.toLowerCase().includes("punch")
  ) {
    return <PunchListDocumentSheet report={report} />;
  }

  const meta = report.metadata;
  const formCreatedTimestamp = punchTimestamp(report.metadata?.startDate ?? `${report.asOf}T00:00:00+08:00`);

  return (
    <div className="mx-auto w-full max-w-[850px] bg-white text-zinc-900 border border-zinc-200 shadow-lg p-6 sm:p-12 font-sans print:p-0 print:border-none print:shadow-none">
      <ReportDocumentHeader />

      {/* Horizontal Divider Line with lessened gap */}
      <div className="mt-2 mb-6 h-[2px] w-full bg-zinc-900" />

      {/* Document Title */}
      <h1 className="mb-6 text-2xl font-bold tracking-tight text-zinc-900 sm:text-3xl">
        {report.title}
      </h1>

      {/* Sections */}
      <div className="space-y-8">
        {report.sections.map((section, sIdx) => {
          const hasTable = section.headers.length > 0;
          return (
            <section key={section.title || sIdx} className="space-y-3">
              {/* Clean Section Header */}
              <div className="border-b border-zinc-200 pb-1.5">
                <h2 className="text-base sm:text-lg font-bold text-zinc-900">
                  {section.title}
                </h2>
                {section.subtitle && (
                  <p className="mt-1 text-xs italic leading-relaxed text-zinc-500">
                    {section.subtitle}
                  </p>
                )}
              </div>

              {/* If this is Section A (General Information & Lifecycle Summary), format as 2-column key-value */}
              {section.title.includes("General information") || section.title.includes("lifecycle summary") ? (
                <div className="space-y-5 text-sm my-5">
                  {section.rows.map(([label, val], rIdx) => {
                    const labelText = String(label).endsWith(":") ? String(label) : `${String(label)}:`;
                    return (
                      <div key={rIdx} className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                        <span className="w-56 sm:w-60 shrink-0 font-bold text-zinc-900">{labelText}</span>
                        <span className="text-zinc-800">{String(val)}</span>
                      </div>
                    );
                  })}
                  <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-6">
                    <span className="w-56 sm:w-60 shrink-0 font-bold text-zinc-900">Project lifecycle summary:</span>
                    <div className="flex-1 whitespace-pre-wrap leading-relaxed text-zinc-800">
                      {section.paragraphs.length > 0 && section.paragraphs[0] ? section.paragraphs.join("\n\n") : "Not recorded"}
                    </div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Narrative Paragraphs */}
                  {section.paragraphs.length > 0 && (
                    <div className="space-y-2 text-sm leading-relaxed text-zinc-700 whitespace-pre-wrap">
                      {section.paragraphs.map((p, pIdx) => {
                        const evidenceUrl = p.startsWith("Photo evidence: http")
                          ? p.slice("Photo evidence: ".length)
                          : null;
                        return evidenceUrl ? (
                          <div key={pIdx} className="flex items-start gap-3 my-2">
                            <span className="font-medium text-xs text-zinc-600">Photo evidence:</span>
                            <a href={evidenceUrl} target="_blank" rel="noreferrer" className="block">
                              <img src={evidenceUrl} alt="Evidence" className="h-20 w-24 rounded border border-zinc-200 object-cover shadow-sm" />
                            </a>
                          </div>
                        ) : (
                          <p key={pIdx}>{p}</p>
                        );
                      })}
                    </div>
                  )}

                  {/* Multi-Column Table */}
                  {hasTable && (
                    <div className="overflow-x-auto rounded border border-zinc-200 my-2">
                      <table className="w-full border-collapse text-left text-xs sm:text-sm">
                        <thead>
                          <tr className="border-b border-zinc-200 bg-zinc-50/80">
                            {section.headers.map((h, hIdx) => (
                              <th key={hIdx} className="border-r last:border-r-0 border-zinc-200 px-3 py-2 font-semibold text-zinc-900 whitespace-nowrap">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {section.rows.length === 0 ? (
                            <tr>
                              <td colSpan={section.headers.length} className="px-3 py-4 text-center italic text-zinc-400">
                                No records match this selection.
                              </td>
                            </tr>
                          ) : (
                            section.rows.map((row, rIdx) => {
                              const isTotal = String(row[0] ?? "").toLowerCase().startsWith("total ");
                              return (
                                <tr
                                  key={rIdx}
                                  className={`border-b border-zinc-100 last:border-b-0 ${
                                    isTotal ? "bg-zinc-100/70 font-semibold text-zinc-900" : "hover:bg-zinc-50/50 text-zinc-700"
                                  }`}
                                >
                                  {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="border-r last:border-r-0 border-zinc-100 px-3 py-2 whitespace-pre-wrap">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}
            </section>
          );
        })}
      </div>

      {/* Footer Line */}
      <div className="mt-14 mb-3 h-[2px] w-full bg-zinc-900" />

      {/* Footer Details */}
      <div className="grid grid-cols-3 gap-4 text-xs leading-snug text-zinc-500">
        <div><span className="font-bold text-zinc-900">Prepared By:</span>{" "}{meta?.preparedBy || "Authorized user"}</div>
        <div className="text-center"><span className="font-bold text-zinc-900">Project:</span>{" "}{report.project}</div>
        <div className="text-right"><span className="font-bold text-zinc-900">Form created:</span><br />{formCreatedTimestamp}</div>
      </div>
      <p className="mt-6 text-center text-[10px] text-zinc-500">Page 1 of 1</p>
    </div>
  );
}

export function CloseoutEditor({ data, onClose }: { data: CloseoutReportData; onClose: () => void }) {
  const canEdit = useProjectCanEdit();
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
    <fieldset disabled={pending || !canEdit} className="space-y-7 disabled:opacity-70">
      <p className="text-xs leading-relaxed text-zinc-500">Document the project lifecycle, deliverables, cost variances, scope adjustments, lessons learned, and formal approvals.</p>
      {sections.map((section) => <div key={section}>
        <h4 className="mb-4 border-b border-zinc-200 pb-2 text-sm font-medium">{section}</h4>
        <div className="grid gap-4">{CLOSEOUT_FIELDS.filter((field) => field.section === section).map((field) => (
          <label key={field.key} className="space-y-1.5 text-xs text-zinc-600">
            <span>{field.label}</span>
            {field.key.startsWith("approver_") ? (
              <input
                type="text"
                name={field.key}
                defaultValue={data.record?.notes[field.key] ?? ""}
                maxLength={200}
                placeholder="Enter full name and title / role"
                className={inputClass}
              />
            ) : (
              <textarea
                name={field.key}
                defaultValue={data.record?.notes[field.key] ?? ""}
                maxLength={10000}
                rows={field.key === "summary" || field.key === "lessons" ? 4 : 3}
                className={inputClass}
              />
            )}
          </label>
        ))}</div>
      </div>)}
      {data.work.some((item) => item.milestone) && <div>
        <h4 className="mb-4 border-b border-zinc-200 pb-2 text-sm font-medium">Recorded milestone achievement dates</h4>
        <p className="mb-3 text-xs text-zinc-500">Enter the confirmed date each milestone was achieved. Leave blank when unconfirmed.</p>
        <div className="grid gap-4 md:grid-cols-2">{data.work.filter((item) => item.milestone).map((item) => <label key={item.key} className="space-y-1.5 text-xs text-zinc-600">
          <span>{item.name}</span><DatePicker name={`milestone:${item.key}`} ariaLabel={`${item.name} achievement date`} max={data.asOf} defaultValue={data.record?.milestone_dates[item.key] ?? ""} className={inputClass} />
        </label>)}</div>
      </div>}
    </fieldset>
    <ModalFooter><div className="flex w-full flex-wrap items-center justify-end gap-3">
      {error && <p role="alert" className="mr-auto max-w-lg text-sm text-red-600">{error}</p>}
      <button type="button" disabled={pending} onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm disabled:opacity-50">Cancel</button>
      <ProjectWriteButton type="submit" form="closeout-details" disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{pending ? "Saving…" : "Save report details"}</ProjectWriteButton>
    </div></ModalFooter>
  </form>;
}

export function CloseoutReport({ data }: { data: CloseoutReportData }) {
  const [editing, setEditing] = useState(false);
  const report = generateReport(data, {
    title: "Project Closeout Report",
    sections: REPORT_SECTIONS.map((s) => s.id),
    columns: [...MILESTONE_COLUMNS],
    from: "",
    to: "",
  });

  return (
    <div className="flex flex-col gap-6 px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-900">Project closeout report</h2>
          <p className="mt-1 text-xs text-zinc-500">Master engineering closeout summary · As of {date(data.asOf)}</p>
          <p className="mt-1 text-xs text-zinc-400">{data.record ? `Review last saved ${date(data.record.updated_at)}${data.savedBy ? ` by ${data.savedBy}` : ""}` : "Closeout review has not been saved yet."}</p>
        </div>
        <button disabled={!data.storageAvailable} onClick={() => setEditing(true)} className="flex items-center gap-2 rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          <Pencil className="size-3.5" />Edit closeout details
        </button>
      </div>

      {!data.storageAvailable && (
        <p role="status" className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Closeout detail saving is not available yet. Contact your administrator to enable it. Project figures remain available below.
        </p>
      )}

      {/* Render Document Sheet directly on the page */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-100/60 p-3 sm:p-6">
        <ReportDocumentSheet report={report} />
      </div>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit project closeout details" size="wide">
        <CloseoutEditor data={data} onClose={() => setEditing(false)} />
      </Modal>
    </div>
  );
}
