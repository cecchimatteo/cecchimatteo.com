import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase-server";
import { deleteTokens } from "@/lib/ticktick";

export async function POST() {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await deleteTokens(user.id);
  return NextResponse.json({ ok: true });
}
