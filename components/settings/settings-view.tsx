import { AdminPageHeader } from "@/components/admin/page-header";
import { ChangePasswordForm } from "@/components/settings/change-password-form";
import { getSessionProfile } from "@/lib/auth/session";
import { roleLabel } from "@/lib/auth/roles";

/** Settings, the profile menu's own page in both portals — the signed-in
 * user's account (names and accounts themselves are managed by an admin,
 * on Accounts) and changing their own password. */
export async function SettingsView() {
  const profile = await getSessionProfile();
  const name = profile ? `${profile.firstName} ${profile.lastName}`.trim() : "";

  return (
    <>
      <AdminPageHeader title="Settings" />
      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="flex max-w-2xl flex-col gap-6">
          <section className="rounded-lg border border-zinc-200 bg-white">
            <h2 className="border-b border-zinc-200 px-5 py-4 text-sm font-semibold text-zinc-900">
              Account
            </h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-10 gap-y-3 px-5 py-4 text-sm">
              <dt className="text-zinc-500">Name</dt>
              <dd className="text-zinc-900">{name || "—"}</dd>
              <dt className="text-zinc-500">Email</dt>
              <dd className="text-zinc-900">{profile?.email ?? "—"}</dd>
              <dt className="text-zinc-500">Role</dt>
              <dd className="text-zinc-900">{profile ? roleLabel(profile.role) : "—"}</dd>
            </dl>
          </section>

          <section className="rounded-lg border border-zinc-200 bg-white">
            <h2 className="border-b border-zinc-200 px-5 py-4 text-sm font-semibold text-zinc-900">
              Change Password
            </h2>
            <div className="px-5 py-4">
              <ChangePasswordForm />
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
