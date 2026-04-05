import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { User, Shield, Store, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Database } from "@/integrations/supabase/types";

type AppRole = Database["public"]["Enums"]["app_role"];

const ROLE_LABELS: Record<AppRole, string> = {
  admin: "מנהל",
  provider: "ספק",
  user: "משתמש",
};

export function AdminUsers() {
  const queryClient = useQueryClient();
  const [addingRoleFor, setAddingRoleFor] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<AppRole | "">("");

  const { data: profiles, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  const { data: roles } = useQuery({
    queryKey: ["admin-all-roles"],
    queryFn: async () => {
      const { data, error } = await supabase.from("user_roles").select("*");
      if (error) throw error;
      return data || [];
    },
  });

  const addRole = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: AppRole }) => {
      const { error } = await supabase
        .from("user_roles")
        .insert({ user_id: userId, role });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-all-roles"] });
      toast.success("התפקיד נוסף בהצלחה");
      setAddingRoleFor(null);
      setSelectedRole("");
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה בהוספת תפקיד");
    },
  });

  const removeRole = useMutation({
    mutationFn: async ({ roleId }: { roleId: string }) => {
      const { error } = await supabase
        .from("user_roles")
        .delete()
        .eq("id", roleId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-all-roles"] });
      toast.success("התפקיד הוסר בהצלחה");
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה בהסרת תפקיד");
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-16 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  const getUserRoles = (userId: string) =>
    (roles || []).filter((r) => r.user_id === userId);

  const getAvailableRoles = (userId: string): AppRole[] => {
    const existing = getUserRoles(userId).map((r) => r.role);
    return (["admin", "provider", "user"] as AppRole[]).filter(
      (r) => !existing.includes(r)
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {profiles?.length} משתמשים רשומים
      </p>
      {profiles?.map((p) => {
        const userRoles = getUserRoles(p.user_id);
        const availableRoles = getAvailableRoles(p.user_id);
        const isAdding = addingRoleFor === p.user_id;

        return (
          <div
            key={p.id}
            className="flex flex-col gap-2 p-4 rounded-2xl border border-border bg-card"
          >
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0 overflow-hidden">
                {p.avatar_url ? (
                  <img
                    src={p.avatar_url}
                    alt={p.display_name || ""}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <User className="h-4 w-4 text-accent" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-sm truncate">
                  {p.display_name || "ללא שם"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {p.phone || "—"}
                </p>
              </div>
              <div className="text-xs text-muted-foreground shrink-0">
                {new Date(p.created_at).toLocaleDateString("he-IL")}
              </div>
            </div>

            {/* Roles row */}
            <div className="flex flex-wrap items-center gap-1.5">
              {userRoles.map((r) => (
                <span
                  key={r.id}
                  className={`flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full ${
                    r.role === "admin"
                      ? "bg-red-100 text-red-700"
                      : r.role === "provider"
                      ? "bg-emerald-100 text-emerald-700"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {r.role === "admin" && <Shield className="h-3 w-3" />}
                  {r.role === "provider" && <Store className="h-3 w-3" />}
                  {ROLE_LABELS[r.role]}
                  <button
                    onClick={() => removeRole.mutate({ roleId: r.id })}
                    className="hover:text-destructive ml-0.5"
                    title="הסר תפקיד"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}

              {userRoles.length === 0 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  לקוח
                </span>
              )}

              {isAdding ? (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={selectedRole}
                    onValueChange={(v) => setSelectedRole(v as AppRole)}
                  >
                    <SelectTrigger className="h-6 text-xs w-24">
                      <SelectValue placeholder="בחר" />
                    </SelectTrigger>
                    <SelectContent>
                      {availableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-6 text-xs px-2"
                    disabled={!selectedRole || addRole.isPending}
                    onClick={() => {
                      if (selectedRole) {
                        addRole.mutate({
                          userId: p.user_id,
                          role: selectedRole as AppRole,
                        });
                      }
                    }}
                  >
                    אשר
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-2"
                    onClick={() => {
                      setAddingRoleFor(null);
                      setSelectedRole("");
                    }}
                  >
                    ביטול
                  </Button>
                </div>
              ) : (
                availableRoles.length > 0 && (
                  <button
                    onClick={() => {
                      setAddingRoleFor(p.user_id);
                      setSelectedRole("");
                    }}
                    className="flex items-center gap-0.5 text-[10px] font-medium px-2 py-0.5 rounded-full border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                  >
                    <Plus className="h-3 w-3" />
                    הוסף תפקיד
                  </button>
                )
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
