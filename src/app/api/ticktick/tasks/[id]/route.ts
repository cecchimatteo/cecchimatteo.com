import { NextRequest } from "next/server";
import { withUser } from "@/lib/route-helpers";
import { deleteTask, updateTask, type TickTickTask } from "@/lib/ticktick";

/**
 * Update a task. TickTick uses POST /task/{id} (not PATCH).
 * Body must include the projectId (TickTick requires it for routing).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json()) as Partial<TickTickTask>;
  if (!body.projectId) {
    return new Response(
      JSON.stringify({ error: "projectId_required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return withUser((userId) =>
    updateTask(userId, { ...body, id, projectId: body.projectId! }),
  );
}

/**
 * Delete a task. Requires `?projectId=...` in the query string.
 */
export async function DELETE(
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
  return withUser((userId) => deleteTask(userId, projectId, id));
}
