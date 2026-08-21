// packages/lib/src/field-values/ai-autofill/tag-minting.ts

import { database, schema } from '@auxx/database'
import type { CustomFieldEntity } from '@auxx/database/types'
import { createScopedLogger } from '@auxx/logger'
import { generateId } from '@auxx/utils/generateId'
import { and, eq } from 'drizzle-orm'
import { onCacheEvent } from '../../cache/invalidate'
import type { FieldOptions } from '../../custom-fields/field-options'

const logger = createScopedLogger('ai-autofill:tag-minting')

type SelectOptionRow = NonNullable<FieldOptions['options']>[number]

/**
 * Fold a tag label onto its match key. Case- and whitespace-insensitive, so
 * `Enterprise`, `enterprise` and ` Enterprise ` all collapse onto one option.
 */
function matchKey(label: string): string {
  return label.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** The id a FieldValue stores for an option row: `id` when present, else `value`. */
function optionId(option: SelectOptionRow): string | undefined {
  return option.id ?? option.value
}

/** Index existing options by match key, first writer winning on a collision. */
function indexByMatchKey(options: SelectOptionRow[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const option of options) {
    const id = optionId(option)
    const label = option.label ?? option.value
    if (!id || !label) continue
    const key = matchKey(label)
    if (!index.has(key)) index.set(key, id)
  }
  return index
}

/** Trim, drop blanks, and dedupe generated labels while preserving order. */
function cleanLabels(labels: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const label = raw.trim().replace(/\s+/g, ' ')
    if (label === '') continue
    const key = matchKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/**
 * Map generated tag LABELS onto option ids for an open TAGS field
 * (`options.ai.allowNewOptions`), minting only what genuinely does not exist.
 *
 * This is the **single writer** for AI-grown tag taxonomies, and the only place
 * in AI autofill that writes outside `FieldValue`.
 *
 * 🛑 Never read-modify-write from the job. A bulk generate runs N parallel jobs
 * against the same `options.options` array; two workers that each read, append
 * and write would lose one another's tags and mint `Enterprise` twice under
 * different ids. The append therefore happens inside a transaction that takes a
 * row lock on the `CustomField` row and re-reads the option list under it, so
 * the match-before-mint decision is made against committed state.
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

  const wanted = cleanLabels(labels)
  if (wanted.length === 0) return []

  // Preview never grows the taxonomy — a dry run on an unsaved field
  // definition has no business editing the field it is previewing.
  if (dryRun) {
    const index = indexByMatchKey(((field.options ?? {}) as FieldOptions).options ?? [])
    return wanted.map((label) => index.get(matchKey(label)) ?? label)
  }

  const { ids, minted } = await database.transaction(async (tx) => {
    const [row] = await tx
      .select({ options: schema.CustomField.options })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.id, field.id),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .for('update')
      .limit(1)

    const current = ((row?.options ?? {}) as FieldOptions).options ?? []
    const index = indexByMatchKey(current)

    const appended: SelectOptionRow[] = []
    const resolved: string[] = []
    for (const label of wanted) {
      const key = matchKey(label)
      const existing = index.get(key)
      if (existing) {
        resolved.push(existing)
        continue
      }
      // Same shape the human tag picker mints: `{ label, value: generateId() }`
      // with no separate `id`, so `optionId` resolves through `value`.
      const option: SelectOptionRow = { value: generateId(), label }
      appended.push(option)
      index.set(key, option.value)
      resolved.push(option.value)
    }

    if (appended.length > 0) {
      await tx
        .update(schema.CustomField)
        .set({
          options: {
            ...((row?.options ?? {}) as FieldOptions),
            options: [...current, ...appended],
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.CustomField.id, field.id),
            eq(schema.CustomField.organizationId, organizationId)
          )
        )
    }

    return { ids: resolved, minted: appended.length }
  })

  if (minted > 0) {
    // Without this, every later job in the batch reads a stale option list from
    // the org cache and re-mints what a sibling just created.
    await onCacheEvent('custom-field.updated', { orgId: organizationId })
    logger.info('AI autofill minted tag options', {
      organizationId,
      fieldId: field.id,
      minted,
    })
  }

  return ids
}
