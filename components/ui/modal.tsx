"use client";

import { createContext, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, MoreVertical, X } from "lucide-react";

// The header's spot right after the title, for whatever a modal's own
// content wants to show there (see ModalHeaderAddon).
const HeaderSlotContext = createContext<HTMLElement | null>(null);

/** Renders its children beside the modal's title — e.g. a live status
 * badge the content itself computes. */
export function ModalHeaderAddon({ children }: { children: React.ReactNode }) {
  const slot = useContext(HeaderSlotContext);
  return slot ? createPortal(children, slot) : null;
}

// The bar along the bottom edge, under the scrolling body (see
// ModalFooter). Hidden while nothing's in it.
const FooterSlotContext = createContext<HTMLElement | null>(null);

/** Renders its children in a bar along the modal's bottom edge — e.g. a
 * form's Cancel / Save, in reach however long the form. It sits outside
 * the form itself, so a submit button there names its form (form=). */
export function ModalFooter({ children }: { children: React.ReactNode }) {
  const slot = useContext(FooterSlotContext);
  return slot ? createPortal(children, slot) : null;
}

/** One action in a modal's ⋮ menu (beside its close button) — e.g.
 * Delete, for a modal that edits one deletable thing. */
export type ModalMenuItem = {
  label: string;
  onSelect: () => void;
  destructive?: boolean;
};

// max-w-2xl (the original, and every other modal in this app) is too
// narrow for a screen that's really a small spreadsheet — several
// editable columns per material line, nested under every task, nested
// under every category — rather than the one-form-at-a-time content
// every other modal holds. "large" opts a specific modal into more
// breathing room without changing anyone else's.
const SIZE_CLASS = {
  // A short question and its two buttons (ConfirmDialog).
  small: "max-w-md",
  default: "max-w-2xl",
  // A form beside a side column (the progress window and its history).
  wide: "max-w-5xl",
  large: "max-w-6xl",
} as const;

// "panel" (the original, and every other modal in this app) docks to
// the top-right edge and stretches full-height, reading as a sidebar —
// see the className below for why. "centered" is a deliberate
// deviation for a modal that should read as an ordinary dialog box
// instead (e.g. Import with AI) — a normal rectangle sized
// to its own content, centered in the viewport via the m-auto/inset-0
// trick, capped at 85dvh so a tall step still scrolls internally
// rather than growing past the viewport.
const VARIANT_CLASS = {
  // Edge to edge on the top, right and bottom — only its left side,
  // facing the page, gets a border.
  panel:
    "fixed top-0 right-0 left-auto m-0 h-dvh max-h-none rounded-none border-l border-zinc-200",
  centered: "fixed inset-0 m-auto h-fit max-h-[85dvh] rounded-lg border border-zinc-200",
} as const;

export function Modal({
  open,
  onClose,
  onBack,
  title,
  description,
  icon,
  size = "default",
  variant = "panel",
  menuItems,
  bare = false,
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
  /** A line under the title — what the modal is for. */
  description?: string;
  /** A tile before the title holding this icon. */
  icon?: React.ReactNode;
  size?: keyof typeof SIZE_CLASS;
  /** See VARIANT_CLASS's own doc comment above. Defaults to "panel" so
   * every existing call site keeps its current look unchanged. */
  variant?: keyof typeof VARIANT_CLASS;
  /** Shows a ⋮ menu beside the close button with these actions. */
  menuItems?: ModalMenuItem[];
  /** The body without its own padding or scrolling — for content laid
   * out in columns that pad and scroll themselves (edge-to-edge dividers
   * between them), within a panel's full height. */
  bare?: boolean;
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
  const [footerSlot, setFooterSlot] = useState<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // A click anywhere outside the open menu closes it.
  useEffect(() => {
    if (!menuOpen) return;
    function handlePointerDown(e: MouseEvent) {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [menuOpen]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
      setHasOpened(true);
    } else if (!open && dialog.open) {
      dialog.close();
      setHasOpened(false);
      setMenuOpen(false);
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      // React bubbles a <dialog>'s close/cancel up the component tree
      // (it only keeps scroll events to their target), so a modal
      // stacked on top of this one closing would otherwise close this
      // one too — e.g. Holidays, opened from inside Edit Project.
      onClose={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onCancel={(e) => {
        if (e.target !== e.currentTarget) return;
        // Escape with the ⋮ menu open closes just the menu.
        if (menuOpen) {
          e.preventDefault();
          setMenuOpen(false);
          return;
        }
        onClose();
      }}
      onMouseDown={(e) => {
        // Same reason: a click inside a stacked modal (or on its own
        // backdrop) belongs to that modal, not this one.
        if ((e.target as Element).closest("dialog") !== e.currentTarget) return;
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
      // panel's own left-auto un-sets the browser's own dialog:modal
      // default of left:0 (part of its inset:0 shorthand) — with that
      // still active, having both left:0 and right:0 plus an explicit
      // width is over-constrained, and the spec has left win over right
      // for LTR content, which docked this to the left instead. A
      // <dialog> doesn't stretch to fill top+bottom insets the way an
      // ordinary fixed-position div would (confirmed directly — with
      // bottom-4 instead of an explicit height, it just sized to its
      // own content and left a large unintended gap at the bottom), so
      // panel's height is computed explicitly instead. max-h-none
      // un-sets the same default's own max-height (a calc() a few
      // pixels short of 100%, meant for its old centered/margined
      // look), which would otherwise still clip the explicit height
      // below. centered instead leans on that same inset-0/margin:auto
      // browser default (all four insets pinned, width/height smaller
      // than the viewport) to center itself, sized to fit its own
      // content up to max-h-[85dvh]. rounded-lg is this app's own 5px
      // token (see globals.css), not Tailwind's default 8px.
      className={`${VARIANT_CLASS[variant]} w-full ${SIZE_CLASS[size]} overflow-hidden bg-white p-0 backdrop:bg-zinc-900/50 open:flex open:flex-col`}
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
          {icon && (
            <span className="mr-3 flex size-10 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
              {icon}
            </span>
          )}
          <div className="min-w-0">
            <div className="flex items-center">
              <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
              <div ref={setHeaderSlot} className="ml-2 flex items-center empty:hidden" />
            </div>
            {description && <p className="mt-0.5 text-sm text-zinc-500">{description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {menuItems && menuItems.length > 0 && (
            <>
              <div ref={menuRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMenuOpen((isOpen) => !isOpen)}
                  aria-label="More actions"
                  aria-haspopup="menu"
                  aria-expanded={menuOpen}
                  className={`cursor-pointer rounded p-1 transition hover:bg-zinc-100 hover:text-zinc-600 ${
                    menuOpen ? "bg-zinc-100 text-zinc-600" : "text-zinc-400"
                  }`}
                >
                  <MoreVertical className="size-5" />
                </button>
                {menuOpen && (
                  <div
                    role="menu"
                    className="absolute top-full right-0 z-20 mt-1 min-w-44 overflow-hidden rounded border border-zinc-200 bg-white py-1 shadow-lg"
                  >
                    {menuItems.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpen(false);
                          item.onSelect();
                        }}
                        className={`block w-full cursor-pointer px-3 py-2 text-left text-sm transition ${
                          item.destructive
                            ? "text-red-600 hover:bg-red-50"
                            : "text-zinc-700 hover:bg-zinc-50"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mx-1 h-5 w-px bg-zinc-200" />
            </>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="cursor-pointer rounded p-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-600"
          >
            <X className="size-5" />
          </button>
        </div>
      </div>
      {/* Grows to fit its content; only scrolls once the dialog would
          otherwise run off the top/bottom of the viewport. */}
      <div className={bare ? "min-h-0 flex-1" : "min-h-0 flex-1 overflow-y-auto px-6 py-5"}>
        <HeaderSlotContext.Provider value={headerSlot}>
          <FooterSlotContext.Provider value={footerSlot}>
            {hasOpened && children}
          </FooterSlotContext.Provider>
        </HeaderSlotContext.Provider>
      </div>
      <div
        ref={setFooterSlot}
        className="flex shrink-0 items-center justify-end gap-3 border-t border-zinc-200 px-6 py-4 empty:hidden"
      />
    </dialog>
  );
}
