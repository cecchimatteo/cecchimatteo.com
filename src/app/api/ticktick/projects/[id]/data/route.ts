import { withUser } from "@/lib/route-helpers";
import { getProjectData } from "@/lib/ticktick";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withUser((userId) => getProjectData(userId, id));
}
