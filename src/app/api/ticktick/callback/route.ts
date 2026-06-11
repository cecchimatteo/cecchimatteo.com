import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import {
  exchangeCodeForToken,
  saveTokens,
  ticktickRedirectUri,
} from "@/lib/ticktick";

/**
 * OAuth callback. TickTick redirects the user back here with `?code=...&state=...`.
 * We verify `state` against the cookie set in /authorize, exchange the code
 * for tokens, and stash them in `ticktick_tokens`.
 */
export async function GET(req: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/auth", req.url));
  }

  const url = req.nextUrl;
  const error = url.searchParams.get("error");
  if (error) {
    return NextResponse.redirect(
      new URL(`/home?ticktick_error=${encodeURIComponent(error)}`, req.url),
    );
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const cookieState = req.cookies.get("tt_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState) {
    return NextResponse.redirect(
      new URL("/home?ticktick_error=invalid_state", req.url),
    );
  }

  try {
    const tokens = await exchangeCodeForToken({
      code,
      redirectUri: ticktickRedirectUri(url.origin),
    });
    await saveTokens(user.id, tokens);
  } catch (err) {
    console.error("[ticktick/callback]", err);
    const message = err instanceof Error ? err.message : "exchange_failed";
    return NextResponse.redirect(
      new URL(`/home?ticktick_error=${encodeURIComponent(message)}`, req.url),
    );
  }

  const res = NextResponse.redirect(new URL("/home?ticktick=connected", req.url));
  res.cookies.delete("tt_oauth_state");
  return res;
}
