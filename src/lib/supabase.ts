"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createLocalClient } from "./localdb";

export const LOCAL_MODE = process.env.NEXT_PUBLIC_LOCAL_MODE === "1";

// Single browser client; auth session persists in localStorage.
// In local mode (offline dev / sandboxed testing) a localStorage-backed
// stand-in replaces the network client; app code is identical either way.
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = LOCAL_MODE
      ? (createLocalClient() as unknown as SupabaseClient)
      : createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        );
  }
  return client;
}
