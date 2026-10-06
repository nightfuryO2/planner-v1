import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
type SupabaseGlobal = typeof globalThis & {
  __teamPlannerSupabaseClient?: ReturnType<typeof createClient<Database>>;
};

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

export function createBrowserSupabaseClient() {
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Supabase is not configured. Add the required NEXT_PUBLIC_SUPABASE variables.");
  }

  const browserGlobal = globalThis as SupabaseGlobal;
  browserGlobal.__teamPlannerSupabaseClient ??= createClient<Database>(supabaseUrl, supabaseAnonKey);
  return browserGlobal.__teamPlannerSupabaseClient;
}
