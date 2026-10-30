"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleHome, type UserRole } from "@/lib/auth/roles";
import { saveSetupPassword } from "./save-setup-password";
import { readSessionState } from "./session-state";

export type AuthActionState = {
  error?: string;
  success?: string;
};

function getSiteURL() {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.NEXT_PUBLIC_VERCEL_URL ??
    "http://localhost:3000";
  const withProtocol = raw.startsWith("http") ? raw : `https://${raw}`;
  return withProtocol.replace(/\/$/, "");
}

export async function login(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Please enter your email and password." };
  }

  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });

  if (error || !data.user) {
    return { error: "Invalid email or password." };
  }

  if (!(await readSessionState(supabase))?.active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Could not start a secure session. Contact your administrator to check session configuration." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, invitation_pending")
    .eq("id", data.user.id)
    .single();

  if (!profile || !profile.role) {
    await supabase.auth.signOut();
    return {
      error: "Your account has no assigned role yet. Contact your administrator.",
    };
  }

  if (profile.status === "inactive") {
    await supabase.auth.signOut();
    return { error: "This account has been deactivated. Contact your administrator." };
  }

  if (profile.invitation_pending) redirect("/accept-invite");
  redirect(roleHome(profile.role as UserRole));
}

export async function logout() {
  const supabase = await createClient();
  await readSessionState(supabase, false, true);
  await supabase.auth.signOut();
  redirect("/");
}

export async function requestPasswordReset(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const email = String(formData.get("email") ?? "").trim();

  if (!email) {
    return { error: "Please enter your email address." };
  }

  const supabase = await createClient();

  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${getSiteURL()}/auth/confirm?next=/reset-password`,
  });

  // Always return a generic success message, whether or not the email
  // exists, so the form can't be used to enumerate registered accounts.
  return {
    success:
      "If an account exists for that email, a password reset link has been sent.",
  };
}

export async function updatePassword(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match." };
  }

  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Your reset link has expired. Please request a new one." };
  }

  const result = await saveSetupPassword(password);
  if (result.error) return { error: result.error };
  redirect(roleHome(result.role));
}

/**
 * Settings' Change Password, for whoever's signed in — the current
 * password is checked first (by signing in with it again), so an
 * unattended session can't be used to take the account over.
 */
export async function changePassword(
  _prevState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");

  if (!currentPassword) {
    return { error: "Enter your current password." };
  }
  if (password.length < 8) {
    return { error: "New password must be at least 8 characters." };
  }
  if (password !== confirmPassword) {
    return { error: "New passwords do not match." };
  }
  if (password === currentPassword) {
    return { error: "Choose a password different from your current one." };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return { error: "You've been signed out. Please log in again." };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password: currentPassword,
  });
  if (signInError) {
    return { error: "Your current password is incorrect." };
  }

  if (!(await readSessionState(supabase))?.active) {
    await supabase.auth.signOut({ scope: "local" });
    return { error: "Could not verify your session. Please sign in again." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: "Could not change your password. Please try again." };
  }

  return { success: "Password changed." };
}
