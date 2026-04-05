import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { categoryNames } from "@/lib/mock-data";
import { Store, MapPin, Pencil, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CreateProviderDialog } from "./CreateProviderDialog";
import { EditProviderDialog } from "./EditProviderDialog";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Tables } from "@/integrations/supabase/types";

export function AdminProviders() {
  const navigate = useNavigate();
  const [editingProvider, setEditingProvider] = useState<Tables<"provider_profiles"> | null>(null);

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
        <div
          key={p.id}
          className="flex items-center gap-4 p-4 rounded-2xl border border-border bg-card"
        >
          <button
            onClick={() => navigate(`/provider/db-${p.id}`)}
            className="flex items-center gap-4 flex-1 min-w-0 text-right"
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
          </button>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <span className="text-xs text-muted-foreground">
              {new Date(p.created_at).toLocaleDateString("he-IL")}
            </span>
            <button
              onClick={() => setEditingProvider(p)}
              className="p-1.5 rounded-lg bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
              title="ערוך ספק"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ))}

      <EditProviderDialog
        provider={editingProvider}
        open={!!editingProvider}
        onOpenChange={(open) => { if (!open) setEditingProvider(null); }}
      />
    </div>
  );
}
