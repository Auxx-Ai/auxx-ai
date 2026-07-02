// packages/lib/src/record-rules/engine.ts
// Core rule execution: loop guard → snapshot → conditions → ordered actions →
// run log. Callers (the field-change hook + the lifecycle bus consumer) pre-filter
// candidates by field/def and transition; the engine owns everything after that.
//
// Loop guard: actions can write fields that carry other rules (set-field fires the
// field-change hook inline). An AsyncLocalStorage chain caps re-entrancy depth and
// skips a rule that already fired for the same record within one causal chain.

import { AsyncLocalStorage } from 'node:async_hooks'
import { database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { toRecordId } from '@auxx/types/resource'
import { evaluateConditions, normalizeStatusConditions } from '../conditions/evaluate'
import { executeRuleAction } from './actions'
import { makeSnapshotResolver, type RecordSnapshot } from './resolver'
import { insertRecordRuleRun } from './store'
import type { CachedRecordRule, RecordRuleActionOutcome, RecordRuleFireContext } from './types'

const logger = createScopedLogger('record-rules')

/** Max rule→action→rule re-entrancy within one causal chain. */
const MAX_RULE_DEPTH = 3

interface RuleChainState {
  depth: number
  /** `${ruleId}:${entityInstanceId}` pairs that already fired in this chain. */
  seen: Set<string>
}

const ruleChain = new AsyncLocalStorage<RuleChainState>()

async function loadSnapshot(ctx: RecordRuleFireContext): Promise<RecordSnapshot | null> {
  if (ctx.snapshot !== undefined) return ctx.snapshot
  const { fetchResourceById } = await import('../resources/resource-fetcher')
  return fetchResourceById(
    toRecordId(ctx.entityDefinitionId, ctx.entityInstanceId),
    ctx.organizationId
  )
}

/**
 * Fire a set of pre-matched rules for one record event. Never throws — rule
 * execution must not break the originating write or event handler.
 */
export async function fireRecordRules(
  rules: CachedRecordRule[],
  ctx: RecordRuleFireContext
): Promise<void> {
  if (rules.length === 0) return

  const chain = ruleChain.getStore() ?? { depth: 0, seen: new Set<string>() }
  if (chain.depth >= MAX_RULE_DEPTH) {
    logger.warn('Record-rule depth cap hit — skipping nested firings', {
      organizationId: ctx.organizationId,
      entityInstanceId: ctx.entityInstanceId,
      depth: chain.depth,
    })
    return
  }

  let snapshot: RecordSnapshot | null | undefined
  let resolver: ReturnType<typeof makeSnapshotResolver> | undefined

  for (const rule of rules) {
    const chainKey = `${rule.id}:${ctx.entityInstanceId}`
    if (chain.seen.has(chainKey)) continue

    try {
      // Conditions — lazy-load the snapshot + resolver once per event.
      if (rule.condition.length > 0) {
        if (snapshot === undefined) snapshot = await loadSnapshot(ctx)
        if (snapshot === null) continue // record gone and no payload — nothing to evaluate
        if (!resolver) {
          const { getCachedResourceFields } = await import('../cache')
          const fields = await getCachedResourceFields(ctx.organizationId, ctx.entityDefinitionId)
          resolver = makeSnapshotResolver(fields)
        }
        const matched = evaluateConditions(
          snapshot,
          normalizeStatusConditions(rule.condition),
          resolver,
          ctx.userId ? { currentUserId: ctx.userId } : undefined
        )
        if (!matched) continue
      }

      if (snapshot === undefined && rule.actions.some((a) => a.type === 'enqueue-workflow')) {
        // Workflow payloads want the full record even when there were no conditions.
        snapshot = await loadSnapshot(ctx)
      }

      const outcomes: RecordRuleActionOutcome[] = []
      await ruleChain.run(
        { depth: chain.depth + 1, seen: new Set([...chain.seen, chainKey]) },
        async () => {
          for (const [actionIndex, action] of rule.actions.entries()) {
            try {
              const result = await executeRuleAction(action, rule, ctx, snapshot ?? null)
              outcomes.push({ actionIndex, type: action.type, status: result })
            } catch (error) {
              // Continue-and-report: one failed action never blocks the rest.
              outcomes.push({
                actionIndex,
                type: action.type,
                status: 'failed',
                error: error instanceof Error ? error.message : String(error),
              })
            }
          }
        }
      )
      chain.seen.add(chainKey)

      const failed = outcomes.filter((o) => o.status === 'failed').length
      const status = failed === 0 ? 'ok' : failed === outcomes.length ? 'failed' : 'partial'

      try {
        await insertRecordRuleRun(database, {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          entityInstanceId: ctx.entityInstanceId,
          source: ctx.source,
          fieldId: ctx.fieldId ?? null,
          oldValue: ctx.oldValue,
          newValue: ctx.newValue,
          outcomes,
          status,
        })
      } catch (error) {
        logger.error('Failed to write record-rule run log', {
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      if (status !== 'ok') {
        logger.warn('Record rule fired with failed actions', {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          ruleName: rule.name,
          status,
          outcomes,
        })
      }
    } catch (error) {
      logger.error('Record rule execution failed', {
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        ruleName: rule.name,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
}
