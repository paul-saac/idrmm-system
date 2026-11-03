/** Provider retry hints are authoritative. Never shorten a long cooldown just
 * to squeeze another request into the import's bounded execution window. */
export function aiRetryDelay(response: Response, attempt: number, remainingMs: number, errorCode = "", now = Date.now(), random = Math.random()): number | null {
  if (![429, 502, 503, 504].includes(response.status) || /insufficient_quota|billing|credit.*exhaust|usage_limit_exceeded/i.test(errorCode)) return null;
  const milliseconds = response.headers.get("retry-after-ms") ?? response.headers.get("x-ms-retry-after-ms");
  const retryAfter = response.headers.get("retry-after");
  let delay: number;
  if (milliseconds !== null && milliseconds.trim() && Number.isFinite(Number(milliseconds)) && Number(milliseconds) >= 0) delay = Number(milliseconds);
  else if (retryAfter !== null && /^\d+(?:\.\d+)?$/.test(retryAfter.trim())) delay = Number(retryAfter) * 1000;
  else if (retryAfter && Number.isFinite(Date.parse(retryAfter))) delay = Math.max(0, Date.parse(retryAfter) - now);
  else delay = Math.min(8000, 1000 * 2 ** Math.max(0, attempt - 1)) + Math.floor(random * 500);
  delay = Math.max(250, delay);
  return delay + 5000 <= remainingMs ? delay : null;
}
