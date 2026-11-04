import type { ReactNode, ReactElement } from "react";
import type { ApiRelease, ClientOptions, ChangelarkClient } from "./client";
import decider from "./decider";

export * from "./client";
export type { DeviceState, ReleaseState, Vote } from "./decider";
export { decider };

export interface ChangelarkProviderProps {
  /** Public app key from the dashboard, starts with clk_. */
  appKey: string;
  /**
   * The installed app version. Leave it out: it's read from the native build with expo-application (Expo)
   * or react-native-device-info, whichever the app has. In Expo Go that reads Expo Go's own version, so pass it there.
   */
  appVersion?: string;
  /** Your Changelark server. Defaults to https://changelark.example */
  baseUrl?: string;
  /** Show What's new on a fresh install too. Default false. */
  treatFirstLaunchAsUpdate?: boolean;
  getAppProof?: ClientOptions["getAppProof"];
  /**
   * Optional: returns a base64 PNG/JPEG of your app for bug reports, e.g.
   * `() => captureRef(rootRef, { format: "jpg", quality: 0.6, result: "base64" })` from react-native-view-shot.
   * Without it, bug reports are text only.
   */
  captureScreenshot?: () => Promise<string | null>;
  children?: ReactNode;
}

export function ChangelarkProvider(props: ChangelarkProviderProps): ReactElement;

export function useChangelark(): {
  client: ChangelarkClient | null;
  appVersion: string;
  release: ApiRelease | null;
  captureScreenshot?: () => Promise<string | null>;
  open(release?: ApiRelease): void;
  close(): void;
};

/** The half-height sheet: notes, two reactions, and a way into the feedback chat. `startInChat` opens it on the chat. */
export function WhatsNewSheet(props: { visible: boolean; release: ApiRelease; startInChat?: boolean; onShow?: () => void; onClose: () => void }): ReactElement;
/** The feedback chat for one version, for use in your own screens. With `onClose`, the header shows a Close button. */
export function FeedbackChat(props: { version: string; onBack: () => void; onClose?: () => void }): ReactElement;
/** The private bug report form, for use in your own screens. */
export function BugReport(props: { onBack: () => void }): ReactElement;
