import { getSessionProfile } from "@/lib/auth/session";
import { offlineHeaders as headers } from "@/lib/offline/http";

export const dynamic = "force-dynamic";
export async function GET() {
  const profile = await getSessionProfile();
  return profile ? Response.json({ id: profile.id }, { headers })
    : Response.json({ error: "Sign in again to synchronize saved offline entries." }, { status: 401, headers });
}
