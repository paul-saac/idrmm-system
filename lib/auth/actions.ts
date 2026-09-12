"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleHome, type UserRole } from "@/lib/auth/roles";

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

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status")
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

  redirect(roleHome(profile.role as UserRole));
}

export async function logout() {
  const supabase = await createClient();
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

  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Could not update password. Please try again." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  redirect(roleHome(profile?.role as UserRole | undefined));
}
