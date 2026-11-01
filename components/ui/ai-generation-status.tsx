"use client";

import { useEffect, useState } from "react";
import styles from "./ai-generation-status.module.css";

/** Elapsed time reflects the pending request, not estimated completion. */
export function AiGenerationStatus({ label }: { label: string }) {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    const started = performance.now();
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((performance.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div role="status" className="inline-flex max-w-full items-center gap-2.5 text-sm">
      <span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-white/20 border-t-zinc-200 motion-safe:animate-spin" />
      <span className={styles.label}>{label}</span>
      <span aria-hidden="true" className="shrink-0 text-xs tabular-nums text-zinc-400">{elapsed}s</span>
    </div>
  );
}
