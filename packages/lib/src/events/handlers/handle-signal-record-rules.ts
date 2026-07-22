// packages/lib/src/events/handlers/handle-signal-record-rules.ts
// Dispatch door 4: the signal door (plans/signals/06-follow-ups-build.md Step 3). Bus
// consumer for `signal:recorded` — fires RecordRules with `on: 'signal'` matched by
// `signalKind`. Bot and backfill signals never dispatch (decision 5) — bots must not
// create follow-up tasks, backfill is historical. Conditions evaluate against the
// record's field-value snapshot merged with the contact's `EntitySignalRollup` pseudo-
// fields (decision 6); a missing rollup row leaves them `undefined` so "is empty" matches.
//
// Keep top-level imports to types/logger only; lazy-import everything else (cache, engine,
// resource-fetcher, signals/queries) — importing the lib realtime barrel (reachable via the
// notify action / record-rules engine) from an events handler creates an import cycle that
// breaks vi.mock (see project memory).

import { database as db, schema } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import { and, eq, inArray } from 'drizzle-orm'
import type { CachedRecordRule, RecordRuleFireContext } from '../../record-rules/types'
import { signalPseudoFieldKey } from '../../signals/client'
import type { AuxxEvent, SignalRecordedEvent } from '../types'

const logger = createScopedLogger('handler:signal-record-rules')

type EntitySignalRollupRow = typeof schema.EntitySignalRollup.$inferSelect

export const handleSignalRecordRules = async ({ data: event }: { data: AuxxEvent }) => {
  if (event.type !== 'signal:recorded') return
  const data = event.data as SignalRecordedEvent['data']

  // Decision 5 — bots and backfill signals never dispatch rules.
  if (data.isBot || data.backfill) return

  try {
    const { getCachedRecordRules } = await import('../../cache')
    const allRules = await getCachedRecordRules(data.organizationId)
    const rules = allRules.filter(
      (rule) => rule.enabled && rule.on === 'signal' && rule.signalKind === data.kind
    )
    // Bail before the EntitySignal read — the hot path for every open/click/etc. when
    // the org has no signal-door rules for this kind.
    if (rules.length === 0) return

    const signalIds = data.signalIds && data.signalIds.length > 0 ? data.signalIds : [data.signalId]
    const rows = await db.query.EntitySignal.findMany({
      where: and(
        eq(schema.EntitySignal.organizationId, data.organizationId),
        inArray(schema.EntitySignal.id, signalIds)
      ),
    })
    if (rows.length === 0) {
      logger.debug('No EntitySignal rows found for signal:recorded (likely pruned), skipping', {
        organizationId: data.organizationId,
        signalIds,
      })
      return
    }
    // Representative row for the run log's `newValue` + provenance — see file header;
    // bulk (`signalIds`) writes are grouped per-contact so every row shares the same kind
    // in practice.
    const representative = rows[0]!

    const rulesByDef = new Map<string, CachedRecordRule[]>()
    for (const rule of rules) {
      const arr = rulesByDef.get(rule.entityDefinitionId)
      if (arr) arr.push(rule)
      else rulesByDef.set(rule.entityDefinitionId, [rule])
    }

    const { getCachedEntityDefId } = await import('../../cache')
    const { fireRecordRules } = await import('../../record-rules/engine')

    for (const recordKey of data.recordKeys) {
      const separatorIndex = recordKey.indexOf(':')
      if (separatorIndex === -1) continue
      const slug = recordKey.slice(0, separatorIndex)
      const entityInstanceId = recordKey.slice(separatorIndex + 1)
      if (!entityInstanceId) continue

      const entityDefinitionId = (await getCachedEntityDefId(data.organizationId, slug)) ?? slug
      const matched = rulesByDef.get(entityDefinitionId)
      if (!matched || matched.length === 0) continue

      // Only pay for a snapshot fetch when a matched rule actually has conditions —
      // mirrors the engine's own per-rule laziness (record-rules/engine.ts loadSnapshot).
      const needsSnapshot = matched.some((rule) => rule.condition.length > 0)
      const snapshot = needsSnapshot
        ? await buildSignalConditionSnapshot(
            data.organizationId,
            entityDefinitionId,
            entityInstanceId
          )
        : undefined

      const ctx: RecordRuleFireContext = {
        organizationId: data.organizationId,
        entityDefinitionId,
        entityInstanceId,
        source: 'interactive',
        newValue: {
          signalId: representative.id,
          kind: representative.kind,
          subtype: representative.subtype,
          occurredAt: representative.occurredAt,
        },
        snapshot,
        signal: {
          signalId: representative.id,
          kind: data.kind,
          contactEntityInstanceId: data.contactEntityInstanceId ?? undefined,
          subtype: data.subtype || undefined,
          occurredAt: toIsoOrUndefined(data.occurredAt),
        },
      }

      await fireRecordRules(matched, ctx)
    }
  } catch (error) {
    logger.error('Signal record-rule dispatch failed', {
      organizationId: data.organizationId,
      eventType: event.type,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

/** Event dates cross BullMQ as strings — normalize either form to ISO, dropping invalids. */
function toIsoOrUndefined(value: Date | string | undefined | null): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

/**
 * Record snapshot for condition evaluation: the fired record's own field values plus the
 * contact's rollup columns merged in under their bare pseudo-field keys (decision 6). The
 * evaluator (`conditions/evaluate.ts`) strips any colon-prefixed fieldId down to the part
 * after the colon before resolving, so a condition's `signal:openCount30d` id resolves
 * against the bare `openCount30d` key here — see `signalPseudoFieldKey`.
 */
async function buildSignalConditionSnapshot(
  organizationId: string,
  entityDefinitionId: string,
  entityInstanceId: string
): Promise<Record<string, unknown> | null> {
  const [{ fetchResourceById }, { toRecordId }, { getSignalRollup }] = await Promise.all([
    import('../../resources/resource-fetcher'),
    import('@auxx/types/resource'),
    import('../../signals/queries'),
  ])

  const recordSnapshot = await fetchResourceById(
    toRecordId(entityDefinitionId, entityInstanceId),
    organizationId
  )

  const { Result } = await import('../../result')
  const rollupResult = await getSignalRollup(organizationId, entityInstanceId)
  const rollup = Result.isOk(rollupResult) ? rollupResult.value : null

  return {
    ...(recordSnapshot ?? { id: entityInstanceId, entityDefinitionId, fieldValues: {} }),
    fieldValues: {
      ...(recordSnapshot?.fieldValues ?? {}),
      ...rollupPseudoFieldValues(rollup),
    },
  }
}

/** Bare (unprefixed) rollup pseudo-field keys → values. `null` rollup = every key `undefined`. */
function rollupPseudoFieldValues(rollup: EntitySignalRollupRow | null): Record<string, unknown> {
  if (!rollup) return {}
  return {
    [signalPseudoFieldKey('signal:lastOpenedAt')]: rollup.lastOpenedAt,
    [signalPseudoFieldKey('signal:openCount30d')]: rollup.openCount30d,
    [signalPseudoFieldKey('signal:lastClickedAt')]: rollup.lastClickedAt,
    [signalPseudoFieldKey('signal:clickCount30d')]: rollup.clickCount30d,
    [signalPseudoFieldKey('signal:lastVisitAt')]: rollup.lastVisitAt,
    [signalPseudoFieldKey('signal:visitCount30d')]: rollup.visitCount30d,
    [signalPseudoFieldKey('signal:lastRepliedAt')]: rollup.lastRepliedAt,
    [signalPseudoFieldKey('signal:lastSignalAt')]: rollup.lastSignalAt,
    [signalPseudoFieldKey('signal:unsubscribedAt')]: rollup.unsubscribedAt,
    [signalPseudoFieldKey('signal:bouncedAt')]: rollup.bouncedAt,
    [signalPseudoFieldKey('signal:bounceType')]: rollup.bounceType,
  }
}

/** Exposed for tests only. */
export const __test__ = { rollupPseudoFieldValues, buildSignalConditionSnapshot }
