import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  return <main className="flex-1 bg-zinc-50 px-5 py-10 text-sm leading-relaxed text-zinc-700">
    <article className="mx-auto max-w-3xl rounded border border-zinc-200 bg-white p-6 sm:p-9">
      <p className="font-serif text-2xl text-zinc-900">IDR M&amp;M</p>
      <h1 className="mt-5 text-2xl font-semibold text-zinc-900">Terms and Conditions</h1>
      <p className="mt-1 text-xs text-zinc-500">Effective November 3, 2026 · Authorized system and AI use</p>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Authorized use</h2><p>Use your assigned account only for authorized construction project work and within your role and project permissions. Protect your credentials, respect confidential records, and report suspected unauthorized access to your IDR M&amp;M administrator.</p></section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Limited AI purposes</h2><p>Import with AI extracts supported tasks and planned resource costs from construction documents into an editable draft. AI Project Insights summarizes selected saved project information and provides recommendations for review. These features are not unrestricted chat services and do not authorize unrelated processing of personal information.</p></section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Review before relying on outputs</h2><p>AI can misread documents, omit information, or suggest unsuitable actions. Check descriptions, quantities, units, amounts, and recommendations against the source and verified site records. Importing requires your confirmation before project records are created. AI does not approve documents, certify compliance, or make project decisions for you.</p><p>Delay-risk ratings and completion forecasts are calculated by the system&apos;s defined rules. AI may explain those results; it does not replace the calculation or change planned dates. Forecasts are estimates, not completion guarantees.</p></section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Documents and personal information</h2><p>Read the Privacy Notice before using AI. Use an authorized, redacted copy and remove information unnecessary for extraction. IDRMM does not automatically remove signatures or identify every personal detail. Do not upload information you are not authorized to share with the configured external AI service. You can cancel AI import and use manual task and cost entry.</p></section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Availability and reporting concerns</h2><p>AI processing depends on an external service and may be unavailable or limited. Review saved records before retrying an operation and report incorrect results, access concerns, or suspected disclosures to your administrator. These terms do not remove applicable privacy rights or the company&apos;s data-protection responsibilities.</p></section>
      <nav className="mt-8 flex gap-5 border-t border-zinc-200 pt-4 text-xs"><Link className="underline" href="/privacy">Privacy notice</Link><Link className="underline" href="/">Return to IDRMM</Link></nav>
    </article>
  </main>;
}
