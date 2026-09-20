"use client";

import { useEffect, useRef, useState } from "react";
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
  // Children mount only once the <dialog> is actually showModal()-open,
  // not the instant `open` flips true — a checkbox/select rendered
  // while the dialog is still closed (display:none per the UA
  // stylesheet, since showModal() itself only runs in the effect below,
  // one tick after the children that need it would otherwise already
  // have been created) doesn't reliably pick up its checked/selected
  // state as a live DOM property once the dialog later becomes visible
  // — confirmed directly: the "checked" attribute was present in the
  // rendered HTML, but the live .checked property still read false,
  // and a <select>'s defaultValue-chosen option showed the same way
  // (falling back to the placeholder instead of the real selection).
  // Unmounting on close (rather than just hiding) also means every
  // open starts genuinely fresh, matching how every Add/Edit form in
  // this app is already built to re-derive its fields from props.
  const [hasOpened, setHasOpened] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      setHasOpened(true);
    } else if (!open && dialog.open) {
      dialog.close();
      setHasOpened(false);
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
      // left-auto un-sets the browser's own dialog:modal default of
      // left:0 (part of its inset:0 shorthand) — with that still active,
      // having both left:0 and right:0 plus an explicit width is
      // over-constrained, and the spec has left win over right for LTR
      // content, which docked this to the left instead. A <dialog>
      // doesn't stretch to fill top+bottom insets the way an ordinary
      // fixed-position div would (confirmed directly — with bottom-4
      // instead of an explicit height, it just sized to its own content
      // and left a large unintended gap at the bottom), so the height
      // is computed explicitly instead. max-h-none un-sets the same
      // default's own max-height (a calc() a few pixels short of 100%,
      // meant for its old centered/margined look), which would otherwise
      // still clip the explicit height below. rounded-lg is this app's
      // own 5px token (see globals.css), not Tailwind's default 8px.
      className="fixed top-4 right-4 left-auto m-0 h-[calc(100dvh-2rem)] max-h-none w-full max-w-2xl overflow-hidden rounded-lg border border-zinc-200 bg-white p-0 backdrop:bg-zinc-900/50 open:flex open:flex-col"
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
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {hasOpened && children}
      </div>
    </dialog>
  );
}
