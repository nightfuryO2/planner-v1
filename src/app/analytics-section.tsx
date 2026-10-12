"use client";

import {
  differenceInCalendarDays,
  endOfMonth,
  endOfWeek,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { ChartBarStacked, Download, Info, LayoutList, Table2 } from "lucide-react";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { formatDuration, formatShare, summarizeTime, type AnalyticsPlan } from "@/lib/time-analytics";
import type { Category, Profile } from "@/lib/types";

type AnalyticsSectionProps = {
  supabase: SupabaseClient<Database>;
  profiles: Profile[];
  categories: Category[];
  memberColorById: Map<string, string>;
  activeProfileId?: string;
  dataVersion: number;
  getInitials: (name: string) => string;
};

type DateRange = { from: string; to: string };

type FetchedPlans = {
  key: string;
  plans: AnalyticsPlan[];
  error: string;
};

type CategoryTotal = {
  id: string;
  name: string;
  color: string;
  minutes: number;
};

type Tooltip = {
  x: number;
  y: number;
  memberName: string;
  category: CategoryTotal;
  minutes: number;
  memberTotal: number;
};

const PAGE_SIZE = 1000;
const DAY_FORMAT = "yyyy-MM-dd";

function toRange(from: Date, to: Date): DateRange {
  return { from: format(from, DAY_FORMAT), to: format(to, DAY_FORMAT) };
}

function getPresets(today: Date) {
  const lastWeek = subWeeks(today, 1);
  const lastMonth = subMonths(today, 1);
  return [
    { label: "This week", range: toRange(startOfWeek(today, { weekStartsOn: 1 }), endOfWeek(today, { weekStartsOn: 1 })) },
    { label: "Last week", range: toRange(startOfWeek(lastWeek, { weekStartsOn: 1 }), endOfWeek(lastWeek, { weekStartsOn: 1 })) },
    { label: "This month", range: toRange(startOfMonth(today), endOfMonth(today)) },
    { label: "Last month", range: toRange(startOfMonth(lastMonth), endOfMonth(lastMonth)) },
  ];
}

function parseDay(value: string) {
  return new Date(`${value}T00:00:00`);
}

function formatRange({ from, to }: DateRange) {
  const start = parseDay(from);
  const end = parseDay(to);
  if (from === to) return format(start, "EEE, MMM d, yyyy");
  if (start.getFullYear() !== end.getFullYear()) return `${format(start, "MMM d, yyyy")} – ${format(end, "MMM d, yyyy")}`;
  return `${format(start, "MMM d")} – ${format(end, "MMM d, yyyy")}`;
}

function csvCell(value: string | number) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export default function AnalyticsSection({
  supabase,
  profiles,
  categories,
  memberColorById,
  activeProfileId,
  dataVersion,
  getInitials,
}: AnalyticsSectionProps) {
  const [range, setRange] = useState<DateRange>(() => toRange(startOfMonth(new Date()), endOfMonth(new Date())));
  const [fetched, setFetched] = useState<FetchedPlans | null>(null);
  const [hiddenCategoryIds, setHiddenCategoryIds] = useState<Set<string>>(() => new Set());
  const [view, setView] = useState<"chart" | "table">("chart");
  const [sortBy, setSortBy] = useState<"total" | "name">("total");
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);
  const chartRef = useRef<HTMLDivElement>(null);

  const fetchKey = `${range.from}|${range.to}|${dataVersion}`;

  // Overnight plans that start the day before the range still put time inside it.
  useEffect(() => {
    let mounted = true;
    const queryFrom = format(subDays(parseDay(range.from), 1), DAY_FORMAT);

    async function load() {
      const plans: AnalyticsPlan[] = [];
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error } = await supabase
          .from("team_plans")
          .select("id, category_id, plan_date, start_time, end_time, created_by")
          .gte("plan_date", queryFrom)
          .lte("plan_date", range.to)
          .order("plan_date")
          .order("id")
          .range(offset, offset + PAGE_SIZE - 1);
        if (error) return { plans, error: error.message };
        plans.push(...((data ?? []) as AnalyticsPlan[]));
        if (!data || data.length < PAGE_SIZE) return { plans, error: "" };
      }
    }

    void load().then((result) => {
      if (mounted) setFetched({ key: fetchKey, ...result });
    });
    return () => {
      mounted = false;
    };
  }, [fetchKey, range.from, range.to, supabase]);

  const loading = fetched?.key !== fetchKey;
  const plans = fetched?.plans ?? [];
  const members = profiles
    .filter((member) => !member.is_test)
    .sort((first, second) => first.display_name.localeCompare(second.display_name));
  const analytics = summarizeTime(plans, new Set(members.map((member) => member.id)), range.from, range.to);
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  // Ordered by overall time so hiding a category never reshuffles the others.
  const categoryTotals: CategoryTotal[] = analytics.categoryIds
    .map((id) => {
      const category = categoryById.get(id);
      let minutes = 0;
      for (const byCategory of analytics.minutes.values()) minutes += byCategory.get(id) ?? 0;
      return { id, name: category?.name ?? "Deleted category", color: category?.color ?? "#9aa0a6", minutes };
    })
    .sort((first, second) => second.minutes - first.minutes || first.name.localeCompare(second.name));
  const visibleCategories = categoryTotals.filter((category) => !hiddenCategoryIds.has(category.id));

  const memberRows = members
    .map((member) => {
      const byCategory = analytics.minutes.get(member.id);
      const segments = visibleCategories
        .map((category) => ({ category, minutes: byCategory?.get(category.id) ?? 0 }))
        .filter((segment) => segment.minutes > 0);
      return { member, segments, byCategory, total: segments.reduce((sum, segment) => sum + segment.minutes, 0) };
    })
    .sort((first, second) =>
      sortBy === "total" && second.total !== first.total
        ? second.total - first.total
        : first.member.display_name.localeCompare(second.member.display_name),
    );

  const teamTotal = visibleCategories.reduce((sum, category) => sum + category.minutes, 0);
  const activeMembers = memberRows.filter((row) => row.total > 0).length;
  const maxMemberTotal = Math.max(0, ...memberRows.map((row) => row.total));
  const topCategory = teamTotal > 0 ? visibleCategories[0] : undefined;
  const dayCount = differenceInCalendarDays(parseDay(range.to), parseDay(range.from)) + 1;
  const presets = getPresets(new Date());
  const rangeLabel = formatRange(range);
  const hasAnyTime = categoryTotals.length > 0;

  function toggleCategory(id: string) {
    setHiddenCategoryIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function updateRange(field: keyof DateRange, value: string) {
    if (!value) return;
    setRange((current) => {
      const next = { ...current, [field]: value };
      if (next.from > next.to) {
        if (field === "from") next.to = value;
        else next.from = value;
      }
      return next;
    });
  }

  function showTooltip(event: ReactPointerEvent, memberName: string, category: CategoryTotal, minutes: number, memberTotal: number) {
    const bounds = chartRef.current?.getBoundingClientRect();
    if (!bounds) return;
    const x = Math.min(Math.max(event.clientX - bounds.left, 100), bounds.width - 100);
    setTooltip({ x, y: event.clientY - bounds.top, memberName, category, minutes, memberTotal });
  }

  function exportCsv() {
    const header = ["Member", ...visibleCategories.map((category) => `${category.name} (hours)`), "Total (hours)"];
    const toHours = (minutes: number) => (minutes / 60).toFixed(2);
    const rows = memberRows.map((row) => [
      row.member.display_name,
      ...visibleCategories.map((category) => toHours(row.byCategory?.get(category.id) ?? 0)),
      toHours(row.total),
    ]);
    const footer = ["Team total", ...visibleCategories.map((category) => toHours(category.minutes)), toHours(teamTotal)];
    const csv = [header, ...rows, footer].map((line) => line.map(csvCell).join(",")).join("\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `time-by-category_${range.from}_to_${range.to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <section className="team-admin-panel summary-panel" id="analytics" aria-labelledby="analytics-title">
      <div className="team-admin-heading">
        <div className="team-admin-title-group">
          <span className="team-admin-icon"><ChartBarStacked size={22} /></span>
          <div>
            <span className="eyebrow">ANALYTICS</span>
            <h2 id="analytics-title">Time by category</h2>
            <p>Hours each member has planned, split by category.</p>
          </div>
        </div>
      </div>

      <div className="analytics-filters">
        <div className="analytics-presets" role="group" aria-label="Quick ranges">
          {presets.map((preset) => {
            const selected = preset.range.from === range.from && preset.range.to === range.to;
            return (
              <button key={preset.label} className={selected ? "selected" : ""} aria-pressed={selected} onClick={() => setRange(preset.range)}>
                {preset.label}
              </button>
            );
          })}
        </div>
        <div className="analytics-dates">
          <label>
            <span>From</span>
            <input type="date" value={range.from} max={range.to} onChange={(event) => updateRange("from", event.target.value)} />
          </label>
          <span className="analytics-dates-separator" aria-hidden="true">–</span>
          <label>
            <span>To</span>
            <input type="date" value={range.to} min={range.from} onChange={(event) => updateRange("to", event.target.value)} />
          </label>
        </div>
      </div>

      {fetched?.error && <p className="team-admin-error" role="alert">{fetched.error}</p>}

      <div className="summary-stats analytics-stats" aria-busy={loading}>
        <div className="summary-stat highlight">
          <span>Total time</span>
          <strong>{loading ? "–" : formatDuration(teamTotal)}</strong>
          <small>{rangeLabel} · {dayCount} {dayCount === 1 ? "day" : "days"}</small>
        </div>
        <div className="summary-stat">
          <span>Average per member</span>
          <strong>{loading || activeMembers === 0 ? "–" : formatDuration(teamTotal / activeMembers)}</strong>
          <small>{activeMembers} of {members.length} {members.length === 1 ? "member" : "members"} with plans</small>
        </div>
        <div className="summary-stat">
          <span>Top category</span>
          <strong className="analytics-stat-category">
            {!loading && topCategory ? (
              <>
                <i style={{ backgroundColor: topCategory.color }} aria-hidden="true" />
                <b>{topCategory.name}</b>
              </>
            ) : "–"}
          </strong>
          <small>{!loading && topCategory ? `${formatDuration(topCategory.minutes)} · ${formatShare(topCategory.minutes, teamTotal)} of total` : "No time planned yet"}</small>
        </div>
      </div>

      {loading ? (
        <div className="analytics-card"><div className="team-user-empty"><span className="spinner" /> Loading analytics</div></div>
      ) : !hasAnyTime ? (
        <div className="analytics-card">
          <div className="analytics-empty">
            <ChartBarStacked size={26} />
            <strong>No plans in this range</strong>
            <span>Pick a different range, or add plans in the calendar for {rangeLabel}.</span>
          </div>
        </div>
      ) : (
        <>
          <div className="analytics-card">
            <div className="analytics-card-head">
              <div>
                <h3>Team breakdown</h3>
                <p>Click a category to hide or show it. Totals update to match.</p>
              </div>
            </div>
            <div className="analytics-composition" role="img" aria-label={`Team time by category: ${visibleCategories.map((category) => `${category.name} ${formatDuration(category.minutes)}`).join(", ")}`}>
              {visibleCategories.map((category) => (
                <span key={category.id} style={{ flexBasis: `${(category.minutes / teamTotal) * 100}%`, backgroundColor: category.color }} />
              ))}
            </div>
            <ul className="analytics-legend">
              {categoryTotals.map((category) => {
                const hidden = hiddenCategoryIds.has(category.id);
                return (
                  <li key={category.id}>
                    <button className={hidden ? "hidden" : ""} aria-pressed={!hidden} onClick={() => toggleCategory(category.id)} title={hidden ? "Show category" : "Hide category"}>
                      <i style={{ backgroundColor: category.color }} aria-hidden="true" />
                      <span className="analytics-legend-name">{category.name}</span>
                      <strong>{formatDuration(category.minutes)}</strong>
                      <span className="analytics-legend-share">{hidden ? "Hidden" : formatShare(category.minutes, teamTotal)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="analytics-card">
            <div className="analytics-card-head">
              <div>
                <h3>By member</h3>
                <p>{view === "chart" ? "Hover a bar segment for details." : "Exact hours for each member and category."}</p>
              </div>
              <div className="analytics-toolbar">
                <label className="analytics-sort">
                  <span>Sort</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value as "total" | "name")}>
                    <option value="total">Most time</option>
                    <option value="name">Name</option>
                  </select>
                </label>
                <div className="analytics-view-toggle" role="group" aria-label="View">
                  <button className={view === "chart" ? "selected" : ""} aria-pressed={view === "chart"} onClick={() => setView("chart")}>
                    <LayoutList size={15} /> Chart
                  </button>
                  <button className={view === "table" ? "selected" : ""} aria-pressed={view === "table"} onClick={() => setView("table")}>
                    <Table2 size={15} /> Table
                  </button>
                </div>
                {view === "table" && (
                  <button className="button button-outline analytics-export" onClick={exportCsv}>
                    <Download size={15} /> CSV
                  </button>
                )}
              </div>
            </div>

            {view === "chart" ? (
              <div className="analytics-chart" ref={chartRef} onPointerLeave={() => setTooltip(null)}>
                {memberRows.map((row) => (
                  <div
                    className="analytics-row"
                    key={row.member.id}
                    tabIndex={0}
                    aria-label={`${row.member.display_name}: ${formatDuration(row.total)} total${row.segments.map((segment) => `, ${segment.category.name} ${formatDuration(segment.minutes)}`).join("")}`}
                  >
                    <span className="summary-member-name">
                      <span className="member-avatar" style={{ backgroundColor: memberColorById.get(row.member.id) }}>
                        {getInitials(row.member.display_name)}
                      </span>
                      <strong>{row.member.display_name}</strong>
                      {row.member.id === activeProfileId && <em>You</em>}
                    </span>
                    <span className="analytics-track" aria-hidden="true">
                      {row.segments.map((segment) => (
                        <span
                          key={segment.category.id}
                          className="analytics-segment"
                          style={{ flexBasis: `${(segment.minutes / maxMemberTotal) * 100}%`, backgroundColor: segment.category.color }}
                          onPointerMove={(event) => showTooltip(event, row.member.display_name, segment.category, segment.minutes, row.total)}
                        />
                      ))}
                    </span>
                    <span className={`analytics-row-total${row.total === 0 ? " empty" : ""}`}>
                      {row.total === 0 ? "No plans" : formatDuration(row.total)}
                    </span>
                  </div>
                ))}
                {tooltip && (
                  <div className="analytics-tooltip" style={{ left: tooltip.x, top: tooltip.y }} role="presentation">
                    <strong>{formatDuration(tooltip.minutes)}</strong>
                    <span className="analytics-tooltip-category">
                      <i style={{ backgroundColor: tooltip.category.color }} />
                      {tooltip.category.name}
                    </span>
                    <span>{formatShare(tooltip.minutes, tooltip.memberTotal)} of {tooltip.memberName}&apos;s time</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="analytics-table-wrap">
                <table className="analytics-table">
                  <thead>
                    <tr>
                      <th scope="col">Member</th>
                      {visibleCategories.map((category) => (
                        <th scope="col" key={category.id}>
                          <span className="analytics-th-category">
                            <i style={{ backgroundColor: category.color }} aria-hidden="true" />
                            {category.name}
                          </span>
                        </th>
                      ))}
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {memberRows.map((row) => (
                      <tr key={row.member.id}>
                        <th scope="row">
                          <span className="summary-member-name">
                            <span className="member-avatar" style={{ backgroundColor: memberColorById.get(row.member.id) }}>
                              {getInitials(row.member.display_name)}
                            </span>
                            <strong>{row.member.display_name}</strong>
                            {row.member.id === activeProfileId && <em>You</em>}
                          </span>
                        </th>
                        {visibleCategories.map((category) => {
                          const minutes = row.byCategory?.get(category.id) ?? 0;
                          return <td key={category.id} className={minutes === 0 ? "empty" : ""}>{minutes === 0 ? "—" : formatDuration(minutes)}</td>;
                        })}
                        <td className={`analytics-total-cell${row.total === 0 ? " empty" : ""}`}>{row.total === 0 ? "—" : formatDuration(row.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row">Team total</th>
                      {visibleCategories.map((category) => (
                        <td key={category.id}>{formatDuration(category.minutes)}</td>
                      ))}
                      <td className="analytics-total-cell">{formatDuration(teamTotal)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="team-admin-footnote">
        <Info size={15} />
        <span>Time comes from plan start and end times in the calendar. Plans that run past midnight are split between the two days.</span>
      </div>
    </section>
  );
}
