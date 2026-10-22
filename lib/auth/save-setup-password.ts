import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/** Never accept an account ID from the browser: finish only this session's user. */
export async function saveSetupPassword(password: string) {
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user || !user.email_confirmed_at) return { error: "Open a valid invitation or password-reset link first." };
  const { data: profile } = await client.from("profiles")
    .select("role,status,invitation_pending").eq("id", user.id).single();
  if (!profile || profile.status !== "active") return { error: "This account is unavailable. Contact your administrator." };
  // Resolve server configuration before changing the password.
  const admin = profile.invitation_pending ? createAdminClient() : null;
  const { error } = await client.auth.updateUser({ password });
  if (error) return { error: "Could not save your password. Try a different password or request a fresh setup link." };
  if (admin) {
    const { data: completed, error: completionError } = await admin.from("profiles")
      .update({ invitation_pending: false }).eq("id", user.id)
      .eq("status", "active").select("id").single();
    if (completionError || !completed) return { error: "Your password was saved but setup could not finish. Contact your administrator." };
  }
  return { role: profile.role };
}
