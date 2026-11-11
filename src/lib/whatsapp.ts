/**
 * wa.me link for a phone stored the way profiles store it (Israeli local
 * "05X…", or already with 972). Same rule as the booking screens' local
 * helpers (PendingTab, BookingParts), shared here for the academy screens.
 */
export function waLinkFromPhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("972")) return `https://wa.me/${digits}`;
  const local = digits.startsWith("0") ? digits.slice(1) : digits;
  return `https://wa.me/972${local}`;
}
