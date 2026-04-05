import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { categoryNames } from "@/lib/mock-data";
import { Store, MapPin } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CreateProviderDialog } from "./CreateProviderDialog";

export function AdminProviders() {
  const navigate = useNavigate();

  const { data: providers, isLoading } = useQuery({
    queryKey: ["admin-providers"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("provider_profiles")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data || [];
    },
  });

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{providers?.length} ספקים רשומים</p>
        <CreateProviderDialog />
      </div>
      {providers?.map((p) => (
        <button
          key={p.id}
          onClick={() => navigate(`/provider/db-${p.id}`)}
          className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card text-right w-full hover:shadow-sm transition-shadow"
        >
          <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center shrink-0 overflow-hidden">
            {p.avatar_image ? (
              <img src={p.avatar_image} alt={p.business_name} className="w-full h-full object-cover" />
            ) : (
              <Store className="h-5 w-5 text-accent" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-sm truncate">{p.business_name}</h3>
            <p className="text-xs text-muted-foreground">
              {categoryNames[p.category]?.he || p.category}
            </p>
            {p.address && (
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="h-3 w-3" />
                {p.address}
              </p>
            )}
          </div>
          <div className="text-xs text-muted-foreground shrink-0">
            {new Date(p.created_at).toLocaleDateString("he-IL")}
          </div>
        </button>
      ))}
    </div>
  );
}
