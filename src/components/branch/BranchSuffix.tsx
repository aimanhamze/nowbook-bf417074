import { useAuth } from "@/contexts/AuthContext";
import { useProviderProfile } from "@/hooks/useProviderProfile";

// Multi-branch: " · {branch name}" after the title of a sheet or editor that
// WRITES branch-scoped data — "תור חדש · סניף חיפה" — because the sheet covers
// the header's branch chip at exactly the moment the owner saves.
//
// Renders NOTHING for customers and single-branch owners (every owner today),
// so their titles are unchanged. The name is isolated in <bdi> so a Latin name
// cannot reorder an RTL title, and capped so a long name truncates rather than
// pushing the title onto a second line.
export function BranchSuffix() {
  const { isProvider } = useAuth();
  if (!isProvider) return null;
  return <ActiveBranchSuffix />;
}

function ActiveBranchSuffix() {
  const { profile, branches } = useProviderProfile();
  if (branches.length < 2 || !profile) return null;
  return (
    <span className="font-normal text-muted-foreground">
      {" · "}
      <bdi className="inline-block max-w-[11rem] truncate align-bottom">{profile.business_name}</bdi>
    </span>
  );
}
