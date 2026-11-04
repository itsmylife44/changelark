// The /api/v1/sdk contract. The Next.js server route is typed against these too, so both sides stay in sync.
import type { ReleaseState, Vote } from "./decider";

export interface ApiRelease {
  id: string;
  version: string;
  notes: string;
  date: string;
  upCount: number;
  downCount: number;
  myVote: Vote;
  commentCount: number;
  /** Language of `notes`: a translation code like "it", or null for the developer's original text. */
  language: string | null;
  /** Translations available for this version, e.g. ["de", "it"]. */
  languages: string[];
}

export interface ApiComment {
  id: string;
  parentId: string | null;
  createdAt: string;
  body: string;
  status: "visible" | "hidden" | "deleted";
  removed: boolean;
  deletedByAuthor: boolean;
  upCount: number;
  downCount: number;
  myVote: Vote;
  author: { name: string; kind: "developer" | "user"; isMe: boolean };
  replies: ApiComment[];
}

export interface ApiConfig {
  app: { name: string; color: string; proofRequired: boolean };
  me: { name: string; guidelinesAccepted: boolean };
}

export type ApiWhatsNew =
  | { state: "available"; release: ApiRelease }
  | { state: Exclude<ReleaseState, "available">; release: null };

/**
 * Developer replies to this install's comments created after `since`.
 * `version` is where the newest one is; pass `checkedAt` as the next `since`. Without `since` (first check), count is 0 and earlier replies count as read.
 */
export interface ApiNewReplies { count: number; version: string | null; checkedAt: string }

export interface ApiPage<T> { items: T[]; nextCursor: string | null }
export interface ApiVoteResult { upCount: number; downCount: number; myVote: Vote }
export interface ApiOk { ok: true }
export interface ApiError { error: { code: string; message: string } }
export type ReportReason = "spam" | "abuse" | "off-topic";

export type AppProof =
  | { kind?: "apple"; keyId: string; assertion: string }
  | { kind?: "apple"; keyId: string; attestation: string }
  | { kind: "play"; token: string };

export interface ClientOptions {
  baseUrl: string;
  /** Public app key, starts with clk_. */
  appKey: string;
  /** Random id for this install, kept on the device. */
  anonId: string;
  appVersion: string;
  /** Preferred language, e.g. "it-IT". Notes come back translated when the developer added that language. */
  locale?: string;
  /**
   * Optional proof that writes come from your genuine app. Called with a one-time challenge for every vote, comment, report or block.
   * iOS: return an App Attest assertion over SHA256(challenge); when `attest` is true, attest the key with SHA256(challenge) instead.
   * Android: return a Play Integrity token requested with `nonce: challenge`.
   */
  getAppProof?: (challenge: string, options: { attest: boolean }) => Promise<AppProof>;
  fetchImpl?: typeof fetch;
}

export interface ChangelarkClient {
  config(): Promise<ApiConfig>;
  whatsNew(version: string): Promise<ApiWhatsNew>;
  releases(cursor?: string): Promise<ApiPage<ApiRelease>>;
  comments(version: string, cursor?: string): Promise<ApiPage<ApiComment>>;
  replies(commentId: string, cursor?: string): Promise<ApiPage<ApiComment>>;
  newReplies(since?: string | null): Promise<ApiNewReplies>;
  vote(targetType: "release" | "comment", targetId: string, value: Vote): Promise<ApiVoteResult>;
  acceptGuidelines(): Promise<ApiOk>;
  addComment(version: string, text: string, parentId?: string | null): Promise<{ id: string }>;
  report(commentId: string, reason?: ReportReason): Promise<ApiOk>;
  deleteComment(id: string): Promise<ApiOk>;
  block(commentId: string): Promise<ApiOk>;
  /** Private bug report for the developer. screenshot: base64 PNG or JPEG, up to 1.5 MB. */
  reportBug(bug: BugReport): Promise<{ id: string }>;
}

export interface BugReport { text: string; screenshot?: string | null; device?: string }

/** Errors carry the server's error code, e.g. "guidelines_required" or "slow_down". */
export type ChangelarkError = Error & { code: string };

export function createClient(options: ClientOptions): ChangelarkClient;
