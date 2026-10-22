"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { projectElsewhere } from "@/lib/accounts/availability";
import type { AccountDetail as Detail, AccountRow } from "@/lib/accounts/data";
import { roleLabel, type UserRole } from "@/lib/auth/roles";
import type { AccountEventAction } from "@/lib/supabase/types";
import { timeAgo } from "@/lib/time-ago";

const INPUT =
  "w-full rounded-md border border-zinc-200 px-3 py-2 text-sm outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200";
const LABEL = "text-xs font-medium text-zinc-500";
const PRIMARY =
  "cursor-pointer rounded bg-zinc-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50";
const SECONDARY =
  "cursor-pointer rounded border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50";
const DANGER =
  "cursor-pointer rounded border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-600 transition hover:border-red-600 hover:bg-red-600 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

const ACTION_LABEL: Record<AccountEventAction, string> = {
  created: "Account created",
  edited: "Details edited",
  role_changed: "Role changed",
  activated: "Activated",
  deactivated: "Deactivated",
  password_reset_sent: "Password reset email sent",
  password_set: "Password set",
  signed_out: "Signed out everywhere",
  handed_over: "Project handed over",
  deleted: "Deleted",
};

const PROJECT_STATUS: Record<"planning" | "ongoing" | "completed", { label: string; className: string }> = {
  planning: { label: "Planning", className: "bg-sky-50 text-sky-700" },
  ongoing: { label: "Ongoing", className: "bg-amber-50 text-amber-700" },
  completed: { label: "Completed", className: "bg-zinc-100 text-zinc-500" },
};

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

function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return btoa(String.fromCharCode(...bytes))
    .replace(/[+/=]/g, "")
    .slice(0, 12);
}

type Section = "details" | "role" | "password" | "access";

/**
 * One account's own window (a row on Manage Accounts): edit their name
 * and email, change their role, reset their password or set one, sign
 * them out everywhere, see their projects and recent activity, deactivate
 * them (handing over any project they still run first) — and, for a super
 * admin, the account's change log and deleting it for good when it has
 * no history.
 */
export function AccountDetail({
  account,
  accounts,
  roleOptions,
  isSuperAdmin,
}: {
  account: AccountRow;
  /** Everyone listed — the hand-over picks come from here. */
  accounts: AccountRow[];
  /** Roles this viewer may give. */
  roleOptions: UserRole[];
  isSuperAdmin: boolean;
}) {
  const router = useRouter();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ section: Section; tone: "ok" | "error"; text: string } | null>(null);

  const [firstName, setFirstName] = useState(account.firstName);
  const [lastName, setLastName] = useState(account.lastName);
  const [email, setEmail] = useState(account.email);
  const [role, setRole] = useState<UserRole>(account.role);
  const [password, setPassword] = useState("");
  const [handovers, setHandovers] = useState<Record<number, string>>({});

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
  const running = (detail?.projects ?? []).filter((project) => project.status !== "completed");
  const detailsChanged =
    firstName.trim() !== account.firstName ||
    lastName.trim() !== account.lastName ||
    email.trim().toLowerCase() !== account.email.toLowerCase();

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-8 gap-y-2.5 text-sm">
        <dt className="text-zinc-500">Role</dt>
        <dd className="font-medium text-zinc-900">{roleLabel(account.role)}</dd>
        <dt className="text-zinc-500">Status</dt>
        <dd>
          <span
            className={`rounded-sm px-2 py-0.5 text-xs font-medium ${
              active ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {active ? "Active" : "Inactive"}
          </span>
        </dd>
        <dt className="text-zinc-500">Last Sign-in</dt>
        <dd className="text-zinc-900">
          {account.lastSignInAt ? formatDate(account.lastSignInAt, true) : "Never"}
        </dd>
        <dt className="text-zinc-500">Created</dt>
        <dd className="text-zinc-900">{formatDate(account.createdAt)}</dd>
      </dl>

      {/* Details */}
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-5">
        <h3 className="text-sm font-semibold text-zinc-900">Details</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>First Name</span>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={LABEL}>Last Name</span>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1.5 sm:col-span-2">
            <span className={LABEL}>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={INPUT}
            />
          </label>
        </div>
        {note("details")}
        <div>
          <button
            type="button"
            disabled={!detailsChanged || busy !== null}
            onClick={() =>
              run("details", "details", () =>
                updateAccountDetails(account.id, { firstName, lastName, email })
              )
            }
            className={PRIMARY}
          >
            {busy === "details" ? "Saving..." : "Save Details"}
          </button>
        </div>
      </section>

      {/* Role */}
      {roleOptions.length > 1 && (
        <section className="flex flex-col gap-3 border-t border-zinc-200 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">Role</h3>
          <div className="flex flex-wrap items-center gap-3">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
              aria-label="Role"
              className={`${INPUT} w-auto cursor-pointer`}
            >
              {roleOptions.map((option) => (
                <option key={option} value={option}>
                  {roleLabel(option)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={role === account.role || busy !== null}
              onClick={() => run("role", "role", () => changeAccountRole(account.id, role))}
              className={PRIMARY}
            >
              {busy === "role" ? "Changing..." : "Change Role"}
            </button>
          </div>
          {note("role")}
        </section>
      )}

      {/* Password & sign-in */}
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-5">
        <h3 className="text-sm font-semibold text-zinc-900">{account.invitationPending ? "Invitation" : "Password & Sign-in"}</h3>
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
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("password", "reset", () => sendPasswordReset(account.id))}
            className={SECONDARY}
          >
            {busy === "reset" ? "Sending..." : "Send Reset Email"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm(`Sign ${name} out of every device?`)) {
                run("password", "signout", () => signOutEverywhere(account.id));
              }
            }}
            className={SECONDARY}
          >
            {busy === "signout" ? "Signing out..." : "Sign Out Everywhere"}
          </button>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex min-w-48 flex-1 flex-col gap-1.5">
            <span className={LABEL}>Temporary Password</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              autoComplete="off"
              className={INPUT}
            />
          </label>
          <button type="button" onClick={() => setPassword(generatePassword())} className={SECONDARY}>
            Generate
          </button>
          <button
            type="button"
            disabled={password.length < 8 || busy !== null}
            onClick={() =>
              run("password", "password", () => setTemporaryPassword(account.id, password), () =>
                setPassword("")
              )
            }
            className={PRIMARY}
          >
            {busy === "password" ? "Setting..." : "Set Password"}
          </button>
        </div>
          </>
        )}
        {note("password")}
      </section>

      {loadError && (
        <p role="alert" className="text-sm text-red-600">
          {loadError}
        </p>
      )}

      {/* Projects */}
      {detail && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">Projects</h3>
          {detail.projects.length === 0 ? (
            <p className="text-sm text-zinc-400">No projects yet.</p>
          ) : (
            <ul className="divide-y divide-zinc-100 rounded-md border border-zinc-200">
              {detail.projects.map((project) => (
                <li key={project.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/admin/projects/${project.id}`}
                      className="font-medium text-zinc-900 hover:underline"
                    >
                      {project.name}
                    </Link>
                    <p className="text-xs text-zinc-400">
                      {project.as} · {formatDate(project.startDate)} – {formatDate(project.endDate)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-medium ${PROJECT_STATUS[project.status].className}`}
                  >
                    {PROJECT_STATUS[project.status].label}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Recent activity */}
      {detail && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">Recent Activity</h3>
          {detail.activity.length === 0 ? (
            <p className="text-sm text-zinc-400">Nothing yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {detail.activity.map((item, index) => (
                <li key={`${item.at}-${index}`} className="flex items-baseline gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-800">{item.label}</p>
                    {item.projectName && <p className="text-xs text-zinc-400">{item.projectName}</p>}
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400" title={formatDate(item.at, true)}>
                    {timeAgo(item.at)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Change log — a super admin's */}
      {detail && isSuperAdmin && (
        <section className="flex flex-col gap-2 border-t border-zinc-200 pt-5">
          <h3 className="text-sm font-semibold text-zinc-900">Change Log</h3>
          {detail.log.length === 0 ? (
            <p className="text-sm text-zinc-400">No changes recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {detail.log.map((entry) => (
                <li key={entry.id} className="flex items-baseline gap-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="text-zinc-800">
                      {ACTION_LABEL[entry.action]}
                      {entry.details && <span className="text-zinc-500"> · {entry.details}</span>}
                    </p>
                    <p className="text-xs text-zinc-400">by {entry.actorName}</p>
                  </div>
                  <span className="shrink-0 text-xs text-zinc-400">{formatDate(entry.createdAt, true)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* Access */}
      <section className="flex flex-col gap-3 border-t border-zinc-200 pt-5">
        <h3 className="text-sm font-semibold text-zinc-900">Access</h3>
        {active ? (
          <>
            {running.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-zinc-500">
                  {name} still runs {running.length === 1 ? "a project" : "these projects"} — pick
                  who takes over before deactivating.
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
                      <select
                        value={handovers[project.id] ?? ""}
                        onChange={(e) =>
                          setHandovers((prev) => ({ ...prev, [project.id]: e.target.value }))
                        }
                        className={`${INPUT} cursor-pointer`}
                      >
                        <option value="" disabled>
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
                    </label>
                  );
                })}
              </div>
            )}
            <div>
              <button
                type="button"
                disabled={
                  !detail || busy !== null || running.some((project) => !handovers[project.id])
                }
                onClick={() => {
                  if (
                    !window.confirm(
                      `Deactivate ${name}? They won't be able to sign in until reactivated.`
                    )
                  ) {
                    return;
                  }
                  run("access", "deactivate", () =>
                    running.length > 0
                      ? deactivateWithHandover(
                          account.id,
                          running.map((project) => ({
                            projectId: project.id,
                            replacementId: handovers[project.id],
                          }))
                        )
                      : setAccountsStatus([account.id], "inactive")
                  );
                }}
                className={DANGER}
              >
                {busy === "deactivate"
                  ? "Deactivating..."
                  : running.length > 0
                    ? "Hand Over & Deactivate"
                    : "Deactivate"}
              </button>
            </div>
          </>
        ) : (
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

        {isSuperAdmin && detail && (
          <div className="flex flex-col gap-1.5">
            <div>
              <button
                type="button"
                disabled={detail.hasHistory || busy !== null}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${name}'s account for good? This can't be undone.`
                    )
                  ) {
                    run("access", "delete", () => deleteAccount(account.id));
                  }
                }}
                className={DANGER}
              >
                {busy === "delete" ? "Deleting..." : "Delete Permanently"}
              </button>
            </div>
            {detail.hasHistory && (
              <p className="text-xs text-zinc-400">
                Has records in the app (projects, logs, requests…) — deactivate instead, so
                those stay theirs.
              </p>
            )}
          </div>
        )}
        {note("access")}
      </section>
    </div>
  );
}
