import { NextResponse } from "next/server";
import { createServerSupabase } from "./supabase-server";
import { TickTickAuthError, TickTickCaptchaError, TickTickError } from "./ticktick";

/**
 * Wraps a route handler that needs an authenticated Daybook user. Maps
 * common upstream failures to friendly HTTP responses.
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
    if (err instanceof TickTickCaptchaError) {
      return NextResponse.json(
        { error: "ticktick_captcha", message: err.message },
        { status: 403 },
      );
    }
    if (err instanceof TickTickAuthError) {
      return NextResponse.json(
        { error: "ticktick_auth", message: err.message, code: err.code, body: err.body },
        { status: 401 },
      );
    }
    if (err instanceof TickTickError) {
      return NextResponse.json(
        { error: "ticktick_api_error", status: err.status, code: err.code, body: err.body },
        { status: 502 },
      );
    }
    console.error("[ticktick route]", err);
    const message = err instanceof Error ? err.message : "internal_error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
