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
import { type RecordId, toRecordId, toRecordIds } from '@auxx/types/resource'
import { evaluateConditions, normalizeStatusConditions } from '../conditions/evaluate'
import { executeRuleAction, getNativeRuleHandler } from './actions'
import { makeSnapshotResolver, type RecordSnapshot } from './resolver'
import { insertRecordRuleRun } from './store'
import { matchesFieldTransition } from './transitions'
import type {
  CachedRecordRule,
  RecordRuleActionOutcome,
  RecordRuleBatchContext,
  RecordRuleBatchEvent,
  RecordRuleFireContext,
} from './types'
import { hasNativeAction } from './types'

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

/** Does a rule match one batch event, using the same checks the single path's callers do? */
function ruleMatchesBatchEvent(rule: CachedRecordRule, event: RecordRuleBatchEvent): boolean {
  if (event.fieldId != null) {
    // Field event: rule must be a field rule on the same field with a matching transition.
    if (rule.fieldId === null || rule.fieldId !== event.fieldId) return false
    return matchesFieldTransition(rule.on, event.oldValue, event.newValue)
  }
  // Lifecycle event: any lifecycle rule matches (caller groups created vs deleted).
  return rule.fieldId === null
}

/**
 * Batch entry point. Callers pre-filter `rules` by def; this matches each rule to each
 * event, then:
 *  - runs NON-native rules through the existing per-record `fireRecordRules` (unchanged
 *    semantics — one call per event so the snapshot loads once across a record's rules);
 *  - invokes each NATIVE rule's handler ONCE across the whole batch with the full
 *    `recordIds[]` (dedup-friendly manufacturing recalcs), logging one RecordRuleRun row
 *    per record (D11).
 *
 * A rule is all-native or has no native actions (enforced by `assertRuleShape` /
 * `declareSystemRules`), so it is fully handled by exactly one of the two paths.
 * Never throws — rule execution must not break the originating handler.
 */
export async function fireRecordRulesBatch(
  rules: CachedRecordRule[],
  ctx: RecordRuleBatchContext
): Promise<void> {
  if (rules.length === 0 || ctx.events.length === 0) return

  const matched: { rule: CachedRecordRule; event: RecordRuleBatchEvent }[] = []
  for (const event of ctx.events) {
    for (const rule of rules) {
      if (ruleMatchesBatchEvent(rule, event)) matched.push({ rule, event })
    }
  }
  if (matched.length === 0) {
    logger.debug('Batch firing matched no rules', {
      organizationId: ctx.organizationId,
      entityDefinitionId: ctx.entityDefinitionId,
      source: ctx.source,
      rules: rules.map((r) => r.id),
      events: ctx.events.length,
    })
    return
  }

  // 1) Non-native rules → existing per-record path, grouped by event (preserves the
  // single-call semantics: one snapshot load for all of a record's non-native rules).
  const nonNativeByEvent = new Map<RecordRuleBatchEvent, CachedRecordRule[]>()
  for (const { rule, event } of matched) {
    if (hasNativeAction(rule.actions)) continue
    const arr = nonNativeByEvent.get(event)
    if (arr) arr.push(rule)
    else nonNativeByEvent.set(event, [rule])
  }
  for (const [event, rulesForEvent] of nonNativeByEvent) {
    await fireRecordRules(rulesForEvent, {
      organizationId: ctx.organizationId,
      entityDefinitionId: ctx.entityDefinitionId,
      entityInstanceId: event.entityInstanceId,
      source: ctx.source,
      userId: ctx.userId,
      fieldId: event.fieldId,
      oldValue: event.oldValue,
      newValue: event.newValue,
      snapshot: event.snapshot,
    })
  }

  // 2) Native rules → one handler invocation per rule with the full recordIds batch.
  const nativeRules = [
    ...new Set(matched.filter((m) => hasNativeAction(m.rule.actions)).map((m) => m.rule)),
  ]
  // Native handlers are registered by the field-hooks bootstrap. A process whose first
  // record-rules touch is THIS dispatch (e.g. the events worker consuming a lifecycle
  // event against an already-cached rule union) hasn't run it yet — self-init on the
  // first handler miss, like the cache provider does. Lazy-import: a static registry
  // import re-introduces the field-hooks ⇄ record-rules cycle that breaks vi.mock.
  if (
    nativeRules.some((r) =>
      r.actions.some((a) => a.type === 'native' && !getNativeRuleHandler(a.handler))
    )
  ) {
    try {
      const { ensureHooksRegistered } = await import('../field-hooks/registry')
      ensureHooksRegistered()
    } catch (error) {
      // Degrade to the per-action "handler not registered" outcome below.
      logger.error('Field-hooks bootstrap failed during native rule dispatch', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  for (const rule of nativeRules) {
    const events = matched.filter((m) => m.rule === rule).map((m) => m.event)
    // One event per record here; dedupe defensively.
    const eventByInstance = new Map<string, RecordRuleBatchEvent>()
    for (const event of events) {
      if (!eventByInstance.has(event.entityInstanceId)) {
        eventByInstance.set(event.entityInstanceId, event)
      }
    }
    const recordIds = toRecordIds(ctx.entityDefinitionId, [...eventByInstance.keys()])

    // Forward per-record raw values (when the dispatching door captured them) + the
    // lifecycle transition, so entity-trigger native handlers can reconstruct the legacy
    // `EntityTriggerEvent.values` without a DB refetch (Phase 9 / Option A).
    const eventDataByRecordId: Record<RecordId, Record<string, unknown>> = {}
    for (const [instanceId, event] of eventByInstance) {
      if (event.eventData) {
        eventDataByRecordId[toRecordId(ctx.entityDefinitionId, instanceId)] = event.eventData
      }
    }
    const hasEventData = Object.keys(eventDataByRecordId).length > 0
    const lifecycleAction =
      rule.on === 'created' ? 'created' : rule.on === 'deleted' ? 'deleted' : undefined

    logger.debug('Dispatching native rule', {
      organizationId: ctx.organizationId,
      ruleId: rule.id,
      source: ctx.source,
      action: lifecycleAction,
      records: recordIds.length,
      recordsWithEventData: Object.keys(eventDataByRecordId).length,
    })

    const outcomes: RecordRuleActionOutcome[] = []
    for (const [actionIndex, action] of rule.actions.entries()) {
      if (action.type !== 'native') {
        // Shouldn't happen (all-native invariant) — skip defensively.
        outcomes.push({ actionIndex, type: action.type, status: 'skipped' })
        continue
      }
      const handler = getNativeRuleHandler(action.handler)
      if (!handler) {
        logger.error('Record-rule native handler not registered — skipping', {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          handler: action.handler,
        })
        outcomes.push({
          actionIndex,
          type: 'native',
          status: 'failed',
          error: `No native handler registered for '${action.handler}'`,
        })
        continue
      }
      try {
        await handler({
          recordIds,
          organizationId: ctx.organizationId,
          userId: ctx.userId,
          action: lifecycleAction,
          eventDataByRecordId: hasEventData ? eventDataByRecordId : undefined,
        })
        outcomes.push({ actionIndex, type: 'native', status: 'ok' })
      } catch (error) {
        outcomes.push({
          actionIndex,
          type: 'native',
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }

    const failed = outcomes.filter((o) => o.status === 'failed').length
    const status = failed === 0 ? 'ok' : failed === outcomes.length ? 'failed' : 'partial'
    if (status !== 'ok') {
      logger.warn('Native record rule fired with failed actions', {
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        ruleName: rule.name,
        status,
        outcomes,
      })
    } else {
      logger.debug('Native rule completed', { ruleId: rule.id, records: recordIds.length })
    }

    // One run row per record (D11 — system-rule firings are fully debuggable).
    for (const event of eventByInstance.values()) {
      try {
        await insertRecordRuleRun(database, {
          organizationId: ctx.organizationId,
          ruleId: rule.id,
          entityInstanceId: event.entityInstanceId,
          source: ctx.source,
          fieldId: event.fieldId ?? null,
          oldValue: event.oldValue,
          newValue: event.newValue,
          outcomes,
          status,
        })
      } catch (error) {
        logger.error('Failed to write record-rule run log (native batch)', {
          ruleId: rule.id,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
