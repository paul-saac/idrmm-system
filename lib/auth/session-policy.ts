export const SESSION_IDLE_MS = 30 * 60 * 1000;
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;
export const SESSION_WARNING_MS = 60 * 1000;
export const SESSION_ACTIVITY_INTERVAL_MS = 15 * 1000;

export type SessionState = {
  active: boolean;
  reason: "idle" | "maximum" | "signed_out" | null;
  serverNow: string;
  sessionId?: string;
  idleExpiresAt?: string;
  absoluteExpiresAt?: string;
  expiresAt?: string;
};

export function parseSessionState(value: unknown): SessionState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const s = value as Record<string, unknown>;
  if (typeof s.active !== "boolean" || typeof s.serverNow !== "string" || !Number.isFinite(Date.parse(s.serverNow))) return null;
  if (s.reason !== null && !["idle", "maximum", "signed_out"].includes(String(s.reason))) return null;
  if (s.active && (![s.expiresAt, s.idleExpiresAt, s.absoluteExpiresAt].every(v => typeof v === "string" && Number.isFinite(Date.parse(v))) || typeof s.sessionId !== "string")) return null;
  return s as SessionState;
}

export function sessionLoginError(reason: SessionState["reason"]) {
  return reason === "maximum" ? "session_maximum" : reason === "idle" ? "session_idle" : "session_expired";
}
