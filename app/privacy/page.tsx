import type { Metadata } from "next";
import Link from "next/link";
import { getAIProvider } from "@/lib/ai/provider";

export const metadata: Metadata = { title: "Privacy notice" };
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  let provider = "Not currently configured";
  let azure = false;
  try { const config = getAIProvider(); provider = config.name; azure = config.id === "azure-foundry"; } catch { /* Processing also refuses an incomplete configuration. */ }
  return <main className="flex-1 bg-zinc-50 px-5 py-10 text-sm leading-relaxed text-zinc-700">
    <article className="mx-auto max-w-3xl rounded border border-zinc-200 bg-white p-6 sm:p-9">
      <p className="font-serif text-2xl text-zinc-900">IDR M&amp;M</p>
      <h1 className="mt-5 text-2xl font-semibold text-zinc-900">Privacy notice</h1>
      <p className="mt-1 text-xs text-zinc-500">Effective November 3, 2026 · System records and AI processing</p>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Information and purpose</h2>
        <p>IDRMM handles account information and construction project records to manage authorized access, schedules, accomplishments, resources, costs, and reports. Documents and project records may contain personal or confidential information. Access to the system does not by itself authorize sharing every person&apos;s information with an external AI service.</p>
      </section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">What is sent to AI</h2>
        <p>Import with AI sends extracted document text and, where needed, images of uploaded pages or photos to the configured AI provider after you select Process with AI and acknowledge the upload notice. Selecting a file alone does not send it to AI. There is no automatic redaction: use a separate copy with unnecessary names, signatures, IDs, contact details, and unrelated confidential content removed.</p>
        <p>AI Project Insights sends selected project context, including task descriptions, planned dates, saved progress summaries, cost totals, resource-conflict evidence, document-review status, and calculated schedule assessments. This feature does not send document attachments, account passwords, or worker contact details. Task descriptions and project names can still contain personal information, so avoid unnecessary personal details in them.</p>
        <p>The first project review is generated on opening Insights when no saved review exists. Later reviews require Refresh insights. AI outputs are advisory; imported drafts require confirmation before project records are created.</p>
      </section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">External processing</h2>
        <p>Currently configured provider: <strong>{provider}</strong>. AI processing uses an external service, even though IDRMM is an internal company system. Provider data handling and processing locations depend on the deployed service and configuration.</p>
        {azure ? <p>Microsoft documents that inputs and outputs for models sold by Azure are not used to train foundation models without permission or instruction. This is not a promise of zero retention: abuse monitoring and applicable service storage rules still apply. Global deployments may process data across supported geographies. <a className="underline" href="https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/openai/data-privacy" target="_blank" rel="noopener noreferrer">Read Microsoft&apos;s data-handling documentation</a>.</p>
          : <p>Ask your administrator to confirm the active provider&apos;s data handling before submitting confidential information. <a className="underline" href="https://groq.com/privacy-policy/" target="_blank" rel="noopener noreferrer">Groq privacy information</a>.</p>}
      </section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Drafts, storage, and retention</h2>
        <p>The AI import action processes the selected source copy without adding it to permanent project document storage. Extracted drafts, their source filenames, and your draft edits are saved in this browser&apos;s local storage under Recently imported. Delete drafts there when no longer needed; avoid shared devices. Closing the modal or signing out does not itself delete those drafts.</p>
        <p>Confirmed imports become project records in the system database. The latest successful insights are also saved there until replaced by a successful refresh or removed with the project. System backups can contain saved records. Removing a browser draft does not delete confirmed project records, backups, or provider-side records. No fixed automatic deletion period is promised by this notice.</p>
      </section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Your choices and responsibilities</h2>
        <p>Only submit information the company authorizes for the stated purpose and applicable lawful basis. An uploader&apos;s acknowledgment does not replace authorization or any required information to the people identified in a document. If you cannot provide an appropriate copy, cancel AI import and enter tasks and costs manually. Automatic masking and signature detection are not provided.</p>
      </section>
      <section className="mt-6 space-y-2"><h2 className="font-semibold text-zinc-900">Access and privacy requests</h2>
        <p>System access is controlled through authentication, account roles, and project permissions. Contact your IDR M&amp;M administrator about access, correction, deletion, objections to processing, or a suspected disclosure. Requests must be considered against applicable record-retention requirements and the rights of others. Privacy concerns may also be raised with the <a className="underline" href="https://privacy.gov.ph/" target="_blank" rel="noopener noreferrer">National Privacy Commission</a>.</p>
      </section>
      <nav className="mt-8 flex gap-5 border-t border-zinc-200 pt-4 text-xs"><Link className="underline" href="/terms">Terms and AI use</Link><Link className="underline" href="/">Return to IDRMM</Link></nav>
    </article>
  </main>;
}
