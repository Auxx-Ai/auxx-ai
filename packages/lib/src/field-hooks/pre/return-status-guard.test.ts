// packages/lib/src/field-hooks/pre/return-status-guard.test.ts
//
// 🛑 The bug this file exists to prevent is a guard that cannot fire. By the time
// `fireFieldPreHooks` runs, `validateAndConvertValue` has turned a SINGLE_SELECT write into
// `{ type: 'option', optionId: 'received' }` - never the bare string - so a guard comparing
// `event.newValue` to `'received'` passes everything and is indistinguishable from a guard
// nothing has tripped. It reads correctly in review and passes any unit test that only feeds
// it a bare string (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md section 2).
//
// So the transition cases below feed the COERCED envelope the client path actually produces,
// and the bare-string and single-element-array shapes are pinned separately. A version of
// this guard that only understood bare strings would pass the string cases and fail every
// `coerced(...)` one, which is the discrimination this file is for.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { FieldPreHookEvent } from '../types'

const h = vi.hoisted(() => ({ getValues: vi.fn() }))

// The stored-status read is the only thing this guard touches besides its graph.
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    getValues = h.getValues
  },
}))

const { guardReturnLifecycleTransition } = await import('./return-status-guard')
const { RETURN_ENTRY_STATUSES, RETURN_STATUS_TRANSITIONS } = await import(
  '../../resources/hooks/return-hooks'
)

const STATUS_FIELD_ID = 'fld-return-status'
const RECORD_ID = 'defreturn:instreturn1'

beforeEach(() => {
  vi.clearAllMocks()
  h.getValues.mockResolvedValue(new Map())
})

/** The shape `validateAndConvertValue` hands a SINGLE_SELECT pre-hook. */
function coerced(optionId: string) {
  return { type: 'option', optionId }
}

/** What the record already holds: a status, or nothing at all. */
function storedStatusIs(status: string | null) {
  h.getValues.mockResolvedValue(
    new Map(status === null ? [] : [[STATUS_FIELD_ID, { type: 'option', optionId: status }]])
  )
}

function event(newValue: unknown): FieldPreHookEvent {
  return {
    recordId: RECORD_ID,
    entityDefinitionId: 'defreturn',
    entityType: 'return',
    entitySlug: 'returns',
    fieldId: STATUS_FIELD_ID,
    systemAttribute: 'return_status',
    field: { id: STATUS_FIELD_ID, systemAttribute: 'return_status' },
    newValue,
    // Deliberately `undefined`: that is what `fireFieldPreHooks` passes on the
    // single-field path, and it is why this guard reads the stored value itself rather
    // than trusting `existingValue` the way a system hook can trust `existingInstance`.
    existingValue: undefined,
    allValues: new Map<string, unknown>(),
    organizationId: 'org-1',
    userId: 'user-1',
    bypass: new Set(),
  } as unknown as FieldPreHookEvent
}

describe('return_status transition wall, on the coerced shape', () => {
  it.each(RETURN_ENTRY_STATUSES)('lets a record with no status yet start at %s', async (status) => {
    storedStatusIs(null)

    await expect(guardReturnLifecycleTransition(event(coerced(status)))).resolves.toEqual(
      coerced(status)
    )
  })

  it.each([
    'approved',
    'in_transit',
    'inspected',
    'closed',
    'declined',
    'cancelled',
  ])('refuses a first status of %s', async (status) => {
    storedStatusIs(null)

    await expect(guardReturnLifecycleTransition(event(coerced(status)))).rejects.toThrow(
      /starts at requested or received/
    )
  })

  it('allows a legal step along the spine', async () => {
    storedStatusIs('approved')

    await expect(guardReturnLifecycleTransition(event(coerced('in_transit')))).resolves.toEqual(
      coerced('in_transit')
    )
  })

  it('allows an off-ramp to declined from requested', async () => {
    storedStatusIs('requested')

    await expect(guardReturnLifecycleTransition(event(coerced('declined')))).resolves.toBeTruthy()
  })

  // 🛑 The case that makes the whole file worth writing: from the drawer, against the
  // COERCED envelope. This is the shape the warehouse's own edit produces.
  it('refuses a skip over the spine', async () => {
    storedStatusIs('requested')

    await expect(guardReturnLifecycleTransition(event(coerced('closed')))).rejects.toThrow(
      /cannot move from requested to closed/
    )
  })

  it('refuses a move backwards', async () => {
    storedStatusIs('inspected')

    await expect(guardReturnLifecycleTransition(event(coerced('received')))).rejects.toThrow(
      /cannot move from inspected to received/
    )
  })

  it.each(['closed', 'declined', 'cancelled'])('treats %s as final', async (terminal) => {
    storedStatusIs(terminal)

    await expect(guardReturnLifecycleTransition(event(coerced('requested')))).rejects.toThrow(
      /it is a final state/
    )
  })

  it('allows an idempotent re-save of the same value', async () => {
    storedStatusIs('received')

    await expect(guardReturnLifecycleTransition(event(coerced('received')))).resolves.toBeTruthy()
  })
})

describe('the shapes this chain delivers', () => {
  // A guard that only understood the envelope would be half-dead the moment a caller
  // writes an already-typed value; one that only understood strings is the inert guard
  // section 2 is about. Both are covered, on the same illegal edge.
  it('refuses a bare string too', async () => {
    storedStatusIs('requested')

    await expect(guardReturnLifecycleTransition(event('closed'))).rejects.toThrow(
      /cannot move from requested to closed/
    )
  })

  it('refuses a single-element array of either shape', async () => {
    storedStatusIs('requested')
    await expect(guardReturnLifecycleTransition(event([coerced('closed')]))).rejects.toThrow(
      /cannot move from requested to closed/
    )

    storedStatusIs('requested')
    await expect(guardReturnLifecycleTransition(event(['closed']))).rejects.toThrow(
      /cannot move from requested to closed/
    )
  })

  it('lets a clear through rather than treating null as a status', async () => {
    storedStatusIs('requested')

    await expect(guardReturnLifecycleTransition(event(null))).resolves.toBeNull()
    expect(h.getValues).not.toHaveBeenCalled()
  })

  it('returns the value untouched - it is a guard, not a transform', async () => {
    storedStatusIs('approved')
    const next = coerced('in_transit')

    await expect(guardReturnLifecycleTransition(event(next))).resolves.toBe(next)
  })
})

describe('failing open', () => {
  it('allows the write when the stored status cannot be read', async () => {
    h.getValues.mockRejectedValue(new Error('connection reset'))

    await expect(guardReturnLifecycleTransition(event(coerced('closed')))).resolves.toBeTruthy()
  })

  it('allows the write when the stored status is not in the graph', async () => {
    storedStatusIs('something_a_migration_left_behind')

    await expect(guardReturnLifecycleTransition(event(coerced('closed')))).resolves.toBeTruthy()
  })
})

describe('one graph, two doors', () => {
  it('reads the same transition table the system hook enforces', () => {
    // Not a restatement of the graph - the point is that this file imports it. If the
    // guard ever grew its own copy, this pair would drift and nothing else would say so.
    expect(RETURN_STATUS_TRANSITIONS.requested).toContain('approved')
    expect(RETURN_STATUS_TRANSITIONS.closed).toEqual([])
    expect([...RETURN_ENTRY_STATUSES]).toEqual(['requested', 'received'])
  })
})
