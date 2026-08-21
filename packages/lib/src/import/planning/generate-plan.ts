// packages/lib/src/import/planning/generate-plan.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { eq } from 'drizzle-orm'
import { findCachedResource } from '../../cache'
import { UnprocessableEntityError } from '../../errors'
import type { ResourceField } from '../../resources'
import { getDefaultIdentifierField, getIdentifierFields } from '../../resources/registry'
import { getFieldOutputKey } from '../../resources/registry/field-types'
import type { ImportMappingProperty, ImportStrategyMode } from '../types/mapping'
import type { ImportPlan, ImportPlanStrategy, PlanEstimates, StrategyType } from '../types/plan'
import type { ValueResolution } from '../types/resolution'
import { type AnalyzeRowContext, analyzeRow } from './analyze-row'
import { type AssignRowInput, batchAssignRows } from './assign-row-to-strategy'
import { createBatchedFindExistingRecord } from './batch-identifier-lookup'
import { calculateEstimatesFromCounts } from './calculate-estimates'
import { createPlan } from './create-plan'
import { createDefaultStrategies } from './create-strategy'
import { createFindExistingRecord } from './find-existing-record'

const logger = createScopedLogger('generate-plan')

/** Row analysis result for real-time preview streaming */
export interface AnalyzedRow {
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  fields: Record<string, unknown>
  errors: string[]
  /** Non-fatal issues — the row still imports */
  warnings: string[]
}

/** Options for generating a plan */
export interface GeneratePlanOptions {
  db: Database
  organizationId: string
  jobId: string
  entityDefinitionId: string
  rawData: Map<number, Record<number, string>>
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  /**
   * Ordered match key from `ImportMapping.identifierFieldKeys`. Empty/absent
   * falls back to the resource's default identifier (unless the mode is
   * `create`). More than one key is a COMPOSITE key, ANDed.
   */
  identifierFieldKeys?: string[]
  /** Job-level strategy mode. Defaults to `create-or-update`. */
  mode?: ImportStrategyMode
  /** Called for each analyzed row (for real-time SSE streaming) */
  onRowAnalyzed?: (row: AnalyzedRow) => Promise<void> | void
  /** Progress callback: (phase, processed, total) */
  onProgress?: (
    phase: 'analyzing' | 'assigning',
    processed: number,
    total: number
  ) => Promise<void> | void
}

/** Result of plan generation */
export interface GeneratePlanResult {
  plan: ImportPlan
  strategies: ImportPlanStrategy[]
  estimates: PlanEstimates
}

/** Batch size for inserting plan rows */
const BATCH_SIZE = 100

/**
 * Generate an import plan by analyzing all rows.
 *
 * @param options - Plan generation options
 * @returns Generated plan with strategies and estimates
 */
export async function generatePlan(options: GeneratePlanOptions): Promise<GeneratePlanResult> {
  const {
    db,
    organizationId,
    jobId,
    entityDefinitionId,
    rawData,
    mappings,
    resolutions,
    identifierFieldKeys,
    mode = 'create-or-update',
    onRowAnalyzed,
    onProgress,
  } = options

  // Create plan record
  const plan = await createPlan(db, jobId)

  // Get resource definition and identifier field from org cache.
  //
  // `findCachedResource`, never `getCachedResource`. `ImportMapping.entityDefinitionId`
  // holds EITHER keyspace: for a def-backed system type it is the bare entityType slug
  // (`part`), for a pure custom entity the EntityDefinition CUID. `getCachedResource`
  // matches on `Resource.id` alone — always the CUID — so a `part` import found NO
  // resource, resolved NO identifier fields, and every single row was classified
  // `create` behind a wizard reporting "Create or update". A full duplicate set, no
  // error, no warning. The tolerant lookup is what the routers have always used.
  const resource = await findCachedResource(organizationId, entityDefinitionId)

  logger.info('Planning: Resource lookup', {
    entityDefinitionId,
    resourceFound: !!resource,
    resourceId: resource?.id,
    fieldCount: resource?.fields.length,
  })

  // ── Resolve the identifier BEFORE creating strategies ───────────────────
  // Strategies used to be created from the RAW option while `analyzeRow` was
  // handed an auto-selected fallback, so the strategy table could lack `update`
  // while the analyzer happily returned it, and the row then hit the
  // `continue` below and vanished from the plan entirely: not created, not
  // updated, not counted, no error. The two must be derived from the same
  // resolved keys, in this order. Do not move `createDefaultStrategies` back up.
  let identifierFields: ResourceField[] = []
  if (resource && mode !== 'create') {
    if (identifierFieldKeys && identifierFieldKeys.length > 0) {
      // Order matters (it is the composite key's order), map over the KEYS,
      // not over `resource.fields`.
      // `getFieldOutputKey`, never the bare `f.key`. On an entity-definition
      // field `key` is the DISPLAY NAME (`SKU`) and the stable identifier lives
      // in `systemAttribute` (`part_sku`) — which is what the mapping stores in
      // `targetFieldKey` and `identifierFieldKeys`. Matching on `f.key` resolved
      // NOTHING for every def-backed resource, so the match key came back empty
      // and every row was classified `create`. `execute-plan-job` has always
      // keyed its field lookup this way; planning was the outlier.
      identifierFields = identifierFieldKeys
        .map((key) => resource.fields.find((f) => getFieldOutputKey(f) === key))
        .filter((f): f is ResourceField => !!f)
      logger.info('Planning: Using explicit identifier fields', {
        requested: identifierFieldKeys,
        resolved: identifierFields.map(getFieldOutputKey),
      })
    } else {
      // Auto-select default identifier if not specified
      const identifiers = getIdentifierFields(resource)
      const fallback = getDefaultIdentifierField(resource)
      identifierFields = fallback ? [fallback] : []
      logger.info('Planning: Using default identifier field', {
        availableIdentifiers: identifiers.map((f) => ({ key: f.key, type: f.type })),
        selectedField: fallback?.key,
        selectedType: fallback?.type,
      })
    }
  }

  // A LONE relationship column cannot be the match key. `RELATION` is
  // eligible only as part of a composite key (`(part, supplier)`); on its own it
  // rarely identifies a record, and the identifier lookup would quietly match
  // nothing, producing a full set of duplicates behind a wizard that says
  // update is on. The wizard prevents creating this state, but unflagging the
  // last scalar key can still strand it, so the invariant is enforced here,
  // where every path passes through. Loud, and actionable.
  if (identifierFields.length === 1 && identifierFields[0]?.relationship) {
    throw new UnprocessableEntityError(
      `"${identifierFields[0].label}" is a relationship column and cannot identify a record on its own. Flag another column as part of the match key, or unflag this one.`
    )
  }

  // Output keys throughout: `analyzeRow` compares these against
  // `mapping.targetFieldKey`, and `findExistingRecord` is handed a record keyed
  // the same way. All three must agree on ONE convention.
  const resolvedIdentifierKeys = identifierFields.map(getFieldOutputKey)

  // Log the final identifier choice
  logger.info('Planning: Final identifier configuration', {
    hasResource: !!resource,
    mode,
    identifierKeys: resolvedIdentifierKeys,
    identifierDbColumns: identifierFields.map((f) => f.dbColumn),
  })

  // Create strategies from the RESOLVED keys, see the ordering note above.
  const strategies = await createDefaultStrategies(db, plan.id, resolvedIdentifierKeys, mode)

  // Build strategy lookup
  const strategyByType = new Map<StrategyType, ImportPlanStrategy>()
  for (const strategy of strategies) {
    strategyByType.set(strategy.strategy, strategy)
  }

  // Create findExistingRecord function if we have resource and identifier fields
  const findExistingRecord =
    resource && identifierFields.length > 0
      ? createFindExistingRecord({ db, organizationId, resource, identifierFields })
      : undefined

  // ── Resolve every identifier lookup BEFORE the row loop ─────────────────
  // `analyzeRow` awaits one lookup per identifier VALUE, and the loop below is
  // sequential, so a 5,000-row file used to issue 5,000 fully serialized
  // queries. Every row is already in memory here, so the distinct values can be
  // resolved in `ceil(distinct / 1000)` queries and answered from a map.
  //
  // The returned resolver has the SAME signature and the SAME result contract,
  // and falls back to `findExistingRecord` for anything it could not index
  // (composite keys, system tables, an un-indexable column, a value it never
  // saw). It can therefore only ever be faster, never different.
  const batchedLookup =
    resource && findExistingRecord
      ? await createBatchedFindExistingRecord({
          db,
          organizationId,
          resource,
          identifierFields,
          rawData,
          mappings,
          resolutions,
          fallback: findExistingRecord,
        })
      : undefined

  // Analyze context. One `seenIdentifiers` Map for the whole plan, it is what
  // makes an in-file duplicate identifier a row error on the later row.
  const analyzeCtx: AnalyzeRowContext = {
    mappings,
    resolutions,
    identifierFieldKeys: resolvedIdentifierKeys,
    mode,
    findExistingRecord: batchedLookup?.find ?? findExistingRecord,
    seenIdentifiers: new Map<string, number>(),
  }

  // Track strategy counts
  const strategyCounts: Record<StrategyType, number> = {
    create: 0,
    update: 0,
    skip: 0,
    unmatched: 0,
  }

  // Collect row assignments for batch insert
  let assignments: AssignRowInput[] = []
  let errorCount = 0
  let processed = 0
  const totalRows = rawData.size

  // Analyze each row
  for (const [rowIndex, rowData] of rawData) {
    const analysis = await analyzeRow(rowIndex, rowData, analyzeCtx)

    // Get the appropriate strategy
    const strategy = strategyByType.get(analysis.strategy)
    if (!strategy) {
      // RAISE, never `continue`. A silent skip here is what turned a planning
      // bug into data loss: the row was not created, not updated, not counted in
      // `strategyCounts`, produced no error and no `ImportPlanRow`, the plan
      // simply showed fewer rows than the file had. Reaching this means the
      // strategy table and the analyzer disagree, which is a planner bug, and
      // failing the whole plan is strictly better than losing rows from it.
      throw new UnprocessableEntityError(
        `Import plan ${plan.id}: row ${rowIndex + 1} was classified "${analysis.strategy}" but no such strategy exists on the plan (have: ${[...strategyByType.keys()].join(', ')})`
      )
    }

    // Track counts
    strategyCounts[analysis.strategy]++
    if (analysis.errors.length > 0) {
      errorCount++
    }

    // Publish row for real-time preview
    await onRowAnalyzed?.({
      rowIndex: analysis.rowIndex,
      strategy: analysis.strategy,
      existingRecordId: analysis.existingRecordId,
      fields: analysis.resolvedData,
      errors: analysis.errors,
      warnings: analysis.warnings,
    })

    // Add to batch
    assignments.push({
      strategyId: strategy.id,
      rowIndex: analysis.rowIndex,
      existingRecordId: analysis.existingRecordId,
      warningMessage: analysis.warnings.length > 0 ? analysis.warnings.join('; ') : undefined,
    })

    // Insert batch when full
    if (assignments.length >= BATCH_SIZE) {
      await batchAssignRows(db, assignments)
      assignments = []
    }

    processed++
    await onProgress?.('analyzing', processed, totalRows)
  }

  // Insert remaining assignments
  if (assignments.length > 0) {
    await batchAssignRows(db, assignments)
  }

  // Update strategy statistics
  for (const strategy of strategies) {
    const count = strategyCounts[strategy.strategy]
    await db
      .update(schema.ImportPlanStrategy)
      .set({
        status: 'planned',
        statistics: { planned: count, executed: 0, failed: 0 },
        planningCompletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.ImportPlanStrategy.id, strategy.id))
  }

  // Mark plan as planned
  await db
    .update(schema.ImportPlan)
    .set({
      status: 'planned',
      updatedAt: new Date(),
    })
    .where(eq(schema.ImportPlan.id, plan.id))

  // Calculate estimates
  const estimates = calculateEstimatesFromCounts(strategyCounts, errorCount)

  return {
    plan: { ...plan, status: 'planned' },
    strategies,
    estimates,
  }
}
