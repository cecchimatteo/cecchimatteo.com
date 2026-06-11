import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { createServerSupabase } from "@/lib/supabase-server";
import { buildAuthorizeUrl, ticktickRedirectUri } from "@/lib/ticktick";

/**
 * Kicks off the TickTick OAuth flow:
 *   1. Verify the user is signed in to Daybook.
 *   2. Generate a CSRF `state`, store it in a short-lived signed cookie.
 *   3. Redirect to TickTick's consent screen.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  let redirectUri: string;
  try {
    redirectUri = ticktickRedirectUri(req.nextUrl.origin);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "config error" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  let url: string;
  try {
    url = buildAuthorizeUrl({ redirectUri, state });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "config error" },
      { status: 500 },
    );
  }

  const res = NextResponse.redirect(url);
  res.cookies.set("tt_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: req.nextUrl.protocol === "https:",
    path: "/api/ticktick",
    maxAge: 60 * 10,
  });
  return res;
}
