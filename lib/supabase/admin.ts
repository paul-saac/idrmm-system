import "server-only";
import { createClient as createSupabaseJsClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

/**
 * Privileged Supabase client using the secret/service_role key. Bypasses
 * Row Level Security and can call the Auth Admin API (create/delete users).
 *
 * NEVER import this from a Client Component or anything that could end up
 * in a browser bundle — the `server-only` import makes that a build error.
 * Only use it inside `"use server"` action modules, after you've already
 * verified the caller is authorized to perform the privileged operation.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is not set. Add it to .env (Supabase Dashboard > Project Settings > API Keys > secret key) to enable account creation."
    );
  }

  return createSupabaseJsClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
