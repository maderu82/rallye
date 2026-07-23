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
  // Accept both the legacy service_role key and the new-style secret key that
  // the Vercel↔Supabase integration provisions (SUPABASE_SECRET_KEY).
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!key) {
    throw new Error(
      "No Supabase secret key set — need SUPABASE_SERVICE_ROLE_KEY or SUPABASE_SECRET_KEY.",
    );
  }
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
