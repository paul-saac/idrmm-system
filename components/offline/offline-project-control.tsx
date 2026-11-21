"use client";

import { useEffect, useState } from "react";
import { Download, WifiOff } from "lucide-react";
import { useProjectCanEdit } from "@/components/projects/project-access-context";
import { activeOfflineOwner, localAll, prepareOfflineProject, synchronizeOfflineLogs } from "@/public/offline/storage.js";

export function OfflineProjectControl({ projectId }: { projectId: number }) {
  const canEdit = useProjectCanEdit();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    let active = true;
    void activeOfflineOwner().then(async owner => {
      const projects = await localAll("projects");
      if (active) setReady(!!owner && !owner.locked && projects.some(p => p.ownerId === owner.ownerId && p.projectId === projectId));
    }).catch(() => {});
    return () => { active = false; };
  }, [projectId]);
  if (!canEdit) return null;
  return <div className="flex max-w-sm flex-col items-end gap-1.5">
    <div className="flex flex-wrap items-center justify-end gap-2">
      {ready && <a href={`/offline/index.html?project=${projectId}`} className="flex items-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"><WifiOff className="size-4" />Offline workspace</a>}
      <button type="button" disabled={busy} title="Save task information in this browser on a trusted device for offline daily logging."
        onClick={async () => {
          if (busy) return;
          setBusy(true); setMessage("");
          try {
            await prepareOfflineProject(projectId); setReady(true);
            void synchronizeOfflineLogs(true);
          } catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare offline logging."); }
          finally { setBusy(false); }
        }}
        className="flex items-center gap-1.5 rounded border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60">
        <Download className="size-4" />{busy ? "Preparing offline…" : ready ? "Update offline copy" : "Make available offline"}
      </button>
    </div>
    {message && <p role="status" className="text-right text-xs leading-relaxed text-zinc-300">{message}</p>}
  </div>;
}
