import { withUser } from "@/lib/route-helpers";
import { listProjects } from "@/lib/ticktick";

export async function GET() {
  return withUser((userId) => listProjects(userId));
}
