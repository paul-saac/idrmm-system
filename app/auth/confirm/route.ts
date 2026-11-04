import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailLinkDestination, isEmailLinkType } from "@/lib/auth/email-link";
import { readSessionState } from "@/lib/auth/session-state";

/**
 * Exchanges a token_hash from the server-side email template, or a PKCE
 * code returned by Supabase's default ConfirmationURL, for a session.
 */
export async function GET(request: NextRequest) {
  let origin = request.nextUrl.origin;
  if (process.env.NODE_ENV === "production") {
    // Azure exposes an internal localhost URL to the handler. Email redirects
    // must use the configured public site, never that URL or proxy headers.
    try {
      const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "");
      if (site.protocol !== "https:") throw new Error("Invalid public site URL");
      origin = site.origin;
    } catch {
      return NextResponse.json({ error: "Account setup is temporarily unavailable. Please try again later." }, { status: 503 });
    }
  }
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = emailLinkDestination(type, searchParams.get("next"));
  const code = searchParams.get("code");
  const failurePath = type === "invite" || next === "/accept-invite"
    ? "/accept-invite"
    : type === "recovery" || next === "/reset-password" ? "/reset-password" : "/";

  // Supabase may return an error instead of credentials for a used/expired
  // email link. Never treat the browser's existing session as verification.
  if (!searchParams.has("error") && !searchParams.has("error_code") &&
    ((token_hash && isEmailLinkType(type)) || (!token_hash && code && (!type || isEmailLinkType(type))))) {
    const supabase = await createClient();

    const { error } = token_hash && isEmailLinkType(type)
      ? await supabase.auth.verifyOtp({ type, token_hash })
      : await supabase.auth.exchangeCodeForSession(code!);

    if (!error && (await readSessionState(supabase))?.active) {
      return NextResponse.redirect(new URL(next, origin));
    }
    if (!error) await supabase.auth.signOut({ scope: "local" });
  }

  const url = new URL(failurePath, origin);
  url.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(url);
}
