// packages/lib/src/field-values/avatar-thumbnail.ts

import { type database, schema } from '@auxx/database'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { createScopedLogger } from '../logger'
import { toRecordId } from '../resources/resource-id'

const logger = createScopedLogger('avatar-thumbnail')

/** Minimal db surface these helpers need — `database` or an open transaction. */
type Db = typeof database

/**
 * Affected instances plus the resolved CDN URL, carried out of any surrounding
 * transaction so the realtime publish happens post-commit.
 */
export interface AvatarResolution {
  cdnUrl: string
  instances: Array<{ entityInstanceId: string; entityDefinitionId: string }>
}

/**
 * Point every EntityInstance that uses `assetId` as its avatar at `cdnUrl`.
 *
 * Extracted from `generate-thumbnail-job` because the job was the ONLY writer of
 * `EntityInstance.avatarUrl`, and it only ever runs when a thumbnail was actually
 * queued. `ThumbnailService.ensureThumbnail` short-circuits with `status: 'ready'`
 * whenever the asset version already has that preset — no job, therefore no write,
 * therefore an avatar that stayed on its fallback icon forever. That happened on
 * every re-pick of an already-thumbnailed asset: browsing to an existing file,
 * clearing and re-setting the same image, or putting one image on a second record.
 * The save path now calls this directly for the `ready`/`generated` answers.
 *
 * Returns `null` when nothing references the asset — which is also the shape the
 * job's own lookup produces if it wins the race against the FieldValue write, so
 * callers must not treat `null` as an error.
 */
export async function applyAvatarThumbnailUrl(
  db: Db,
  organizationId: string,
  assetId: string,
  cdnUrl: string
): Promise<AvatarResolution | null> {
  // The ref string FILE field values store.
  const refValue = `asset:${assetId}`

  // Join path: FieldValue → CustomField → EntityDefinition (avatarFieldId) → instance.
  const instances = await db
    .select({
      entityInstanceId: schema.FieldValue.entityId,
      entityDefinitionId: schema.EntityDefinition.id,
    })
    .from(schema.FieldValue)
    .innerJoin(schema.CustomField, eq(schema.FieldValue.fieldId, schema.CustomField.id))
    .innerJoin(
      schema.EntityDefinition,
      and(
        eq(schema.CustomField.entityDefinitionId, schema.EntityDefinition.id),
        eq(schema.EntityDefinition.avatarFieldId, schema.CustomField.id)
      )
    )
    .where(
      and(
        eq(schema.FieldValue.organizationId, organizationId),
        sql`${schema.FieldValue.valueJson}->'v'->>'ref' = ${refValue}`
      )
    )

  if (instances.length === 0) return null

  const instanceIds = instances.map((i: { entityInstanceId: string }) => i.entityInstanceId)
  // No `updatedAt` stamp (D-7): this background job upgrades an interim
  // download URL to the CDN thumbnail — a derived artifact of a field write
  // that already stamped the record. Not a content change.
  await db
    .update(schema.EntityInstance)
    .set({ avatarUrl: cdnUrl })
    .where(
      and(
        eq(schema.EntityInstance.organizationId, organizationId),
        inArray(schema.EntityInstance.id, instanceIds)
      )
    )

  logger.info('Updated entity avatar URLs from thumbnail', {
    assetId,
    instanceCount: instanceIds.length,
  })

  return { cdnUrl, instances }
}

/**
 * Publish `record:updated` for each instance whose avatar was resolved.
 *
 * Always call this AFTER the transaction commits — publishing inside it risks
 * announcing state that then rolls back.
 */
export async function publishAvatarResolved(params: {
  organizationId: string
  cdnUrl: string
  instances: Array<{ entityInstanceId: string; entityDefinitionId: string }>
}): Promise<void> {
  const { organizationId, cdnUrl, instances } = params
  try {
    // Lazy — the realtime barrel forms an import cycle that breaks `vi.mock` in
    // any test that pulls this module in transitively.
    const { getRealtimeService, rooms } = await import('../realtime')
    const realtime = getRealtimeService()
    const updatedAt = new Date().toISOString()
    await Promise.all(
      instances.map(({ entityInstanceId, entityDefinitionId }) =>
        realtime
          .publish(
            rooms.orgRecords(organizationId, entityDefinitionId),
            'record:updated',
            {
              entityDefinitionId,
              record: {
                id: entityInstanceId,
                recordId: toRecordId(entityDefinitionId, entityInstanceId),
                avatarUrl: cdnUrl,
                updatedAt,
              },
            },
            {}
          )
          .catch(() => {})
      )
    )
  } catch (error) {
    // Never fail the caller over a missed notification — the value is committed,
    // and the next read picks it up.
    logger.warn('Failed to publish resolved avatar', {
      instanceCount: instances.length,
      error: error instanceof Error ? error.message : 'Unknown error',
    })
  }
}
