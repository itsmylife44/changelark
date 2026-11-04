export type Vote = -1 | 0 | 1;

export interface DeviceState {
  firstSeenVersion: string | null;
  lastKnownVersion: string | null;
  handledVersions: string[];
  pendingSince: Record<string, number>;
  /** Server time of the last look at developer replies; null until the first check. */
  repliesCheckedAt?: string | null;
}

export type ReleaseState = "available" | "hidden" | "not_live_yet" | "notes_pending" | "unknown_version";
export type SkipReason = "first" | "seen" | "older" | "hidden" | "not_live_yet" | "pending";
export type Decision = { decision: "fetch" } | { decision: "show" } | { decision: "skip"; reason: SkipReason };

export interface VoteState { up: number; down: number; mine: Vote }

declare const decider: {
  versionParts(v: string): number[];
  normVersion(v: string): string;
  cmpVersion(a: string, b: string): number;
  emptyState(): DeviceState;
  prepare(version: string, state: DeviceState, opts?: { treatFirstLaunchAsUpdate?: boolean }): Decision;
  resolve(version: string, releaseState: ReleaseState, state: DeviceState, now?: number): Decision;
  markPresented(version: string, state: DeviceState): void;
  toggleVote(v: VoteState, dir: 1 | -1): VoteState;
  badge(version: string, installed?: string | null, latest?: string | null): "Installed" | "Latest" | null;
};

export default decider;
