import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { categories } from "@/lib/mock-data";

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
};

export function CreateProviderDialog() {
  const [open, setOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("barber");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [about, setAbout] = useState("");
  const queryClient = useQueryClient();

  // Get users who are NOT already providers
  const { data: availableUsers } = useQuery({
    queryKey: ["admin-available-users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: providerProfiles }] = await Promise.all([
        supabase.from("profiles").select("user_id, display_name, phone"),
        supabase.from("provider_profiles").select("user_id"),
      ]);
      const providerUserIds = new Set((providerProfiles || []).map((p) => p.user_id));
      return (profiles || []).filter((p) => !providerUserIds.has(p.user_id));
    },
    enabled: open,
  });

  const createProvider = useMutation({
    mutationFn: async () => {
      if (!selectedUserId || !businessName.trim()) {
        throw new Error("יש לבחור משתמש ושם עסק");
      }

      // Create provider profile
      const { error: profileError } = await supabase
        .from("provider_profiles")
        .insert({
          user_id: selectedUserId,
          business_name: businessName.trim(),
          category,
          address: address.trim(),
          phone: phone.trim(),
          about: about.trim(),
        });
      if (profileError) throw profileError;

      // Assign provider role
      const { error: roleError } = await supabase
        .from("user_roles")
        .insert({ user_id: selectedUserId, role: "provider" });
      if (roleError && !roleError.message.includes("duplicate")) throw roleError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-roles"] });
      queryClient.invalidateQueries({ queryKey: ["admin-available-users"] });
      toast.success("הספק נוצר בהצלחה");
      resetForm();
      setOpen(false);
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה ביצירת ספק");
    },
  });

  const resetForm = () => {
    setSelectedUserId("");
    setBusinessName("");
    setCategory("barber");
    setAddress("");
    setPhone("");
    setAbout("");
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-1.5">
          <Plus className="h-4 w-4" />
          הוסף ספק
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>יצירת ספק חדש</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <div>
            <Label>בחר משתמש</Label>
            <Select value={selectedUserId} onValueChange={setSelectedUserId}>
              <SelectTrigger>
                <SelectValue placeholder="בחר משתמש קיים..." />
              </SelectTrigger>
              <SelectContent>
                {availableUsers?.map((u) => (
                  <SelectItem key={u.user_id} value={u.user_id}>
                    {u.display_name || u.phone || "ללא שם"}
                  </SelectItem>
                ))}
                {availableUsers?.length === 0 && (
                  <div className="px-3 py-2 text-xs text-muted-foreground">
                    כל המשתמשים כבר ספקים
                  </div>
                )}
              </SelectContent>
            </Select>
          </div>

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
            onClick={() => createProvider.mutate()}
            disabled={!selectedUserId || !businessName.trim() || createProvider.isPending}
          >
            {createProvider.isPending ? "יוצר..." : "צור ספק"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
