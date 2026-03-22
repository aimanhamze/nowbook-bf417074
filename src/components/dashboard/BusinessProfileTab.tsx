import { useEffect } from "react";
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
  const { profile, upsertProfile } = useProviderProfile();

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

  const categoryLabels: Record<string, string> = {
    barber: t("barber"), salon: t("salon"), nails: t("nails"),
    brows: t("brows"), spa: t("spa"), skincare: t("skincare"),
  };

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

        <Button type="submit" className="w-full" disabled={upsertProfile.isPending}>
          {t("saveProfile")}
        </Button>
      </div>
    </motion.form>
  );
}
