import type { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "./atom-registry";

/** A message the user sent: its thread, and its project when it creates the thread. */
export interface SentThreadMessage {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly projectId: ProjectId | null;
}

/**
 * Messages sent since the project drawer last looked. Sending in a hidden or snoozed project
 * brings it back, as on desktop; the drawer resolves each to its project and empties the list.
 * Not saved.
 */
export const sentThreadMessagesAtom = Atom.make<ReadonlyArray<SentThreadMessage>>([]).pipe(
  Atom.keepAlive,
);

export function noteSentThreadMessage(message: SentThreadMessage): void {
  appAtomRegistry.set(sentThreadMessagesAtom, [
    ...appAtomRegistry.get(sentThreadMessagesAtom),
    message,
  ]);
}

export function clearSentThreadMessages(handled: ReadonlyArray<SentThreadMessage>): void {
  const done = new Set(handled);
  appAtomRegistry.set(
    sentThreadMessagesAtom,
    appAtomRegistry.get(sentThreadMessagesAtom).filter((message) => !done.has(message)),
  );
}
