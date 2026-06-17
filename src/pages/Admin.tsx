import { useLocation } from "react-router-dom";
import { AdminDashboard } from "@/components/admin/AdminDashboard";
import { AdminProviders } from "@/components/admin/AdminProviders";
import { AdminUsers } from "@/components/admin/AdminUsers";
import { useLang } from "@/contexts/LangContext";

// Admin views are driven entirely by the bottom nav (admin variant) — each nav
// button maps to a dedicated route, so there is no in-page toggle:
//   /admin            → control room (dashboard)
//   /admin/providers  → providers list
//   /admin/customers  → customers (all users) list
const Admin = () => {
  const { t } = useLang();
  const { pathname } = useLocation();

  let title = t("adminTabDashboard");
  let content = <AdminDashboard />;
  if (pathname.startsWith("/admin/providers")) {
    title = t("adminProviders");
    content = <AdminProviders />;
  } else if (pathname.startsWith("/admin/customers")) {
    title = t("adminCustomers");
    content = <AdminUsers />;
  }

  return (
    <div className="min-h-screen pb-24">
      <header className="px-5 pt-12 pb-2">
        <h1 className="text-xl font-bold">{title}</h1>
      </header>

      <section className="px-5 mt-4">{content}</section>
    </div>
  );
};

export default Admin;
