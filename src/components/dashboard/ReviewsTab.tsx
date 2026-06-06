import { Star } from "lucide-react";
import { useLang } from "@/contexts/LangContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { useProviderReviews } from "@/hooks/useReviews";
import ReviewCard from "@/components/reviews/ReviewCard";

// Read-only reviews view for the provider's own business. Rating + count are
// computed from the actual review rows (NOT provider_profiles.average_rating,
// which is unmaintained) — mirrors ProviderDetail's live computation.
export function ReviewsTab() {
  const { t } = useLang();
  const { profile } = useProviderProfile();
  // RLS on reviews is public SELECT, so the provider can read their own rows.
  const { data: reviews = [], isLoading } = useProviderReviews(profile?.id);

  const count = reviews.length;
  const average = count > 0 ? reviews.reduce((sum, r) => sum + r.rating, 0) / count : 0;

  // Distribution 5★ → 1★, computed from the same rows.
  const distribution = [5, 4, 3, 2, 1].map((star) => {
    const n = reviews.filter((r) => r.rating === star).length;
    return { star, n, pct: count > 0 ? (n / count) * 100 : 0 };
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-28 rounded-2xl bg-secondary animate-pulse" />
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl bg-secondary animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">{t("reviews")}</h2>

      {count === 0 ? (
        <div className="text-center py-14 rounded-2xl border border-dashed border-border">
          <Star className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
          <p className="text-sm font-medium text-foreground">{t("noReviewsYet")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("noReviewsYetHelp")}</p>
        </div>
      ) : (
        <>
          {/* Summary: big average + star row + distribution bars */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-4">
              <div className="shrink-0 text-center">
                <p className="text-4xl font-extrabold leading-none tabular-nums">{average.toFixed(1)}</p>
                <div className="mt-1.5 flex justify-center gap-0.5">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star
                      key={s}
                      className={`h-3.5 w-3.5 ${s < Math.round(average) ? "fill-accent text-accent" : "text-border"}`}
                    />
                  ))}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {t("reviewsCount").replace("{count}", String(count))}
                </p>
              </div>

              <div className="flex-1 space-y-1.5">
                {distribution.map(({ star, n, pct }) => (
                  <div key={star} className="flex items-center gap-2">
                    <span className="flex w-6 shrink-0 items-center gap-0.5 text-[11px] text-muted-foreground tabular-nums">
                      {star}
                      <Star className="h-2.5 w-2.5 fill-muted-foreground/40 text-muted-foreground/40" />
                    </span>
                    {/* Track is a block; the fill grows from the inline-start,
                        so it's direction-correct in both LTR and RTL. */}
                    <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-5 shrink-0 text-end text-[11px] text-muted-foreground tabular-nums">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* List — reuse the customer-facing ReviewCard as-is */}
          <div className="space-y-3">
            {reviews.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
