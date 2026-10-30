"use client";

import { useEffect, useState, useTransition } from "react";
import { Archive, ArchiveRestore, Clock3, DatabaseBackup, Download, HardDrive, RefreshCw } from "lucide-react";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { requestBackup, requestRestore } from "@/lib/backups/actions";
import type { BackupSnapshot, BackupStatus } from "@/lib/backups/types";

const button = "inline-flex cursor-pointer items-center justify-center gap-1.5 rounded border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";
const date = (value: string) => new Date(value).toLocaleString("en-PH", { timeZone: "Asia/Manila", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
const size = (bytes: number) => `${(Number(bytes) / 1024 ** 2).toFixed(1)} MB`;

export function BackupRestore({ initial }: { initial: BackupStatus }) {
  const [status, setStatus] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<BackupSnapshot | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [pending, startTransition] = useTransition();
  const active = status.jobs.find(job => ["queued", "running"].includes(job.status));
  const ready = status.workerOnline && !status.configurationError && !status.error;
  const schedule = status.state.schedule_description.match(/^Daily (?:from|at) (\d{2}:\d{2}) (\S+)/);
  const scheduleHour = schedule ? Number(schedule[1].split(":")[0]) : 0;
  const scheduleTime = schedule ? `${scheduleHour % 12 || 12}:${schedule[1].split(":")[1]} ${scheduleHour >= 12 ? "PM" : "AM"}` : "";
  const scheduleTitle = schedule ? `Backup schedule: Daily at ${scheduleTime}` : status.state.schedule_description.includes("disabled") ? "Automatic backups are off" : "Backup schedule unavailable";
  const needsRecovery = status.state.recovery_required && !active;
  const lastFailure = !active && status.jobs[0]?.status === "failed" ? status.jobs[0] : null;
  const paused = status.state.maintenance && !active;
  const interrupted = !!active && !status.workerOnline;
  const statusTitle = active
    ? interrupted ? active.kind === "restore" ? "Restoration paused" : "Backup paused"
      : active.kind === "restore" ? "Restoring your data…" : "Creating your backup…"
    : needsRecovery ? "Recovery required"
    : paused ? "Finishing recovery…"
    : !ready ? "Backups temporarily unavailable"
    : lastFailure ? lastFailure.kind === "restore" ? "Restore wasn't completed" : "Backup wasn't completed"
    : "Ready to back up";
  const statusDescription = active
    ? interrupted ? "Contact your system administrator to continue."
      : active.status === "queued" ? "Your request will start shortly."
      : active.kind === "restore" ? "Saving is temporarily paused and will resume when restoration finishes."
      : status.state.maintenance ? "Saving is temporarily paused until your backup is complete." : "Your backup is being prepared."
    : needsRecovery ? ready
      ? "Restore a saved backup below to finish recovery and resume saving. Choose the safety backup to return to the state before the failed restore."
      : "Saving is paused until recovery is complete. Contact your system administrator to make restoring available."
    : paused ? "Saving will resume when recovery is complete."
    : !ready ? "Contact your system administrator if this continues."
    : lastFailure ? lastFailure.kind === "restore" ? "Choose a saved backup below and try again." : "Select Back up now to try again."
    : null;
  const refresh = async () => {
    const response = await fetch("/api/backups", { cache: "no-store" });
    if (!response.ok) throw new Error("Could not refresh backup status. Please refresh the page and try again.");
    setStatus(await response.json());
  };
  useEffect(() => {
    let disposed = false;
    const controller = new AbortController();
    const timer = setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/backups", { cache: "no-store", signal: controller.signal });
        if (response.ok && !disposed) setStatus(await response.json());
      } catch { /* Retain the last result if a short maintenance request fails. */ }
    }, 5000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, []);

  function createBackup() {
    setError(null);
    startTransition(async () => {
      try { const result = await requestBackup(); if (result.error) setError("Could not start the backup. Refresh the status and try again. Contact your system administrator if this continues."); await refresh(); }
      catch { setError("Could not start the backup. Please try again."); }
    });
  }
  function restore() {
    if (!selected) return;
    setError(null);
    startTransition(async () => {
      try {
        const result = await requestRestore(selected.id, confirmation);
        if (result.error) { setError("Could not start the restore. Refresh the status and try again. Contact your system administrator if this continues."); return; }
        setSelected(null); setConfirmation(""); await refresh();
      } catch { setError("Could not start restoration. Please try again."); }
    });
  }

  return <section className="flex min-w-0 flex-col overflow-hidden rounded border border-zinc-200 bg-white">
    <div className="flex items-start gap-3 px-5 pb-1 pt-5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-700"><DatabaseBackup aria-hidden="true" className="size-4" /></span>
      <div><h2 className="text-sm font-semibold text-zinc-900">Backup &amp; restore</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Save a copy of your records and files, or restore an earlier backup.</p></div>
    </div>
    <div className="space-y-4 px-5 pb-5 pt-5">
      <div role={needsRecovery || lastFailure ? "alert" : "status"} className={`rounded px-3 py-3 ${needsRecovery ? "border border-red-200 bg-red-50" : "bg-zinc-100"}`}>
        <div className={`flex items-center gap-2 text-xs font-medium ${needsRecovery ? "text-red-700" : "text-zinc-700"}`}>
          {active && !interrupted ? <RefreshCw aria-hidden="true" className="size-3 shrink-0 animate-spin" /> : <span className={`size-1.5 shrink-0 rounded-full ${needsRecovery ? "bg-red-500" : ready && !paused && !lastFailure ? "bg-emerald-500" : "bg-zinc-400"}`} />}
          {statusTitle}
          <button type="button" title="Refresh backup status" aria-label="Refresh backup status" onClick={() => { refresh().catch(() => setError("Could not refresh backup status. Please refresh the page and try again.")); }} className="ml-auto cursor-pointer rounded p-1 text-zinc-500 transition-colors hover:bg-zinc-200 hover:text-zinc-800"><RefreshCw aria-hidden="true" className="size-3.5" /></button>
        </div>
        {statusDescription && <p className={`mt-1 text-xs leading-5 ${needsRecovery ? "text-red-700" : "text-zinc-500"}`}>{statusDescription}</p>}
        {active && !interrupted && <div role="progressbar" aria-label={active.kind === "restore" ? "Restoration in progress" : "Backup in progress"} className="mt-3 h-0.5 overflow-hidden bg-zinc-200"><span className="route-progress-indicator block h-full bg-zinc-900" /></div>}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
        <div className="flex min-w-0 items-start gap-2.5"><Clock3 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-zinc-500" /><div><p className="text-xs font-medium text-zinc-800">{scheduleTitle}</p>{schedule && <p className="mt-1 text-xs text-zinc-500">{schedule[2]}</p>}</div></div>
        <button type="button" onClick={createBackup} disabled={pending || !ready || !!active || status.state.maintenance} className="inline-flex cursor-pointer items-center gap-1.5 rounded bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"><HardDrive aria-hidden="true" className="size-3.5" />Back up now</button>
      </div>
      {!selected && error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
    <div className="flex flex-1 flex-col border-t border-zinc-200">
      <div className="flex items-center justify-between gap-3 px-5 py-4"><h3 className="text-xs font-semibold text-zinc-900">Backup history</h3><span className="text-xs text-zinc-500">{status.snapshots.length} {status.snapshots.length === 1 ? "backup" : "backups"}</span></div>
      {status.snapshots.length === 0 ? <div className="flex min-h-40 flex-1 flex-col items-center justify-center px-5 pb-8 pt-2 text-center"><span className="mb-3 flex size-9 items-center justify-center rounded bg-zinc-100 text-zinc-400"><Archive aria-hidden="true" className="size-4" /></span><p className="text-xs font-medium text-zinc-700">No completed backups yet</p><p className="mt-1.5 text-xs text-zinc-500">Your completed backups will appear here.</p></div> : <div className="max-h-96 overflow-y-auto">
        {status.snapshots.map(snapshot => <div key={snapshot.id} className="flex flex-wrap items-center gap-3 border-t border-zinc-200 px-5 py-4">
          <div className="min-w-0 flex-1"><p className="text-sm font-medium text-zinc-900">{date(snapshot.created_at)}</p><p className="mt-1 text-xs leading-5 text-zinc-500">{snapshot.purpose === "safety" ? "Safety backup — created before restoring" : snapshot.purpose === "scheduled" ? "Automatic backup" : "Manual backup"}</p><p className="text-xs leading-5 text-zinc-500">{size(snapshot.size_bytes)} · {snapshot.file_count} {snapshot.file_count === 1 ? "file" : "files"}</p></div>
          <a href={`/api/backups/${snapshot.id}`} className={button} title="Download a secure copy of this backup"><Download aria-hidden className="size-3.5" />Download</a>
          <button type="button" className={button} disabled={pending || !ready || !!active || snapshot.key_id !== status.keyId || !snapshot.recovery_admin_ids.includes(status.actorId)} onClick={() => { setError(null); setConfirmation(""); setSelected(snapshot); }}><ArchiveRestore aria-hidden className="size-3.5" />Restore</button>
        </div>)}
      </div>}
    </div>
    <Modal open={!!selected} onClose={() => { if (!pending) setSelected(null); }} title="Restore a backup">
      {selected && <div className="space-y-5">
        <p className="text-sm text-zinc-600">Restore all system records, accounts, and files to <strong className="text-zinc-900">{date(selected.created_at)}</strong>. Changes made after this backup will be replaced. You may need to sign in again afterward.</p>
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-800">{status.state.recovery_required ? "Saving will stay paused until recovery finishes." : "Saving will pause while your data is restored. A safety backup will be saved first."}</p>
        <label className="flex flex-col gap-2 text-sm text-zinc-700"><span>Type <strong>RESTORE {selected.id.slice(0, 8)}</strong> to confirm</span><input value={confirmation} onChange={event => setConfirmation(event.target.value)} disabled={pending} autoComplete="off" spellCheck={false} className="rounded border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400" /></label>
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <ModalFooter><button type="button" onClick={() => setSelected(null)} disabled={pending} className={button}>Cancel</button><button type="button" onClick={restore} disabled={pending || confirmation !== `RESTORE ${selected.id.slice(0, 8)}`} className="cursor-pointer rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">{pending ? "Starting restore..." : "Restore backup"}</button></ModalFooter>
      </div>}
    </Modal>
  </section>;
}
