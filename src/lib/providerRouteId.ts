// The :id of /provider/:id and /provider/:id/book, made tolerant of junk around
// the UUID. A misconfigured WhatsApp template button once sent customers to
// /provider/%7B%7B1%7D%7D<uuid> (a literal "{{1}}" before the id); the link
// should still land on the provider.

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BARE_UUID = new RegExp(`^${UUID.source}$`, "i");

export type ProviderRouteId =
  /** The param is a bare UUID: render the page as is. */
  | { kind: "ok"; id: string }
  /** A UUID was found inside junk: replace the URL with the clean one. */
  | { kind: "redirect"; id: string }
  /** No UUID anywhere: render the page, which shows "not available". */
  | { kind: "none" };

export function resolveProviderRouteId(param: string | undefined): ProviderRouteId {
  if (!param) return { kind: "none" };
  if (BARE_UUID.test(param)) return { kind: "ok", id: param };
  const match = UUID.exec(param);
  return match ? { kind: "redirect", id: match[0] } : { kind: "none" };
}
