import { Route, Routes, useLocation } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SlideStack } from "@/components/staff/SlideStack";
import ProviderStaff from "./ProviderStaff";
import ProviderStaffMember from "./ProviderStaffMember";

/**
 * The /staff/* layout: both staff pages under ONE AnimatePresence (SlideStack),
 * so the roster and the member page slide over each other like a native stack
 * instead of swapping in place.
 *
 * WHY THE TWO PAGES ARE IMPORTED STATICALLY HERE, not lazily in App.tsx: the
 * entering page must never suspend mid-slide. React.lazy suspends on its FIRST
 * render even when the chunk is already in the browser cache — the module
 * promise still resolves a tick later — and App's Suspense boundary sits
 * outside Routes, so that tick would replace this whole layout with the page
 * loader and kill the animation. Bundling both pages into this one chunk (which
 * App.tsx lazy-loads once, on first entry to /staff) removes the problem rather
 * than racing it. The sibling is not preloaded; it is already here.
 */
export default function StaffRoutes() {
  const location = useLocation();
  const { isRtl } = useLang();
  const reduceMotion = useReducedMotion();

  return (
    <SlideStack pathname={location.pathname} isRtl={isRtl} reduceMotion={!!reduceMotion}>
      {/* `location` is passed explicitly so the EXITING panel — whose props
          AnimatePresence freezes — keeps rendering the route it was showing. */}
      <Routes location={location}>
        <Route index element={<ErrorBoundary><ProviderStaff /></ErrorBoundary>} />
        <Route path=":id" element={<ErrorBoundary><ProviderStaffMember /></ErrorBoundary>} />
      </Routes>
    </SlideStack>
  );
}
