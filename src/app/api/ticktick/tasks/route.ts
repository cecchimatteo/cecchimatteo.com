import { withUser } from "@/lib/route-helpers";
import { createTask, type TickTickTask } from "@/lib/ticktick";

/**
 * Create a new task. Body must include at least { title, projectId }.
 * Optional: content, desc, priority (0|1|3|5), dueDate, startDate, isAllDay,
 * timeZone, items (checklist).
 */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<TickTickTask>;
  if (!body.title || !body.projectId) {
    return new Response(
      JSON.stringify({ error: "title_and_projectId_required" }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return withUser((userId) =>
    createTask(userId, { ...body, title: body.title!, projectId: body.projectId! }),
  );
}
