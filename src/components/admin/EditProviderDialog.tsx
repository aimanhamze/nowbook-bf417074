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
import { categories } from "@/lib/mock-data";
import type { Tables } from "@/integrations/supabase/types";

const categoryLabels: Record<string, string> = {
  barber: "💈 ספר",
  salon: "💇 מספרה",
  nails: "💅 ציפורניים",
  brows: "✨ גבות",
  spa: "🧖 ספא",
  skincare: "🧴 טיפוח עור",
  makeup: "💄 איפור",
  dental: "🦷 רפואת שיניים",
  physio: "🏃 פיזיותרפיה",
  aesthetic_medicine: "💉 רפואה אסתטית",
};

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
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {categoryLabels[c.id] || c.id}
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
