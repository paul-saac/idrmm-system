"use client";

import { useActionState, useState } from "react";
import { Flag, X, Check } from "lucide-react";
import {
  flagDailyLogEntry,
  unflagDailyLogEntry,
  resolveDailyLogEntryFlag,
  reflagDailyLogEntry,
  type FlagActionState,
} from "@/lib/daily-logs/actions";
import type { DailyLogStatus } from "@/lib/daily-logs/data";
import {
  flagState as deriveFlagState,
  type EntryFlag,
  type EntryType,
} from "@/lib/daily-logs/flag-state";

const initialState: FlagActionState = {};

function formatFlagDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * One entry's flag control — an admin reviewing a still-pending log can
 * flag an entry as wrong with a reason, without rejecting the whole
 * log; the flagged entry is excluded from counting as real project data
 * (see flagDailyLogEntry) until a fix is accepted. Renders differently
 * per derived state (see flagState in lib/daily-logs/data.ts):
 *   unflagged, pending  -> a bare flag icon that expands to a reason
 *                          field on click
 *   open, pending       -> the reason + an Undo button (admin changed
 *                          their mind before approving)
 *   open, approved      -> the reason + a Resolve button (dismisses the
 *                          flag outright as a false alarm — the entry
 *                          counts as data again with no correction
 *                          needed) — the entry's own "Edit" affordance
 *                          lives next to this control, not inside it
 *                          (see EditFlaggedEntryButton)
 *   updated, approved   -> the reason + Accept/Reject, once someone has
 *                          corrected the entry in place and it's
 *                          awaiting this decision
 *   resolved            -> a quiet indicator, no action
 *   unflagged, not pending -> nothing (can't flag after the fact)
 */
export function FlagControl({
  dailyLogId,
  projectId,
  entryType,
  entryId,
  flag,
  logStatus,
}: {
  dailyLogId: number;
  projectId: number;
  entryType: EntryType;
  entryId: number;
  flag: EntryFlag | undefined;
  logStatus: DailyLogStatus;
}) {
  const [adding, setAdding] = useState(false);
  const [rejecting, setRejecting] = useState(false);

  const flagAction = flagDailyLogEntry.bind(
    null,
    dailyLogId,
    projectId,
    entryType,
    entryId
  );
  const [flagActionState, flagFormAction, flagPending] = useActionState(
    flagAction,
    initialState
  );

  const unflagAction = unflagDailyLogEntry.bind(
    null,
    flag?.id ?? -1,
    dailyLogId,
    projectId
  );
  const [, unflagFormAction, unflagPending] = useActionState(
    unflagAction,
    initialState
  );

  const resolveAction = resolveDailyLogEntryFlag.bind(
    null,
    flag?.id ?? -1,
    dailyLogId,
    projectId
  );
  const [, resolveFormAction, resolvePending] = useActionState(
    resolveAction,
    initialState
  );

  const reflagAction = reflagDailyLogEntry.bind(
    null,
    flag?.id ?? -1,
    dailyLogId,
    projectId
  );
  const [reflagActionState, reflagFormAction, reflagPending] = useActionState(
    reflagAction,
    initialState
  );

  if (!flag) {
    if (logStatus !== "pending") return null;

    if (adding) {
      return (
        <form action={flagFormAction} className="flex flex-wrap items-center gap-1">
          <input
            name="reason"
            autoFocus
            placeholder="Reason for flag"
            className="w-36 rounded border border-zinc-200 px-1.5 py-0.5 text-xs outline-none focus:border-zinc-400"
          />
          <button
            type="submit"
            disabled={flagPending}
            className="cursor-pointer rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed"
          >
            Flag
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            aria-label="Cancel"
            className="cursor-pointer text-zinc-400 hover:text-zinc-600"
          >
            <X className="size-3.5" />
          </button>
          {flagActionState?.error && (
            <span role="alert" className="w-full text-xs text-red-600">
              {flagActionState.error}
            </span>
          )}
        </form>
      );
    }

    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        aria-label="Flag this entry"
        title="Flag this entry"
        className="cursor-pointer rounded p-1 text-zinc-300 transition hover:bg-amber-50 hover:text-amber-600"
      >
        <Flag className="size-3.5" />
      </button>
    );
  }

  const state = deriveFlagState(flag);

  if (state === "resolved") {
    return (
      <span
        title={`Flagged by ${flag.flaggedByName}: "${flag.reason}" — resolved by ${flag.resolvedByName ?? "—"} on ${formatFlagDate(flag.resolvedAt!)}`}
        className="inline-flex w-fit items-center gap-1 rounded-sm bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500"
      >
        <Flag className="size-3" />
        Resolved{flag.entryUpdatedAt ? " — corrected" : ""}
      </span>
    );
  }

  if (state === "updated") {
    if (rejecting) {
      return (
        <form
          action={reflagFormAction}
          className="flex flex-wrap items-center gap-1"
        >
          <input
            name="reason"
            autoFocus
            placeholder="What's still wrong?"
            className="w-36 rounded border border-zinc-200 px-1.5 py-0.5 text-xs outline-none focus:border-zinc-400"
          />
          <button
            type="submit"
            disabled={reflagPending}
            className="cursor-pointer rounded bg-amber-500 px-1.5 py-0.5 text-xs font-medium text-white transition hover:bg-amber-600 disabled:cursor-not-allowed"
          >
            Flag again
          </button>
          <button
            type="button"
            onClick={() => setRejecting(false)}
            aria-label="Cancel"
            className="cursor-pointer text-zinc-400 hover:text-zinc-600"
          >
            <X className="size-3.5" />
          </button>
          {reflagActionState?.error && (
            <span role="alert" className="w-full text-xs text-red-600">
              {reflagActionState.error}
            </span>
          )}
        </form>
      );
    }

    return (
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          title={`Originally flagged by ${flag.flaggedByName}: "${flag.reason}"`}
          className="inline-flex items-center gap-1 rounded-sm bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700"
        >
          <Flag className="size-3" />
          Corrected — needs review
        </span>
        <form action={resolveFormAction}>
          <button
            type="submit"
            disabled={resolvePending}
            className="flex cursor-pointer items-center gap-0.5 text-xs font-medium text-emerald-600 transition hover:text-emerald-800 disabled:cursor-not-allowed"
          >
            <Check className="size-3" />
            Accept
          </button>
        </form>
        <button
          type="button"
          onClick={() => setRejecting(true)}
          className="cursor-pointer text-xs font-medium text-red-600 transition hover:text-red-800"
        >
          Reject
        </button>
      </div>
    );
  }

  // state === "open"
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        title={`Flagged by ${flag.flaggedByName} on ${formatFlagDate(flag.flaggedAt)}`}
        className="inline-flex items-center gap-1 rounded-sm bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700"
      >
        <Flag className="size-3" />
        {flag.reason}
      </span>
      {logStatus === "pending" && (
        <form action={unflagFormAction}>
          <button
            type="submit"
            disabled={unflagPending}
            className="cursor-pointer text-xs font-medium text-zinc-400 transition hover:text-zinc-700 disabled:cursor-not-allowed"
          >
            Undo
          </button>
        </form>
      )}
      {logStatus === "approved" && (
        <form action={resolveFormAction}>
          <button
            type="submit"
            disabled={resolvePending}
            className="flex cursor-pointer items-center gap-0.5 text-xs font-medium text-emerald-600 transition hover:text-emerald-800 disabled:cursor-not-allowed"
          >
            <Check className="size-3" />
            Resolve
          </button>
        </form>
      )}
    </div>
  );
}

/** Looks up the (at most one, per the unique(entry_type, entry_id)
 * constraint) flag for one entry out of a log's full flag list. */
export function findFlag(
  flags: EntryFlag[],
  entryType: EntryType,
  entryId: number
): EntryFlag | undefined {
  return flags.find((f) => f.entryType === entryType && f.entryId === entryId);
}
