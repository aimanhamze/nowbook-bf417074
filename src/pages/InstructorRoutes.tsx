import { Route, Routes, useLocation } from "react-router-dom";
import { useReducedMotion } from "framer-motion";
import { useLang } from "@/contexts/LangContext";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SlideStack } from "@/components/staff/SlideStack";
import ProviderInstructors from "./ProviderInstructors";
import ProviderInstructorMember from "./ProviderInstructorMember";

/**
 * The /instructors/* layout — same pattern and same reason as StaffRoutes:
 * both pages share one SlideStack and one lazily-loaded chunk, so the slide
 * between them never suspends.
 */
export default function InstructorRoutes() {
  const location = useLocation();
  const { isRtl } = useLang();
  const reduceMotion = useReducedMotion();

  return (
    <SlideStack pathname={location.pathname} isRtl={isRtl} reduceMotion={!!reduceMotion}>
      <Routes location={location}>
        <Route index element={<ErrorBoundary><ProviderInstructors /></ErrorBoundary>} />
        <Route path=":id" element={<ErrorBoundary><ProviderInstructorMember /></ErrorBoundary>} />
      </Routes>
    </SlideStack>
  );
}
