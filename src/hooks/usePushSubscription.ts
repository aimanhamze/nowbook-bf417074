import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

const VAPID_PUBLIC_KEY = "BJPmRF1BhA13ZFnwfYH_3ibof3BY0hCzqUhs2rZVQ9O_h_m5PJB5cSoU-QWqMevYuPeL6m-pksb4J7cvTk-t290";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushSubscription() {
  const { user } = useAuth();
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [loading, setLoading] = useState(false);

  const persistSubscription = async (subscription: PushSubscription) => {
    if (!user) return;

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint;
    const p256dh = subJson.keys?.p256dh;
    const auth = subJson.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      throw new Error("Invalid push subscription payload");
    }

    const { error } = await supabase.from("push_subscriptions").upsert(
      {
        user_id: user.id,
        endpoint,
        p256dh,
        auth,
      },
      { onConflict: "user_id,endpoint" }
    );

    if (error) throw error;
  };

  useEffect(() => {
    setIsSupported("serviceWorker" in navigator && "PushManager" in window);
  }, []);

  useEffect(() => {
    if (!isSupported || !user) return;
    // Check existing subscription
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      setIsSubscribed(!!sub);

      // Re-sync subscription record in case DB row was removed
      if (sub) {
        try {
          await persistSubscription(sub);
        } catch {
          // Silently ignore sync failures
        }
      }
    });
  }, [isSupported, user]);

  const subscribe = async () => {
    if (!user || !isSupported) return;
    setLoading(true);
    try {
      if (Notification.permission === "denied") {
        throw new Error("Notifications permission is blocked in browser settings");
      }

      // Use the VitePWA-generated SW (which imports sw-push.js handlers)
      const registration = await navigator.serviceWorker.ready;

      // Force-refresh subscription to avoid stale VAPID key subscriptions
      const existingSubscription = await registration.pushManager.getSubscription();
      if (existingSubscription) {
        await existingSubscription.unsubscribe();
        await supabase
          .from("push_subscriptions")
          .delete()
          .eq("user_id", user.id)
          .eq("endpoint", existingSubscription.endpoint);
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });

      await persistSubscription(subscription);
      setIsSubscribed(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("blocked") || message.includes("denied")) {
        toast.error("הרשאות התראות חסומות בדפדפן — אנא אפשר בהגדרות");
      } else {
        toast.error("שגיאה בהפעלת התראות: " + message);
      }
    } finally {
      setLoading(false);
    }
  };

  const unsubscribe = async () => {
    if (!user) return;
    setLoading(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (registration) {
        const sub = await registration.pushManager.getSubscription();
        if (sub) {
          await sub.unsubscribe();
          await supabase
            .from("push_subscriptions")
            .delete()
            .eq("user_id", user.id)
            .eq("endpoint", sub.endpoint);
        }
      }
      setIsSubscribed(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("שגיאה בביטול התראות: " + message);
    } finally {
      setLoading(false);
    }
  };

  return { isSupported, isSubscribed, loading, subscribe, unsubscribe };
}
