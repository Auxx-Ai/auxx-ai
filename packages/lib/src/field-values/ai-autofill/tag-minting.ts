// packages/lib/src/field-values/ai-autofill/tag-minting.ts

import { database } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import type { FieldOptions } from '../../custom-fields/field-options'
import { mintOrMatchOptions } from '../../custom-fields/mint-options'

const logger = createScopedLogger('ai-autofill:tag-minting')

/**
 * Map generated tag LABELS onto option ids for an open TAGS field
 * (`options.ai.allowNewOptions`), minting only what genuinely does not exist.
 *
 * A thin gate over {@link mintOrMatchOptions}, which owns the mechanics — the
 * row lock, the re-read under it, match-before-mint, and the union write. That
 * function is deliberately gate-free because the importer comes through it too
 * under a DIFFERENT permission (`canGrowFieldOptions` + `fieldAllowsNewOptions`
 * + a per-column opt-in). Keep this caller's `ai.allowNewOptions` check here.
 *
 * @param params.field - The TAGS field. Its `options` may be stale; the
 *   authoritative list is re-read under the lock.
 * @param params.labels - Raw strings from the LLM.
 * @param params.dryRun - Preview mode: match against what exists, never mint.
 * @returns Option ids, in the order the model produced them.
 */
export async function mintOrMatchTagOptions(params: {
  organizationId: string
  field: CustomFieldEntity
  labels: unknown[]
  dryRun?: boolean
}): Promise<string[]> {
  const { organizationId, field, labels, dryRun = false } = params

  const result = await mintOrMatchOptions(database, {
    fieldId: field.id,
    organizationId,
    labels,
    storedOptions: ((field.options ?? {}) as FieldOptions).options ?? [],
    dryRun,
  })

  if (!dryRun && result.minted > 0) {
    logger.info('AI autofill minted tag options', {
      organizationId,
      fieldId: field.id,
      minted: result.minted,
    })
  }

  return result.ids
}
