import { forwardRef } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { E_LOGO_DATA_URL } from "./eLogoDataUrl";

export const QR_CARD_WIDTH = 1080;
export const QR_CARD_HEIGHT = 1350;

// System font stack with explicit Hebrew/Arabic fallbacks. We deliberately do
// NOT use the app's web font here: html-to-image rasterizes the card inside an
// isolated SVG that can't reliably reach page web fonts, but system fonts
// (Segoe UI / San Francisco / Noto) cover he/ar/en and export deterministically.
// Proven via scripts/qr-card-export-proof — RTL text renders correctly in the PNG.
const CARD_FONT =
  '-apple-system, "Segoe UI", system-ui, "Noto Sans Hebrew", "Noto Sans Arabic", "Helvetica Neue", Arial, sans-serif';

interface QrCardProps {
  /** Public provider URL encoded by the QR (window.location.origin based). */
  url: string;
  businessName: string;
  caption: string;
  /** Text direction for the card content (rtl for he/ar, ltr for en). */
  dir: "rtl" | "ltr";
}

// Fixed-layout, print-ready branded QR card (1080×1350). Rendered once and used
// both as the on-screen preview (CSS-scaled by the parent) and as the capture
// target for the PNG export — html-to-image reads its real 1080×1350 box.
export const QrCard = forwardRef<HTMLDivElement, QrCardProps>(
  ({ url, businessName, caption, dir }, ref) => {
    return (
      <div
        ref={ref}
        dir={dir}
        style={{
          width: QR_CARD_WIDTH,
          height: QR_CARD_HEIGHT,
          fontFamily: CARD_FONT,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "110px 80px 96px",
          boxSizing: "border-box",
          overflow: "hidden",
          // Warm/orange identity — radial glows + linear base, no blur filter
          // (blur is unreliable in html-to-image; layered gradients are not).
          background:
            "radial-gradient(circle at 16% 12%, rgba(255,207,158,0.55), transparent 46%)," +
            "radial-gradient(circle at 86% 88%, rgba(231,108,41,0.20), transparent 52%)," +
            "linear-gradient(160deg, #FFE7CE 0%, #FFF2E4 46%, #FEFEFE 100%)",
        }}
      >
        {/* Brand logo. Inlined as a base64 data-URI (see eLogoDataUrl.ts) so
            html-to-image renders it in the exported PNG — it can't reliably
            fetch external asset URLs. No blur/filter, so it exports crisply. */}
        <img
          src={E_LOGO_DATA_URL}
          alt="Ehjezly"
          style={{ height: 240, width: "auto", display: "block" }}
        />

        {/* Business name + QR + caption, vertically centered group. */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 56,
          }}
        >
          <div
            style={{
              fontSize: 76,
              lineHeight: 1.15,
              fontWeight: 800,
              color: "#102038",
              textAlign: "center",
              maxWidth: 880,
              wordBreak: "break-word",
            }}
          >
            {businessName}
          </div>

          {/* QR always on a clean white area with a generous quiet zone so it
              scans reliably regardless of the card background. */}
          <div
            style={{
              background: "#ffffff",
              padding: 56,
              borderRadius: 40,
              boxShadow: "0 40px 80px -24px rgba(231,108,41,0.40)",
            }}
          >
            <QRCodeCanvas value={url} size={600} level="M" marginSize={2} />
          </div>

          <div style={{ fontSize: 48, fontWeight: 600, color: "#E76C29", textAlign: "center" }}>
            {caption}
          </div>
        </div>

        {/* URL — always LTR, muted, at the foot of the card. */}
        <div
          dir="ltr"
          style={{
            fontSize: 28,
            color: "rgba(16,32,56,0.45)",
            wordBreak: "break-all",
            textAlign: "center",
            maxWidth: 900,
          }}
        >
          {url}
        </div>
      </div>
    );
  }
);

QrCard.displayName = "QrCard";
