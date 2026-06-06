import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { LangProvider, useLang } from "@/contexts/LangContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { BottomNav } from "@/components/layout/BottomNav";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AdminRoute } from "@/components/AdminRoute";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Suspense, lazy, useEffect } from "react";

const Index = lazy(() => import("./pages/Index"));
const Explore = lazy(() => import("./pages/Explore"));
const ProviderDetail = lazy(() => import("./pages/ProviderDetail"));
const BookAppointment = lazy(() => import("./pages/BookAppointment"));
const BookingConfirmed = lazy(() => import("./pages/BookingConfirmed"));
const Bookings = lazy(() => import("./pages/Bookings"));
const Favorites = lazy(() => import("./pages/Favorites"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const Auth = lazy(() => import("./pages/Auth"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Install = lazy(() => import("./pages/Install"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Admin = lazy(() => import("./pages/Admin"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Nearby = lazy(() => import("./pages/Nearby"));
const ProviderCalendar = lazy(() => import("./pages/ProviderCalendar"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
    </div>
  );
}

function PageTitleUpdater() {
  const location = useLocation();
  const { t } = useLang();

  useEffect(() => {
    const routeTitles: Record<string, string> = {
      "/": `Dorak — ${t("home")}`,
      "/explore": `Dorak — ${t("explore")}`,
      "/nearby": `Dorak — ${t("nearbyTitle")}`,
      "/bookings": `Dorak — ${t("myBookings")}`,
      "/favorites": `Dorak — ${t("favorites")}`,
      "/profile": `Dorak — ${t("profile")}`,
      "/settings": `Dorak — ${t("settings")}`,
      "/auth": `Dorak — ${t("signIn")}`,
      "/notifications": `Dorak — ${t("notificationsLabel")}`,
      "/dashboard": `Dorak — ${t("dashboard")}`,
      "/calendar": `Dorak — ${t("bookingsCalendar")}`,
      "/admin": `Dorak — Admin`,
      "/booking-confirmed": `Dorak — ${t("bookingConfirmed")}`,
    };

    const base = location.pathname.split("/").slice(0, 2).join("/");
    document.title = routeTitles[location.pathname]
      || routeTitles[base]
      || "Dorak — הזמנת תורים";
  }, [location.pathname, t]);

  return null;
}

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <LangProvider>
          <AuthProvider>
            <Toaster />
            <Sonner />
            <BrowserRouter>
              <PageTitleUpdater />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route path="/" element={<ErrorBoundary><Index /></ErrorBoundary>} />
                  <Route path="/explore" element={<ErrorBoundary><Explore /></ErrorBoundary>} />
                  <Route path="/nearby" element={<ErrorBoundary><Nearby /></ErrorBoundary>} />
                  <Route path="/provider/:id" element={<ErrorBoundary><ProviderDetail /></ErrorBoundary>} />
                  <Route path="/provider/:id/book" element={<ProtectedRoute><ErrorBoundary><BookAppointment /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/booking-confirmed" element={<ProtectedRoute><ErrorBoundary><BookingConfirmed /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/bookings" element={<ProtectedRoute><ErrorBoundary><Bookings /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/favorites" element={<ProtectedRoute><ErrorBoundary><Favorites /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/profile" element={<ProtectedRoute><ErrorBoundary><Profile /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/settings" element={<ProtectedRoute><ErrorBoundary><Settings /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/auth" element={<ErrorBoundary><Auth /></ErrorBoundary>} />
                  <Route path="/reset-password" element={<ErrorBoundary><ResetPassword /></ErrorBoundary>} />
                  <Route path="/dashboard" element={<ProtectedRoute><ErrorBoundary><Dashboard /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/calendar" element={<ProtectedRoute><ErrorBoundary><ProviderCalendar /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/notifications" element={<ProtectedRoute><ErrorBoundary><Notifications /></ErrorBoundary></ProtectedRoute>} />
                  <Route path="/admin" element={<AdminRoute><ErrorBoundary><Admin /></ErrorBoundary></AdminRoute>} />
                  <Route path="/install" element={<ErrorBoundary><Install /></ErrorBoundary>} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Suspense>
              <BottomNav />
            </BrowserRouter>
          </AuthProvider>
        </LangProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
