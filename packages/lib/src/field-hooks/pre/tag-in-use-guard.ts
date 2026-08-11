// packages/lib/src/field-hooks/pre/tag-in-use-guard.ts

import { database, schema } from '@auxx/database'
import { and, count, eq } from 'drizzle-orm'
import { ConflictError } from '../../errors'
import { parseRecordId } from '../../resources/resource-id'
import type { EntityPreDeleteHandler } from '../types'

/**
 * Reject a tag delete while anything still references the tag.
 *
 * ⚠️ **This exists because a tag delete used to silently corrupt every record
 * that carried it.** A tag↔thread link is TWO `FieldValue` rows — the tag side
 * (`tag_threads`, `entityId = tagId`) and the record side (`relatedEntityId =
 * tagId`) — and `relatedEntityId` has NO foreign key (`field-value.ts:93`).
 * Deleting the tag row takes its own field values with it and leaves every
 * record-side row pointing at an id that no longer resolves. Observed in the
 * wild: one deleted tag left 532 orphaned rows, and the mail list went on
 * rendering a tag that did not exist.
 *
 * The count is exactly "rows that would be orphaned by this delete", which is
 * why it deliberately does NOT filter by field: a thread link, an article link
 * and a child tag's `tag_parent` are all references that must not dangle.
 * Indexed by `FieldValue_relatedEntityId_idx`.
 *
 * ## Why `ConflictError` and not `ForbiddenError`
 *
 * Its two siblings — `rejectDeleteIfSystemTag` and `rejectDeleteIfTemplateTag` —
 * throw 403, and correctly: a system tag and a seeded category may NEVER be
 * deleted, by anyone, ever. This is a different answer. The caller is fully
 * authorized and the tag is deletable; it just is not deletable *right now*,
 * and the state that blocks it is one the caller can clear. That is a 409.
 *
 * ## The remedy the message points at
 *
 * Archiving sets `EntityInstance.archivedAt`, which `labels.ts:92` already
 * honours — an archived tag stops being offered to the classifier and stops
 * appearing in pickers, while every record that carries it keeps it. For a
 * label that 529 classification markers already reference, preserving the
 * historical claim is the right default and destroying it is not.
 */
export const rejectDeleteIfTagInUse: EntityPreDeleteHandler = async (event) => {
  const { entityInstanceId } = parseRecordId(event.recordId)

  const [row] = await database
    .select({ references: count() })
    .from(schema.FieldValue)
    .where(
      and(
        eq(schema.FieldValue.relatedEntityId, entityInstanceId),
        eq(schema.FieldValue.organizationId, event.organizationId)
      )
    )

  const references = row?.references ?? 0
  if (references === 0) return

  const label = references === 1 ? '1 record' : `${references} records`
  throw new ConflictError(
    `This tag is still on ${label}. Archive it instead to keep it on them, or remove it from them first.`
  )
}
