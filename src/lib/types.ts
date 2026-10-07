export type Profile = {
  id: string;
  display_name: string;
  role: "boa" | "admin";
  is_test: boolean;
  created_at?: string;
};

export type TeamUser = {
  user_id: string;
  email: string;
  display_name: string;
  role: "boa" | "admin";
  joined_at: string;
};

export type Category = {
  id: string;
  name: string;
  color: string;
  active: boolean;
};

export type Plan = {
  id: string;
  title: string;
  details: string | null;
  category_id: string;
  custom_category: string | null;
  location: string | null;
  plan_date: string;
  start_time: string;
  end_time: string;
  created_by: string;
};

export type PositionedPlan = Plan & {
  left: number;
  width: number;
  displayTop: number;
  displayHeight: number;
  stacked: boolean;
};
