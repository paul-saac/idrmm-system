"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MANAGED_ROLES, roleLabel, type UserRole } from "@/lib/auth/roles";
import type { AccountEventAction } from "@/lib/supabase/types";
import type {
  AccountActivity,
  AccountDetail,
  AccountLogEntry,
  AccountProject,
} from "@/lib/accounts/data";

export type AccountActionState = {
  error?: string;
  success?: string;
};

class AuthorizationError extends Error {}

type Supabase = Awaited<ReturnType<typeof createClient>>;

type Manager = {
  userId: string;
  name: string;
  role: UserRole;
  managedRoles: UserRole[];
};

type Target = {
  id: string;
  role: UserRole;
  status: "active" | "inactive";
  invitationPending: boolean;
  firstName: string;
  lastName: string;
  email: string;
  name: string;
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same as lib/auth/actions.ts's own (not importable — a "use server"
// module only exports its actions).
function siteURL() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000";
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

function displayName(firstName: string, lastName: string, email: string) {
  return `${firstName} ${lastName}`.trim() || email;
}

function failure(e: unknown): AccountActionState {
  return { error: e instanceof Error ? e.message : "Not authorized." };
}

/** Everything under /admin — accounts show up on Team, project forms... */
function revalidateAccounts() {
  revalidatePath("/admin", "layout");
}

/**
 * Verifies the caller is signed in and holds a role allowed to manage
 * accounts, and returns which roles they may act on. Every action below
 * calls this first — the client-side UI hides irrelevant controls, but the
 * real access boundary is here.
 */
async function requireManager(): Promise<Manager> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) throw new AuthorizationError("Not authenticated.");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, first_name, last_name, email, status, invitation_pending")
    .eq("id", user.id)
    .single();

  const role = profile?.role;

  if (!profile || !role || profile.status !== "active" || profile.invitation_pending || MANAGED_ROLES[role].length === 0) {
    throw new AuthorizationError("You are not authorized to manage accounts.");
  }

  return {
    userId: user.id,
    name: displayName(profile.first_name, profile.last_name, profile.email),
    role,
    managedRoles: MANAGED_ROLES[role],
  };
}

/** The account, when this manager may manage it (never their own). */
async function loadManagedTarget(targetId: string, manager: Manager): Promise<Target> {
  if (targetId === manager.userId) {
    throw new AuthorizationError("You cannot change your own account here.");
  }
  const supabase = await createClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, role, status, first_name, last_name, email, invitation_pending")
    .eq("id", targetId)
    .single();

  if (!data || !manager.managedRoles.includes(data.role)) {
    throw new AuthorizationError("You are not authorized to update that account.");
  }
  return {
    id: data.id,
    role: data.role,
    status: data.status,
    invitationPending: data.invitation_pending,
    firstName: data.first_name,
    lastName: data.last_name,
    email: data.email,
    name: displayName(data.first_name, data.last_name, data.email),
  };
}

/** Writes one change-log entry (account_events). Never blocks the change
 * itself — e.g. before 0066 has run. */
async function logEvent(
  supabase: Supabase,
  manager: Manager,
  target: { id: string; name: string },
  action: AccountEventAction,
  details?: string
) {
  const { error } = await supabase.from("account_events").insert({
    actor_id: manager.userId,
    actor_name: manager.name,
    target_id: target.id,
    target_name: target.name,
    action,
    details: details ?? null,
  });
  if (error) console.error(`[accounts] Could not log "${action}":`, error.message);
}

type RunningProject = {
  id: number;
  name: string;
  column: "project_manager_id" | "foreman_id";
};

/** The unfinished projects someone runs as PM or foreman. */
async function unfinishedProjects(supabase: Supabase, profileId: string): Promise<RunningProject[]> {
  const { data } = await supabase
    .from("projects")
    .select("id, project_name, project_manager_id, foreman_id")
    .neq("status", "completed")
    .or(`project_manager_id.eq.${profileId},foreman_id.eq.${profileId}`);
  return (data ?? []).map((project) => ({
    id: project.id,
    name: project.project_name,
    column: project.project_manager_id === profileId ? "project_manager_id" : "foreman_id",
  }));
}

export async function createAccount(
  _prevState: AccountActionState,
  formData: FormData
): Promise<AccountActionState> {
  let manager;
  try {
    manager = await requireManager();
  } catch (e) {
    return failure(e);
  }

  const firstName = String(formData.get("firstName") ?? "").trim();
  const lastName = String(formData.get("lastName") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "") as UserRole;

  if (!firstName || !lastName || !email || !role) {
    return { error: "Please fill in all fields." };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
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

  const { data: existing, error: lookupError } = await admin.from("profiles").select("id").ilike("email", email).maybeSingle();
  if (lookupError) return { error: "Could not check this email. Please try again." };
  if (existing) return { error: "An account already uses this email. Open that account to send a password setup/reset link." };
  await admin.from("account_invitations").delete().eq("email", email)
    .lt("created_at", new Date(Date.now() - 60 * 60 * 1000).toISOString());
  const { data: invitation, error: invitationError } = await admin.from("account_invitations").insert({
    email, role, invited_by: manager.userId,
  }).select("id").single();
  if (invitationError || !invitation) {
    return { error: "Could not prepare the invitation. Check migration 0081, or retry after an existing invitation finishes." };
  }
  const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${siteURL()}/accept-invite`,
    data: { first_name: firstName, last_name: lastName, invitation_id: invitation.id },
  });
  // The profile trigger consumes this row on success; remove it on a failed send.
  await admin.from("account_invitations").delete().eq("id", invitation.id);

  if (error) {
    console.error("[createAccount] Supabase Admin API failed:", error);
    return {
      error: error.message.toLowerCase().includes("already")
        ? "An account with that email already exists."
        : "Could not send the invitation. Check the email delivery configuration and try again.",
    };
  }

  if (data.user) {
    await logEvent(
      await createClient(),
      manager,
      { id: data.user.id, name: displayName(firstName, lastName, email) },
      "created",
      `Invitation sent — ${roleLabel(role)}`
    );
  }

  revalidateAccounts();
  return { success: `Invitation sent to ${email}. They will set their own password.` };
}

export async function setAccountStatus(
  targetId: string,
  status: "active" | "inactive",
  _prevState: AccountActionState,
  _formData: FormData
): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  const supabase = await createClient();

  // Deactivating someone still running a project would leave it without
  // its PM or foreman — that's done from their account, handing it over.
  if (status === "inactive") {
    const running = await unfinishedProjects(supabase, target.id);
    if (running.length > 0) {
      return {
        error: `${target.name} is on ${running[0].name} — open their account to hand it over first.`,
      };
    }
  }

  const { error } = await supabase.from("profiles").update({ status }).eq("id", target.id);

  if (error) {
    return { error: "Could not update account. Please try again." };
  }

  await logEvent(supabase, manager, target, status === "active" ? "activated" : "deactivated");
  revalidateAccounts();
  return { success: status === "active" ? "Account activated." : "Account deactivated." };
}

/**
 * setAccountStatus for several accounts at once (the accounts table's
 * checked rows) — every one held to the same checks: a role this
 * manager may manage, never their own, and nobody deactivated while
 * still running a project.
 */
export async function setAccountsStatus(
  targetIds: string[],
  status: "active" | "inactive"
): Promise<AccountActionState> {
  let manager;
  try {
    manager = await requireManager();
  } catch (e) {
    return failure(e);
  }

  if (status !== "active" && status !== "inactive") {
    return { error: "Invalid status." };
  }
  const ids = Array.isArray(targetIds)
    ? Array.from(new Set(targetIds.filter((id) => typeof id === "string" && id !== "")))
    : [];
  if (ids.length === 0) {
    return { error: "Select at least one account." };
  }
  if (ids.includes(manager.userId)) {
    return { error: "You cannot change your own account status." };
  }

  const supabase = await createClient();
  const { data: targets } = await supabase
    .from("profiles")
    .select("id, role, first_name, last_name, email")
    .in("id", ids);
  if (
    !targets ||
    targets.length !== ids.length ||
    targets.some((target) => !manager.managedRoles.includes(target.role))
  ) {
    return { error: "You are not authorized to update one or more of those accounts." };
  }

  if (status === "inactive") {
    for (const target of targets) {
      const running = await unfinishedProjects(supabase, target.id);
      if (running.length > 0) {
        const name = displayName(target.first_name, target.last_name, target.email);
        return {
          error: `${name} is on ${running[0].name} — open their account to hand it over first.`,
        };
      }
    }
  }

  const { error } = await supabase.from("profiles").update({ status }).in("id", ids);
  if (error) {
    return { error: "Could not update the accounts. Please try again." };
  }

  for (const target of targets) {
    await logEvent(
      supabase,
      manager,
      { id: target.id, name: displayName(target.first_name, target.last_name, target.email) },
      status === "active" ? "activated" : "deactivated"
    );
  }

  revalidateAccounts();
  const verb = status === "active" ? "activated" : "deactivated";
  return { success: `${ids.length} account${ids.length === 1 ? "" : "s"} ${verb}.` };
}

/** Fixes someone's name or email. An email change moves their sign-in
 * too (already confirmed — no email round trip). */
export async function updateAccountDetails(
  targetId: string,
  input: { firstName: string; lastName: string; email: string }
): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  const firstName = String(input?.firstName ?? "").trim();
  const lastName = String(input?.lastName ?? "").trim();
  const email = String(input?.email ?? "").trim().toLowerCase();
  if (!firstName || !lastName) {
    return { error: "First and last name are required." };
  }
  if (!EMAIL_PATTERN.test(email)) {
    return { error: "Enter a valid email address." };
  }

  const changes: string[] = [];
  const newName = displayName(firstName, lastName, email);
  if (firstName !== target.firstName || lastName !== target.lastName) {
    changes.push(`Name: ${target.name} → ${newName}`);
  }
  if (email !== target.email.toLowerCase()) {
    changes.push(`Email: ${target.email} → ${email}`);
  }
  if (changes.length === 0) {
    return { success: "Nothing to change." };
  }

  if (email !== target.email.toLowerCase()) {
    let admin;
    try {
      admin = createAdminClient();
    } catch (e) {
      return failure(e);
    }
    const { error } = await admin.auth.admin.updateUserById(target.id, {
      email,
      email_confirm: true,
    });
    if (error) {
      console.error("[updateAccountDetails] Auth email update failed:", error);
      return {
        error: error.message.toLowerCase().includes("already")
          ? "Another account already uses that email."
          : "Could not change the email. Please try again.",
      };
    }
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ first_name: firstName, last_name: lastName, email })
    .eq("id", target.id);
  if (error) {
    console.error("[updateAccountDetails] Profile update failed:", error);
    return { error: "Could not save the changes. Please try again." };
  }

  await logEvent(supabase, manager, { id: target.id, name: newName }, "edited", changes.join("; "));
  revalidateAccounts();
  return { success: "Details saved." };
}

const ROLE_TITLE: Partial<Record<UserRole, string>> = {
  project_manager: "Project Manager",
  foreman: "Foreman",
};

/** Moves someone to another role this manager may give — never while
 * they still run a project in their current one. */
export async function changeAccountRole(
  targetId: string,
  role: UserRole
): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  if (!manager.managedRoles.includes(role)) {
    return { error: "You are not authorized to give that role." };
  }
  if (role === target.role) {
    return { success: "No change." };
  }

  const supabase = await createClient();
  const running = await unfinishedProjects(supabase, target.id);
  if (running.length > 0) {
    return {
      error: `${target.name} is the ${roleLabel(target.role)} of ${running[0].name} — hand it over or finish it before changing their role.`,
    };
  }

  const { error } = await supabase.from("profiles").update({ role }).eq("id", target.id);
  if (error) {
    console.error("[changeAccountRole] Profile update failed:", error);
    return { error: "Could not change the role. Please try again." };
  }

  // Their Team member's title follows a project manager <-> foreman
  // switch (only while it's still the old role's own title).
  const oldTitle = ROLE_TITLE[target.role];
  const newTitle = ROLE_TITLE[role];
  if (oldTitle && newTitle) {
    await supabase
      .from("workers")
      .update({ trade: newTitle })
      .eq("profile_id", target.id)
      .eq("trade", oldTitle);
  }

  await logEvent(
    supabase,
    manager,
    target,
    "role_changed",
    `${roleLabel(target.role)} → ${roleLabel(role)}`
  );
  revalidateAccounts();
  return { success: `Now ${roleLabel(role)}.` };
}

/** Reissues setup access without deleting or recreating the invited account. */
export async function resendInvitation(targetId: string): Promise<AccountActionState> {
  try {
    const manager = await requireManager();
    const target = await loadManagedTarget(targetId, manager);
    if (!target.invitationPending) return { error: "This account has already completed setup. Use Send Reset Email instead." };
    if (target.status !== "active") return { error: "Activate this account before resending its invitation." };

    const admin = createAdminClient();
    const { data, error: lookupError } = await admin.auth.admin.getUserById(target.id);
    if (lookupError || !data.user?.email || data.user.email.toLowerCase() !== target.email.toLowerCase()) {
      return { error: "Could not verify the account email. Refresh and try again." };
    }
    const user = data.user;
    const lastSent = Math.max(
      Date.parse(user.invited_at ?? "") || 0,
      Date.parse(user.recovery_sent_at ?? "") || 0,
    );
    if (Date.now() - lastSent < 60_000) {
      return { error: "Please wait one minute before sending another setup email." };
    }

    // Supabase rejects invitations for confirmed emails. Recovery lets someone
    // who verified their email but abandoned setup finish with their same ID.
    const confirmed = Boolean(user.email_confirmed_at);
    const { error } = confirmed
      ? await admin.auth.resetPasswordForEmail(target.email, {
          redirectTo: `${siteURL()}/accept-invite`,
        })
      : await admin.auth.admin.inviteUserByEmail(target.email, {
          redirectTo: `${siteURL()}/accept-invite`,
        });
    if (error) {
      return { error: error.status === 429
        ? "Email sending is temporarily rate limited. Please wait before retrying."
        : "Could not send the setup email. Check SMTP settings and try again." };
    }
    await logEvent(await createClient(), manager, target, "password_reset_sent",
      confirmed ? "Invitation setup recovery email sent" : "Invitation resent");
    return { success: `Setup email sent to ${target.email}. Ask them to open the newest email.` };
  } catch (e) {
    return failure(e);
  }
}

/** Emails them a link to choose a new password. */
export async function sendPasswordReset(targetId: string): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(target.email, {
    redirectTo: `${siteURL()}/auth/confirm?next=/reset-password`,
  });
  if (error) {
    console.error("[sendPasswordReset] Failed:", error);
    return { error: "Could not send the reset email. Please try again." };
  }

  await logEvent(supabase, manager, target, "password_reset_sent", target.email);
  return { success: `Reset link sent to ${target.email}.` };
}

/** Sets a password for them right away — for someone locked out who
 * can't get to their email. */
export async function setTemporaryPassword(
  targetId: string,
  password: string
): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  if (target.invitationPending) {
    return { error: "Invited users must set their own password. Send a password setup/reset email instead." };
  }

  if (typeof password !== "string" || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return failure(e);
  }
  const { error } = await admin.auth.admin.updateUserById(target.id, { password });
  if (error) {
    console.error("[setTemporaryPassword] Failed:", error);
    return { error: "Could not set the password. Please try again." };
  }

  await logEvent(await createClient(), manager, target, "password_set");
  return { success: "Password set — give it to them to sign in with." };
}

/** Ends every session they have open, on every device. */
export async function signOutEverywhere(targetId: string): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("sign_out_everywhere", { p_user_id: target.id });
  if (error) {
    console.error("[signOutEverywhere] Failed:", error);
    return { error: "Could not sign them out. Please try again." };
  }

  await logEvent(supabase, manager, target, "signed_out");
  return { success: `${target.name} has been signed out everywhere.` };
}

/**
 * Deactivates someone who's still running projects: each one first goes
 * to its replacement — an active, free account of the same role (someone
 * is only ever on one unfinished project at a time).
 */
export async function deactivateWithHandover(
  targetId: string,
  handovers: { projectId: number; replacementId: string }[]
): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }

  const supabase = await createClient();
  const running = await unfinishedProjects(supabase, target.id);
  const picks = Array.isArray(handovers) ? handovers : [];

  const plan: { project: RunningProject; replacementId: string; replacementName: string }[] = [];
  for (const project of running) {
    const pick = picks.find((h) => h.projectId === project.id);
    if (!pick || typeof pick.replacementId !== "string" || !pick.replacementId) {
      return { error: `Pick who takes over ${project.name}.` };
    }
    if (plan.some((p) => p.replacementId === pick.replacementId)) {
      return { error: "Someone can only take over one project." };
    }

    const { data: replacement } = await supabase
      .from("profiles")
      .select("id, role, status, first_name, last_name, email")
      .eq("id", pick.replacementId)
      .single();
    const needed: UserRole = project.column === "project_manager_id" ? "project_manager" : "foreman";
    if (
      !replacement ||
      replacement.id === target.id ||
      replacement.role !== needed ||
      replacement.status !== "active"
    ) {
      return { error: `Pick an active ${roleLabel(needed)} to take over ${project.name}.` };
    }
    const replacementName = displayName(
      replacement.first_name,
      replacement.last_name,
      replacement.email
    );
    const busy = (await unfinishedProjects(supabase, replacement.id)).filter(
      (p) => p.id !== project.id
    );
    if (busy.length > 0) {
      return { error: `${replacementName} is already on ${busy[0].name}.` };
    }
    plan.push({ project, replacementId: replacement.id, replacementName });
  }

  for (const { project, replacementId, replacementName } of plan) {
    const { error } = await supabase
      .from("projects")
      .update(
        project.column === "project_manager_id"
          ? { project_manager_id: replacementId }
          : { foreman_id: replacementId }
      )
      .eq("id", project.id);
    if (error) {
      console.error("[deactivateWithHandover] Project update failed:", error);
      return { error: `Could not hand over ${project.name}. Please try again.` };
    }
    await logEvent(
      supabase,
      manager,
      target,
      "handed_over",
      `${project.name} → ${replacementName}`
    );
  }

  const { error } = await supabase
    .from("profiles")
    .update({ status: "inactive" })
    .eq("id", target.id);
  if (error) {
    return { error: "Projects handed over, but the account couldn't be deactivated. Try again." };
  }

  await logEvent(supabase, manager, target, "deactivated");
  revalidateAccounts();
  return { success: "Account deactivated." };
}

/** Deletes an account for good — a super admin's call, and only for one
 * nothing in the app points at (made by mistake, never used). Anyone else
 * is deactivated instead, so their records stay theirs. */
export async function deleteAccount(targetId: string): Promise<AccountActionState> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }
  if (manager.role !== "super_admin") {
    return { error: "Only a super admin can delete an account." };
  }

  const supabase = await createClient();
  const { data: hasHistory, error: checkError } = await supabase.rpc("account_has_history", {
    p_profile_id: target.id,
  });
  if (checkError) {
    console.error("[deleteAccount] History check failed:", checkError);
    return { error: "Could not check this account's history. Please try again." };
  }
  if (hasHistory) {
    return {
      error: `${target.name} has records in the app — deactivate them instead so those stay theirs.`,
    };
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch (e) {
    return failure(e);
  }
  // The profile row goes with it (profiles.id -> auth.users on delete cascade).
  const { error } = await admin.auth.admin.deleteUser(target.id);
  if (error) {
    console.error("[deleteAccount] Failed:", error);
    return { error: "Could not delete the account. Please try again." };
  }

  await logEvent(supabase, manager, target, "deleted", `${roleLabel(target.role)} · ${target.email}`);
  revalidateAccounts();
  return { success: `${target.name}'s account was deleted.` };
}

/**
 * The detail window's own data: their projects (current and past), what
 * they've recently done in the app, the change log (super admins only)
 * and whether they have any history at all.
 */
export async function getAccountDetail(
  targetId: string
): Promise<{ detail?: AccountDetail; error?: string }> {
  let manager;
  let target;
  try {
    manager = await requireManager();
    target = await loadManagedTarget(targetId, manager);
  } catch (e) {
    return failure(e);
  }
  const supabase = await createClient();
  const id = target.id;

  const [projectRows, taskEntries, categoryEntries, materialRequests] =
    await Promise.all([
      supabase
        .from("projects")
        .select(
          "id, project_name, location, status, start_date, target_end_date, actual_end_date, project_manager_id, foreman_id"
        )
        .or(`project_manager_id.eq.${id},foreman_id.eq.${id}`),
      supabase
        .from("task_progress_entries")
        .select("task_id, entry_date, created_at")
        .eq("recorded_by", id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("category_progress_entries")
        .select("category_id, entry_date, created_at")
        .eq("recorded_by", id)
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("material_requests")
        .select("project_id, mr_no, created_at")
        .eq("requested_by", id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const projects: AccountProject[] = (projectRows.data ?? [])
    .map((project) => ({
      id: project.id,
      name: project.project_name,
      location: project.location,
      status: project.status,
      as: (project.project_manager_id === id ? "Project Manager" : "Foreman") as AccountProject["as"],
      startDate: project.start_date,
      endDate: project.actual_end_date ?? project.target_end_date,
    }))
    // Unfinished first, then the latest.
    .sort(
      (a, b) =>
        Number(a.status === "completed") - Number(b.status === "completed") ||
        (b.startDate ?? "").localeCompare(a.startDate ?? "")
    );

  // Names for the tasks and phases they updated, and every project.
  const taskIds = (taskEntries.data ?? []).map((entry) => entry.task_id);
  const categoryIds = (categoryEntries.data ?? []).map((entry) => entry.category_id);
  const [tasks, categories] = await Promise.all([
    taskIds.length
      ? supabase.from("estimate_tasks").select("id, task_name, project_id").in("id", taskIds)
      : Promise.resolve({ data: [] as { id: number; task_name: string; project_id: number }[] }),
    categoryIds.length
      ? supabase
          .from("estimate_categories")
          .select("id, category_name, project_id")
          .in("id", categoryIds)
      : Promise.resolve({
          data: [] as { id: number; category_name: string; project_id: number }[],
        }),
  ]);
  const taskById = new Map((tasks.data ?? []).map((task) => [task.id, task]));
  const categoryById = new Map((categories.data ?? []).map((category) => [category.id, category]));
  const projectIds = Array.from(
    new Set([
      ...(tasks.data ?? []).map((task) => task.project_id),
      ...(categories.data ?? []).map((category) => category.project_id),
      ...(materialRequests.data ?? []).map((request) => request.project_id),
    ])
  );
  const { data: projectNames } = projectIds.length
    ? await supabase.from("projects").select("id, project_name").in("id", projectIds)
    : { data: [] as { id: number; project_name: string }[] };
  const projectName = new Map((projectNames ?? []).map((project) => [project.id, project.project_name]));

  const activity: AccountActivity[] = [
    ...(taskEntries.data ?? []).map((entry) => {
      const task = taskById.get(entry.task_id);
      return {
        kind: "progress" as const,
        label: `Updated progress on ${task?.task_name ?? "a task"}`,
        projectName: task ? (projectName.get(task.project_id) ?? null) : null,
        at: entry.created_at,
      };
    }),
    ...(categoryEntries.data ?? []).map((entry) => {
      const category = categoryById.get(entry.category_id);
      return {
        kind: "progress" as const,
        label: `Updated progress on ${category?.category_name ?? "a phase"}`,
        projectName: category ? (projectName.get(category.project_id) ?? null) : null,
        at: entry.created_at,
      };
    }),
    ...(materialRequests.data ?? []).map((request) => ({
      kind: "material_request" as const,
      label: `Requested materials (${request.mr_no})`,
      projectName: projectName.get(request.project_id) ?? null,
      at: request.created_at,
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 12);

  let log: AccountLogEntry[] = [];
  let hasHistory = true;
  if (manager.role === "super_admin") {
    const [events, history] = await Promise.all([
      supabase
        .from("account_events")
        .select("id, actor_name, action, details, created_at")
        .eq("target_id", id)
        .order("created_at", { ascending: false })
        .limit(30),
      supabase.rpc("account_has_history", { p_profile_id: id }),
    ]);
    log = (events.data ?? []).map((event) => ({
      id: event.id,
      actorName: event.actor_name,
      action: event.action,
      details: event.details,
      createdAt: event.created_at,
    }));
    // Unknown (e.g. before 0066 has run) counts as having some.
    hasHistory = history.error ? true : Boolean(history.data);
  }

  return { detail: { projects, activity, log, hasHistory } };
}
