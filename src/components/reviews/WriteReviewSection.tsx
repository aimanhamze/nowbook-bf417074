import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, PenLine } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useUserReviewEligibility } from "@/hooks/useUserReviewEligibility";
import { saveRedirectAfterLogin } from "@/lib/redirectAfterLogin";
import ReviewForm from "@/components/reviews/ReviewForm";

interface Props {
  providerId: string;
}

/**
 * The "write a review" part of the provider page's reviews section (the page
 * supplies the section, its heading and its side padding).
 *  - signed out: one line with a sign-in link
 *  - signed in, no completed booking to review: nothing
 *  - eligible: a button that opens the form in place
 */
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
      <p className="text-start text-sm text-foreground/70">
        {t("reviewsLogInToReview")}{" "}
        <button
          type="button"
          onClick={() => { saveRedirectAfterLogin(); navigate("/auth"); }}
          className="inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-4"
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

  if (submitted) {
    return (
      <p className="mt-3 flex min-h-11 items-center gap-2.5 text-start text-sm font-medium text-foreground">
        <CheckCircle aria-hidden className="h-4 w-4 shrink-0 text-green-600" />
        {t("reviewsThankYou")}
      </p>
    );
  }

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border bg-card px-4 text-sm font-medium text-foreground transition-colors active:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <PenLine aria-hidden className="h-4 w-4 shrink-0" />
        {t("reviewsWriteAReview")}
      </button>
    );
  }

  return (
    <div className="mt-3">
      <ReviewForm bookingId={eligibleBookingId!} providerId={providerId} onSubmitted={handleSubmitted} />
    </div>
  );
}
