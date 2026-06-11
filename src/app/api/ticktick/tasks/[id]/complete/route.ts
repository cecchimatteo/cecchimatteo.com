import { NextRequest } from "next/server";
import { withUser } from "@/lib/route-helpers";
import { completeTask } from "@/lib/ticktick";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const projectId = req.nextUrl.searchParams.get("projectId");
  if (!projectId) {
    return new Response(
      JSON.stringify({ error: "projectId_required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return withUser((userId) => completeTask(userId, projectId, id));
}
