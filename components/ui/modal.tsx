"use client";

import { useEffect, useRef } from "react";
import { ChevronLeft, X } from "lucide-react";

export function Modal({
  open,
  onClose,
  onBack,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** When set, shows a back chevron before the title — for a modal
   * that's really a small multi-screen flow (e.g. Add Daily Log ->
   * Work Logs -> Add Work Log), so a screen can step back to the
   * previous one without fully closing/discarding everything. */
  onBack?: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      onClose={onClose}
      onCancel={onClose}
      onMouseDown={(e) => {
        // `e.target === dialog` (the usual trick for detecting a backdrop
        // click) isn't reliable for a <dialog>'s ::backdrop pseudo-element
        // across browsers. Checking whether the click coordinates fall
        // outside the dialog's own rendered box is: if not, it's necessarily
        // the backdrop.
        const rect = dialogRef.current?.getBoundingClientRect();
        if (!rect) return;
        const inside =
          e.clientX >= rect.left &&
          e.clientX <= rect.right &&
          e.clientY >= rect.top &&
          e.clientY <= rect.bottom;
        if (!inside) onClose();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl rounded-lg border border-zinc-200 bg-white p-0 backdrop:bg-zinc-900/50 open:flex open:flex-col"
    >
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4">
        <div className="flex items-center gap-1">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              aria-label="Back"
              className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
            >
              <ChevronLeft className="size-5" />
            </button>
          )}
          <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
        >
          <X className="size-5" />
        </button>
      </div>
      {/* Grows to fit its content; only scrolls once the dialog would
          otherwise run off the top/bottom of the viewport. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
    </dialog>
  );
}
