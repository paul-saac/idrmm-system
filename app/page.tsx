import type { Metadata } from "next";
import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = {
  title: "Login",
};

const ERROR_MESSAGES: Record<string, string> = {
  account_disabled: "This account has been deactivated. Contact your administrator.",
  no_profile: "Your account has no assigned role yet. Contact your administrator.",
  invalid_link: "That link is invalid or has expired. Please request a new one.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const initialError = error ? ERROR_MESSAGES[error] : undefined;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-2xl text-zinc-900">IDR M&amp;M</h1>

        <div className="mt-8 mb-6 text-center">
          <h2 className="text-xl font-semibold text-zinc-900">Welcome hehe</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Enter your details to login
          </p>
        </div>

        <LoginForm initialError={initialError} />
      </div>
    </div>
  );
}
