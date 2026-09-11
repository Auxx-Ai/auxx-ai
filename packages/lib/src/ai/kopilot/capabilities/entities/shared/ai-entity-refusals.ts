// packages/lib/src/ai/kopilot/capabilities/entities/shared/ai-entity-refusals.ts

import { MAIL_LENS_REFUSAL } from '../../../../../resources/picker/mail-lens-tables'

/**
 * Wording for the refusal an AI tool returns when the model reaches for a def
 * the generic record path refuses — `thread` / `message`, whose content is
 * governed by the mail lens (metadata / subject / full) that exists **only**
 * in `mail-query/`. This module no longer decides *what* is blocked or *what*
 * is AI-visible; both predicates (`isAiBlockedResource`, `isAiVisibleResource`)
 * live in `resources/registry/resource-visibility.ts` now, beside the rest of
 * the resource registry's helpers. This module only words the refusal for a
 * model, once a tool has already decided the def is blocked. See
 * {@link MAIL_LENS_WRITE_REFUSAL} for why the write wording lives here rather
 * than beside {@link MAIL_LENS_REFUSAL}.
 */

/**
 * What the caller was trying to do, which decides *which* mail tool the refusal
 * names. `read` points at the mail search tools (`MAIL_LENS_REFUSAL`); `write`
 * points at `update_thread`, since telling a model that wanted to set a status
 * to "go and search" is the one hint guaranteed not to help.
 */
export type BlockedEntityIntent = 'read' | 'write'

/**
 * The write half of {@link MAIL_LENS_REFUSAL}. Worded here rather than beside it
 * because the blocked *set* is shared with the picker while this pointer is
 * AI-tool-specific — the picker has no `update_thread` to recommend.
 */
const MAIL_LENS_WRITE_REFUSAL =
  'Threads and messages are not writable through the generic record path — thread changes ' +
  '(status, assignee, tags) go through update_thread, which applies the mail visibility lens.'

/**
 * The refusal an AI tool returns for a blocked def. Names the tool the model
 * should have called, so it can self-correct in the same turn instead of
 * retrying the same door with a different spelling.
 *
 * @param named - the entity reference exactly as the model wrote it
 * @param intent - `read` (default) points at the mail search tools; `write`
 *   points at `update_thread`
 */
export function blockedEntityError(named: string, intent: BlockedEntityIntent = 'read'): string {
  const pointer = intent === 'write' ? MAIL_LENS_WRITE_REFUSAL : MAIL_LENS_REFUSAL
  const substitute = intent === 'write' ? 'record write' : 'record query'
  return (
    `Entity type "${named}" is not reachable through the record tools. ${pointer} ` +
    `If the mail tools are not available on this surface, say so rather than substituting a ` +
    `${substitute}.`
  )
}
