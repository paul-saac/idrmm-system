export type UserRole = "super_admin" | "admin" | "project_manager" | "foreman";

export const USER_ROLES: UserRole[] = [
  "super_admin",
  "admin",
  "project_manager",
  "foreman",
];

/** Landing route each role is sent to after login. */
export const ROLE_HOME: Record<UserRole, string> = {
  super_admin: "/super-admin",
  admin: "/admin",
  project_manager: "/project-manager",
  foreman: "/foreman",
};

/** Route prefix -> roles allowed to access it. Checked by proxy.ts. */
export const PROTECTED_ROUTES: { prefix: string; roles: UserRole[] }[] = [
  { prefix: "/super-admin", roles: ["super_admin"] },
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/project-manager", roles: ["project_manager"] },
  { prefix: "/foreman", roles: ["foreman"] },
];

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
