import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useLang } from "@/contexts/LangContext";
import { useRegisterForCourse } from "@/hooks/usePublicCourses";
import { academyErrorMessage } from "@/lib/academyErrors";
import { saveRedirectAfterLogin } from "@/lib/redirectAfterLogin";

/** The URL that reopens a course on its provider page (also the post-login target). */
export function coursePageUrl(providerId: string, courseId: string): string {
  return `/provider/${providerId}?course=${encodeURIComponent(courseId)}`;
}

/**
 * One Register handler for the card and the detail sheet.
 * Signed out: remember the course and go to /auth (Auth sends them back).
 * Signed in: call register_for_course; every refusal becomes a sentence.
 */
export function useCourseRegisterAction(providerId: string) {
  const { user } = useAuth();
  const { t } = useLang();
  const navigate = useNavigate();
  const register = useRegisterForCourse();

  const run = async (courseId: string): Promise<boolean> => {
    if (!user) {
      saveRedirectAfterLogin(coursePageUrl(providerId, courseId));
      navigate("/auth");
      return false;
    }
    try {
      await register.mutateAsync(courseId);
      toast.success(t("academyRegisteredToast"));
      return true;
    } catch (err) {
      toast.error(academyErrorMessage(err, t));
      return false;
    }
  };

  return { register: run, pendingCourseId: register.isPending ? register.variables ?? null : null, signedIn: !!user };
}
