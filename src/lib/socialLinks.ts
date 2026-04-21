export interface SocialLinks {
  whatsapp?: string;
  instagram?: string;
  tiktok?: string;
  facebook?: string;
  waze?: string;
  website?: string;
}

export interface SocialLinksFormValues {
  social_whatsapp: string;
  social_instagram: string;
  social_tiktok: string;
  social_facebook: string;
  social_waze: string;
  social_website: string;
}

/**
 * Normalize an Israeli mobile or E.164 phone number.
 * 05X-XXXXXXX → +97X5XXXXXXX. Returns null if unrecognizable.
 */
export function normalizePhone(raw: string): string | null {
  const stripped = raw.replace(/[\s\-()]/g, "");
  if (!stripped) return null;

  let e164: string;
  if (stripped.startsWith("+972")) {
    e164 = stripped;
  } else if (stripped.startsWith("05")) {
    e164 = "+972" + stripped.slice(1);
  } else if (stripped.startsWith("972")) {
    e164 = "+" + stripped;
  } else if (stripped.startsWith("+") && stripped.length >= 8) {
    e164 = stripped;
  } else {
    return null;
  }

  if (!/^\+\d{8,15}$/.test(e164)) return null;
  return e164;
}

/**
 * Normalize a social handle or full URL to a full HTTPS URL.
 * @param baseUrl  e.g. "https://instagram.com"
 * @param prefix   inserted between baseUrl/ and handle — use "@" for TikTok
 */
export function normalizeHandle(raw: string, baseUrl: string, prefix = ""): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  const handle = trimmed.replace(/^@+/, "").trim();
  if (!handle) return null;
  return `${baseUrl}/${prefix}${handle}`;
}

/**
 * Normalize a Waze URL, Google Maps URL, or raw coordinates.
 * Coordinates "32.08,34.78" are converted to a Waze deep-link.
 * Google Maps URLs are stored as-is.
 */
export function normalizeWaze(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
      return trimmed;
    } catch {
      return null;
    }
  }

  // "32.08,34.78" or "32.08, 34.78"
  const coordMatch = trimmed.match(/^(-?\d+\.?\d*)\s*,\s*(-?\d+\.?\d*)$/);
  if (coordMatch) {
    return `https://waze.com/ul?ll=${coordMatch[1]},${coordMatch[2]}&navigate=yes`;
  }

  return null;
}

/** Normalize a website URL. Only http(s) schemes are allowed. */
export function normalizeWebsite(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let url = trimmed;
  if (!/^https?:\/\//i.test(url)) {
    url = "https://" + url;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

/**
 * Build a normalized SocialLinks object from raw form values.
 * Returns null when all fields are empty (so the DB column stores NULL, not {}).
 * Only filled keys are included in the returned object.
 */
export function buildSocialLinks(values: SocialLinksFormValues): SocialLinks | null {
  const result: SocialLinks = {};

  const whatsapp = normalizePhone(values.social_whatsapp);
  if (whatsapp) result.whatsapp = whatsapp;

  const instagram = normalizeHandle(values.social_instagram, "https://instagram.com");
  if (instagram) result.instagram = instagram;

  const tiktok = normalizeHandle(values.social_tiktok, "https://tiktok.com", "@");
  if (tiktok) result.tiktok = tiktok;

  const facebook = normalizeHandle(values.social_facebook, "https://facebook.com");
  if (facebook) result.facebook = facebook;

  const waze = normalizeWaze(values.social_waze);
  if (waze) result.waze = waze;

  const website = normalizeWebsite(values.social_website);
  if (website) result.website = website;

  return Object.keys(result).length > 0 ? result : null;
}

/** Build a WhatsApp wa.me link from an E.164 number. */
export function buildWhatsAppLink(e164: string): string {
  return `https://wa.me/${e164.replace("+", "")}`;
}
