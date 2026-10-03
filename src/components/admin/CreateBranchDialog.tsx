import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { categoryLabels } from "./categoryLabels";
import type { Tables } from "@/integrations/supabase/types";

type Provider = Tables<"provider_profiles">;

// Multi-branch: adds a branch to the owner of `source`. No email or password —
// the branch shares the owner's existing login, and the owner switches to it
// from the dashboard. The branch starts like a new provider: default hours, no
// services. Category and phone are pre-filled from the source branch; the city
// is left empty because a branch is, by definition, somewhere else.
export function CreateBranchDialog({
  source,
  open,
  onOpenChange,
}: {
  source: Provider | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [category, setCategory] = useState("barber");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const queryClient = useQueryClient();

  useEffect(() => {
    if (open && source) {
      setBusinessName("");
      setCategory(source.category || "barber");
      setCity("");
      setPhone(source.phone || "");
    }
  }, [open, source]);

  const createBranch = useMutation({
    mutationFn: async () => {
      if (!source) throw new Error("no-source");
      if (!businessName.trim()) throw new Error("יש למלא שם סניף");

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("לא מחובר");

      const { data, error } = await supabase.functions.invoke("create-branch", {
        body: {
          owner_user_id: source.user_id,
          business_name: businessName.trim(),
          category,
          city: city.trim(),
          phone: phone.trim(),
        },
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
      toast.success(`הסניף "${businessName.trim()}" נוסף`);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "שגיאה בהוספת סניף");
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" dir="rtl">
        <DialogHeader>
          <DialogTitle>הוספת סניף</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 mt-2">
          <p className="text-sm text-muted-foreground">
            סניף נוסף לבעלים של{" "}
            <span className="font-semibold text-foreground">{source?.business_name}</span>.
            הסניף ישתמש באותה התחברות, עם רשימה, שירותים, שעות וצוות משלו.
          </p>

          <div>
            <Label>שם הסניף *</Label>
            <Input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="לדוגמה: Womed חיפה"
            />
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
            <Label>עיר</Label>
            <Input value={city} onChange={(e) => setCity(e.target.value)} />
          </div>

          <div>
            <Label>טלפון</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" dir="ltr" />
          </div>

          <Button
            className="w-full"
            onClick={() => createBranch.mutate()}
            disabled={!businessName.trim() || createBranch.isPending}
          >
            {createBranch.isPending ? "מוסיף..." : "הוסף סניף"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
