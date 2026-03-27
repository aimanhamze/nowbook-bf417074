import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById } from "@/hooks/useAllProviders";
import { useProviderReviews } from "@/hooks/useReviews";
import { ArrowLeft, Heart, Star, MapPin, Clock, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useLang } from "@/contexts/LangContext";
import ReviewCard from "@/components/reviews/ReviewCard";

const ProviderDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const [liked, setLiked] = useState(false);
  const [coverImgSrc, setCoverImgSrc] = useState("");
  const { lang, t } = useLang();
  const { provider, isLoading } = useProviderById(id);
  const { data: dbReviews } = useProviderReviews(id);

  // Combine mock reviews with real DB reviews
  const realReviewCount = (dbReviews?.length || 0) + (provider?.reviewCount || 0);
  const avgRating = dbReviews && dbReviews.length > 0
    ? ((provider?.rating || 0) * (provider?.reviewCount || 0) + dbReviews.reduce((sum, r) => sum + r.rating, 0)) / realReviewCount
    : provider?.rating || 0;

  useEffect(() => {
    const primary = provider?.coverImage?.trim() || "";
    const fallback = provider?.image?.trim() || "";
    setCoverImgSrc(primary || fallback);
  }, [provider?.id, provider?.coverImage, provider?.image]);

  const handleCoverImageError = () => {
    const primary = provider?.coverImage?.trim() || "";
    const fallback = provider?.image?.trim() || "";

    if (coverImgSrc === primary && fallback && fallback !== primary) {
      setCoverImgSrc(fallback);
      return;
    }

    setCoverImgSrc("");
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!provider) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-muted-foreground">{t("providerNotFound")}</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-28">
      {/* Cover */}
      <div className="relative h-56 bg-gradient-to-br from-accent/20 to-accent/5">
        {coverImgSrc ? (
          <img
            src={coverImgSrc}
            alt={provider.name[lang]}
            className="w-full h-full object-cover"
            onError={handleCoverImageError}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <span className="text-5xl font-bold text-accent/30">{provider.name[lang]?.charAt(0)?.toUpperCase()}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
        <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 pt-10">
          <button onClick={() => navigate(-1)} className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex gap-2">
            <button className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
              <Share2 className="h-5 w-5" />
            </button>
            <button onClick={() => setLiked(!liked)} className="p-2 rounded-full bg-card/80 backdrop-blur-sm active:scale-95">
              <Heart className={`h-5 w-5 transition-colors ${liked ? "fill-accent text-accent" : ""}`} />
            </button>
          </div>
        </div>
      </div>

      {/* Info */}
      <motion.div className="px-5 -mt-6 relative" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}>
        <div className="bg-card rounded-2xl border border-border p-5 shadow-sm">
          <h1 className="text-xl font-bold mb-1">{provider.name[lang]}</h1>
          <div className="flex items-center gap-3 text-sm text-muted-foreground mb-3">
            {realReviewCount > 0 && (
              <span className="flex items-center gap-1">
                <Star className="h-4 w-4 fill-accent text-accent" />
                <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
                ({realReviewCount})
              </span>
            )}
            {provider.distance !== "—" && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" />
                {provider.distance} {t("km")}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <MapPin className="h-3 w-3 shrink-0" />
            {provider.address[lang]}
          </p>
        </div>
      </motion.div>

      {/* About */}
      {provider.about[lang] && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-2">{t("about")}</h2>
          <p className="text-sm leading-relaxed">{provider.about[lang]}</p>
        </section>
      )}

      {/* Services */}
      {provider.services.length > 0 && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("services")}</h2>
          <div className="flex flex-col gap-2">
            {provider.services.map((service, i) => (
              <motion.div key={service.id} initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06, duration: 0.4, ease: [0.16, 1, 0.3, 1] }} className="flex items-center justify-between p-4 rounded-xl bg-secondary/60">
                <div>
                  <p className="text-sm font-medium">{service.name[lang]}</p>
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                    <Clock className="h-3 w-3" />
                    {service.duration} {t("min")}
                  </p>
                </div>
                <div className="text-left">
                  <p className="text-sm font-bold">₪{service.price}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Working Hours */}
      {provider.workingHours.length > 0 && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("hours")}</h2>
          <div className="flex flex-col gap-1.5">
            {provider.workingHours.map((wh, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{wh.day[lang]}</span>
                <span className="font-medium">{wh.hours}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Photos */}
      {provider.photos.length > 0 && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("photos")}</h2>
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-none -mx-1 px-1">
            {provider.photos.map((photo, i) => (
              <img key={i} src={photo} alt={`${provider.name[lang]} ${i + 1}`} className="w-32 h-32 rounded-xl object-cover shrink-0" loading="lazy" />
            ))}
          </div>
        </section>
      )}

      {/* Reviews */}
      {(provider.reviews.length > 0 || (dbReviews && dbReviews.length > 0)) && (
        <section className="px-5 mt-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground mb-3">{t("reviews")}</h2>
          <div className="flex flex-col gap-3">
            {/* Real DB reviews first */}
            {dbReviews?.map((review, i) => (
              <ReviewCard key={review.id} review={review} index={i} />
            ))}
            {/* Mock reviews */}
            {provider.reviews.map((review, i) => (
              <motion.div key={`mock-${i}`} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: (i + (dbReviews?.length || 0)) * 0.08, duration: 0.4 }} className="p-4 rounded-xl bg-secondary/60">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-sm font-semibold">{review.name}</span>
                  <span className="text-xs text-muted-foreground">{review.date[lang]}</span>
                </div>
                <div className="flex gap-0.5 mb-2">
                  {Array.from({ length: 5 }).map((_, s) => (
                    <Star key={s} className={`h-3 w-3 ${s < review.rating ? "fill-accent text-accent" : "text-border"}`} />
                  ))}
                </div>
                <p className="text-sm text-muted-foreground">{review.comment[lang]}</p>
              </motion.div>
            ))}
          </div>
        </section>
      )}

      {/* Sticky Book Button */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-card/80 backdrop-blur-xl border-t border-border">
        <button
          onClick={() => navigate(`/provider/${provider.id}/book`)}
          className="w-full py-3.5 rounded-2xl bg-accent text-accent-foreground font-semibold text-sm active:scale-[0.98] transition-transform"
        >
          {t("bookAppointment")}
        </button>
      </div>
    </div>
  );
};

export default ProviderDetail;
