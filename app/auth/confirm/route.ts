import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailLinkDestination, isEmailLinkType } from "@/lib/auth/email-link";
import { readSessionState } from "@/lib/auth/session-state";

/**
 * Exchanges the token_hash from a Supabase auth email link (password
 * recovery, invite, etc.) for a session, then redirects to `next`.
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

  if (token_hash && isEmailLinkType(type)) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error && (await readSessionState(supabase))?.active) {
      return NextResponse.redirect(new URL(next, origin));
    }
    if (!error) await supabase.auth.signOut({ scope: "local" });
  }

  const url = new URL(type === "invite" ? "/accept-invite" : "/", origin);
  url.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(url);
}
