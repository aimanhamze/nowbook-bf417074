import type { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";
import { cn } from "@/lib/utils";
import { BranchChip } from "./BranchChip";

type Props = {
  /** The page's existing title classes, passed through unchanged. */
  className: string;
  /** Element the page already used for its title (default h1). */
  as?: "h1" | "p";
  children: ReactNode;
};

// Drop-in replacement for a provider page's title element. For customers and
// single-branch owners — every owner today — it renders EXACTLY the element the
// page had before, same tag, same classes. Only for an owner with 2+ branches
// does it wrap that title with the BranchChip underneath, so every provider
// screen says which branch it is working on.
export function ProviderPageTitle({ className, as = "h1", children }: Props) {
  const { isProvider } = useAuth();
  const Title = as;
  // Customers never mount the provider-profile hook through this component.
  if (!isProvider) return <Title className={className}>{children}</Title>;
  return (
    <ProviderTitle className={className} as={as}>
      {children}
    </ProviderTitle>
  );
}

function ProviderTitle({ className, as = "h1", children }: Props) {
  const { branches } = useProviderProfile();
  const Title = as;
  if (branches.length < 2) return <Title className={className}>{children}</Title>;

  // The wrapper takes over the title's place in the header row (flex-1,
  // min-w-0 for truncation); the title itself no longer needs to grow.
  return (
    <div className="min-w-0 flex-1">
      <Title className={cn(className, "flex-none")}>{children}</Title>
      <BranchChip />
    </div>
  );
}
