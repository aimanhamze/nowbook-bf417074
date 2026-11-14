import { useLayoutEffect } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import ProviderInstructors from "./ProviderInstructors";
import ProviderInstructorMember from "./ProviderInstructorMember";

/**
 * The /instructors/* layout: both pages in one lazily-loaded chunk, so moving
 * between them never suspends.
 *
 * Transitions: each page plays the dashboard section's open transition on
 * its content (components/dashboard/sectionTransition) — arriving from the
 * hub or /settings, list ↔ instructor, and back, all look like opening a
 * dashboard section. (This replaced the staff SlideStack here, which never
 * animated the first page and so showed nothing when coming from the hub.)
 */
export default function InstructorRoutes() {
  const location = useLocation();

  // Each page starts at the top, set before paint so nothing jumps.
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Routes location={location}>
      <Route index element={<ErrorBoundary><ProviderInstructors /></ErrorBoundary>} />
      <Route path=":id" element={<ErrorBoundary><ProviderInstructorMember /></ErrorBoundary>} />
    </Routes>
  );
}
