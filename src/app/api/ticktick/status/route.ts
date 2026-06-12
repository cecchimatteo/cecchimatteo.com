import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { status } from "@/lib/ticktick";

export async function GET() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ connected: false }, { status: 401 });
  return NextResponse.json(await status(user.id));
}
