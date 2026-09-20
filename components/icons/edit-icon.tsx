import { forwardRef } from "react";
import type { SVGProps } from "react";

/**
 * The app's own "edit" glyph — one continuous box outline, open only at
 * its top-right corner, with a diagonal pencil stroke exiting through
 * that one opening. Per an explicit design reference; an earlier
 * version used two separate opposite-corner brackets instead of one
 * continuous box with a single opening — confirmed directly, side by
 * side against the reference, to be visibly wrong (not a close-enough
 * approximation). The box path is lucide-react's own "square-pen" box
 * path verbatim (its pen-nib shape is dropped in favor of a plain
 * straight diagonal line, matching this reference's simpler style) —
 * not otherwise a lucide-react icon, so this stays hand-authored to
 * lucide's own conventions (24x24 viewBox, round caps/joins,
 * currentColor stroke) so it drops in as a direct replacement for
 * <Pencil /> wherever that was used for "edit".
 */
export const EditIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function EditIcon(props, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={24}
        height={24}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
      >
        <path d="M12 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
        <path d="M14 10 21 3" />
      </svg>
    );
  }
);
