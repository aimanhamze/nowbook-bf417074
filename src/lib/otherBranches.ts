import type { Provider } from "@/lib/mock-data";
import type { Lang } from "@/lib/translations";
import { cityFromAddress } from "@/lib/cityFromAddress";

/**
 * The other branches of `current`'s owner that customers can open.
 *
 * `providers` must be the public provider list (useAllProviders — already
 * filtered to is_visible), so a hidden branch is never listed and every listed
 * branch opens. Never includes `current`. Empty for a single-branch owner.
 */
export function siblingBranches(providers: Provider[], current: Provider, lang: Lang): Provider[] {
  if (!current.ownerId) return [];
  return providers
    .filter((p) => p.ownerId === current.ownerId && p.id !== current.id)
    .sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
}

/**
 * City shown next to a sibling's name, or null when there is none — or when
 * the name already carries it (business_name holds the branch name, e.g.
 * "Womed Sakhnin", so "Womed Sakhnin · Sakhnin" would repeat itself).
 */
export function branchCityLabel(name: string, address: string | null | undefined): string | null {
  const city = cityFromAddress(address);
  if (!city) return null;
  return name.toLocaleLowerCase().includes(city.toLocaleLowerCase()) ? null : city;
}
