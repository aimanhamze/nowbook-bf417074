import type { ReactNode } from "react";
import { Globe, Navigation, Phone } from "lucide-react";
import { FaFacebook, FaInstagram, FaTiktok, FaWhatsapp } from "react-icons/fa6";
import { useLang } from "@/contexts/LangContext";
import { buildWhatsAppLink, type SocialLinks } from "@/lib/socialLinks";
import { cn } from "@/lib/utils";

export interface ProviderAction {
  key: "whatsapp" | "call" | "navigate" | "instagram" | "tiktok" | "facebook" | "website";
  href: string;
  /** tel: links stay in this tab; everything else opens a new one. */
  external: boolean;
}

/**
 * What the provider can be reached by, most useful first: message, call,
 * navigate, then the social profiles. Only what the provider filled in.
 */
export function providerActions(
  socialLinks: SocialLinks | null | undefined,
  phone: string | null | undefined,
): ProviderAction[] {
  const actions: ProviderAction[] = [];
  if (socialLinks?.whatsapp) actions.push({ key: "whatsapp", href: buildWhatsAppLink(socialLinks.whatsapp), external: true });
  if (phone?.trim()) actions.push({ key: "call", href: `tel:${phone.trim()}`, external: false });
  if (socialLinks?.waze) actions.push({ key: "navigate", href: socialLinks.waze, external: true });
  if (socialLinks?.instagram) actions.push({ key: "instagram", href: socialLinks.instagram, external: true });
  if (socialLinks?.tiktok) actions.push({ key: "tiktok", href: socialLinks.tiktok, external: true });
  if (socialLinks?.facebook) actions.push({ key: "facebook", href: socialLinks.facebook, external: true });
  if (socialLinks?.website) actions.push({ key: "website", href: socialLinks.website, external: true });
  return actions;
}

/** Columns for n actions: one row up to three, 2×2 for four, rows of three after. */
export function actionColumns(count: number): 1 | 2 | 3 {
  if (count <= 1) return 1;
  if (count === 2 || count === 4) return 2;
  return 3;
}

const ICONS: Record<ProviderAction["key"], ReactNode> = {
  whatsapp: <FaWhatsapp className="h-[18px] w-[18px] shrink-0" style={{ color: "#25D366" }} />,
  call: <Phone className="h-[18px] w-[18px] shrink-0" />,
  navigate: <Navigation className="h-[18px] w-[18px] shrink-0" />,
  instagram: <FaInstagram className="h-[18px] w-[18px] shrink-0" style={{ color: "#E4405F" }} />,
  tiktok: <FaTiktok className="h-[18px] w-[18px] shrink-0" />,
  facebook: <FaFacebook className="h-[18px] w-[18px] shrink-0" style={{ color: "#1877F2" }} />,
  website: <Globe className="h-[18px] w-[18px] shrink-0" />,
};

const LABEL_KEYS = {
  whatsapp: "socialLinksWhatsapp",
  call: "call",
  navigate: "actionNavigate",
  instagram: "socialLinksInstagram",
  tiktok: "socialLinksTiktok",
  facebook: "socialLinksFacebook",
  website: "actionWebsite",
} as const;

const GRID = { 1: "grid-cols-1", 2: "grid-cols-2", 3: "grid-cols-3" } as const;

/**
 * Contact row on the provider page: labeled 44px buttons, icon + word. One
 * action is a single button at its natural width rather than a full-width bar,
 * so it never competes with the Book button.
 */
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
  const single = actions.length === 1;

  return (
    <nav
      aria-label={t("contactActionsLabel")}
      className={cn(single ? "flex" : `grid gap-2 ${GRID[actionColumns(actions.length)]}`, className)}
    >
      {actions.map((action) => (
        <a
          key={action.key}
          href={action.href}
          {...(action.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
          className={cn(
            "flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-2 text-[13px] font-medium text-foreground transition-colors active:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent",
            single && "min-w-[9.5rem] px-5",
          )}
        >
          {ICONS[action.key]}
          <span className="truncate">{t(LABEL_KEYS[action.key])}</span>
        </a>
      ))}
    </nav>
  );
}
