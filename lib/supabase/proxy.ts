import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PROTECTED_ROUTES, ROLE_HOME, type UserRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/types";
import { readSessionState } from "@/lib/auth/session-state";
import { sessionLoginError } from "@/lib/auth/session-policy";

/**
 * Refreshes the Supabase auth session on every request and enforces
 * route access:
 *  - Unauthenticated users are bounced to "/" from any protected route.
 *  - Authenticated users are bounced away from "/" (and other role's
 *    sections) to their own role's landing page.
 *
 * Runs from the root proxy.ts (Next.js 16 renamed middleware.ts -> proxy.ts).
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const { pathname } = request.nextUrl;
  // These handlers establish/inspect sessions themselves. An expired cookie
  // must not prevent a fresh password login or invitation/reset exchange.
  if (pathname === "/api/auth/session" || pathname.startsWith("/auth/") ||
    (request.headers.has("next-action") && ["/", "/forgot-password"].includes(pathname))) return response;

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // IMPORTANT: do not run any logic between createServerClient and this
  // call — getUser() is what actually revalidates/refreshes the session.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    const session = await readSessionState(supabase);
    if (!session) {
      return NextResponse.json({ error: "Session verification is temporarily unavailable. Please try again." },
        { status: 503, headers: { "Cache-Control": "private, no-store" } });
    }
    if (!session.active) {
      // Only this login is ended, not the user's other devices. setAll also
      // removes the incoming cookies so a Server Action cannot reuse them.
      await supabase.auth.signOut({ scope: "local" });
      if (request.headers.has("next-action")) return response;
      const target = request.nextUrl.clone();
      target.pathname = "/";
      target.search = "";
      target.searchParams.set("error", sessionLoginError(session.reason));
      const expired = pathname.startsWith("/api/")
        ? NextResponse.json({ error: "Your session has expired. Please sign in again." }, { status: 401 })
        : NextResponse.redirect(target);
      response.cookies.getAll().forEach(cookie => expired.cookies.set(cookie));
      expired.headers.set("Cache-Control", "private, no-store");
      return expired;
    }
  }

  // A Server Action call (a POST to the page it's used on, marked by
  // this header) is never redirected — the browser can't use an HTML
  // page as an action's reply, and throws "An unexpected response was
  // received from the server." That happened to a foreman tab left open
  // while the same browser signed in as admin in another tab: the shared
  // session cookie made its next action an admin request to /foreman/...,
  // which the section check below redirected. Every action checks its
  // own access instead (lib/auth/project-access.ts, getSessionProfile),
  // as Next.js's own proxy docs ask for anyway. The session above is
  // still refreshed.
  if (request.headers.has("next-action")) {
    return response;
  }

  const isAuthRoute =
    pathname === "/" ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
    pathname.startsWith("/accept-invite") ||
    pathname.startsWith("/auth");

  if (!user) {
    if (!isAuthRoute) {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // User is authenticated - look up their role/status once per request.
  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, invitation_pending")
    .eq("id", user.id)
    .single();

  const role = profile?.role as UserRole | undefined;
  const isActive = profile?.status !== "inactive";

  if (!profile || !role || !isActive) {
    // No profile row, unrecognized role, or deactivated account: sign out
    // and send back to login so the user isn't stuck in a broken state.
    await supabase.auth.signOut();
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set(
      "error",
      !isActive ? "account_disabled" : "no_profile"
    );
    return NextResponse.redirect(url);
  }

  if (profile.invitation_pending && !["/accept-invite", "/reset-password", "/forgot-password"].includes(pathname) && !pathname.startsWith("/auth/")) {
    const url = new URL("/accept-invite", request.url);
    const redirect = NextResponse.redirect(url);
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie));
    return redirect;
  }

  const home = ROLE_HOME[role];

  if (pathname === "/") {
    const url = request.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  const matchedSection = PROTECTED_ROUTES.find((section) =>
    pathname.startsWith(section.prefix)
  );

  if (matchedSection && !matchedSection.roles.includes(role)) {
    const url = request.nextUrl.clone();
    url.pathname = home;
    return NextResponse.redirect(url);
  }

  return response;
}
