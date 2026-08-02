// packages/lib/src/mail-filters/engine.test.ts
// The three properties that make SYSTEM-principal execution safe:
// containment (§4.4), claim-before-execute (§3 / invariant 4) and stopProcessing
// (§4.5). Everything else the engine does is logging.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CachedMailFilter, MailFilterAction } from './types'

const h = vi.hoisted(() => ({
  matchFilters: vi.fn(),
  claim: vi.fn(),
  complete: vi.fn(),
  execute: vi.fn(),
  captureUndo: vi.fn(),
  touch: vi.fn(),
}))

vi.mock('./evaluate', () => ({ matchFilters: h.matchFilters }))
vi.mock('./runs', () => ({
  claimMailFilterRun: h.claim,
  completeMailFilterRun: h.complete,
}))
vi.mock('./actions', () => ({
  executeMailFilterAction: h.execute,
  captureUndoState: h.captureUndo,
}))
vi.mock('./mutations', () => ({ touchLastFiredAtMany: h.touch }))

import { fireMailFilters } from './engine'

function filter(overrides: Partial<CachedMailFilter> & { id: string }): CachedMailFilter {
  return {
    inboxId: 'ibx_1',
    name: overrides.id,
    order: 0,
    stopProcessing: false,
    enabled: true,
    conditions: [],
    actions: [{ type: 'set-status', status: 'ARCHIVED' }] as MailFilterAction[],
    templateKey: null,
    ...overrides,
  }
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

beforeEach(() => {
  vi.clearAllMocks()
  h.claim.mockResolvedValue('run_1')
  h.complete.mockResolvedValue(undefined)
  h.execute.mockResolvedValue({ status: 'ok' })
  h.captureUndo.mockResolvedValue(null)
  h.touch.mockResolvedValue(undefined)
})

describe('fireMailFilters — containment (§4.4)', () => {
  it('executes NOTHING for a filter whose inbox differs from the thread’s', async () => {
    const foreign = filter({ id: 'flt_x', inboxId: 'ibx_other' })
    h.matchFilters.mockResolvedValue(new Set(['flt_x']))

    const result = await fireMailFilters({ ...baseInput, filters: [foreign] })

    expect(h.claim).not.toHaveBeenCalled()
    expect(h.execute).not.toHaveBeenCalled()
    expect(result.firedFilterIds).toEqual([])
  })

  it('still fires the contained filters beside a foreign one', async () => {
    const foreign = filter({ id: 'flt_x', inboxId: 'ibx_other' })
    const mine = filter({ id: 'flt_a' })
    h.matchFilters.mockResolvedValue(new Set(['flt_x', 'flt_a']))

    const result = await fireMailFilters({ ...baseInput, filters: [foreign, mine] })

    expect(result.firedFilterIds).toEqual(['flt_a'])
  })
})

describe('fireMailFilters — the claim gates EXECUTION (§3, invariant 4)', () => {
  it('runs no actions when the claim is already held', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a']))
    h.claim.mockResolvedValue(null)

    const result = await fireMailFilters({ ...baseInput, filters: [filter({ id: 'flt_a' })] })

    expect(h.execute).not.toHaveBeenCalled()
    expect(h.complete).not.toHaveBeenCalled()
    expect(result.firedFilterIds).toEqual([])
  })

  it('claims BEFORE executing — a "log afterwards" refactor double-replies', async () => {
    const order: string[] = []
    h.matchFilters.mockResolvedValue(new Set(['flt_a']))
    h.claim.mockImplementation(async () => {
      order.push('claim')
      return 'run_1'
    })
    h.captureUndo.mockImplementation(async () => {
      order.push('undo')
      return null
    })
    h.execute.mockImplementation(async () => {
      order.push('execute')
      return { status: 'ok' }
    })

    await fireMailFilters({
      ...baseInput,
      filters: [
        filter({
          id: 'flt_a',
          actions: [{ type: 'run-agent', agentId: 'a', agentTriggerId: 't' }],
        }),
      ],
    })

    // Undo capture must also precede execution or it stores post-action state.
    expect(order).toEqual(['claim', 'undo', 'execute'])
  })

  it('records per-action outcomes and closes the run out', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a']))
    h.execute
      .mockResolvedValueOnce({ status: 'ok' })
      .mockResolvedValueOnce({ status: 'skipped', reason: 'nope' })

    await fireMailFilters({
      ...baseInput,
      filters: [
        filter({
          id: 'flt_a',
          actions: [
            { type: 'set-status', status: 'ARCHIVED' },
            { type: 'set-read', read: true },
          ],
        }),
      ],
    })

    expect(h.complete).toHaveBeenCalledWith({}, 'run_1', {
      status: 'ok',
      undo: null,
      outcomes: [
        { actionIndex: 0, type: 'set-status', status: 'ok' },
        { actionIndex: 1, type: 'set-read', status: 'skipped', error: 'nope' },
      ],
    })
  })

  it('continue-and-report: a throwing action never blocks the rest', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a']))
    h.execute.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce({ status: 'ok' })

    await fireMailFilters({
      ...baseInput,
      filters: [
        filter({
          id: 'flt_a',
          actions: [
            { type: 'set-status', status: 'ARCHIVED' },
            { type: 'assign', assigneeId: 'usr_1' },
          ],
        }),
      ],
    })

    expect(h.execute).toHaveBeenCalledTimes(2)
    expect(h.complete.mock.calls[0]?.[2]?.status).toBe('partial')
  })
})

describe('fireMailFilters — ordering and stop (§4.5)', () => {
  it('halts the remaining filters when a matched filter sets stopProcessing', async () => {
    const first = filter({ id: 'flt_a', order: 0, stopProcessing: true })
    const second = filter({ id: 'flt_b', order: 1 })
    h.matchFilters.mockResolvedValue(new Set(['flt_a', 'flt_b']))

    const result = await fireMailFilters({ ...baseInput, filters: [first, second] })

    expect(result.firedFilterIds).toEqual(['flt_a'])
    expect(h.claim).toHaveBeenCalledTimes(1)
  })

  it('halts even when the stopping filter was already claimed by another attempt', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a', 'flt_b']))
    h.claim.mockResolvedValue(null)

    await fireMailFilters({
      ...baseInput,
      filters: [filter({ id: 'flt_a', stopProcessing: true }), filter({ id: 'flt_b' })],
    })

    expect(h.claim).toHaveBeenCalledTimes(1)
  })

  it('reports suppress-automations from the MATCH, not from execution', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a']))
    // Claim already held: the actions do not re-run, but the fan-out question
    // still has to be answered the same way the first attempt answered it.
    h.claim.mockResolvedValue(null)

    const result = await fireMailFilters({
      ...baseInput,
      filters: [filter({ id: 'flt_a', actions: [{ type: 'suppress-automations' }] })],
    })

    expect(result.suppressAutomations).toBe(true)
  })
})

describe('fireMailFilters — never throws', () => {
  it('swallows an evaluation failure and fires nothing', async () => {
    h.matchFilters.mockRejectedValue(new Error('db down'))

    await expect(
      fireMailFilters({ ...baseInput, filters: [filter({ id: 'flt_a' })] })
    ).resolves.toEqual({ suppressAutomations: false, firedFilterIds: [] })
    expect(h.execute).not.toHaveBeenCalled()
  })

  it('swallows a claim failure and keeps going with the next filter', async () => {
    h.matchFilters.mockResolvedValue(new Set(['flt_a', 'flt_b']))
    h.claim.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue('run_2')

    const result = await fireMailFilters({
      ...baseInput,
      filters: [filter({ id: 'flt_a' }), filter({ id: 'flt_b' })],
    })

    expect(result.firedFilterIds).toEqual(['flt_b'])
  })
})
