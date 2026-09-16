// ── Walk-in WhatsApp recipient check ─────────────────────────────────────────
//
// Client-side twin of `toWalkInPhone` in supabase/functions/whatsapp-booking-
// confirm and whatsapp-booking-reminder. The functions are the authority —
// they re-check the stored number before every send — but a number they reject
// is only discovered after the customer has left. Checking here lets the
// provider fix it while the customer is still standing there.
//
// MOBILE ONLY (^9725\d{8}$). A walk-in number is typed by the provider and was
// never OTP-verified, so a mistyped digit means messaging a stranger. 07X
// VoIP/landline numbers are rejected on purpose.
//
// VALIDATES, NEVER REWRITES. Nothing here changes what the sheet stores in
// bookings.customer_phone: link_walkin_to_account compares its digits against
// profiles.phone, so a reformatted value would break walk-in → account linking.
//
// KEEP THE NORMALISATION BYTE-FOR-BYTE IN STEP WITH toWalkInPhone. If this
// accepts a number the functions reject, the provider sees no error and the
// message silently skips as WALKIN_INVALID_PHONE.

/** True when `raw` is an Israeli mobile the WhatsApp functions will send to. */
export function isWhatsAppMobile(raw: string | null | undefined): boolean {
  if (!raw) return false;
  let d = raw.replace(/\D/g, "");
  if (d.startsWith("00972")) d = d.slice(5);
  else if (d.startsWith("972")) d = d.slice(3);
  // A trunk '0' typed after the country code ("+972 050-…") is the same number.
  if (d.startsWith("0")) d = d.slice(1);
  return /^9725\d{8}$/.test(`972${d}`);
}
