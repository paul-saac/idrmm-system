import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PROTECTED_ROUTES, ROLE_HOME, type UserRole } from "@/lib/auth/roles";
import type { Database } from "@/lib/supabase/types";

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
  if (request.nextUrl.pathname.startsWith("/dev-preview")) {
    return NextResponse.next({ request });
  }

  let response = NextResponse.next({ request });

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

  const { pathname } = request.nextUrl;

  const isAuthRoute =
    pathname === "/" ||
    pathname.startsWith("/forgot-password") ||
    pathname.startsWith("/reset-password") ||
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
    .select("role, status")
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
