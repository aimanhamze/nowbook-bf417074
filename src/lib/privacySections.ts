import type { TranslationKey } from "@/lib/translations";

/**
 * The privacy policy's sections, in reading order.
 *
 * Keeping the order here (rather than in JSX) means adding, removing or
 * reordering a section is a one-line change, and the page stays a plain
 * `.map()`. Every body may contain "\n\n"-separated paragraphs and "• "
 * bullet lines; the page renders them with `whitespace-pre-line`.
 */
export interface PrivacySection {
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /**
   * An extra paragraph that is dropped entirely when any business slot it
   * needs is empty — that is how an optional detail (the VAT number, the
   * phone) disappears cleanly instead of leaving a stranded label behind.
   */
  optionalBodyKey?: TranslationKey;
}

export const PRIVACY_SECTIONS: readonly PrivacySection[] = [
  { titleKey: "privacyWhoTitle", bodyKey: "privacyWhoBody", optionalBodyKey: "privacyWhoVat" },
  { titleKey: "privacyCustomerDataTitle", bodyKey: "privacyCustomerDataBody" },
  { titleKey: "privacyProviderDataTitle", bodyKey: "privacyProviderDataBody" },
  { titleKey: "privacyWhatsappTitle", bodyKey: "privacyWhatsappBody" },
  { titleKey: "privacyPaymentTitle", bodyKey: "privacyPaymentBody" },
  { titleKey: "privacySharingTitle", bodyKey: "privacySharingBody" },
  { titleKey: "privacyCookiesTitle", bodyKey: "privacyCookiesBody" },
  { titleKey: "privacyRightsTitle", bodyKey: "privacyRightsBody" },
  { titleKey: "privacyChangesTitle", bodyKey: "privacyChangesBody" },
  { titleKey: "privacyContactTitle", bodyKey: "privacyContactBody", optionalBodyKey: "privacyContactPhone" },
] as const;
