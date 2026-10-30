/** First initial from a name — "Juan Dela Cruz" → "J". */
export function initials(name: string | null | undefined, fallback = "?") {
  const trimmed = name?.trim();
  if (!trimmed) return fallback;
  return trimmed.charAt(0).toUpperCase();
}
