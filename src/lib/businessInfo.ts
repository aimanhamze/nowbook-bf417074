/**
 * Public business identity — the details a visitor (or a Meta Business
 * Verification reviewer) must be able to find without logging in.
 *
 * TRADE NAME vs LEGAL NAME — these are not interchangeable:
 *   tradeName  is the public face of the business. The footer shows this.
 *   legalName  is the person the עוסק פטור is registered to. It appears ONLY
 *              in the privacy policy's "who we are" section, where naming the
 *              registered operator is the point. It must never reach the
 *              footer or any other public surface.
 *
 * PRIMARY vs SECONDARY PHONE:
 *   phonePrimary    is the number of record. The footer lists it first and the
 *                   privacy policy quotes this one and only this one.
 *   phoneSecondary  is an additional line shown in the footer only.
 *
 * OPTIONAL FIELDS — `vatNumber` and `phoneSecondary` may be left empty (""),
 * and callers must treat an empty value as "omit this line entirely" rather
 * than render a stranded label or an empty tel: link. `hasValue()` is the
 * check. Numbers are stored in +972 international form, so every surface that
 * prints one must pin it dir="ltr" or the leading "+" reorders in he/ar.
 */
export const BUSINESS = {
  /** Public trading name. Shown in the footer. */
  tradeName: "חמזה סופטוור",
  /** Registered עוסק פטור holder. Privacy policy only — never the footer. */
  legalName: "חמזה אימן",
  /** עוסק פטור registration number. Optional — "" hides every VAT line. */
  vatNumber: "315818021",
  /** Number of record. Footer + privacy policy. */
  phonePrimary: "+972-54-632-7556",
  /** Additional footer line. Optional — "" removes that row. */
  phoneSecondary: "+972-54-786-8325",
  /** Public contact mailbox. */
  email: "info@ehjezly.co.il",
  /** Public Instagram profile. Shown in the footer as an action disc. */
  instagramUrl: "https://www.instagram.com/ehjezlyy/",
} as const;

/** True when an optional business field is actually set. */
export function hasValue(field: string): boolean {
  return field.trim().length > 0;
}

/**
 * Dial string for a stored number: the leading "+" and digits only, so the
 * display formatting (hyphen groups) never reaches the dialler.
 */
export function telHref(number: string): string {
  return `tel:${number.replace(/[^+0-9]/g, "")}`;
}
