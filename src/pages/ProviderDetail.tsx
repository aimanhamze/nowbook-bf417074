import { useParams, useNavigate } from "react-router-dom";
import { categoryNames } from "@/lib/mock-data";
import { useProviderById } from "@/hooks/useAllProviders";
import { useProviderReviews } from "@/hooks/useReviews";
import { ArrowLeft, Heart, Star, MapPin, Clock, Share2 } from "lucide-react";
import { motion } from "framer-motion";
import { useEffect, useState } from "react";
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
    <div className="min-h-screen pb-36">
      {/* Cover */}
      <div className="relative h-56 bg-gradient-to-br from-accent/20 to-accent/5">
...
      {/* Sticky Book Button */}
      <div className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-card/90 p-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] backdrop-blur-xl shadow-lg">
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
