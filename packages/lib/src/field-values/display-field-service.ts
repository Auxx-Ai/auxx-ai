// packages/lib/src/field-values/display-field-service.ts

import { type Database, database, schema } from '@auxx/database'
import type { TypedFieldValue } from '@auxx/types'
import { toResourceFieldId } from '@auxx/types/field'
import { type FileRef, getFileRefDownloadUrl } from '@auxx/types/file-ref'
import type { RecordId } from '@auxx/types/resource'
import { and, eq } from 'drizzle-orm'
import { getCachedResource } from '../cache'
import { batchUpdateDisplayValues, clearDisplayValues } from '../entity-instances'
import type { ResourceField } from '../resources/registry/field-types'
import type { CustomResource } from '../resources/registry/types'
import { getInstanceId, toRecordIds } from '../resources/resource-id'
import {
  DISPLAY_FIELD_CONFIG,
  type DisplayFieldType,
  type RecalculateDisplayFieldResult,
} from './display-field-types'
import { batchGetRelatedDisplayNames } from './field-value-helpers'
import { FieldValueService } from './field-value-service'
import { formatToDisplayValue } from './formatter'
import { getOrgCurrencyCode, withOrgCurrency } from './org-currency'
import { primaryValue } from './primary-value'
import { updateSearchTextForEntityDefinition } from './search-text'

const BATCH_SIZE = 100

/**
 * Service for managing display field propagation.
 * Handles recalculating denormalized display values on EntityInstance
 * when EntityDefinition display field pointers change.
 */
export class DisplayFieldService {
  private db: Database
  private fieldValueService: FieldValueService

  constructor(
    private readonly organizationId: string,
    db: Database = database
  ) {
    this.db = db
    this.fieldValueService = new FieldValueService(organizationId, undefined, db)
  }

  /**
   * Recalculate a display field for all instances of an entity definition.
   * Modular design: works for primary, secondary, or avatar fields.
   */
  async recalculateDisplayField(
    entityDefinitionId: string,
    displayFieldType: DisplayFieldType
  ): Promise<RecalculateDisplayFieldResult> {
    const config = DISPLAY_FIELD_CONFIG[displayFieldType]

    // 1. Get full resource with fields from org cache
    const resource = await getCachedResource(this.organizationId, entityDefinitionId)

    if (!resource || resource.type !== 'custom') {
      throw new Error(`Entity definition not found: ${entityDefinitionId}`)
    }

    // 2. Get the display field ID and full field definition
    const displayFieldId = this.getDisplayFieldId(resource, displayFieldType)
    const field = displayFieldId ? resource.fields.find((f) => f.id === displayFieldId) : null

    // 3. If no field configured, clear all values
    if (!displayFieldId || !field) {
      await clearDisplayValues({
        entityDefinitionId,
        organizationId: this.organizationId,
        column: config.instanceColumn,
      })

      // Update searchText when primary or secondary is cleared
      if (displayFieldType === 'primary' || displayFieldType === 'secondary') {
        await this.updateSearchTextForEntityDefinition(entityDefinitionId)
      }

      const count = await this.db
        .select({ id: schema.EntityInstance.id })
        .from(schema.EntityInstance)
        .where(
          and(
            eq(schema.EntityInstance.entityDefinitionId, entityDefinitionId),
            eq(schema.EntityInstance.organizationId, this.organizationId)
          )
        )

      return { displayFieldType, processed: count.length, updated: count.length }
    }

    let processed = 0
    let updated = 0
    let cursor: string | undefined

    // 4. Process instances in batches
    while (true) {
      const instances = await this.db.query.EntityInstance.findMany({
        where: (ei, { eq: eqOp, and: andOp, gt: gtOp }) => {
          const conditions = [
            eqOp(ei.entityDefinitionId, entityDefinitionId),
            eqOp(ei.organizationId, this.organizationId),
          ]
          if (cursor) conditions.push(gtOp(ei.id, cursor))
          return andOp(...conditions)
        },
        columns: { id: true },
        orderBy: (ei, { asc }) => asc(ei.id),
        limit: BATCH_SIZE,
      })

      if (instances.length === 0) break

      const instanceIds = instances.map((i) => i.id)
      cursor = instanceIds[instanceIds.length - 1]

      // 5. Use FieldValueService.batchGetValues() - no more raw rows!
      const batchResult = await this.fieldValueService.batchGetValues({
        recordIds: toRecordIds(entityDefinitionId, instanceIds),
        fieldReferences: [toResourceFieldId(entityDefinitionId, displayFieldId)],
      })

      // Group by entityId for easy lookup
      // Extract instanceId from RecordId for local Map lookup
      const valuesByEntity = new Map<string, TypedFieldValue | TypedFieldValue[]>()
      for (const result of batchResult.values) {
        if (result.value) {
          valuesByEntity.set(getInstanceId(result.recordId), result.value)
        }
      }

      // 6. Compute display values using properly typed field
      const updates = new Map<string, string | null>()

      // A Set, not an array: one image used as the avatar on many instances is
      // ONE thumbnail. `resolveAvatarThumbnails` fans out per entry, and each entry
      // costs two queries inside `ensureThumbnail`, so duplicates were paying that
      // repeatedly to reach the same already-generated file.
      const assetIdsToThumbnail = new Set<string>()

      // For RELATIONSHIP fields, batch-resolve related displayNames
      if (field.fieldType === 'RELATIONSHIP') {
        const recordIdsByInstance = new Map<string, RecordId>()
        for (const instanceId of instanceIds) {
          const typedValue = valuesByEntity.get(instanceId) ?? null
          const single = Array.isArray(typedValue) ? typedValue?.[0] : typedValue
          if (single?.type === 'relationship' && 'recordId' in single) {
            const rid = (single as { recordId: RecordId }).recordId
            if (rid) recordIdsByInstance.set(instanceId, rid)
          }
        }

        const allRecordIds = [...recordIdsByInstance.values()]
        const displayNames = await batchGetRelatedDisplayNames(
          this.db,
          this.organizationId,
          allRecordIds
        )

        for (const instanceId of instanceIds) {
          const rid = recordIdsByInstance.get(instanceId)
          if (rid) {
            const relInstanceId = getInstanceId(rid)
            updates.set(instanceId, displayNames.get(relInstanceId) ?? null)
          } else {
            updates.set(instanceId, null)
          }
        }
      } else {
        // The org rung for CURRENCY — resolved ONCE for the batch, never per
        // value inside the loop. A no-op for every other field type.
        const orgCurrencyCode =
          field.fieldType === 'CURRENCY'
            ? await getOrgCurrencyCode(this.organizationId, this.db)
            : undefined

        for (const instanceId of instanceIds) {
          const typedValue = valuesByEntity.get(instanceId) ?? null
          const displayValue = this.computeDisplayValue(
            typedValue,
            field,
            displayFieldType,
            orgCurrencyCode
          )
          updates.set(instanceId, displayValue)

          // Collect asset IDs that need avatar thumbnails during batch recalc.
          // Keyed on the value being a FILE ref, NOT on `displayValue === null`:
          // that sentinel disappeared when the interim became a real download URL,
          // and keying on it would silently stop queueing every thumbnail.
          if (displayFieldType === 'avatar' && typedValue) {
            const single = Array.isArray(typedValue) ? typedValue[0] : typedValue
            if (single?.type === 'json') {
              const json = single.value as Record<string, unknown>
              // `!json.url` keeps the set identical to what the old
              // `displayValue === null` test collected: a value carrying an explicit
              // url already has its avatar and needs no thumbnail.
              if (typeof json?.ref === 'string' && typeof json?.url !== 'string') {
                const assetId = (json.ref as string).match(/^asset:(.+)$/)?.[1]
                if (assetId) assetIdsToThumbnail.add(assetId)
              }
            }
          }
        }
      }

      // 7. Batch update
      const result = await batchUpdateDisplayValues({
        organizationId: this.organizationId,
        updates,
        column: config.instanceColumn,
      })

      if (result.isOk()) updated += result.value.updated
      processed += instanceIds.length

      // 8. Resolve avatar thumbnails for FILE refs (fire-and-forget) — AFTER the
      // batch write. The resolve pass upgrades `avatarUrl` to the CDN URL when the
      // thumbnail already exists, so firing it before `batchUpdateDisplayValues`
      // let the interim download URL overwrite the CDN URL it had just adopted.
      if (assetIdsToThumbnail.size > 0) {
        void this.resolveAvatarThumbnails([...assetIdsToThumbnail])
      }

      if (instances.length < BATCH_SIZE) break
    }

    // Update searchText for all instances when primary or secondary display field changes
    if (displayFieldType === 'primary' || displayFieldType === 'secondary') {
      await this.updateSearchTextForEntityDefinition(entityDefinitionId)
    }

    return { displayFieldType, processed, updated }
  }

  /**
   * Update searchText for all instances of an entity definition.
   * Called after batch recalculating primary or secondary display fields.
   *
   * Delegates to `search-text.ts` so the corpus has exactly one definition —
   * this used to carry its own copy of the display-fields-only expression,
   * which is how the two drifted apart in the first place.
   */
  private async updateSearchTextForEntityDefinition(entityDefinitionId: string): Promise<void> {
    await updateSearchTextForEntityDefinition(this.db, this.organizationId, entityDefinitionId)
  }

  /**
   * Recalculate multiple display fields at once.
   */
  async recalculateDisplayFields(
    entityDefinitionId: string,
    displayFieldTypes: DisplayFieldType[]
  ): Promise<RecalculateDisplayFieldResult[]> {
    const results: RecalculateDisplayFieldResult[] = []
    for (const displayFieldType of displayFieldTypes) {
      results.push(await this.recalculateDisplayField(entityDefinitionId, displayFieldType))
    }
    return results
  }

  /**
   * Get the field ID for a display field type from CustomResource.
   */
  private getDisplayFieldId(
    resource: CustomResource,
    displayFieldType: DisplayFieldType
  ): string | null {
    switch (displayFieldType) {
      case 'primary':
        return resource.display.primaryDisplayField?.id ?? null
      case 'secondary':
        return resource.display.secondaryDisplayField?.id ?? null
      case 'avatar':
        return resource.display.avatarField?.id ?? null
    }
  }

  /**
   * Compute display value from already-typed field values.
   * No more raw rows - FieldValueService handles the conversion.
   */
  private computeDisplayValue(
    typedValue: TypedFieldValue | TypedFieldValue[] | null,
    field: ResourceField,
    displayFieldType: DisplayFieldType,
    orgCurrencyCode?: string
  ): string | null {
    if (!typedValue) return null

    // For avatar fields, extract the URL directly, or resolve a FILE ref to the
    // app's own download URL. That URL always resolves, so it — not `null` — is the
    // right interim while the CDN thumbnail is generated (and the right permanent
    // answer if it never is). Returning `null` here blanked the avatar back to the
    // record's fallback icon for the whole window, which on the `ready` short-circuit
    // was forever. The recalc loop still queues the thumbnail as an upgrade.
    if (displayFieldType === 'avatar') {
      const single = Array.isArray(typedValue) ? typedValue[0] : typedValue
      if (!single) return null

      if (single.type === 'text') {
        return single.value || null
      }
      if (single.type === 'json') {
        const json = single.value as Record<string, unknown>
        if (typeof json?.url === 'string') return json.url
        // FILE field: { ref: "asset:abc123" }
        if (typeof json?.ref === 'string' && /^asset:.+/.test(json.ref as string)) {
          return getFileRefDownloadUrl(json.ref as FileRef)
        }
      }
      return null
    }

    // Use fieldType from ResourceField (properly typed FieldType enum)
    const fieldType = field.fieldType ?? 'TEXT'

    // Multi-value fields (`options.multi`) read back as arrays ordered by
    // sortKey — the subtitle shows the primary (first) value, never a joined
    // array. Without the unwrap the string guard below nulls every array and
    // a batch recalc wipes subtitles for multi-value display fields.
    const single = primaryValue(typedValue)
    if (!single) return null

    // Use centralized formatter with properly typed options. `withOrgCurrency`
    // layers the org rung under a CURRENCY field that never picked a code, so a
    // persisted display value follows `organization.currency`.
    const displayValue = formatToDisplayValue(
      single,
      fieldType,
      withOrgCurrency(field.options as never, fieldType, orgCurrencyCode)
    )

    return typeof displayValue === 'string' ? displayValue : null
  }

  /**
   * Ensure avatar thumbnails for a batch of asset IDs, adopting any that already
   * exist as the referencing instances' `avatarUrl`.
   *
   * Queueing alone is not enough: `ensureThumbnail` answers `ready` WITHOUT
   * queuing a job whenever the `avatar-128` preset already exists, and the job is
   * the only other writer of `avatarUrl` — so a recalc that merely queued
   * permanently downgraded every already-resolved CDN avatar to the interim
   * download URL the batch write had just persisted. `ready`/`generated` answers
   * have a URL in hand, so this pass writes it (and tells listening clients),
   * exactly like the single-save path in `field-value-helpers`.
   */
  private async resolveAvatarThumbnails(assetIds: string[]): Promise<void> {
    try {
      const { ensureThumbnailPresets } = await import('../files/thumbnails')
      const { createProductionQueuePort } = await import('../files/storage/queue-port')
      const { applyAvatarThumbnailUrl, publishAvatarResolved } = await import('./avatar-thumbnail')

      const ctx = { db: this.db, organizationId: this.organizationId }
      const deps = { queue: createProductionQueuePort(), now: () => new Date() }

      for (const assetId of assetIds) {
        const ensured = await ensureThumbnailPresets(ctx, deps, {
          source: { type: 'asset', assetId },
          createdById: 'system',
          presets: ['avatar-128'],
          defaultOptions: { visibility: 'PUBLIC' },
        })
        if (ensured.isErr()) throw ensured.error

        const [result] = ensured.value

        // Queued: the job owns the write once it has generated the file.
        if (!result || result.status === 'queued' || !result.storageLocationId) continue

        const [location] = await this.db
          .select({ externalUrl: schema.StorageLocation.externalUrl })
          .from(schema.StorageLocation)
          .where(eq(schema.StorageLocation.id, result.storageLocationId))
          .limit(1)
        const cdnUrl = location?.externalUrl
        if (!cdnUrl) continue

        const resolved = await applyAvatarThumbnailUrl(
          this.db,
          this.organizationId,
          assetId,
          cdnUrl
        )
        if (resolved) {
          await publishAvatarResolved({
            organizationId: this.organizationId,
            cdnUrl: resolved.cdnUrl,
            instances: resolved.instances,
          })
        }
      }
    } catch (error) {
      console.warn('[avatar] Failed to resolve batch avatar thumbnails', {
        count: assetIds.length,
        error,
      })
    }
  }
}
