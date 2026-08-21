// packages/lib/src/resources/merge/merge-service.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { getFieldId, isFieldPath, isResourceFieldId, toResourceFieldIds } from '@auxx/types/field'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { resolveSuggestionsForMerge } from '../../dedup/pairs'
import { touchEntityActivity } from '../../entity-instances/activity'
import { BadRequestError, ForbiddenError, NotFoundError } from '../../errors'
import { formatToRawValue } from '../../field-values/client'
import { FieldValueService } from '../../field-values/field-value-service'
import { parseRecordId, type RecordId } from '../resource-id'
import { mergeFieldValue } from './merge'
import type { MergeEntitiesInput, MergeEntitiesResult } from './types'

/** Narrow an untyped jsonb `options` column to the object shape merges expect. */
function asOptionsObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/**
 * Service for merging multiple entity instances into a single target.
 * Handles field values, task references, and relationship redirects atomically.
 */
export class EntityMergeService {
  constructor(
    private readonly db: Database,
    private readonly organizationId: string,
    private readonly userId: string
  ) {}

  /**
   * Merge source instances into target instance.
   * All operations happen within a transaction for atomicity.
   */
  async merge(input: MergeEntitiesInput): Promise<MergeEntitiesResult> {
    const { targetRecordId, sourceRecordIds } = input

    // Validation
    await this.validateMergeInput(input)

    const { entityDefinitionId, entityInstanceId: targetId } = parseRecordId(targetRecordId)
    const sourceIds = sourceRecordIds.map((rid) => parseRecordId(rid).entityInstanceId)

    // Execute merge in transaction
    const result = await this.db.transaction(async (tx) => {
      // 1. Get field definitions
      const fields = await this.getFieldDefinitions(tx, entityDefinitionId)

      // 2. Load all field values (with explicit conversion to raw format)
      const allValues = await this.loadAllFieldValues(tx, targetRecordId, sourceRecordIds, fields)

      // 3. Merge each field
      const mergedValues: Array<{ fieldId: string; value: unknown }> = []

      for (const field of fields) {
        const targetValue = allValues.target[field.id] ?? null
        const sourceValues = sourceRecordIds.map(
          (_rid, idx) => allValues.sources[idx]?.[field.id] ?? null
        )

        const result = mergeFieldValue({
          targetValue,
          sourceValues,
          fieldType: field.type as FieldType,
          fieldOptions: field.options ?? undefined,
        })

        if (result.wasModified) {
          mergedValues.push({ fieldId: field.id, value: result.value })
        }
      }

      // 4. Apply merged values to target (with explicit conversion back)
      const fieldsMerged = await this.applyMergedValues(tx, targetRecordId, mergedValues, fields)

      // 5. Transfer task references
      const taskReferencesTransferred = await this.mergeTaskReferences(
        tx,
        sourceIds,
        targetId,
        entityDefinitionId
      )

      // 6. Redirect external relationships
      const relationshipsRedirected = await this.redirectExternalRelationships(
        tx,
        sourceIds,
        targetId,
        entityDefinitionId
      )

      // 6b. Re-point RecordIdentity rows. Archive (step 7) is a soft delete, so
      // the FK cascade never fires — without this, source index rows (incl.
      // app-less chat visitorId links, which have no FieldValue to carry them)
      // are stranded on the archived source and lost.
      const identitiesRedirected = await this.redirectRecordIdentities(tx, sourceIds, targetId)

      // 6c. Re-point mail links and connector bindings. Archive (step 7) is a
      // soft delete, so without this the archived source keeps all mail history
      // (participant links only fill when NULL, so future mail stays on it too)
      // and every subsequent connector sync rebinds to the archived source.
      await this.redirectMailAndConnectorLinks(tx, sourceIds, targetId)

      // 7. Archive sources
      await this.archiveSourceInstances(tx, sourceIds)

      // 7b. Resolve the duplicate suggestions this merge answers — INSIDE the
      // transaction, so a rolled-back merge cannot leave the queue reporting a
      // merge that did not happen. Archive (step 7) is a soft delete, so the
      // `DuplicateSuggestion` FK cascade never fires and the pairs survive
      // unless this runs. The pair whose both sides are in the merge set is
      // stamped `merged` (terminal, and the record that this suggestion led
      // somewhere); every other open pair touching an archived source is
      // deleted — its surviving side may still duplicate the TARGET, but that is
      // a fact for the target's next scan to establish, not one to migrate
      // blindly.
      const resolved = await resolveSuggestionsForMerge(
        tx,
        this.organizationId,
        targetId,
        sourceIds
      )
      if (resolved.isErr()) throw resolved.error

      // Merge is meaningful activity on the target — surface it for staleness scanners.
      await touchEntityActivity([targetId], this.organizationId, new Date(), tx)

      return {
        mergedRecordId: targetRecordId,
        mergedCount: sourceRecordIds.length,
        fieldsMerged,
        taskReferencesTransferred,
        relationshipsRedirected,
        identitiesRedirected,
      }
    })

    return result
  }

  // ─────────────────────────────────────────────────────────────────
  // VALIDATION
  // ─────────────────────────────────────────────────────────────────

  /** Validate merge input before processing */
  private async validateMergeInput(input: MergeEntitiesInput): Promise<void> {
    const { sourceRecordIds, targetRecordId } = input

    if (sourceRecordIds.length === 0) {
      throw new BadRequestError('At least one source entity is required for merge')
    }

    // All must be same entityDefinitionId
    const targetParsed = parseRecordId(targetRecordId)
    const allSameType = sourceRecordIds.every(
      (rid) => parseRecordId(rid).entityDefinitionId === targetParsed.entityDefinitionId
    )
    if (!allSameType) {
      throw new BadRequestError('All entities must be of the same type to merge')
    }

    // Target cannot be in sources
    if (sourceRecordIds.includes(targetRecordId)) {
      throw new BadRequestError('Target entity cannot be in the source list')
    }

    // Verify all instances exist and belong to organization
    const allIds = [
      targetParsed.entityInstanceId,
      ...sourceRecordIds.map((r) => parseRecordId(r).entityInstanceId),
    ]
    const instances = await this.db
      .select({
        id: schema.EntityInstance.id,
        organizationId: schema.EntityInstance.organizationId,
        archivedAt: schema.EntityInstance.archivedAt,
      })
      .from(schema.EntityInstance)
      .where(inArray(schema.EntityInstance.id, allIds))

    if (instances.length !== allIds.length) {
      throw new NotFoundError('One or more entities not found')
    }

    if (!instances.every((i) => i.organizationId === this.organizationId)) {
      throw new ForbiddenError('Cannot merge entities from different organizations')
    }

    if (instances.some((i) => i.archivedAt !== null)) {
      throw new BadRequestError('Cannot merge archived entities')
    }
  }

  // ─────────────────────────────────────────────────────────────────
  // FIELD OPERATIONS
  // ─────────────────────────────────────────────────────────────────

  /** Get field definitions for entity type */
  private async getFieldDefinitions(
    tx: Transaction,
    entityDefinitionId: string
  ): Promise<Array<{ id: string; type: string; options: Record<string, unknown> | null }>> {
    const rows = await tx
      .select({
        id: schema.CustomField.id,
        type: schema.CustomField.type,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.entityDefinitionId, entityDefinitionId),
          eq(schema.CustomField.organizationId, this.organizationId)
        )
      )

    // `CustomField.options` is jsonb, so Drizzle hands it back as `unknown`.
    // Only an object shape is usable by `mergeFieldValue`.
    return rows.map((row) => ({ ...row, options: asOptionsObject(row.options) }))
  }

  /**
   * Load all field values and convert to raw format for merging.
   * EXPLICIT CONVERSION: TypedFieldValue → raw values
   */
  private async loadAllFieldValues(
    tx: Transaction,
    targetRecordId: RecordId,
    sourceRecordIds: RecordId[],
    fields: Array<{ id: string; type: string }>
  ): Promise<{
    target: Record<string, unknown>
    sources: Array<Record<string, unknown>>
  }> {
    const fieldValueService = new FieldValueService(this.organizationId, this.userId, tx)

    const allRecordIds = [targetRecordId, ...sourceRecordIds]
    const fieldIds = fields.map((f) => f.id)

    // Get entityDefinitionId from target record
    const { entityDefinitionId } = parseRecordId(targetRecordId)

    // Batch fetch all field values (returns TypedFieldValue format)
    const { values: allValues } = await fieldValueService.batchGetValues({
      recordIds: allRecordIds,
      fieldReferences: toResourceFieldIds(entityDefinitionId, fieldIds),
    })

    // Group by recordId
    const valuesByRecord = new Map<string, Map<string, unknown>>()
    for (const v of allValues) {
      if (!valuesByRecord.has(v.recordId)) {
        valuesByRecord.set(v.recordId, new Map())
      }

      // Extract fieldId from fieldRef (handles both direct and path references).
      // A bare `FieldId` is already the id — running it through `getFieldId`
      // would find no colon and yield the empty string, silently dropping the
      // field from the merge.
      const leafRef = isFieldPath(v.fieldRef)
        ? // `FieldPath` is a non-empty tuple, so `[0]` is the type-safe floor.
          (v.fieldRef[v.fieldRef.length - 1] ?? v.fieldRef[0])
        : v.fieldRef
      const fieldId = isResourceFieldId(leafRef) ? getFieldId(leafRef) : leafRef

      // EXPLICIT CONVERSION: TypedFieldValue → raw value
      const field = fields.find((f) => f.id === fieldId)
      if (field) {
        const rawValue = formatToRawValue(v.value, field.type as FieldType)
        valuesByRecord.get(v.recordId)!.set(fieldId, rawValue)
      }
    }

    // Extract target and sources
    const target: Record<string, unknown> = {}
    const targetMap = valuesByRecord.get(targetRecordId)
    if (targetMap) {
      for (const [fieldId, value] of targetMap) {
        target[fieldId] = value
      }
    }

    const sources: Array<Record<string, unknown>> = []
    for (const sourceRecordId of sourceRecordIds) {
      const source: Record<string, unknown> = {}
      const sourceMap = valuesByRecord.get(sourceRecordId)
      if (sourceMap) {
        for (const [fieldId, value] of sourceMap) {
          source[fieldId] = value
        }
      }
      sources.push(source)
    }

    return { target, sources }
  }

  /**
   * Apply merged values to target entity.
   * EXPLICIT CONVERSION: raw values → TypedFieldValueInput (via FieldValueService)
   */
  private async applyMergedValues(
    tx: Transaction,
    targetRecordId: RecordId,
    mergedValues: Array<{ fieldId: string; value: unknown }>,
    fields: Array<{ id: string; type: string }>
  ): Promise<number> {
    if (mergedValues.length === 0) return 0

    const fieldValueService = new FieldValueService(this.organizationId, this.userId, tx)

    // Convert field array to map for quick lookup
    const fieldMap = new Map(fields.map((f) => [f.id, f]))

    // FieldValueService.setValue internally uses formatToTypedInput
    // to convert raw values → TypedFieldValueInput
    await fieldValueService.setValuesForEntity({
      recordId: targetRecordId,
      values: mergedValues,
      publishEvents: false,
      skipInverseSync: true, // We handle relationship redirect separately
    })

    return mergedValues.length
  }

  // ─────────────────────────────────────────────────────────────────
  // TASK REFERENCE MERGE
  // ─────────────────────────────────────────────────────────────────

  /** Transfer task references from source entities to target */
  private async mergeTaskReferences(
    tx: Transaction,
    sourceIds: string[],
    targetId: string,
    entityDefinitionId: string
  ): Promise<number> {
    const sourceRefs = await tx
      .select()
      .from(schema.TaskReference)
      .where(
        and(
          inArray(schema.TaskReference.referencedEntityInstanceId, sourceIds),
          eq(schema.TaskReference.organizationId, this.organizationId),
          isNull(schema.TaskReference.deletedAt)
        )
      )

    if (sourceRefs.length === 0) return 0

    const targetRefs = await tx
      .select({ taskId: schema.TaskReference.taskId })
      .from(schema.TaskReference)
      .where(
        and(
          eq(schema.TaskReference.referencedEntityInstanceId, targetId),
          eq(schema.TaskReference.organizationId, this.organizationId),
          isNull(schema.TaskReference.deletedAt)
        )
      )

    const targetTaskIds = new Set(targetRefs.map((r) => r.taskId))

    // Separate into two groups for batch operations
    const idsToDelete: string[] = []
    const idsToTransfer: string[] = []

    for (const ref of sourceRefs) {
      if (targetTaskIds.has(ref.taskId)) {
        idsToDelete.push(ref.id)
      } else {
        idsToTransfer.push(ref.id)
        targetTaskIds.add(ref.taskId)
      }
    }

    // Batch delete duplicates (1 query)
    if (idsToDelete.length > 0) {
      await tx
        .update(schema.TaskReference)
        .set({ deletedAt: new Date() })
        .where(inArray(schema.TaskReference.id, idsToDelete))
    }

    // Batch transfer to target (1 query)
    if (idsToTransfer.length > 0) {
      await tx
        .update(schema.TaskReference)
        .set({
          referencedEntityInstanceId: targetId,
          referencedEntityDefinitionId: entityDefinitionId,
        })
        .where(inArray(schema.TaskReference.id, idsToTransfer))
    }

    return idsToTransfer.length
  }

  // ─────────────────────────────────────────────────────────────────
  // RELATIONSHIP REDIRECT
  // ─────────────────────────────────────────────────────────────────

  /** Redirect external relationships pointing to source entities to target */
  private async redirectExternalRelationships(
    tx: Transaction,
    sourceIds: string[],
    targetId: string,
    entityDefinitionId: string
  ): Promise<number> {
    // Find all FieldValue rows where relatedEntityId points to any source
    const incomingRelationships = await tx
      .select({
        id: schema.FieldValue.id,
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
        relatedEntityId: schema.FieldValue.relatedEntityId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          inArray(schema.FieldValue.relatedEntityId, sourceIds),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )

    if (incomingRelationships.length === 0) return 0

    // Group by (entityId, fieldId) to handle multi-value deduplication
    const byEntityField = new Map<string, typeof incomingRelationships>()
    for (const rel of incomingRelationships) {
      const key = `${rel.entityId}:${rel.fieldId}`
      if (!byEntityField.has(key)) byEntityField.set(key, [])
      byEntityField.get(key)!.push(rel)
    }

    // Check if each (entityId, fieldId) already has a reference to target
    const existingTargetRefs = await tx
      .select({
        entityId: schema.FieldValue.entityId,
        fieldId: schema.FieldValue.fieldId,
      })
      .from(schema.FieldValue)
      .where(
        and(
          eq(schema.FieldValue.relatedEntityId, targetId),
          eq(schema.FieldValue.organizationId, this.organizationId)
        )
      )

    const alreadyHasTarget = new Set(existingTargetRefs.map((r) => `${r.entityId}:${r.fieldId}`))

    // Separate into two groups for batch operations
    const idsToUpdate: string[] = []
    const idsToDelete: string[] = []

    for (const [key, rels] of byEntityField) {
      if (alreadyHasTarget.has(key)) {
        // All are duplicates - delete them
        idsToDelete.push(...rels.map((r) => r.id))
      } else {
        // Update first, delete rest
        const [first, ...rest] = rels
        if (first) {
          idsToUpdate.push(first.id)
          if (rest.length > 0) {
            idsToDelete.push(...rest.map((r) => r.id))
          }
          alreadyHasTarget.add(key)
        }
      }
    }

    // Batch update (1 query)
    if (idsToUpdate.length > 0) {
      await tx
        .update(schema.FieldValue)
        .set({
          relatedEntityId: targetId,
          relatedEntityDefinitionId: entityDefinitionId,
        })
        .where(inArray(schema.FieldValue.id, idsToUpdate))
    }

    // Batch delete (1 query)
    if (idsToDelete.length > 0) {
      await tx.delete(schema.FieldValue).where(inArray(schema.FieldValue.id, idsToDelete))
    }

    return idsToUpdate.length
  }

  // ─────────────────────────────────────────────────────────────────
  // RECORDIDENTITY REDIRECT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Move source `RecordIdentity` rows onto the target, deduping on the
   * `(entityInstanceId, source, connectionId, appFieldKey)` unique key —
   * mirrors `redirectExternalRelationships`'s group/dedupe/batch shape.
   * Re-pointing a row only changes `entityInstanceId`, so the OTHER unique key
   * `(organizationId, source, connectionId, appFieldKey, externalId)` is never
   * touched and can't collide here.
   */
  private async redirectRecordIdentities(
    tx: Transaction,
    sourceIds: string[],
    targetId: string
  ): Promise<number> {
    const sourceRows = await tx
      .select({
        id: schema.RecordIdentity.id,
        source: schema.RecordIdentity.source,
        connectionId: schema.RecordIdentity.connectionId,
        appFieldKey: schema.RecordIdentity.appFieldKey,
      })
      .from(schema.RecordIdentity)
      .where(
        and(
          inArray(schema.RecordIdentity.entityInstanceId, sourceIds),
          eq(schema.RecordIdentity.organizationId, this.organizationId)
        )
      )

    if (sourceRows.length === 0) return 0

    const kindKey = (row: {
      source: string
      connectionId: string | null
      appFieldKey: string | null
    }) => `${row.source}:${row.connectionId ?? ''}:${row.appFieldKey ?? ''}`

    const byKind = new Map<string, typeof sourceRows>()
    for (const row of sourceRows) {
      const key = kindKey(row)
      const existing = byKind.get(key)
      if (existing) existing.push(row)
      else byKind.set(key, [row])
    }

    const targetRows = await tx
      .select({
        source: schema.RecordIdentity.source,
        connectionId: schema.RecordIdentity.connectionId,
        appFieldKey: schema.RecordIdentity.appFieldKey,
      })
      .from(schema.RecordIdentity)
      .where(
        and(
          eq(schema.RecordIdentity.entityInstanceId, targetId),
          eq(schema.RecordIdentity.organizationId, this.organizationId)
        )
      )
    const targetHasKind = new Set(targetRows.map(kindKey))

    const idsToUpdate: string[] = []
    const idsToDelete: string[] = []
    for (const [key, rows] of byKind) {
      if (targetHasKind.has(key)) {
        // Target already carries this identity kind — the source rows are
        // redundant duplicates, not a new fact about the merged record.
        idsToDelete.push(...rows.map((r) => r.id))
      } else {
        const [first, ...rest] = rows
        if (first) {
          idsToUpdate.push(first.id)
          idsToDelete.push(...rest.map((r) => r.id))
          targetHasKind.add(key)
        }
      }
    }

    if (idsToUpdate.length > 0) {
      await tx
        .update(schema.RecordIdentity)
        .set({ entityInstanceId: targetId })
        .where(inArray(schema.RecordIdentity.id, idsToUpdate))
    }
    if (idsToDelete.length > 0) {
      await tx.delete(schema.RecordIdentity).where(inArray(schema.RecordIdentity.id, idsToDelete))
    }

    return idsToUpdate.length
  }

  // ─────────────────────────────────────────────────────────────────
  // MAIL & CONNECTOR LINK REDIRECT
  // ─────────────────────────────────────────────────────────────────

  /**
   * Re-point mail participant links, thread primaries, and connector item
   * bindings from the sources to the target. All four are blanket UPDATEs:
   * none of these columns participates in a unique key
   * (`Participant` is unique on `(organizationId, identifier, identifierType)`,
   * `ThreadParticipant` on `(threadId, email)`), and multiple
   * `DataConnectorItem` rows sharing one instance is the documented shape.
   */
  private async redirectMailAndConnectorLinks(
    tx: Transaction,
    sourceIds: string[],
    targetId: string
  ): Promise<void> {
    await tx
      .update(schema.Participant)
      .set({ entityInstanceId: targetId })
      .where(
        and(
          inArray(schema.Participant.entityInstanceId, sourceIds),
          eq(schema.Participant.organizationId, this.organizationId)
        )
      )

    // ThreadParticipant has no organizationId column — instance ids are
    // globally unique CUIDs already validated to belong to this org.
    await tx
      .update(schema.ThreadParticipant)
      .set({ entityInstanceId: targetId })
      .where(inArray(schema.ThreadParticipant.entityInstanceId, sourceIds))

    // `primaryEntityDefinitionId` stays as-is: sources and target are
    // validated to share the same definition.
    await tx
      .update(schema.Thread)
      .set({ primaryEntityInstanceId: targetId })
      .where(
        and(
          inArray(schema.Thread.primaryEntityInstanceId, sourceIds),
          eq(schema.Thread.organizationId, this.organizationId)
        )
      )

    await tx
      .update(schema.DataConnectorItem)
      .set({ entityInstanceId: targetId })
      .where(
        and(
          inArray(schema.DataConnectorItem.entityInstanceId, sourceIds),
          eq(schema.DataConnectorItem.organizationId, this.organizationId)
        )
      )
  }

  // ─────────────────────────────────────────────────────────────────
  // ARCHIVE SOURCES
  // ─────────────────────────────────────────────────────────────────

  /** Archive source instances after merge */
  private async archiveSourceInstances(tx: Transaction, sourceIds: string[]): Promise<void> {
    const now = new Date()
    await tx
      .update(schema.EntityInstance)
      // D-7 explicit content stamp: archive is a content change and
      // `updatedAt` no longer auto-bumps (`$onUpdate` removed).
      .set({ archivedAt: now, updatedAt: now })
      .where(
        and(
          inArray(schema.EntityInstance.id, sourceIds),
          eq(schema.EntityInstance.organizationId, this.organizationId)
        )
      )
  }
}
