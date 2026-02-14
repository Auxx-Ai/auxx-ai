// packages/lib/src/resources/merge/merge-service.ts

import { type Database, schema, type Transaction } from '@auxx/database'
import type { FieldType } from '@auxx/database/types'
import { getFieldId, isFieldPath, toResourceFieldIds } from '@auxx/types/field'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { formatToRawValue } from '../../field-values/client'
import { FieldValueService } from '../../field-values/field-value-service'
import { invalidateSnapshots } from '../../snapshot'
import { parseRecordId, type RecordId } from '../resource-id'
import { mergeFieldValue } from './merge'
import type { MergeEntitiesInput, MergeEntitiesResult } from './types'

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

        // Debug TAGS field merge
        if (field.type === 'TAGS') {
          console.log('🏷️  TAGS field merge input:', {
            fieldId: field.id,
            targetValue,
            sourceValues,
          })
        }

        const result = mergeFieldValue({
          targetValue,
          sourceValues,
          fieldType: field.type as FieldType,
          fieldOptions: field.options ?? undefined,
        })

        // Debug TAGS field merge result
        if (field.type === 'TAGS') {
          console.log('🏷️  TAGS merge result:', {
            fieldId: field.id,
            mergedValue: result.value,
            wasModified: result.wasModified,
          })
        }

        if (result.wasModified) {
          mergedValues.push({ fieldId: field.id, value: result.value })
        }
      }

      // 4. Apply merged values to target (with explicit conversion back)
      // Debug TAGS values being applied
      const tagsMerged = mergedValues.filter((v) =>
        fields.find((f) => f.id === v.fieldId && f.type === 'TAGS')
      )
      if (tagsMerged.length > 0) {
        console.log('📤 Applying TAGS values:', tagsMerged)
      }

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

      // 7. Archive sources
      await this.archiveSourceInstances(tx, sourceIds)

      return {
        mergedRecordId: targetRecordId,
        mergedCount: sourceRecordIds.length,
        fieldsMerged,
        taskReferencesTransferred,
        relationshipsRedirected,
      }
    })

    // 8. Invalidate snapshot cache after successful merge
    // This ensures list views refresh and don't show archived entities
    await invalidateSnapshots({
      organizationId: this.organizationId,
      resourceType: entityDefinitionId,
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
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'At least one source entity is required for merge',
      })
    }

    // All must be same entityDefinitionId
    const targetParsed = parseRecordId(targetRecordId)
    const allSameType = sourceRecordIds.every(
      (rid) => parseRecordId(rid).entityDefinitionId === targetParsed.entityDefinitionId
    )
    if (!allSameType) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'All entities must be of the same type to merge',
      })
    }

    // Target cannot be in sources
    if (sourceRecordIds.includes(targetRecordId)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Target entity cannot be in the source list',
      })
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
      throw new TRPCError({
        code: 'NOT_FOUND',
        message: 'One or more entities not found',
      })
    }

    if (!instances.every((i) => i.organizationId === this.organizationId)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: 'Cannot merge entities from different organizations',
      })
    }

    if (instances.some((i) => i.archivedAt !== null)) {
      throw new TRPCError({
        code: 'BAD_REQUEST',
        message: 'Cannot merge archived entities',
      })
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
    return await tx
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

      // Extract fieldId from fieldRef (handles both direct and path references)
      const fieldId = isFieldPath(v.fieldRef)
        ? getFieldId(v.fieldRef[v.fieldRef.length - 1])
        : getFieldId(v.fieldRef)

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

    // Debug logging for TAGS fields
    const tagsFields = fields.filter((f) => f.type === 'TAGS')
    if (tagsFields.length > 0) {
      console.log('📥 Loaded TAGS field values:', {
        targetRecordId,
        tagsFields: tagsFields.map((f) => ({
          fieldId: f.id,
          targetValue: target[f.id],
          sourceValues: sources.map((s) => s[f.id]),
        })),
      })
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
  // ARCHIVE SOURCES
  // ─────────────────────────────────────────────────────────────────

  /** Archive source instances after merge */
  private async archiveSourceInstances(tx: Transaction, sourceIds: string[]): Promise<void> {
    await tx
      .update(schema.EntityInstance)
      .set({ archivedAt: new Date() })
      .where(
        and(
          inArray(schema.EntityInstance.id, sourceIds),
          eq(schema.EntityInstance.organizationId, this.organizationId)
        )
      )
  }
}
