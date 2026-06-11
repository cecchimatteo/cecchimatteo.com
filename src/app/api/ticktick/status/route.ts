import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { loadTokens } from "@/lib/ticktick";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });

  const configured = !!(process.env.TICKTICK_CLIENT_ID && process.env.TICKTICK_CLIENT_SECRET);
  const tokens = await loadTokens(user.id);
  return NextResponse.json({
    connected: !!tokens,
    configured,
    expiresAt: tokens?.expires_at ?? null,
  });
}
