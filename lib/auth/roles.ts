export type UserRole = "super_admin" | "admin" | "project_manager" | "foreman";

export const USER_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "project_manager",
  "foreman",
];

/** Landing route each role is sent to after login. A super admin's end
 * is the admin's own (everything in it, plus Administrator accounts). */
export const ROLE_HOME: Record<UserRole, string> = {
  super_admin: "/admin",
  admin: "/admin",
  project_manager: "/project-manager",
  foreman: "/foreman",
};

/** Route prefix -> roles allowed to access it. Checked by proxy.ts. */
export const PROTECTED_ROUTES: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/super-admin", roles: ["super_admin"] },
  { prefix: "/admin", roles: ["admin", "super_admin"] },
  { prefix: "/project-manager", roles: ["project_manager"] },
  { prefix: "/foreman", roles: ["foreman"] },
];

/** An admin, or a super admin — who can do everything an admin can (the
 * database agrees: see 0065_super_admin_access.sql). */
export function isAdminRole(role: UserRole | null | undefined): boolean {
  return role === "admin" || role === "super_admin";
}

/** Which roles each role may create and manage accounts for — a super
 * admin, every one an admin can plus Administrators. The Accounts page
 * lists exactly these; lib/accounts/actions.ts enforces them. */
export const MANAGED_ROLES: Record<UserRole, UserRole[]> = {
  super_admin: ["admin", "project_manager", "foreman"],
  admin: ["project_manager", "foreman"],
  project_manager: [],
  foreman: [],
};

export function roleHome(role: UserRole | null | undefined): string {
  return role ? ROLE_HOME[role] : "/";
}

export function roleLabel(role: UserRole): string {
  switch (role) {
    case "super_admin":
      return "Super Administrator";
    case "admin":
      return "Administrator";
    case "project_manager":
      return "Project Manager";
    case "foreman":
      return "Foreman";
  }
}
