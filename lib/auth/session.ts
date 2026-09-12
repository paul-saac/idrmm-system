import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { UserRole } from "@/lib/auth/roles";

export type SessionProfile = {
  id: string;
  email: string | null;
  firstName: string;
  lastName: string;
  role: UserRole;
};

/**
 * Reads the current authenticated user and their profile row. Returns null
 * if there is no session, no profile, or the account is deactivated.
 *
 * proxy.ts already enforces route access — call this in a page/layout for
 * defense-in-depth and to read the user's name/role for display.
 *
 * Wrapped in React's cache() so calling it from both a layout and its child
 * page in the same request reuses one result instead of querying twice.
 */
export const getSessionProfile = cache(async (): Promise<SessionProfile | null> => {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return null;

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, last_name, role, status")
    .eq("id", user.id)
    .single();

  if (!profile || !profile.role || profile.status === "inactive") {
    return null;
  }

  return {
    id: user.id,
    email: user.email ?? null,
    firstName: profile.first_name ?? "",
    lastName: profile.last_name ?? "",
    role: profile.role as UserRole,
  };
});
