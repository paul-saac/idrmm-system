/** Up to two initials from a name — "Juan Dela Cruz" → "JD". */
export function initials(name: string | null | undefined, fallback = "?") {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  return trimmed
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
