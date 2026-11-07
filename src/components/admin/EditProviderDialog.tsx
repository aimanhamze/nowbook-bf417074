import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { Tables } from "@/integrations/supabase/types";
import { ADMIN_CATEGORY_IDS, categoryLabels } from "./categoryLabels";
import { academyErrorMessage } from "@/lib/academyErrors";
import { translations } from "@/lib/translations";

interface EditProviderDialogProps {
  provider: Tables<"provider_profiles"> | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function EditProviderDialog({ provider, open, onOpenChange }: EditProviderDialogProps) {
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("barber");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [about, setAbout] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (provider) {
      setBusinessName(provider.business_name || "");
      setCategory(provider.category || "barber");
      setAddress(provider.address || "");
      setPhone(provider.phone || "");
      setAbout(provider.about || "");
    }
  }, [provider]);

  const updateProvider = useMutation({
    mutationFn: async () => {
      if (!provider) throw new Error("No provider");
      const { error } = await supabase
        .from("provider_profiles")
        .update({
          business_name: businessName.trim(),
          category,
          address: address.trim(),
          phone: phone.trim(),
          about: about.trim(),
        })
        .eq("id", provider.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
      toast.success("פרטי הספק עודכנו בהצלחה");
      onOpenChange(false);
    },
    onError: (err: any) => {
      // Leaving 'academy' while course registrations are live is refused by
      // the DB guard; say why (admin UI is Hebrew-only) instead of the raw code.
      if (typeof err?.message === "string" && err.message.includes("CATEGORY_CHANGE_BLOCKED")) {
        toast.error(academyErrorMessage(err, (key) => translations.he[key]));
        return;
      }
      toast.error(err.message || "שגיאה בעדכון הספק");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>עריכת ספק</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label>שם העסק</Label>
            <Input value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </div>

          <div>
            <Label>קטגוריה</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ADMIN_CATEGORY_IDS.map((id) => (
                  <SelectItem key={id} value={id}>
                    {categoryLabels[id]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label>כתובת</Label>
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>

          <div>
            <Label>טלפון</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" />
          </div>

          <div>
            <Label>אודות</Label>
            <Textarea value={about} onChange={(e) => setAbout(e.target.value)} rows={3} />
          </div>

          <Button
            className="w-full"
            onClick={() => updateProvider.mutate()}
            disabled={!businessName.trim() || updateProvider.isPending}
          >
            {updateProvider.isPending ? "שומר..." : "שמור שינויים"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
