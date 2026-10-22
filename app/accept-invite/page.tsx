import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { roleHome, roleLabel } from "@/lib/auth/roles";
import { AcceptInviteForm } from "@/components/auth/accept-invite-form";

export const metadata = { title: "Accept invitation" };
export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  const { data: profile } = user ? await client.from("profiles").select("first_name,role,status,invitation_pending").eq("id", user.id).single() : { data: null };
  if (!params.error && profile?.status === "active" && !profile.invitation_pending) redirect(roleHome(profile.role));
  const valid = !params.error && user && profile?.status === "active" && profile.invitation_pending;
  return <main className="flex min-h-screen items-center justify-center bg-zinc-50 px-4 py-12">
    <div className="w-full max-w-md rounded-lg border border-zinc-200 bg-white p-8">
      <h1 className="font-serif text-2xl">IDR M&amp;M</h1>
      <h2 className="mt-8 text-xl font-semibold">{valid ? "Set up your account" : "Invitation unavailable"}</h2>
      {valid ? <><p className="mt-2 mb-6 text-sm text-zinc-500">Welcome, {profile.first_name}. Your administrator assigned you the {roleLabel(profile.role)} role. Set your password to continue.</p><p className="mb-4 break-all text-sm text-zinc-500">{user.email}</p><AcceptInviteForm /></> : <><p role="alert" className="mt-3 text-sm text-zinc-500">Open the link in your invitation email. If it has expired or was already used, ask your administrator for a new setup link.</p><Link href="/" className="mt-6 inline-block text-sm underline">Back to sign in</Link></>}
    </div>
  </main>;
}
