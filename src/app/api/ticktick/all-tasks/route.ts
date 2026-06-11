import { withUser } from "@/lib/route-helpers";
import { getProjectData, listProjects, type TickTickTask } from "@/lib/ticktick";

/**
 * Convenience endpoint: fan out across all (non-Inbox) projects in parallel
 * and return a flat list of open tasks plus the project list.
 *
 * The Open API doesn't include the Inbox in /project, so this view excludes
 * it. The Home page lets you select a project explicitly.
 */
export async function GET() {
  return withUser(async (userId) => {
    const projects = await listProjects(userId);
    const datas = await Promise.all(
      projects.map((p) =>
        getProjectData(userId, p.id).catch((err) => {
          console.error("[all-tasks] project fetch failed", p.id, err);
          return null;
        }),
      ),
    );
    const tasks: TickTickTask[] = [];
    for (const d of datas) if (d?.tasks) tasks.push(...d.tasks);
    return { projects, tasks };
  });
}
