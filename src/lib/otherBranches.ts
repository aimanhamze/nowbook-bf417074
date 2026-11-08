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
 * Every visible branch of `current`'s owner, `current` included, in one stable
 * order (by name) — so the switcher's pills keep their places whichever branch
 * is open. Empty for a single-branch owner, so nothing renders.
 */
export function ownerBranches(providers: Provider[], current: Provider, lang: Lang): Provider[] {
  const siblings = siblingBranches(providers, current, lang);
  if (siblings.length === 0) return [];
  return [current, ...siblings].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang));
}

/**
 * Short pill label per branch id: the branch's city. Branches whose city is
 * missing or shared with another branch (two branches in one city) fall back
 * to the branch name, which the UI truncates.
 */
export function branchPillLabels(branches: Provider[], lang: Lang): Map<string, string> {
  const cities = branches.map((b) => cityFromAddress(b.address[lang]));
  const counts = new Map<string, number>();
  for (const c of cities) if (c) counts.set(c.toLocaleLowerCase(), (counts.get(c.toLocaleLowerCase()) ?? 0) + 1);
  const labels = new Map<string, string>();
  branches.forEach((b, i) => {
    const city = cities[i];
    const unique = city && counts.get(city.toLocaleLowerCase()) === 1;
    labels.set(b.id, unique ? city : b.name[lang]);
  });
  return labels;
}
