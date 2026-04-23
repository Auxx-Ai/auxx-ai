// packages/services/src/field-values/update-ai-marker.ts

import { database, schema } from '@auxx/database'
import { and, eq } from 'drizzle-orm'
import { err, ok } from 'neverthrow'
import { fromDatabase } from '../shared/utils'
import type { FieldValueRow } from './types'

/**
 * Input for a partial AI-marker update.
 * Touches ONLY `aiStatus` + `valueJson` on the specified row — all typed
 * value columns are left untouched so the last-good value stays visible
 * behind the overlay.
 */
export interface UpdateAiMarkerInput {
  /** FieldValue row id */
  id: string
  organizationId: string
  /** `null` clears the marker; string values persist the current AI state. */
  aiStatus: 'generating' | 'result' | 'error' | null
  /** Full metadata bag to persist (or `null` to clear). */
  valueJson: unknown | null
}

/**
 * Apply an AI marker to an existing FieldValue row without touching the
 * typed value columns. Used by ai-enqueue (stage-1 generating marker) and
 * ai-commit (stage-2 error writes).
 */
export async function updateAiMarker(input: UpdateAiMarkerInput) {
  const { id, organizationId, aiStatus, valueJson } = input

  const dbResult = await fromDatabase(
    database
      .update(schema.FieldValue)
      .set({
        aiStatus,
        valueJson: valueJson ?? null,
      })
      .where(
        and(eq(schema.FieldValue.id, id), eq(schema.FieldValue.organizationId, organizationId))
      )
      .returning(),
    'update-ai-marker'
  )

  if (dbResult.isErr()) {
    return dbResult
  }

  const row = dbResult.value[0]
  if (!row) {
    return err({
      code: 'FIELD_VALUE_NOT_FOUND' as const,
      message: `Field value with ID "${id}" not found`,
      entityId: '',
      fieldId: '',
    })
  }

  return ok(row as FieldValueRow)
}
