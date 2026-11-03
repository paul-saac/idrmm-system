"use client";

import { useRef, useState } from "react";
import { ProjectWriteButton } from "./project-access-context";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { cancelMaterialRequest } from "@/lib/material-requests/actions";
import { cancelEquipmentRequest } from "@/lib/equipment-requests/actions";
import { useRequestSync } from "./request-sync-context";

export function CancelRequestButton({ kind, requestId, projectId }: { kind: "material" | "equipment"; requestId: number; projectId: number }) {
  const sync = useRequestSync();
  const [open, setOpen] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function cancel() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(null); setOpen(false);
    sync?.setError(null); sync?.setCanceled(kind, requestId, true);
    try {
      const action = kind === "material" ? cancelMaterialRequest : cancelEquipmentRequest;
      const result = await action(requestId, projectId, {}, new FormData());
      if (result.error) throw new Error(result.error);
    } catch (cause) {
      sync?.setCanceled(kind, requestId, false);
      const message = cause instanceof Error ? cause.message : "Could not cancel the request. Please try again.";
      if (sync) sync.setError(message); else { setError(message); setOpen(true); }
    } finally { lock.current = false; setPending(false); }
  }
  return <>
    <ProjectWriteButton type="button" disabled={pending} onClick={() => { setError(null); setOpen(true); }}
      className="cursor-pointer rounded border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-60">
      Cancel request
    </ProjectWriteButton>
    <ConfirmDialog open={open} title={`Cancel ${kind} request`} message={`Cancel this ${kind} request? Its record will be retained with a Canceled status.`}
      confirmLabel="Cancel request" pendingLabel="Canceling..." pending={pending} error={error} onConfirm={cancel} onCancel={() => setOpen(false)} />
  </>;
}
