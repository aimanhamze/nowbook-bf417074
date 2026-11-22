// The provider page's services list: up to SERVICES_COLLAPSE_OVER services are
// all shown; a longer list shows the first SERVICES_COLLAPSED_COUNT and a
// "show all N" row that expands it in place.

export const SERVICES_COLLAPSE_OVER = 8;
export const SERVICES_COLLAPSED_COUNT = 6;

/** How many services to render. */
export function visibleServiceCount(total: number, expanded: boolean): number {
  if (expanded || total <= SERVICES_COLLAPSE_OVER) return Math.max(0, total);
  return SERVICES_COLLAPSED_COUNT;
}
