import type { ComposerDraft } from "./use-composer-drafts";

/**
 * Whether a draft holds something the user wrote or added: text, attachments or context. Model
 * and workspace settings alone are not a draft, so they mark no row.
 */
export function composerDraftHasUserContent(
  draft: Pick<ComposerDraft, "text" | "attachments" | "context"> | undefined,
): boolean {
  if (!draft) return false;
  return (
    draft.text.trim().length > 0 ||
    draft.attachments.length > 0 ||
    (draft.context?.records.length ?? 0) > 0
  );
}
