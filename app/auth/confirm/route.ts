import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { emailLinkDestination, isEmailLinkType } from "@/lib/auth/email-link";
import { readSessionState } from "@/lib/auth/session-state";

/**
 * Exchanges the token_hash from a Supabase auth email link (password
 * recovery, invite, etc.) for a session, then redirects to `next`.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const token_hash = searchParams.get("token_hash");
  const type = searchParams.get("type");
  const next = emailLinkDestination(type, searchParams.get("next"));

  if (token_hash && isEmailLinkType(type)) {
    const supabase = await createClient();

    const { error } = await supabase.auth.verifyOtp({ type, token_hash });

    if (!error && (await readSessionState(supabase))?.active) {
      return NextResponse.redirect(new URL(next, request.url));
    }
    if (!error) await supabase.auth.signOut({ scope: "local" });
  }

  const url = new URL(type === "invite" ? "/accept-invite" : "/", request.url);
  url.searchParams.set("error", "invalid_link");
  return NextResponse.redirect(url);
}
