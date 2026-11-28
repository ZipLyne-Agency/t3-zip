import { ComposerContextRecord, ForwardCompatibleArray } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { create } from "zustand";

import {
  PersistedComposerFileAttachment,
  PersistedComposerImageAttachment,
  composerTargetKey,
  useComposerDraftStore,
} from "./composerDraftStore";
import { createMemoryStorage, type StateStorage } from "./lib/storage";

export const PROMPT_STASH_STORAGE_KEY = "t3code:prompt-stash:v2";
const LEGACY_PROMPT_STASH_STORAGE_KEY = "t3code:prompt-stash:v1";
const PROMPT_STASH_STORAGE_VERSION = 2;

// A sanity bound; storage quota is the real limit and reports its own failure.
export const MAX_STASH_ENTRIES = 100;
// Share localStorage's ~5MB quota with drafts; record oversized attachments in droppedImageNames.
export const MAX_STASH_ENTRY_ATTACHMENT_CHARS = 2_700_000;

const StashEntrySchema = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.String,
  prompt: Schema.String,
  attachments: Schema.Array(PersistedComposerImageAttachment),
  files: Schema.optionalKey(Schema.Array(PersistedComposerFileAttachment)),
  droppedImageNames: Schema.Array(Schema.String),
  unreadableImageNames: Schema.optionalKey(Schema.Array(Schema.String)),
  pendingImageCount: Schema.optionalKey(Schema.Number),
  records: Schema.optionalKey(ForwardCompatibleArray(ComposerContextRecord)),
  /**
   * The composer the prompt was stashed from (`composerTargetKey`). Entries stashed before the
   * stash became per thread have none and show in every thread until restored or deleted.
   */
  scope: Schema.optionalKey(Schema.String),
});
export type PromptStashEntry = typeof StashEntrySchema.Type;

const PersistedPromptStashState = Schema.Struct({
  entries: Schema.Array(StashEntrySchema),
});
type PersistedPromptStashState = typeof PersistedPromptStashState.Type;

const decodePersistedPromptStashState = Schema.decodeUnknownSync(PersistedPromptStashState);

// Encoders cannot survive reload; clear orphaned counts so entries remain restorable.
function clearOrphanedPendingImages(entry: PromptStashEntry): PromptStashEntry {
  if (!entry.pendingImageCount) return entry;
  return {
    ...entry,
    pendingImageCount: 0,
    unreadableImageNames: [
      ...(entry.unreadableImageNames ?? []),
      ...Array.from(
        { length: entry.pendingImageCount },
        (_, index) => `image ${index + 1} (not saved before reload)`,
      ),
    ],
  };
}

/** Whether an entry belongs in the stash of the composer keyed `scope`. */
export function stashEntryInScope(entry: PromptStashEntry, scope: string): boolean {
  return entry.scope === undefined || entry.scope === scope;
}

export function partitionStashAttachments(
  attachments: ReadonlyArray<PersistedComposerImageAttachment>,
): {
  kept: PersistedComposerImageAttachment[];
  droppedNames: string[];
} {
  const kept: PersistedComposerImageAttachment[] = [];
  const droppedNames: string[] = [];
  let usedChars = 0;
  for (const attachment of attachments) {
    if (usedChars + attachment.dataUrl.length > MAX_STASH_ENTRY_ATTACHMENT_CHARS) {
      droppedNames.push(attachment.name);
      continue;
    }
    usedChars += attachment.dataUrl.length;
    kept.push(attachment);
  }
  return { kept, droppedNames };
}

// Accessing localStorage itself can throw SecurityError before get/set.
function resolveBaseStorage(): { storage: StateStorage; durable: boolean } {
  try {
    if (typeof localStorage !== "undefined") {
      return { storage: localStorage, durable: true };
    }
  } catch {}
  return { storage: createMemoryStorage(), durable: false };
}

const { storage: baseStashStorage, durable: storageIsDurable } = resolveBaseStorage();

const unpersistedFinalizedEntryIds = new Set<string>();

// Clear the composer only after a durable write; debounce cannot confirm durability.
function persistEntries(entries: ReadonlyArray<PromptStashEntry>): {
  written: boolean;
  durable: boolean;
} {
  try {
    baseStashStorage.setItem(
      PROMPT_STASH_STORAGE_KEY,
      JSON.stringify({
        version: PROMPT_STASH_STORAGE_VERSION,
        state: { entries },
      }),
    );
    unpersistedFinalizedEntryIds.clear();
    return { written: true, durable: storageIsDurable };
  } catch (error) {
    console.error("[PROMPT-STASH] Could not persist stash (storage quota?).", error);
    return { written: false, durable: false };
  }
}

function readStoredEntries(): ReadonlyArray<PromptStashEntry> | null {
  try {
    const raw = baseStashStorage.getItem(PROMPT_STASH_STORAGE_KEY);
    if (typeof raw !== "string" || raw.length === 0) return null;
    const parsed: unknown = JSON.parse(raw);
    const state = (parsed as { state?: unknown } | null)?.state;
    if (!state) return null;
    return decodePersistedPromptStashState(state).entries;
  } catch {
    return null;
  }
}

function readPersistedEntries(): ReadonlyArray<PromptStashEntry> | null {
  return readStoredEntries()?.map(clearOrphanedPendingImages) ?? null;
}

/**
 * Starts each write from storage so other tabs' stashes, takes and finalized images survive.
 * Local encoding and failed finalize writes retain ownership while the stored entry exists.
 */
function latestEntries(memory: ReadonlyArray<PromptStashEntry>): ReadonlyArray<PromptStashEntry> {
  const stored = readStoredEntries();
  if (!stored) return memory;
  const storedIds = new Set(stored.map((entry) => entry.id));
  for (const id of unpersistedFinalizedEntryIds) {
    if (!storedIds.has(id)) unpersistedFinalizedEntryIds.delete(id);
  }
  const memoryById = new Map(memory.map((entry) => [entry.id, entry]));
  return stored.map((entry) => {
    const local = memoryById.get(entry.id);
    if (
      local &&
      (local.pendingImageCount ||
        entry.pendingImageCount ||
        unpersistedFinalizedEntryIds.has(entry.id))
    ) {
      return local;
    }
    return clearOrphanedPendingImages(entry);
  });
}

interface PromptStashStoreState {
  entries: ReadonlyArray<PromptStashEntry>;
  /** `entry.scope` names the composer it belongs to. */
  stashEntry: (entry: PromptStashEntry & { readonly scope: string }) => {
    /** True when this thread's stash already holds MAX_STASH_ENTRIES; nothing was written. */
    full: boolean;
    /** False when the write failed outright (e.g. quota or a full stash); nothing was kept. */
    written: boolean;
    /** False for failed writes or in-memory fallback; the entry will not survive reload. */
    durable: boolean;
  };
  /** durable=false means removal was not persisted and reload would restore the entry. */
  takeEntry: (entryId: string) => { entry: PromptStashEntry | null; durable: boolean };
  /** attached=false means the entry disappeared while encoding, so images could not be saved. */
  finalizeEntryImages: (
    entryId: string,
    images: {
      attachments: ReadonlyArray<PersistedComposerImageAttachment>;
      droppedImageNames: ReadonlyArray<string>;
      unreadableImageNames: ReadonlyArray<string>;
    },
  ) => { attached: boolean; durable: boolean };
  /** Moves a draft's entries onto the thread it became. */
  rescopeEntries: (from: string, to: string) => void;
}

export const usePromptStashStore = create<PromptStashStoreState>()((set, get) => ({
  entries: [],
  stashEntry: (entry) => {
    const currentEntries = latestEntries(get().entries);
    // Never discard a stashed prompt to make room; the user decides what to remove.
    // T3 Zip: each thread shows only its own stash, so only its entries count toward the cap.
    const inScope = currentEntries.filter((candidate) => stashEntryInScope(candidate, entry.scope));
    if (inScope.length >= MAX_STASH_ENTRIES) {
      return { full: true, written: false, durable: false };
    }
    const nextEntries = [entry, ...currentEntries];
    const { written, durable } = persistEntries(nextEntries);
    // Failed writes must not duplicate the intact composer.
    if (!written) {
      return { full: false, written: false, durable: false };
    }
    set(() => ({ entries: nextEntries }));
    return { full: false, written: true, durable };
  },
  takeEntry: (entryId) => {
    const entries = latestEntries(get().entries);
    const entry = entries.find((candidate) => candidate.id === entryId) ?? null;
    if (!entry) return { entry: null, durable: true };
    const nextEntries = entries.filter((candidate) => candidate.id !== entryId);
    const { durable } = persistEntries(nextEntries);
    unpersistedFinalizedEntryIds.delete(entryId);
    set(() => ({ entries: nextEntries }));
    return { entry, durable };
  },
  finalizeEntryImages: (entryId, images) => {
    const entries = latestEntries(get().entries);
    const index = entries.findIndex((candidate) => candidate.id === entryId);
    const existing = index === -1 ? undefined : entries[index];
    if (!existing) return { attached: false, durable: true };
    const nextEntries = [...entries];
    nextEntries[index] = {
      ...existing,
      attachments: images.attachments,
      droppedImageNames: images.droppedImageNames,
      unreadableImageNames: images.unreadableImageNames,
      pendingImageCount: 0,
    };
    const { written, durable } = persistEntries(nextEntries);
    if (!written) unpersistedFinalizedEntryIds.add(entryId);
    set(() => ({ entries: nextEntries }));
    return { attached: true, durable };
  },
  rescopeEntries: (from, to) => {
    const entries = latestEntries(get().entries);
    if (!entries.some((entry) => entry.scope === from)) return;
    const nextEntries = entries.map((entry) =>
      entry.scope === from ? { ...entry, scope: to } : entry,
    );
    persistEntries(nextEntries);
    set(() => ({ entries: nextEntries }));
  },
}));

// A new thread's composer is a draft until its first send; its stash follows it to the thread.
useComposerDraftStore.subscribe((state, previous) => {
  if (state.promotedDraftRedirects === previous.promotedDraftRedirects) return;
  for (const [draftKey, threadRef] of Object.entries(state.promotedDraftRedirects)) {
    if (previous.promotedDraftRedirects[draftKey]) continue;
    usePromptStashStore.getState().rescopeEntries(draftKey, composerTargetKey(threadRef));
  }
});

{
  try {
    baseStashStorage.removeItem(LEGACY_PROMPT_STASH_STORAGE_KEY);
  } catch {}
  const persisted = readPersistedEntries();
  if (persisted) {
    usePromptStashStore.setState({ entries: persisted });
  }
}

export function writePromptStashStorageForTest(raw: string): void {
  baseStashStorage.setItem(PROMPT_STASH_STORAGE_KEY, raw);
  usePromptStashStore.setState({ entries: readPersistedEntries() ?? [] });
}
