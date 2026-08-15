export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      cities: {
        Row: {
          city: string
          created_at: string
          id: string
          latitude: number
          longitude: number
          metro: string | null
          population: number | null
          slug: string
          state: string
          updated_at: string
        }
        Insert: {
          city: string
          created_at?: string
          id?: string
          latitude: number
          longitude: number
          metro?: string | null
          population?: number | null
          slug: string
          state: string
          updated_at?: string
        }
        Update: {
          city?: string
          created_at?: string
          id?: string
          latitude?: number
          longitude?: number
          metro?: string | null
          population?: number | null
          slug?: string
          state?: string
          updated_at?: string
        }
        Relationships: []
      }
      city_metric_observations: {
        Row: {
          city_id: string
          created_at: string
          dimension: string
          id: string
          metric_key: string
          raw_value: number
          source_id: string
          unit: string
          updated_at: string
        }
        Insert: {
          city_id: string
          created_at?: string
          dimension: string
          id?: string
          metric_key: string
          raw_value: number
          source_id: string
          unit: string
          updated_at?: string
        }
        Update: {
          city_id?: string
          created_at?: string
          dimension?: string
          id?: string
          metric_key?: string
          raw_value?: number
          source_id?: string
          unit?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_metric_observations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "city_metric_observations_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "metric_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      city_metrics: {
        Row: {
          career_score: number | null
          city_id: string
          climate_score: number | null
          cost_score: number | null
          created_at: string
          education_score: number | null
          healthcare_score: number | null
          housing_score: number | null
          id: string
          median_income: number | null
          median_rent: number | null
          safety_score: number | null
          transport_score: number | null
          updated_at: string
        }
        Insert: {
          career_score?: number | null
          city_id: string
          climate_score?: number | null
          cost_score?: number | null
          created_at?: string
          education_score?: number | null
          healthcare_score?: number | null
          housing_score?: number | null
          id?: string
          median_income?: number | null
          median_rent?: number | null
          safety_score?: number | null
          transport_score?: number | null
          updated_at?: string
        }
        Update: {
          career_score?: number | null
          city_id?: string
          climate_score?: number | null
          cost_score?: number | null
          created_at?: string
          education_score?: number | null
          healthcare_score?: number | null
          housing_score?: number | null
          id?: string
          median_income?: number | null
          median_rent?: number | null
          safety_score?: number | null
          transport_score?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "city_metrics_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: true
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
        ]
      }
      metric_sources: {
        Row: {
          created_at: string
          dataset: string
          geography_level: string
          id: string
          key: string
          notes: string | null
          organization: string
          period: string
          retrieved_on: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          dataset: string
          geography_level: string
          id?: string
          key: string
          notes?: string | null
          organization: string
          period: string
          retrieved_on: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          dataset?: string
          geography_level?: string
          id?: string
          key?: string
          notes?: string | null
          organization?: string
          period?: string
          retrieved_on?: string
          updated_at?: string
          url?: string
        }
        Relationships: []
      }
      preferences: {
        Row: {
          career_weight: number
          climate_weight: number
          cost_weight: number
          created_at: string
          education_weight: number
          family_weight: number
          healthcare_weight: number
          housing_weight: number
          id: string
          profile_id: string
          safety_weight: number
          social_weight: number
          transport_weight: number
          updated_at: string
        }
        Insert: {
          career_weight?: number
          climate_weight?: number
          cost_weight?: number
          created_at?: string
          education_weight?: number
          family_weight?: number
          healthcare_weight?: number
          housing_weight?: number
          id?: string
          profile_id: string
          safety_weight?: number
          social_weight?: number
          transport_weight?: number
          updated_at?: string
        }
        Update: {
          career_weight?: number
          climate_weight?: number
          cost_weight?: number
          created_at?: string
          education_weight?: number
          family_weight?: number
          healthcare_weight?: number
          housing_weight?: number
          id?: string
          profile_id?: string
          safety_weight?: number
          social_weight?: number
          transport_weight?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          age_range: Database["public"]["Enums"]["age_range"]
          children: number
          created_at: string
          current_city: string
          current_state: string
          free_text_goals: string | null
          household_income: number
          household_size: number
          housing_budget: number
          id: string
          occupation: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          updated_at: string
          user_id: string
          work_preference: Database["public"]["Enums"]["work_preference"]
        }
        Insert: {
          age_range: Database["public"]["Enums"]["age_range"]
          children?: number
          created_at?: string
          current_city: string
          current_state: string
          free_text_goals?: string | null
          household_income: number
          household_size: number
          housing_budget: number
          id?: string
          occupation: string
          relationship_status: Database["public"]["Enums"]["relationship_status"]
          updated_at?: string
          user_id: string
          work_preference: Database["public"]["Enums"]["work_preference"]
        }
        Update: {
          age_range?: Database["public"]["Enums"]["age_range"]
          children?: number
          created_at?: string
          current_city?: string
          current_state?: string
          free_text_goals?: string | null
          household_income?: number
          household_size?: number
          housing_budget?: number
          id?: string
          occupation?: string
          relationship_status?: Database["public"]["Enums"]["relationship_status"]
          updated_at?: string
          user_id?: string
          work_preference?: Database["public"]["Enums"]["work_preference"]
        }
        Relationships: []
      }
      recommendations: {
        Row: {
          algorithm_version: string
          city_id: string
          created_at: string
          dream_score: number
          id: string
          profile_id: string
          rank: number
          reason_json: Json
        }
        Insert: {
          algorithm_version?: string
          city_id: string
          created_at?: string
          dream_score: number
          id?: string
          profile_id: string
          rank: number
          reason_json?: Json
        }
        Update: {
          algorithm_version?: string
          city_id?: string
          created_at?: string
          dream_score?: number
          id?: string
          profile_id?: string
          rank?: number
          reason_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "recommendations_city_id_fkey"
            columns: ["city_id"]
            isOneToOne: false
            referencedRelation: "cities"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recommendations_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      replace_recommendations: {
        Args: {
          p_algorithm_version: string
          p_profile_id: string
          p_rows: Json
        }
        Returns: number
      }
    }
    Enums: {
      age_range: "18-24" | "25-34" | "35-44" | "45-54" | "55-64" | "65+"
      relationship_status:
        | "single"
        | "partnered"
        | "married"
        | "divorced"
        | "widowed"
      work_preference: "remote" | "hybrid" | "onsite" | "flexible"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      age_range: ["18-24", "25-34", "35-44", "45-54", "55-64", "65+"],
      relationship_status: [
        "single",
        "partnered",
        "married",
        "divorced",
        "widowed",
      ],
      work_preference: ["remote", "hybrid", "onsite", "flexible"],
    },
  },
} as const

