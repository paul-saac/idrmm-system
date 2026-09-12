"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { UserRole } from "@/lib/auth/roles";

export type AccountActionState = {
  error?: string;
  success?: string;
};

/** Which roles each manager role is allowed to create/edit/delete. */
const MANAGED_ROLES: Record<UserRole, UserRole[]> = {
  super_admin: ["admin"],
  admin: ["project_manager", "foreman"],
  project_manager: [],
  foreman: [],
};

const MANAGER_HOME: Record<UserRole, string> = {
  super_admin: "/super-admin",
  admin: "/admin",
  project_manager: "/project-manager",
  foreman: "/foreman",
};

class AuthorizationError extends Error {}

/**
 * Verifies the caller is signed in and holds a role allowed to manage
 * accounts, and returns which roles they may act on. Every mutation below
 * calls this first — the client-side UI hides irrelevant controls, but the
 * real access boundary is here.
 */
async function requireManager() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new AuthorizationError("Not authenticated.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  const role = profile?.role;

  if (!role || MANAGED_ROLES[role].length === 0) {
    throw new AuthorizationError("You are not authorized to manage accounts.");
  }

  return { userId: user.id, role, managedRoles: MANAGED_ROLES[role] };
}

export async function createAccount(
  _prevState: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  let manager;
  try {
    manager = await requireManager();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not authorized." };
  }

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!firstName || !lastName || !email || !password || !role) {
    return { error: "Please fill in all fields." };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (!manager.managedRoles.includes(role)) {
    return { error: "You are not authorized to create that role." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return {
      error:
        e instanceof Error
          ? e.message
          : "Account creation is not configured yet.",
    };
  }

  const { error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { first_name: firstName, last_name: lastName, role },
  });

  if (error) {
    console.error("[createAccount] Supabase Admin API failed:", error);
    return {
      error: error.message.toLowerCase().includes("already")
        ? "An account with that email already exists."
        : "Could not create account. Please try again.",
    };
  }

  revalidatePath(MANAGER_HOME[manager.role]);
  return { success: `Account created for ${email}.` };
}

async function loadManagedTarget(targetId: string, managedRoles: UserRole[]) {
  const supabase = await createClient();
  const { data: target } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", targetId)
    .single();

  if (!target || !managedRoles.includes(target.role)) {
    throw new AuthorizationError("You are not authorized to update that account.");
  }
}

export async function setAccountStatus(
  targetId: string,
  status: "active" | "inactive",
  _prevState: AccountActionState,
  _formData: FormData
): Promise<AccountActionState> {
  let manager;
  try {
    manager = await requireManager();

    if (targetId === manager.userId) {
      throw new AuthorizationError("You cannot change your own account status.");
    }

    await loadManagedTarget(targetId, manager.managedRoles);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Not authorized." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ status })
    .eq("id", targetId);

  if (error) {
    return { error: "Could not update account. Please try again." };
  }

  revalidatePath(MANAGER_HOME[manager.role]);
  return { success: status === "active" ? "Account activated." : "Account deactivated." };
}
