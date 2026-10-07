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
          role: "boa" | "admin";
          created_at: string;
        },
        {
          id: string;
          display_name: string;
          role?: "boa" | "admin";
          created_at?: string;
        },
        {
          id?: string;
          display_name?: string;
          role?: "boa" | "admin";
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
          custom_category: string | null;
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
          custom_category?: string | null;
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
          custom_category?: string | null;
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
          custom_category: string | null;
          plan_date: string;
          start_time: string;
          end_time: string;
          created_by: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      admin_list_users: {
        Args: Record<PropertyKey, never>;
        Returns: {
          user_id: string;
          email: string;
          display_name: string;
          role: "boa" | "admin";
          joined_at: string;
        }[];
      };
      admin_set_user_role: {
        Args: {
          target_user_id: string;
          new_role: "boa" | "admin";
        };
        Returns: undefined;
      };
      is_admin: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
