// packages/lib/src/import/fields/auto-map-orchestrator.ts

import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { SystemModelService } from '../../ai/providers/system-model-service'
import { ModelType } from '../../ai/providers/types'
import { QuotaService } from '../../ai/quota/quota-service'
import type { AIColumnMappingInput, AIColumnMappingResponse } from '../types/ai-mapping'
import { aiAutoMapColumns } from './ai-auto-map-columns'
import { autoMapColumns, type ColumnHeader } from './auto-map-columns'
import type { ImportableField } from './get-importable-fields'

const logger = createScopedLogger('auto-map-orchestrator')

/** Extended column header with sample values for AI */
export interface ColumnHeaderWithSamples extends ColumnHeader {
  sampleValues: string[]
}

/** Options for auto-mapping */
export interface AutoMapOptions {
  /** Force use of specific strategy */
  strategy?: 'ai' | 'fallback' | 'auto'
  /** Entity definition ID for context */
  entityDefinitionId: string
}

/**
 * Check if AI is available for the organization.
 * Checks:
 * 1. User has a default LLM model configured (via SystemModelService)
 * 2. User has available quota (via QuotaService)
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @returns Availability status with optional reason
 */
async function isAIAvailable(
  db: Database,
  organizationId: string
): Promise<{ available: boolean; reason?: string }> {
  try {
    // Check 1: Does user have a default LLM model configured?
    const systemModelService = new SystemModelService(db, organizationId)
    const defaultModel = await systemModelService.getDefault(ModelType.LLM)

    if (!defaultModel) {
      logger.debug('No default LLM model configured', { organizationId })
      return { available: false, reason: 'no_default_model' }
    }

    // Check 2: Does user have available quota?
    const quotaService = new QuotaService(db, organizationId)
    const hasQuota = await quotaService.hasAvailableQuota()

    if (!hasQuota) {
      logger.debug('AI quota exceeded', { organizationId })
      return { available: false, reason: 'quota_exceeded' }
    }

    return { available: true }
  } catch (error) {
    logger.warn('Failed to check AI availability', { error, organizationId })
    return { available: false, reason: 'check_failed' }
  }
}

/**
 * Orchestrate column mapping with AI or fallback.
 * Uses AI when available and configured, falls back to string matching otherwise.
 *
 * @param db - Database instance
 * @param organizationId - Organization ID
 * @param userId - User ID
 * @param headers - Column headers with sample values
 * @param fields - Available target fields
 * @param options - Mapping options
 * @returns Mapping results with strategy used
 */
export async function orchestrateAutoMap(
  db: Database,
  organizationId: string,
  userId: string,
  headers: ColumnHeaderWithSamples[],
  fields: ImportableField[],
  options: AutoMapOptions
): Promise<AIColumnMappingResponse> {
  const strategy = options.strategy ?? 'auto'

  // Determine if we should use AI
  let useAI = strategy === 'ai'
  let aiUnavailableReason: string | undefined

  if (strategy === 'auto') {
    const aiStatus = await isAIAvailable(db, organizationId)
    useAI = aiStatus.available
    aiUnavailableReason = aiStatus.reason
  }

  // Try AI mapping if appropriate
  if (useAI && strategy !== 'fallback') {
    try {
      const input: AIColumnMappingInput = {
        columns: headers.map((h) => ({
          index: h.index,
          name: h.name,
          sampleValues: h.sampleValues,
        })),
        targetFields: fields,
        entityDefinitionId: options.entityDefinitionId,
      }

      const aiResults = await aiAutoMapColumns(db, organizationId, userId, input)

      logger.info('AI column mapping succeeded', {
        organizationId,
        mappedCount: aiResults.filter((r) => r.matchedFieldKey).length,
        totalColumns: headers.length,
      })

      return {
        mappings: aiResults,
        usedAI: true,
      }
    } catch (error) {
      logger.warn('AI mapping failed, falling back to string matching', {
        error: error instanceof Error ? error.message : String(error),
      })
      // Fall through to fallback
    }
  } else if (aiUnavailableReason) {
    logger.info('AI not available, using fallback', { reason: aiUnavailableReason })
  }

  // Fallback: use string-matching algorithm
  logger.info('Using fallback string-matching for column mapping')

  const fallbackResults = autoMapColumns(
    headers.map((h) => ({ index: h.index, name: h.name })),
    fields
  )

  return {
    mappings: fallbackResults.map((r) => ({
      columnIndex: r.columnIndex,
      columnName: r.columnName,
      matchedFieldKey: r.matchedField?.key ?? null,
      resolutionType: r.resolutionType,
      confidence: r.confidence,
    })),
    usedAI: false,
  }
}
