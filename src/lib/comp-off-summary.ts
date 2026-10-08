import { addDays, format, getDay } from "date-fns";
import type { Category, Plan, Profile } from "@/lib/types";

export type CompOffPlan = Pick<Plan, "id" | "title" | "category_id" | "plan_date" | "start_time" | "end_time" | "created_by">;

export type CompOffEvent = {
  date: string;
  change: 1 | -1;
  reason: string;
  planTitles: string[];
};

export type MemberCompOffSummary = {
  member: Profile;
  carriedIn: number;
  earned: number;
  taken: number;
  pending: number;
  events: CompOffEvent[];
};

type DayActivity = {
  working: string[];
  compOff: string[];
  holiday: boolean;
};

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

// The dates a plan covers: its own date, plus the next day when it runs past midnight.
function getPlanDates(plan: CompOffPlan) {
  const end = toMinutes(plan.end_time);
  const overnight = end < toMinutes(plan.start_time) && end > 0;
  if (!overnight) return [plan.plan_date];
  return [plan.plan_date, format(addDays(new Date(`${plan.plan_date}T00:00:00`), 1), "yyyy-MM-dd")];
}

/**
 * Comp offs per member for the month monthStart..monthEnd (yyyy-MM-dd, inclusive).
 *
 * - Earned: each Sunday or holiday (a date with a holiday-type plan) on which the member has a
 *   working-type plan earns 1.
 * - Taken: each date with a comp-off-type plan uses 1, counted on the date the plan starts.
 * - Comp offs never expire: carriedIn is the balance from everything before the month, and
 *   pending is the balance at the end of the month. It can be negative when a comp off is taken
 *   before the Sunday or holiday it is for.
 *
 * `plans` must include every relevant plan up to monthEnd, not just the month itself.
 */
export function summarizeCompOffs(
  plans: CompOffPlan[],
  categories: Category[],
  members: Profile[],
  monthStart: string,
  monthEnd: string,
): MemberCompOffSummary[] {
  const kindById = new Map(categories.map((category) => [category.id, category.kind]));
  const activityByMember = new Map<string, Map<string, DayActivity>>();

  for (const plan of plans) {
    const kind = kindById.get(plan.category_id);
    if (kind !== "working" && kind !== "comp_off" && kind !== "holiday") continue;
    let days = activityByMember.get(plan.created_by);
    if (!days) {
      days = new Map();
      activityByMember.set(plan.created_by, days);
    }
    // A comp off counts once, on the date it starts, even if it runs past midnight.
    const dates = kind === "comp_off" ? [plan.plan_date] : getPlanDates(plan);
    for (const date of dates) {
      if (date > monthEnd) continue;
      let day = days.get(date);
      if (!day) {
        day = { working: [], compOff: [], holiday: false };
        days.set(date, day);
      }
      if (kind === "working") day.working.push(plan.title);
      else if (kind === "comp_off") day.compOff.push(plan.title);
      else day.holiday = true;
    }
  }

  return members.map((member) => {
    const summary: MemberCompOffSummary = { member, carriedIn: 0, earned: 0, taken: 0, pending: 0, events: [] };
    const days = activityByMember.get(member.id) ?? new Map<string, DayActivity>();

    for (const date of [...days.keys()].sort()) {
      const day = days.get(date)!;
      const sunday = getDay(new Date(`${date}T00:00:00`)) === 0;
      const dayEvents: CompOffEvent[] = [];
      if ((sunday || day.holiday) && day.working.length > 0) {
        dayEvents.push({
          date,
          change: 1,
          reason: sunday ? "Worked on a Sunday" : "Worked on a holiday",
          planTitles: day.working,
        });
      }
      if (day.compOff.length > 0) {
        dayEvents.push({ date, change: -1, reason: "Comp off taken", planTitles: day.compOff });
      }

      for (const event of dayEvents) {
        if (date < monthStart) {
          summary.carriedIn += event.change;
        } else {
          if (event.change > 0) summary.earned += 1;
          else summary.taken += 1;
          summary.events.push(event);
        }
      }
    }

    summary.pending = summary.carriedIn + summary.earned - summary.taken;
    return summary;
  });
}
