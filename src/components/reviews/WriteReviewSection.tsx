import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCircle, PenLine } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useUserReviewEligibility } from "@/hooks/useUserReviewEligibility";
import ReviewForm from "@/components/reviews/ReviewForm";

interface Props {
  providerId: string;
}

export default function WriteReviewSection({ providerId }: Props) {
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const { eligibleBookingId, isLoading } = useUserReviewEligibility(providerId);

  // ── State 1: not logged in ─────────────────────────────────────────────────
  if (!user) {
    return (
      <p className="mt-6 px-5 text-xs text-muted-foreground">
        {t("reviewsLogInToReview")}{" "}
        <button
          onClick={() => navigate("/auth")}
          className="font-medium text-accent underline-offset-2 hover:underline"
        >
          {t("signIn")}
        </button>
      </p>
    );
  }

  // ── Wait for queries before deciding ──────────────────────────────────────
  if (isLoading) return null;

  // ── State 2: no eligible booking ─────────────────────────────────────────
  if (!eligibleBookingId && !submitted) return null;

  // ── State 3: eligible (or just submitted) ────────────────────────────────
  const handleSubmitted = () => {
    setSubmitted(true);
    setExpanded(false);
    queryClient.invalidateQueries({ queryKey: ["user-reviews-for-provider"] });
    queryClient.invalidateQueries({ queryKey: ["reviews", providerId] });
  };

  return (
    <section className="mt-8 px-5">
      <div className="rounded-2xl border border-border/50 bg-card p-4 shadow-[0_2px_12px_-4px_rgba(0,0,0,0.06)]">
        <AnimatePresence mode="wait">
          {submitted ? (
            // Thank-you state
            <motion.div
              key="thankyou"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="flex items-center gap-2.5 py-1"
            >
              <CheckCircle className="h-4 w-4 shrink-0 text-green-600" />
              <span className="text-sm font-medium text-foreground">
                {t("reviewsThankYou")}
              </span>
            </motion.div>
          ) : !expanded ? (
            // Collapsed trigger
            <motion.button
              key="trigger"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              onClick={() => setExpanded(true)}
              className="flex w-full items-center gap-2 py-1 text-start text-sm font-medium text-accent active:opacity-70 transition-opacity"
            >
              <PenLine className="h-4 w-4 shrink-0" />
              {t("reviewsWriteAReview")}
            </motion.button>
          ) : (
            // Expanded form
            <motion.div
              key="form"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            >
              <ReviewForm
                bookingId={eligibleBookingId!}
                providerId={providerId}
                onSubmitted={handleSubmitted}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
