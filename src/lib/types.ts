export type Profile = {
  id: string;
  display_name: string;
  role: "member" | "admin";
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
  plan_date: string;
  start_time: string;
  end_time: string;
  created_by: string;
};

export type PositionedPlan = Plan & {
  left: number;
  width: number;
};
