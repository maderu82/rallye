import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. BYPASSES row-level security.
 *
 * Server-only. Used to mediate all participant traffic (join, play, grade) so
 * that answer keys never reach the browser and scores can't be tampered with.
 * Importing this from a Client Component will (correctly) fail — the service
 * role key is not a NEXT_PUBLIC_ variable.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set — required for participant/grading server logic.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
