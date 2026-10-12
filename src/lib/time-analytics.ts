import { addDays, format } from "date-fns";
import type { Plan } from "@/lib/types";

export type AnalyticsPlan = Pick<Plan, "id" | "category_id" | "plan_date" | "start_time" | "end_time" | "created_by">;

export type TimeAnalytics = {
  /** Minutes per member, per category. Only members and categories with time appear. */
  minutes: Map<string, Map<string, number>>;
  /** Category ids that have any time in the range. */
  categoryIds: string[];
};

const DAY_MINUTES = 24 * 60;

function toMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

function nextDay(date: string) {
  return format(addDays(new Date(`${date}T00:00:00`), 1), "yyyy-MM-dd");
}

/**
 * The minutes a plan covers on each date. An end time earlier than the start time means the
 * plan runs past midnight, so its time is split between its own date and the next one.
 * An end time of 00:00 means midnight at the end of the plan's date.
 */
export function getPlanMinutesByDate(plan: Pick<Plan, "plan_date" | "start_time" | "end_time">) {
  const start = toMinutes(plan.start_time);
  const end = toMinutes(plan.end_time);
  if (end > start) return [{ date: plan.plan_date, minutes: end - start }];

  const parts = [{ date: plan.plan_date, minutes: DAY_MINUTES - start }];
  if (end > 0) parts.push({ date: nextDay(plan.plan_date), minutes: end });
  return parts;
}

/**
 * Time planned per member and category between from and to (yyyy-MM-dd, inclusive).
 *
 * `plans` should include plans from the day before `from`, so the after-midnight part of
 * overnight plans that started then is counted.
 */
export function summarizeTime(plans: AnalyticsPlan[], memberIds: Set<string>, from: string, to: string): TimeAnalytics {
  const minutes = new Map<string, Map<string, number>>();
  const categoryIds = new Set<string>();

  for (const plan of plans) {
    if (!memberIds.has(plan.created_by)) continue;
    for (const part of getPlanMinutesByDate(plan)) {
      if (part.date < from || part.date > to || part.minutes <= 0) continue;
      let byCategory = minutes.get(plan.created_by);
      if (!byCategory) {
        byCategory = new Map();
        minutes.set(plan.created_by, byCategory);
      }
      byCategory.set(plan.category_id, (byCategory.get(plan.category_id) ?? 0) + part.minutes);
      categoryIds.add(plan.category_id);
    }
  }

  return { minutes, categoryIds: [...categoryIds] };
}

export function formatDuration(totalMinutes: number) {
  const rounded = Math.round(totalMinutes);
  const hours = Math.floor(rounded / 60);
  const minutes = rounded % 60;
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours.toLocaleString()}h`;
  return `${hours.toLocaleString()}h ${minutes}m`;
}

export function formatShare(part: number, whole: number) {
  if (whole <= 0) return "0%";
  const share = (part / whole) * 100;
  if (share > 0 && share < 1) return "<1%";
  return `${Math.round(share)}%`;
}
