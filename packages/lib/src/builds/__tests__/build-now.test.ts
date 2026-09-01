// packages/lib/src/builds/__tests__/build-now.test.ts
//
// `buildNow` is a composition and nothing else — create -> start -> complete —
// so what is under test is the SEAM between the three, not any arithmetic.
// The three mutations have their own suites; here they are doubles.
//
// The property that matters is the one §3.3 of plans/money/tasks/23 refuses to
// paper over: it is NOT atomic. A refused completion leaves an `in_progress` run
// with no movements written, and that has to come back as a RESULT carrying the
// build rather than as an error — because `errorFormatter` sends the client a
// message and nothing else, and "failed" about a run that exists is what makes
// somebody press the button again and raise a duplicate.

import { err, ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnprocessableEntityError } from '../../errors'
import type { BuildRecord } from '../types'

const ORG = 'org_1'
const USER = 'user_1'
const PART = 'part_lift'
const BUILD = 'build_1'

const h = vi.hoisted(() => ({
  createResult: null as unknown,
  startResult: null as unknown,
  completeResult: null as unknown,
  createCalls: [] as Record<string, unknown>[],
  startCalls: [] as Record<string, unknown>[],
  completeCalls: [] as Record<string, unknown>[],
}))

vi.mock('../build-mutations', () => ({
  createBuild: vi.fn(async (_db, _org, _user, input) => {
    h.createCalls.push(input)
    return h.createResult
  }),
  startBuild: vi.fn(async (_db, _org, _user, input) => {
    h.startCalls.push(input)
    return h.startResult
  }),
}))

vi.mock('../complete-build', () => ({
  completeBuild: vi.fn(async (_db, _org, _user, input) => {
    h.completeCalls.push(input)
    return h.completeResult
  }),
}))

import { buildNow } from '../build-now'

const planned = (over: Partial<BuildRecord> = {}): BuildRecord =>
  ({
    buildId: BUILD,
    recordId: `buildDef:${BUILD}`,
    number: 'B-0042',
    partId: PART,
    status: 'planned',
    quantityPlanned: 5,
    quantityProduced: null,
    quantityScrapped: null,
    startedAt: null,
    completedAt: null,
    materialCost: null,
    laborCost: null,
    overheadCost: null,
    producedValue: null,
    varianceAmount: null,
    postedAt: null,
    notes: null,
    orderId: null,
    source: 'manual',
    reversalOfBuildId: null,
    orderRevision: null,
    ...over,
  }) as BuildRecord

const completion = {
  buildId: BUILD,
  recordId: `buildDef:${BUILD}`,
  quantityProduced: 5,
  quantityScrapped: 0,
  materialCost: 1000,
  laborCost: 0,
  overheadCost: 0,
  producedValue: 1000,
  varianceAmount: 0,
  movementIds: ['mv_1', 'mv_2'],
  recalculatedPartIds: [PART],
}

beforeEach(() => {
  h.createCalls = []
  h.startCalls = []
  h.completeCalls = []
  h.createResult = ok(planned())
  h.startResult = ok(planned({ status: 'in_progress' }))
  h.completeResult = ok(completion)
})

const db = {} as never

describe('the happy path', () => {
  it('walks create -> start -> complete and returns both halves', async () => {
    const result = await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })

    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.status).toBe('completed')
    if (outcome.status !== 'completed') throw new Error('unreachable')
    expect(outcome.build.buildId).toBe(BUILD)
    expect(outcome.completion).toEqual(completion)
  })

  it('plans and produces the SAME quantity', async () => {
    await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })
    expect(h.createCalls[0]).toMatchObject({ partId: PART, quantityPlanned: 5 })
    expect(h.completeCalls[0]).toMatchObject({ buildId: BUILD, quantityProduced: 5 })
  })

  // 🛑 The assertion this makes on the caller's behalf: BOM-standard
  // consumption, zero scrap, effective absorption rates. Sending `laborCost` or
  // `overheadCost` would override the produced part's own rates with a number
  // the browser invented; sending `componentOverrides` would claim the floor
  // consumed something other than the bill of materials. Both are the completion
  // DIALOG's job, which is why the popover keeps a "Plan and open..." verb.
  it('sends no overrides, no scrap and no absorbed amounts', async () => {
    await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })
    const input = h.completeCalls[0]!
    expect(input).not.toHaveProperty('componentOverrides')
    expect(input).not.toHaveProperty('quantityScrapped')
    expect(input).not.toHaveProperty('laborCost')
    expect(input).not.toHaveProperty('overheadCost')
  })

  it('passes the accounting date through when the caller states one', async () => {
    const completedAt = new Date('2026-08-31T00:00:00.000Z')
    await buildNow(db, ORG, USER, { partId: PART, quantity: 5, completedAt })
    expect(h.completeCalls[0]).toMatchObject({ completedAt })
  })

  it('omits notes rather than writing an empty string', async () => {
    await buildNow(db, ORG, USER, { partId: PART, quantity: 5, notes: '' })
    expect(h.createCalls[0]).not.toHaveProperty('notes')
  })
})

describe('createBuild refusing — the arm that wrote nothing', () => {
  it('comes back as an error, because there is no run to recover', async () => {
    const refusal = new UnprocessableEntityError('This part is classified as purchased')
    h.createResult = err(refusal)

    const result = await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBe(refusal)
    expect(h.startCalls).toHaveLength(0)
    expect(h.completeCalls).toHaveLength(0)
  })
})

describe('🛑 it is not atomic, and the result says so', () => {
  it('a refused COMPLETION returns left_in_progress with the build', async () => {
    h.completeResult = err(new UnprocessableEntityError('Feet Bracket has no standard cost'))

    const result = await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })

    // ✅ Ok, not err — the caller has to be able to name and link the run.
    expect(result.isOk()).toBe(true)
    const outcome = result._unsafeUnwrap()
    expect(outcome.status).toBe('left_in_progress')
    if (outcome.status !== 'left_in_progress') throw new Error('unreachable')
    expect(outcome.stage).toBe('complete')
    expect(outcome.build.buildId).toBe(BUILD)
    expect(outcome.build.number).toBe('B-0042')
    expect(outcome.build.recordId).toBe(`buildDef:${BUILD}`)
    // The actual reason survives verbatim — it is what the person has to fix.
    expect(outcome.reason).toBe('Feet Bracket has no standard cost')
  })

  it('carries the STARTED build, so the recovery state is what the run is in', async () => {
    h.completeResult = err(new UnprocessableEntityError('nope'))
    const result = await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })
    const outcome = result._unsafeUnwrap()
    if (outcome.status !== 'left_in_progress') throw new Error('unreachable')
    expect(outcome.build.status).toBe('in_progress')
  })

  it('a refused START stops before the completion, and says which stage', async () => {
    h.startResult = err(new UnprocessableEntityError('Only a planned build can be started'))

    const result = await buildNow(db, ORG, USER, { partId: PART, quantity: 5 })

    const outcome = result._unsafeUnwrap()
    expect(outcome.status).toBe('left_in_progress')
    if (outcome.status !== 'left_in_progress') throw new Error('unreachable')
    expect(outcome.stage).toBe('start')
    expect(h.completeCalls).toHaveLength(0)
  })
})
