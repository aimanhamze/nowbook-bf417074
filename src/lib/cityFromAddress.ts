/**
 * Short city form of a provider's `address`. There is no city column: the
 * admin create-provider / create-branch dialogs store their "city" input as
 * `address`, and owners may later replace it with a full street address. For
 * full addresses the city is conventionally the last comma-separated segment.
 *
 * Returns null for an empty address.
 */
export function cityFromAddress(address: string | null | undefined): string | null {
  const full = (address ?? "").trim();
  if (!full) return null;
  return full.split(",").pop()!.trim().replace(/\.+$/, "").trim() || null;
}
