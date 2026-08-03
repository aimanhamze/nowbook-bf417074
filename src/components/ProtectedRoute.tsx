import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { saveRedirectAfterLogin } from "@/lib/redirectAfterLogin";

interface ProtectedRouteProps {
  children: React.ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
      </div>
    );
  }

  if (!user) {
    // Remember where they were going so /auth can return them here after login.
    saveRedirectAfterLogin(`${location.pathname}${location.search}${location.hash}`);
    return <Navigate to="/auth" replace />;
  }

  return <>{children}</>;
}
