// packages/lib/src/entity-definitions/delete-entity-definition.ts

import { type Database, database, schema, type Transaction } from '@auxx/database'
import type { CalcOptions, RelationshipConfig } from '@auxx/types/custom-field'
import { getInverseFieldId } from '@auxx/types/custom-field'
import { isResourceFieldId, parseResourceFieldId, type ResourceFieldId } from '@auxx/types/field'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { clearDisplayValues } from '../entity-instances'
import { ForbiddenError, NotFoundError } from '../errors'

/**
 * Permanently delete a custom entity definition and everything that hangs off
 * it, including the bits the DB cascade can't reach on its own:
 *
 * - **the opposite side of every relationship** — the inverse field on the
 *   related entity plus its now-dangling values (`FieldValue.relatedEntityId`
 *   has no FK, so nothing cleans it automatically);
 * - **CALC fields on other entities** that reference a deleted field;
 * - **connector integrity** — streams left without a root mapping after the
 *   `DataConnectorMapping` cascade are torn down, and connectors left with no
 *   streams are paused.
 *
 * See plans/entitydefinition/delete-entity-definition-plan.md.
 */

/** What the teardown removed/changed beyond the entity itself. */
export interface EntityDefinitionDeleteSummary {
  /** Inverse relationship fields removed on OTHER entities. */
  removedPartnerFieldIds: string[]
  /** CALC fields disabled because a source field was deleted. */
  disabledCalcFieldIds: string[]
  /** Sync streams torn down because they lost their root mapping. */
  streamsTornDown: number
  /** Connectors paused because they were left with zero streams. */
  connectorsPaused: number
}

/** A relationship field as read from the DB (only the bits we need). */
interface RelationshipFieldRow {
  id: string
  options: unknown
}

/**
 * From the deleted entity's own relationship fields, pick the **partner** field
 * ids to delete — the inverse field that lives on the *other* entity. Partners
 * that live on the deleted entity itself (self-referential relationships) are
 * skipped: they cascade with the def. Pure so it can be unit-tested.
 *
 * @param ownRelationshipFields - RELATIONSHIP fields owned by the deleted def.
 * @param partnerOwnerById - fieldId → owning entityDefinitionId, for every
 *   partner field that still exists. A partner absent from the map no longer
 *   exists and is skipped.
 * @param deletedDefId - the entity definition being deleted.
 */
export function selectPartnerFieldIds(params: {
  ownRelationshipFields: RelationshipFieldRow[]
  partnerOwnerById: Map<string, string | null | undefined>
  deletedDefId: string
}): string[] {
  const { ownRelationshipFields, partnerOwnerById, deletedDefId } = params
  const partnerIds = new Set<string>()

  for (const field of ownRelationshipFields) {
    const config = (field.options as { relationship?: RelationshipConfig })?.relationship
    if (!config) continue
    const inverseFieldId = getInverseFieldId(config)
    if (!inverseFieldId) continue
    if (!partnerOwnerById.has(inverseFieldId)) continue // partner already gone
    // Self-referential: partner lives on the deleted def → cascades with it.
    if (partnerOwnerById.get(inverseFieldId) === deletedDefId) continue
    partnerIds.add(inverseFieldId)
  }

  return [...partnerIds]
}

/** A CALC field as read from the DB (only the bits we need). */
interface CalcFieldRow {
  id: string
  entityDefinitionId: string | null
  options: unknown
}

/**
 * Pick CALC fields (on entities that survive) that must be disabled because one
 * of their source fields was deleted. Returns the new `options` to persist for
 * each. CALC fields on the deleted def are skipped — they cascade away. Pure.
 *
 * Mirrors the source-field scan in `@auxx/services` `deleteCustomField`.
 */
export function selectCalcFieldsToDisable(params: {
  calcFields: CalcFieldRow[]
  deletedFieldIds: Set<string>
  deletedDefId: string
}): Array<{ id: string; options: Record<string, unknown> }> {
  const { calcFields, deletedFieldIds, deletedDefId } = params
  const updates: Array<{ id: string; options: Record<string, unknown> }> = []

  for (const calcField of calcFields) {
    if (calcField.entityDefinitionId === deletedDefId) continue // cascades anyway
    const calcOptions = (calcField.options as { calc?: CalcOptions })?.calc
    if (!calcOptions?.sourceFields) continue

    const referencesDeletedField = Object.values(calcOptions.sourceFields).some((ref) => {
      if (isResourceFieldId(ref)) {
        return deletedFieldIds.has(parseResourceFieldId(ref as ResourceFieldId).fieldId)
      }
      return deletedFieldIds.has(ref as string) // legacy bare-id format
    })
    if (!referencesDeletedField) continue

    updates.push({
      id: calcField.id,
      options: {
        ...(calcField.options as Record<string, unknown>),
        calc: { ...calcOptions, disabled: true, disabledReason: 'Source field was deleted' },
      },
    })
  }

  return updates
}

/**
 * Of the streams a delete touched, return those that no longer have a root
 * mapping (`parentMappingId IS NULL`) and so can no longer sync. Pure.
 */
export function selectStreamsWithoutRoot(params: {
  affectedStreamIds: string[]
  streamIdsWithRoot: Set<string>
}): string[] {
  const { affectedStreamIds, streamIdsWithRoot } = params
  return [...new Set(affectedStreamIds)].filter((id) => !streamIdsWithRoot.has(id))
}

/** Display-column pointer affected when a partner field is removed. */
type DisplayColumn = 'displayName' | 'secondaryDisplayValue' | 'avatarUrl'

/**
 * Permanently delete a custom entity definition with full relationship +
 * connector teardown. Throws `NotFoundError` if the def doesn't exist in the
 * org and `ForbiddenError` for system entities (any non-null `entityType`).
 */
export async function deleteEntityDefinitionDeep(params: {
  id: string
  organizationId: string
  db?: Database
}): Promise<EntityDefinitionDeleteSummary> {
  const { id, organizationId, db = database } = params

  // ── Guard: exists, in-org, and is a deletable (custom) entity ──────────────
  const [def] = await db
    .select({ id: schema.EntityDefinition.id, entityType: schema.EntityDefinition.entityType })
    .from(schema.EntityDefinition)
    .where(
      and(
        eq(schema.EntityDefinition.id, id),
        eq(schema.EntityDefinition.organizationId, organizationId)
      )
    )
    .limit(1)

  if (!def) throw new NotFoundError('Entity definition not found')
  // System entities carry a real, non-empty entityType (contact, ticket, …). Custom
  // and connector-owned defs have `null` — but a legacy owned-def create path wrote an
  // empty string, so treat '' the same as null (a truthy check), else those defs are
  // wrongly refused as "system" and can never be deleted (e.g. on connector teardown).
  if (def.entityType) {
    throw new ForbiddenError('System entities cannot be deleted')
  }

  // Display-column cleanup runs AFTER the tx (clearDisplayValues uses the global
  // db); collect the work inside the tx, execute it after commit.
  let displayCleanup: Array<{ entityDefinitionId: string; column: DisplayColumn }> = []

  const summary = await db.transaction(async (tx): Promise<EntityDefinitionDeleteSummary> => {
    // 1. Pre-capture connector streams/connectors that target this def, BEFORE
    //    the cascade removes the mappings.
    const affectedMappingRows = await tx
      .select({
        streamId: schema.DataConnectorMapping.dataConnectorStreamId,
        connectorId: schema.DataConnectorStream.dataConnectorId,
      })
      .from(schema.DataConnectorMapping)
      .innerJoin(
        schema.DataConnectorStream,
        eq(schema.DataConnectorStream.id, schema.DataConnectorMapping.dataConnectorStreamId)
      )
      .where(
        and(
          eq(schema.DataConnectorMapping.entityDefinitionId, id),
          eq(schema.DataConnectorMapping.organizationId, organizationId)
        )
      )
    const affectedStreamIds = [...new Set(affectedMappingRows.map((r) => r.streamId))]
    const affectedConnectorIds = [...new Set(affectedMappingRows.map((r) => r.connectorId))]

    // 2. The deleted entity's own fields (all + relationship subset).
    const ownFields = await tx
      .select({
        id: schema.CustomField.id,
        type: schema.CustomField.type,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(eq(schema.CustomField.entityDefinitionId, id))
    const ownFieldIds = ownFields.map((f) => f.id)
    const ownRelationshipFields = ownFields.filter((f) => f.type === 'RELATIONSHIP')

    // 3. Resolve partner (inverse) fields on OTHER entities, then delete them +
    //    their dangling values. This is the "unset the opposite side" step.
    const candidatePartnerIds = ownRelationshipFields
      .map((f) =>
        getInverseFieldId(
          (f.options as { relationship?: RelationshipConfig })?.relationship ??
            ({} as RelationshipConfig)
        )
      )
      .filter((v): v is string => !!v)

    let removedPartnerFieldIds: string[] = []
    if (candidatePartnerIds.length > 0) {
      const partnerRows = await tx
        .select({
          id: schema.CustomField.id,
          entityDefinitionId: schema.CustomField.entityDefinitionId,
        })
        .from(schema.CustomField)
        .where(
          and(
            inArray(schema.CustomField.id, candidatePartnerIds),
            eq(schema.CustomField.organizationId, organizationId)
          )
        )
      const partnerOwnerById = new Map(partnerRows.map((r) => [r.id, r.entityDefinitionId]))

      removedPartnerFieldIds = selectPartnerFieldIds({
        ownRelationshipFields,
        partnerOwnerById,
        deletedDefId: id,
      })

      if (removedPartnerFieldIds.length > 0) {
        // Capture display pointers BEFORE delete (the EntityDefinition FK
        // onDelete:'set null' clears them during the delete).
        displayCleanup = await collectDisplayCleanup(tx, removedPartnerFieldIds, organizationId)

        // Delete the inverse values first (dangling), then the partner fields.
        await tx
          .delete(schema.FieldValue)
          .where(inArray(schema.FieldValue.fieldId, removedPartnerFieldIds))
        await tx
          .delete(schema.CustomField)
          .where(
            and(
              inArray(schema.CustomField.id, removedPartnerFieldIds),
              eq(schema.CustomField.organizationId, organizationId)
            )
          )
      }
    }

    // 4. Disable CALC fields (on surviving entities) that reference any deleted
    //    field — the def's own fields or a removed partner field.
    const deletedFieldIds = new Set([...ownFieldIds, ...removedPartnerFieldIds])
    const calcFields = await tx
      .select({
        id: schema.CustomField.id,
        entityDefinitionId: schema.CustomField.entityDefinitionId,
        options: schema.CustomField.options,
      })
      .from(schema.CustomField)
      .where(
        and(
          eq(schema.CustomField.organizationId, organizationId),
          // biome-ignore lint/suspicious/noExplicitAny: enum literal cast (mirrors deleteCustomField)
          eq(schema.CustomField.type, 'CALC' as any)
        )
      )
    const calcUpdates = selectCalcFieldsToDisable({ calcFields, deletedFieldIds, deletedDefId: id })
    for (const update of calcUpdates) {
      await tx
        .update(schema.CustomField)
        .set({ options: update.options, updatedAt: new Date() })
        .where(eq(schema.CustomField.id, update.id))
    }

    // 5. Orphan-config cleanup (plan §5.3): these reference the def by plain text
    //    (no FK), so nothing cascades them. We clean the two with real user impact
    //    — ACL grants (security hygiene) and import templates — and leave inert
    //    refs (workflow/agent triggers) to no-op.
    await tx
      .delete(schema.ResourceAccess)
      .where(
        and(
          eq(schema.ResourceAccess.entityDefinitionId, id),
          eq(schema.ResourceAccess.organizationId, organizationId)
        )
      )
    await tx
      .delete(schema.ImportMapping)
      .where(
        and(
          eq(schema.ImportMapping.entityDefinitionId, id),
          eq(schema.ImportMapping.organizationId, organizationId)
        )
      )

    // 5b. Every instance's timeline. `TimelineEvent.entityId` is a bare `text()`
    //    column with no FK, so the instance cascade in step 6 does not reach it —
    //    deleting one definition used to strand the whole history of every record
    //    it held. One such teardown left 95,085 rows behind in dev, 41% of the table.
    //    Must run BEFORE step 6, while the instance ids are still readable.
    //
    //    ⚠️ Matched on `entityId` ALONE, never on `entityType`: that column carries
    //    two keyspaces for the same record (`EntityDefinition.id` from
    //    `createTimelineEvent`, the type slug from money's own writers), so the def
    //    id matches only some of a record's rows. Same rule as
    //    `entity-instances/delete-entity-instance.ts`.
    await tx.delete(schema.TimelineEvent).where(
      and(
        eq(schema.TimelineEvent.organizationId, organizationId),
        inArray(
          schema.TimelineEvent.entityId,
          tx
            .select({ id: schema.EntityInstance.id })
            .from(schema.EntityInstance)
            .where(
              and(
                eq(schema.EntityInstance.entityDefinitionId, id),
                eq(schema.EntityInstance.organizationId, organizationId)
              )
            )
        )
      )
    )

    // 6. Delete the entity definition. Cascades its own fields, values,
    //    instances, thread links, connector items, AND the mappings targeting it
    //    (which cascade their descendant mappings via parentMappingId).
    await tx
      .delete(schema.EntityDefinition)
      .where(
        and(
          eq(schema.EntityDefinition.id, id),
          eq(schema.EntityDefinition.organizationId, organizationId)
        )
      )

    // 7. Connector integrity sweep — see plan §3.3 / §4 step 8.
    let streamsTornDown = 0
    let connectorsPaused = 0
    if (affectedStreamIds.length > 0) {
      const survivingRoots = await tx
        .selectDistinct({ streamId: schema.DataConnectorMapping.dataConnectorStreamId })
        .from(schema.DataConnectorMapping)
        .where(
          and(
            inArray(schema.DataConnectorMapping.dataConnectorStreamId, affectedStreamIds),
            isNull(schema.DataConnectorMapping.parentMappingId)
          )
        )
      const rootlessStreamIds = selectStreamsWithoutRoot({
        affectedStreamIds,
        streamIdsWithRoot: new Set(survivingRoots.map((r) => r.streamId)),
      })
      if (rootlessStreamIds.length > 0) {
        await tx
          .delete(schema.DataConnectorStream)
          .where(inArray(schema.DataConnectorStream.id, rootlessStreamIds))
        streamsTornDown = rootlessStreamIds.length
      }
    }
    if (affectedConnectorIds.length > 0) {
      const remaining = await tx
        .selectDistinct({ connectorId: schema.DataConnectorStream.dataConnectorId })
        .from(schema.DataConnectorStream)
        .where(inArray(schema.DataConnectorStream.dataConnectorId, affectedConnectorIds))
      const stillHasStreams = new Set(remaining.map((r) => r.connectorId))
      const emptyConnectorIds = affectedConnectorIds.filter((cId) => !stillHasStreams.has(cId))
      if (emptyConnectorIds.length > 0) {
        await tx
          .update(schema.DataConnector)
          .set({ status: 'paused' })
          .where(inArray(schema.DataConnector.id, emptyConnectorIds))
        connectorsPaused = emptyConnectorIds.length
      }
    }

    return {
      removedPartnerFieldIds,
      disabledCalcFieldIds: calcUpdates.map((u) => u.id),
      streamsTornDown,
      connectorsPaused,
    }
  })

  // 7. Clear stale denormalized display columns left by removed partner fields.
  for (const { entityDefinitionId, column } of displayCleanup) {
    await clearDisplayValues({ entityDefinitionId, organizationId, column })
  }

  return summary
}

/**
 * Find EntityDefinitions that point at any of `fieldIds` as a display field.
 * Must run BEFORE the fields are deleted (the FK onDelete:'set null' clears the
 * pointer during the delete, so we'd otherwise miss them).
 */
async function collectDisplayCleanup(
  tx: Database | Transaction,
  fieldIds: string[],
  organizationId: string
): Promise<Array<{ entityDefinitionId: string; column: DisplayColumn }>> {
  const defs = await tx
    .select({
      id: schema.EntityDefinition.id,
      primaryDisplayFieldId: schema.EntityDefinition.primaryDisplayFieldId,
      secondaryDisplayFieldId: schema.EntityDefinition.secondaryDisplayFieldId,
      avatarFieldId: schema.EntityDefinition.avatarFieldId,
    })
    .from(schema.EntityDefinition)
    .where(eq(schema.EntityDefinition.organizationId, organizationId))

  const idSet = new Set(fieldIds)
  const affected: Array<{ entityDefinitionId: string; column: DisplayColumn }> = []
  for (const def of defs) {
    if (def.primaryDisplayFieldId && idSet.has(def.primaryDisplayFieldId)) {
      affected.push({ entityDefinitionId: def.id, column: 'displayName' })
    }
    if (def.secondaryDisplayFieldId && idSet.has(def.secondaryDisplayFieldId)) {
      affected.push({ entityDefinitionId: def.id, column: 'secondaryDisplayValue' })
    }
    if (def.avatarFieldId && idSet.has(def.avatarFieldId)) {
      affected.push({ entityDefinitionId: def.id, column: 'avatarUrl' })
    }
  }
  return affected
}
