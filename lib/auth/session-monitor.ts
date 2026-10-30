import {
  parseSessionState, SESSION_ACTIVITY_INTERVAL_MS, SESSION_WARNING_MS,
  type SessionState,
} from "./session-policy";

export type SessionView = {
  state: SessionState | null;
  remaining: number;
  pending: boolean;
  error: string | null;
};

/** Browser-independent controller so timer/race/sleep behavior can be tested.
 * The server remains authoritative; local clocks never authorize a request. */
export function createSessionMonitor(options: {
  request: (action?: "activity" | "signout") => Promise<unknown>;
  now: () => number;
  visible: () => boolean;
  onChange: (view: SessionView) => void;
  onExpired: (reason: SessionState["reason"]) => void;
  onActivitySaved: () => void;
}) {
  let state: SessionState | null = null;
  let deadline = Infinity;
  let pending = false, stopped = false, activityWaiting = false;
  let lastActivityRequest = -Infinity, lastRead = -Infinity;
  let error: string | null = null;
  const remaining = () => Math.max(0, Math.ceil((deadline - options.now()) / 1000));
  const publish = () => {
    if (!stopped) options.onChange({ state, remaining: remaining(), pending, error });
  };
  async function request(action?: "activity" | "signout") {
    if (pending || stopped) return;
    pending = true;
    lastRead = options.now();
    if (action === "activity") { activityWaiting = false; lastActivityRequest = options.now(); }
    publish();
    const sentAt = options.now();
    try {
      const next = parseSessionState(await options.request(action));
      if (!next) throw new Error("Invalid session state");
      if (stopped) return;
      state = next;
      error = null;
      if (!next.active) {
        stopped = true;
        options.onExpired(next.reason);
        return;
      }
      // Account for the whole round trip conservatively. Reloads and changes
      // to the computer's wall clock cannot manufacture a later deadline.
      deadline = sentAt + Date.parse(next.expiresAt!) - Date.parse(next.serverNow);
      if (action === "activity") options.onActivitySaved();
    } catch {
      if (!stopped) error = "Could not check your session. Check your connection and try again.";
    } finally {
      pending = false;
      publish();
    }
  }
  return {
    start: () => request(),
    check: () => request(),
    activity() {
      // Pointer movement inside the warning must not silently dismiss it.
      if (stopped || (state && remaining() * 1000 <= SESSION_WARNING_MS)) return;
      activityWaiting = true;
      if (!pending && options.now() - lastActivityRequest >= SESSION_ACTIVITY_INTERVAL_MS) void request("activity");
    },
    tick() {
      if (stopped) return;
      publish();
      if (!options.visible() || pending) return;
      if (activityWaiting && remaining() * 1000 > SESSION_WARNING_MS && options.now() - lastActivityRequest >= SESSION_ACTIVITY_INTERVAL_MS) {
        void request("activity");
      } else if ((remaining() === 0 && lastRead <= deadline) || options.now() - lastRead >= SESSION_ACTIVITY_INTERVAL_MS) {
        // Even at zero, check the server first: another tab may have extended
        // this login. An outdated tab must never terminate an active login.
        void request();
      }
    },
    stay: () => request("activity"),
    signout: () => request("signout"),
    stop() { stopped = true; },
  };
}
