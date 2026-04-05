import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { User, Shield, Store } from "lucide-react";

export function AdminUsers() {
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
      const { data, error } = await supabase
        .from("user_roles")
        .select("*");
      if (error) throw error;
      return data || [];
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
    (roles || []).filter((r) => r.user_id === userId).map((r) => r.role);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{profiles?.length} משתמשים רשומים</p>
      {profiles?.map((p) => {
        const userRoles = getUserRoles(p.user_id);
        return (
          <div
            key={p.id}
            className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card"
          >
            <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center shrink-0 overflow-hidden">
              {p.avatar_url ? (
                <img src={p.avatar_url} alt={p.display_name || ""} className="w-full h-full object-cover" />
              ) : (
                <User className="h-4 w-4 text-accent" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm truncate">{p.display_name || "ללא שם"}</h3>
              <p className="text-xs text-muted-foreground">{p.phone || "—"}</p>
            </div>
            <div className="flex gap-1 shrink-0">
              {userRoles.includes("admin") && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-red-100 text-red-700">
                  <Shield className="h-3 w-3" /> מנהל
                </span>
              )}
              {userRoles.includes("provider") && (
                <span className="flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">
                  <Store className="h-3 w-3" /> ספק
                </span>
              )}
              {userRoles.length === 0 && (
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  לקוח
                </span>
              )}
            </div>
            <div className="text-xs text-muted-foreground shrink-0">
              {new Date(p.created_at).toLocaleDateString("he-IL")}
            </div>
          </div>
        );
      })}
    </div>
  );
}
