import type { NextRequest } from "next/server";

export const offlineHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };
export function sameOfflineOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (process.env.NODE_ENV !== "production" && !process.env.WEBSITE_HOSTNAME) return origin === request.nextUrl.origin;
  return [process.env.NEXT_PUBLIC_SITE_URL, process.env.WEBSITE_HOSTNAME && `https://${process.env.WEBSITE_HOSTNAME}`,
    process.env.WEBSITE_DEFAULT_HOSTNAME && `https://${process.env.WEBSITE_DEFAULT_HOSTNAME}`].some(site => {
    try { return !!site && new URL(site).protocol === "https:" && new URL(site).origin === origin; } catch { return false; }
  });
}
