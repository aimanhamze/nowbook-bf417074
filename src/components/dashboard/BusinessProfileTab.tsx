import { useEffect, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router-dom";
import { MapPin, Loader2 } from "lucide-react";
import { useUserLocation } from "@/hooks/useUserLocation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { usePendingCount } from "@/components/dashboard/PendingTab";
import { categories, categoryNames } from "@/lib/mock-data";
import { buildSocialLinks } from "@/lib/socialLinks";
import { toast } from "sonner";

const LEAD_TIME_OPTIONS = [15, 30, 60, 120, 240, 1440] as const;
const BOOKING_WINDOW_OPTIONS = [3, 7, 14, 30, 60, 90] as const;

function roundCoord(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

const SOCIAL_FIELDS = ["social_whatsapp", "social_instagram", "social_tiktok", "social_facebook", "social_waze", "social_website"] as const;

const profileSchema = z.object({
  business_name: z.string().min(2, "שם העסק חייב להכיל לפחות 2 תווים").max(100),
  category: z.string().min(1),
  address: z.string().max(200).optional().default(""),
  about: z.string().max(1000).optional().default(""),
  phone: z.string().regex(/^[+\d\s\-()]*$/, "מספר טלפון לא תקין").max(20).optional().default(""),
  min_lead_time_minutes: z.number().int().min(0).max(1440),
  booking_window_days: z.number().int().min(1).max(365),
  social_whatsapp: z.string().optional().default(""),
  social_instagram: z.string().optional().default(""),
  social_tiktok: z.string().optional().default(""),
  social_facebook: z.string().optional().default(""),
  social_waze: z.string().optional().default(""),
  social_website: z.string().optional().default(""),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  longitude: z.number().min(-180).max(180).nullable().optional(),
});

type FormValues = z.infer<typeof profileSchema>;

export function BusinessProfileTab() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { profile, upsertProfile, updateBookingApproval, updateTreatmentNotesEnabled, uploadCoverImage, uploadAvatarImage } = useProviderProfile();
  const pendingCount = usePendingCount();

  const [accordionValue, setAccordionValue] = useState("");
  const [locationAccordionValue, setLocationAccordionValue] = useState("");
  const [pendingGuardOpen, setPendingGuardOpen] = useState(false);

  const requiresApproval = profile?.requires_booking_approval ?? false;
  const treatmentNotesEnabled = profile?.treatment_notes_enabled ?? false;

  const handleApprovalToggle = async (next: boolean) => {
    if (!next && pendingCount > 0) {
      // Block turn-off until the provider resolves pending bookings.
      setPendingGuardOpen(true);
      return;
    }
    try {
      await updateBookingApproval.mutateAsync(next);
      toast.success(t("profileSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error");
    }
  };

  const {
    position: detectedPosition,
    isLocating: isDetectingLocation,
    errorCode: locationErrorCode,
    locate,
  } = useUserLocation();

  const { register, handleSubmit, setValue, watch, reset, control, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      business_name: "", category: "barber", address: "", about: "", phone: "",
      min_lead_time_minutes: 15,
      booking_window_days: 14,
      social_whatsapp: "", social_instagram: "",
      social_tiktok: "", social_facebook: "", social_waze: "", social_website: "",
      latitude: null, longitude: null,
    },
  });

  useEffect(() => {
    if (profile) {
      const sl = profile.social_links;
      reset({
        business_name: profile.business_name || "",
        category: profile.category || "barber",
        address: profile.address || "",
        about: profile.about || "",
        phone: profile.phone || "",
        min_lead_time_minutes: profile.min_lead_time_minutes ?? 15,
        booking_window_days: (profile as { booking_window_days?: number }).booking_window_days ?? 14,
        social_whatsapp: sl?.whatsapp || profile.phone || "",
        social_instagram: sl?.instagram || "",
        social_tiktok: sl?.tiktok || "",
        social_facebook: sl?.facebook || "",
        social_waze: sl?.waze || "",
        social_website: sl?.website || "",
        latitude: profile.latitude ?? null,
        longitude: profile.longitude ?? null,
      });
    }
  }, [profile, reset]);

  const socialValues = useWatch({
    control,
    name: ["social_whatsapp", "social_instagram", "social_tiktok", "social_facebook", "social_waze", "social_website"],
  });
  const socialFilledCount = socialValues.filter(v => v && v.trim() !== "").length;

  const latValue = watch("latitude") ?? null;
  const lngValue = watch("longitude") ?? null;
  const hasLocation = latValue !== null && lngValue !== null;

  // Apply detected coordinates into form state
  useEffect(() => {
    if (!detectedPosition) return;
    setValue("latitude", roundCoord(detectedPosition.latitude), { shouldDirty: true });
    setValue("longitude", roundCoord(detectedPosition.longitude), { shouldDirty: true });
  }, [detectedPosition, setValue]);

  // Show per-code toast on geolocation error
  useEffect(() => {
    if (locationErrorCode === null) return;
    if (locationErrorCode === -1) toast.error(t("locationErrorUnsupported"));
    else if (locationErrorCode === 1) toast.error(t("locationErrorDenied"));
    else if (locationErrorCode === 2) toast.error(t("locationErrorUnavailable"));
    else if (locationErrorCode === 3) toast.error(t("locationErrorTimeout"));
  }, [locationErrorCode, t]);

  const handleClearLocation = () => {
    setValue("latitude", null, { shouldDirty: true });
    setValue("longitude", null, { shouldDirty: true });
  };

  useEffect(() => {
    if (SOCIAL_FIELDS.some(f => errors[f])) {
      setAccordionValue("social");
    }
  }, [errors]);

  const onSubmit = async (values: FormValues) => {
    try {
      const social_links = buildSocialLinks({
        social_whatsapp: values.social_whatsapp ?? "",
        social_instagram: values.social_instagram ?? "",
        social_tiktok: values.social_tiktok ?? "",
        social_facebook: values.social_facebook ?? "",
        social_waze: values.social_waze ?? "",
        social_website: values.social_website ?? "",
      });
      await upsertProfile.mutateAsync({
        business_name: values.business_name,
        category: values.category,
        address: values.address ?? "",
        about: values.about ?? "",
        phone: values.phone ?? "",
        min_lead_time_minutes: values.min_lead_time_minutes,
        booking_window_days: values.booking_window_days,
        social_links,
        latitude: values.latitude ?? null,
        longitude: values.longitude ?? null,
      });
      toast.success(t("profileSaved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving profile");
    }
  };

  const handleCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await uploadCoverImage.mutateAsync(file);
      toast.success(t("coverImageUploaded"));
    } catch {
      toast.error(t("coverImageUploadError"));
    } finally {
      event.target.value = "";
    }
  };

  const handleAvatarUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      await uploadAvatarImage.mutateAsync(file);
      toast.success(t("avatarUploaded") || "תמונת פרופיל עודכנה");
    } catch {
      toast.error(t("coverImageUploadError"));
    } finally {
      event.target.value = "";
    }
  };

  const coverPreview = profile?.cover_image?.trim() || "";
  const businessInitial = (watch("business_name") || profile?.business_name || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <motion.form
      onSubmit={handleSubmit(onSubmit)}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4"
    >
      <h2 className="text-lg font-semibold">{t("businessProfile")}</h2>

      {/* Booking Settings — saves immediately on toggle, distinct from the form below */}
      <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold">{t("bookingSettingsTitle")}</h3>
        <div className="flex items-start gap-3">
          <Switch
            checked={requiresApproval}
            onCheckedChange={handleApprovalToggle}
            disabled={updateBookingApproval.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("requireApprovalLabel")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("requireApprovalHelp")}</p>
          </div>
        </div>
        <div className="flex items-start gap-3 pt-1 border-t border-border">
          <Switch
            checked={treatmentNotesEnabled}
            onCheckedChange={async (next) => {
              try {
                await updateTreatmentNotesEnabled.mutateAsync(next);
                toast.success(t("profileSaved"));
              } catch (err) {
                toast.error(err instanceof Error ? err.message : "Error");
              }
            }}
            disabled={updateTreatmentNotesEnabled.isPending}
          />
          <div className="flex-1">
            <Label className="text-sm font-medium">{t("treatmentNotesEnabled")}</Label>
            <p className="text-xs text-muted-foreground mt-1">{t("treatmentNotes")}</p>
          </div>
        </div>
      </div>

      <AlertDialog open={pendingGuardOpen} onOpenChange={setPendingGuardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("cannotDisableApprovalTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("cannotDisableApprovalBody").replace("{count}", String(pendingCount))}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">{t("cancel")}</AlertDialogCancel>
            <AlertDialogAction
              type="button"
              onClick={() => navigate("/calendar", { state: { tab: "pending" } })}
            >
              {t("goToPendingTab")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="rounded-2xl border border-border bg-card p-4 space-y-4">
        {/* Avatar */}
        <div>
          <Label htmlFor="avatar-upload">{t("avatarImage") || "תמונת פרופיל"}</Label>
          <div className="mt-2 flex items-center gap-4">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded-full bg-gradient-to-br from-accent/20 to-accent/5 border border-border">
              {profile?.avatar_image ? (
                <img src={profile.avatar_image} alt="avatar" className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-bold text-accent/40">
                  {businessInitial}
                </div>
              )}
            </div>
            <Input
              id="avatar-upload"
              type="file"
              accept="image/*"
              onChange={handleAvatarUpload}
              disabled={uploadAvatarImage.isPending}
              className="flex-1"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="cover-upload">{t("coverImage")}</Label>
          <div className="mt-2 space-y-3">
            <div className="h-36 w-full overflow-hidden rounded-xl bg-gradient-to-br from-accent/20 to-accent/5">
              {coverPreview ? (
                <img src={coverPreview} alt={t("coverImage")} className="h-full w-full object-cover" loading="lazy" />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl font-bold text-accent/35">
                  {businessInitial || "?"}
                </div>
              )}
            </div>
            <Input
              id="cover-upload"
              type="file"
              accept="image/*"
              onChange={handleCoverUpload}
              disabled={uploadCoverImage.isPending}
            />
          </div>
        </div>

        <div>
          <Label>{t("businessName")}</Label>
          <Input {...register("business_name")} className={errors.business_name ? "border-destructive" : ""} />
          {errors.business_name && <p className="text-xs text-destructive mt-1">{errors.business_name.message}</p>}
        </div>

        <div>
          <Label>{t("category")}</Label>
          <Select value={watch("category")} onValueChange={v => setValue("category", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {categories.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.icon} {categoryNames[c.id]?.[lang]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>{t("address")}</Label>
          <Input {...register("address")} />
        </div>

        <div>
          <Label>{t("phone")}</Label>
          <Input {...register("phone")} type="tel" />
        </div>

        {/* Contact & Social Links */}
        <Accordion type="single" collapsible value={accordionValue} onValueChange={setAccordionValue} className="border-t border-border -mx-4 px-4">
          <AccordionItem value="social" className="border-b-0">
            <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
              {socialFilledCount > 0
                ? `${t("socialLinks")} (${socialFilledCount} ${t("socialLinksAdded")})`
                : t("socialLinks")}
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-1">
              <div>
                <Label>{t("socialLinksWhatsapp")}</Label>
                <Input {...register("social_whatsapp")} type="tel" placeholder={t("socialLinksHelperPhone")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperPhone")}</p>
              </div>

              <div>
                <Label>{t("socialLinksInstagram")}</Label>
                <Input {...register("social_instagram")} placeholder={t("socialLinksHelperHandle")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperHandle")}</p>
              </div>

              <div>
                <Label>{t("socialLinksTiktok")}</Label>
                <Input {...register("social_tiktok")} placeholder={t("socialLinksHelperHandle")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperHandle")}</p>
              </div>

              <div>
                <Label>{t("socialLinksFacebook")}</Label>
                <Input {...register("social_facebook")} placeholder={t("socialLinksHelperHandle")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperHandle")}</p>
              </div>

              <div>
                <Label>{t("socialLinksWaze")}</Label>
                <Input {...register("social_waze")} placeholder={t("socialLinksHelperWaze")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperWaze")}</p>
              </div>

              <div>
                <Label>{t("socialLinksWebsite")}</Label>
                <Input {...register("social_website")} type="url" placeholder={t("socialLinksHelperWebsite")} />
                <p className="text-xs text-muted-foreground mt-1">{t("socialLinksHelperWebsite")}</p>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        {/* Location on Map */}
        <Accordion type="single" collapsible value={locationAccordionValue} onValueChange={setLocationAccordionValue} className="border-t border-border -mx-4 px-4">
          <AccordionItem value="location" className="border-b-0">
            <AccordionTrigger className="text-sm font-semibold py-3 hover:no-underline">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 shrink-0" />
                <span>{t("locationOnMap")}</span>
                {hasLocation && <span className="h-2 w-2 rounded-full bg-green-500 shrink-0" />}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pb-1">
              <p className="text-xs text-muted-foreground">{t("locationHelperText")}</p>
              <p className="text-xs text-muted-foreground">{t("locationPrivacyNote")}</p>
              <p className="text-xs text-muted-foreground">{t("locationWazeCrossRef")}</p>

              {hasLocation ? (
                <p className="text-sm">
                  <span className="text-green-600 font-medium">{t("locationSetLabel")}</span>{" "}
                  <span dir="ltr">{latValue!.toFixed(4)}, {lngValue!.toFixed(4)}</span>
                </p>
              ) : (
                <p className="text-sm text-muted-foreground">{t("locationNotSet")}</p>
              )}

              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant={hasLocation ? "outline" : "default"}
                  size="sm"
                  disabled={isDetectingLocation}
                  onClick={locate}
                >
                  {isDetectingLocation ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("locationDetecting")}
                    </>
                  ) : hasLocation ? (
                    t("locationUpdateLocation")
                  ) : (
                    t("locationSetCurrentLocation")
                  )}
                </Button>
                {hasLocation && !isDetectingLocation && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClearLocation}
                  >
                    {t("locationClearLocation")}
                  </Button>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>

        <div>
          <Label>{t("minLeadTimeLabel")}</Label>
          <Select
            value={String(watch("min_lead_time_minutes"))}
            onValueChange={v => setValue("min_lead_time_minutes", Number(v))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LEAD_TIME_OPTIONS.map(minutes => (
                <SelectItem key={minutes} value={String(minutes)}>
                  {t(`leadTime${minutes}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>{t("bookingWindowLabel")}</Label>
          <Select
            value={String(watch("booking_window_days"))}
            onValueChange={v => setValue("booking_window_days", Number(v))}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BOOKING_WINDOW_OPTIONS.map(days => (
                <SelectItem key={days} value={String(days)}>
                  {t(`bookingWindow${days}` as Parameters<typeof t>[0])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <Label>{t("aboutBusiness")}</Label>
          <Textarea {...register("about")} rows={3} />
        </div>

        <Button type="submit" className="w-full" disabled={upsertProfile.isPending || uploadCoverImage.isPending || uploadAvatarImage.isPending}>
          {t("saveProfile")}
        </Button>
      </div>
    </motion.form>
  );
}
