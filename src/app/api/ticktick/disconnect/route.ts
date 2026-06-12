import { withUser } from "@/lib/route-helpers";
import { disconnect } from "@/lib/ticktick";

export async function POST() {
  return withUser(async (userId) => {
    await disconnect(userId);
    return { ok: true };
  });
}
