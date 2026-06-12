import { NextRequest } from "next/server";
import { withUser } from "@/lib/route-helpers";
import { listCompletedTasks } from "@/lib/ticktick";

/**
 * Recently completed tasks. Optional query params: `limit`, `from`, `to`.
 * Defaults to last 50 completed across all projects.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const limit = sp.get("limit") ? Number(sp.get("limit")) : undefined;
  const from = sp.get("from") ?? undefined;
  const to = sp.get("to") ?? undefined;
  return withUser((userId) =>
    listCompletedTasks(userId, { limit, from, to, status: "Completed" }),
  );
}
