"use client";
import { useEffect, useState } from "react";

export function MaintenanceNotice() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let disposed = false;
    async function refresh() {
      if (document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/backups/maintenance", { cache: "no-store", signal: controller.signal });
        if (response.ok && !disposed) setActive((await response.json()).maintenance === true);
      } catch { /* Retain the last state during a short recovery interruption. */ }
    }
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, []);
  return active ? <div role="status" className="shrink-0 border-b border-amber-200 bg-amber-50 px-8 py-2 text-sm text-amber-800">Saving is temporarily paused for backup or recovery. Contact your administrator if this continues.</div> : null;
}
