import { withUser } from "@/lib/route-helpers";
import { getBatchCheck, type TickTickProject, type TickTickTask } from "@/lib/ticktick";

/**
 * Returns the user's full TickTick state in one shot:
 *   - projects (real ones)
 *   - inboxId  (synthetic Inbox project is added on the client)
 *   - tags
 *   - tasks    (open tasks across all projects + Inbox)
 *
 * The unofficial API gives us all of this in `/api/v2/batch/check/0`,
 * so the UI can populate everything without fan-out.
 */
export async function GET() {
  return withUser(async (userId) => {
    const data = await getBatchCheck(userId);
    const tasks: TickTickTask[] = data.syncTaskBean?.update ?? [];
    const projects: TickTickProject[] = data.projectProfiles ?? [];
    return {
      inboxId: data.inboxId,
      projects,
      tasks,
      tags: data.syncTagBean?.update ?? [],
      projectGroups: data.projectGroups ?? [],
    };
  });
}
