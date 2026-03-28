import { useEffect, type ChangeEvent } from "react";
import { useForm } from "react-hook-form";
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

interface FormValues {
  business_name: string;
  category: string;
  address: string;
  about: string;
  phone: string;
}

export function BusinessProfileTab() {
  const { t } = useLang();
  const { profile, upsertProfile, uploadCoverImage } = useProviderProfile();

  const { register, handleSubmit, setValue, watch, reset } = useForm<FormValues>({
    defaultValues: { business_name: "", category: "barber", address: "", about: "", phone: "" },
  });

  useEffect(() => {
    if (profile) {
      reset({
        business_name: profile.business_name || "",
        category: profile.category || "barber",
        address: profile.address || "",
        about: profile.about || "",
        phone: profile.phone || "",
      });
    }
  }, [profile, reset]);

  const onSubmit = async (values: FormValues) => {
    try {
      await upsertProfile.mutateAsync(values);
      toast.success(t("profileSaved"));
    } catch {
      toast.error("Error saving profile");
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
          <Input {...register("business_name")} />
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
          <Label>{t("aboutBusiness")}</Label>
          <Textarea {...register("about")} rows={3} />
        </div>

        <Button type="submit" className="w-full" disabled={upsertProfile.isPending || uploadCoverImage.isPending}>
          {t("saveProfile")}
        </Button>
      </div>
    </motion.form>
  );
}
