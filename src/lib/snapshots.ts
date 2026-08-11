import type { ProviderSnapshot } from "../types";

function isOlderSuccessfulSnapshot(previous: ProviderSnapshot | undefined, next: ProviderSnapshot): boolean {
  if (!previous || next.status !== "ok") return false;
  const previousIsAuthoritative = previous.status === "signed_out" || Boolean(previous.shortWindow || previous.weeklyWindow);
  if (!previousIsAuthoritative) return false;
  return Date.parse(previous.updatedAt) > Date.parse(next.updatedAt);
}

export function filterSnapshotUpdates(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  return incoming.filter((next) => {
    const previous = current.find((item) => item.provider === next.provider);
    return !isOlderSuccessfulSnapshot(previous, next);
  });
}

function mergeSnapshot(previous: ProviderSnapshot | undefined, next: ProviderSnapshot): ProviderSnapshot {
  if (next.status === "ok") {
    if (previous && isOlderSuccessfulSnapshot(previous, next)) return previous;
    return next;
  }
  if (next.status === "signed_out") return next;
  if (previous?.shortWindow || previous?.weeklyWindow) {
    return { ...previous, status: "stale", message: next.message, updatedAt: previous.updatedAt };
  }
  return next;
}

export function mergeSnapshots(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  return incoming.map((next) => mergeSnapshot(current.find((item) => item.provider === next.provider), next));
}

export function mergeSnapshotUpdates(current: ProviderSnapshot[], incoming: ProviderSnapshot[]): ProviderSnapshot[] {
  const updates = new Map(incoming.map((item) => [item.provider, item]));
  const existingProviders = new Set(current.map((item) => item.provider));
  const updated = current.map((previous) => {
    const next = updates.get(previous.provider);
    return next ? mergeSnapshot(previous, next) : previous;
  });
  const added = incoming
    .filter((item) => !existingProviders.has(item.provider))
    .map((item) => mergeSnapshot(undefined, item));
  return [...updated, ...added];
}
