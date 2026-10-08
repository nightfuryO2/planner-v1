"use client";

import { addMonths, endOfMonth, format, startOfMonth, subMonths } from "date-fns";
import { CalendarSync, ChevronDown, ChevronLeft, ChevronRight, Info, Settings2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { summarizeCompOffs, type CompOffPlan } from "@/lib/comp-off-summary";
import type { Category, Profile } from "@/lib/types";

type TeamSummaryViewProps = {
  supabase: SupabaseClient<Database>;
  profiles: Profile[];
  categories: Category[];
  kindsEnabled: boolean;
  memberColorById: Map<string, string>;
  activeProfileId?: string;
  canManage: boolean;
  dataVersion: number;
  getInitials: (name: string) => string;
  onManageCategories: () => void;
};

type FetchedPlans = {
  key: string;
  plans: CompOffPlan[];
  error: string;
};

function formatBalance(value: number) {
  return value < 0 ? `−${Math.abs(value)}` : String(value);
}

export default function TeamSummaryView({
  supabase,
  profiles,
  categories,
  kindsEnabled,
  memberColorById,
  activeProfileId,
  canManage,
  dataVersion,
  getInitials,
  onManageCategories,
}: TeamSummaryViewProps) {
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [fetched, setFetched] = useState<FetchedPlans | null>(null);
  const [expandedMemberId, setExpandedMemberId] = useState<string | null>(null);

  const monthStart = format(month, "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(month), "yyyy-MM-dd");
  const countedCategoryIds = categories
    .filter((category) => category.kind !== "other")
    .map((category) => category.id)
    .sort();
  const countedIdsKey = countedCategoryIds.join(",");
  const hasWorking = categories.some((category) => category.kind === "working");
  const hasCompOff = categories.some((category) => category.kind === "comp_off");
  const fetchKey = `${monthEnd}|${countedIdsKey}|${dataVersion}`;

  // Comp offs never expire, so the balance needs every counted plan up to the end of the month.
  useEffect(() => {
    if (!countedIdsKey) return;
    let mounted = true;
    void supabase
      .from("team_plans")
      .select("id, title, category_id, plan_date, start_time, end_time, created_by")
      .lte("plan_date", monthEnd)
      .in("category_id", countedIdsKey.split(","))
      .then(({ data, error }) => {
        if (!mounted) return;
        setFetched({ key: fetchKey, plans: (data ?? []) as CompOffPlan[], error: error?.message ?? "" });
      });
    return () => {
      mounted = false;
    };
  }, [countedIdsKey, fetchKey, monthEnd, supabase]);

  const loading = countedCategoryIds.length > 0 && fetched?.key !== fetchKey;
  const plans = countedCategoryIds.length > 0 && fetched ? fetched.plans : [];
  const members = profiles
    .filter((member) => !member.is_test)
    .sort((first, second) => first.display_name.localeCompare(second.display_name));
  const summaries = summarizeCompOffs(plans, categories, members, monthStart, monthEnd);
  const totals = summaries.reduce(
    (sum, summary) => ({
      earned: sum.earned + summary.earned,
      taken: sum.taken + summary.taken,
      pending: sum.pending + summary.pending,
    }),
    { earned: 0, taken: 0, pending: 0 },
  );
  const today = format(new Date(), "yyyy-MM-dd");
  const monthLabel = format(month, "MMMM yyyy");

  return (
    <section className="team-admin-panel summary-panel" aria-labelledby="summary-title">
      <div className="team-admin-heading">
        <div className="team-admin-title-group">
          <span className="team-admin-icon"><CalendarSync size={22} /></span>
          <div>
            <span className="eyebrow">TEAM SUMMARY</span>
            <h1 id="summary-title">Comp offs</h1>
            <p>Earned by working on a Sunday or holiday. Unused comp offs carry over every month.</p>
          </div>
        </div>
        <div className="summary-month-picker" role="group" aria-label="Month">
          <button className="icon-button small-icon" aria-label="Previous month" onClick={() => setMonth((current) => subMonths(current, 1))}>
            <ChevronLeft size={18} />
          </button>
          <strong aria-live="polite">{monthLabel}</strong>
          <button className="icon-button small-icon" aria-label="Next month" onClick={() => setMonth((current) => addMonths(current, 1))}>
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {!kindsEnabled ? (
        <p className="category-migration-note summary-note">
          {canManage
            ? <>To count comp offs, run <code>supabase/migrations/202610080002_category_kinds.sql</code> in the Supabase SQL editor, then set category types in Manage categories.</>
            : "Comp off counts aren't set up yet. Ask an admin to finish the setup."}
        </p>
      ) : (!hasWorking || !hasCompOff) && (
        <div className="summary-setup-note">
          <Info size={16} />
          <span>
            {!hasWorking && !hasCompOff
              ? "No categories are marked as Working or Comp off yet."
              : !hasWorking
                ? "No categories are marked as Working, so Sunday and holiday work can't be counted."
                : "No category is marked as Comp off, so comp offs taken can't be counted."}
          </span>
          {canManage && (
            <button className="button button-outline" onClick={onManageCategories}>
              <Settings2 size={15} /> Set category types
            </button>
          )}
        </div>
      )}
      {fetched?.error && <p className="team-admin-error" role="alert">{fetched.error}</p>}

      <div className="summary-stats">
        <div className="summary-stat">
          <span>Earned in {format(month, "MMMM")}</span>
          <strong>{totals.earned}</strong>
        </div>
        <div className="summary-stat">
          <span>Taken in {format(month, "MMMM")}</span>
          <strong>{totals.taken}</strong>
        </div>
        <div className="summary-stat highlight">
          <span>Pending across the team</span>
          <strong>{formatBalance(totals.pending)}</strong>
        </div>
      </div>

      <div className="summary-table" aria-busy={loading}>
        <div className="summary-row summary-head" aria-hidden="true">
          <span>Member</span>
          <span>Carried in</span>
          <span>Earned</span>
          <span>Taken</span>
          <span>Pending</span>
          <span />
        </div>
        {loading ? (
          <div className="team-user-empty"><span className="spinner" /> Loading comp offs</div>
        ) : summaries.length === 0 ? (
          <div className="team-user-empty">No team members yet.</div>
        ) : (
          summaries.map((summary) => {
            const expanded = expandedMemberId === summary.member.id;
            return (
              <div className={`summary-member${expanded ? " expanded" : ""}`} key={summary.member.id}>
                <button
                  className="summary-row"
                  aria-expanded={expanded}
                  onClick={() => setExpandedMemberId(expanded ? null : summary.member.id)}
                >
                  <span className="summary-member-name">
                    <span className="member-avatar" style={{ backgroundColor: memberColorById.get(summary.member.id) }}>
                      {getInitials(summary.member.display_name)}
                    </span>
                    <strong>{summary.member.display_name}</strong>
                    {summary.member.id === activeProfileId && <em>You</em>}
                  </span>
                  <span className="summary-cell" data-label="Carried in">{formatBalance(summary.carriedIn)}</span>
                  <span className="summary-cell" data-label="Earned">{summary.earned > 0 ? `+${summary.earned}` : "0"}</span>
                  <span className="summary-cell" data-label="Taken">{summary.taken > 0 ? `−${summary.taken}` : "0"}</span>
                  <span className={`summary-cell summary-pending${summary.pending > 0 ? " positive" : summary.pending < 0 ? " negative" : ""}`} data-label="Pending">
                    {formatBalance(summary.pending)}
                  </span>
                  <ChevronDown size={16} className="summary-chevron" />
                </button>
                {expanded && (
                  <div className="summary-details">
                    {summary.events.length === 0 ? (
                      <p className="summary-details-empty">No comp offs earned or taken in {monthLabel}.</p>
                    ) : (
                      <ul>
                        {summary.events.map((event) => (
                          <li key={`${event.date}-${event.change}`}>
                            <span className={`summary-change ${event.change > 0 ? "earned" : "taken"}`}>
                              {event.change > 0 ? "+1" : "−1"}
                            </span>
                            <span className="summary-event-date">{format(new Date(`${event.date}T00:00:00`), "EEE, MMM d")}</span>
                            <span className="summary-event-reason">
                              {event.reason}
                              <small>{event.planTitles.join(", ")}</small>
                            </span>
                            {event.date > today && <span className="summary-planned">Planned</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                    {summary.carriedIn !== 0 && (
                      <p className="summary-details-note">
                        {summary.carriedIn > 0
                          ? `${summary.carriedIn} unused from earlier months.`
                          : `${Math.abs(summary.carriedIn)} taken in advance in earlier months.`}
                      </p>
                    )}
                    {summary.pending < 0 && (
                      <p className="summary-details-note">A negative balance means comp offs were taken before the Sunday or holiday they're for.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="team-admin-footnote">
        <Info size={15} />
        <span>Counts come from the plans in the calendar, based on each category&apos;s type in Manage categories.</span>
      </div>
    </section>
  );
}
