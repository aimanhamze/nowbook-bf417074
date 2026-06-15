import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ImageDown, Link as LinkIcon, Loader2 } from "lucide-react";
import { toPng } from "html-to-image";
import { toast } from "sonner";
import { useLang } from "@/contexts/LangContext";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { BackArrow } from "@/components/ui/directional-icon";
import { Button } from "@/components/ui/button";
import { QrCard, QR_CARD_WIDTH, QR_CARD_HEIGHT } from "@/components/qr/QrCard";

// On-screen preview width (px) for the branded card. The full 1080px card is
// CSS-scaled down into this viewport; the captured node keeps its real size.
const CARD_PREVIEW_WIDTH = 300;

// Standalone provider QR page. Encodes the provider's OWN public page URL
// (window.location.origin + /provider/{id}) so the QR always points at the
// exact host the app is served from — matching the customer share button,
// which shares window.location.href. No new data is read or exposed: this
// uses only the logged-in provider's existing provider_profiles.id.
export default function ProviderQrCode() {
  const { t, isRtl } = useLang();
  const { user, isProvider } = useAuth();
  const navigate = useNavigate();
  const { profile, isLoading } = useProviderProfile();
  const cardRef = useRef<HTMLDivElement>(null);
  const [cardExporting, setCardExporting] = useState(false);

  useEffect(() => {
    if (user && !isProvider) {
      navigate("/", { replace: true });
    }
  }, [user, isProvider, navigate]);

  const publicUrl = useMemo(
    () => (profile ? `${window.location.origin}/provider/${profile.id}` : ""),
    [profile]
  );

  if (!user || !isProvider) return null;

  // No profile yet — mirror the other provider pages' graceful guard.
  if (!isLoading && !profile) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-5 gap-4">
        <p className="text-muted-foreground text-center">{t("profileNotSetup")}</p>
        <Button onClick={() => navigate("/")}>{t("home")}</Button>
      </div>
    );
  }

  // Sanitize the business name into a safe file slug; fall back to the id.
  const fileSlug =
    (profile?.business_name || "")
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || profile?.id || "page";

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl);
      toast.success(t("shareLinkCopied"));
    } catch {
      toast.error(publicUrl);
    }
  };

  // Rasterize the branded card node to a PNG via html-to-image. The card is
  // rendered at full 1080×1350 (CSS-scaled only for the preview), so passing
  // those dimensions yields a print-ready file. System fonts on the card make
  // the he/ar/en text render reliably in the exported raster.
  const handleDownloadCard = async () => {
    if (!cardRef.current) return;
    setCardExporting(true);
    try {
      const dataUrl = await toPng(cardRef.current, {
        width: QR_CARD_WIDTH,
        height: QR_CARD_HEIGHT,
        pixelRatio: 1,
        cacheBust: true,
      });
      const link = document.createElement("a");
      link.href = dataUrl;
      link.download = `dorak-card-${fileSlug}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch {
      toast.error(t("qrDownloadCard"));
    } finally {
      setCardExporting(false);
    }
  };

  const ready = !!profile && !!publicUrl;
  const cardScale = CARD_PREVIEW_WIDTH / QR_CARD_WIDTH;

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate("/profile")} className="active:scale-95" aria-label={t("profile")}>
            <BackArrow className="h-5 w-5" />
          </button>
          <h1 className="text-xl font-bold flex-1">{t("qrPageTitle")}</h1>
        </div>
      </header>

      <div className="px-5">
        {!ready ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 className="h-7 w-7 animate-spin text-accent" />
          </div>
        ) : (
          <div className="flex flex-col items-center">
            {/* Branded, print-ready card — the only QR shown. On-screen preview
                is the full 1080×1350 card CSS-scaled into a fixed viewport and
                overflow-clipped, so the oversized node never causes horizontal
                overflow in RTL. The same node is captured for the PNG export. */}
            <div
              dir="ltr"
              className="rounded-3xl overflow-hidden shadow-[0_24px_60px_-24px_rgba(231,108,41,0.45)]"
              style={{
                width: CARD_PREVIEW_WIDTH,
                height: QR_CARD_HEIGHT * cardScale,
                position: "relative",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  transform: `scale(${cardScale})`,
                  transformOrigin: "top left",
                }}
              >
                <QrCard
                  ref={cardRef}
                  url={publicUrl}
                  businessName={profile!.business_name}
                  caption={t("qrCaption")}
                  dir={isRtl ? "rtl" : "ltr"}
                />
              </div>
            </div>

            <div className="flex gap-3 w-full max-w-sm mt-6">
              <Button onClick={handleDownloadCard} disabled={cardExporting} className="flex-1 gap-2">
                {cardExporting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImageDown className="h-4 w-4" />
                )}
                {t("qrDownloadCard")}
              </Button>
              <Button onClick={handleCopyLink} variant="outline" className="flex-1 gap-2">
                <LinkIcon className="h-4 w-4" />
                {t("qrCopyLink")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
