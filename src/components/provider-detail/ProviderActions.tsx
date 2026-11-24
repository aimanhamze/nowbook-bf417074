import type { ReactNode } from "react";
import { Globe, Phone } from "lucide-react";
import { FaFacebook, FaInstagram, FaTiktok, FaWaze, FaWhatsapp } from "react-icons/fa6";
import { useLang } from "@/contexts/LangContext";
import { buildWhatsAppLink, type SocialLinks } from "@/lib/socialLinks";
import { cn } from "@/lib/utils";

export interface ProviderAction {
  key: "whatsapp" | "call" | "instagram" | "tiktok" | "facebook" | "navigate" | "website";
  href: string;
  /** tel: links stay in this tab; everything else opens a new one. */
  external: boolean;
}

/**
 * What the provider can be reached by. The order is the page's original icon
 * row (WhatsApp, Instagram, TikTok, Facebook, Waze, website) with Call added
 * next to WhatsApp. Only what the provider filled in.
 */
export function providerActions(
  socialLinks: SocialLinks | null | undefined,
  phone: string | null | undefined,
): ProviderAction[] {
  const actions: ProviderAction[] = [];
  if (socialLinks?.whatsapp) actions.push({ key: "whatsapp", href: buildWhatsAppLink(socialLinks.whatsapp), external: true });
  if (phone?.trim()) actions.push({ key: "call", href: `tel:${phone.trim()}`, external: false });
  if (socialLinks?.instagram) actions.push({ key: "instagram", href: socialLinks.instagram, external: true });
  if (socialLinks?.tiktok) actions.push({ key: "tiktok", href: socialLinks.tiktok, external: true });
  if (socialLinks?.facebook) actions.push({ key: "facebook", href: socialLinks.facebook, external: true });
  if (socialLinks?.waze) actions.push({ key: "navigate", href: socialLinks.waze, external: true });
  if (socialLinks?.website) actions.push({ key: "website", href: socialLinks.website, external: true });
  return actions;
}

// Tinted 48px frames in each platform's own colour. Call has no brand colour,
// so it takes the app's accent in the same 15% tint.
const LOOK: Record<ProviderAction["key"], { icon: ReactNode; frame: string }> = {
  whatsapp: { icon: <FaWhatsapp className="h-6 w-6" style={{ color: "#25D366" }} />, frame: "bg-[#25D366]/15" },
  call: { icon: <Phone className="h-[22px] w-[22px] text-accent" />, frame: "bg-accent/15" },
  instagram: { icon: <FaInstagram className="h-6 w-6" style={{ color: "#E4405F" }} />, frame: "bg-[#E4405F]/15" },
  tiktok: { icon: <FaTiktok className="h-6 w-6" />, frame: "bg-foreground/10" },
  facebook: { icon: <FaFacebook className="h-6 w-6" style={{ color: "#1877F2" }} />, frame: "bg-[#1877F2]/15" },
  navigate: { icon: <FaWaze className="h-6 w-6" style={{ color: "#05C3DE" }} />, frame: "bg-[#05C3DE]/15" },
  website: { icon: <Globe className="h-6 w-6" />, frame: "bg-foreground/10" },
};

const LABEL_KEYS = {
  whatsapp: "socialLinksWhatsapp",
  call: "call",
  instagram: "socialLinksInstagram",
  tiktok: "socialLinksTiktok",
  facebook: "socialLinksFacebook",
  navigate: "socialLinksWaze",
  website: "socialLinksWebsite",
} as const;

/** Contact row on the provider page: tinted 48px icon buttons, named for screen readers. */
export function ProviderActions({
  socialLinks,
  phone,
  className,
}: {
  socialLinks: SocialLinks | null | undefined;
  phone: string | null | undefined;
  className?: string;
}) {
  const { t } = useLang();
  const actions = providerActions(socialLinks, phone);
  if (actions.length === 0) return null;

  return (
    <nav aria-label={t("contactActionsLabel")} className={cn("flex flex-wrap gap-3", className)}>
      {actions.map((action) => (
        <a
          key={action.key}
          href={action.href}
          aria-label={t(LABEL_KEYS[action.key])}
          {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl ring-1 ring-inset ring-white/40 transition-all hover:brightness-110 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            LOOK[action.key].frame,
          )}
        >
          {LOOK[action.key].icon}
        </a>
      ))}
    </nav>
  );
}
