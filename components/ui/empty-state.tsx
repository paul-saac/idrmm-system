import type { ReactNode } from "react";

/** Shared, decorative construction scene for empty collections. */
export function ConstructionEmptyIllustration({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 90 480 165"
      className={`empty-state-illustration in-[dialog]:hidden h-auto max-w-full shrink-0 ${className}`}
      fill="none"
    >
      {/* Small hills behind the barricade and cone. */}
      <path fill="#e4e4e7" d="M45 232c20-18 42-20 66-15 23-16 46-8 63 0 19-15 39-15 62-4 27-7 50-28 77-31 37-5 70 28 119 50H45Z" />
      {/* Two striped boards and their supports. */}
      <rect x="73" y="107" width="13" height="128" rx="5" fill="#b8b8bc" />
      <rect x="186" y="107" width="13" height="128" rx="5" fill="#b8b8bc" />
      <rect x="44" y="122" width="185" height="29" rx="7" fill="#e4e4e7" />
      <rect x="44" y="174" width="185" height="29" rx="7" fill="#e4e4e7" />
      <g fill="#c9c9cd">
        <path d="m57 151 29-29h29l-29 29H57Zm71 0 29-29h29l-29 29h-29Zm71 0 29-29v29h-29Z" />
        <path d="m44 196 22-22h29l-29 29H51a7 7 0 0 1-7-7Zm64 7 29-29h29l-29 29h-29Zm71 0 29-29h14a7 7 0 0 1 7 7v1l-21 21h-29Z" />
      </g>
      {/* A traffic cone, with pale reflective bands. */}
      <path d="m247 226 22-79c2-8 10-8 13 0l25 79h-60Z" fill="#b8b8bc" />
      <path d="m265 161-4 14h30l-4-14h-22Zm-10 35-4 14h51l-4-14h-43Z" fill="#e4e4e7" />
      <rect x="239" y="226" width="76" height="9" rx="3" fill="#a1a1aa" />
      <rect x="240" y="227" width="41" height="8" rx="3" fill="#b8b8bc" />
      <path d="M25 237h425" stroke="#c9c9cd" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  children,
  compact = false,
  className = "",
}: {
  children: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center gap-3 text-center ${className}`}>
      <ConstructionEmptyIllustration className={compact ? "w-32" : "w-52"} />
      <div className={`max-w-md text-zinc-500 ${compact ? "text-xs" : "text-sm"}`}>
        {children}
      </div>
    </div>
  );
}
