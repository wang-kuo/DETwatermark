// Supabase client factories.
//
//   createSupabaseBrowserClient() — public anon key, runs in the browser.
//   createSupabaseServerClient()  — request-cookie bound, for Server Components
//                                   / Route Handlers (reads & refreshes session).
//   createSupabaseAdminClient()   — service-role key, SERVER ONLY. Bypasses RLS;
//                                   never import this into client code.
//
// Security (BLUEPRINT §2, §7): only NEXT_PUBLIC_* vars ever reach the browser.
// SUPABASE_SERVICE_ROLE_KEY is read exclusively by the admin factory below.

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";

// NOTE: `next/headers` is intentionally NOT imported at module top level. This
// file also exports the browser factory, and a static `next/headers` import
// would pull a server-only API into the client bundle (build error). It is
// dynamically imported inside createSupabaseServerClient() instead, which only
// ever runs on the server.

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/** True when the public Supabase env vars are present. */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Browser-side client. Safe to ship — uses only the public anon key. */
export function createSupabaseBrowserClient() {
  return createBrowserClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

/**
 * Server-side client bound to the incoming request's cookies. Use inside Server
 * Components, Route Handlers and Server Actions to read/refresh the session.
 *
 * In Next 15+ `cookies()` is async, so this factory is async too — always
 * `await` it.
 */
export async function createSupabaseServerClient() {
  const { cookies } = await import("next/headers");
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // `setAll` was called from a Server Component, where the cookie store
          // is read-only. Safe to ignore: session writes happen in Route
          // Handlers (e.g. /api/verify-invite) where cookies are mutable.
        }
      },
    },
  });
}

/**
 * Service-role client. SERVER ONLY. Bypasses Row Level Security, so it is used
 * for privileged operations the anon role cannot (or should not) do:
 *   - reading / updating invite_codes
 *   - global hash dedup lookups against detections
 *   - Storage uploads to the private bucket
 *   - inserting detection rows
 */
export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !serviceRoleKey) {
    throw new Error(
      "Supabase admin client unavailable: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (server-side).",
    );
  }
  return createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
