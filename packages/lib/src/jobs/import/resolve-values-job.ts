// packages/lib/src/jobs/import/resolve-values-job.ts

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { getPublishingClient } from '@auxx/redis'
import { and, eq } from 'drizzle-orm'
import {
  createEventPublisher,
  getColumnValues,
  isPendingRelationLookup,
  processColumnValues,
  resolveColumnCurrencyCodes,
  resolveColumnOptions,
} from '../../import'
import type { ResolutionConfig, ResolutionType } from '../../import/types'
import type { JobContext } from '../types'

const logger = createScopedLogger('resolve-values-job')

/** Job payload for resolving import values */
export interface ResolveValuesJobProps {
  jobId: string
  organizationId: string
}

/**
 * Job handler for resolving import values.
 * Processes each mapped column and runs type-specific resolvers.
 */
export async function resolveValuesJob(ctx: JobContext<ResolveValuesJobProps>): Promise<void> {
  const job = ctx.job
  const { jobId, organizationId } = job.data

  logger.info('Starting value resolution', { jobId })

  const redis = await getPublishingClient()
  if (!redis) {
    throw new Error('Redis publishing client not available')
  }
  const publishEvent = createEventPublisher(redis, jobId)

  try {
    // Fetch job with mapping properties
    const importJob = await db.query.ImportJob.findFirst({
      where: and(
        eq(schema.ImportJob.id, jobId),
        eq(schema.ImportJob.organizationId, organizationId)
      ),
      with: {
        importMapping: {
          with: {
            properties: true,
          },
        },
      },
    })

    if (!importJob) {
      throw new Error(`Import job not found: ${jobId}`)
    }

    // Filter to mapped columns only (not skipped)
    const mappedProperties = importJob.importMapping.properties.filter(
      (p) => p.targetType !== 'skip' && p.targetFieldKey
    )

    // The minor-unit exponent a `currency:*` column scales by comes from the
    // TARGET FIELD's denomination (field → org → USD), so it is resolved here,
    // once for the whole mapping, and handed to each column's config. It is
    // deliberately not read from the stored `resolutionConfig`: an inheriting
    // field follows `organization.currency`, and a copy frozen at mapping time
    // would keep scaling by the old exponent. See `resolve-currency-code.ts`.
    const currencyColumnKeys = mappedProperties
      .filter((p) => p.resolutionType?.startsWith('currency:') && p.targetFieldKey)
      .map((p) => p.targetFieldKey as string)
    const currencyCodes = await resolveColumnCurrencyCodes(db, {
      organizationId,
      entityDefinitionId: importJob.importMapping.entityDefinitionId,
      targetFieldKeys: currencyColumnKeys,
    })

    // A select column's option list is the same KIND of value as the currency
    // code above — a fact about the target field, not a decision the user made
    // about the column — so it is resolved the same way, and for a sharper
    // reason: the stored copy is client-asserted. `saveMappingProperty` writes
    // whatever array the browser sent when the field was picked, the server
    // never checks it against the field, and nothing refreshes it afterwards.
    // A category added since mapping would otherwise read as unmatched on every
    // row. See `resolve-column-options.ts`.
    const optionColumnKeys = mappedProperties
      .filter(
        (p) =>
          (p.resolutionType?.startsWith('select:') ||
            p.resolutionType?.startsWith('multiselect:')) &&
          p.targetFieldKey
      )
      .map((p) => p.targetFieldKey as string)
    const liveOptions = await resolveColumnOptions({
      organizationId,
      entityDefinitionId: importJob.importMapping.entityDefinitionId,
      targetFieldKeys: optionColumnKeys,
    })

    const totalColumns = mappedProperties.length
    let columnsProcessed = 0

    logger.info('Processing mapped columns', { jobId, totalColumns })

    // Process each column
    for (const mappingProp of mappedProperties) {
      // Get or create ImportJobProperty
      let jobProp = await db.query.ImportJobProperty.findFirst({
        where: and(
          eq(schema.ImportJobProperty.importJobId, jobId),
          eq(schema.ImportJobProperty.importMappingPropertyId, mappingProp.id)
        ),
      })

      if (!jobProp) {
        const [newJobProp] = await db
          .insert(schema.ImportJobProperty)
          .values({
            importJobId: jobId,
            importMappingPropertyId: mappingProp.id,
            uniqueValueCount: 0,
            resolvedCount: 0,
            errorCount: 0,
            updatedAt: new Date(),
          })
          .returning()
        jobProp = newJobProp!
      }

      // Fetch column values
      const values = await getColumnValues(db, jobId, mappingProp.sourceColumnIndex)

      // Skip empty columns
      if (values.length === 0) {
        columnsProcessed++
        continue
      }

      // Parse resolution config.
      //
      // A parse failure used to degrade to `{}` behind a warn. For a select
      // column that silently means "this field has no options", so every row
      // errors with `No matching option` and nothing anywhere says why. The
      // column's whole configuration is unreadable; fail the job rather than
      // import it under a config nobody wrote.
      let resolutionConfig: ResolutionConfig = {}
      if (mappingProp.resolutionConfig) {
        try {
          resolutionConfig = JSON.parse(mappingProp.resolutionConfig)
        } catch {
          throw new Error(
            `Column "${mappingProp.sourceColumnName ?? mappingProp.sourceColumnIndex}" has an ` +
              'unreadable configuration. Re-map the column and try again.'
          )
        }
      }

      const currencyCode = mappingProp.targetFieldKey
        ? currencyCodes.get(mappingProp.targetFieldKey)
        : undefined
      if (currencyCode) {
        resolutionConfig = { ...resolutionConfig, currencyCode }
      }

      // The live list WINS over the stored one. Falling back to the stored copy
      // when a field carries no options is deliberate: it keeps a mapping made
      // against a since-deleted field resolving as it did, instead of erroring
      // every row.
      const fieldOptions = mappingProp.targetFieldKey
        ? liveOptions.get(mappingProp.targetFieldKey)
        : undefined
      if (fieldOptions) {
        resolutionConfig = { ...resolutionConfig, options: fieldOptions }
      }

      // Process values
      const resolutions = await processColumnValues({
        db,
        jobPropertyId: jobProp.id,
        values,
        resolutionType: mappingProp.resolutionType as ResolutionType,
        config: resolutionConfig,
        onProgress: async (processed, total) => {
          // Throttled progress updates
          if (processed % 100 === 0 || processed === total) {
            await job.updateProgress(
              Math.round(((columnsProcessed + processed / total) / totalColumns) * 100)
            )
          }
        },
      })

      // Count results
      let validCount = 0
      let errorCount = 0
      const pendingLookups: Array<{ hash: string; value: unknown }> = []

      for (const [hash, resolution] of resolutions) {
        if (resolution.isValid) {
          // Check if this is a pending relation lookup
          const resolvedValue = resolution.resolvedValues[0]?.value
          if (isPendingRelationLookup(resolvedValue)) {
            pendingLookups.push({ hash, value: resolvedValue })
          } else {
            validCount++
          }
        } else {
          errorCount++
        }
      }

      // Count pending lookups as valid for now (will be resolved during planning)
      validCount += pendingLookups.length

      // Update ImportJobProperty
      await db
        .update(schema.ImportJobProperty)
        .set({
          uniqueValueCount: resolutions.size,
          resolvedCount: validCount,
          errorCount,
          updatedAt: new Date(),
        })
        .where(eq(schema.ImportJobProperty.id, jobProp.id))

      columnsProcessed++

      // Publish progress
      await publishEvent({
        type: 'resolution:progress',
        columnIndex: mappingProp.sourceColumnIndex,
        columnName: mappingProp.sourceColumnName ?? `Column ${mappingProp.sourceColumnIndex}`,
        resolved: validCount,
        total: resolutions.size,
        errorsFound: errorCount,
      })

      logger.debug('Column processed', {
        jobId,
        columnIndex: mappingProp.sourceColumnIndex,
        uniqueValues: resolutions.size,
        validCount,
        errorCount,
        pendingLookups: pendingLookups.length,
      })
    }

    // Mark job as ready for plan generation
    // Note: Relation lookups will be resolved during plan generation phase
    await db
      .update(schema.ImportJob)
      .set({
        allowPlanGeneration: true,
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportJob.id, jobId))

    await publishEvent({ type: 'job:status', status: 'waiting' })

    logger.info('Value resolution complete', {
      jobId,
      columnsProcessed,
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'
    logger.error('Value resolution failed', { jobId, error: errorMessage })

    await publishEvent({ type: 'error', message: errorMessage })
    throw error
  }
}
