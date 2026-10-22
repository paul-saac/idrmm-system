// Only local destinations are allowed after exchanging an email token.
export function emailLinkDestination(type: string | null, next: string | null): string {
  if (type === "invite") return "/accept-invite";
  if (!next || !next.startsWith("/") || next.startsWith("//") || /[\\\u0000-\u0020]/.test(next)) return "/";
  return next;
}

export function isEmailLinkType(value: string | null): value is "invite" | "recovery" | "signup" | "email_change" | "email" | "magiclink" {
  return value !== null && ["invite", "recovery", "signup", "email_change", "email", "magiclink"].includes(value);
}
