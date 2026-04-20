import { useEffect, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { categories } from "@/lib/mock-data";
import { toast } from "sonner";

const LEAD_TIME_OPTIONS = [15, 30, 60, 120, 240, 1440] as const;

const profileSchema = z.object({
  business_name: z.string().min(2, "שם העסק חייב להכיל לפחות 2 תווים").max(100),
  category: z.string().min(1),
  address: z.string().max(200).optional().default(""),
  about: z.string().max(1000).optional().default(""),
  phone: z.string().regex(/^[+\d\s\-()]*$/, "מספר טלפון לא תקין").max(20).optional().default(""),
  min_lead_time_minutes: z.number().int().min(0).max(1440),
});

type FormValues = z.infer<typeof profileSchema>;

export function BusinessProfileTab() {
  const { t } = useLang();
  const { profile, upsertProfile, uploadCoverImage, uploadAvatarImage } = useProviderProfile();

  const { register, handleSubmit, setValue, watch, reset, formState: { errors } } = useForm<FormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { business_name: "", category: "barber", address: "", about: "", phone: "", min_lead_time_minutes: 15 },
  });

  useEffect(() => {
    if (profile) {
      reset({
        business_name: profile.business_name || "",
        category: profile.category || "barber",
        address: profile.address || "",
        about: profile.about || "",
        phone: profile.phone || "",
        min_lead_time_minutes: profile.min_lead_time_minutes ?? 15,
      });
    }
  }, [profile, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      await upsertProfile.mutateAsync({
        business_name: values.business_name,
        category: values.category,
        address: values.address ?? "",
        about: values.about ?? "",
        phone: values.phone ?? "",
        min_lead_time_minutes: values.min_lead_time_minutes,
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

  const categoryLabels: Record<string, string> = {
    barber: t("barber"), salon: t("salon"), nails: t("nails"),
    brows: t("brows"), spa: t("spa"), skincare: t("skincare"),
    makeup: t("makeup") || "איפור",
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
                <SelectItem key={c.id} value={c.id}>{c.icon} {categoryLabels[c.id]}</SelectItem>
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
