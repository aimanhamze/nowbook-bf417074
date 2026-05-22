import { Star } from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import type { Review } from "@/hooks/useReviews";

interface ReviewCardProps {
  review: Review;
  index?: number;
}

const ReviewCard = ({ review, index = 0 }: ReviewCardProps) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
      className="surface-soft p-4 rounded-xl"
    >
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-sm font-semibold">
          {review.display_name || "Anonymous"}
        </span>
        <span className="text-xs text-muted-foreground">
          {format(new Date(review.created_at), "dd/MM/yyyy")}
        </span>
      </div>
      <div className="flex gap-0.5 mb-2">
        {Array.from({ length: 5 }).map((_, s) => (
          <Star
            key={s}
            className={`h-3 w-3 ${
              s < review.rating ? "fill-accent text-accent" : "text-border"
            }`}
          />
        ))}
      </div>
      {review.comment && (
        <p className="text-sm text-muted-foreground">{review.comment}</p>
      )}
    </motion.div>
  );
};

export default ReviewCard;
