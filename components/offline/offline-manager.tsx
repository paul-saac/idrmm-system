"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { WifiOff, RefreshCw } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { registerOfflineWorker, activateOfflineOwner, lockOfflineWorkspace, activeOfflineOwner,
  localAll, subscribeOffline, synchronizeOfflineLogs } from "@/public/offline/storage.js";

export function OfflineManager() {
  const router = useRouter();
  const [offline, setOffline] = useState(false);
  const [count, setCount] = useState(0);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  useEffect(() => {
    let active = true;
    const update = async () => {
      try {
        const owner = await activeOfflineOwner();
        const rows = (await localAll("outbox")).filter(row => row.ownerId === owner?.ownerId && row.status !== "synced");
        if (active) { setCount(rows.length); setNeedsSignIn(rows.some(row => row.status === "auth-required")); }
      } catch { /* Unsupported local storage must not block the online system. */ }
    };
    const verify = async () => {
      try {
        const response = await fetch("/api/offline/session", { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(10000) });
        if (response.ok) { const profile = await response.json(); await activateOfflineOwner(profile.id); }
      } catch { /* Preserve the offline account and pending entries during outages. */ }
      await update(); void synchronizeOfflineLogs();
    };
    const online = () => { setOffline(false); void verify(); };
    const disconnected = () => setOffline(true);
    const synchronized = () => router.refresh();
    queueMicrotask(() => { if (active) setOffline(navigator.onLine === false); });
    void registerOfflineWorker().catch(() => {});
    void verify();
    const unsubscribe = subscribeOffline(() => { void update(); });
    window.addEventListener("online", online); window.addEventListener("offline", disconnected);
    window.addEventListener("focus", verify); window.addEventListener("idrmm-offline-synced", synchronized);
    const interval = setInterval(() => void synchronizeOfflineLogs(), 15000);
    const { data: { subscription } } = createClient().auth.onAuthStateChange(event => {
      if (event === "SIGNED_OUT") queueMicrotask(() => { void lockOfflineWorkspace(); });
      else if (event === "SIGNED_IN") queueMicrotask(() => { void verify(); });
    });
    return () => { active = false; unsubscribe(); clearInterval(interval); subscription.unsubscribe();
      window.removeEventListener("online", online); window.removeEventListener("offline", disconnected);
      window.removeEventListener("focus", verify); window.removeEventListener("idrmm-offline-synced", synchronized); };
  }, [router]);
  if (!offline && !count) return null;
  return <aside role="status" className="fixed right-4 bottom-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-3 rounded border border-zinc-300 bg-white px-4 py-3 text-xs text-zinc-700 shadow-sm">
    {offline ? <WifiOff className="size-4 shrink-0" /> : <RefreshCw className="size-4 shrink-0" />}
    <span>{offline ? "You are offline." : needsSignIn ? "Sign in again to synchronize." : `${count} offline ${count === 1 ? "entry" : "entries"} awaiting sync.`}</span>
    <a href="/offline/index.html" className="shrink-0 font-medium underline underline-offset-2">Open saved workspace</a>
  </aside>;
}
