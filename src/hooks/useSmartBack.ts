import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { isEntryPoint } from "@/lib/smartBack";

/**
 * Back control that never dead-ends: steps back through in-app history, or —
 * on a page the visitor arrived at directly (see lib/smartBack.ts) — goes to
 * "/". Pages keep their own button styling and swap the icon with
 * <BackOrHomeIcon home={isEntry} />.
 */
export function useSmartBack() {
  const navigate = useNavigate();
  // useLocation subscribes the caller to navigation, so isEntry is recomputed
  // on every history change (window.history.state is already current by then).
  const location = useLocation();
  const isEntry = isEntryPoint(window.history.state, location.state);

  const goBack = useCallback(() => {
    // Push, not replace: the device back gesture from Home still returns to
    // the page they landed on.
    if (isEntry) navigate("/");
    else navigate(-1);
  }, [isEntry, navigate]);

  return { isEntry, goBack };
}
