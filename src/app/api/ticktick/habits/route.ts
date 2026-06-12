import { withUser } from "@/lib/route-helpers";
import { listHabitCheckins, listHabits } from "@/lib/ticktick";

/**
 * Habits + a 30-day window of checkins for each, ready for streak / heatmap UIs.
 */
export async function GET() {
  return withUser(async (userId) => {
    const habits = await listHabits(userId);
    const ids = habits.filter((h) => h.status !== 1).map((h) => h.id);
    const checkins = await listHabitCheckins(userId, ids);
    return { habits, checkins };
  });
}
