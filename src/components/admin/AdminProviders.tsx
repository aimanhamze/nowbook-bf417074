import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";
import { categoryNames } from "@/lib/mock-data";
import {
  Store,
  MapPin,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  KeyRound,
  AtSign,
  Search,
  X,
  ChevronDown,
  ExternalLink,
  CalendarDays,
  Clock,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { CreateProviderDialog } from "./CreateProviderDialog";
import { EditProviderDialog } from "./EditProviderDialog";
import { ResetPasswordDialog } from "./ResetPasswordDialog";
import { ChangeEmailDialog } from "./ChangeEmailDialog";
import { useLang } from "@/contexts/LangContext";
import { useAdminLastLogins } from "@/hooks/useAdminDashboard";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
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

type Provider = Tables<"provider_profiles">;

// One reorganised provider row: a clean collapsed summary that expands on tap to
// reveal the full action set. Handlers are passed down unchanged from the parent.
function ProviderCard({
  p,
  expanded,
  onToggle,
  onView,
  onEdit,
  onReset,
  onChangeEmail,
  onHide,
  onShow,
  onDelete,
  hidePending,
  lastLoginText,
}: {
  p: Provider;
  expanded: boolean;
  onToggle: () => void;
  onView: () => void;
  onEdit: () => void;
  onReset: () => void;
  onChangeEmail: () => void;
  onHide: () => void;
  onShow: () => void;
  onDelete: () => void;
  hidePending: boolean;
  lastLoginText: string;
}) {
  const { t } = useLang();
  const isActive = p.is_visible !== false;

  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden">
      {/* Collapsed summary — tap toggles the expanded panel */}
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="w-full flex items-center gap-4 p-4 text-start active:scale-[0.99] transition-transform"
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
          <p className="text-xs text-muted-foreground truncate">
            {categoryNames[p.category]?.he || p.category}
          </p>
          {p.address && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{p.address}</span>
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span
            className={cn(
              "text-[10px] font-medium px-1.5 py-0.5 rounded-full",
              isActive ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"
            )}
          >
            {isActive ? `${t("adminStatusActive")} 👁` : `${t("adminStatusHidden")} 🚫`}
          </span>
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <CalendarDays className="h-3 w-3" />
            {new Date(p.created_at).toLocaleDateString("he-IL")}
          </span>
        </div>
        <ChevronDown
          className={cn(
            "h-4 w-4 text-muted-foreground shrink-0 transition-transform duration-200",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Expanded panel — dates + full action set */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: "easeInOut" }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 pt-1 border-t border-border/60">
              {/* Dates — clearly labelled. Last-login comes from the admin-only
                  admin_provider_last_logins() RPC (auth.users.last_sign_in_at),
                  matched by user_id; "never" when the provider never signed in. */}
              <div className="space-y-1.5 my-3">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <CalendarDays className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium text-foreground">{t("adminJoined")}:</span>
                  <span>{new Date(p.created_at).toLocaleDateString("he-IL")}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span className="font-medium text-foreground">{t("adminLastLogin")}:</span>
                  <span>{lastLoginText}</span>
                </div>
              </div>

              {/* Safe actions */}
              <div className="grid grid-cols-2 gap-2">
                <ActionButton icon={ExternalLink} label={t("adminViewPage")} onClick={onView} />
                <ActionButton icon={Pencil} label={t("adminEdit")} onClick={onEdit} />
                <ActionButton icon={KeyRound} label={t("resetPassword")} onClick={onReset} />
                <ActionButton icon={AtSign} label={t("changeEmail")} onClick={onChangeEmail} />
                {isActive ? (
                  <ActionButton
                    icon={EyeOff}
                    label={t("adminHide")}
                    onClick={onHide}
                    disabled={hidePending}
                    tone="amber"
                  />
                ) : (
                  <ActionButton icon={Eye} label={t("adminShow")} onClick={onShow} tone="emerald" />
                )}
              </div>

              {/* Destructive — separated below a divider, full-width, clearly red */}
              <div className="mt-3 pt-3 border-t border-border/60">
                <button
                  onClick={onDelete}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-destructive/10 text-destructive font-medium text-sm hover:bg-destructive/20 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                  {t("adminDelete")}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  disabled,
  tone = "default",
}: {
  icon: typeof Pencil;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: "default" | "amber" | "emerald";
}) {
  const toneCls =
    tone === "amber"
      ? "hover:bg-amber-100 hover:text-amber-700"
      : tone === "emerald"
      ? "hover:bg-emerald-100 hover:text-emerald-700"
      : "hover:bg-accent/10 hover:text-accent";
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-secondary text-secondary-foreground text-xs font-medium transition-colors disabled:opacity-50",
        toneCls
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

export function AdminProviders() {
  const navigate = useNavigate();
  const { t } = useLang();
  const [editingProvider, setEditingProvider] = useState<Provider | null>(null);
  const [deletingProvider, setDeletingProvider] = useState<Provider | null>(null);
  const [hidingProvider, setHidingProvider] = useState<Provider | null>(null);
  const [resettingProvider, setResettingProvider] = useState<Provider | null>(null);
  const [changingEmailProvider, setChangingEmailProvider] = useState<Provider | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "שגיאה בעדכון הספק");
    },
  });

  const deleteProvider = useMutation({
    mutationFn: async (provider: Provider) => {
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
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "שגיאה במחיקת הספק");
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

  // One fetch of all providers' last-login times (user_id → timestamp), shared
  // across every card. Cached, so expanding/collapsing does not refetch.
  const { data: lastLoginMap } = useAdminLastLogins();

  // Resolve a provider's last-login display: a formatted date, "never" if the
  // account exists but never signed in, or "—" if unknown (RPC not yet applied /
  // loading / errored). Never blank, never an error.
  const lastLoginText = (p: Provider): string => {
    if (!lastLoginMap || !lastLoginMap.has(p.user_id)) return "—";
    const ts = lastLoginMap.get(p.user_id);
    return ts ? new Date(ts).toLocaleDateString("he-IL") : t("adminNeverLoggedIn");
  };

  // Client-side filter over the already-loaded list: business name, category
  // (raw + localized he label), and address/city.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return providers || [];
    return (providers || []).filter((p) => {
      const cat = categoryNames[p.category]?.he || p.category;
      return (
        p.business_name?.toLowerCase().includes(q) ||
        p.category?.toLowerCase().includes(q) ||
        cat?.toLowerCase().includes(q) ||
        p.address?.toLowerCase().includes(q)
      );
    });
  }, [providers, search]);

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
      {/* Search bar */}
      <div className="relative">
        <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground pointer-events-none" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("adminSearchProviders")}
          className="w-full h-11 rounded-2xl border border-border bg-card ps-9 pe-9 text-sm outline-none focus:ring-2 focus:ring-accent/40 transition-shadow"
        />
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute top-1/2 -translate-y-1/2 end-2 p-1 rounded-full hover:bg-secondary text-muted-foreground"
            aria-label={t("cancel")}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {filtered.length} {t("adminProvidersRegistered")}
        </p>
        <CreateProviderDialog />
      </div>

      {filtered.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">{t("adminNoProviders")}</p>
        </div>
      ) : (
        filtered.map((p) => (
          <ProviderCard
            key={p.id}
            p={p}
            expanded={expandedId === p.id}
            onToggle={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
            onView={() => navigate(`/provider/${p.id}`)}
            onEdit={() => setEditingProvider(p)}
            onReset={() => setResettingProvider(p)}
            onChangeEmail={() => setChangingEmailProvider(p)}
            onHide={() => setHidingProvider(p)}
            onShow={() => {
              toggleVisibility.mutate({ id: p.id, is_visible: true });
              toast.success("הספק הוצג מחדש");
            }}
            onDelete={() => setDeletingProvider(p)}
            hidePending={toggleVisibility.isPending}
            lastLoginText={lastLoginText(p)}
          />
        ))
      )}

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
