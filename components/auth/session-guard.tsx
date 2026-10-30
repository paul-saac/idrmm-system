"use client";

import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import { createSessionMonitor, type SessionView } from "@/lib/auth/session-monitor";
import { sessionLoginError, SESSION_WARNING_MS } from "@/lib/auth/session-policy";

export function SessionGuard() {
  const [view, setView] = useState<SessionView>({ state: null, remaining: Infinity, pending: false, error: null });
  const [acknowledgedMaximum, setAcknowledgedMaximum] = useState<string | null>(null);
  const monitorRef = useRef<ReturnType<typeof createSessionMonitor> | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("idrmm-session") : null;
    const monitor = createSessionMonitor({
      now: () => performance.now(),
      visible: () => document.visibilityState === "visible",
      onChange: setView,
      onActivitySaved: () => channel?.postMessage("changed"),
      onExpired: reason => {
        channel?.postMessage("changed");
        window.location.replace(`/?error=${sessionLoginError(reason)}`);
      },
      request: async action => {
        const response = await fetch("/api/auth/session", {
          method: action ? "POST" : "GET", cache: "no-store", signal: abort.signal,
          credentials: "same-origin",
          ...(action ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) } : {}),
        });
        if (!response.ok && response.status !== 401) throw new Error("Session check failed");
        return response.json();
      },
    });
    monitorRef.current = monitor;
    const activity = (event: Event) => {
      if (event.isTrusted && document.visibilityState === "visible") monitor.activity();
    };
    // Focus/visibility only read state; they do not prove user activity.
    const check = () => { if (document.visibilityState === "visible") void monitor.check(); };
    const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "touchmove"];
    events.forEach(name => window.addEventListener(name, activity, { passive: true, capture: true }));
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", check);
    window.addEventListener("online", check);
    document.addEventListener("visibilitychange", check);
    if (channel) channel.onmessage = check;
    const { data: { subscription } } = createClient().auth.onAuthStateChange(event => {
      // Do not call another Auth method synchronously within its callback.
      if (["SIGNED_OUT", "SIGNED_IN", "USER_UPDATED"].includes(event)) queueMicrotask(check);
      // TOKEN_REFRESHED intentionally does not extend the inactivity timer.
    });
    void monitor.start();
    const timer = setInterval(() => monitor.tick(), 1000);
    return () => {
      monitor.stop(); abort.abort(); clearInterval(timer); channel?.close(); subscription.unsubscribe();
      events.forEach(name => window.removeEventListener(name, activity, { capture: true }));
      window.removeEventListener("focus", check);
      window.removeEventListener("pageshow", check);
      window.removeEventListener("online", check);
      document.removeEventListener("visibilitychange", check);
      monitorRef.current = null;
    };
  }, []);

  const maximum = !!view.state && Date.parse(view.state.absoluteExpiresAt!) <= Date.parse(view.state.idleExpiresAt!);
  const warning = !!view.state?.active && view.remaining * 1000 <= SESSION_WARNING_MS &&
    (!maximum || acknowledgedMaximum !== view.state.sessionId || view.remaining === 0);
  return (
    <>
      {view.error && !warning && <div role="status" className="fixed inset-x-0 top-0 z-50 border-b border-amber-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-900">{view.error}</div>}
      <Modal open={warning} onClose={() => {}} hideCloseButton title="Your session is ending" icon={<Clock3 className="size-5" />} variant="centered" size="small">
        <div className="space-y-4 text-sm text-zinc-700">
          <p>{maximum ? "Your 12-hour session is ending. Save your work and sign in again to continue." : "You have been inactive for a while. Stay signed in to continue working, or sign out."}</p>
          <p className="text-xs text-zinc-500">{view.remaining > 0 ? `Signing out in ${view.remaining} seconds.` : "Checking whether your session is still active…"}</p>
          {view.error && <p role="alert" className="text-xs text-red-600">{view.error}</p>}
          <div className="flex justify-end gap-2 border-t border-zinc-200 pt-4">
            <button type="button" disabled={view.pending} onClick={() => void monitorRef.current?.signout()} className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50">{maximum ? "Sign in again" : "Sign out"}</button>
            {!maximum && <button type="button" disabled={view.pending} onClick={() => void monitorRef.current?.stay()} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50">{view.pending ? "Checking…" : "Stay signed in"}</button>}
            {maximum && view.remaining > 0 && <button type="button" onClick={() => setAcknowledgedMaximum(view.state?.sessionId ?? null)} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">Continue working</button>}
            {maximum && view.error && <button type="button" disabled={view.pending} onClick={() => void monitorRef.current?.check()} className="cursor-pointer rounded bg-zinc-900 px-4 py-2 text-xs font-semibold text-white disabled:opacity-50">Try again</button>}
          </div>
        </div>
      </Modal>
    </>
  );
}
