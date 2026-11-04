import type { Metadata } from "next";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import { SessionGuard } from "@/components/auth/session-guard";

export const metadata: Metadata = {
  title: "Reset Password",
};

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const params = await searchParams;
  const client = !params.error ? await createClient() : null;
  const user = client ? (await client.auth.getUser()).data.user : null;
  const valid = !params.error && Boolean(user?.email_confirmed_at);

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      {valid && <SessionGuard />}
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-2xl text-zinc-900">IDR M&amp;M</h1>

        <div className="mt-8 mb-6 text-center">
          <h2 className="text-xl font-semibold text-zinc-900">
            {valid ? "Set a new password" : "Reset link unavailable"}
          </h2>
          {valid && <p className="mt-1 text-sm text-zinc-500">
            Choose a new password for your account
          </p>}
        </div>

        {valid ? <ResetPasswordForm /> : (
          <div className="flex flex-col gap-5">
            <p role="alert" className="text-sm text-zinc-600">
              This password reset link is invalid, has expired, or has already been used.
              Request a new link and open the newest email.
            </p>
            <Link href="/forgot-password" className="rounded bg-zinc-900 px-4 py-2.5 text-center text-sm font-semibold text-white hover:bg-zinc-800">
              Request a new reset link
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
