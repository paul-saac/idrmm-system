"use client";

import { ProjectWriteButton } from "@/components/projects/project-access-context";
import { EmptyState } from "@/components/ui/empty-state";

import Image from "next/image";
import { FileText } from "lucide-react";
import { useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Modal, ModalFooter, ModalHeaderAddon } from "@/components/ui/modal";
import { deleteIncident, loadIncident } from "@/lib/incidents/actions";
import { INCIDENT_TYPES, INCIDENT_SEVERITIES } from "@/lib/incidents/model";

export type LoadedIncident = Awaited<ReturnType<typeof loadIncident>>;

function formatIncidentDate(value?: string) {
  if (!value) return "Incident report";
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function IncidentDetails({ projectId, id, result, onClose, onDeleted }: {
  projectId: number;
  id: number;
  result: LoadedIncident;
  onClose: () => void;
  onDeleted?: (id: number) => void;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const incident = result.incident;

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const deleted = await deleteIncident(projectId, id);
      if (deleted.error) {
        setDeleteError(deleted.error);
        return;
      }
      setConfirmingDelete(false);
      onDeleted?.(id);
      onClose();
    } catch {
      setDeleteError("Could not delete this incident. Please try again.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {result.error ? (
        <p role="alert" className="text-sm text-red-600">{result.error}</p>
      ) : incident ? (
        <div className="space-y-5">
          <ModalHeaderAddon>
            <span className="text-xs font-medium text-zinc-500">
              {INCIDENT_SEVERITIES[incident.severity]}
            </span>
          </ModalHeaderAddon>

          <div>
            <h3 className="text-lg font-semibold text-zinc-900">{INCIDENT_TYPES[incident.incident_type]}</h3>
            <p className="mt-1 text-xs text-zinc-500">{incident.context_name || "Project incident"}</p>
          </div>

          <dl className="grid grid-cols-2 gap-5 text-sm">
            <div>
              <dt className="text-xs text-zinc-500">Time occurred</dt>
              <dd className="mt-1">{incident.occurred_time.slice(0, 5)}</dd>
            </div>
            <div>
              <dt className="text-xs text-zinc-500">Location</dt>
              <dd className="mt-1 break-words">{incident.location || "Not recorded"}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-xs text-zinc-500">What happened?</dt>
              <dd className="mt-2 whitespace-pre-wrap break-words leading-relaxed">{incident.description}</dd>
            </div>
          </dl>

          <section>
            <h4 className="text-xs font-medium text-zinc-700">Photos or documents</h4>
            {result.evidence?.length ? (
              <div className="mt-2 grid grid-cols-3 gap-2">
                {result.evidence.map((file) => {
                  const preview = file.type.startsWith("image/") && file.url ? (
                    <span className="relative block aspect-[4/3] overflow-hidden bg-zinc-100">
                      <Image src={file.url} alt={file.name} fill unoptimized sizes="160px" className="object-cover" />
                    </span>
                  ) : (
                    <span className="flex aspect-[4/3] flex-col items-center justify-center gap-1 bg-zinc-50 px-2 text-center text-zinc-500">
                      <FileText className="size-5 text-zinc-400" />
                      <span className="max-w-full truncate text-[11px]">{file.name}</span>
                    </span>
                  );
                  return file.url ? (
                    <a key={file.path} href={file.url} target="_blank" rel="noopener noreferrer" title={file.name} className="overflow-hidden rounded border border-zinc-200 hover:border-zinc-400">
                      {preview}
                    </a>
                  ) : (
                    <div key={file.path} title={file.name} className="overflow-hidden rounded border border-zinc-200">{preview}</div>
                  );
                })}
              </div>
            ) : (
              <EmptyState compact className="mt-2 py-3">No attachments.</EmptyState>
            )}
          </section>

          <div className="border-t border-zinc-200 pt-4 text-xs leading-relaxed text-zinc-500">
            Reported by {incident.reporter_name || "Project member"}<br />
            {new Date(incident.created_at).toLocaleString("en-PH")}
          </div>
        </div>
      ) : null}

      <ModalFooter>
        <ProjectWriteButton type="button" onClick={() => setConfirmingDelete(true)} disabled={!incident} className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-red-700 disabled:opacity-40">
          Delete
        </ProjectWriteButton>
        <button type="button" onClick={onClose} className="rounded border border-zinc-200 px-4 py-2 text-sm">Close</button>
      </ModalFooter>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this incident?"
        message="This incident and its attached evidence will be permanently removed."
        pending={deleting}
        error={deleteError}
        onConfirm={handleDelete}
        onCancel={() => {
          if (!deleting) {
            setConfirmingDelete(false);
            setDeleteError("");
          }
        }}
      />
    </>
  );
}

export function IncidentDetailModal({ projectId, id, result, onClose, onDeleted }: {
  projectId: number;
  id: number | null;
  result?: LoadedIncident | null;
  onClose: () => void;
  onDeleted?: (id: number) => void;
}) {
  const targetKey = `${projectId}:${id}`;
  const [fetched, setFetched] = useState<{ key: string; result: LoadedIncident } | null>(null);
  useEffect(() => {
    if (result !== undefined || id === null) return;
    let cancelled = false;
    loadIncident(projectId, id)
      .then((value) => {
        if (!cancelled) setFetched({ key: targetKey, result: value });
      })
      .catch(() => {
        if (!cancelled) setFetched({ key: targetKey, result: { error: "Could not load this incident. Close and try again." } });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, id, result, targetKey]);
  const effectiveResult = result === undefined ? (fetched?.key === targetKey ? fetched.result : null) : result;

  return (
    <Modal open={id !== null} onClose={onClose} title={formatIncidentDate(effectiveResult?.incident?.occurred_on)} variant="centered">
      {id !== null && effectiveResult === null && (
        <div role="status" aria-label="Loading incident report" className="space-y-4">
          <span className="sr-only">Loading incident report</span>
          <div aria-hidden className="h-4 w-1/3 animate-pulse rounded bg-zinc-100" />
          <div aria-hidden className="h-20 animate-pulse rounded bg-zinc-100" />
          <div aria-hidden className="h-28 animate-pulse rounded bg-zinc-100" />
        </div>
      )}
      {id !== null && effectiveResult !== null && (
        <IncidentDetails key={`${projectId}:${id}`} projectId={projectId} id={id} result={effectiveResult} onClose={onClose} onDeleted={onDeleted} />
      )}
    </Modal>
  );
}
