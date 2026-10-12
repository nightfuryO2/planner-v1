"use client";

import { CalendarSync, ChartBarStacked } from "lucide-react";
import AnalyticsSection from "@/app/analytics-section";
import CompOffSection, { type CompOffSectionProps } from "@/app/comp-off-section";

// Each section of the summary page. New sections go here and render below in this order.
const sections = [
  { id: "analytics", label: "Analytics", Icon: ChartBarStacked },
  { id: "comp-offs", label: "Comp offs", Icon: CalendarSync },
];

export default function TeamSummaryView(props: CompOffSectionProps) {
  return (
    <div className="summary-page">
      <header className="summary-page-header">
        <div>
          <span className="eyebrow">TEAM SUMMARY</span>
          <h1>Team summary</h1>
        </div>
        <nav className="summary-section-nav" aria-label="Summary sections">
          {sections.map(({ id, label, Icon }) => (
            <a key={id} href={`#${id}`}>
              <Icon size={15} /> {label}
            </a>
          ))}
        </nav>
      </header>
      <AnalyticsSection
        supabase={props.supabase}
        profiles={props.profiles}
        categories={props.categories}
        memberColorById={props.memberColorById}
        activeProfileId={props.activeProfileId}
        dataVersion={props.dataVersion}
        getInitials={props.getInitials}
      />
      <CompOffSection {...props} />
    </div>
  );
}
