import { AdminPageHeader } from "@/components/admin/page-header";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { getSessionProfile } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";
import { getBackupStatus } from "@/lib/backups/actions";
import { BackupRestore } from "@/components/settings/backup-restore";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { initials } from "@/lib/initials";
import { avatarColor } from "@/components/ui/list-table";

/** Settings, the profile menu's own page in both portals — the signed-in
 * user's account (names and accounts themselves are managed by an admin,
 * on Accounts) and changing their own password. */
export async function SettingsView() {
  const profile = await getSessionProfile();
  const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : "";
  const backupStatus = profile?.role === "super_admin" ? await getBackupStatus() : null;

  return (
    <>
      <AdminPageHeader title="Settings" description="Manage your account, keep it secure, and protect your workspace data." />
      <main className="min-h-0 flex-1 overflow-y-auto bg-zinc-50 px-4 py-6 sm:px-8">
        <div className="mx-auto w-full max-w-7xl">
          <section className="overflow-hidden rounded border border-zinc-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-900">Account</h2>
                <p className="mt-1 text-xs text-zinc-500">Your personal details and workspace access.</p>
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs text-zinc-500"><CheckCircle2 aria-hidden="true" className="size-3.5" />Active account</span>
            </div>
            <div className="flex items-start gap-5 px-5 py-5 sm:items-center">
              <span aria-hidden="true" className={`flex size-11 shrink-0 items-center justify-center rounded-full text-base font-medium ${avatarColor(name || profile?.email || "?")}`}>{initials(name || profile?.email)}</span>
              <dl className="grid min-w-0 flex-1 gap-4 text-sm sm:grid-cols-[1fr_1.6fr_1.2fr] sm:gap-6">
                <div className="min-w-0"><dt className="text-xs text-zinc-500">Name</dt><dd className="mt-1.5 break-words text-zinc-900">{name || "—"}</dd></div>
                <div className="min-w-0"><dt className="text-xs text-zinc-500">Email address</dt><dd className="mt-1.5 break-words text-zinc-900">{profile?.email ?? "—"}</dd></div>
                <div className="min-w-0"><dt className="text-xs text-zinc-500">Role</dt><dd className="mt-1.5 text-zinc-900">{profile ? roleLabel(profile.role) : "—"}</dd></div>
              </dl>
            </div>
          </section>
          <div className={`mt-6 grid items-stretch gap-6 ${backupStatus ? "lg:grid-cols-2" : "max-w-2xl"}`}>
            <section className="flex min-w-0 flex-col overflow-hidden rounded border border-zinc-200 bg-white">
              <div className="flex items-start gap-3 px-5 pb-1 pt-5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded bg-zinc-100 text-zinc-700"><LockKeyhole aria-hidden="true" className="size-4" /></span>
                <div><h2 className="text-sm font-semibold text-zinc-900">Change password</h2><p className="mt-1 text-xs leading-5 text-zinc-500">Choose a strong password to keep your account safe.</p></div>
              </div>
              <ChangePasswordForm />
            </section>
            {backupStatus && <BackupRestore initial={backupStatus} />}
          </div>
          <p className="mt-6 text-xs leading-5 text-zinc-500">Your account details and project access are managed by your workspace administrator.</p>
        </div>
      </main>
    </>
  );
}
