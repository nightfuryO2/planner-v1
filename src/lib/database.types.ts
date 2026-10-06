type Table<Row, Insert, Update> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: Table<
        {
          id: string;
          display_name: string;
          role: "member" | "admin";
          created_at: string;
        },
        {
          id: string;
          display_name: string;
          role?: "member" | "admin";
          created_at?: string;
        },
        {
          id?: string;
          display_name?: string;
          role?: "member" | "admin";
          created_at?: string;
        }
      >;
      categories: Table<
        {
          id: string;
          name: string;
          color: string;
          active: boolean;
          created_at: string;
        },
        {
          id?: string;
          name: string;
          color: string;
          active?: boolean;
          created_at?: string;
        },
        {
          id?: string;
          name?: string;
          color?: string;
          active?: boolean;
          created_at?: string;
        }
      >;
      plans: Table<
        {
          id: string;
          title: string;
          details: string | null;
          category_id: string;
          plan_date: string;
          start_time: string;
          end_time: string;
          created_by: string;
          created_at: string;
          updated_at: string;
        },
        {
          id?: string;
          title: string;
          details?: string | null;
          category_id: string;
          plan_date: string;
          start_time: string;
          end_time: string;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        },
        {
          id?: string;
          title?: string;
          details?: string | null;
          category_id?: string;
          plan_date?: string;
          start_time?: string;
          end_time?: string;
          created_by?: string;
          created_at?: string;
          updated_at?: string;
        }
      >;
    };
    Views: {
      team_plans: {
        Row: {
          id: string;
          title: string;
          details: string | null;
          category_id: string;
          plan_date: string;
          start_time: string;
          end_time: string;
          created_by: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
