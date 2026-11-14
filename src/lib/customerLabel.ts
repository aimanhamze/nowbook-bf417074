/**
 * The name to show for a customer on a provider screen.
 *
 * profiles.display_name is NOT always a name: the signup trigger
 * (001_initial_schema handle_new_user) stores the account's email there when
 * no name was given. An email is never shown as a person's name, so:
 *   the name — unless it is empty or looks like an email —
 *   else the phone,
 *   else the caller's translated fallback ("Customer").
 */
const EMAIL_LIKE = /^[^\s@]+@[^\s@]+$/;

export function looksLikeEmail(value: string): boolean {
  return EMAIL_LIKE.test(value.trim());
}

export function customerLabel(
  name: string | null | undefined,
  phone: string | null | undefined,
  fallback: string,
): string {
  const n = name?.trim() ?? "";
  if (n && !looksLikeEmail(n)) return n;
  const p = phone?.trim() ?? "";
  return p || fallback;
}

/** True when customerLabel() fell back to the phone (render it LTR). */
export function labelIsPhone(name: string | null | undefined, phone: string | null | undefined): boolean {
  const n = name?.trim() ?? "";
  return !(n && !looksLikeEmail(n)) && !!phone?.trim();
}
