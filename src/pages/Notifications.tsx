import { Bell, CheckCheck } from "lucide-react";
import { BackArrow } from "@/components/ui/directional-icon";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { formatDistanceToNow } from "date-fns";
import { he, ar, enUS } from "date-fns/locale";
import { useState } from "react";

const typeIcons: Record<string, string> = {
  booking_new: "🎉",
  booking_cancelled: "❌",
  booking_confirmed: "✅",
  reminder: "⏰",
  general: "🔔",
};

const Notifications = () => {
  const navigate = useNavigate();
  const { lang, t } = useLang();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const dateFnsLocale = lang === "he" ? he : lang === "ar" ? ar : enUS;

  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);

  const { data: notifData, isLoading } = useQuery({
    queryKey: ["notifications", user?.id, page],
    queryFn: async () => {
      if (!user) return { items: [], hasMore: false };
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
      if (error) throw error;
      return { items: data || [], hasMore: (data || []).length === PAGE_SIZE };
    },
    enabled: !!user,
  });

  const notifications = notifData?.items ?? [];
  const hasMore = notifData?.hasMore ?? false;

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: ["notifications", user?.id] });
      const previous = queryClient.getQueryData(["notifications", user?.id]);
      queryClient.setQueryData(["notifications", user?.id], (old: typeof notifications) =>
        (old || []).map((n) => n.id === id ? { ...n, is_read: true } : n)
      );
      queryClient.setQueryData<number>(["unread-notifications", user?.id], (old = 0) =>
        Math.max(0, old - 1)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(["notifications", user?.id], context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications"] });
    },
  });

  const markAllReadMutation = useMutation({
    mutationFn: async () => {
      if (!user) return;
      const { error } = await supabase
        .from("notifications")
        .update({ is_read: true })
        .eq("user_id", user.id)
        .eq("is_read", false);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications", user?.id] });
      queryClient.invalidateQueries({ queryKey: ["unread-notifications", user?.id] });
    },
  });

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground">{t("signInToManage")}</p>
        <Button onClick={() => navigate("/auth")}>{t("signInUp")}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4 flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="active:scale-95">
          <BackArrow className="h-5 w-5" />
        </button>
        <h1 className="text-xl font-bold flex-1">{t("notificationsLabel")}</h1>
        {unreadCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-xs text-accent"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
          >
            <CheckCheck className="h-4 w-4 mr-1" />
            {t("markAllRead")}
          </Button>
        )}
      </header>

      {isLoading ? (
        <div className="px-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-2xl bg-secondary animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="px-5 flex flex-col items-center justify-center py-20"
        >
          <Bell className="h-12 w-12 text-muted-foreground/40 mb-4" />
          <p className="text-muted-foreground text-sm">{t("noNotificationsYet")}</p>
        </motion.div>
      ) : (
        <div className="px-5 space-y-2">
          {notifications.map((notif, i) => (
            <motion.button
              key={notif.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04, duration: 0.25 }}
              onClick={() => {
                if (!notif.is_read) markReadMutation.mutate(notif.id);
                if (notif.url) navigate(notif.url);
              }}
              className={`w-full text-right rounded-2xl border p-4 space-y-1 transition-colors active:scale-[0.99] ${
                notif.is_read
                  ? "border-border bg-card"
                  : "border-accent/30 bg-accent/5"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">
                  {typeIcons[notif.type] || typeIcons.general}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{notif.title}</p>
                    {!notif.is_read && (
                      <span className="w-2 h-2 rounded-full bg-accent shrink-0" />
                    )}
                  </div>
                  {notif.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                      {notif.body}
                    </p>
                  )}
                  <p className="text-[10px] text-muted-foreground/70 mt-1">
                    {formatDistanceToNow(new Date(notif.created_at), {
                      addSuffix: true,
                      locale: dateFnsLocale,
                    })}
                  </p>
                </div>
              </div>
            </motion.button>
          ))}
          <div className="flex justify-between items-center pt-2 pb-4">
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            >
              ← {t("prev")}
            </button>
            <span className="text-xs text-muted-foreground">
              {lang === "he" ? `עמוד ${page + 1}` : lang === "ar" ? `صفحة ${page + 1}` : `Page ${page + 1}`}
            </span>
            <button
              disabled={!hasMore}
              onClick={() => setPage((p) => p + 1)}
              className="text-sm text-accent font-medium disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {t("next")} →
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Notifications;
