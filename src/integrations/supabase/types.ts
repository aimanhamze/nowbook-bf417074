export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bookings: {
        Row: {
          booking_date: string
          booking_time: string
          class_schedule_id: string | null
          created_at: string
          customer_name: string | null
          customer_phone: string | null
          guest_notes: string | null
          id: string
          provider_id: string
          service_ids: string[]
          status: string
          total_price: number
          treatment_notes: string | null
          updated_at: string
          user_id: string | null
        }
        Insert: {
          booking_date: string
          booking_time: string
          class_schedule_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          guest_notes?: string | null
          id?: string
          provider_id: string
          service_ids: string[]
          status?: string
          total_price: number
          treatment_notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          booking_date?: string
          booking_time?: string
          class_schedule_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_phone?: string | null
          guest_notes?: string | null
          id?: string
          provider_id?: string
          service_ids?: string[]
          status?: string
          total_price?: number
          treatment_notes?: string | null
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bookings_class_schedule_id_fkey"
            columns: ["class_schedule_id"]
            isOneToOne: false
            referencedRelation: "provider_class_schedule"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favorites: {
        Row: {
          created_at: string
          id: string
          provider_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          provider_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          provider_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "favorites_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          title: string
          type: string
          url: string | null
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          title: string
          type?: string
          url?: string | null
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          title?: string
          type?: string
          url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          phone: string | null
          preferred_lang: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          preferred_lang?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          phone?: string | null
          preferred_lang?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_availability: {
        Row: {
          break_end: string | null
          break_start: string | null
          day_of_week: number
          end_time: string
          id: string
          is_available: boolean
          provider_id: string
          start_time: string
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          day_of_week: number
          end_time?: string
          id?: string
          is_available?: boolean
          provider_id: string
          start_time?: string
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          day_of_week?: number
          end_time?: string
          id?: string
          is_available?: boolean
          provider_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_availability_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_blocked_dates: {
        Row: {
          blocked_date: string
          id: string
          provider_id: string
          reason: string | null
        }
        Insert: {
          blocked_date: string
          id?: string
          provider_id: string
          reason?: string | null
        }
        Update: {
          blocked_date?: string
          id?: string
          provider_id?: string
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_blocked_dates_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_class_schedule: {
        Row: {
          class_name: string
          class_type: string
          created_at: string | null
          day_of_week: number
          duration_minutes: number
          id: string
          is_active: boolean
          max_capacity: number
          provider_id: string
          start_time: string
          updated_at: string | null
        }
        Insert: {
          class_name: string
          class_type: string
          created_at?: string | null
          day_of_week: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          max_capacity?: number
          provider_id: string
          start_time: string
          updated_at?: string | null
        }
        Update: {
          class_name?: string
          class_type?: string
          created_at?: string | null
          day_of_week?: number
          duration_minutes?: number
          id?: string
          is_active?: boolean
          max_capacity?: number
          provider_id?: string
          start_time?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "provider_class_schedule_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_photos: {
        Row: {
          caption: string | null
          created_at: string | null
          id: string
          provider_id: string
          sort_order: number | null
          url: string
        }
        Insert: {
          caption?: string | null
          created_at?: string | null
          id?: string
          provider_id: string
          sort_order?: number | null
          url: string
        }
        Update: {
          caption?: string | null
          created_at?: string | null
          id?: string
          provider_id?: string
          sort_order?: number | null
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_photos_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_profiles: {
        Row: {
          about: string | null
          address: string | null
          avatar_image: string | null
          average_rating: number | null
          booking_window_days: number | null
          business_name: string
          category: string
          cover_image: string | null
          created_at: string
          deposit_message_template: string | null
          deposit_request_enabled: boolean
          id: string
          is_visible: boolean
          latitude: number | null
          longitude: number | null
          min_lead_time_minutes: number
          phone: string | null
          reminder_message_template: string | null
          requires_booking_approval: boolean
          show_prices: boolean
          social_links: Json | null
          treatment_notes_enabled: boolean
          updated_at: string
          user_id: string
        }
        Insert: {
          about?: string | null
          address?: string | null
          avatar_image?: string | null
          average_rating?: number | null
          booking_window_days?: number | null
          business_name?: string
          category?: string
          cover_image?: string | null
          created_at?: string
          deposit_message_template?: string | null
          deposit_request_enabled?: boolean
          id?: string
          is_visible?: boolean
          latitude?: number | null
          longitude?: number | null
          min_lead_time_minutes?: number
          phone?: string | null
          reminder_message_template?: string | null
          requires_booking_approval?: boolean
          show_prices?: boolean
          social_links?: Json | null
          treatment_notes_enabled?: boolean
          updated_at?: string
          user_id: string
        }
        Update: {
          about?: string | null
          address?: string | null
          avatar_image?: string | null
          average_rating?: number | null
          booking_window_days?: number | null
          business_name?: string
          category?: string
          cover_image?: string | null
          created_at?: string
          deposit_message_template?: string | null
          deposit_request_enabled?: boolean
          id?: string
          is_visible?: boolean
          latitude?: number | null
          longitude?: number | null
          min_lead_time_minutes?: number
          phone?: string | null
          reminder_message_template?: string | null
          requires_booking_approval?: boolean
          show_prices?: boolean
          social_links?: Json | null
          treatment_notes_enabled?: boolean
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      provider_services: {
        Row: {
          created_at: string
          duration: number
          id: string
          is_active: boolean
          latest_start_time: string | null
          max_capacity: number
          name: string
          price: number
          provider_id: string
          scheduled_time: string | null
          service_type: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration?: number
          id?: string
          is_active?: boolean
          latest_start_time?: string | null
          max_capacity?: number
          name: string
          price?: number
          provider_id: string
          scheduled_time?: string | null
          service_type?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration?: number
          id?: string
          is_active?: boolean
          latest_start_time?: string | null
          max_capacity?: number
          name?: string
          price?: number
          provider_id?: string
          scheduled_time?: string | null
          service_type?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_services_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_sessions: {
        Row: {
          created_at: string | null
          id: string
          provider_id: string
          service_id: string
          session_date: string
          session_time: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          provider_id: string
          service_id: string
          session_date: string
          session_time: string
        }
        Update: {
          created_at?: string | null
          id?: string
          provider_id?: string
          service_id?: string
          session_date?: string
          session_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_sessions_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "provider_sessions_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "provider_services"
            referencedColumns: ["id"]
          },
        ]
      }
      push_subscriptions: {
        Row: {
          auth: string
          created_at: string
          endpoint: string
          id: string
          p256dh: string
          user_id: string
        }
        Insert: {
          auth: string
          created_at?: string
          endpoint: string
          id?: string
          p256dh: string
          user_id: string
        }
        Update: {
          auth?: string
          created_at?: string
          endpoint?: string
          id?: string
          p256dh?: string
          user_id?: string
        }
        Relationships: []
      }
      reviews: {
        Row: {
          booking_id: string | null
          comment: string | null
          created_at: string
          display_name: string | null
          id: string
          provider_id: string
          rating: number
          user_id: string
        }
        Insert: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          provider_id: string
          rating: number
          user_id: string
        }
        Update: {
          booking_id?: string | null
          comment?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          provider_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reviews_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: true
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reviews_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_bookings_over_time: {
        Args: { p_from: string; p_to: string }
        Returns: {
          bookings_count: number
          day: string
        }[]
      }
      admin_dashboard_counts: {
        Args: never
        Returns: {
          bookings_last_week: number
          bookings_this_week: number
          bookings_today: number
          new_providers_this_week: number
          new_users_this_week: number
          pending_approval: number
          total_active_providers: number
          total_users: number
        }[]
      }
      admin_pending_bookings: {
        Args: never
        Returns: {
          booking_date: string
          booking_id: string
          booking_time: string
          business_name: string
          customer_name: string
          service_name: string
          status: string
        }[]
      }
      admin_provider_booking_counts: {
        Args: never
        Returns: {
          bookings_count: number
          business_name: string
          provider_id: string
        }[]
      }
      admin_provider_last_logins: {
        Args: never
        Returns: {
          last_sign_in_at: string
          user_id: string
        }[]
      }
      admin_recent_bookings: {
        Args: { p_limit?: number }
        Returns: {
          booking_date: string
          booking_id: string
          booking_time: string
          business_name: string
          customer_name: string
          service_name: string
          status: string
        }[]
      }
      admin_today_bookings: {
        Args: never
        Returns: {
          booking_date: string
          booking_id: string
          booking_time: string
          business_name: string
          customer_name: string
          service_name: string
          status: string
        }[]
      }
      booking_time_to_minutes: { Args: { _time: string }; Returns: number }
      get_display_name: { Args: { _user_id: string }; Returns: string }
      get_provider_busy_slots: {
        Args: { p_from_date: string; p_provider_id: string; p_to_date: string }
        Returns: {
          booking_date: string
          booking_time: string
          service_ids: string[]
        }[]
      }
      get_slot_capacity: {
        Args: {
          p_date: string
          p_provider_id: string
          p_service_id: string
          p_time: string
        }
        Returns: {
          available_spots: number
          booked_count: number
          is_full: boolean
          max_capacity: number
        }[]
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "provider" | "user"
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
      app_role: ["admin", "provider", "user"],
    },
  },
} as const
