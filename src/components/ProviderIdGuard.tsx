import { Navigate, useLocation, useParams } from "react-router-dom";
import { resolveProviderRouteId } from "@/lib/providerRouteId";

interface ProviderIdGuardProps {
  /** What follows /provider/:id in this route, e.g. "/book" — or a function of
   *  the route params when that part has params of its own ("/course/:courseId"). */
  subpath?: string | ((params: Readonly<Record<string, string | undefined>>) => string);
  children: React.ReactNode;
}

/**
 * Wraps the /provider/:id routes. A UUID wrapped in junk is replaced by the
 * clean URL (query, hash and state kept); anything else renders the page,
 * which shows "not available" for an id it cannot find.
 */
export function ProviderIdGuard({ subpath = "", children }: ProviderIdGuardProps) {
  const params = useParams();
  const { id } = params;
  const location = useLocation();
  const resolved = resolveProviderRouteId(id);

  if (resolved.kind === "redirect") {
    return (
      <Navigate
        to={`/provider/${resolved.id}${typeof subpath === "function" ? subpath(params) : subpath}${location.search}${location.hash}`}
        state={location.state}
        replace
      />
    );
  }

  return <>{children}</>;
}
