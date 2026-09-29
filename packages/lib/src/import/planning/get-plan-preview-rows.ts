// packages/lib/src/import/planning/get-plan-preview-rows.ts

import type { Database } from '@auxx/database'
import { schema } from '@auxx/database'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { isRecordId } from '../../resources/resource-id'
import { resolutionKey } from '../hashing/resolution-key'
import { getBatchRowData } from '../raw-data'
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
  /** Resolved field values for display; a matched relation is its RecordId */
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
 * Safe to call while planning runs: rows are inserted in batches, so this pages over what has landed.
 */
export async function getPlanPreviewRows(
  db: Database,
  options: GetPlanPreviewOptions
): Promise<PlanPreviewResult> {
  const { jobId, strategy, limit, offset } = options

  const plan = await db.query.ImportPlan.findFirst({
    where: eq(schema.ImportPlan.importJobId, jobId),
    orderBy: desc(schema.ImportPlan.createdAt),
  })

  if (!plan) {
    return { rows: [], total: 0, hasMore: false }
  }

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
  const inPlan = inArray(schema.ImportPlanRow.importPlanStrategyId, strategyIds)

  const [countRow] = await db.select({ total: count() }).from(schema.ImportPlanRow).where(inPlan)
  const total = countRow?.total ?? 0

  const pageRows = await db.query.ImportPlanRow.findMany({
    where: inPlan,
    orderBy: asc(schema.ImportPlanRow.rowIndex),
    limit,
    offset,
  })

  if (pageRows.length === 0) {
    return { rows: [], total, hasMore: false }
  }

  const rawData = await getBatchRowData(
    db,
    jobId,
    pageRows.map((r) => r.rowIndex)
  )
  const resolutions = await getAllJobResolutions(db, jobId)

  const job = await db.query.ImportJob.findFirst({
    where: eq(schema.ImportJob.id, jobId),
    with: { importMapping: { with: { properties: true } } },
  })
  const mappings = job?.importMapping?.properties ?? []

  const previewRows: PlanPreviewRow[] = pageRows.map((planRow) => {
    const rowData = rawData.get(planRow.rowIndex) ?? {}
    const fields: Record<string, unknown> = {}

    for (const mapping of mappings) {
      if (!mapping.targetFieldKey || mapping.targetType === 'skip') continue

      const cellValue = rowData[mapping.sourceColumnIndex]
      if (!cellValue) continue

      // Keyed exactly as `analyzeRow` and `buildRecordData` read it.
      const resolution = resolutions.get(resolutionKey(mapping.id, cellValue))
      const value = resolution?.resolvedValues?.[0]?.value

      // A matched relation shows as the record it matched; anything else (a
      // pending-lookup envelope, no match) falls back to the cell it was read from.
      const isRelation = mapping.resolutionType?.startsWith('relation:') ?? false
      fields[mapping.targetFieldKey] = isRelation
        ? isRecordId(value)
          ? value
          : cellValue
        : (value ?? cellValue)
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
    hasMore: offset + pageRows.length < total,
  }
}
