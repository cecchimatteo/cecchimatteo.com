import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Supabase client for use inside Next.js Route Handlers / Server Components.
 *
 * Uses the request's cookie store so the user's auth session is honored and
 * RLS policies apply correctly. Note: in Next.js 16 `cookies()` is async.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          // Route Handlers can set cookies; Server Components cannot.
          // Wrapping in try/catch lets the same helper be used in both places.
          try {
            cookiesToSet.forEach(({ name, value, options }) => {
              cookieStore.set(name, value, options);
            });
          } catch {
            /* called from a Server Component — safe to ignore */
          }
        },
      },
    },
  );
}
