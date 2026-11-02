import { Navigate, useLocation, useParams } from "react-router-dom";
import { resolveProviderRouteId } from "@/lib/providerRouteId";

interface ProviderIdGuardProps {
  /** What follows /provider/:id in this route, e.g. "/book". */
  subpath?: string;
  children: React.ReactNode;
}

/**
 * Wraps the /provider/:id routes. A UUID wrapped in junk is replaced by the
 * clean URL (query, hash and state kept); anything else renders the page,
 * which shows "not available" for an id it cannot find.
 */
export function ProviderIdGuard({ subpath = "", children }: ProviderIdGuardProps) {
  const { id } = useParams();
  const location = useLocation();
  const resolved = resolveProviderRouteId(id);

  if (resolved.kind === "redirect") {
    return (
      <Navigate
        to={`/provider/${resolved.id}${subpath}${location.search}${location.hash}`}
        state={location.state}
        replace
      />
    );
  }

  return <>{children}</>;
}
