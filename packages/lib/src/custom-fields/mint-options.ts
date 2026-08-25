// packages/lib/src/custom-fields/mint-options.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { generateId } from '@auxx/utils/generateId'
import { and, eq } from 'drizzle-orm'
import {
  type FieldOptionItem,
  optionKey,
  optionMatchKey,
} from '../resources/registry/option-helpers'
import type { FieldOptions } from './field-options'
import { notifyCustomFieldChanged } from './notify'

/**
 * Index existing options by folded LABEL, first writer winning on a collision.
 *
 * Deliberately NOT `buildOptionIndex`: that one is the READ keyspace
 * (`id` / `value`), and matching an incoming label against a stored key would
 * collapse a value onto an unrelated option. The two indexes coexist — this one
 * decides mint-vs-match, `buildOptionIndex` resolves what got stored.
 */
function indexByMatchKey(options: FieldOptionItem[]): Map<string, string> {
  const index = new Map<string, string>()
  for (const option of options) {
    const id = optionKey(option)
    const label = option.label ?? option.value
    if (!id || !label) continue
    const key = optionMatchKey(label)
    if (!index.has(key)) index.set(key, id)
  }
  return index
}

/** Trim, drop blanks, and dedupe incoming labels while preserving order. */
function cleanLabels(labels: unknown[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of labels) {
    if (typeof raw !== 'string') continue
    const label = raw.trim().replace(/\s+/g, ' ')
    if (label === '') continue
    const key = optionMatchKey(label)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(label)
  }
  return out
}

/** What {@link mintOrMatchOptions} resolved, and what it had to create to do it. */
export interface MintOrMatchResult {
  /** Option keys, in the order the labels came in. */
  ids: string[]
  /** How many options did not already exist and were appended. */
  minted: number
  /** The labels that were appended, for a caller that reports them. */
  mintedLabels: string[]
}

/**
 * Map option LABELS onto option keys for one field, minting only what genuinely
 * does not exist.
 *
 * This is the **single writer** for automated taxonomy growth — AI autofill and
 * the CSV importer both come through here — and the only place outside the
 * field editors that touches `CustomField.options`.
 *
 * 🛑 Deliberately gate-free. *Whether* a field may grow is the caller's
 * question, and the two callers answer it differently: AI autofill reads
 * `options.ai.allowNewOptions`, the importer reads {@link canGrowFieldOptions}
 * plus {@link fieldAllowsNewOptions} plus a per-column opt-in. Folding either
 * gate in here would silently apply it to the other caller.
 *
 * 🛑 Never read-modify-write from a job. A bulk run puts N parallel workers
 * against one `options.options` array; two that each read, append and write lose
 * one another's additions and mint the same label twice under different keys.
 * The append therefore happens inside a transaction that takes a row lock on the
 * `CustomField` row and re-reads the option list under it, so the
 * match-before-mint decision is made against committed state.
 *
 * 🛑 Never routed through `updateCustomField`. That path REPLACES the option
 * array with whatever the patch carried and cascade-deletes the `FieldValue`
 * rows of any key that left the list, so a caller sending only its additions
 * would destroy every existing value. This writes the union directly.
 *
 * @param db - Database instance
 * @param params.fieldId - `CustomField.id` of the field to grow
 * @param params.organizationId - Owning org, scoping every statement
 * @param params.labels - Raw incoming strings
 * @param params.storedOptions - The caller's (possibly stale) copy, used only by `dryRun`
 * @param params.dryRun - Preview mode: match against what exists, never mint
 * @returns Resolved keys plus what was minted
 */
export async function mintOrMatchOptions(
  db: Database,
  params: {
    fieldId: string
    organizationId: string
    labels: unknown[]
    storedOptions?: FieldOptionItem[]
    dryRun?: boolean
  }
): Promise<MintOrMatchResult> {
  const { fieldId, organizationId, labels, dryRun = false } = params

  const wanted = cleanLabels(labels)
  if (wanted.length === 0) return { ids: [], minted: 0, mintedLabels: [] }

  // Preview never grows the taxonomy. An unresolved label comes back as itself,
  // so a caller can report "will be created" without having created it.
  if (dryRun) {
    const index = indexByMatchKey(params.storedOptions ?? [])
    const ids: string[] = []
    const mintedLabels: string[] = []
    for (const label of wanted) {
      const existing = index.get(optionMatchKey(label))
      if (existing) ids.push(existing)
      else {
        ids.push(label)
        mintedLabels.push(label)
      }
    }
    return { ids, minted: mintedLabels.length, mintedLabels }
  }

  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        options: schema.CustomField.options,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.id, fieldId),
          eq(schema.CustomField.organizationId, organizationId)
        )
      )
      .for('update')
      .limit(1)

    const current = ((row?.options ?? {}) as FieldOptions).options ?? []
    const index = indexByMatchKey(current)

    const appended: FieldOptionItem[] = []
    const mintedLabels: string[] = []
    const ids: string[] = []
    for (const label of wanted) {
      const key = optionMatchKey(label)
      const existing = index.get(key)
      if (existing) {
        ids.push(existing)
        continue
      }
      // Same shape both human editors mint: `{ label, value: generateId() }`
      // with no separate `id`, so `optionKey` resolves through `value`. An
      // option's key is minted ONCE and never rewritten — a rename touches
      // `label`/`color` only, because a key leaving the list cascade-deletes
      // every value that carried it.
      const option: FieldOptionItem = { value: generateId(), label }
      appended.push(option)
      mintedLabels.push(label)
      index.set(key, option.value)
      ids.push(option.value)
    }

    if (appended.length > 0) {
      await tx
        .update(schema.CustomField)
        .set({
          options: {
            ...((row?.options ?? {}) as FieldOptions),
            // The UNION. Never the delta — see the contract note above.
            options: [...current, ...appended],
          },
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(schema.CustomField.id, fieldId),
            eq(schema.CustomField.organizationId, organizationId)
          )
        )
    }

    return {
      ids,
      minted: appended.length,
      mintedLabels,
      entityDefinitionId: row?.entityDefinitionId ?? null,
    }
  })

  if (result.minted > 0) {
    if (result.entityDefinitionId) {
      // The chokepoint does both halves: the cache bust (without which the next
      // worker in the batch reads a stale option list and re-mints what this
      // one just created) AND the `resource:updated` broadcast (without which
      // every open client keeps the pre-mint vocabulary and renders the new
      // optionIds as muted unknown chips until an unrelated refetch). One call
      // per grown field per batch — this function is invoked once with every
      // label.
      await notifyCustomFieldChanged(organizationId, result.entityDefinitionId, 'updated')
    } else {
      // A def-less row can't be broadcast, but the cache bust must never be
      // skipped or the next worker re-mints.
      const { onCacheEvent } = await import('../cache/invalidate')
      await onCacheEvent('custom-field.updated', { orgId: organizationId })
    }
  }

  return { ids: result.ids, minted: result.minted, mintedLabels: result.mintedLabels }
}
