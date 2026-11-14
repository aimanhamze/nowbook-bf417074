import { useLocation, useNavigate } from "react-router-dom";
import { isEntryPoint } from "@/lib/smartBack";

/**
 * Back navigation for /instructors/*, built on the smart-back rule
 * (lib/smartBack): step back through real history, so the on-screen back
 * control and the device back gesture always go to the same place.
 *
 * List (/instructors): back returns to wherever the provider came from — the
 * dashboard hub, /settings, … (navigate(-1)). Opened directly (link, reload,
 * first page of the session) it falls back to the dashboard, replacing this
 * entry so the dashboard's own back does not bounce back here.
 *
 * Member / new (/instructors/:id): the list marks the entries it opens
 * (FROM_LIST state), so back is a real step back to the list. Reached any
 * other way, the page replaces itself with the list instead.
 */
export const INSTRUCTORS_FALLBACK = "/dashboard";
const FROM_LIST = { fromInstructors: true } as const;

const cameFromList = (state: unknown) => (state as { fromInstructors?: boolean } | null)?.fromInstructors === true;

export function useInstructorsNav() {
  const navigate = useNavigate();
  const location = useLocation();
  const isEntry = isEntryPoint(window.history.state, location.state);

  /** From the list: back to where the provider came from. */
  const backFromList = () => {
    if (isEntry) navigate(INSTRUCTORS_FALLBACK, { replace: true });
    else navigate(-1);
  };

  /** From /instructors/:id or /new: back to the list. */
  const backToList = () => {
    if (cameFromList(location.state)) navigate(-1);
    else navigate("/instructors", { replace: true });
  };

  /** Open a member page (or "new") from the list. */
  const openFromList = (id: string) => navigate(`/instructors/${id}`, { state: FROM_LIST });

  /** /new → the created instructor: replaces /new and keeps the list marker. */
  const replaceWithMember = (id: string) => navigate(`/instructors/${id}`, { replace: true, state: location.state });

  return { isEntry, backFromList, backToList, openFromList, replaceWithMember };
}
