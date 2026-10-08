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
  ArrowRight,
  BookOpen,
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  CalendarSync,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Eye,
  LogOut,
  MapPin,
  Minus,
  Monitor,
  Moon,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  StickyNote,
  Sun,
  Tag,
  Trash2,
  Type,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import Link from "next/link";
import type { FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { RealtimeChannel, Session, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createBrowserSupabaseClient, isSupabaseConfigured } from "@/lib/supabase";
import type { Category, CategoryKind, Plan, PositionedPlan, Profile, TeamUser } from "@/lib/types";
import TeamSummaryView from "@/app/team-summary-view";

const HOUR_HEIGHT = 64;
const MIN_PLAN_HEIGHT = 22;
const TALL_PLAN_HEIGHT = 96;
const COLUMN_WIDTHS = [null, 200, 260, 340, 440] as const;
const COLUMN_WIDTH_STORAGE_KEY = "planner-column-width";
const THEME_STORAGE_KEY = "planner-theme";
const THEME_OPTIONS = [
  { value: "system", label: "System", Icon: Monitor },
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
] as const;

type ThemeMode = (typeof THEME_OPTIONS)[number]["value"];

const CATEGORY_KIND_OPTIONS: { value: CategoryKind; label: string }[] = [
  { value: "working", label: "Working" },
  { value: "comp_off", label: "Comp off" },
  { value: "holiday", label: "Holiday" },
  { value: "other", label: "Not counted" },
];

const PAGE_LINKS = [
  { href: "/", label: "Planner", Icon: CalendarCheck2 },
  { href: "/team", label: "Team", Icon: UsersRound },
  { href: "/team-summary", label: "Summary", Icon: CalendarSync },
] as const;
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

type PlanSegment = {
  plan: Plan;
  start: number;
  end: number;
  continuesFrom: boolean;
  continuesTo: boolean;
};

type CalendarColumn = {
  key: string;
  day: Date;
  member: Profile | null;
  segments: PlanSegment[];
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

// An end time earlier than the start time means the plan ends on the following day.
function isOvernight(start: string, end: string) {
  return timeToMinutes(end) < timeToMinutes(start);
}

function getPlanMinutes(start: string, end: string) {
  const minutes = timeToMinutes(end) - timeToMinutes(start);
  return minutes < 0 ? minutes + 24 * 60 : minutes;
}

// Splits plans into the part that falls on dayKey: plans starting that day, plus the
// after-midnight part of overnight plans that started the previous day.
function getDaySegments(plans: Plan[], dayKey: string, previousDayKey: string): PlanSegment[] {
  const segments: PlanSegment[] = [];
  for (const plan of plans) {
    const start = timeToMinutes(plan.start_time);
    const end = timeToMinutes(plan.end_time);
    const overnight = end < start;
    if (plan.plan_date === dayKey) {
      segments.push({ plan, start, end: overnight ? 24 * 60 : end, continuesFrom: false, continuesTo: overnight && end > 0 });
    } else if (overnight && end > 0 && plan.plan_date === previousDayKey) {
      segments.push({ plan, start: 0, end, continuesFrom: true, continuesTo: false });
    }
  }
  return segments;
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
function layoutPlans(segments: PlanSegment[], maxLanes: number) {
  const items = segments
    .map((segment) => {
      const dayBottom = 24 * HOUR_HEIGHT;
      const top = Math.min((segment.start / 60) * HOUR_HEIGHT, dayBottom - MIN_PLAN_HEIGHT);
      const bottom = Math.min(Math.max((segment.end / 60) * HOUR_HEIGHT, top + MIN_PLAN_HEIGHT), dayBottom);
      return { segment, plan: segment.plan, top, bottom, lane: 0 };
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
        continuesFrom: item.segment.continuesFrom,
        continuesTo: item.segment.continuesTo,
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
      fetchCategories(client),
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
        definitionsEnabled: categoriesResult.definitionsEnabled,
        kindsEnabled: categoriesResult.kindsEnabled,
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

function isMissingColumn(error: { code?: string; message?: string } | null) {
  return error?.code === "42703" || /does not exist/i.test(error?.message ?? "");
}

// Definitions (202610070005) and types (202610080002) come from migrations; until they run,
// load categories without those columns so the planner keeps working.
async function fetchCategories(client: SupabaseClient<Database>) {
  const full = await client.from("categories").select("id, name, color, active, description, kind").order("name");
  if (!isMissingColumn(full.error)) {
    return { data: full.data, error: full.error, definitionsEnabled: true, kindsEnabled: true };
  }

  const withoutKind = await client.from("categories").select("id, name, color, active, description").order("name");
  if (!isMissingColumn(withoutKind.error)) {
    return {
      data: withoutKind.data?.map((category) => ({ ...category, kind: "other" as const })) ?? null,
      error: withoutKind.error,
      definitionsEnabled: true,
      kindsEnabled: false,
    };
  }

  const basic = await client.from("categories").select("id, name, color, active").order("name");
  return {
    data: basic.data?.map((category) => ({ ...category, description: null, kind: "other" as const })) ?? null,
    error: basic.error,
    definitionsEnabled: false,
    kindsEnabled: false,
  };
}

export default function Home() {
  const pathname = usePathname();
  const router = useRouter();
  const showTeamPage = pathname === "/team";
  const showSummaryPage = pathname === "/team-summary";
  const showPlannerPage = !showTeamPage && !showSummaryPage;
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
  const [categoryFilterOpen, setCategoryFilterOpen] = useState(false);
  const [categoryGuideOpen, setCategoryGuideOpen] = useState(false);
  const [definitionsEnabled, setDefinitionsEnabled] = useState(true);
  const [kindsEnabled, setKindsEnabled] = useState(true);
  const [newCategoryKind, setNewCategoryKind] = useState<CategoryKind>("other");
  const [newCategoryName, setNewCategoryName] = useState("");
  const [newCategoryColor, setNewCategoryColor] = useState("#4285F4");
  const [newCategoryDescription, setNewCategoryDescription] = useState("");
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [teamUsers, setTeamUsers] = useState<TeamUser[]>([]);
  const [teamUsersLoading, setTeamUsersLoading] = useState(false);
  const [teamUsersError, setTeamUsersError] = useState("");
  const [teamUserSearch, setTeamUserSearch] = useState("");
  const [updatingUserId, setUpdatingUserId] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [themeMode, setThemeMode] = useState<ThemeMode>(() => {
    try {
      const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch {
      return "system";
    }
  });
  const [monthPlanDays, setMonthPlanDays] = useState<{ plan_date: string; category_id: string }[]>([]);
  const [dataVersion, setDataVersion] = useState(0);
  const currentUserIdRef = useRef<string | null>(null);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const liveChannelRef = useRef<RealtimeChannel | null>(null);
  const liveRefreshRef = useRef<() => void>(() => {});

  const visibleDays = useMemo(() => {
    if (view === "day") return [selectedDate];
    const firstDay = startOfWeek(selectedDate, { weekStartsOn: 1 });
    return eachDayOfInterval({ start: firstDay, end: addDays(firstDay, 6) });
  }, [selectedDate, view]);

  const rangeStart = format(visibleDays[0], "yyyy-MM-dd");
  // Overnight plans that start the day before the visible range still show after midnight.
  const fetchStart = format(subDays(visibleDays[0], 1), "yyyy-MM-dd");
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
    void fetchPlannerData(supabase, session.user.id, fetchStart, rangeEnd).then((result) => {
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
      setDefinitionsEnabled(result.data.definitionsEnabled);
      setKindsEnabled(result.data.kindsEnabled);
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
  }, [fetchStart, rangeEnd, session?.user.id, supabase]);

  // A silent refresh (from live updates) skips the loading indicator and keeps any current message.
  async function refreshPlanner(client: SupabaseClient<Database>, currentUserId: string, silent = false) {
    if (!silent) setDataLoading(true);
    const result = await fetchPlannerData(client, currentUserId, fetchStart, rangeEnd);
    if (!silent) setDataLoading(false);
    setDataVersion((version) => version + 1);
    if (result.data === null) {
      if (!silent) setPageError(result.error);
      return;
    }
    setPageError("");
    setProfile(result.data.profile);
    setProfiles(result.data.profiles);
    setCategories(result.data.categories);
    setDefinitionsEnabled(result.data.definitionsEnabled);
      setKindsEnabled(result.data.kindsEnabled);
    setVisibleCategoryIds((current) =>
      current
        ? new Set([...current].filter((id) => result.data.categories.some((category) => category.id === id)))
        : null,
    );
    setPlans(result.data.plans);
  }

  useEffect(() => {
    liveRefreshRef.current = () => {
      if (supabase && session?.user.id) void refreshPlanner(supabase, session.user.id, true);
    };
  });

  // Live updates: every open planner listens on a shared channel and quietly reloads when a
  // teammate saves a change. Returning to the tab also reloads, in case a message was missed.
  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => liveRefreshRef.current(), 400);
    };
    const channel = supabase
      .channel("planner-updates")
      .on("broadcast", { event: "changed" }, scheduleRefresh)
      .subscribe();
    liveChannelRef.current = channel;
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") scheduleRefresh();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      liveChannelRef.current = null;
      void supabase.removeChannel(channel);
    };
  }, [session?.user.id, supabase]);

  function announceChange() {
    void liveChannelRef.current?.send({ type: "broadcast", event: "changed", payload: {} });
  }

  const monthGridStart = format(startOfWeek(startOfMonth(selectedDate), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const monthGridEnd = format(endOfWeek(endOfMonth(selectedDate), { weekStartsOn: 1 }), "yyyy-MM-dd");

  useEffect(() => {
    if (!supabase || !session?.user.id) return;
    let mounted = true;
    void supabase
      .from("team_plans")
      .select("plan_date, category_id")
      .gte("plan_date", monthGridStart)
      .lte("plan_date", monthGridEnd)
      .then(({ data }) => {
        if (mounted && data) setMonthPlanDays(data);
      });
    return () => {
      mounted = false;
    };
  }, [dataVersion, monthGridEnd, monthGridStart, session?.user.id, supabase]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const applyTheme = () => {
      const dark = themeMode === "dark" || (themeMode === "system" && media.matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    applyTheme();
    if (themeMode !== "system") return;
    media.addEventListener("change", applyTheme);
    return () => media.removeEventListener("change", applyTheme);
  }, [themeMode]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (userMenuOpen) setUserMenuOpen(false);
      else if (categoryGuideOpen) setCategoryGuideOpen(false);
      else if (categoryManagerOpen) setCategoryManagerOpen(false);
      else if (planDraft) setPlanDraft(null);
      else setPlanHoverCard(null);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [categoryGuideOpen, categoryManagerOpen, planDraft, userMenuOpen]);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handlePointerDown(event: PointerEvent) {
      if (!userMenuRef.current?.contains(event.target as Node)) setUserMenuOpen(false);
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [userMenuOpen]);

  function changeTheme(mode: ThemeMode) {
    setThemeMode(mode);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // The theme still applies for this visit without storage.
    }
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
    setPageError("");
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
    setPageError("");
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
    if (planDraft.end_time === planDraft.start_time) {
      setPageError("The start and end times can't be the same.");
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
      setPageError(
        result.error.code === "23514" && isOvernight(planDraft.start_time, planDraft.end_time)
          ? "Overnight plans need the 202610080001_overnight_plans.sql migration. Ask an admin to run it in Supabase."
          : result.error.message,
      );
      return;
    }
    setPlanDraft(null);
    announceChange();
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
    announceChange();
    await refreshPlanner(supabase, session.user.id);
  }

  async function saveCategory(category: Category) {
    if (!supabase || !session || !canManage) return;
    setCategoryBusy(true);
    setPageError("");
    const { error } = await supabase
      .from("categories")
      .update({
        name: category.name.trim(),
        color: category.color,
        active: category.active,
        ...(definitionsEnabled ? { description: category.description?.trim() || null } : {}),
        ...(kindsEnabled ? { kind: category.kind } : {}),
      })
      .eq("id", category.id);
    if (error) {
      setPageError(error.message);
    } else {
      announceChange();
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
      .insert({
        name: newCategoryName.trim(),
        color: newCategoryColor,
        active: true,
        ...(definitionsEnabled ? { description: newCategoryDescription.trim() || null } : {}),
        ...(kindsEnabled ? { kind: newCategoryKind } : {}),
      })
      .select("id")
      .single();
    if (error) {
      setPageError(error.message);
    } else {
      setNewCategoryName("");
      setNewCategoryDescription("");
      setNewCategoryKind("other");
      setVisibleCategoryIds((current) => {
        const next = new Set(current ?? categories.map(({ id }) => id));
        next.add(data.id);
        return next;
      });
      announceChange();
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

  function openCategoryManager() {
    setCategoryGuideOpen(false);
    setCategoryManagerOpen(true);
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
  const visibleCategories = categories.filter((category) => visibleCategoryIds?.has(category.id) ?? true);
  const categoryFilterSummary =
    visibleCategories.length === categories.length
      ? "All categories"
      : visibleCategories.length === 0
        ? "None shown"
        : `${visibleCategories.length} of ${categories.length} shown`;
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
  const monthPlanDates = new Set(
    monthPlanDays
      .filter((plan) => visibleCategoryIds?.has(plan.category_id) ?? true)
      .map((plan) => plan.plan_date),
  );
  const selectedDayKey = format(selectedDate, "yyyy-MM-dd");
  const selectedDaySegments = getDaySegments(
    visiblePlans,
    selectedDayKey,
    format(subDays(selectedDate, 1), "yyyy-MM-dd"),
  );
  const calendarMembers = profiles
    .filter((member) =>
      !member.is_test ||
      member.id === activeProfile?.id ||
      selectedDaySegments.some(({ plan }) => plan.created_by === member.id),
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
        segments: selectedDaySegments.filter(({ plan }) => plan.created_by === member.id),
      }))
    : visibleDays.map((day) => ({
        key: day.toISOString(),
        day,
        member: null,
        segments: getDaySegments(visiblePlans, format(day, "yyyy-MM-dd"), format(subDays(day, 1), "yyyy-MM-dd")),
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
    <main className={`planner-app${showPlannerPage ? " calendar-mode" : ""}`}>
      <header className="topbar">
        <Link className="topbar-brand" href="/" aria-label="Team Planner home">
          <span className="brand-mark"><CalendarCheck2 size={21} strokeWidth={2.1} /></span>
          <span className="brand-name"><span>Team</span> <strong>Planner</strong></span>
        </Link>
        <div className="topbar-controls">
          {showPlannerPage && (
            <>
              <button className="button button-outline today-button" onClick={() => setSelectedDate(new Date())}>Today</button>
              <div className="date-arrows">
                <button className="icon-button" aria-label="Previous dates" onClick={() => moveDate(-1)}><ChevronLeft size={20} /></button>
                <button className="icon-button" aria-label="Next dates" onClick={() => moveDate(1)}><ChevronRight size={20} /></button>
              </div>
            </>
          )}
          <h1 className="calendar-title">{showTeamPage ? "Team members" : showSummaryPage ? "Team summary" : calendarTitle}</h1>
        </div>
        <div className="topbar-actions">
          <nav className="page-nav" aria-label="Pages">
            {PAGE_LINKS.map(({ href, label, Icon }) => {
              const current = pathname === href;
              return (
                <Link
                  className={`admin-nav-button${current ? " selected" : ""}`}
                  href={href}
                  key={href}
                  aria-current={current ? "page" : undefined}
                  aria-label={label}
                  title={label}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </Link>
              );
            })}
          </nav>
          {showPlannerPage && (
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
          <div className="user-menu" ref={userMenuRef}>
            <button
              className={`user-menu-trigger${userMenuOpen ? " open" : ""}`}
              aria-haspopup="menu"
              aria-expanded={userMenuOpen}
              aria-label="Account menu"
              onClick={() => setUserMenuOpen((open) => !open)}
            >
              <span className="user-avatar">{getInitials(activeProfile?.display_name || session.user.email || "T")}</span>
              <span className="user-name">{activeProfile?.display_name || session.user.email}</span>
              {isPreviewMode ? (
                <span className="role-pill preview">BOA preview</span>
              ) : isAdmin ? (
                <span className="role-pill">Admin</span>
              ) : null}
              <ChevronDown size={15} className="user-menu-chevron" />
            </button>
            {userMenuOpen && (
              <div className="user-menu-panel" role="menu" aria-label="Account">
                <div className="user-menu-header">
                  <span className="user-avatar">{getInitials(profile?.display_name || session.user.email || "T")}</span>
                  <span className="user-menu-identity">
                    <strong>{profile?.display_name || session.user.email}</strong>
                    <span>{session.user.email}</span>
                  </span>
                </div>
                {isAdmin && (
                  <div className="user-menu-section">
                    <span className="user-menu-label">View planner as</span>
                    {[{ id: "", display_name: "Admin (you)" }, ...profiles.filter((member) => member.is_test)].map((member) => {
                      const selected = (isPreviewMode ? testProfile?.id ?? "" : "") === member.id;
                      return (
                        <button
                          className={`user-menu-option${selected ? " selected" : ""}`}
                          role="menuitemradio"
                          aria-checked={selected}
                          key={member.id || "admin"}
                          onClick={() => {
                            setTestProfileId(member.id);
                            setCategoryManagerOpen(false);
                            setPlanDraft(null);
                            setUserMenuOpen(false);
                          }}
                        >
                          <span>{member.display_name}</span>
                          {selected && <Check size={15} />}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className="user-menu-section">
                  <span className="user-menu-label">Theme</span>
                  <div className="segmented-control theme-switch" role="group" aria-label="Theme">
                    {THEME_OPTIONS.map(({ value, label, Icon }) => (
                      <button
                        className={themeMode === value ? "selected" : ""}
                        aria-pressed={themeMode === value}
                        key={value}
                        onClick={() => changeTheme(value)}
                      >
                        <Icon size={14} /> {label}
                      </button>
                    ))}
                  </div>
                </div>
                <button className="user-menu-option sign-out" role="menuitem" onClick={() => void signOut()}>
                  <LogOut size={16} /> Sign out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {showPlannerPage && <div className="mobile-date-bar">
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
        ) : showSummaryPage ? (
          supabase && (
            <TeamSummaryView
              supabase={supabase}
              profiles={profiles}
              categories={categories}
              kindsEnabled={kindsEnabled}
              memberColorById={memberColorById}
              activeProfileId={activeProfile?.id}
              canManage={canManage}
              dataVersion={dataVersion}
              getInitials={getInitials}
              onManageCategories={openCategoryManager}
            />
          )
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
              }).map((day) => {
                const hasPlans = monthPlanDates.has(format(day, "yyyy-MM-dd"));
                return (
                  <button
                    key={day.toISOString()}
                    className={`mini-day${isSameDay(day, selectedDate) ? " selected" : ""}${!isSameMonth(day, selectedDate) ? " muted" : ""}${isSameDay(day, new Date()) ? " today" : ""}${day.getDay() === 0 ? " sunday" : ""}${hasPlans ? " has-plans" : ""}`}
                    aria-label={`${format(day, "EEEE, MMMM d")}${hasPlans ? ", has plans" : ""}`}
                    onClick={() => setSelectedDate(day)}
                  >
                    {format(day, "d")}
                  </button>
                );
              })}
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
          <div className="sidebar-section category-section">
            <div className="sidebar-heading">
              <div>
                <h2>Plan categories</h2>
                <p>Filter the team schedule</p>
              </div>
              {canManage && <button className="icon-button small-icon" aria-label="Manage categories" title="Manage categories" onClick={openCategoryManager}><Settings2 size={16} /></button>}
            </div>
            <button
              className={`category-dropdown-toggle${categoryFilterOpen ? " open" : ""}`}
              aria-expanded={categoryFilterOpen}
              aria-controls="category-filter-list"
              title={`${visibleCategories.length} of ${categories.length} categories shown`}
              onClick={() => setCategoryFilterOpen((open) => !open)}
            >
              <span className="category-dropdown-dots" aria-hidden="true">
                {visibleCategories.slice(0, 3).map((category) => (
                  <span key={category.id} style={{ backgroundColor: category.color }} />
                ))}
              </span>
              <span className="category-dropdown-label">{categoryFilterSummary}</span>
              <ChevronDown size={16} className="category-dropdown-chevron" />
            </button>
            {categoryFilterOpen && (
              <div className="category-dropdown-panel" id="category-filter-list">
                <div className="category-dropdown-actions">
                  <button disabled={visibleCategories.length === categories.length} onClick={() => setVisibleCategoryIds(null)}>Show all</button>
                  <button disabled={visibleCategories.length === 0} onClick={() => setVisibleCategoryIds(new Set())}>Hide all</button>
                </div>
                <div className="category-list">
                  {categories.map((category) => (
                    <label
                      className={`category-filter${category.active ? "" : " inactive-filter"}`}
                      key={category.id}
                      title={category.description ?? undefined}
                    >
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
            )}
            <button className="category-guide-button" onClick={() => setCategoryGuideOpen(true)}>
              <BookOpen size={15} />
              <span className="category-guide-label">Category definitions</span>
              <span className="category-guide-label-short">Definitions</span>
              <ChevronRight size={15} />
            </button>
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
                  {memberMode ? calendarColumns.map(({ key, member, segments: memberPlans }) => {
                    const plannedMinutes = memberPlans.reduce(
                      (total, segment) => total + segment.end - segment.start,
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
                  {calendarColumns.map(({ key, day, member, segments: columnSegments }) => {
                    const { positioned, overflows } = layoutPlans(columnSegments, maxLanes);
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
                          const duration = formatDuration(getPlanMinutes(plan.start_time, plan.end_time));
                          const nextDayNote = plan.continuesFrom ? " (continued from the previous day)" : plan.continuesTo ? " (continues the next day)" : "";
                          return (
                            <button
                              className={`plan-block interactive${plan.height >= TALL_PLAN_HEIGHT ? " tall" : ""}${plan.height < 58 ? " compact" : ""}${plan.height < 40 ? " tiny" : ""}${plan.continuesFrom ? " continues-from" : ""}${plan.continuesTo ? " continues-to" : ""}`}
                              key={`${plan.id}${plan.continuesFrom ? "-after-midnight" : ""}`}
                              style={{
                                top: `${plan.top}px`,
                                height: `${plan.height - 1}px`,
                                left: `calc(${plan.left}% + 2px)`,
                                width: `calc(${plan.width}% - 4px)`,
                                backgroundColor: `${accentColor}32`,
                                borderLeftColor: accentColor,
                              }}
                              onClick={() => openExistingPlan(plan)}
                              onMouseEnter={(event) => showPlanHoverCard(plan, event.currentTarget)}
                              onMouseLeave={() => setPlanHoverCard(null)}
                              onFocus={(event) => showPlanHoverCard(plan, event.currentTarget)}
                              onBlur={() => setPlanHoverCard(null)}
                              aria-label={`${plan.title}, ${categoryName}, ${ownerName}, ${formatTime(plan.start_time)} to ${formatTime(plan.end_time)}${nextDayNote}`}
                              aria-describedby={planHoverCard?.plan.id === plan.id ? "plan-hover-card" : undefined}
                            >
                              {(plan.continuesFrom || plan.continuesTo) && (
                                <span className="plan-overnight-badge" aria-hidden="true"><Moon size={10} strokeWidth={2.4} /></span>
                              )}
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

      {planHoverCard && !planDraft && !categoryManagerOpen && !categoryGuideOpen && (() => {
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
              <span>{format(new Date(`${plan.plan_date}T00:00:00`), "EEE, MMM d")} · {formatTime(plan.start_time)} – {formatTime(plan.end_time)}{isOvernight(plan.start_time, plan.end_time) ? " (next day)" : ""}</span>
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

      {planDraft && (() => {
        const draftCategory = categoryById.get(planDraft.category_id);
        const accentColor = draftCategory?.color ?? "#3867F4";
        const draftMinutes = getPlanMinutes(planDraft.start_time, planDraft.end_time);
        const draftOvernight = isOvernight(planDraft.start_time, planDraft.end_time);
        const HeaderIcon = planDraft.readOnly ? Eye : planDraft.id ? PencilLine : CalendarPlus;
        return (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setPlanDraft(null);
        }}>
          <section
            className="dialog plan-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="plan-dialog-title"
            style={{ "--plan-accent": accentColor } as React.CSSProperties}
          >
            <div className="dialog-header">
              <div className="plan-dialog-title">
                <span className="plan-dialog-icon"><HeaderIcon size={20} /></span>
                <div>
                  <span className="eyebrow">{planDraft.readOnly ? "TEAM SCHEDULE" : planDraft.id ? "UPDATE YOUR SCHEDULE" : "ADD TO YOUR SCHEDULE"}</span>
                  <h2 id="plan-dialog-title">{planDraft.readOnly ? "Plan details" : planDraft.id ? "Edit plan" : "Create a plan"}</h2>
                </div>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setPlanDraft(null)}><X size={20} /></button>
            </div>
            <div className="plan-dialog-meta">
              <span className="plan-dialog-chip"><CalendarDays size={14} />{format(new Date(`${planDraft.plan_date}T00:00:00`), "EEEE, MMMM d, yyyy")}</span>
              {planDraft.readOnly && <span className="plan-dialog-chip"><UserRound size={14} />Planned by <strong>{planDraft.ownerName}</strong></span>}
            </div>
            <form className="plan-form" onSubmit={savePlan}>
              {!planDraft.id && canManage && (
                <label>
                  <span className="field-label"><UserRound size={14} />Create plan for</span>
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
                <span className="field-label"><Type size={14} />Plan name</span>
                <input autoFocus value={planDraft.title} onChange={(event) => setPlanDraft({ ...planDraft, title: event.target.value })} maxLength={100} required placeholder="e.g. Client visit" disabled={planDraft.readOnly} />
              </label>
              <label>
                <span className="field-label"><Tag size={14} />Category</span>
                <span className="select-with-dot">
                  <span className="select-dot" style={{ backgroundColor: accentColor }} aria-hidden="true" />
                  <select value={planDraft.category_id} onChange={(event) => setPlanDraft({ ...planDraft, category_id: event.target.value, custom_category: "" })} required disabled={planDraft.readOnly}>
                    {categories.filter((category) => category.active || category.id === planDraft.category_id).map((category) => <option value={category.id} key={category.id}>{category.name}{category.active ? "" : " (inactive)"}</option>)}
                  </select>
                </span>
                {draftCategory?.description && <small className="category-hint">{draftCategory.description}</small>}
                {!planDraft.readOnly && activeCategories.length === 0 && <small>Ask an admin to add an active category.</small>}
              </label>
              {isOtherCategory && (
                <label>
                  <span className="field-label"><Tag size={14} />Other category</span>
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
              <div className="time-panel">
                <div className="time-inputs">
                  <label><span className="field-label"><Clock3 size={14} />Start time</span><input type="time" value={planDraft.start_time} onChange={(event) => setPlanDraft({ ...planDraft, start_time: event.target.value })} required disabled={planDraft.readOnly} /></label>
                  <span className="time-separator"><ArrowRight size={16} /></span>
                  <label><span className="field-label"><Clock3 size={14} />End time</span><input type="time" value={planDraft.end_time} onChange={(event) => setPlanDraft({ ...planDraft, end_time: event.target.value })} required disabled={planDraft.readOnly} /></label>
                </div>
                <p className={`time-duration${draftMinutes > 0 ? "" : " invalid"}`}>
                  {draftMinutes > 0 ? (
                    <>
                      Duration <strong>{formatDuration(draftMinutes)}</strong>
                      {draftOvernight && <span className="next-day-badge">Ends next day</span>}
                    </>
                  ) : "The start and end times can't be the same"}
                </p>
              </div>
              {planDraft.readOnly ? (
                <div className="plan-notes-readonly">
                  <span className="field-label"><MapPin size={14} />Location</span>
                  <p>{planDraft.location || "No location specified."}</p>
                </div>
              ) : (
                <label>
                  <span className="field-label"><MapPin size={14} />Location</span>
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
                  <span className="field-label"><StickyNote size={14} />Notes</span>
                  <p>{planDraft.details || "Notes are only visible to the plan owner and admins."}</p>
                </div>
              ) : (
                <label>
                  <span className="field-label"><StickyNote size={14} />Notes <span className="optional-label">Optional</span></span>
                  <textarea value={planDraft.details} onChange={(event) => setPlanDraft({ ...planDraft, details: event.target.value })} maxLength={500} rows={3} placeholder="Add a little more detail" />
                </label>
              )}
              {pageError && <p className="dialog-error" role="alert">{pageError}</p>}
              <div className="dialog-actions">
                {planDraft.id && !planDraft.readOnly && <button className="button button-danger-outline" type="button" onClick={() => void deletePlan()}><Trash2 size={16} /> Delete</button>}
                <span className="dialog-spacer" />
                <button className="button button-outline" type="button" onClick={() => setPlanDraft(null)}>{planDraft.readOnly ? "Close" : "Cancel"}</button>
                {!planDraft.readOnly && <button className="button button-primary" type="submit"><Check size={16} />{planDraft.id ? "Save changes" : "Save plan"}</button>}
              </div>
            </form>
          </section>
        </div>
        );
      })()}

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
            <p className="dialog-date">Choose a color, rename, define, set what it counts as, or deactivate a category.</p>
            {definitionsEnabled && !kindsEnabled && (
              <p className="category-migration-note">
                To set category types for the team summary, run <code>supabase/migrations/202610080002_category_kinds.sql</code> in the Supabase SQL editor.
              </p>
            )}
            {!definitionsEnabled && (
              <p className="category-migration-note">
                To add definitions, run <code>supabase/migrations/202610070005_category_definitions.sql</code> in the Supabase SQL editor.
              </p>
            )}
            {pageError && <p className="dialog-error" role="alert">{pageError}</p>}
            <div className="admin-category-list">
              {categories.map((category) => (
                <CategoryEditor
                  category={category}
                  key={category.id}
                  disabled={categoryBusy}
                  definitionsEnabled={definitionsEnabled}
                  kindsEnabled={kindsEnabled}
                  onSave={saveCategory}
                />
              ))}
            </div>
            <form className="new-category-form" onSubmit={addCategory}>
              <h3>Add a category</h3>
              <div className="new-category-row">
                <input aria-label="New category name" value={newCategoryName} onChange={(event) => setNewCategoryName(event.target.value)} required maxLength={40} placeholder="Category name" />
                <input aria-label="New category color" type="color" value={newCategoryColor} onChange={(event) => setNewCategoryColor(event.target.value)} />
                <button className="button button-primary" disabled={categoryBusy}>Add</button>
              </div>
              {definitionsEnabled && (
                <textarea
                  className="category-description-input"
                  aria-label="New category definition"
                  value={newCategoryDescription}
                  onChange={(event) => setNewCategoryDescription(event.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder="Definition — when should the team use this category?"
                />
              )}
              {kindsEnabled && (
                <label className="category-kind">
                  <span>Counts as</span>
                  <select aria-label="New category type" value={newCategoryKind} onChange={(event) => setNewCategoryKind(event.target.value as CategoryKind)}>
                    {CATEGORY_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              )}
            </form>
          </section>
        </div>
      )}

      {categoryGuideOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setCategoryGuideOpen(false);
        }}>
          <section className="dialog category-dialog" role="dialog" aria-modal="true" aria-labelledby="category-guide-title">
            <div className="dialog-header">
              <div>
                <span className="eyebrow">CATEGORY GUIDE</span>
                <h2 id="category-guide-title">Category definitions</h2>
              </div>
              <button className="icon-button" aria-label="Close dialog" onClick={() => setCategoryGuideOpen(false)}><X size={20} /></button>
            </div>
            <p className="dialog-date">What each category means, so the team labels plans the same way.</p>
            <dl className="category-guide-list">
              {categories.map((category) => (
                <div className={`category-guide-item${category.active ? "" : " inactive"}`} key={category.id}>
                  <dt>
                    <span className="category-dot" style={{ backgroundColor: category.color }} />
                    <span>{category.name}</span>
                    {!category.active && <em>Inactive</em>}
                    {kindsEnabled && category.kind !== "other" && (
                      <em className={`kind-${category.kind}`}>{CATEGORY_KIND_OPTIONS.find((option) => option.value === category.kind)?.label}</em>
                    )}
                  </dt>
                  <dd className={category.description ? "" : "empty"}>
                    {category.description || (canManage ? "No definition yet. Use Edit categories to add one." : "No definition yet.")}
                  </dd>
                </div>
              ))}
              {categories.length === 0 && <p className="sidebar-empty">No categories yet.</p>}
            </dl>
            <div className="dialog-actions">
              <span className="dialog-spacer" />
              {canManage && (
                <button className="button button-outline" onClick={openCategoryManager}>
                  <Settings2 size={16} /> Edit categories
                </button>
              )}
              <button className="button button-primary" onClick={() => setCategoryGuideOpen(false)}>Done</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function CategoryEditor({
  category,
  disabled,
  definitionsEnabled,
  kindsEnabled,
  onSave,
}: {
  category: Category;
  disabled: boolean;
  definitionsEnabled: boolean;
  kindsEnabled: boolean;
  onSave: (category: Category) => Promise<void>;
}) {
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [active, setActive] = useState(category.active);
  const [description, setDescription] = useState(category.description ?? "");
  const [kind, setKind] = useState<CategoryKind>(category.kind);

  return (
    <form
      className={`category-editor${active ? "" : " inactive"}`}
      onSubmit={(event) => {
        event.preventDefault();
        void onSave({ ...category, name: name.trim(), color, active, description: description.trim() || null, kind });
      }}
    >
      <input className="color-picker" aria-label={`${name} color`} type="color" value={color} onChange={(event) => setColor(event.target.value)} />
      <input className="category-name-input" aria-label="Category name" value={name} onChange={(event) => setName(event.target.value)} required maxLength={40} />
      <label className="category-active">
        <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
        Active
      </label>
      <button className="button button-outline category-save" disabled={disabled || !name.trim()}>Save</button>
      {kindsEnabled && (
        <label className="category-kind">
          <span>Counts as</span>
          <select aria-label={`${name} type`} value={kind} onChange={(event) => setKind(event.target.value as CategoryKind)}>
            {CATEGORY_KIND_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      )}
      {definitionsEnabled && (
        <textarea
          className="category-description-input"
          aria-label={`${name} definition`}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
          rows={2}
          placeholder="Definition — when should the team use this category?"
        />
      )}
    </form>
  );
}
