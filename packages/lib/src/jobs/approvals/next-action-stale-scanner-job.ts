// packages/lib/src/jobs/approvals/next-action-stale-scanner-job.ts

import { database, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toResourceFieldId } from '@auxx/types/field'
import { parseRecordId, toRecordId } from '@auxx/types/resource'
import type { Job } from 'bullmq'
import { and, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { createCallModel } from '../../ai/agent-framework/llm-adapter'
import { ModelType } from '../../ai/providers/types'
import { createBundleFromHeadlessRun, markStaleBundles } from '../../approvals/bundle-service'
import { runHeadlessSuggestion } from '../../approvals/headless-runner'
import { findCachedResource, getCachedDefaultModel } from '../../cache/org-cache-helpers'
import { FieldValueService } from '../../field-values/field-value-service'
import { FeaturePermissionService } from '../../permissions/feature-permission-service'
import { FeatureKey } from '../../permissions/types'
import type { Resource } from '../../resources/registry/types'
import {
  getStaleAfterDays,
  getTerminalStages,
  SCANNED_ENTITY_SLUGS,
} from '../../work-items/stale-defaults'

const logger = createScopedLogger('job:next-action-stale-scanner')

/** Concurrent in-flight headless runs per scanner tick. */
const RUN_CONCURRENCY = 5

/** Max candidates fetched per (org × entity-def) per tick. */
const CANDIDATE_BATCH_SIZE = 50

export interface NextActionStaleScannerJobData {
  /** When true, log candidates but skip headless calls + bundle inserts. */
  dryRun?: boolean
  /** Optional: scope the scan to a single org (used by manual-trigger path / tests). */
  organizationId?: string
}

/**
 * Stale scanner — runs every 5 minutes via the BullMQ scheduler. For each
 * (org × tracked entity definition), finds entities whose activity has gone
 * cold and which haven't been scanned since their latest activity, calls the
 * headless kopilot, and stores any non-empty bundle.
 *
 * Always bumps `EntityInstance.lastSuggestionScanAt` after a run — regardless
 * of whether actions were proposed — so the next tick won't redo the same
 * entity unless activity advances.
 *
 * After processing the new candidates, flips any FRESH bundle whose
 * `computedForActivityAt` predates the entity's current `lastActivityAt` to
 * STALE in one bulk update.
 */
export async function nextActionStaleScannerJob(job: Job<NextActionStaleScannerJobData>) {
  const { dryRun = false, organizationId } = job.data
  const startedAt = Date.now()
  logger.info('Starting AI suggestion stale scanner', { dryRun, organizationId, jobId: job.id })

  // Resolve target orgs. With no `organizationId` filter, sweep every org
  // that has the `todayInbox` feature flag enabled (default: off).
  const orgs = await listScanTargetOrgs(organizationId)
  const enabledOrgs = await filterByTodayInboxFlag(orgs)

  let totalCandidates = 0
  let totalBundles = 0
  let totalRuns = 0
  let totalStaled = 0

  for (const org of enabledOrgs) {
    if (job.token === undefined) {
      // Best-effort heartbeat extension — ignore failures.
    }

    // Resolve the org's default LLM. Skip the org if no model is configured;
    // the scanner shouldn't surface "we couldn't pick a model" as a per-entity
    // failure repeated 50 times.
    const modelDefault = await getCachedDefaultModel(org.id, ModelType.LLM)
    if (!modelDefault) {
      logger.debug('Skipping org without default LLM', { organizationId: org.id })
      continue
    }
    const modelId = `${modelDefault.provider}:${modelDefault.model}`
    const callModel = createCallModel({
      organizationId: org.id,
      userId: org.systemUserId ?? org.createdById ?? '',
      source: 'kopilot',
      sourceId: 'headless-stale-scanner',
    })

    for (const slug of SCANNED_ENTITY_SLUGS) {
      const resource = await findCachedResource(org.id, slug)
      if (!resource) continue
      const entityDefinitionId = resource.entityDefinitionId ?? resource.id
      if (!entityDefinitionId) continue

      const staleDays = getStaleAfterDays(slug)
      const terminalValues = getTerminalStages(slug)

      const candidates = await fetchCandidates({
        organizationId: org.id,
        entityDefinitionId,
        staleDays,
        limit: CANDIDATE_BATCH_SIZE,
      })

      const filtered = await filterTerminalStage({
        candidates,
        organizationId: org.id,
        entityDefinitionId,
        terminalValues,
        resource,
      })

      totalCandidates += filtered.length
      logger.info('Candidates resolved', {
        organizationId: org.id,
        slug,
        entityDefinitionId,
        rawCount: candidates.length,
        filteredCount: filtered.length,
      })

      if (filtered.length === 0) continue
      if (dryRun) continue

      const ownerFallback = org.systemUserId ?? org.createdById
      if (!ownerFallback) continue

      const runResults = await runWithConcurrency(filtered, RUN_CONCURRENCY, async (candidate) => {
        try {
          const result = await runHeadlessSuggestion(
            { db: database, callModel },
            {
              organizationId: org.id,
              ownerUserId: candidate.createdById ?? ownerFallback,
              entityInstanceId: candidate.id,
              triggerSource: 'stale_scan',
              modelId,
            }
          )

          // ALWAYS bump lastSuggestionScanAt — regardless of result. This is
          // the v3 suppression mechanism: next tick won't pick this entity up
          // until activity advances past the new scan timestamp.
          await database
            .update(schema.EntityInstance)
            .set({ lastSuggestionScanAt: new Date() })
            .where(eq(schema.EntityInstance.id, candidate.id))

          if (!result.ok) {
            logger.warn('Headless run failed', {
              organizationId: org.id,
              entityInstanceId: candidate.id,
              error: result.error.message,
            })
            return { ran: true, inserted: false }
          }

          const insert = await createBundleFromHeadlessRun(database, {
            result: result.value,
            organizationId: org.id,
            ownerUserId: candidate.createdById ?? ownerFallback,
            entityInstanceId: candidate.id,
            entityDefinitionId,
            triggerSource: 'stale_scan',
          })

          if (!insert.ok) {
            logger.warn('Bundle insert failed', {
              organizationId: org.id,
              entityInstanceId: candidate.id,
              error: insert.error.message,
            })
            return { ran: true, inserted: false }
          }
          return { ran: true, inserted: insert.value !== undefined }
        } catch (err) {
          logger.error('Scanner run threw', {
            organizationId: org.id,
            entityInstanceId: candidate.id,
            error: err instanceof Error ? err.message : String(err),
          })
          return { ran: false, inserted: false }
        }
      })

      totalRuns += runResults.filter((r) => r.ran).length
      totalBundles += runResults.filter((r) => r.inserted).length
    }

    // After processing the org's new candidates, flip stale bundles to STALE.
    // One bulk UPDATE per org per tick (cheap).
    if (!dryRun) {
      const staled = await markStaleBundles(database, { organizationId: org.id })
      if (staled.ok) totalStaled += staled.value.updated
    }
  }

  const elapsedMs = Date.now() - startedAt
  logger.info('AI suggestion stale scanner finished', {
    orgs: enabledOrgs.length,
    totalEligible: orgs.length,
    totalCandidates,
    totalRuns,
    totalBundles,
    totalStaled,
    elapsedMs,
  })

  return {
    orgs: enabledOrgs.length,
    totalEligible: orgs.length,
    totalCandidates,
    totalRuns,
    totalBundles,
    totalStaled,
    elapsedMs,
  }
}

/**
 * Filter the active-org list down to those with the `todayInbox` feature flag
 * enabled (plan defaults + PlanSubscription.customFeatureLimits override).
 * Disabled by default.
 */
async function filterByTodayInboxFlag(orgs: ScanTargetOrg[]): Promise<ScanTargetOrg[]> {
  const features = new FeaturePermissionService()
  const checks = await Promise.all(
    orgs.map((org) => features.hasAccess(org.id, FeatureKey.todayInbox))
  )
  return orgs.filter((_, i) => checks[i])
}

// ===== HELPERS =====

interface ScanTargetOrg {
  id: string
  systemUserId: string | null
  createdById: string | null
}

async function listScanTargetOrgs(only?: string): Promise<ScanTargetOrg[]> {
  const conditions = [isNull(schema.Organization.disabledAt)]
  if (only) conditions.push(eq(schema.Organization.id, only))
  const rows = await database
    .select({
      id: schema.Organization.id,
      systemUserId: schema.Organization.systemUserId,
      createdById: schema.Organization.createdById,
    })
    .from(schema.Organization)
    .where(and(...conditions))
  return rows
}

interface CandidateRow {
  id: string
  createdById: string | null
  lastActivityAt: Date | null
}

async function fetchCandidates(args: {
  organizationId: string
  entityDefinitionId: string
  staleDays: number
  limit: number
}): Promise<CandidateRow[]> {
  // Suppression: never scanned, OR scanned before the entity's latest activity.
  // Dismissal exclusion: NOT EXISTS active SuggestionDismissal.
  const stalenessCutoff = sql`NOW() - (${args.staleDays} || ' days')::interval`

  const rows = await database
    .select({
      id: schema.EntityInstance.id,
      createdById: schema.EntityInstance.createdById,
      lastActivityAt: schema.EntityInstance.lastActivityAt,
    })
    .from(schema.EntityInstance)
    .where(
      and(
        eq(schema.EntityInstance.organizationId, args.organizationId),
        eq(schema.EntityInstance.entityDefinitionId, args.entityDefinitionId),
        isNull(schema.EntityInstance.archivedAt),
        isNotNull(schema.EntityInstance.lastActivityAt),
        lt(schema.EntityInstance.lastActivityAt, stalenessCutoff as unknown as Date),
        sql`(${schema.EntityInstance.lastSuggestionScanAt} IS NULL OR ${schema.EntityInstance.lastSuggestionScanAt} < ${schema.EntityInstance.lastActivityAt})`,
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.SuggestionDismissal} d
          WHERE d.${sql.raw('"entityInstanceId"')} = ${schema.EntityInstance.id}
            AND d.${sql.raw('"organizationId"')} = ${schema.EntityInstance.organizationId}
            AND d.${sql.raw('"dismissedAtActivity"')} >= ${schema.EntityInstance.lastActivityAt}
            AND (d.${sql.raw('"snoozeUntil"')} IS NULL OR d.${sql.raw('"snoozeUntil"')} > NOW())
        )`
      )
    )
    .orderBy(schema.EntityInstance.lastActivityAt)
    .limit(args.limit)

  return rows
}

/**
 * Drop candidates currently in a terminal stage. The stage field is read from
 * the org's cached resource (no DB roundtrip), and current values are fetched
 * via `FieldValueService.batchGetValues` so we don't poke at FieldValue's
 * column layout directly.
 */
async function filterTerminalStage(args: {
  candidates: CandidateRow[]
  organizationId: string
  entityDefinitionId: string
  terminalValues: ReadonlySet<string>
  resource: Resource
}): Promise<CandidateRow[]> {
  if (args.candidates.length === 0 || args.terminalValues.size === 0) {
    return args.candidates
  }

  const stageField = args.resource.fields.find((f) => f.systemAttribute === 'stage')
  if (!stageField) return args.candidates

  const options = stageField.options?.options ?? []
  const terminalOptionIds = new Set(
    options
      .filter((o) => args.terminalValues.has(o.value))
      .map((o) => o.id)
      .filter((id): id is string => typeof id === 'string')
  )
  if (terminalOptionIds.size === 0) return args.candidates

  const service = new FieldValueService(args.organizationId)
  const stageRef = toResourceFieldId(args.entityDefinitionId, stageField.id)
  const recordIds = args.candidates.map((c) => toRecordId(args.entityDefinitionId, c.id))

  const result = await service.batchGetValues({
    recordIds,
    fieldReferences: [stageRef],
  })

  const terminalEntities = new Set<string>()
  for (const r of result.values) {
    const values = Array.isArray(r.value) ? r.value : r.value ? [r.value] : []
    const isTerminal = values.some((v) => v.type === 'option' && terminalOptionIds.has(v.optionId))
    if (isTerminal) {
      terminalEntities.add(parseRecordId(r.recordId).entityInstanceId)
    }
  }
  return args.candidates.filter((c) => !terminalEntities.has(c.id))
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++
      if (idx >= items.length) return
      const item = items[idx]
      if (item === undefined) return
      results[idx] = await fn(item)
    }
  })
  await Promise.all(workers)
  return results
}
