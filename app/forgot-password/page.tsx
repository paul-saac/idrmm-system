import type { Metadata } from "next";
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot Password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 py-12">
      <div className="w-full max-w-sm rounded-lg border border-zinc-200 bg-white p-8 shadow-sm">
        <h1 className="font-serif text-2xl text-zinc-900">IDR M&amp;M</h1>

        <div className="mt-8 mb-6 text-center">
          <h2 className="text-xl font-semibold text-zinc-900">
            Forgot password?
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Enter your email and we&apos;ll send you a reset link
          </p>
        </div>

        <ForgotPasswordForm />
      </div>
    </div>
  );
}
