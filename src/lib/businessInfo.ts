/**
 * Public business identity — the details a visitor (or a Meta Business
 * Verification reviewer) must be able to find without logging in.
 *
 * ⚠️ PLACEHOLDERS — LEGAL_NAME, VAT_NUMBER and PHONE are awaiting the real
 * values from the business owner. Replace the three strings below and nothing
 * else in the app needs to change: the footer and every privacy-policy section
 * read from here, and the translation strings carry {legalName} / {vat} /
 * {phone} / {email} slots that `fillBusiness()` fills in at render time.
 */
export const BUSINESS = {
  /** Registered legal name, as it appears on the עוסק פטור registration. */
  legalName: "LEGAL_NAME",
  /** עוסק פטור (exempt dealer) registration number. */
  vatNumber: "VAT_NUMBER",
  /** Public business phone, in the form customers should dial. */
  phone: "PHONE",
  /** Public contact mailbox. This one is real — it is already in use. */
  email: "info@ehjezly.co.il",
} as const;

/**
 * Fills the business slots in a translated string.
 *
 * The policy text is identical in shape across he/ar/en, so the slots live in
 * the translations and the values live here — a number or a legal name must
 * never be duplicated into three language blocks where it can drift.
 */
export function fillBusiness(text: string): string {
  return text
    .replace(/\{legalName\}/g, BUSINESS.legalName)
    .replace(/\{vat\}/g, BUSINESS.vatNumber)
    .replace(/\{phone\}/g, BUSINESS.phone)
    .replace(/\{email\}/g, BUSINESS.email);
}
