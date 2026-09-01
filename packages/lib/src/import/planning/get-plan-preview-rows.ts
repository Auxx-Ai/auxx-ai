// packages/lib/src/import/planning/get-plan-preview-rows.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, desc, eq } from 'drizzle-orm'
import { hashValue } from '../hashing/hash-value'
import { getRawDataAsMap } from '../raw-data'
import { getAllJobResolutions } from '../resolution'
import type { StrategyType } from '../types/plan'

/** Preview row data for frontend display */
export interface PlanPreviewRow {
  rowIndex: number
  strategy: StrategyType
  existingRecordId?: string
  status: 'planned' | 'executing' | 'completed' | 'failed'
  errorMessage?: string
  /** Non-fatal issues — the row still imports */
  warningMessage?: string
  /** Resolved field values for display */
  fields: Record<string, unknown>
}

/** Options for getting plan preview rows */
export interface GetPlanPreviewOptions {
  jobId: string
  strategy?: StrategyType
  limit: number
  offset: number
}

/** Result of get plan preview rows */
export interface PlanPreviewResult {
  rows: PlanPreviewRow[]
  total: number
  hasMore: boolean
}

/**
 * Get paginated preview rows for an import plan.
 * Loads raw data and applies resolutions to get field values.
 */
export async function getPlanPreviewRows(
  db: Database,
  options: GetPlanPreviewOptions
): Promise<PlanPreviewResult> {
  const { jobId, strategy, limit, offset } = options

  // 1. Get the plan for this job
  const plan = await db.query.ImportPlan.findFirst({
    where: eq(schema.ImportPlan.importJobId, jobId),
    orderBy: desc(schema.ImportPlan.createdAt),
  })

  if (!plan) {
    return { rows: [], total: 0, hasMore: false }
  }

  // 2. Get strategies (filtered if strategy specified)
  const strategies = await db.query.ImportPlanStrategy.findMany({
    where: strategy
      ? and(
          eq(schema.ImportPlanStrategy.importPlanId, plan.id),
          eq(schema.ImportPlanStrategy.strategy, strategy)
        )
      : eq(schema.ImportPlanStrategy.importPlanId, plan.id),
  })

  if (strategies.length === 0) {
    return { rows: [], total: 0, hasMore: false }
  }

  const strategyIds = strategies.map((s) => s.id)
  const strategyById = new Map(strategies.map((s) => [s.id, s.strategy as StrategyType]))

  // 3. Get ImportPlanRow records with pagination (across all filtered strategies)
  const allPlanRows = await db.query.ImportPlanRow.findMany({
    where: (row, { inArray }) => inArray(row.importPlanStrategyId, strategyIds),
    orderBy: (row, { asc }) => [asc(row.rowIndex)],
  })

  const total = allPlanRows.length
  const paginatedRows = allPlanRows.slice(offset, offset + limit)

  if (paginatedRows.length === 0) {
    return { rows: [], total, hasMore: false }
  }

  // 4. Load raw data for the row indices
  const rawData = await getRawDataAsMap(db, jobId)

  // 5. Load resolutions for applying to raw values
  const resolutions = await getAllJobResolutions(db, jobId)

  // 6. Get mappings for field keys
  const job = await db.query.ImportJob.findFirst({
    where: eq(schema.ImportJob.id, jobId),
    with: {
      importMapping: {
        with: {
          properties: true,
        },
      },
    },
  })

  const mappings = job?.importMapping?.properties ?? []

  // 7. Build preview rows with resolved fields
  const previewRows: PlanPreviewRow[] = paginatedRows.map((planRow) => {
    const rowData = rawData.get(planRow.rowIndex) ?? {}
    const fields: Record<string, unknown> = {}

    // Apply resolutions to get field values
    for (const mapping of mappings) {
      if (!mapping.targetFieldKey || mapping.targetType === 'skip') continue

      const cellValue = rowData[mapping.sourceColumnIndex]
      if (!cellValue) continue

      // The cache is keyed by the hash of the raw cell, exactly as
      // `analyzeRow` and `buildRecordData` read it. This used to look up
      // `${columnIndex}:${cellValue}`, a key nothing ever wrote, so the
      // preview showed the raw file text for every column, including money
      // columns whose resolved value is minor units.
      const resolution = resolutions.get(hashValue(cellValue))

      // A relation column resolves to a record id (or, before planning, a
      // pending-lookup envelope). Neither means anything to a reviewer; the
      // cell it was matched on does, so it is what the preview shows.
      const isRelation = mapping.resolutionType?.startsWith('relation:') ?? false
      const first = resolution?.resolvedValues?.[0]
      fields[mapping.targetFieldKey] = isRelation ? cellValue : (first?.value ?? cellValue)
    }

    return {
      rowIndex: planRow.rowIndex,
      strategy: strategyById.get(planRow.importPlanStrategyId) ?? 'skip',
      existingRecordId: planRow.existingRecordId ?? undefined,
      status: (planRow.status as PlanPreviewRow['status']) ?? 'planned',
      errorMessage: planRow.errorMessage ?? undefined,
      warningMessage: planRow.warningMessage ?? undefined,
      fields,
    }
  })

  return {
    rows: previewRows,
    total,
    hasMore: offset + limit < total,
  }
}
