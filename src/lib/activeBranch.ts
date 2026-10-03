import { useSyncExternalStore } from "react";

// Multi-branch: one owner (auth user) may own several provider_profiles rows,
// one per branch. This module remembers which branch the owner is working in.
//
// The id is persisted per user in localStorage so a reload keeps the branch,
// but it is only ever a preference: pickActiveBranch() validates it against
// the rows the owner really has, and falls back to the oldest branch. With a
// single branch — every provider today — the stored id is irrelevant and the
// one row is always chosen.

const KEY_PREFIX = "ehjezly.activeBranch.";

// In-memory mirror so the 40+ useProviderProfile() call sites do not each hit
// localStorage on every render. `undefined` = not read from storage yet.
const memory = new Map<string, string | null>();
const listeners = new Set<() => void>();

export function getActiveBranchId(userId: string): string | null {
  if (memory.has(userId)) return memory.get(userId) ?? null;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(KEY_PREFIX + userId);
  } catch {
    // Private mode / blocked storage: behave as "no preference".
  }
  memory.set(userId, stored);
  return stored;
}

export function setActiveBranchId(userId: string, providerId: string): void {
  memory.set(userId, providerId);
  try {
    localStorage.setItem(KEY_PREFIX + userId, providerId);
  } catch {
    // Still applied for this session via `memory`.
  }
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useActiveBranchId(userId: string | undefined): string | null {
  return useSyncExternalStore(
    subscribe,
    () => (userId ? getActiveBranchId(userId) : null),
    () => null,
  );
}

/**
 * The branch the dashboard operates on. `rows` must already be ordered
 * oldest-first (the original branch). Returns null when the owner has no rows,
 * matching the old `.maybeSingle()` result for "no provider profile".
 */
export function pickActiveBranch<T extends { id: string }>(
  rows: readonly T[],
  activeId: string | null,
): T | null {
  if (rows.length === 0) return null;
  if (activeId) {
    const match = rows.find((r) => r.id === activeId);
    if (match) return match;
  }
  return rows[0];
}

/** Test-only: forget in-memory state between cases. */
export function __resetActiveBranchMemory(): void {
  memory.clear();
}
