import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser-side Supabase client. Uses the public anon key only. Never receives
 * the service role key. Organizer auth session is kept in cookies via @supabase/ssr.
 */
export function createClient() {
  // Accept the legacy anon key or the new-style publishable key (provisioned by
  // the Vercel↔Supabase integration).
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, anonKey!);
}
