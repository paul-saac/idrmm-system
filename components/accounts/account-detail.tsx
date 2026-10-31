"use client";

import { RequiredMark } from "@/components/ui/required-mark";
import { EmptyState } from "@/components/ui/empty-state";
import { PasswordRequirements } from "@/components/auth/password-requirements";
import { generateTemporaryPassword, getPasswordError, PASSWORD_MIN_LENGTH, PASSWORD_MAX_LENGTH } from "@/lib/auth/password-policy";
import { ProjectAccessEditor, type ProjectAccessChange } from "./project-access-editor";
import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { initials } from "@/lib/initials";
import { avatarColor } from "@/components/ui/list-table";
import {
  Building2,
  ChevronDown,
  Mail,
  RefreshCw,
  TrendingUp,
  PackageSearch,
} from "lucide-react";
import {
  changeAccountRole,
  deactivateWithHandover,
  deleteAccount,
  getAccountDetail,
  resendInvitation,
  sendPasswordReset,
  setAccountsStatus,
  setTemporaryPassword,
  signOutEverywhere,
  updateAccountDetails,
  type AccountActionState,
} from "@/lib/accounts/actions";
import { saveProjectAccess } from "@/lib/accounts/project-access";
import { projectElsewhere } from "@/lib/accounts/availability";
import type { AccountDetail as Detail, AccountRow } from "@/lib/accounts/data";
import { roleLabel, type UserRole } from "@/lib/auth/roles";
import { timeAgo } from "@/lib/time-ago";
import { Modal, ModalFooter } from "@/components/ui/modal";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

const INPUT =
  "w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";
const LABEL = "text-xs font-medium text-zinc-500";
const PRIMARY =
  "cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";
// Compact, tab-like action — for low-emphasis account actions (reset
// email, sign out everywhere) that shouldn't read as full form buttons.
const TAB_BUTTON =
  "inline-flex cursor-pointer items-center gap-1.5 rounded border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50 hover:text-zinc-900 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "cursor-pointer rounded border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER =
  "cursor-pointer rounded border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

const PROJECT_STATUS: Record<"planning" | "ongoing" | "completed", { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-sky-50 text-sky-700" },
  ongoing: { label: "Ongoing", className: "bg-amber-50 text-amber-700" },
  completed: { label: "Completed", className: "bg-zinc-100 text-zinc-500" },
};

const ACTIVITY_ICON = {
  progress: TrendingUp,
  material_request: PackageSearch,
} as const;

function formatDate(iso: string | null, withTime = false) {
  if (!iso) return "—";
  const date = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime && { hour: "numeric", minute: "2-digit" }),
  });
}

type Section = "details" | "role" | "password" | "access";

/**
 * One account's own window (a row on Manage Accounts): edit their name
 * and email, change their role, reset their password or set one, sign
 * them out everywhere, see their projects and recent activity, deactivate
 * them (handing over any project they still run first) — and, for a super
 * admin, deleting it for good when it has no history.
 */
export function AccountDetail({
  account,
  accounts,
  roleOptions,
  isSuperAdmin,
  onClose,
}: {
  account: AccountRow;
  /** Everyone listed — the hand-over picks come from here. */
  accounts: AccountRow[];
  /** Roles this viewer may give. */
  roleOptions: UserRole[];
  isSuperAdmin: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail>(() => ({
    projects: account.detailPreview.projects,
    activity: account.detailPreview.activity,
    log: [],
    hasHistory: true,
  }));
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ section: Section; tone: "ok" | "error"; text: string } | null>(null);

  const [firstName, setFirstName] = useState(account.firstName);
  const [lastName, setLastName] = useState(account.lastName);
  const [email, setEmail] = useState(account.email);
  const [savedDetails, setSavedDetails] = useState({
    firstName: account.firstName,
    lastName: account.lastName,
    email: account.email,
  });
  const [role, setRole] = useState<UserRole>(account.role);
  const [savedRole, setSavedRole] = useState<UserRole>(account.role);
  const [accessChanges, setAccessChanges] = useState<ProjectAccessChange[]>([]);
  const [password, setPassword] = useState("");
  const requirementsId = useId();
  const [handovers, setHandovers] = useState<Record<number, string>>({});
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAccountDetail(account.id).then((result) => {
      if (cancelled) return;
      if (result.detail) {
        setDetail(result.detail);
        setLoadError(null);
      } else {
        setLoadError(result.error ?? "Could not load this account.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [account.id, version]);

  async function run(
    section: Section,
    name: string,
    task: () => Promise<AccountActionState>,
    after?: () => void
  ) {
    setBusy(name);
    setMessage(null);
    const result = await task();
    setBusy(null);
    if (result.error) {
      setMessage({ section, tone: "error", text: result.error });
      return;
    }
    setMessage({ section, tone: "ok", text: result.success ?? "Done." });
    after?.();
    router.refresh();
    setVersion((value) => value + 1);
  }

  function note(section: Section) {
    if (message?.section !== section) return null;
    return (
      <p
        role={message.tone === "error" ? "alert" : "status"}
        className={`text-sm ${message.tone === "error" ? "text-red-600" : "text-emerald-700"}`}
      >
        {message.text}
      </p>
    );
  }

  const name = `${account.firstName} ${account.lastName}`.trim() || account.email;
  const active = account.status === "active";
  // Unfinished projects they still run — each needs a replacement before
  // they're deactivated.
  const running = detail.projects.filter((project) => project.status !== "completed");
  const detailsChanged =
    firstName.trim() !== savedDetails.firstName ||
    lastName.trim() !== savedDetails.lastName ||
    email.trim().toLowerCase() !== savedDetails.email.toLowerCase();
  const roleChanged = roleOptions.length > 1 && role !== savedRole;
  const canManageAccess = role === "project_manager" || role === "foreman";
  const accessChanged = canManageAccess && accessChanges.length > 0;

  async function handleSave() {
    setMessage(null);
    if (!detailsChanged && !roleChanged && !accessChanged) {
      onClose();
      return;
    }
    setBusy("save");
    let didMutate = false;
    try {
      if (detailsChanged) {
        const res = await updateAccountDetails(account.id, { firstName, lastName, email });
        if (res.error) {
          setMessage({ section: "details", tone: "error", text: res.error });
          return;
        }
        setSavedDetails({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          email: email.trim(),
        });
        didMutate = true;
      }
      if (roleChanged) {
        const res = await changeAccountRole(account.id, role);
        if (res.error) {
          setMessage({ section: "role", tone: "error", text: res.error });
          return;
        }
        setSavedRole(role);
        didMutate = true;
      }
      if (accessChanged) {
        const res = await saveProjectAccess(account.id, accessChanges);
        if (res.error) {
          setMessage({ section: "access", tone: "error", text: res.error });
          return;
        }
        setAccessChanges([]);
        didMutate = true;
      }
      onClose();
    } finally {
      setBusy(null);
      if (didMutate) {
        router.refresh();
        setVersion((value) => value + 1);
      }
    }
  }
  const userInitial = initials(name || account.email);

  function confirmDeactivate() {
    run(
      "access",
      "deactivate",
      () =>
        running.length > 0
          ? deactivateWithHandover(
              account.id,
              running.map((project) => ({
                projectId: project.id,
                replacementId: handovers[project.id],
              }))
            )
          : setAccountsStatus([account.id], "inactive"),
      () => setDeactivateOpen(false)
    );
  }

  async function handlePermanentDelete() {
    if (!isSuperAdmin || detail.hasHistory || busy !== null) return;
    setBusy("delete"); setDeleteError(null);
    try {
      const result = await deleteAccount(account.id);
      if (result.error) { setDeleteError(result.error); return; }
      setDeleteOpen(false); router.refresh(); onClose();
    } catch {
      setDeleteError("Could not delete this account. Please try again.");
    } finally { setBusy(null); }
  }

  return (
    <div className="flex flex-col gap-0">
      <div className="-mx-6 -mt-5 flex items-center gap-4 border-b border-zinc-200 px-6 py-5">
        <div className={`flex size-12 shrink-0 items-center justify-center rounded-[1px] text-sm font-medium ${avatarColor(name || account.email)}`}>
          {userInitial}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-lg font-semibold text-zinc-900">{name}</h3>
            <span
              className={`rounded-sm px-1.5 py-0.5 text-[10px] font-medium ${
                active && !account.invitationPending
                  ? "bg-emerald-50 text-emerald-700"
                  : "bg-amber-50 text-amber-700"
              }`}
            >
              {account.status === "inactive" ? "Inactive" : account.invitationPending ? "Invited" : "Active"}
            </span>
          </div>
          <p className="truncate text-sm text-zinc-500">{account.email}</p>
        </div>
        <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
        {active && (
          <button
            type="button"
            disabled={!detail || busy !== null}
            onClick={() => {
              setMessage(null);
              setDeactivateOpen(true);
            }}
            className={DANGER}
          >
            {busy === "deactivate" ? "Deactivating..." : "Deactivate"}
          </button>
        )}
        {isSuperAdmin && (
          <button type="button" disabled={detail.hasHistory || busy !== null}
            title={detail.hasHistory ? "This account has records. Deactivate it to preserve its history." : undefined}
            onClick={() => { setDeleteError(null); setDeleteOpen(true); }} className={DANGER}>
            {busy === "delete" ? "Deleting..." : "Delete permanently"}
          </button>
        )}
        </div>
      </div>

      <dl className="-mx-6 grid grid-cols-1 border-b border-zinc-200 sm:grid-cols-3">
        <div className="px-6 py-3">
          <dt className="text-[11px] text-zinc-400">Current role</dt>
          <dd className="mt-0.5 text-sm font-medium text-zinc-900">{roleLabel(account.role)}</dd>
        </div>
        <div className="border-zinc-200 px-6 py-3 sm:border-l">
          <dt className="text-[11px] text-zinc-400">Last sign-in</dt>
          <dd className="mt-0.5 text-sm text-zinc-900">
            {account.lastSignInAt ? formatDate(account.lastSignInAt, true) : "Never"}
          </dd>
        </div>
        <div className="border-zinc-200 px-6 py-3 sm:border-l">
          <dt className="text-[11px] text-zinc-400">Created</dt>
          <dd className="mt-0.5 text-sm text-zinc-900">{formatDate(account.createdAt)}</dd>
        </div>
      </dl>

      <div className="-mx-6 grid bg-zinc-50 lg:grid-cols-2">
      <section className="flex flex-col gap-3 px-6 py-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            Account details
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>First name<RequiredMark /></span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Last name<RequiredMark /></span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={LABEL}>Email address<RequiredMark /></span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT} />
          </label>
        </div>
        {note("details")}
      </section>

      {roleOptions.length > 1 && (
        <section className="flex flex-col gap-3 px-6 py-5 lg:border-l lg:border-zinc-200">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              Roles
            </h3>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Role<RequiredMark /></span>
            <span className="relative">
              <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} aria-label="Role" className={`${INPUT} cursor-pointer appearance-none pr-9`}>
                {roleOptions.map((option) => <option key={option} value={option}>{roleLabel(option)}</option>)}
              </select>
              <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400" />
            </span>
          </label>
          {note("role")}
        </section>
      )}
      </div>

      {/* The sections below keep the existing account controls and data. */}
      <div className="-mx-6 border-t border-zinc-200" />

      {/* Password & sign-in */}
      <section className="flex flex-col gap-2 py-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
              {account.invitationPending ? "Invitation" : "Password & sign-in"}
            </h3>
            {account.invitationPending && (
              <p className="text-xs text-zinc-400">Help this member complete their account setup.</p>
            )}
          </div>
          {!account.invitationPending && (
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" disabled={busy !== null} onClick={() => run("password", "reset", () => sendPasswordReset(account.id))} className={TAB_BUTTON}>
                <Mail className="size-3.5" />
                {busy === "reset" ? "Sending..." : "Send reset email"}
              </button>
              <button type="button" disabled={busy !== null} onClick={() => {
                if (window.confirm(`Sign ${name} out of every device?`)) run("password", "signout", () => signOutEverywhere(account.id));
              }} className={TAB_BUTTON}>
                {busy === "signout" ? "Signing out..." : "Sign out everywhere"}
              </button>
            </div>
          )}
        </div>
        {account.invitationPending ? (
          <div>
            <button
              type="button"
              disabled={busy !== null || account.status !== "active"}
              onClick={() => run("password", "invite", () => resendInvitation(account.id))}
              className={PRIMARY}
            >
              {busy === "invite" ? "Sending..." : "Resend invitation"}
            </button>
            <p className="mt-2 text-xs text-zinc-500">
              {account.status !== "active"
                ? "Activate this account before resending its invitation."
                : "Send a fresh link to finish account setup using the existing email and role."}
            </p>
          </div>
        ) : (
          <>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className={LABEL}>Temporary password</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={`${PASSWORD_MIN_LENGTH}–${PASSWORD_MAX_LENGTH} characters`}
              minLength={PASSWORD_MIN_LENGTH}
              aria-describedby={requirementsId}
              autoComplete="off"
              className={INPUT}
            />
          </label>
          <button type="button" disabled={busy !== null} onClick={() => setPassword(generateTemporaryPassword())} className={SECONDARY}>
            <RefreshCw className="mr-1.5 inline size-4" />
            Generate
          </button>
          <button
            type="button"
            disabled={Boolean(getPasswordError(password)) || busy !== null}
            onClick={() =>
              run("password", "password", () => setTemporaryPassword(account.id, password), () =>
                setPassword("")
              )
            }
            className={PRIMARY}
          >
            {busy === "password" ? "Setting..." : "Set password"}
          </button>
        </div>
        <PasswordRequirements password={password} id={requirementsId} />
          </>
        )}
        {note("password")}
      </section>

      {loadError && (
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {/* Projects and recent activity */}
      {detail && (
        <div className="-mx-6 grid border-t border-zinc-200 lg:grid-cols-2">
        <section className="flex flex-col gap-3 px-6 py-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            Projects <span className="text-xs font-normal text-zinc-400">{detail.projects.length} assigned</span>
          </h3>
          {detail.projects.length === 0 ? (
            <EmptyState compact className="text-sm text-zinc-400">No projects yet.</EmptyState>
          ) : (
            <ul className="-mx-2 flex flex-col gap-1">
              {detail.projects.map((project) => (
                <li key={project.id}>
                  <Link
                    href={`/admin/projects/${project.id}`}
                    className="flex items-center gap-3 rounded-md px-2 py-2 text-sm transition hover:bg-zinc-50"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                      <Building2 className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-zinc-900">
                        {project.name}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-zinc-400">
                        {project.location || "No location provided"}
                      </p>
                    </div>
                    <span
                      className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS[project.status].className}`}
                    >
                      {PROJECT_STATUS[project.status].label}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3 px-6 py-5 lg:border-l lg:border-zinc-200">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
            Recent activity
          </h3>
          {detail.activity.length === 0 ? (
            <EmptyState compact className="text-sm text-zinc-400">No activity yet.</EmptyState>
          ) : (
            <ul className="-mx-2 flex flex-col gap-1">
              {detail.activity.map((item, index) => {
                const ActivityIcon = ACTIVITY_ICON[item.kind];
                return (
                  <li key={`${item.at}-${index}`} className="flex gap-3 rounded-md px-2 py-2 transition hover:bg-white/70">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-500">
                      <ActivityIcon className="size-4" />
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm text-zinc-900">{item.label}</p>
                      <p className="mt-0.5 text-xs text-zinc-400" title={formatDate(item.at, true)}>
                        {item.projectName ? `${item.projectName} · ` : ""}{timeAgo(item.at)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
        </div>
      )}

      {/* Access */}
      <section className="-mx-6 flex flex-col gap-3 border-t border-zinc-200 px-6 pt-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-900">
          Access
        </h3>
        {canManageAccess ? (
          <ProjectAccessEditor
            key={account.id}
            accountId={account.id}
            initialSettings={account.accessPreview}
            showHeading={false}
            disabled={busy !== null}
            onChangesChange={setAccessChanges}
          />
        ) : (
          <p className="text-xs text-zinc-500">Administrators have access to all projects.</p>
        )}
        {!active && (
          <div>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => run("access", "activate", () => setAccountsStatus([account.id], "active"))}
              className={PRIMARY}
            >
              {busy === "activate" ? "Activating..." : "Activate"}
            </button>
          </div>
        )}

        {note("access")}
      </section>
      <ModalFooter>
        {message?.tone === "error" && (
          <p role="alert" className="mr-auto text-sm text-red-600">
            {message.text}
          </p>
        )}
        <button type="button" disabled={busy !== null} onClick={onClose} className={SECONDARY}>Cancel</button>
        <button type="button" disabled={busy !== null} onClick={handleSave} className={PRIMARY}>
          {busy === "save" ? "Saving..." : "Save"}
        </button>
      </ModalFooter>
      <ConfirmDialog open={deleteOpen} title="Delete account permanently"
        message={`Permanently delete ${name}'s account? This cannot be undone.`}
        confirmLabel="Delete permanently" pending={busy === "delete"} error={deleteError}
        onConfirm={handlePermanentDelete} onCancel={() => { if (busy !== "delete") setDeleteOpen(false); }} />
      <Modal
        open={deactivateOpen}
        onClose={() => {
          if (busy !== "deactivate") setDeactivateOpen(false);
        }}
        title="Deactivate account"
        variant="centered"
        size="small"
      >
        <div className="flex flex-col gap-5">
          <p className="text-sm text-zinc-600">
            Deactivate {name}? They won&apos;t be able to sign in until reactivated.
          </p>
          {running.length > 0 && (
            <div className="flex flex-col gap-3 rounded-md border border-zinc-200 bg-zinc-50 p-3.5">
              <p className="text-xs font-medium text-zinc-700">
                Project handover before deactivation
              </p>
              {running.map((project) => {
                const needed: UserRole =
                  project.as === "Project Manager" ? "project_manager" : "foreman";
                // Active, free (someone's on one project at a time), not
                // already picked for another of these.
                const candidates = accounts.filter(
                  (person) =>
                    person.id !== account.id &&
                    person.role === needed &&
                    person.status === "active" &&
                    projectElsewhere(person, project.id) === null &&
                    !Object.entries(handovers).some(
                      ([projectId, id]) => id === person.id && Number(projectId) !== project.id
                    )
                );
                return (
                  <label key={project.id} className="flex flex-col gap-1.5">
                    <span className={LABEL}>
                      {project.name} — new {project.as}
                    </span>
                    <span className="relative">
                      <select
                        value={handovers[project.id] ?? ""}
                        onChange={(e) =>
                          setHandovers((prev) => ({ ...prev, [project.id]: e.target.value }))
                        }
                        className={`${INPUT} cursor-pointer appearance-none bg-white pr-9`}
                      >
                        <option value="" disabled hidden>
                          {candidates.length === 0
                            ? `No free ${roleLabel(needed)} right now`
                            : `Select a ${roleLabel(needed)}`}
                        </option>
                        {candidates.map((person) => (
                          <option key={person.id} value={person.id}>
                            {`${person.firstName} ${person.lastName}`.trim() || person.email}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-zinc-400" />
                    </span>
                  </label>
                );
              })}
            </div>
          )}
          {message?.section === "access" && message.tone === "error" && (
            <p role="alert" className="text-sm text-red-600">
              {message.text}
            </p>
          )}
          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={busy === "deactivate"}
              onClick={() => setDeactivateOpen(false)}
              className={SECONDARY}
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy !== null || running.some((project) => !handovers[project.id])}
              onClick={confirmDeactivate}
              className="cursor-pointer rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "deactivate" ? "Deactivating..." : "Deactivate"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
