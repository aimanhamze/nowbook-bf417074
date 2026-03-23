import { useState } from "react";
import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { useSubmitReview } from "@/hooks/useReviews";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { toast } from "sonner";

interface ReviewFormProps {
  bookingId: string;
  providerId: string;
  onSubmitted?: () => void;
}

const ReviewForm = ({ bookingId, providerId, onSubmitted }: ReviewFormProps) => {
  const [rating, setRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [comment, setComment] = useState("");
  const { user } = useAuth();
  const { t } = useLang();
  const submitReview = useSubmitReview();

  const handleSubmit = () => {
    if (!user || rating === 0) return;

    submitReview.mutate(
      {
        user_id: user.id,
        provider_id: providerId,
        booking_id: bookingId,
        rating,
        comment: comment.trim(),
        display_name: user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split("@")[0] || t("guest"),
      },
      {
        onSuccess: () => {
          toast.success(t("reviewSubmitted"));
          onSubmitted?.();
        },
        onError: () => {
          toast.error(t("reviewError"));
        },
      }
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-2xl border border-border bg-card p-4 space-y-3"
    >
      <p className="text-sm font-semibold">{t("rateExperience")}</p>

      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onMouseEnter={() => setHoveredStar(star)}
            onMouseLeave={() => setHoveredStar(0)}
            onClick={() => setRating(star)}
            className="p-0.5 active:scale-110 transition-transform"
          >
            <Star
              className={`h-7 w-7 transition-colors ${
                star <= (hoveredStar || rating)
                  ? "fill-accent text-accent"
                  : "text-border"
              }`}
            />
          </button>
        ))}
      </div>

      <textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        placeholder={t("writeReview")}
        maxLength={500}
        className="w-full rounded-xl bg-secondary/60 border-0 p-3 text-sm resize-none h-20 placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
      />

      <button
        onClick={handleSubmit}
        disabled={rating === 0 || submitReview.isPending}
        className="w-full py-2.5 rounded-xl bg-accent text-accent-foreground text-sm font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
      >
        {submitReview.isPending ? "..." : t("submitReview")}
      </button>
    </motion.div>
  );
};

export default ReviewForm;
