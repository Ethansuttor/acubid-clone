"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createLocalClient } from "./localdb";
import { LOCAL_ONLY } from "./local-config";

export const LOCAL_MODE = LOCAL_ONLY;

// Single local browser client; auth remains in localStorage while application
// data, the outbox, and plan files persist in IndexedDB. Keep the
// Supabase-shaped interface so the estimator does not
// need a broad data-layer rewrite when the production backend returns.
let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!client) {
    client = createLocalClient() as unknown as SupabaseClient;
  }
  return client;
}
