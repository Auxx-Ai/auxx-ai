// packages/lib/src/mail-classification/second-pass.test.ts
// The §4.1 pass-2 table, asserted against the REAL `fireMailFilters` with a
// faithful stand-in for the claim's unique `(filterId, messageId, source)` index:
//
//   | On pass 2                              | What must happen                    |
//   | -------------------------------------- | ----------------------------------- |
//   | filter fired on pass 1                 | bails on its claim, executes nothing |
//   | category filter that missed on pass 1  | claims and fires                     |
//
// The whole feature rests on this being true with `source: 'live'` reused, so it
// is tested here rather than being taken on trust from the plan's prose. A
// `source: 'classification'` arm gives every already-fired filter a fresh key —
// the last test in this file is what fails when someone "tidies" that.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedMailFilter, MailFilterAction } from '../mail-filters/types'

const h = vi.hoisted(() => ({
  matchFilters: vi.fn(),
  execute: vi.fn(),
  captureUndo: vi.fn(),
  complete: vi.fn(),
  touch: vi.fn(),
  /** Stands in for the unique index on (filterId, messageId, source). */
  claims: new Set<string>(),
}))

vi.mock('../mail-filters/evaluate', () => ({ matchFilters: h.matchFilters }))
vi.mock('../mail-filters/runs', () => ({
  // `INSERT … ON CONFLICT (filterId, messageId, source) DO NOTHING`: a null
  // return means another attempt already owns this firing.
  claimMailFilterRun: vi.fn(
    async (_db: unknown, input: { filterId: string; messageId: string; source: string }) => {
      const key = `${input.filterId}:${input.messageId}:${input.source}`
      if (h.claims.has(key)) return null
      h.claims.add(key)
      return `run_${h.claims.size}`
    }
  ),
  completeMailFilterRun: h.complete,
}))
vi.mock('../mail-filters/actions', () => ({
  executeMailFilterAction: h.execute,
  captureUndoState: h.captureUndo,
}))
vi.mock('../mail-filters/mutations', () => ({ touchLastFiredAtMany: h.touch }))

import { fireMailFilters } from '../mail-filters/engine'

function filter(id: string, overrides: Partial<CachedMailFilter> = {}): CachedMailFilter {
  return {
    id,
    inboxId: 'ibx_1',
    name: id,
    order: 0,
    stopProcessing: false,
    enabled: true,
    conditions: [],
    actions: [{ type: 'assign', assigneeId: 'usr_1' }] as MailFilterAction[],
    templateKey: null,
    ...overrides,
  } as CachedMailFilter
}

const baseInput = {
  db: {} as never,
  organizationId: 'org_1',
  threadId: 'thr_1',
  messageId: 'msg_1',
  thread: { inboxId: 'ibx_1', status: 'OPEN', assigneeId: null },
  inbox: { id: 'ibx_1', isPersonal: false, ownerUserId: null },
  source: 'live' as const,
}

/** `from is stripe.com → add-tag Billing` — matches on both passes. */
const SENDER_FILTER = filter('flt_sender')
/** `tag is Billing → assign to Finance` — only matches once the tag exists. */
const CATEGORY_FILTER = filter('flt_category', { order: 1 })

beforeEach(() => {
  vi.clearAllMocks()
  h.claims.clear()
  h.execute.mockResolvedValue({ status: 'ok' })
  h.captureUndo.mockResolvedValue(null)
  h.complete.mockResolvedValue(undefined)
  h.touch.mockResolvedValue(undefined)
})

describe('§4.1 — the full-set re-run over the run claim', () => {
  it('a filter that already fired does NOT fire twice, and a category filter that missed pass 1 DOES fire on pass 2', async () => {
    const filters = [SENDER_FILTER, CATEGORY_FILTER]

    // Pass 1 (the gate): only the sender filter matches — the tag does not exist yet.
    h.matchFilters.mockResolvedValueOnce(new Set(['flt_sender']))
    const pass1 = await fireMailFilters({ ...baseInput, filters })
    expect(pass1.firedFilterIds).toEqual(['flt_sender'])
    expect(h.execute).toHaveBeenCalledTimes(1)

    h.execute.mockClear()

    // Pass 2 (post-classification): the classifier applied `Billing`, so BOTH
    // match. The full set is re-run — no category-referencing subset.
    h.matchFilters.mockResolvedValueOnce(new Set(['flt_sender', 'flt_category']))
    const pass2 = await fireMailFilters({ ...baseInput, filters })

    // The already-fired filter bailed on its claim BEFORE acting…
    expect(pass2.firedFilterIds).toEqual(['flt_category'])
    // …so exactly one action ran on pass 2, and it was the category filter's.
    expect(h.execute).toHaveBeenCalledTimes(1)
    expect(h.execute.mock.calls[0]?.[1]?.filter.id).toBe('flt_category')
  })

  it('⚠️ a distinct `source` arm re-fires the lot — including `run-agent`', async () => {
    const runAgent = filter('flt_agent', {
      actions: [{ type: 'run-agent', agentId: 'a', agentTriggerId: 't' }] as MailFilterAction[],
    })
    h.matchFilters.mockResolvedValue(new Set(['flt_agent']))

    await fireMailFilters({ ...baseInput, filters: [runAgent] })
    expect(h.execute).toHaveBeenCalledTimes(1)

    // What `rerun-filters.ts` actually does — same source, so the claim holds.
    await fireMailFilters({ ...baseInput, filters: [runAgent], source: 'live' })
    expect(h.execute).toHaveBeenCalledTimes(1)

    // What a "tidy it into its own source" refactor would do: a fresh claim key,
    // and a second agent reply to the customer. This assertion documents the
    // failure mode — it is why `rerun-filters.ts` reuses `'live'`.
    await fireMailFilters({ ...baseInput, filters: [runAgent], source: 'retroactive' })
    expect(h.execute).toHaveBeenCalledTimes(2)
  })

  it('honors `stopProcessing` on pass 2 even when the stopping filter bails on its claim', async () => {
    const stopper = filter('flt_stop', { order: 0, stopProcessing: true })
    const below = filter('flt_below', { order: 1 })
    const filters = [stopper, below]

    h.matchFilters.mockResolvedValueOnce(new Set(['flt_stop']))
    await fireMailFilters({ ...baseInput, filters })

    h.execute.mockClear()
    h.matchFilters.mockResolvedValueOnce(new Set(['flt_stop', 'flt_below']))
    const pass2 = await fireMailFilters({ ...baseInput, filters })

    // The halt is honored (plan §4.1 recommendation): a user who wrote "stop
    // processing" meant it, and filter order must mean the same thing on both
    // passes. The cost is `flt_below` never getting its chance — pass 1 already
    // pays that same cost.
    expect(pass2.firedFilterIds).toEqual([])
    expect(h.execute).not.toHaveBeenCalled()
  })
})
