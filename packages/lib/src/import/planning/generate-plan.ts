// packages/lib/src/import/planning/generate-plan.ts

import { eq } from 'drizzle-orm'
import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import type { ImportPlan, ImportPlanStrategy, PlanEstimates, StrategyType } from '../types/plan'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'
import { createPlan } from './create-plan'
import { createDefaultStrategies } from './create-strategy'
import { analyzeRow, type AnalyzeRowContext } from './analyze-row'
import { batchAssignRows, type AssignRowInput } from './assign-row-to-strategy'
import { calculateEstimatesFromCounts } from './calculate-estimates'
import { createFindExistingRecord } from './find-existing-record'
import { ResourceRegistryService } from '../../resources'
import type { ResourceField } from '../../resources'

const logger = createScopedLogger('generate-plan')

/** Row analysis result for real-time preview streaming */
export interface AnalyzedRow {
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  fields: Record<string, unknown>
  errors: string[]
}

/** Options for generating a plan */
export interface GeneratePlanOptions {
  db: Database
  organizationId: string
  jobId: string
  targetTable: string
  rawData: Map<number, Record<number, string>>
  mappings: ImportMappingProperty[]
  resolutions: Map<string, ValueResolution>
  identifierFieldKey?: string
  /** Called for each analyzed row (for real-time SSE streaming) */
  onRowAnalyzed?: (row: AnalyzedRow) => Promise<void> | void
  /** Progress callback: (phase, processed, total) */
  onProgress?: (phase: 'analyzing' | 'assigning', processed: number, total: number) => Promise<void> | void
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
    targetTable,
    rawData,
    mappings,
    resolutions,
    identifierFieldKey,
    onRowAnalyzed,
    onProgress,
  } = options

  // Create plan record
  const plan = await createPlan(db, jobId)

  // Create default strategies
  const strategies = await createDefaultStrategies(db, plan.id, identifierFieldKey)

  // Build strategy lookup
  const strategyByType = new Map<StrategyType, ImportPlanStrategy>()
  for (const strategy of strategies) {
    strategyByType.set(strategy.strategy, strategy)
  }

  // Get resource definition and identifier field
  const registry = new ResourceRegistryService(organizationId, db)
  const resource = await registry.getById(targetTable)

  logger.info('Planning: Resource lookup', {
    targetTable,
    resourceFound: !!resource,
    resourceId: resource?.id,
    fieldCount: resource?.fields.length,
  })

  // Find the identifier field for existing record lookup
  let identifierField: ResourceField | undefined
  if (identifierFieldKey && resource) {
    identifierField = resource.fields.find((f) => f.key === identifierFieldKey)
    logger.info('Planning: Using explicit identifier field', {
      identifierFieldKey,
      fieldFound: !!identifierField,
      fieldType: identifierField?.type,
    })
  } else if (resource) {
    // Auto-select default identifier if not specified
    const identifierFields = registry.getIdentifierFields(resource)
    identifierField = registry.getDefaultIdentifierField(resource)
    logger.info('Planning: Using default identifier field', {
      availableIdentifiers: identifierFields.map((f) => ({ key: f.key, type: f.type })),
      selectedField: identifierField?.key,
      selectedType: identifierField?.type,
    })
  }

  // Log the final identifier choice
  logger.info('Planning: Final identifier configuration', {
    hasResource: !!resource,
    hasIdentifierField: !!identifierField,
    identifierKey: identifierField?.key,
    identifierDbColumn: identifierField?.dbColumn,
    identifierType: identifierField?.type,
  })

  // Create findExistingRecord function if we have resource and identifier field
  const findExistingRecord =
    resource && identifierField
      ? createFindExistingRecord({ db, organizationId, resource, identifierField })
      : undefined

  // Analyze context
  const analyzeCtx: AnalyzeRowContext = {
    mappings,
    resolutions,
    identifierFieldKey: identifierField?.key,
    findExistingRecord,
  }

  // Track strategy counts
  const strategyCounts: Record<StrategyType, number> = {
    create: 0,
    update: 0,
    skip: 0,
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
      continue
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
    })

    // Add to batch
    assignments.push({
      strategyId: strategy.id,
      rowIndex: analysis.rowIndex,
      existingRecordId: analysis.existingRecordId,
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
