import { NextResponse } from "next/server";
import { createServerSupabase } from "./supabase-server";
import { TickTickError } from "./ticktick";

/**
 * Wraps a route handler that needs an authenticated Daybook user. Provides
 * the user id to the inner function and turns common failures into
 * appropriate HTTP responses.
 */
export async function withUser<T>(
  fn: (userId: string) => Promise<T>,
): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const data = await fn(user.id);
    return NextResponse.json(data ?? { ok: true });
  } catch (err) {
    if (err instanceof TickTickError) {
      const code =
        err.status === 401 ? "ticktick_not_connected"
        : err.status === 404 ? "not_found"
        : "ticktick_api_error";
      return NextResponse.json(
        { error: code, status: err.status, body: err.body },
        { status: err.status === 401 ? 401 : 502 },
      );
    }
    console.error("[ticktick route]", err);
    const message = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
