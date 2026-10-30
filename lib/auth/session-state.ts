import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { parseSessionState } from "./session-policy";

/** No fallback to an unlimited session if the migration/configuration is missing. */
export async function readSessionState(client: SupabaseClient<Database>, activity = false, end = false) {
  const { data, error } = await client.rpc("app_session_state", { p_activity: activity, p_end: end });
  return error ? null : parseSessionState(data);
}
