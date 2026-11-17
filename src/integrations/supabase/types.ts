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
      academy_course_sessions: {
        Row: {
          course_id: string
          created_at: string
          end_time: string
          id: string
          instructor_id: string
          period: unknown
          provider_id: string
          session_date: string
          start_time: string
        }
        Insert: {
          course_id: string
          created_at?: string
          end_time: string
          id?: string
          instructor_id: string
          period?: unknown
          provider_id: string
          session_date: string
          start_time: string
        }
        Update: {
          course_id?: string
          created_at?: string
          end_time?: string
          id?: string
          instructor_id?: string
          period?: unknown
          provider_id?: string
          session_date?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_course_sessions_course_instructor_fkey"
            columns: ["course_id", "instructor_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id", "instructor_id"]
          },
          {
            foreignKeyName: "academy_course_sessions_course_provider_fkey"
            columns: ["course_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      academy_courses: {
        Row: {
          address: string | null
          cancellation_hours: number
          created_at: string
          description: string | null
          id: string
          image_url: string | null
          instructor_id: string
          is_active: boolean
          location_type: string
          max_seats: number
          name: string
          online_url: string | null
          price: number | null
          provider_id: string
          updated_at: string
        }
        Insert: {
          address?: string | null
          cancellation_hours?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          instructor_id: string
          is_active?: boolean
          location_type: string
          max_seats: number
          name: string
          online_url?: string | null
          price?: number | null
          provider_id: string
          updated_at?: string
        }
        Update: {
          address?: string | null
          cancellation_hours?: number
          created_at?: string
          description?: string | null
          id?: string
          image_url?: string | null
          instructor_id?: string
          is_active?: boolean
          location_type?: string
          max_seats?: number
          name?: string
          online_url?: string | null
          price?: number | null
          provider_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_courses_instructor_same_branch_fkey"
            columns: ["instructor_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "academy_instructors"
            referencedColumns: ["id", "provider_id"]
          },
          {
            foreignKeyName: "academy_courses_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      academy_instructors: {
        Row: {
          bio: string | null
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          photo_url: string | null
          provider_id: string
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          photo_url?: string | null
          provider_id: string
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          photo_url?: string | null
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "academy_instructors_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      bookings: {
        Row: {
          booking_date: string
          booking_time: string
          check_in_at: string | null
          class_schedule_id: string | null
          created_at: string
          customer_name: string | null
          customer_notes: string | null
          customer_package_id: string | null
          customer_phone: string | null
          duration_override: number | null
          guest_notes: string | null
          id: string
          linked_user_id: string | null
          provider_id: string
          series_id: string | null
          service_ids: string[]
          staff_id: string | null
          status: string
          total_price: number
          treatment_notes: string | null
          updated_at: string
          user_id: string | null
          whatsapp_consent: boolean
        }
        Insert: {
          booking_date: string
          booking_time: string
          check_in_at?: string | null
          class_schedule_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_notes?: string | null
          customer_package_id?: string | null
          customer_phone?: string | null
          duration_override?: number | null
          guest_notes?: string | null
          id?: string
          linked_user_id?: string | null
          provider_id: string
          series_id?: string | null
          service_ids: string[]
          staff_id?: string | null
          status?: string
          total_price: number
          treatment_notes?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp_consent?: boolean
        }
        Update: {
          booking_date?: string
          booking_time?: string
          check_in_at?: string | null
          class_schedule_id?: string | null
          created_at?: string
          customer_name?: string | null
          customer_notes?: string | null
          customer_package_id?: string | null
          customer_phone?: string | null
          duration_override?: number | null
          guest_notes?: string | null
          id?: string
          linked_user_id?: string | null
          provider_id?: string
          series_id?: string | null
          service_ids?: string[]
          staff_id?: string | null
          status?: string
          total_price?: number
          treatment_notes?: string | null
          updated_at?: string
          user_id?: string | null
          whatsapp_consent?: boolean
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
            foreignKeyName: "bookings_customer_package_id_fkey"
            columns: ["customer_package_id"]
            isOneToOne: false
            referencedRelation: "customer_packages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "recurring_series"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bookings_staff_id_provider_id_fkey"
            columns: ["staff_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      course_push_log: {
        Row: {
          created_at: string
          event: string
          notification_id: string | null
          registration_id: string
        }
        Insert: {
          created_at?: string
          event: string
          notification_id?: string | null
          registration_id: string
        }
        Update: {
          created_at?: string
          event?: string
          notification_id?: string | null
          registration_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_push_log_registration_id_fkey"
            columns: ["registration_id"]
            isOneToOne: false
            referencedRelation: "course_registrations"
            referencedColumns: ["id"]
          },
        ]
      }
      course_registrations: {
        Row: {
          cancelled_by: string | null
          course_id: string
          created_at: string
          decided_at: string | null
          id: string
          provider_id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cancelled_by?: string | null
          course_id: string
          created_at?: string
          decided_at?: string | null
          id?: string
          provider_id: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cancelled_by?: string | null
          course_id?: string
          created_at?: string
          decided_at?: string | null
          id?: string
          provider_id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "course_registrations_course_provider_fkey"
            columns: ["course_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "academy_courses"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      customer_packages: {
        Row: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        Insert: {
          activated_at?: string | null
          created_at?: string | null
          customer_id: string
          entries_remaining: number
          expires_at?: string | null
          id?: string
          last_low_entry_notified_at?: string | null
          notes?: string | null
          provider_id: string
          purchased_at?: string | null
          status?: string
          template_id: string
          total_entries: number
          updated_at?: string | null
        }
        Update: {
          activated_at?: string | null
          created_at?: string | null
          customer_id?: string
          entries_remaining?: number
          expires_at?: string | null
          id?: string
          last_low_entry_notified_at?: string | null
          notes?: string | null
          provider_id?: string
          purchased_at?: string | null
          status?: string
          template_id?: string
          total_entries?: number
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "customer_packages_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customer_packages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "package_templates"
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
      otp_requests: {
        Row: {
          attempt_count: number
          code_hash: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          invalidated_at: string | null
          max_attempts: number
          otp_session_id: string
          phone_e164: string
          request_ip_hash: string | null
          send_count: number
          sent_at: string | null
          updated_at: string
          user_agent_hash: string | null
          verified_at: string | null
        }
        Insert: {
          attempt_count?: number
          code_hash: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          invalidated_at?: string | null
          max_attempts?: number
          otp_session_id: string
          phone_e164: string
          request_ip_hash?: string | null
          send_count?: number
          sent_at?: string | null
          updated_at?: string
          user_agent_hash?: string | null
          verified_at?: string | null
        }
        Update: {
          attempt_count?: number
          code_hash?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          invalidated_at?: string | null
          max_attempts?: number
          otp_session_id?: string
          phone_e164?: string
          request_ip_hash?: string | null
          send_count?: number
          sent_at?: string | null
          updated_at?: string
          user_agent_hash?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      package_templates: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          is_active: boolean | null
          name: string
          price: number
          provider_id: string
          total_entries: number
          updated_at: string | null
          validity_days: number
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name: string
          price: number
          provider_id: string
          total_entries: number
          updated_at?: string | null
          validity_days: number
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          is_active?: boolean | null
          name?: string
          price?: number
          provider_id?: string
          total_entries?: number
          updated_at?: string | null
          validity_days?: number
        }
        Relationships: [
          {
            foreignKeyName: "package_templates_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      package_usage_log: {
        Row: {
          action_type: string
          booking_id: string | null
          created_at: string | null
          customer_package_id: string
          entries_after: number
          entries_before: number
          id: string
          note: string | null
          performed_by: string | null
        }
        Insert: {
          action_type: string
          booking_id?: string | null
          created_at?: string | null
          customer_package_id: string
          entries_after: number
          entries_before: number
          id?: string
          note?: string | null
          performed_by?: string | null
        }
        Update: {
          action_type?: string
          booking_id?: string | null
          created_at?: string | null
          customer_package_id?: string
          entries_after?: number
          entries_before?: number
          id?: string
          note?: string | null
          performed_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "package_usage_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "package_usage_log_customer_package_id_fkey"
            columns: ["customer_package_id"]
            isOneToOne: false
            referencedRelation: "customer_packages"
            referencedColumns: ["id"]
          },
        ]
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
          color: string
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
          color?: string
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
          color?: string
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
      provider_date_overrides: {
        Row: {
          break_end: string | null
          break_start: string | null
          created_at: string
          end_time: string
          id: string
          is_available: boolean
          override_date: string
          provider_id: string
          start_time: string
        }
        Insert: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string
          end_time?: string
          id?: string
          is_available?: boolean
          override_date: string
          provider_id: string
          start_time?: string
        }
        Update: {
          break_end?: string | null
          break_start?: string | null
          created_at?: string
          end_time?: string
          id?: string
          is_available?: boolean
          override_date?: string
          provider_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_date_overrides_provider_id_fkey"
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
          allow_customer_reschedule: boolean
          availability_mode: string
          avatar_image: string | null
          average_rating: number | null
          booking_window_days: number | null
          business_name: string
          cancellation_notice_hours: number
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
          monthly_default_available: boolean
          monthly_default_end: string
          monthly_default_start: string
          phone: string | null
          reminder_message_template: string | null
          requires_booking_approval: boolean
          service_colors_enabled: boolean
          show_prices: boolean
          slot_interval_minutes: number
          social_links: Json | null
          staff_enabled: boolean
          treatment_notes_enabled: boolean
          updated_at: string
          user_id: string
          waitlist_enabled: boolean
          whatsapp_confirm_enabled: boolean
          whatsapp_message_language: string
          whatsapp_reminder_both: boolean
          whatsapp_reminder_enabled: boolean
          whatsapp_reminder_hours: number
        }
        Insert: {
          about?: string | null
          address?: string | null
          allow_customer_reschedule?: boolean
          availability_mode?: string
          avatar_image?: string | null
          average_rating?: number | null
          booking_window_days?: number | null
          business_name?: string
          cancellation_notice_hours?: number
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
          monthly_default_available?: boolean
          monthly_default_end?: string
          monthly_default_start?: string
          phone?: string | null
          reminder_message_template?: string | null
          requires_booking_approval?: boolean
          service_colors_enabled?: boolean
          show_prices?: boolean
          slot_interval_minutes?: number
          social_links?: Json | null
          staff_enabled?: boolean
          treatment_notes_enabled?: boolean
          updated_at?: string
          user_id: string
          waitlist_enabled?: boolean
          whatsapp_confirm_enabled?: boolean
          whatsapp_message_language?: string
          whatsapp_reminder_both?: boolean
          whatsapp_reminder_enabled?: boolean
          whatsapp_reminder_hours?: number
        }
        Update: {
          about?: string | null
          address?: string | null
          allow_customer_reschedule?: boolean
          availability_mode?: string
          avatar_image?: string | null
          average_rating?: number | null
          booking_window_days?: number | null
          business_name?: string
          cancellation_notice_hours?: number
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
          monthly_default_available?: boolean
          monthly_default_end?: string
          monthly_default_start?: string
          phone?: string | null
          reminder_message_template?: string | null
          requires_booking_approval?: boolean
          service_colors_enabled?: boolean
          show_prices?: boolean
          slot_interval_minutes?: number
          social_links?: Json | null
          staff_enabled?: boolean
          treatment_notes_enabled?: boolean
          updated_at?: string
          user_id?: string
          waitlist_enabled?: boolean
          whatsapp_confirm_enabled?: boolean
          whatsapp_message_language?: string
          whatsapp_reminder_both?: boolean
          whatsapp_reminder_enabled?: boolean
          whatsapp_reminder_hours?: number
        }
        Relationships: []
      }
      provider_services: {
        Row: {
          color: string
          created_at: string
          customer_notes_enabled: boolean | null
          customer_notes_placeholder: string | null
          duration: number
          id: string
          image_url: string | null
          is_active: boolean
          is_parallel: boolean
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
          color?: string
          created_at?: string
          customer_notes_enabled?: boolean | null
          customer_notes_placeholder?: string | null
          duration?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_parallel?: boolean
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
          color?: string
          created_at?: string
          customer_notes_enabled?: boolean | null
          customer_notes_placeholder?: string | null
          duration?: number
          id?: string
          image_url?: string | null
          is_active?: boolean
          is_parallel?: boolean
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
      provider_staff: {
        Row: {
          created_at: string
          display_order: number
          id: string
          is_active: boolean
          name: string
          provider_id: string
        }
        Insert: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name: string
          provider_id: string
        }
        Update: {
          created_at?: string
          display_order?: number
          id?: string
          is_active?: boolean
          name?: string
          provider_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "provider_staff_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      provider_staff_availability: {
        Row: {
          created_at: string
          day_of_week: number
          end_time: string
          is_available: boolean
          provider_id: string
          staff_id: string
          start_time: string
        }
        Insert: {
          created_at?: string
          day_of_week: number
          end_time?: string
          is_available?: boolean
          provider_id: string
          staff_id: string
          start_time?: string
        }
        Update: {
          created_at?: string
          day_of_week?: number
          end_time?: string
          is_available?: boolean
          provider_id?: string
          staff_id?: string
          start_time?: string
        }
        Relationships: [
          {
            foreignKeyName: "psa_staff_fkey"
            columns: ["staff_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      provider_staff_blocked_dates: {
        Row: {
          blocked_date: string
          created_at: string
          provider_id: string
          staff_id: string
        }
        Insert: {
          blocked_date: string
          created_at?: string
          provider_id: string
          staff_id: string
        }
        Update: {
          blocked_date?: string
          created_at?: string
          provider_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "psbd_staff_fkey"
            columns: ["staff_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      provider_staff_services: {
        Row: {
          created_at: string
          provider_id: string
          service_id: string
          staff_id: string
        }
        Insert: {
          created_at?: string
          provider_id: string
          service_id: string
          staff_id: string
        }
        Update: {
          created_at?: string
          provider_id?: string
          service_id?: string
          staff_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "pss_service_fkey"
            columns: ["service_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_services"
            referencedColumns: ["id", "provider_id"]
          },
          {
            foreignKeyName: "pss_staff_fkey"
            columns: ["staff_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id", "provider_id"]
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
      recurring_series: {
        Row: {
          booking_time: string
          created_at: string
          created_by: string
          id: string
          provider_id: string
          requested_count: number
          service_id: string | null
          staff_id: string | null
          weekday: number
        }
        Insert: {
          booking_time: string
          created_at?: string
          created_by?: string
          id?: string
          provider_id: string
          requested_count: number
          service_id?: string | null
          staff_id?: string | null
          weekday: number
        }
        Update: {
          booking_time?: string
          created_at?: string
          created_by?: string
          id?: string
          provider_id?: string
          requested_count?: number
          service_id?: string | null
          staff_id?: string | null
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "recurring_series_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_service_id_fkey"
            columns: ["service_id"]
            isOneToOne: false
            referencedRelation: "provider_services"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_staff_id_fkey"
            columns: ["staff_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id"]
          },
        ]
      }
      recurring_series_cancellations: {
        Row: {
          cancelled_count: number
          created_at: string
          created_by: string
          first_booking_id: string
          first_date: string
          id: string
          provider_id: string
          scope: string
          series_id: string
        }
        Insert: {
          cancelled_count: number
          created_at?: string
          created_by: string
          first_booking_id: string
          first_date: string
          id?: string
          provider_id: string
          scope: string
          series_id: string
        }
        Update: {
          cancelled_count?: number
          created_at?: string
          created_by?: string
          first_booking_id?: string
          first_date?: string
          id?: string
          provider_id?: string
          scope?: string
          series_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "recurring_series_cancellations_first_booking_id_fkey"
            columns: ["first_booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_cancellations_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "recurring_series_cancellations_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "recurring_series"
            referencedColumns: ["id"]
          },
        ]
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
      sendpulse_token_cache: {
        Row: {
          access_token: string
          expires_at: string
          id: number
          updated_at: string
        }
        Insert: {
          access_token: string
          expires_at: string
          id?: number
          updated_at?: string
        }
        Update: {
          access_token?: string
          expires_at?: string
          id?: number
          updated_at?: string
        }
        Relationships: []
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
      waitlist_entries: {
        Row: {
          created_at: string
          ended_at: string | null
          entry_date: string
          id: string
          last_notified_at: string | null
          notify_count: number
          notify_lang: string | null
          provider_id: string
          service_id: string
          staff_id: string | null
          status: string
          updated_at: string
          user_id: string
          wants_afternoon: boolean
          wants_evening: boolean
          wants_morning: boolean
        }
        Insert: {
          created_at?: string
          ended_at?: string | null
          entry_date: string
          id?: string
          last_notified_at?: string | null
          notify_count?: number
          notify_lang?: string | null
          provider_id: string
          service_id: string
          staff_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
          wants_afternoon?: boolean
          wants_evening?: boolean
          wants_morning?: boolean
        }
        Update: {
          created_at?: string
          ended_at?: string | null
          entry_date?: string
          id?: string
          last_notified_at?: string | null
          notify_count?: number
          notify_lang?: string | null
          provider_id?: string
          service_id?: string
          staff_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
          wants_afternoon?: boolean
          wants_evening?: boolean
          wants_morning?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_entries_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_entries_service_fk"
            columns: ["service_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_services"
            referencedColumns: ["id", "provider_id"]
          },
          {
            foreignKeyName: "waitlist_entries_staff_fk"
            columns: ["staff_id", "provider_id"]
            isOneToOne: false
            referencedRelation: "provider_staff"
            referencedColumns: ["id", "provider_id"]
          },
        ]
      }
      waitlist_events: {
        Row: {
          attempts: number
          booking_date: string | null
          booking_id: string | null
          booking_time: string | null
          change_kind: string | null
          claimed_at: string | null
          created_at: string
          duration_override: number | null
          id: number
          last_error: string | null
          new_status: string | null
          old_status: string | null
          outcome: string | null
          processed_at: string | null
          provider_id: string | null
          service_ids: string[] | null
          staff_id: string | null
        }
        Insert: {
          attempts?: number
          booking_date?: string | null
          booking_id?: string | null
          booking_time?: string | null
          change_kind?: string | null
          claimed_at?: string | null
          created_at?: string
          duration_override?: number | null
          id?: never
          last_error?: string | null
          new_status?: string | null
          old_status?: string | null
          outcome?: string | null
          processed_at?: string | null
          provider_id?: string | null
          service_ids?: string[] | null
          staff_id?: string | null
        }
        Update: {
          attempts?: number
          booking_date?: string | null
          booking_id?: string | null
          booking_time?: string | null
          change_kind?: string | null
          claimed_at?: string | null
          created_at?: string
          duration_override?: number | null
          id?: never
          last_error?: string | null
          new_status?: string | null
          old_status?: string | null
          outcome?: string | null
          processed_at?: string | null
          provider_id?: string | null
          service_ids?: string[] | null
          staff_id?: string | null
        }
        Relationships: []
      }
      waitlist_send_log: {
        Row: {
          created_at: string
          error_code: string | null
          event_id: number | null
          freed_booking_id: string | null
          id: string
          language_code: string | null
          message_kind: string
          missing_message_id: boolean
          phone_digits: string | null
          provider_id: string | null
          sendpulse_message_id: string | null
          slot_date: string | null
          slot_time: string | null
          status: string
          template_name: string | null
          updated_at: string
          waitlist_entry_id: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          event_id?: number | null
          freed_booking_id?: string | null
          id?: string
          language_code?: string | null
          message_kind: string
          missing_message_id?: boolean
          phone_digits?: string | null
          provider_id?: string | null
          sendpulse_message_id?: string | null
          slot_date?: string | null
          slot_time?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          waitlist_entry_id: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          event_id?: number | null
          freed_booking_id?: string | null
          id?: string
          language_code?: string | null
          message_kind?: string
          missing_message_id?: boolean
          phone_digits?: string | null
          provider_id?: string | null
          sendpulse_message_id?: string | null
          slot_date?: string | null
          slot_time?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
          waitlist_entry_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "waitlist_send_log_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "waitlist_send_log_waitlist_entry_id_fkey"
            columns: ["waitlist_entry_id"]
            isOneToOne: false
            referencedRelation: "waitlist_entries"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_send_log: {
        Row: {
          booking_id: string
          created_at: string
          error_code: string | null
          id: string
          language_code: string | null
          message_kind: string
          missing_message_id: boolean
          phone_digits: string | null
          provider_id: string | null
          sendpulse_message_id: string | null
          status: string
          template_name: string | null
          updated_at: string
        }
        Insert: {
          booking_id: string
          created_at?: string
          error_code?: string | null
          id?: string
          language_code?: string | null
          message_kind?: string
          missing_message_id?: boolean
          phone_digits?: string | null
          provider_id?: string | null
          sendpulse_message_id?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Update: {
          booking_id?: string
          created_at?: string
          error_code?: string | null
          id?: string
          language_code?: string | null
          message_kind?: string
          missing_message_id?: boolean
          phone_digits?: string | null
          provider_id?: string | null
          sendpulse_message_id?: string | null
          status?: string
          template_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_send_log_booking_id_fkey"
            columns: ["booking_id"]
            isOneToOne: false
            referencedRelation: "bookings"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_send_log_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "provider_profiles"
            referencedColumns: ["id"]
          },
        ]
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
      cancel_course_registration: {
        Args: { p_registration_id: string }
        Returns: undefined
      }
      cancel_recurring_series: {
        Args: { p_booking_id: string; p_scope: string }
        Returns: {
          r_cancellation_id: string
          r_cancelled_count: number
          r_code: string
          r_first_booking_id: string
          r_first_date: string
        }[]
      }
      create_recurring_series: {
        Args: {
          p_booking_time: string
          p_customer_name: string
          p_customer_phone: string
          p_dates: string[]
          p_guest_notes: string
          p_provider_id: string
          p_requested_count: number
          p_service_id: string
          p_staff_id: string
          p_whatsapp_consent: boolean
        }
        Returns: {
          r_booking_id: string
          r_code: string
          r_date: string
          r_outcome: string
          r_series_id: string
        }[]
      }
      decide_course_registration: {
        Args: { p_decision: string; p_registration_id: string }
        Returns: undefined
      }
      get_class_booking_counts: {
        Args: { p_class_ids: string[]; p_dates: string[] }
        Returns: {
          booked_count: number
          booking_date: string
          class_schedule_id: string
        }[]
      }
      get_course_seat_counts: {
        Args: { p_course_ids: string[] }
        Returns: {
          course_id: string
          free: number
          max_seats: number
          taken: number
        }[]
      }
      get_display_name: { Args: { _user_id: string }; Returns: string }
      get_due_whatsapp_reminders: {
        Args: { p_limit?: number }
        Returns: {
          r_booking_id: string
          r_message_kind: string
          r_provider_id: string
        }[]
      }
      get_provider_busy_slots: {
        Args: { p_from_date: string; p_provider_id: string; p_to_date: string }
        Returns: {
          booking_date: string
          booking_time: string
          duration_override: number
          service_ids: string[]
          staff_id: string
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
      link_my_walkins: { Args: never; Returns: number }
      otp_cleanup: { Args: never; Returns: number }
      otp_create_request: {
        Args: {
          p_code_hash: string
          p_cooldown_seconds?: number
          p_ip_hash: string
          p_max_attempts?: number
          p_max_per_ip?: number
          p_max_per_phone?: number
          p_phone: string
          p_session_id: string
          p_ttl_seconds?: number
          p_ua_hash: string
          p_window_minutes?: number
        }
        Returns: {
          r_retry_after: number
          r_session_id: string
          r_status: string
        }[]
      }
      otp_find_user_by_phone: {
        Args: { p_phone: string }
        Returns: {
          r_email: string
          r_user_id: string
        }[]
      }
      otp_invalidate: { Args: { p_session_id: string }; Returns: undefined }
      otp_mark_sent: { Args: { p_session_id: string }; Returns: undefined }
      otp_verify_attempt: {
        Args: { p_code_hash: string; p_phone: string; p_session_id: string }
        Returns: {
          r_attempts_left: number
          r_status: string
        }[]
      }
      package_activate: {
        Args: { p_package_id: string }
        Returns: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      package_add_entries: {
        Args: {
          p_entries?: number
          p_extend_days?: number
          p_note?: string
          p_package_id: string
        }
        Returns: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      package_cancel: {
        Args: { p_note?: string; p_package_id: string }
        Returns: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      package_request_purchase: {
        Args: { p_template_id: string }
        Returns: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      package_return_entry: {
        Args: { p_booking_id: string; p_note?: string }
        Returns: {
          activated_at: string | null
          created_at: string | null
          customer_id: string
          entries_remaining: number
          expires_at: string | null
          id: string
          last_low_entry_notified_at: string | null
          notes: string | null
          provider_id: string
          purchased_at: string | null
          status: string
          template_id: string
          total_entries: number
          updated_at: string | null
        }
        SetofOptions: {
          from: "*"
          to: "customer_packages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      provider_customers: { Args: { p_provider_id: string }; Returns: Json }
      recurring_series_service_eligible: {
        Args: { p_provider_id: string; p_service_id: string; p_today: string }
        Returns: boolean
      }
      register_for_course: { Args: { p_course_id: string }; Returns: string }
      save_date_openings: {
        Args: {
          p_break_end?: string
          p_break_start?: string
          p_dates: string[]
          p_end: string
          p_provider_id: string
          p_replace_blocks?: boolean
          p_start: string
        }
        Returns: number
      }
      unread_notification_count: { Args: never; Returns: number }
      waitlist_candidates: {
        Args: { p_event_ids: number[] }
        Returns: {
          entry_id: string
          event_id: number
          freed_booking_id: string
          latest_start_time: string
          next_round: number
          notify_lang: string
          provider_id: string
          service_duration: number
          service_id: string
          slot_date: string
          slot_time: string
          staff_lane: string
          user_id: string
        }[]
      }
      waitlist_claim_events: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          booking_date: string | null
          booking_id: string | null
          booking_time: string | null
          change_kind: string | null
          claimed_at: string | null
          created_at: string
          duration_override: number | null
          id: number
          last_error: string | null
          new_status: string | null
          old_status: string | null
          outcome: string | null
          processed_at: string | null
          provider_id: string | null
          service_ids: string[] | null
          staff_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "waitlist_events"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      waitlist_claim_round: {
        Args: {
          p_entry_id: string
          p_event_id: number
          p_freed_booking_id: string
          p_language_code: string
          p_phone_digits: string
          p_round: number
          p_slot_time: string
          p_staff_lane: string
          p_template_name: string
          p_whatsapp_skip?: string
        }
        Returns: {
          log_id: string
          reason: string
        }[]
      }
      waitlist_customer_has_booking: {
        Args: { p_date: string; p_provider_id: string; p_user_id: string }
        Returns: boolean
      }
      waitlist_event_age_anchor: {
        Args: { p_created_at: string; p_now?: string }
        Returns: string
      }
      waitlist_housekeeping: {
        Args: never
        Returns: {
          expired: number
          fulfilled: number
          purged: number
        }[]
      }
      waitlist_is_private_service: {
        Args: { p_provider_id: string; p_service_id: string; p_today: string }
        Returns: boolean
      }
      waitlist_is_quiet_hours: { Args: { p_now?: string }; Returns: boolean }
      waitlist_join: {
        Args: {
          p_afternoon: boolean
          p_entry_date: string
          p_evening: boolean
          p_lang: string
          p_morning: boolean
          p_provider_id: string
          p_service_id: string
          p_staff_id: string
        }
        Returns: {
          code: string
          entry_id: string
        }[]
      }
      waitlist_leave: { Args: { p_entry_id: string }; Returns: string }
      waitlist_provider_counts: {
        Args: { p_provider_id: string }
        Returns: {
          entry_date: string
          waiting: number
        }[]
      }
      waitlist_provider_day: {
        Args: { p_date: string; p_provider_id: string }
        Returns: {
          created_at: string
          customer_name: string
          customer_phone: string
          entry_id: string
          service_name: string
          staff_name: string
          wants_afternoon: boolean
          wants_evening: boolean
          wants_morning: boolean
        }[]
      }
      waitlist_quiet_window: {
        Args: { p_now?: string }
        Returns: {
          is_quiet: boolean
          quiet_ends_at: string
          quiet_started_at: string
        }[]
      }
      waitlist_slot_is_open: {
        Args: {
          p_date: string
          p_provider_id: string
          p_service_id: string
          p_staff_id: string
          p_time: string
        }
        Returns: boolean
      }
      waitlist_staff_performs: {
        Args: {
          p_provider_id: string
          p_service_id: string
          p_staff_id: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
