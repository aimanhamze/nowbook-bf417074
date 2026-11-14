import type { AcademyCourseRow } from "@/integrations/supabase/academyTypes";
import { buildWhatsAppLink, type SocialLinks } from "@/lib/socialLinks";

/**
 * Where "Directions" on a course goes: a maps search for the COURSE's own
 * address text (a course can meet somewhere other than the branch), else the
 * academy's Waze link, else nothing — the button is hidden. Online courses
 * have no place to navigate to.
 */
export function courseDirectionsUrl(
  course: Pick<AcademyCourseRow, "location_type" | "address">,
  socialLinks: SocialLinks | null | undefined,
): string | null {
  if (course.location_type !== "physical") return null;
  const address = course.address?.trim();
  if (address) return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
  return socialLinks?.waze?.trim() || null;
}

/**
 * The academy's WhatsApp: its WhatsApp social link, else its phone, else
 * nothing — the button is hidden. The phone is formatted exactly like the
 * other customer → provider WhatsApp links (BookingParts).
 */
export function academyWhatsAppUrl(
  socialLinks: SocialLinks | null | undefined,
  phone: string | null | undefined,
): string | null {
  const social = socialLinks?.whatsapp?.trim();
  if (social) return buildWhatsAppLink(social);
  const digits = (phone ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  return `https://wa.me/972${digits.startsWith("0") ? digits.slice(1) : digits}`;
}
