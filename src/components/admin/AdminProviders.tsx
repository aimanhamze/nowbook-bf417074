import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { categoryNames } from "@/lib/mock-data";
import { Store, MapPin, Pencil, Trash2, Eye, EyeOff, KeyRound, AtSign } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CreateProviderDialog } from "./CreateProviderDialog";
import { EditProviderDialog } from "./EditProviderDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ChangeEmailDialog } from "./ChangeEmailDialog";
import { useLang } from "@/contexts/LangContext";
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
  const { t } = useLang();
  const [editingProvider, setEditingProvider] = useState<Tables<"provider_profiles"> | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<Tables<"provider_profiles"> | null>(null);
  const [hidingProvider, setHidingProvider] = useState<Tables<"provider_profiles"> | null>(null);
  const [resettingProvider, setResettingProvider] = useState<Tables<"provider_profiles"> | null>(null);
  const [changingEmailProvider, setChangingEmailProvider] = useState<Tables<"provider_profiles"> | null>(null);
  const queryClient = useQueryClient();

  const toggleVisibility = useMutation({
    mutationFn: async ({ id, is_visible }: { id: string; is_visible: boolean }) => {
      const { error } = await supabase
        .from("provider_profiles")
        .update({ is_visible })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה בעדכון הספק");
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (provider: Tables<"provider_profiles">) => {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("delete-provider", {
        body: { user_id: provider.user_id },
        headers: { Authorization: `Bearer ${session?.access_token}` },
      });
      if (res.error) throw res.error;
      if (res.data?.error) throw new Error(res.data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-providers"] });
      queryClient.invalidateQueries({ queryKey: ["admin-all-roles"] });
      queryClient.invalidateQueries({ queryKey: ["all-providers"] });
      toast.success("הספק נמחק בהצלחה");
      setDeletingProvider(null);
    },
    onError: (err: any) => {
      toast.error(err.message || "שגיאה במחיקת הספק");
    },
  });

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
            onClick={() => navigate(`/provider/${p.id}`)}
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
            <div className="flex gap-1 items-center">
              {/* Visibility badge */}
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${p.is_visible !== false ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                {p.is_visible !== false ? "פעיל 👁" : "מוסתר 🚫"}
              </span>
              {/* Toggle visibility */}
              <button
                onClick={() => {
                  if (p.is_visible !== false) {
                    setHidingProvider(p);
                  } else {
                    toggleVisibility.mutate({ id: p.id, is_visible: true });
                    toast.success("הספק הוצג מחדש");
                  }
                }}
                className={`p-1.5 rounded-lg bg-secondary transition-colors ${p.is_visible !== false ? "hover:bg-amber-100 text-muted-foreground hover:text-amber-600" : "hover:bg-emerald-100 text-muted-foreground hover:text-emerald-600"}`}
                title={p.is_visible !== false ? "הסתר ספק" : "הצג ספק"}
                disabled={toggleVisibility.isPending}
              >
                {p.is_visible !== false ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
              <button
                onClick={() => setEditingProvider(p)}
                className="p-1.5 rounded-lg bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
                title="ערוך ספק"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setResettingProvider(p)}
                className="p-1.5 rounded-lg bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
                title={t("resetPassword")}
              >
                <KeyRound className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setChangingEmailProvider(p)}
                className="p-1.5 rounded-lg bg-secondary hover:bg-accent/10 text-muted-foreground hover:text-accent transition-colors"
                title={t("changeEmail")}
              >
                <AtSign className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setDeletingProvider(p)}
                className="p-1.5 rounded-lg bg-secondary hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors"
                title="מחק ספק"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      ))}

      <EditProviderDialog
        provider={editingProvider}
        open={!!editingProvider}
        onOpenChange={(open) => { if (!open) setEditingProvider(null); }}
      />

      <ResetPasswordDialog
        provider={resettingProvider}
        open={!!resettingProvider}
        onOpenChange={(open) => { if (!open) setResettingProvider(null); }}
      />

      <ChangeEmailDialog
        provider={changingEmailProvider}
        open={!!changingEmailProvider}
        onOpenChange={(open) => { if (!open) setChangingEmailProvider(null); }}
      />

      {/* Hide confirmation */}
      <AlertDialog open={!!hidingProvider} onOpenChange={(open) => { if (!open) setHidingProvider(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>הסתרת ספק</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך להסתיר את "{hidingProvider?.business_name}"? הלקוחות לא יוכלו לראות אותו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-amber-500 text-white hover:bg-amber-600"
              onClick={() => {
                if (hidingProvider) {
                  toggleVisibility.mutate({ id: hidingProvider.id, is_visible: false }, {
                    onSuccess: () => {
                      toast.success("הספק הוסתר");
                      setHidingProvider(null);
                    },
                  });
                }
              }}
              disabled={toggleVisibility.isPending}
            >
              {toggleVisibility.isPending ? "מסתיר..." : "הסתר"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deletingProvider} onOpenChange={(open) => { if (!open) setDeletingProvider(null); }}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת ספק</AlertDialogTitle>
            <AlertDialogDescription>
              האם אתה בטוח שברצונך למחוק את "{deletingProvider?.business_name}"? פעולה זו לא ניתנת לביטול.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row-reverse gap-2">
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deletingProvider && deleteProvider.mutate(deletingProvider)}
              disabled={deleteProvider.isPending}
            >
              {deleteProvider.isPending ? "מוחק..." : "מחק"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
