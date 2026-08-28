// packages/lib/src/money/__tests__/quote-lifecycle.test.ts
//
// 🛑 The regression this file exists to prevent: `quote_status` is guarded on BOTH hook
// chains and the two are cleared by DIFFERENT mechanisms. Writing through
// `FieldValueService` instead of `UnifiedCrudHandler` clears the system pre-hook
// structurally — `runPreHooks` never runs. It does NOT clear the field pre-hook, which fires
// on exactly these writes; only `bypassFieldGuards` does
// (plans/dispatch/money/21-lifecycle-status-guards-are-inert.md §4).
//
// Drop the bypass and Send stops working: the wall built to protect the action refuses it.
// Nothing about that is visible until somebody presses the button, which is why the two
// halves of that plan had to land in one commit and why they are asserted together here.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  bySystemAttributes: vi.fn(),
  getFieldValues: vi.fn(),
  listFiltered: vi.fn(),
  setValuesForEntity: vi.fn(),
  /** Constructor arguments every `FieldValueService` was built with. */
  fieldValueServiceArgs: [] as unknown[][],
}))

vi.mock('../../cache', () => ({
  getOrgCache: () => ({ from: () => ({ bySystemAttributes: h.bySystemAttributes }) }),
}))
vi.mock('../../resources/crud', () => ({
  UnifiedCrudHandler: class {
    getFieldValues = h.getFieldValues
    listFiltered = h.listFiltered
  },
}))
vi.mock('../../field-values/field-value-service', () => ({
  FieldValueService: class {
    constructor(...args: unknown[]) {
      h.fieldValueServiceArgs.push(args)
    }
    setValuesForEntity = h.setValuesForEntity
  },
}))

const { approveQuote, declineQuote, markQuoteSent } = await import('../quote-lifecycle')
const { BadRequestError } = await import('../../errors')

const ORG = 'org-1'
const USER = 'user-1'
const QUOTE = 'quote-1'

const STATUS_FIELD = { id: 'f-quote-status' }
const REQUEST_FIELD = { id: 'f-quote-request' }

/** The quote's own field values, as `getFieldValues` returns them (coerced shapes). */
function wireQuote(status: string, requestInstanceId?: string) {
  h.bySystemAttributes.mockResolvedValue({
    quote_status: STATUS_FIELD,
    quote_request: REQUEST_FIELD,
  })
  const map = new Map<string, unknown>()
  map.set(STATUS_FIELD.id, { type: 'option', optionId: status })
  if (requestInstanceId) {
    map.set(REQUEST_FIELD.id, {
      type: 'relationship',
      recordId: `service_request:${requestInstanceId}`,
    })
  }
  h.getFieldValues.mockResolvedValue(map)
}

/** The bypass set the Nth `FieldValueService` was constructed with. */
function bypassOf(index = 0): ReadonlySet<string> | undefined {
  const options = h.fieldValueServiceArgs[index]?.[4] as
    | { bypassFieldGuards?: ReadonlySet<string> }
    | undefined
  return options?.bypassFieldGuards
}

beforeEach(() => {
  vi.clearAllMocks()
  h.fieldValueServiceArgs = []
})

const ACTIONS = [
  { name: 'markQuoteSent', run: markQuoteSent, from: 'draft', writes: 'sent' },
  { name: 'approveQuote', run: approveQuote, from: 'sent', writes: 'approved' },
  { name: 'declineQuote', run: declineQuote, from: 'sent', writes: 'declined' },
] as const

describe.each(ACTIONS)('$name — the status write', (action) => {
  it(`writes ${action.writes} from ${action.from}`, async () => {
    wireQuote(action.from)
    await action.run({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect(h.setValuesForEntity.mock.calls[0]?.[0]?.values).toEqual([
      { fieldId: 'quote_status', value: action.writes },
    ])
  })

  it('refuses to run from the wrong status', async () => {
    wireQuote('canceled')
    await expect(
      action.run({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    ).rejects.toThrow(BadRequestError)
  })
})

describe.each(ACTIONS)('$name — clearing its own guards', (action) => {
  // The whole mechanism. `fireFieldPreHooks` short-circuits on
  // `ctx.bypassFieldGuards.has(systemAttribute)` before any handler runs, so naming the
  // attribute here is what lets the sanctioned writer past its own wall.
  it('passes bypassFieldGuards for quote_status', async () => {
    wireQuote(action.from)
    await action.run({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect([...(bypassOf() ?? [])]).toEqual(['quote_status'])
  })

  // Naming more than the one attribute would quietly disarm guards on fields these actions
  // have no business writing — `markPurchaseOrderSent`'s bypass is scoped the same way.
  it('bypasses that one attribute and nothing else', async () => {
    wireQuote(action.from)
    await action.run({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect(bypassOf()?.size).toBe(1)
  })
})

describe('the request mirror', () => {
  // The reason `sent` and `approved` are guarded at all: a typed status skips this write and
  // leaves the request sitting in the pipeline for a quote that has already been answered.
  it.each([
    { name: 'markQuoteSent', run: markQuoteSent, from: 'draft', mirrors: 'quoted' },
    { name: 'approveQuote', run: approveQuote, from: 'sent', mirrors: 'approved' },
  ])('$name mirrors the linked request to $mirrors', async (spec) => {
    wireQuote(spec.from, 'req-1')
    await spec.run({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect(h.setValuesForEntity.mock.calls[1]?.[0]?.values).toEqual([
      { fieldId: 'service_request_status', value: spec.mirrors },
    ])
  })

  // 🛑 The mirror rides the SAME service, so it inherits the bypass. That is only safe
  // because the set names `quote_status` — an attribute the request does not have. A wider
  // set would silently exempt this second write from whatever guards the request carries.
  it('cannot disarm a guard on the request, because the set names a quote attribute', async () => {
    wireQuote('draft', 'req-1')
    await markQuoteSent({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect(bypassOf()?.has('service_request_status')).toBe(false)
  })

  it('declineQuote deliberately mirrors nothing', async () => {
    wireQuote('sent', 'req-1')
    await declineQuote({ organizationId: ORG, userId: USER, quoteInstanceId: QUOTE })
    expect(h.setValuesForEntity).toHaveBeenCalledTimes(1)
  })
})
