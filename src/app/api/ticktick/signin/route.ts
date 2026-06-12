import { NextRequest } from "next/server";
import { withUser } from "@/lib/route-helpers";
import { connect, type Region } from "@/lib/ticktick";

/**
 * Sign in to TickTick with email + password. Stores the (encrypted)
 * credentials and an initial session cookie. Returns 401 on bad creds,
 * 403 if TickTick demands a captcha challenge.
 */
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    email?: string;
    password?: string;
    region?: Region;
  };
  if (!body.email || !body.password) {
    return new Response(
      JSON.stringify({ error: "email_and_password_required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return withUser(async (userId) => {
    await connect(userId, {
      email: body.email!,
      password: body.password!,
      region: body.region,
    });
    return { ok: true };
  });
}
