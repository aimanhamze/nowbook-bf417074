import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SocialLinks } from "@/lib/socialLinks";
import { pickActiveBranch, useActiveBranchId } from "@/lib/activeBranch";

export function useProviderProfile() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const activeBranchId = useActiveBranchId(user?.id);

  // Multi-branch: an owner may have several provider_profiles rows (one per
  // branch), so this fetches them all, oldest first, and exposes the active
  // one as `profile`. With a single row — every provider today — `profile` is
  // that row, exactly as the old `.maybeSingle()` returned it.
  const branchesQuery = useQuery({
    queryKey: ["provider-profile", user?.id],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      if (!user) return [];
      const { data, error } = await supabase
        .from("provider_profiles")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: !!user,
  });

  // undefined while loading (as before), null when the user has no row.
  const branches = branchesQuery.data;
  const profile = branches === undefined ? undefined : pickActiveBranch(branches, activeBranchId);
  // Every write below targets the active branch by id. Filtering on user_id
  // would write to ALL of an owner's branches at once.
  const profileId = profile?.id;

  const upsertProfile = useMutation({
    mutationFn: async (values: {
      business_name: string;
      category: string;
      address: string;
      about: string;
      phone: string;
      social_links: SocialLinks | null;
      latitude?: number | null;
      longitude?: number | null;
    }) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");

      const { error } = await supabase
        .from("provider_profiles")
        .update(values)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateBookingApproval = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ requires_booking_approval: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateTreatmentNotesEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ treatment_notes_enabled: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateShowPrices = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ show_prices: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateAllowCustomerReschedule = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      // Cast: column added by 20261003000001 migration; types.ts regenerated after apply.
      const { error } = await supabase
        .from("provider_profiles")
        .update({ allow_customer_reschedule: value } as never)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      // The customer Bookings page reads the flag through useAllProviders.
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateDepositRequestEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        // Cast: column added by 20260618000002 migration; types.ts is
        // regenerated after Aiman applies it (matches booking_window_days).
        .update({ deposit_request_enabled: value } as never)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  // Multi-staff Phase 2. The false→true transition is guarded DB-side
  // (trg_enforce_staff_enable_no_future_bookings): it raises
  // STAFF_ENABLE_BLOCKED_BY_FUTURE_BOOKINGS (P0001) while future
  // confirmed/pending bookings exist. The error propagates out of mutateAsync
  // for the UI to match on; the cache is only touched on success, so a blocked
  // toggle never shows as "on". Turning the flag OFF is never guarded.
  const updateStaffEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ staff_enabled: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      // Customer surfaces will read the flag via useAllProviders in later
      // phases; invalidating now matches the other customer-visible flags.
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  // Master switch for service color coding. Purely cosmetic: it decides whether
  // the calendar reads the per-service `color` columns at all. Turning it off
  // never clears the stored colors, so flipping it back on restores them.
  const updateServiceColorsEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ service_colors_enabled: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateMinLeadTime = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ min_lead_time_minutes: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateBookingWindow = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ booking_window_days: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const updateCancellationNoticeHours = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        // Cast: column added by 20260622000001 migration; types.ts is
        // regenerated after apply (matches booking_window_days / deposit_request_enabled).
        .update({ cancellation_notice_hours: value } as never)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      // Customer Bookings.tsx reads this via useAllProviders, so refresh it too.
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateSlotInterval = useMutation({
    mutationFn: async (value: number) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        // Cast: column added by 20260630000001 migration; types.ts is
        // regenerated after apply (matches cancellation_notice_hours pattern).
        .update({ slot_interval_minutes: value } as never)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      // Customer/walk-in slot grids read it via the provider-slot-interval query.
      queryClient.invalidateQueries({ queryKey: ["provider-slot-interval"] });
    },
  });

  // ── Monthly availability (opt-in) ──────────────────────────────────────────
  // availability_mode gates the customer slot resolver (resolveDayHours in
  // useAllProviders). Default 'weekly' = today's behavior; 'monthly' uses the
  // flat monthly_default_* window (and, from Phase 3, per-date overrides).
  const updateAvailabilityMode = useMutation({
    mutationFn: async (value: "weekly" | "monthly") => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ availability_mode: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      // Customer booking view reads mode via the provider-monthly-settings query.
      queryClient.invalidateQueries({ queryKey: ["provider-monthly-settings"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  // Flat monthly default: partial update so the open/closed Switch and the two
  // time inputs can each save independently (immediate-save, like Working Hours).
  const updateMonthlyDefaults = useMutation({
    mutationFn: async (values: {
      monthly_default_available?: boolean;
      monthly_default_start?: string;
      monthly_default_end?: string;
    }) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update(values)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["provider-monthly-settings"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const updateWhatsAppTemplates = useMutation({
    mutationFn: async (values: { deposit_message_template?: string; reminder_message_template?: string }) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update(values)
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  // ── WhatsApp booking confirmations (opt-in) ────────────────────────────────
  // Both columns landed in the 20260814000001 migration and are present in the
  // regenerated types.ts, so neither needs the `as never` cast used above for
  // columns whose migration has not been applied yet.
  const updateWhatsAppConfirmEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ whatsapp_confirm_enabled: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  // 'he' | 'ar' only — there is no approved English template, and the DB CHECK
  // constraint rejects anything else.
  const updateWhatsAppMessageLanguage = useMutation({
    mutationFn: async (value: "he" | "ar") => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ whatsapp_message_language: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  // ── WhatsApp appointment reminders (opt-in, separate from confirmations) ───
  // A provider may want confirmations without reminders, or the reverse, so
  // this flag is independent of whatsapp_confirm_enabled. The message language
  // is NOT duplicated — whatsapp_message_language governs both.
  const updateWhatsAppReminderEnabled = useMutation({
    mutationFn: async (value: boolean) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ whatsapp_reminder_enabled: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  // 1 or 24 only — the DB CHECK constraint rejects anything else.
  const updateWhatsAppReminderHours = useMutation({
    mutationFn: async (value: 1 | 24) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");
      const { error } = await supabase
        .from("provider_profiles")
        .update({ whatsapp_reminder_hours: value })
        .eq("id", profileId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
    },
  });

  const uploadCoverImage = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");

      const extension = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/cover-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("provider-images")
        .upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("provider-images")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("provider_profiles")
        .update({ cover_image: publicUrlData.publicUrl })
        .eq("id", profileId);
      if (updateError) throw updateError;

      return publicUrlData.publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  const uploadAvatarImage = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not authenticated");
      if (!profileId) throw new Error("No provider profile");

      const extension = file.name.split(".").pop() || "jpg";
      const filePath = `${user.id}/avatar-${Date.now()}.${extension}`;

      const { error: uploadError } = await supabase.storage
        .from("provider-images")
        .upload(filePath, file, { upsert: true, cacheControl: "3600" });
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage
        .from("provider-images")
        .getPublicUrl(filePath);

      const { error: updateError } = await supabase
        .from("provider_profiles")
        .update({ avatar_image: publicUrlData.publicUrl })
        .eq("id", profileId);
      if (updateError) throw updateError;

      return publicUrlData.publicUrl;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["provider-profile", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
  });

  return {
    profile,
    // All of the owner's branches, oldest first. Nothing reads this yet; the
    // branch switcher (Phase 3) will, and only render when length > 1.
    branches: branches ?? [],
    isLoading: branchesQuery.isLoading,
    error: branchesQuery.error,
    upsertProfile,
    updateBookingApproval,
    updateTreatmentNotesEnabled,
    updateShowPrices,
    updateAllowCustomerReschedule,
    updateDepositRequestEnabled,
    updateStaffEnabled,
    updateServiceColorsEnabled,
    updateMinLeadTime,
    updateBookingWindow,
    updateCancellationNoticeHours,
    updateSlotInterval,
    updateAvailabilityMode,
    updateMonthlyDefaults,
    updateWhatsAppTemplates,
    updateWhatsAppConfirmEnabled,
    updateWhatsAppMessageLanguage,
    updateWhatsAppReminderEnabled,
    updateWhatsAppReminderHours,
    uploadCoverImage,
    uploadAvatarImage,
  };
}

export function useIsProvider() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-roles", user?.id],
    queryFn: async () => {
      if (!user) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "provider");
      return (data && data.length > 0) || false;
    },
    enabled: !!user,
  });
}
