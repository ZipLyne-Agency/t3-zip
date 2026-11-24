import type { OrchestrationMessageContext } from "@t3tools/contracts";

/**
 * The draft fields this check reads. Declared here so this module does not import the drafts
 * store, which imports this module.
 */
interface DraftContentFields {
  readonly text: string;
  readonly attachments: ReadonlyArray<unknown>;
  readonly context?: OrchestrationMessageContext | undefined;
}

/**
 * Whether a draft holds something the user wrote or added: text, attachments or context. Model
 * and workspace settings alone are not a draft, so they mark no row.
 */
export function composerDraftHasUserContent(draft: DraftContentFields | undefined): boolean {
  if (!draft) return false;
  return (
    draft.text.trim().length > 0 ||
    draft.attachments.length > 0 ||
    (draft.context?.records.length ?? 0) > 0
  );
}
