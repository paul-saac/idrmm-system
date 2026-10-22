"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleHome } from "./roles";
import type { AuthActionState } from "./actions";
import { saveSetupPassword } from "./save-setup-password";

export async function acceptInvitation(_state: AuthActionState, form: FormData): Promise<AuthActionState> {
  const password = String(form.get("password") ?? "");
  if (password.length < 8) return { error: "Use at least 8 characters for your password." };
  if (password !== form.get("confirmPassword")) return { error: "Passwords do not match." };
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Your invitation session expired. Open your invitation again, or ask your administrator for a password setup link." };
  const { data: profile } = await client.from("profiles").select("role,status,invitation_pending").eq("id", user.id).single();
  if (!profile || profile.status !== "active") return { error: "This account is unavailable. Contact your administrator." };
  if (!profile.invitation_pending) redirect(roleHome(profile.role));
  const result = await saveSetupPassword(password);
  if (result.error) return { error: result.error };
  redirect(roleHome(result.role));
}
