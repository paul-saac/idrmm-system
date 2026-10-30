import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readSessionState } from "@/lib/auth/session-state";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", Vary: "Cookie" };

function isSameOrigin(request: NextRequest) {
  let expectedOrigin = request.nextUrl.origin;
  if (process.env.WEBSITE_HOSTNAME) {
    // App Service terminates HTTPS before forwarding HTTP to Next.js. Use
    // its public Host, not the internal URL or a supplied X-Forwarded-Host.
    const host = request.headers.get("host");
    if (!host || request.headers.get("x-forwarded-proto") !== "https") return false;
    expectedOrigin = `https://${host}`;
  }
  return request.headers.get("origin") === expectedOrigin;
}

async function respond(activity = false, end = false) {
  const client = await createClient();
  const { data: { user }, error } = await client.auth.getUser();
  if (!user) {
    // A network error is not evidence that the user signed out.
    if (error && (error.status === undefined || error.status === 0 || error.status >= 500))
      return Response.json({ error: "Could not check your session. Please try again." }, { status: 503, headers });
    return Response.json({ active: false, reason: "signed_out", serverNow: new Date().toISOString() }, { status: 401, headers });
  }
  const state = await readSessionState(client, activity, end);
  if (!state) return Response.json({ error: "Could not check your session. Please try again." }, { status: 503, headers });
  if (!state.active) await client.auth.signOut({ scope: "local" });
  return Response.json(state, { status: state.active ? 200 : 401, headers });
}

/** Polling, page reloads and token refreshes never count as user activity. */
export async function GET() { return respond(); }

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request) ||
    !request.headers.get("content-type")?.startsWith("application/json"))
    return Response.json({ error: "Invalid session request." }, { status: 403, headers });
  let body;
  try { body = await request.json(); } catch {
    return Response.json({ error: "Invalid session request." }, { status: 400, headers });
  }
  if (!body || !["activity", "signout"].includes(body.action))
    return Response.json({ error: "Invalid session request." }, { status: 400, headers });
  return respond(body.action === "activity", body.action === "signout");
}
