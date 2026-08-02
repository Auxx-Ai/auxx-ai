// packages/lib/src/mail-filters/engine.ts
// Mail-filter execution: loop guard → one SQL pass → ordered actions behind a
// claim → run row → stop. Copied in shape from `record-rules/engine.ts`.
//
// Loop guard: an action can write a field another filter watches (a `move-inbox`
// lands the thread in an inbox whose own filters then match). An
// AsyncLocalStorage chain caps re-entrancy depth and skips a filter that already
// fired for the same thread within one causal chain.
//
// NEVER THROWS. The gate fails open (invariant 3) — a broken filter must not be
// able to stop the timeline, bounce ingestion or workflows.

import { AsyncLocalStorage } from 'node:async_hooks'
import type { Database } from '@auxx/database'
import { createScopedLogger } from '@auxx/logger'
import {
  captureUndoState,
  executeMailFilterAction,
  type MailFilterActionContext,
  type MailFilterInbox,
} from './actions'
import { matchFilters } from './evaluate'
import { touchLastFiredAtMany } from './mutations'
import { claimMailFilterRun, completeMailFilterRun } from './runs'
import type {
  CachedMailFilter,
  MailFilterActionOutcome,
  MailFilterRunSource,
  MailFilterRunStatus,
} from './types'

const logger = createScopedLogger('mail-filters')

/** Max filter→action→filter re-entrancy within one causal chain. */
const MAX_FILTER_DEPTH = 3

interface FilterChainState {
  depth: number
  /** `${filterId}:${threadId}` pairs that already fired in this chain. */
  seen: Set<string>
}

const filterChain = new AsyncLocalStorage<FilterChainState>()

export interface FireMailFiltersInput {
  db: Database
  organizationId: string
  threadId: string
  messageId: string
  /** The thread row the caller already loaded — the engine re-reads nothing. */
  thread: {
    inboxId: string | null
    status: string | null
    assigneeId: string | null
  }
  /** The thread's inbox, from the `inboxes` org cache. */
  inbox: MailFilterInbox | null
  /** Enabled filters for the thread's inbox, ALREADY sorted by `order`. */
  filters: CachedMailFilter[]
  /** Part of the claim key — a backfill and a live firing are distinct rows. */
  source: MailFilterRunSource
}

export interface FireMailFiltersResult {
  /**
   * A matched filter carried a `suppress-automations` action, so the caller
   * should drop the automation handlers from the event fan-out (§3).
   */
  suppressAutomations: boolean
  /** Ids of the filters that actually executed — for logging/telemetry. */
  firedFilterIds: string[]
}

/**
 * Evaluate and fire every enabled filter for one thread. Never throws.
 */
export async function fireMailFilters(input: FireMailFiltersInput): Promise<FireMailFiltersResult> {
  const { db, organizationId, threadId, messageId, thread, inbox, filters, source } = input
  const result: FireMailFiltersResult = { suppressAutomations: false, firedFilterIds: [] }
  if (filters.length === 0) return result

  const chain = filterChain.getStore() ?? { depth: 0, seen: new Set<string>() }
  if (chain.depth >= MAX_FILTER_DEPTH) {
    logger.warn('Mail-filter depth cap hit — skipping nested firings', {
      organizationId,
      threadId,
      depth: chain.depth,
    })
    return result
  }

  let matched: Set<string>
  try {
    matched = await matchFilters(db, organizationId, threadId, filters)
  } catch (error) {
    logger.error('Mail-filter evaluation failed — firing nothing', {
      organizationId,
      threadId,
      filters: filters.length,
      error: error instanceof Error ? error.message : String(error),
    })
    return result
  }
  if (matched.size === 0) return result

  // `filters` arrives sorted by `order`; ordering and `stopProcessing` are
  // applied HERE, in memory, over the matched set (§4.5) — the SQL never
  // encodes filter order.
  for (const filter of filters) {
    if (!matched.has(filter.id)) continue

    const chainKey = `${filter.id}:${threadId}`
    if (chain.seen.has(chainKey)) continue

    try {
      // §4.4 CONTAINMENT — a filter may only act on threads in its OWN inbox.
      // The executor runs as SYSTEM so it bypasses `assertCanActOnThreads`;
      // containment plus the authoring gate (§5.1) is what makes that safe.
      if (thread.inboxId !== filter.inboxId) {
        logger.warn('Mail filter skipped — thread is not in the filter’s inbox', {
          organizationId,
          filterId: filter.id,
          threadId,
          threadInboxId: thread.inboxId,
          filterInboxId: filter.inboxId,
        })
        continue
      }

      // Suppression is decided from the MATCH, independent of the claim: it has
      // no side effect, and a gate retry whose claim no-ops still has to answer
      // the fan-out question the same way the first attempt did.
      if (filter.actions.some((action) => action.type === 'suppress-automations')) {
        result.suppressAutomations = true
      }

      // ⚠️ CLAIM BEFORE EXECUTE (invariant 4). `claimMailFilterRun` inserts the
      // run row with `ON CONFLICT (filterId, messageId, source) DO NOTHING`, so
      // the unique index gates EXECUTION, not merely the audit trail. `null`
      // means another attempt already owns this firing — bail, execute nothing.
      //
      // A refactor that moves this row back to "log after execution" silently
      // reintroduces DOUBLE CUSTOMER REPLIES: the six mail actions are
      // repeat-safe, but `run-agent` / `run-workflow` are not, and a
      // `publishEventJob` retry would enqueue first and no-op the log write
      // second. It will pass every test that only checks the run history.
      const runId = await claimMailFilterRun(db, {
        organizationId,
        filterId: filter.id,
        threadId,
        messageId,
        source,
      })
      if (!runId) {
        logger.debug('Mail filter already fired for this message — skipping execution', {
          organizationId,
          filterId: filter.id,
          messageId,
          source,
        })
        if (filter.stopProcessing) break
        continue
      }

      const actionCtx: MailFilterActionContext = {
        db,
        organizationId,
        threadId,
        messageId,
        filter,
        thread,
        inbox,
        // The executor reads this for exactly one decision: a `retroactive` run
        // refuses `run-agent` / `run-workflow` (D18). See
        // `RETROACTIVE_SKIPPED_ACTION_TYPES`.
        source,
      }

      // Captured BEFORE anything mutates — see `captureUndoState`.
      let undo: Awaited<ReturnType<typeof captureUndoState>> = null
      try {
        undo = await captureUndoState(actionCtx, filter.actions)
      } catch (error) {
        logger.warn('Failed to capture mail-filter undo state — proceeding without undo', {
          organizationId,
          filterId: filter.id,
          threadId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      const outcomes: MailFilterActionOutcome[] = []
      await filterChain.run(
        { depth: chain.depth + 1, seen: new Set([...chain.seen, chainKey]) },
        async () => {
          for (const [actionIndex, action] of filter.actions.entries()) {
            try {
              const outcome = await executeMailFilterAction(action, actionCtx)
              outcomes.push({
                actionIndex,
                type: action.type,
                status: outcome.status,
                ...(outcome.status === 'skipped' ? { error: outcome.reason } : {}),
              })
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
      const status: MailFilterRunStatus =
        failed === 0 ? 'ok' : failed === outcomes.length ? 'failed' : 'partial'

      try {
        await completeMailFilterRun(db, runId, { outcomes, status, undo })
      } catch (error) {
        logger.error('Failed to close out mail-filter run', {
          organizationId,
          filterId: filter.id,
          runId,
          error: error instanceof Error ? error.message : String(error),
        })
      }

      result.firedFilterIds.push(filter.id)

      if (status !== 'ok') {
        logger.warn('Mail filter fired with failed actions', {
          organizationId,
          filterId: filter.id,
          filterName: filter.name,
          status,
          outcomes,
        })
      }
    } catch (error) {
      logger.error('Mail filter execution failed', {
        organizationId,
        filterId: filter.id,
        filterName: filter.name,
        threadId,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    // §4.5 — a matched filter with `stopProcessing` halts the rest, whether its
    // actions succeeded, partially failed, or were already claimed.
    if (filter.stopProcessing) break
  }

  if (result.firedFilterIds.length > 0) {
    try {
      await touchLastFiredAtMany(db, organizationId, result.firedFilterIds)
    } catch (error) {
      logger.warn('Failed to stamp mail-filter lastFiredAt', {
        organizationId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return result
}
