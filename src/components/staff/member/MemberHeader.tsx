import { useEffect, useState } from "react";
import { Check, Pencil, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLang } from "@/contexts/LangContext";
import type { MemberDayStatus } from "@/lib/staffToday";
import { StaffAvatar } from "../StaffAvatar";
import { TodayChip } from "../TodayChip";

interface Props {
  member: { id: string; name: string; is_active: boolean };
  today: MemberDayStatus;
  onRename: (name: string) => Promise<void>;
  renaming: boolean;
  /** Turning OFF is confirmed by the page (DeactivateDialog); ON is immediate. */
  onToggleActive: (next: boolean) => void;
  togglePending: boolean;
}

/**
 * Avatar, name with inline rename, today's chip, and the active switch.
 *
 * Rename is inline rather than a sheet: it is the only free-text field on the
 * page, and a sheet for one input would be exactly the settings-form feel this
 * page replaces. Enter saves, Escape cancels, empty is refused silently (the
 * old sheet toasted; here the field simply stays open).
 *
 * The active switch lives HERE and not on the roster row, so deactivating a
 * person is one deliberate step away from the list, never a mis-tap.
 */
export function MemberHeader({ member, today, onRename, renaming, onToggleActive, togglePending }: Props) {
  const { t } = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(member.name);

  useEffect(() => {
    if (!editing) setDraft(member.name);
  }, [member.name, editing]);

  const commit = async () => {
    const name = draft.trim();
    if (!name || name.length > 100) return;
    if (name !== member.name) await onRename(name);
    setEditing(false);
  };

  return (
    <section className="glass-card rounded-3xl p-5">
      <div className="flex items-center gap-4">
        <StaffAvatar
          id={member.id}
          name={member.name}
          size="lg"
          muted={!member.is_active}
          className="ring-2 ring-accent/30 ring-offset-2 ring-offset-white/40"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                autoFocus
                maxLength={100}
                aria-label={t("staffNameLabel")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void commit();
                  if (e.key === "Escape") setEditing(false);
                }}
                className="h-11 text-base font-semibold"
              />
              <button
                type="button"
                onClick={() => void commit()}
                disabled={renaming}
                aria-label={t("save")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground active:scale-95 disabled:opacity-50"
              >
                <Check className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setEditing(false)}
                aria-label={t("cancel")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-muted-foreground active:scale-95"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <h1 className={`truncate text-xl font-bold ${member.is_active ? "" : "text-muted-foreground line-through"}`}>
                {member.name}
              </h1>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label={t("staffRename")}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary active:scale-95"
              >
                <Pencil className="h-4 w-4" />
              </button>
            </div>
          )}
          <TodayChip status={member.is_active ? today : null} className="self-start" />
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-border/60 pt-3.5">
        <Switch
          checked={member.is_active}
          onCheckedChange={onToggleActive}
          disabled={togglePending}
          aria-label={t("staffActiveLabel")}
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{member.is_active ? t("staffActiveLabel") : t("staffInactive")}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            {member.is_active ? t("staffActiveHelp") : t("staffInactiveHelp")}
          </p>
        </div>
      </div>
    </section>
  );
}
