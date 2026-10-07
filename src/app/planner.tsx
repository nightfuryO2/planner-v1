"use client";

import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
} from "date-fns";
import {
  CalendarCheck2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  LogOut,
  MapPin,
  Minus,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrowserSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Category, Plan, PositionedPlan, Profile, TeamUser } from "@/lib/types";

const HOUR_HEIGHT = 64;
const MIN_PLAN_HEIGHT = 22;
const TALL_PLAN_HEIGHT = 96;
const COLUMN_WIDTHS = [null, 200, 260, 340, 440] as const;
const COLUMN_WIDTH_STORAGE_KEY = "planner-column-width";
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MEMBER_COLORS = [
  "#3867F4",
  "#E8710A",
  "#0B8043",
  "#A142F4",
  "#D93025",
  "#00897B",
  "#C2185B",
  "#7CB342",
  "#F4B400",
  "#5C6BC0",
  "#795548",
  "#039BE5",
];

type PlanOverflow = {
  id: string;
  plans: Plan[];
  left: number;
  width: number;
  top: number;
  height: number;
};

type CalendarColumn = {
  key: string;
  day: Date;
  member: Profile | null;
  plans: Plan[];
};

type PlanDraft = {
  id?: string;
  title: string;
  details: string;
  category_id: string;
  custom_category: string;
  location: string;
  plan_date: string;
  start_time: string;
  end_time: string;
  created_by?: string;
  readOnly?: boolean;
  ownerName?: string;
};

type PlanHoverCard = {
  plan: Plan;
  top: number;
  left: number;
};

function formatTime(value: string) {
  const [hourString, minuteString] = value.split(":");
  const hour = Number(hourString);
  const minute = Number(minuteString);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return minute === 0 ? `${displayHour} ${suffix}` : `${displayHour}:${minuteString} ${suffix}`;
}

function formatTimeRange(start: string, end: string) {
  const startLabel = formatTime(start);
  const endLabel = formatTime(end);
  return startLabel.slice(-2) === endLabel.slice(-2)
    ? `${startLabel.slice(0, -3)}–${endLabel}`
    : `${startLabel}–${endLabel}`;
}

function formatDuration(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours && remainder) return `${hours}h ${remainder}m`;
  return hours ? `${hours}h` : `${remainder}m`;
}

function getInitials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 1).toUpperCase();
  return `${words[0][0]}${words[words.length - 1][0]}`.toUpperCase();
}

// Places plans at their scheduled time and size. Overlapping plans share the column
// in side-by-side lanes; beyond maxLanes, the remaining plans collapse into an overflow chip.
function layoutPlans(plans: Plan[], maxLanes: number) {
  const items = plans
    .map((plan) => {
      const top = (timeToMinutes(plan.start_time) / 60) * HOUR_HEIGHT;
      const bottom = Math.max((timeToMinutes(plan.end_time) / 60) * HOUR_HEIGHT, top + MIN_PLAN_HEIGHT);
      return { plan, top, bottom, lane: 0 };
    })
    .sort((first, second) => first.top - second.top || second.bottom - first.bottom);
  const positioned: PositionedPlan[] = [];
  const overflows: PlanOverflow[] = [];
  let cluster: typeof items = [];
  let clusterBottom = -1;

  const placeCluster = () => {
    const laneBottoms: number[] = [];
    for (const item of cluster) {
      const lane = laneBottoms.findIndex((bottom) => bottom <= item.top);
      item.lane = lane === -1 ? laneBottoms.length : lane;
      laneBottoms[item.lane] = item.bottom;
    }
    const laneCount = Math.min(laneBottoms.length, maxLanes);
    const visibleLanes = laneBottoms.length > maxLanes ? maxLanes - 1 : laneCount;
    const hidden: typeof items = [];

    for (const item of cluster) {
      if (item.lane >= visibleLanes) {
        hidden.push(item);
        continue;
      }
      let span = 1;
      while (
        item.lane + span < visibleLanes &&
        !cluster.some((other) =>
          other.lane === item.lane + span && other.top < item.bottom && other.bottom > item.top,
        )
      ) {
        span += 1;
      }
      positioned.push({
        ...item.plan,
        left: (item.lane / laneCount) * 100,
        width: (span / laneCount) * 100,
        top: item.top,
        height: item.bottom - item.top,
      });
    }

    if (hidden.length > 0) {
      const top = Math.min(...hidden.map((item) => item.top));
      const bottom = Math.max(...hidden.map((item) => item.bottom));
      overflows.push({
        id: hidden[0].plan.id,
        plans: hidden.map((item) => item.plan),
        left: (visibleLanes / laneCount) * 100,
        width: 100 / laneCount,
        top,
        height: bottom - top,
      });
    }
  };

  for (const item of items) {
    if (cluster.length > 0 && item.top >= clusterBottom) {
      placeCluster();
      cluster = [];
    }
    cluster.push(item);
    clusterBottom = Math.max(clusterBottom, item.bottom);
  }
  if (cluster.length > 0) placeCluster();

  return { positioned, overflows };
}

function timeToMinutes(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}

async function fetchPlannerData(
  client: SupabaseClient<Database>,
  currentUserId: string,
  rangeStart: string,
  rangeEnd: string,
) {
  try {
    const [profileResult, profilesResult, categoriesResult, plansResult] = await Promise.all([
      client
        .from("profiles")
        .select("id, display_name, role, is_test")
        .eq("id", currentUserId)
        .single(),
      client.from("profiles").select("id, display_name, role, is_test, created_at").order("display_name"),
      client.from("categories").select("id, name, color, active").order("name"),
      client
        .from("team_plans")
        .select("id, title, details, category_id, custom_category, location, plan_date, start_time, end_time, created_by")
        .gte("plan_date", rangeStart)
        .lte("plan_date", rangeEnd)
        .order("start_time"),
    ]);

    const error =
      profileResult.error ??
      profilesResult.error ??
      categoriesResult.error ??
      plansResult.error;
    if (error) return { data: null, error: error.message };

    return {
      data: {
        profile: profileResult.data as Profile,
        profiles: (profilesResult.data ?? []) as Profile[],
        categories: (categoriesResult.data ?? []) as Category[],
        plans: (plansResult.data ?? []) as Plan[],
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "Unable to load planner data.",
    };
  }
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const showTeamPage = pathname === "/team";
  const supabase = useMemo(
    () => (isSupabaseConfigured ? createBrowserSupabaseClient() : null),
    [],
  );
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(() => !isSupabaseConfigured);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [authBusy, setAuthBusy] = useState(false);
  const [authNotice, setAuthNotice] = useState("");
  const [authError, setAuthError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [visibleCategoryIds, setVisibleCategoryIds] = useState<Set<string> | null>(null);
  const [dataLoading, setDataLoading] = useState(true);
  const [pageError, setPageError] = useState("");
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<"day" | "week">("week");
  const [dayLayout, setDayLayout] = useState<"members" | "combined">("members");
  const [colorBy, setColorBy] = useState<"member" | "category">("member");
  const [columnWidthLevel, setColumnWidthLevel] = useState(() => {
    try {
      const stored = Number(window.localStorage.getItem(COLUMN_WIDTH_STORAGE_KEY));
      return Number.isInteger(stored) && stored > 0 && stored < COLUMN_WIDTHS.length ? stored : 0;
    } catch {
      return 0;
    }
  });
  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [planHoverCard, setPlanHoverCard] = useState<PlanHoverCard | null>(null);
  const [testProfileId, setTestProfileId] = useState("");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#4285F4");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState("");
  const [teamUserSearch, setTeamUserSearch] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const currentUserIdRef = useRef<string | null>(null);

  const visibleDays = useMemo(() => {
    if (view === "day") return [selectedDate];
    const firstDay = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: firstDay, end: addDays(firstDay, 6) });
  }, [selectedDate, view]);

  const rangeStart = format(visibleDays[0], "yyyy-MM-dd");
  const rangeEnd = format(visibleDays[visibleDays.length - 1], "yyyy-MM-dd");
  const isAdmin = profile?.role === "admin";
  const testProfile = profiles.find((member) => member.id === testProfileId && member.is_test) ?? null;
  const isPreviewMode = Boolean(isAdmin && testProfile);
  const activeProfile = isPreviewMode ? testProfile : profile;
  const canManage = Boolean(isAdmin && !isPreviewMode);

  function showPlanHoverCard(plan: Plan, target: HTMLButtonElement) {
    const rect = target.getBoundingClientRect();
    const cardWidth = Math.min(320, window.innerWidth - 24);
    const cardHeight = 240;
    const left = Math.max(
      12,
      Math.min(rect.left, window.innerWidth - cardWidth - 12),
    );
    const below = rect.bottom + 10;
    const top = below + cardHeight <= window.innerHeight - 12
      ? below
      : Math.max(12, rect.top - cardHeight - 10);
    setPlanHoverCard({ plan, top, left });
  }

  useEffect(() => {
    if (!supabase) return;

    let mounted = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      if (!mounted) return;
      if (error) setAuthError(error.message);
      setSession(data.session);
      setAuthReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      const nextUserId = nextSession?.user.id ?? null;
      if (currentUserIdRef.current !== nextUserId) {
        currentUserIdRef.current = nextUserId;
        setProfile(null);
        setProfiles([]);
        setTestProfileId("");
        setCategories([]);
        setPlans([]);
        setVisibleCategoryIds(null);
        setPageError("");
        setDataLoading(true);
      }
      setSession(nextSession);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    let mounted = true;
    void fetchPlannerData(supabase, session.user.id, rangeStart, rangeEnd).then((result) => {
      if (!mounted) return;
      setDataLoading(false);
      if (result.data === null) {
        setPageError(result.error);
        return;
      }
      setPageError("");
      setProfile(result.data.profile);
      setProfiles(result.data.profiles);
      setCategories(result.data.categories);
      setVisibleCategoryIds((current) =>
        current
          ? new Set([...current].filter((id) => result.data.categories.some((category) => category.id === id)))
          : null,
      );
      setPlans(result.data.plans);
    });
    return () => {
      mounted = false;
    };
  }, [rangeEnd, rangeStart, session?.user.id, supabase]);

  async function refreshPlanner(client: SupabaseClient<Database>, currentUserId: string) {
    setDataLoading(true);
    const result = await fetchPlannerData(client, currentUserId, rangeStart, rangeEnd);
    setDataLoading(false);
    if (result.data === null) {
      setPageError(result.error);
      return;
    }
    setPageError("");
    setProfile(result.data.profile);
    setProfiles(result.data.profiles);
    setCategories(result.data.categories);
    setVisibleCategoryIds((current) =>
      current
        ? new Set([...current].filter((id) => result.data.categories.some((category) => category.id === id)))
        : null,
    );
    setPlans(result.data.plans);
  }

  const loadTeamUsers = useCallback(async () => {
    if (!supabase || !profile) return;
    setTeamUsersLoading(true);
    setTeamUsersError("");
    try {
      if (canManage) {
        const { data, error } = await supabase.rpc("admin_list_users");
        if (error) setTeamUsersError(error.message);
        else setTeamUsers(data);
      } else {
        const { data, error } = await supabase
          .from("profiles")
          .select("id, display_name, role, is_test, created_at")
          .order("display_name");
        if (error) {
          setTeamUsersError(error.message);
        } else {
          setTeamUsers(data.map((user) => ({
            user_id: user.id,
            email: "",
            display_name: user.display_name,
            role: user.role,
            joined_at: user.created_at,
          })));
        }
      }
    } catch (error) {
      setTeamUsersError(error instanceof Error ? error.message : "Unable to load team members.");
    } finally {
      setTeamUsersLoading(false);
    }
  }, [canManage, profile, supabase]);

  useEffect(() => {
    if (showTeamPage && profile) {
      void Promise.resolve().then(loadTeamUsers);
    }
  }, [loadTeamUsers, profile, showTeamPage]);

  async function updateTeamUserRole(user: TeamUser) {
    if (!supabase || !canManage || !profile) return;
    const newRole = user.role === "admin" ? "boa" : "admin";
    setUpdatingUserId(user.user_id);
    setTeamUsersError("");
    try {
      const { error } = await supabase.rpc("admin_set_user_role", {
        target_user_id: user.user_id,
        new_role: newRole,
      });
      if (error) {
        setTeamUsersError(error.message);
      } else if (user.user_id === session?.user.id) {
        setProfile({ ...profile, role: newRole });
        router.push("/");
        setTeamUsers((current) =>
          current.map((entry) => entry.user_id === user.user_id ? { ...entry, role: newRole } : entry),
        );
      } else {
        setTeamUsers((current) =>
          current.map((entry) => entry.user_id === user.user_id ? { ...entry, role: newRole } : entry),
        );
      }
    } catch (error) {
      setTeamUsersError(error instanceof Error ? error.message : "Unable to update this user's role.");
    } finally {
      setUpdatingUserId(null);
    }
  }

  async function handleAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");
    const result =
      authMode === "signup"
        ? await supabase.auth.signUp({
            email,
            password,
            options: { data: { display_name: displayName.trim() } },
          })
        : await supabase.auth.signInWithPassword({ email, password });

    if (result.error) {
      setAuthError(result.error.message);
    } else if (authMode === "signup" && !result.data.session) {
      setAuthNotice("Check your email to confirm your account, then sign in.");
      setAuthMode("login");
    }
    setAuthBusy(false);
  }

  async function signOut() {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) setPageError(error.message);
  }

  function openNewPlan(startTime = "09:00", planDate = selectedDate, ownerId?: string) {
    const startMinutes = Math.floor(timeToMinutes(startTime) / 30) * 30;
    const start = `${String(Math.floor(startMinutes / 60)).padStart(2, "0")}:${String(startMinutes % 60).padStart(2, "0")}`;
    const endMinutes = Math.min(startMinutes + 60, 23 * 60 + 30);
    const end = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    setPlanDraft({
      title: "",
      details: "",
      category_id: categories.find((category) => category.active)?.id ?? "",
      custom_category: "",
      location: "",
      plan_date: format(planDate, "yyyy-MM-dd"),
      start_time: start,
      end_time: end,
      created_by: ownerId ?? activeProfile?.id ?? session?.user.id,
    });
  }

  function openExistingPlan(plan: Plan) {
    setPlanHoverCard(null);
    const canEdit = canManage || plan.created_by === activeProfile?.id;
    setSelectedDate(new Date(`${plan.plan_date}T00:00:00`));
    setPlanDraft({
      id: plan.id,
      title: plan.title,
      details: canEdit ? plan.details ?? "" : "",
      category_id: plan.category_id,
      custom_category: plan.custom_category ?? "",
      location: plan.location ?? "",
      plan_date: plan.plan_date,
      start_time: plan.start_time.slice(0, 5),
      end_time: plan.end_time.slice(0, 5),
      readOnly: !canEdit,
      ownerName: profileById.get(plan.created_by)?.display_name ?? "Team member",
    });
  }

  async function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session || !planDraft || planDraft.readOnly) return;

    if (!planDraft.title.trim()) {
      setPageError("Enter a plan name.");
      return;
    }
    if (!planDraft.category_id) {
      setPageError("Choose a category.");
      return;
    }
    if (!planDraft.plan_date || !planDraft.start_time || !planDraft.end_time) {
      setPageError("Choose a date, start time, and end time.");
      return;
    }
    if (!planDraft.location.trim()) {
      setPageError("Enter a location.");
      return;
    }
    if (planDraft.end_time <= planDraft.start_time) {
      setPageError("The end time must be later than the start time.");
      return;
    }

    const selectedCategory = categories.find((category) => category.id === planDraft.category_id);
    const isOtherCategory = selectedCategory?.name.trim().toLowerCase() === "other";
    if (isOtherCategory && !planDraft.custom_category.trim()) {
      setPageError("Enter a name for the other category.");
      return;
    }

    setPageError("");
    const values = {
      title: planDraft.title.trim(),
      details: planDraft.details.trim() || null,
      category_id: planDraft.category_id,
      custom_category: isOtherCategory ? planDraft.custom_category.trim() : null,
      location: planDraft.location.trim() || null,
      plan_date: planDraft.plan_date,
      start_time: planDraft.start_time,
      end_time: planDraft.end_time,
    };

    const result = planDraft.id
      ? await supabase.from("plans").update(values).eq("id", planDraft.id).select("id").single()
      : await supabase
          .from("plans")
          .insert({ ...values, created_by: canManage ? planDraft.created_by ?? session.user.id : activeProfile?.id ?? session.user.id })
          .select("id")
          .single();

    if (result.error) {
      setPageError(result.error.message);
      return;
    }
    setPlanDraft(null);
    await refreshPlanner(supabase, session.user.id);
  }

  async function deletePlan() {
    if (!supabase || !session || !planDraft?.id) return;
    setPageError("");
    const { error } = await supabase
      .from("plans")
      .delete()
      .eq("id", planDraft.id)
      .select("id")
      .single();
    if (error) {
      setPageError(error.message);
      return;
    }
    setPlanDraft(null);
    await refreshPlanner(supabase, session.user.id);
  }

  async function saveCategory(category: Category) {
    if (!supabase || !session || !canManage) return;
    setCategoryBusy(true);
    setPageError("");
    const { error } = await supabase
      .from("categories")
      .update({ name: category.name.trim(), color: category.color, active: category.active })
      .eq("id", category.id);
    if (error) {
      setPageError(error.message);
    } else {
      await refreshPlanner(supabase, session.user.id);
    }
    setCategoryBusy(false);
  }

  async function addCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session || !canManage) return;
    setCategoryBusy(true);
    setPageError("");
    const { data, error } = await supabase
      .from("categories")
      .insert({ name: newCategoryName.trim(), color: newCategoryColor, active: true })
      .select("id")
      .single();
    if (error) {
      setPageError(error.message);
    } else {
      setNewCategoryName("");
      setVisibleCategoryIds((current) => {
        const next = new Set(current ?? categories.map(({ id }) => id));
        next.add(data.id);
        return next;
      });
      await refreshPlanner(supabase, session.user.id);
    }
    setCategoryBusy(false);
  }

  function moveDate(direction: -1 | 1) {
    setSelectedDate((date) => {
      if (view === "day") return direction === 1 ? addDays(date, 1) : subDays(date, 1);
      return direction === 1 ? addDays(date, 7) : subDays(date, 7);
    });
  }

  function changeColumnWidth(direction: -1 | 1) {
    const next = Math.min(Math.max(columnWidthLevel + direction, 0), COLUMN_WIDTHS.length - 1);
    setColumnWidthLevel(next);
    try {
      window.localStorage.setItem(COLUMN_WIDTH_STORAGE_KEY, String(next));
    } catch {
      // The width preference is a convenience; the calendar works without storage.
    }
  }

  function toggleCategory(categoryId: string) {
    setVisibleCategoryIds((current) => {
      const next = new Set(current ?? categories.map(({ id }) => id));
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  }

  if (!isSupabaseConfigured) {
    return (
      <main className="setup-screen">
        <div className="setup-card">
          <div className="brand-mark"><CalendarCheck2 size={22} strokeWidth={2.1} /></div>
          <span className="eyebrow">TEAM PLANNER</span>
          <h1>Connect your workspace</h1>
          <p>
            The planner is ready to use once it is connected to your Supabase project. Add the
            project URL and public anon key to your local environment to enable sign-in and shared
            schedules.
          </p>
          <ol>
            <li>Create a Supabase project.</li>
            <li>Run <code>supabase/migrations/202610060001_initial_schema.sql</code> in its SQL editor.</li>
            <li>Copy <code>.env.example</code> to <code>.env.local</code> and fill in the project URL and anon key.</li>
          </ol>
          <div className="setup-note">No credentials are stored in the source code.</div>
        </div>
      </main>
    );
  }

  if (!authReady) {
    return <main className="loading-screen"><span className="spinner" />Loading your planner</main>;
  }

  if (!session) {
    return (
      <main className="auth-screen">
        <section className="auth-aside">
          <Link className="brand brand-light" href="/" aria-label="Team Planner home">
            <span className="brand-mark"><CalendarCheck2 size={21} strokeWidth={2.1} /></span>
            <span className="brand-name"><span>Team</span> <strong>Planner</strong></span>
          </Link>
          <div className="auth-pitch">
            <span className="eyebrow">A clearer day, together</span>
            <h1>Make time for<br />what matters.</h1>
            <p>See the shape of your team&apos;s day and make every plan easy to find.</p>
            <div className="preview-week" aria-hidden="true">
              <div className="preview-day"><span>MON</span><b>12</b><i className="preview-block blue" /><i className="preview-block green" /></div>
              <div className="preview-day active"><span>TUE</span><b>13</b><i className="preview-block purple" /><i className="preview-block amber" /><i className="preview-block blue" /></div>
              <div className="preview-day"><span>WED</span><b>14</b><i className="preview-block rose" /><i className="preview-block green" /></div>
            </div>
          </div>
          <span className="auth-footer">A shared view of the day, built for your team.</span>
        </section>
        <section className="auth-main">
          <div className="auth-card">
            <Link className="brand auth-mobile-brand" href="/" aria-label="Team Planner home">
              <span className="brand-mark"><CalendarCheck2 size={21} strokeWidth={2.1} /></span>
              <span className="brand-name"><span>Team</span> <strong>Planner</strong></span>
            </Link>
            <span className="eyebrow">{authMode === "login" ? "WELCOME BACK" : "GET STARTED"}</span>
            <h2>{authMode === "login" ? "Sign in to your planner" : "Create your account"}</h2>
            <p className="auth-subtitle">
              {authMode === "login" ? "Your team's plans are waiting for you." : "Join your team and start planning your day."}
            </p>
            {authNotice && <div className="notice" role="status">{authNotice}</div>}
            {authError && <div className="error-banner" role="alert">{authError}</div>}
            <form className="auth-form" onSubmit={handleAuth}>
              {authMode === "signup" && (
                <label>
                  Your name
                  <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" required maxLength={80} />
                </label>
              )}
              <label>
                Email address
                <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
              </label>
              <label>
                Password
                <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === "login" ? "current-password" : "new-password"} required minLength={8} />
                {authMode === "signup" && <small>Use at least 8 characters.</small>}
              </label>
              <button className="button button-primary auth-submit" disabled={authBusy}>
                {authBusy ? "Please wait..." : authMode === "login" ? "Sign in" : "Create account"}
              </button>
            </form>
            <p className="auth-switch">
              {authMode === "login" ? "New to your team planner?" : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => {
                  setAuthMode(authMode === "login" ? "signup" : "login");
                  setAuthError("");
                  setAuthNotice("");
                }}
              >
                {authMode === "login" ? "Create an account" : "Sign in"}
              </button>
            </p>
            <p className="auth-privacy">Your team&apos;s schedule is visible to signed-in members.</p>
          </div>
        </section>
      </main>
    );
  }

  const activeCategories = categories.filter((category) => category.active);
  const categoryById = new Map(categories.map((category) => [category.id, category]));
  const selectedCategory = categoryById.get(planDraft?.category_id ?? "");
  const isOtherCategory = selectedCategory?.name.trim().toLowerCase() === "other";
  const profileById = new Map(profiles.map((member) => [member.id, member]));
  const memberColorById = new Map(
    [...profiles]
      .sort((first, second) =>
        (first.created_at ?? "").localeCompare(second.created_at ?? "") || first.id.localeCompare(second.id),
      )
      .map((member, index) => [member.id, MEMBER_COLORS[index % MEMBER_COLORS.length]]),
  );
  const visiblePlans = plans.filter((plan) => visibleCategoryIds?.has(plan.category_id) ?? true);
  const selectedDayKey = format(selectedDate, "yyyy-MM-dd");
  const selectedDayPlans = visiblePlans.filter((plan) => plan.plan_date === selectedDayKey);
  const calendarMembers = profiles
    .filter((member) =>
      !member.is_test ||
      member.id === activeProfile?.id ||
      selectedDayPlans.some((plan) => plan.created_by === member.id),
    )
    .sort((first, second) =>
      Number(second.id === activeProfile?.id) - Number(first.id === activeProfile?.id) ||
      first.display_name.localeCompare(second.display_name),
    );
  const legendMembers = profiles.filter((member) => !member.is_test || isAdmin);
  const memberMode = view === "day" && dayLayout === "members" && calendarMembers.length > 0;
  const calendarColumns: CalendarColumn[] = memberMode
    ? calendarMembers.map((member) => ({
        key: member.id,
        day: selectedDate,
        member,
        plans: selectedDayPlans.filter((plan) => plan.created_by === member.id),
      }))
    : visibleDays.map((day) => ({
        key: day.toISOString(),
        day,
        member: null,
        plans: visiblePlans.filter((plan) => plan.plan_date === format(day, "yyyy-MM-dd")),
      }));
  const maxLanes = view === "day" && !memberMode ? 6 : 3;
  const multiColumn = view === "week" || memberMode;
  const columnWidth = multiColumn ? COLUMN_WIDTHS[columnWidthLevel] : null;
  const filteredTeamUsers = teamUsers.filter((user) => {
    const query = teamUserSearch.trim().toLowerCase();
    return !query ||
      user.display_name.toLowerCase().includes(query) ||
      user.email.toLowerCase().includes(query);
  });
  const adminCount = teamUsers.filter((user) => user.role === "admin").length;
  const calendarTitle =
    view === "day"
      ? format(selectedDate, "EEEE, MMMM d, yyyy")
      : rangeStart.slice(0, 7) === rangeEnd.slice(0, 7)
        ? `${format(visibleDays[0], "MMMM d")} – ${format(visibleDays[6], "d, yyyy")}`
        : `${format(visibleDays[0], "MMM d")} – ${format(visibleDays[6], "MMM d, yyyy")}`;

  return (
    <main className="planner-app">
      <header className="topbar">
        <Link className="topbar-brand" href="/" aria-label="Team Planner home">
          <span className="brand-mark"><CalendarCheck2 size={21} strokeWidth={2.1} /></span>
          <span className="brand-name"><span>Team</span> <strong>Planner</strong></span>
        </Link>
        <div className="topbar-controls">
          {!showTeamPage && (
            <>
              <button className="button button-outline today-button" onClick={() => setSelectedDate(new Date())}>Today</button>
              <div className="date-arrows">
                <button className="icon-button" aria-label="Previous dates" onClick={() => moveDate(-1)}><ChevronLeft size={20} /></button>
                <button className="icon-button" aria-label="Next dates" onClick={() => moveDate(1)}><ChevronRight size={20} /></button>
              </div>
            </>
          )}
          <h1 className="calendar-title">{showTeamPage ? "Team members" : calendarTitle}</h1>
        </div>
        <div className="topbar-actions">
          <button
            className={`admin-nav-button${showTeamPage ? " selected" : ""}`}
            onClick={() => router.push(showTeamPage ? "/" : "/team")}
            aria-current={showTeamPage ? "page" : undefined}
          >
            {showTeamPage ? <CalendarCheck2 size={17} /> : <UsersRound size={17} />}
            <span>{showTeamPage ? "Planner" : "Team"}</span>
          </button>
          {!showTeamPage && (
            <div className="view-switch" aria-label="Calendar view">
              <button className={view === "day" ? "selected" : ""} onClick={() => setView("day")}>Day</button>
              <button className={view === "week" ? "selected" : ""} onClick={() => setView("week")}>Week</button>
            </div>
          )}
          <button
            className="icon-button refresh-button"
            aria-label={showTeamPage ? "Refresh team members" : "Refresh schedule"}
            title={showTeamPage ? "Refresh team members" : "Refresh schedule"}
            disabled={showTeamPage ? teamUsersLoading : dataLoading}
            onClick={() => {
              if (showTeamPage) void loadTeamUsers();
              else if (supabase) void refreshPlanner(supabase, session.user.id);
            }}
          >
            <RefreshCw size={17} />
          </button>
          <div className="user-menu">
            <span className="user-avatar">{(activeProfile?.display_name || session.user.email || "T").slice(0, 1).toUpperCase()}</span>
            <span className="user-name">{activeProfile?.display_name || session.user.email}</span>
            {isPreviewMode ? (
              <span className="role-pill">BOA preview</span>
            ) : isAdmin ? (
              <span className="role-pill">Admin</span>
            ) : null}
            <button className="icon-button signout-button" aria-label="Sign out" title="Sign out" onClick={() => void signOut()}><LogOut size={18} /></button>
          </div>
          {isAdmin && (
            <label className="test-preview-control">
              <span>Preview BOA</span>
              <select
                aria-label="Preview the planner as a test BOA member"
                value={isPreviewMode ? testProfile?.id ?? "" : ""}
                onChange={(event) => {
                  setTestProfileId(event.target.value);
                  setCategoryManagerOpen(false);
                  setPlanDraft(null);
                }}
              >
                <option value="">Admin view</option>
                {profiles.filter((member) => member.is_test).map((member) => (
                  <option key={member.id} value={member.id}>{member.display_name}</option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      {!showTeamPage && <div className="mobile-date-bar">
        <button className="icon-button" aria-label="Previous dates" onClick={() => moveDate(-1)}><ChevronLeft size={20} /></button>
        <strong>{calendarTitle}</strong>
        <button className="mobile-today" onClick={() => setSelectedDate(new Date())}>Today</button>
        <button className="icon-button" aria-label="Next dates" onClick={() => moveDate(1)}><ChevronRight size={20} /></button>
      </div>}

      <div className="planner-body">
        {showTeamPage ? (
          <section className="team-admin-panel" aria-labelledby="team-admin-title">
            <div className="team-admin-heading">
              <div className="team-admin-title-group">
                <span className="team-admin-icon"><ShieldCheck size={22} /></span>
                <div>
                  <span className="eyebrow">ADMINISTRATION</span>
                  <h1 id="team-admin-title">Team members</h1>
                  <p>Manage access to your team&apos;s planner.</p>
                </div>
              </div>
              <div className="team-summary">
                <span><strong>{teamUsers.length}</strong> members</span>
                <span><strong>{adminCount}</strong> admins</span>
              </div>
            </div>

            <div className="team-admin-toolbar">
              <label className="team-search">
                <Search size={17} />
                <input
                  type="search"
                  value={teamUserSearch}
                  onChange={(event) => setTeamUserSearch(event.target.value)}
                  placeholder={canManage ? "Search by name or email" : "Search by name"}
                  aria-label="Search team members"
                />
              </label>
              <p>{canManage ? "Manage user access across the team." : "Team directory · read-only access"}</p>
            </div>

            {teamUsersError && <div className="team-admin-error" role="alert">{teamUsersError}</div>}
            <div className={`team-user-list${canManage ? " admin-user-list" : ""}`} aria-live="polite">
              <div className="team-user-list-head">
                <span>Member</span>
                <span>Access</span>
                <span>Joined</span>
                {canManage && <span>Manage access</span>}
              </div>
              {teamUsersLoading || !profile ? (
                <div className="team-user-empty"><span className="spinner" /> Loading team members</div>
              ) : filteredTeamUsers.length === 0 ? (
                <div className="team-user-empty">
                  {teamUsers.length === 0 ? "No team members found." : "No members match your search."}
                </div>
              ) : (
                filteredTeamUsers.map((user) => (
                  <article className="team-user-row" key={user.user_id}>
                    <div className="team-user-identity">
                      <span className={`team-user-avatar${user.role === "admin" ? " admin-avatar" : ""}`}>
                        {user.display_name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="team-user-names">
                        <strong>{user.display_name}{user.user_id === activeProfile?.id && <em>You</em>}</strong>
                        {user.email && <span>{user.email}</span>}
                      </span>
                    </div>
                    <span className={`team-role-badge ${user.role}`}>
                      {user.role === "admin" && <ShieldCheck size={13} />}
                      {user.role === "admin" ? "Admin" : "BOA"}
                    </span>
                    <time className="team-user-joined" dateTime={user.joined_at}>
                      {format(new Date(user.joined_at), "MMM d, yyyy")}
                    </time>
                    {canManage && <div className="team-user-action">
                      {user.role === "admin" && adminCount <= 1 ? (
                        <span className="last-admin-note">Last admin</span>
                      ) : (
                        <button
                          className={`button ${user.role === "admin" ? "button-outline" : "button-promote"}`}
                          disabled={updatingUserId !== null}
                          onClick={() => void updateTeamUserRole(user)}
                        >
                          {updatingUserId === user.user_id
                            ? "Updating..."
                            : user.role === "admin" ? "Make BOA" : "Make admin"}
                        </button>
                      )}
                    </div>}
                  </article>
                ))
              )}
            </div>
            <div className="team-admin-footnote">
              <ShieldCheck size={15} />
              <span>{canManage ? "Role changes take effect immediately and are enforced by the database." : "Only admins can change team access."}</span>
            </div>
          </section>
        ) : (
          <>
        <aside className="sidebar">
          <button className="button button-create" onClick={() => openNewPlan()}><Plus size={19} /> Create plan</button>
          <div className="mini-calendar">
            <div className="mini-calendar-head">
              <strong>{format(selectedDate, "MMMM yyyy")}</strong>
              <div>
                <button className="icon-button small-icon" aria-label="Previous month" onClick={() => setSelectedDate(subMonths(selectedDate, 1))}><ChevronLeft size={16} /></button>
                <button className="icon-button small-icon" aria-label="Next month" onClick={() => setSelectedDate(addMonths(selectedDate, 1))}><ChevronRight size={16} /></button>
              </div>
            </div>
            <div className="mini-grid mini-weekdays">
              {["M", "T", "W", "T", "F", "S", "S"].map((day, index) => <span className={index === 6 ? "sunday-weekday" : ""} key={`${day}-${index}`}>{day}</span>)}
            </div>
            <div className="mini-grid">
              {eachDayOfInterval({
                start: startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 }),
                end: endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 }),
              }).map((day) => (
                <button
                  key={day.toISOString()}
                  className={`mini-day${isSameDay(day, selectedDate) ? " selected" : ""}${!isSameMonth(day, selectedDate) ? " muted" : ""}${isSameDay(day, new Date()) ? " today" : ""}${day.getDay() === 0 ? " sunday" : ""}`}
                  onClick={() => setSelectedDate(day)}
                >
                  {format(day, "d")}
                </button>
              ))}
            </div>
          </div>
          <div className="sidebar-section display-section">
            <div className="sidebar-heading">
              <div>
                <h2>Display</h2>
                <p>Choose how plans are shown</p>
              </div>
            </div>
            <div className="display-option">
              <span>Color by</span>
              <div className="segmented-control" role="group" aria-label="Color plans by">
                <button className={colorBy === "member" ? "selected" : ""} aria-pressed={colorBy === "member"} onClick={() => setColorBy("member")}>Member</button>
                <button className={colorBy === "category" ? "selected" : ""} aria-pressed={colorBy === "category"} onClick={() => setColorBy("category")}>Category</button>
              </div>
            </div>
            {multiColumn && (
              <div className="display-option">
                <span>Column width</span>
                <div className="width-stepper" role="group" aria-label="Column width">
                  <button
                    className="icon-button small-icon"
                    aria-label="Narrower columns"
                    title="Narrower columns"
                    disabled={columnWidthLevel === 0}
                    onClick={() => changeColumnWidth(-1)}
                  >
                    <Minus size={15} />
                  </button>
                  <output aria-live="polite">{columnWidth ? `${columnWidth}px` : "Fit to screen"}</output>
                  <button
                    className="icon-button small-icon"
                    aria-label="Wider columns"
                    title="Wider columns"
                    disabled={columnWidthLevel === COLUMN_WIDTHS.length - 1}
                    onClick={() => changeColumnWidth(1)}
                  >
                    <Plus size={15} />
                  </button>
                </div>
              </div>
            )}
            {view === "day" && (
              <div className="display-option">
                <span>Day layout</span>
                <div className="segmented-control" role="group" aria-label="Day layout">
                  <button className={dayLayout === "members" ? "selected" : ""} aria-pressed={dayLayout === "members"} onClick={() => setDayLayout("members")}>By member</button>
                  <button className={dayLayout === "combined" ? "selected" : ""} aria-pressed={dayLayout === "combined"} onClick={() => setDayLayout("combined")}>Combined</button>
                </div>
              </div>
            )}
          </div>
          <div className="sidebar-section member-legend-section">
            <div className="sidebar-heading">
              <div>
                <h2>Team members</h2>
                <p>{colorBy === "member" ? "Each member's plans use their color" : "Initials mark who owns each plan"}</p>
              </div>
            </div>
            <div className="member-legend-list">
              {legendMembers.map((member) => (
                <div className="member-legend" key={member.id}>
                  <span className="member-avatar" style={{ backgroundColor: memberColorById.get(member.id) }}>{getInitials(member.display_name)}</span>
                  <span className="member-legend-name">{member.display_name}</span>
                  {member.id === activeProfile?.id && <em>You</em>}
                </div>
              ))}
            </div>
          </div>
          <div className="sidebar-section">
            <div className="sidebar-heading">
              <div>
                <h2>Plan categories</h2>
                <p>Filter the team schedule</p>
              </div>
              {canManage && <button className="icon-button small-icon" aria-label="Manage categories" title="Manage categories" onClick={() => setCategoryManagerOpen(true)}><Settings2 size={16} /></button>}
            </div>
            <div className="category-list">
              {categories.map((category) => (
                <label className={`category-filter${category.active ? "" : " inactive-filter"}`} key={category.id}>
                  <input
                    type="checkbox"
                    checked={visibleCategoryIds?.has(category.id) ?? true}
                    onChange={() => toggleCategory(category.id)}
                  />
                  <span className="category-dot" style={{ backgroundColor: category.color }} />
                  <span>{category.name}</span>
                </label>
              ))}
              {activeCategories.length === 0 && <p className="sidebar-empty">No active categories.</p>}
            </div>
          </div>
          <div className="sidebar-tip">
            <span className="tip-icon"><Plus size={16} /></span>
            <div>
              <strong>Quick add</strong>
              <p>Select any time slot to start a plan.</p>
            </div>
          </div>
        </aside>

        <section className="calendar-panel" aria-label={`${view} calendar`}>
          {pageError && (
            <div className="calendar-error" role="alert">
              <span>{pageError}</span><button className="icon-button small-icon" aria-label="Dismiss message" onClick={() => setPageError("")}><X size={16} /></button>
            </div>
          )}
          {profile === null && !dataLoading ? (
            <div className="calendar-state">
              <h2>Setting up your profile</h2>
              {pageError ? (
                <p className="calendar-state-error" role="alert">{pageError}</p>
              ) : (
                <p>If this continues, confirm the Supabase database migration has been run.</p>
              )}
              <button className="button button-outline" onClick={() => {
                if (supabase) void refreshPlanner(supabase, session.user.id);
              }}>Try again</button>
            </div>
          ) : (
            <div className="calendar-scroll">
              <div className={`calendar-grid ${view === "day" ? "day-view" : "week-view"}${memberMode ? " member-view" : ""}${columnWidth ? " fixed-columns" : ""}`} style={{ "--hour-height": `${HOUR_HEIGHT}px`, "--day-count": calendarColumns.length, "--column-width": `${columnWidth ?? 0}px` } as React.CSSProperties}>
                <div className="calendar-head">
                  <div className="timezone-head">GMT{new Date().getTimezoneOffset() <= 0 ? "+" : "−"}{String(Math.floor(Math.abs(new Date().getTimezoneOffset()) / 60)).padStart(2, "0")}:00</div>
                  {memberMode ? calendarColumns.map(({ key, member, plans: memberPlans }) => {
                    const plannedMinutes = memberPlans.reduce(
                      (total, plan) => total + timeToMinutes(plan.end_time) - timeToMinutes(plan.start_time),
                      0,
                    );
                    return (
                      <div className={`member-head${member?.id === activeProfile?.id ? " own-member" : ""}`} key={key}>
                        <span className="member-avatar" style={{ backgroundColor: memberColorById.get(member?.id ?? "") }}>{getInitials(member?.display_name ?? "")}</span>
                        <span className="member-head-text">
                          <strong>{member?.display_name}{member?.id === activeProfile?.id && <em>You</em>}</strong>
                          <small>
                            {memberPlans.length === 0
                              ? "No plans"
                              : `${memberPlans.length} ${memberPlans.length === 1 ? "plan" : "plans"} · ${formatDuration(plannedMinutes)}`}
                          </small>
                        </span>
                      </div>
                    );
                  }) : visibleDays.map((day) => (
                    <button
                      className={`day-head${isSameDay(day, new Date()) ? " current-day" : ""}${day.getDay() === 0 ? " sunday" : ""}`}
                      key={day.toISOString()}
                      onClick={() => {
                        setSelectedDate(day);
                        setView("day");
                      }}
                    >
                      <span>{format(day, "EEE")}</span>
                      <b>{format(day, "d")}</b>
                    </button>
                  ))}
                </div>
                <div className="calendar-grid-body">
                  <div className="time-gutter">
                    {HOURS.map((hour) => (
                      <div className={`hour-label${hour === 0 ? " midnight-label" : ""}`} key={hour}>
                        {format(new Date(2020, 0, 1, hour), "h a")}
                      </div>
                    ))}
                  </div>
                  {calendarColumns.map(({ key, day, member, plans: columnPlans }) => {
                    const { positioned, overflows } = layoutPlans(columnPlans, maxLanes);
                    const canCreateHere = !member ||
                      member.id === activeProfile?.id ||
                      (canManage && !member.is_test);
                    const columnClass = member
                      ? `day-column member-column${member.id === activeProfile?.id ? " own-member-column" : ""}`
                      : `day-column${isSameDay(day, new Date()) ? " current-day-column" : ""}${day.getDay() === 0 ? " sunday-column" : ""}`;
                    return (
                      <div className={columnClass} key={key}>
                        {HOURS.map((hour) => canCreateHere ? (
                          <button
                            className="hour-cell"
                            key={hour}
                            aria-label={`Add a plan${member && member.id !== activeProfile?.id ? ` for ${member.display_name}` : ""} at ${format(new Date(2020, 0, 1, hour), "h a")} on ${format(day, "EEEE, MMMM d")}`}
                            onClick={() => {
                              setSelectedDate(day);
                              setView("day");
                              openNewPlan(`${String(hour).padStart(2, "0")}:00`, day, member?.id);
                            }}
                          />
                        ) : (
                          <div className="hour-cell locked" key={hour} aria-hidden="true" />
                        ))}
                        {positioned.map((plan) => {
                          const category = categoryById.get(plan.category_id);
                          const owner = profileById.get(plan.created_by);
                          const ownPlan = plan.created_by === activeProfile?.id;
                          const categoryName = plan.custom_category || category?.name || "Category";
                          const ownerName = ownPlan ? "You" : owner?.display_name ?? "Team member";
                          const memberColor = memberColorById.get(plan.created_by) ?? "#9aa0a6";
                          const categoryColor = category?.color ?? "#9aa0a6";
                          const accentColor = colorBy === "member" ? memberColor : categoryColor;
                          const duration = formatDuration(timeToMinutes(plan.end_time) - timeToMinutes(plan.start_time));
                          return (
                            <button
                              className={`plan-block interactive${plan.height >= TALL_PLAN_HEIGHT ? " tall" : ""}${plan.height < 58 ? " compact" : ""}${plan.height < 40 ? " tiny" : ""}`}
                              key={plan.id}
                              style={{
                                top: `${plan.top}px`,
                                height: `${plan.height - 1}px`,
                                left: `calc(${plan.left}% + 2px)`,
                                width: `calc(${plan.width}% - 4px)`,
                                backgroundColor: `${accentColor}32`,
                                borderLeftColor: accentColor,
                                color: "#202124",
                              }}
                              onClick={() => openExistingPlan(plan)}
                              onMouseEnter={(event) => showPlanHoverCard(plan, event.currentTarget)}
                              onMouseLeave={() => setPlanHoverCard(null)}
                              onFocus={(event) => showPlanHoverCard(plan, event.currentTarget)}
                              onBlur={() => setPlanHoverCard(null)}
                              aria-label={`${plan.title}, ${categoryName}, ${ownerName}, ${formatTime(plan.start_time)} to ${formatTime(plan.end_time)}`}
                              aria-describedby={planHoverCard?.plan.id === plan.id ? "plan-hover-card" : undefined}
                            >
                              <span className="plan-title">{plan.title}</span>
                              <span className="plan-time">{formatTimeRange(plan.start_time, plan.end_time)}<span className="plan-duration"> · {duration}</span></span>
                              <span className="plan-identifiers">
                                <span className="plan-owner">
                                  <span className="plan-owner-initial" style={{ backgroundColor: memberColor }}>{getInitials(owner?.display_name ?? ownerName)}</span>
                                  <span className="plan-owner-name">{ownerName}</span>
                                </span>
                                <span className="plan-category">
                                  <span className="plan-category-dot" style={{ backgroundColor: categoryColor }} />
                                  <span className="plan-category-name">{categoryName}</span>
                                </span>
                              </span>
                            </button>
                          );
                        })}
                        {overflows.map((overflow) => {
                          const summary = overflow.plans
                            .map((plan) => `${plan.title} (${formatTime(plan.start_time)} – ${formatTime(plan.end_time)})`)
                            .join(", ");
                          return (
                            <button
                              className="plan-overflow"
                              key={overflow.id}
                              style={{
                                top: `${overflow.top}px`,
                                height: `${overflow.height - 1}px`,
                                left: `calc(${overflow.left}% + 2px)`,
                                width: `calc(${overflow.width}% - 4px)`,
                              }}
                              title={summary}
                              aria-label={`${overflow.plans.length} more ${overflow.plans.length === 1 ? "plan" : "plans"}: ${summary}`}
                              onClick={() => {
                                if (memberMode) {
                                  openExistingPlan(overflow.plans[0]);
                                  return;
                                }
                                setSelectedDate(day);
                                setView("day");
                                setDayLayout("members");
                              }}
                            >
                              +{overflow.plans.length}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              </div>
              {dataLoading && <div className="loading-overlay"><span className="spinner" />Updating calendar</div>}
            </div>
          )}
          <div className="mobile-create">
            <button className="button button-create" onClick={() => openNewPlan()}><Plus size={20} /> Create plan</button>
          </div>
        </section>
          </>
        )}
      </div>

      {planHoverCard && !planDraft && !categoryManagerOpen && (() => {
        const plan = planHoverCard.plan;
        const category = categoryById.get(plan.category_id);
        const ownerName = plan.created_by === activeProfile?.id
          ? "You"
          : profileById.get(plan.created_by)?.display_name ?? "Team member";
        const canSeeNotes = canManage || plan.created_by === activeProfile?.id;

        return (
          <div
            className="plan-hover-card"
            id="plan-hover-card"
            role="tooltip"
            style={{ top: planHoverCard.top, left: planHoverCard.left }}
          >
            <div className="plan-hover-heading">
              <span className="plan-hover-category-dot" style={{ backgroundColor: category?.color ?? "#9aa0a6" }} />
              <strong>{plan.title}</strong>
            </div>
            <span className="plan-hover-category">{plan.custom_category || category?.name || "Category"}</span>
            <div className="plan-hover-row">
              <Clock3 size={15} />
              <span>{format(new Date(`${plan.plan_date}T00:00:00`), "EEE, MMM d")} · {formatTime(plan.start_time)} – {formatTime(plan.end_time)}</span>
            </div>
            <div className="plan-hover-row">
              <span className="plan-hover-avatar" style={{ color: "#fff", backgroundColor: memberColorById.get(plan.created_by) ?? "#9aa0a6" }}>
                {getInitials(profileById.get(plan.created_by)?.display_name ?? ownerName)}
              </span>
              <span>{ownerName}</span>
            </div>
            {plan.location && (
              <div className="plan-hover-row">
                <MapPin size={15} />
                <span>{plan.location}</span>
              </div>
            )}
            {canSeeNotes && plan.details && (
              <p className="plan-hover-notes">{plan.details}</p>
            )}
          </div>
        );
      })()}

      {planDraft && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPlanDraft(null);
        }}>
          <section className="dialog" role="dialog" aria-modal="true" aria-labelledby="plan-dialog-title">
            <div className="dialog-header">
              <div>
                <span className="eyebrow">{planDraft.readOnly ? "TEAM SCHEDULE" : planDraft.id ? "UPDATE YOUR SCHEDULE" : "ADD TO YOUR SCHEDULE"}</span>
                <h2 id="plan-dialog-title">{planDraft.readOnly ? "Plan details" : planDraft.id ? "Edit plan" : "Create a plan"}</h2>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setPlanDraft(null)}><X size={20} /></button>
            </div>
            <p className="dialog-date">{format(new Date(`${planDraft.plan_date}T00:00:00`), "EEEE, MMMM d, yyyy")}</p>
            {planDraft.readOnly && <p className="plan-owner-row">Planned by <strong>{planDraft.ownerName}</strong></p>}
            <form className="plan-form" onSubmit={savePlan}>
              {!planDraft.id && canManage && (
                <label>
                  Create plan for
                  <select
                    value={planDraft.created_by ?? session.user.id}
                    onChange={(event) => setPlanDraft({ ...planDraft, created_by: event.target.value })}
                    required
                  >
                    {profiles.filter((member) => !member.is_test).map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.id === session.user.id ? `${member.display_name} (you)` : member.display_name}
                      </option>
                    ))}
                  </select>
                  <small>The selected member will own this plan and can edit it.</small>
                </label>
              )}
              <label>
                Plan name
                <input autoFocus value={planDraft.title} onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })} maxLength={100} required placeholder="e.g. Client visit" disabled={planDraft.readOnly} />
              </label>
              <label>
                Category
                <select value={planDraft.category_id} onChange={(event) => setPlanDraft({ ...planDraft, category_id: event.target.value, custom_category: "" })} required disabled={planDraft.readOnly}>
                  {categories.filter((category) => category.active || category.id === planDraft.category_id).map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? "" : " (inactive)"}</option>)}
                </select>
                {!planDraft.readOnly && activeCategories.length === 0 && <small>Ask an admin to add an active category.</small>}
              </label>
              {isOtherCategory && (
                <label>
                  Other category
                  <input
                    value={planDraft.custom_category}
                    onChange={(event) => setPlanDraft({ ...planDraft, custom_category: event.target.value })}
                    maxLength={40}
                    required
                    placeholder="e.g. Training"
                    disabled={planDraft.readOnly}
                  />
                </label>
              )}
              <div className="time-inputs">
                <label>Start time<input type="time" value={planDraft.start_time} onChange={(event) => setPlanDraft({ ...planDraft, start_time: event.target.value })} required disabled={planDraft.readOnly} /></label>
                <span className="time-separator">to</span>
                <label>End time<input type="time" value={planDraft.end_time} onChange={(event) => setPlanDraft({ ...planDraft, end_time: event.target.value })} required disabled={planDraft.readOnly} /></label>
              </div>
              {planDraft.readOnly ? (
                <div className="plan-notes-readonly">
                  <span>Location</span>
                  <p>{planDraft.location || "No location specified."}</p>
                </div>
              ) : (
                <label>
                  Location
                  <input
                    value={planDraft.location}
                    onChange={(event) => setPlanDraft({ ...planDraft, location: event.target.value })}
                    maxLength={120}
                    required
                    placeholder="Where will you be?"
                  />
                </label>
              )}
              {planDraft.readOnly ? (
                <div className="plan-notes-readonly">
                  <span>Notes</span>
                  <p>{planDraft.details || "Notes are only visible to the plan owner and admins."}</p>
                </div>
              ) : (
                <label>
                  Notes <span className="optional-label">Optional</span>
                  <textarea value={planDraft.details} onChange={(event) => setPlanDraft({ ...planDraft, details: event.target.value })} maxLength={500} rows={3} placeholder="Add a little more detail" />
                </label>
              )}
              <div className="dialog-actions">
                {planDraft.id && !planDraft.readOnly && <button className="button button-danger-outline" type="button" onClick={() => void deletePlan()}><Trash2 size={16} /> Delete</button>}
                <span className="dialog-spacer" />
                <button className="button button-outline" type="button" onClick={() => setPlanDraft(null)}>{planDraft.readOnly ? "Close" : "Cancel"}</button>
                {!planDraft.readOnly && <button className="button button-primary" type="submit">{planDraft.id ? "Save changes" : "Save plan"}</button>}
              </div>
            </form>
          </section>
        </div>
      )}

      {categoryManagerOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCategoryManagerOpen(false);
        }}>
          <section className="dialog category-dialog" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title">
            <div className="dialog-header">
              <div>
                <span className="eyebrow">ADMIN SETTINGS</span>
                <h2 id="category-dialog-title">Plan categories</h2>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setCategoryManagerOpen(false)}><X size={20} /></button>
            </div>
            <p className="dialog-date">Choose a color, rename, or deactivate a category.</p>
            <div className="admin-category-list">
              {categories.map((category) => (
                <CategoryEditor category={category} key={category.id} disabled={categoryBusy} onSave={saveCategory} />
              ))}
            </div>
            <form className="new-category-form" onSubmit={addCategory}>
              <h3>Add a category</h3>
              <div className="new-category-row">
                <input aria-label="New category name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} required maxLength={40} placeholder="Category name" />
                <input aria-label="New category color" type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} />
                <button className="button button-primary" disabled={categoryBusy}>Add</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

function CategoryEditor({
  category,
  disabled,
  onSave,
}: {
  category: Category;
  disabled: boolean;
  onSave: (category: Category) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [active, setActive] = useState(category.active);

  return (
    <form
      className={`category-editor${active ? "" : " inactive"}`}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ ...category, name: name.trim(), color, active });
      }}
    >
      <input className="color-picker" aria-label={`${name} color`} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      <input className="category-name-input" aria-label="Category name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={40} />
      <label className="category-active">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Active
      </label>
      <button className="button button-outline category-save" disabled={disabled || !name.trim()}>Save</button>
    </form>
  );
}
