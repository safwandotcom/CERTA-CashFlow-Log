import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client using the secret key. It never reaches the browser.
export function db() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be set.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
