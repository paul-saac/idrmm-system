"use client";

import { Modal } from "@/components/ui/modal";

/**
 * "Are you sure?" in the app's own look, centered on the screen — in place
 * of the browser's window.confirm. Stays open while the action runs (its
 * button says so), and shows the action's error right here if it fails.
 * Render it beside whatever opened it, or inside that modal's content:
 * either way it's its own top-layer <dialog>, the newer one on top (Modal
 * keeps a stacked dialog's clicks and closing to itself).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = "Delete",
  pendingLabel = "Deleting...",
  pending = false,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  pendingLabel?: string;
  pending?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} variant="centered" size="small">
      <div className="flex flex-col gap-5">
        <p className="text-sm text-zinc-600">{message}</p>
        {error && (
          <p role="alert" className="text-sm text-red-600">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="cursor-pointer rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending ? pendingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </Modal>
  );
}
