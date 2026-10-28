import type { SVGProps } from "react";

type AiSparklesIconProps = SVGProps<SVGSVGElement> & {
  /** Optional fill override: 'white', 'black', or defaults to 'currentColor'. */
  variant?: "black" | "white" | "default";
};

/**
 * AI Sparkles Icon (Option 1 — Slender Astroid)
 * Ultra-clean, mathematically pure vector icon with smooth concave circular
 * sweeps and zero jagged edges. Scaled to maximize viewBox coverage for big,
 * bold, prominent rendering across buttons, modal headers, and celebration badges.
 */
export function AiSparklesIcon({
  className,
  variant,
  ...props
}: AiSparklesIconProps) {
  const fill =
    variant === "white"
      ? "white"
      : variant === "black"
        ? "#3B3939"
        : "currentColor";

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill={fill}
      aria-hidden="true"
      className={className}
      {...props}
    >
      <path d="M10 2.5C10 7.7 14.3 12 19.5 12C14.3 12 10 16.3 10 21.5C10 16.3 5.7 12 0.5 12C5.7 12 10 7.7 10 2.5ZM18.5 1.5C18.5 3.9 20.1 5.5 22.5 5.5C20.1 5.5 18.5 7.1 18.5 9.5C18.5 7.1 16.9 5.5 14.5 5.5C16.9 5.5 18.5 3.9 18.5 1.5Z" />
    </svg>
  );
}
