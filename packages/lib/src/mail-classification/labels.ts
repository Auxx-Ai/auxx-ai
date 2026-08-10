// packages/lib/src/mail-classification/labels.ts
// READ: the eligible-tag lookup that becomes the prompt's label set (§3.2).
//
// Tags are `EntityInstance`s on the `tag` def and their live values are
// `FieldValue` rows — the `Tag` pgTable is legacy and must not be read here
// (plan §0.1). Field ids come from the org cache; only the instance rows are
// queried, and only for an inbox that already opted in (guard step 3 runs first).

import { type Database, schema } from '@auxx/database'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { getCachedCustomFields, getCachedEntityDefId } from '../cache'
import { type MailClassificationLabel, TAG_AI_CLASSIFY_ATTRIBUTE } from './client'

/**
 * `tag_scope` value the classifier accepts (plan Q3).
 *
 * `article` tags exist for KB content; offering them to a mail classifier is a
 * category error, so they never reach the prompt even when their
 * `tag_ai_classify` toggle is on.
 */
const THREAD_SCOPE = 'thread'

/**
 * Read the `tag_scope` of a tag as a scalar.
 *
 * ⚠️ `SINGLE_SELECT` values are stored in `FieldValue.optionId` but surface as
 * ARRAYS through the generic read paths (invariant 13). This module reads the
 * column directly, so it is already scalar — the normalization is here anyway so
 * a future switch to a composed read cannot silently compare `['thread']` to
 * `'thread'` and drop every label.
 */
function normalizeScope(raw: unknown): string {
  const value = Array.isArray(raw) ? raw[0] : raw
  // Absent scope means the tag predates migration 019, which backfilled every
  // tag to `thread`. Treat missing as `thread` for the same reason.
  return typeof value === 'string' && value.length > 0 ? value : THREAD_SCOPE
}

/**
 * Every tag the classifier may apply for this org: `tag_ai_classify = true`,
 * `tag_scope = 'thread'`, not archived.
 *
 * Org-wide, not per inbox (Q2) — one flag on the tag, one place to manage it,
 * matching how tags already work.
 *
 * Returns `[]` rather than throwing when the `tag` def or the `tag_ai_classify`
 * field is not materialized yet: an org mid-migration has no eligible tags,
 * which is guard exit 4, not an error.
 */
export async function getEligibleClassificationTags(
  db: Database,
  organizationId: string
): Promise<MailClassificationLabel[]> {
  const tagDefId = await getCachedEntityDefId(organizationId, 'tag')
  if (!tagDefId) return []

  const fields = await getCachedCustomFields(organizationId, tagDefId)
  const fieldIdFor = (attribute: string) =>
    fields.find((field) => field.systemAttribute === attribute)?.id

  const aiClassifyFieldId = fieldIdFor(TAG_AI_CLASSIFY_ATTRIBUTE)
  // The registry field has not been materialized for this org yet (§2.1). No
  // eligible tags is the correct answer, and it is also the safe one.
  if (!aiClassifyFieldId) return []

  const titleFieldId = fieldIdFor('title')
  const descriptionFieldId = fieldIdFor('tag_description')
  const scopeFieldId = fieldIdFor('tag_scope')

  const eligibleRows = await db
    .select({ tagId: schema.FieldValue.entityId })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        eq(schema.FieldValue.fieldId, aiClassifyFieldId),
        eq(schema.FieldValue.valueBoolean, true)
      )
    )

  const tagIds = [...new Set(eligibleRows.map((row) => row.tagId).filter(Boolean))]
  if (tagIds.length === 0) return []

  const instances = await db
    .select({ id: schema.EntityInstance.id, displayName: schema.EntityInstance.displayName })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        eq(schema.EntityInstance.entityDefinitionId, tagDefId),
        inArray(schema.EntityInstance.id, tagIds),
        isNull(schema.EntityInstance.archivedAt)
      )
    )
  if (instances.length === 0) return []

  const liveIds = instances.map((row) => row.id)
  const wantedFieldIds = [titleFieldId, descriptionFieldId, scopeFieldId].filter(
    (id): id is string => Boolean(id)
  )

  const valueRows = wantedFieldIds.length
    ? await db
        .select({
          entityId: schema.FieldValue.entityId,
          fieldId: schema.FieldValue.fieldId,
          valueText: schema.FieldValue.valueText,
          optionId: schema.FieldValue.optionId,
        })
        .from(schema.FieldValue)
        .where(
          and(
            eq(schema.FieldValue.organizationId, organizationId),
            inArray(schema.FieldValue.entityId, liveIds),
            inArray(schema.FieldValue.fieldId, wantedFieldIds)
          )
        )
    : []

  const titles = new Map<string, string>()
  const descriptions = new Map<string, string>()
  const scopes = new Map<string, string>()
  for (const row of valueRows) {
    if (!row.entityId) continue
    if (row.fieldId === titleFieldId && row.valueText) titles.set(row.entityId, row.valueText)
    if (row.fieldId === descriptionFieldId && row.valueText) {
      descriptions.set(row.entityId, row.valueText)
    }
    if (row.fieldId === scopeFieldId) {
      scopes.set(row.entityId, normalizeScope(row.optionId ?? row.valueText))
    }
  }

  const labels: MailClassificationLabel[] = []
  for (const instance of instances) {
    if (normalizeScope(scopes.get(instance.id)) !== THREAD_SCOPE) continue
    const title = titles.get(instance.id) ?? instance.displayName ?? ''
    // A label with no name is unusable in a prompt and unmatchable in the enum
    // description — skip it rather than offering the model a blank choice.
    if (!title.trim()) continue
    labels.push({
      tagId: instance.id,
      title,
      // Q5: an empty description is a UI warning, never a server-side filter.
      description: descriptions.get(instance.id) ?? null,
    })
  }

  labels.sort((a, b) => a.title.localeCompare(b.title))
  return labels
}
