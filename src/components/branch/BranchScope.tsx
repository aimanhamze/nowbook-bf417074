import { Fragment, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveBranchId } from "@/lib/activeBranch";

// Multi-branch: remounts a provider screen when the owner switches branch, so
// open sheets close and local state that belonged to the old branch (a selected
// staff filter, a half-filled form) is dropped instead of being applied to the
// new one.
//
// Keyed on the STORED active-branch id, which is null — and never changes — for
// customers and single-branch owners, so their screens are never remounted. A
// keyed Fragment adds no DOM. The Dashboard is not wrapped: it keys only its tab
// content, so the selected tab survives a switch.
export function BranchScope({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const activeBranchId = useActiveBranchId(user?.id);
  return <Fragment key={activeBranchId ?? ""}>{children}</Fragment>;
}
