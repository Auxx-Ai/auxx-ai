// packages/lib/src/bom/resync-tariff-starters.test.ts
// 35 §9: the catalogue diff, its per-code authority spelling, and the
// partially-completable apply.
//
// 🛑 The test that matters is `keeps each code's own spelling`. Two codes carry
// the SAME Chapter 99 heading spelled two different ways, and the additions have
// to take each code's own. Resolving the spelling once for the action and
// reusing it - 35 §3.1's bug - passes every single-code test in this file and
// fails only that one, which is the whole reason it uses two codes.

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StarterAction } from './tariff-starters'
import type { TariffRateRow } from './vendor-cost'

const h = vi.hoisted(() => ({
  tariffCodeDefId: 'tariff_code_def' as string | undefined,
  tariffRateDefId: 'tariff_rate_def' as string | undefined,
  fields: {
    tariff_code_code: { id: 'f_code' },
    tariff_code_country: { id: 'f_country' },
  } as Record<string, { id: string } | null>,
  /** What `loadTariffCodeRows`'s query resolves to. */
  codeRows: [] as Array<{ instanceId: string; code: string | null; country: string | null }>,
  /** What `loadTariffSchedule` resolves to. Mutated by the fake writer. */
  schedule: new Map<string, TariffRateRow[]>(),
  createCalls: [] as Array<{ entityDefinitionId: string; values: Record<string, unknown> }>,
  /** Instance ids whose FIRST rate create throws, to drive a partial apply. */
  failOnCode: new Set<string>(),
  /** Columns handed to drizzle's `isNull`, so the archived filter is provable. */
  isNullColumns: [] as unknown[],
  nextRateId: 0,
}))

vi.mock('@auxx/database', () => ({
  schema: {
    EntityInstance: {
      id: 'id',
      organizationId: 'organizationId',
      entityDefinitionId: 'entityDefinitionId',
      archivedAt: 'archivedAt',
    },
    FieldValue: {
      entityId: 'entityId',
      fieldId: 'fieldId',
      organizationId: 'organizationId',
      valueText: 'valueText',
      optionId: 'optionId',
    },
  },
}))

vi.mock('drizzle-orm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('drizzle-orm')>()
  return {
    ...actual,
    // Archived codes are excluded in SQL, so the only honest way to test the
    // rule from a doubled db is to prove the predicate is built at all.
    isNull: (column: unknown) => {
      h.isNullColumns.push(column)
      return actual.isNull(column as never)
    },
  }
})

vi.mock('drizzle-orm/pg-core', () => ({
  alias: (table: unknown) => table,
}))

vi.mock('../cache', () => ({
  getCachedEntityDefId: async (_orgId: string, entityType: string) =>
    entityType === 'tariff_code' ? h.tariffCodeDefId : h.tariffRateDefId,
  getOrgCache: () => ({
    from: () => ({
      bySystemAttributes: async (attrs: readonly string[]) =>
        Object.fromEntries(attrs.map((a) => [a, h.fields[a] ?? null])),
    }),
  }),
}))

vi.mock('../resources/crud', () => {
  class FakeUnifiedCrudHandler {
    constructor(
      private organizationId: string,
      private userId: string,
      private db: unknown
    ) {}

    async create(entityDefinitionId: string, values: Record<string, unknown>) {
      const codeRecordId = String(values.tariff_rate_tariff_code ?? '')
      const instanceId = codeRecordId.split(':')[1] ?? ''
      if (h.failOnCode.has(instanceId)) {
        throw new Error(`boom writing ${instanceId}`)
      }
      h.createCalls.push({ entityDefinitionId, values })

      // The written row joins the schedule, so a second plan sees it and a
      // re-derived apply has nothing left to insert.
      h.nextRateId += 1
      const bucket = h.schedule.get(instanceId) ?? []
      bucket.push({
        id: `rate_written_${h.nextRateId}`,
        authority: (values.tariff_rate_authority as string | undefined) ?? null,
        rate: values.tariff_rate_rate as number,
        effectiveFrom: values.tariff_rate_effective_from as string,
        chapter99Code: (values.tariff_rate_chapter99_code as string | undefined) ?? null,
      })
      h.schedule.set(instanceId, bucket)

      return { instance: { id: `inst_${h.nextRateId}` }, recordId: `x:${h.nextRateId}`, values }
    }
  }

  return { UnifiedCrudHandler: FakeUnifiedCrudHandler }
})

vi.mock('./tariff-hts-general', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./tariff-hts-general')>()
  return {
    ...actual,
    loadHtsGeneral: async () => ({
      fetchedAt: '2026-09-01',
      source: 'test',
      nodes: [],
      lines: [
        ['8501.40.40.20', 4, 'AC motors, other'],
        ['8503.00.95.20', 3, 'Parts of motors'],
      ],
    }),
  }
})

vi.mock('./tariff-301-memberships', () => ({
  loadTariffMemberships: async () => ({
    '8501.40.40': ['301-3'],
    '8503.00.95': ['301-3'],
  }),
}))

vi.mock('./tariff-schedule', () => ({
  loadTariffSchedule: async (_db: unknown, _org: string, ids?: readonly string[]) => {
    const wanted = ids ? new Set(ids) : null
    const out = new Map<string, TariffRateRow[]>()
    for (const [id, rows] of h.schedule) {
      if (wanted && !wanted.has(id)) continue
      out.set(id, [...rows])
    }
    return out
  },
  readBookTimeZone: async () => 'UTC',
}))

import { BadRequestError, NotFoundError } from '../errors'
import {
  applyTariffResync,
  MFN_ACTION_KEY,
  planTariffResync,
  type ResyncPlan,
} from './resync-tariff-starters'
import { resolveTariffRate } from './vendor-cost'

const ORG = 'org_1'
const USER = 'user_1'
const NOW = new Date('2026-09-01T12:00:00.000Z')

/**
 * The hand-kept half, cut down to two actions. Injected rather than using the
 * real `TARIFF_ACTIONS` so a test can add a step or an expiry without the
 * assertions drifting the next time the real catalogue is corrected.
 */
const ACTIONS: Record<string, StarterAction> = {
  '301-3': {
    authority: 'Section 301 List 3',
    country: 'CN',
    chapter99Code: '9903.88.03',
    covers: 'listed',
    steps: [
      ['2018-09-24', 10],
      ['2019-05-10', 25],
    ],
  },
  'ieepa-fentanyl-cn': {
    authority: 'IEEPA fentanyl',
    country: 'CN',
    chapter99Code: '9903.01.24',
    covers: 'all',
    steps: [
      ['2025-02-04', 10],
      ['2025-03-04', 20],
    ],
  },
}

/** The same table with one more List 3 step, i.e. a catalogue correction. */
const ACTIONS_WITH_NEW_STEP: Record<string, StarterAction> = {
  ...ACTIONS,
  '301-3': {
    ...(ACTIONS['301-3'] as StarterAction),
    steps: [...ACTIONS['301-3']!.steps, ['2026-06-10', 30]],
  },
}

/** The same table with the IEEPA action terminated by an explicit `0` (§3.3). */
const ACTIONS_WITH_EXPIRY: Record<string, StarterAction> = {
  ...ACTIONS,
  'ieepa-fentanyl-cn': {
    ...(ACTIONS['ieepa-fentanyl-cn'] as StarterAction),
    steps: [...ACTIONS['ieepa-fentanyl-cn']!.steps, ['2026-02-24', 0]],
  },
}

let rateId = 0
function rate(
  authority: string | null,
  ratePercent: number,
  effectiveFrom: string,
  chapter99Code: string | null
): TariffRateRow {
  rateId += 1
  return { id: `rate_${rateId}`, authority, rate: ratePercent, effectiveFrom, chapter99Code }
}

/**
 * The rows `adoptTariffStarters` would have written for a CN code under
 * {@link ACTIONS}, with the List 3 authority spelled however the org spells it.
 */
function adoptedCnRows(mfnRate: number, list3Authority: string | null = 'Section 301 List 3') {
  return [
    rate(null, mfnRate, '1995-01-01', null),
    rate(list3Authority, 10, '2018-09-24', '9903.88.03'),
    rate(list3Authority, 25, '2019-05-10', '9903.88.03'),
    rate('IEEPA fentanyl', 10, '2025-02-04', '9903.01.24'),
    rate('IEEPA fentanyl', 20, '2025-03-04', '9903.01.24'),
  ]
}

const db = {
  transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
    // Rollback, modelled: a code is whole or nothing (§5.1), so a throw must
    // undo the rows the fake writer already appended.
    const calls = h.createCalls.length
    const snapshot = new Map([...h.schedule].map(([id, rows]) => [id, [...rows]]))
    try {
      return await fn({})
    } catch (error) {
      h.createCalls.length = calls
      h.schedule = snapshot
      throw error
    }
  },
  select: () => ({
    from: () => ({
      innerJoin: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(h.codeRows) }),
      }),
    }),
  }),
} as never

function actionOf(plan: ResyncPlan, actionKey: string) {
  const action = plan.actions.find((entry) => entry.actionKey === actionKey)
  expect(action, `expected an action ${actionKey}`).toBeDefined()
  return action!
}

function codeOf(plan: ResyncPlan, actionKey: string, codeInstanceId: string) {
  const entry = actionOf(plan, actionKey).codes.find(
    (candidate) => candidate.codeInstanceId === codeInstanceId
  )
  expect(entry, `expected ${codeInstanceId} under ${actionKey}`).toBeDefined()
  return entry!
}

beforeEach(() => {
  vi.clearAllMocks()
  h.tariffCodeDefId = 'tariff_code_def'
  h.tariffRateDefId = 'tariff_rate_def'
  h.fields = {
    tariff_code_code: { id: 'f_code' },
    tariff_code_country: { id: 'f_country' },
  }
  h.codeRows = []
  h.schedule = new Map()
  h.createCalls = []
  h.failOnCode = new Set()
  h.isNullColumns = []
  h.nextRateId = 0
  rateId = 0
})

describe('planTariffResync', () => {
  it('plans nothing for an org whose rows already match the catalogue', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4))

    const result = await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })

    const plan = result._unsafeUnwrap()
    expect(plan.actions).toEqual([])
    expect(plan.diverged).toEqual([])
  })

  it('plans one addition on every code carrying the heading, under ONE action', async () => {
    h.codeRows = [
      { instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' },
      { instanceId: 'code_b', code: '8503.00.95.20', country: 'CN' },
    ]
    h.schedule.set('code_a', adoptedCnRows(4))
    h.schedule.set('code_b', adoptedCnRows(3))

    const result = await planTariffResync(db, ORG, undefined, {
      actions: ACTIONS_WITH_NEW_STEP,
      now: NOW,
    })

    const plan = result._unsafeUnwrap()
    expect(plan.actions).toHaveLength(1)
    const action = actionOf(plan, '301-3')
    expect(action.authority).toBe('Section 301 List 3')
    expect(action.chapter99Code).toBe('9903.88.03')
    expect(action.codes).toHaveLength(2)
    for (const entry of action.codes) {
      expect(entry.additions).toHaveLength(1)
      expect(entry.additions[0]?.effectiveFrom).toBe('2026-06-10')
      expect(entry.additions[0]?.rate).toBe(30)
      // 4 (or 3) + 25 + 20 before; the List 3 step moves 25 -> 30.
      expect(entry.after - entry.before).toBe(5)
    }
  })

  it('🛑 keeps each code OWN authority spelling, so a renamed code gains no second group', async () => {
    // The §3.1 case. `code_b` renamed its List 3 rows to `301`; `code_a` did
    // not. One spelling resolved for the action and reused would put `code_b`'s
    // new step in a SECOND authority group and double its List 3 contribution.
    h.codeRows = [
      { instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' },
      { instanceId: 'code_b', code: '8503.00.95.20', country: 'CN' },
    ]
    h.schedule.set('code_a', adoptedCnRows(4, 'Section 301 List 3'))
    h.schedule.set('code_b', adoptedCnRows(3, '301'))

    const result = await planTariffResync(db, ORG, undefined, {
      actions: ACTIONS_WITH_NEW_STEP,
      now: NOW,
    })
    const plan = result._unsafeUnwrap()

    const a = codeOf(plan, '301-3', 'code_a')
    expect(a.additions[0]?.authority).toBe('Section 301 List 3')
    expect(a.additions[0]?.spellingFromOrg).toBe(false)

    const b = codeOf(plan, '301-3', 'code_b')
    expect(b.additions[0]?.authority).toBe('301')
    expect(b.additions[0]?.spellingFromOrg).toBe(true)

    // The whole point: current + additions still resolves to ONE Section 301
    // component on the renamed code, and the total moves by the step, not by a
    // whole extra action.
    const stored = h.schedule.get('code_b') ?? []
    const after = resolveTariffRate(
      [
        ...stored,
        ...b.additions.map((addition, index) => ({
          id: `~pending:${index}`,
          authority: addition.authority,
          rate: addition.rate,
          effectiveFrom: addition.effectiveFrom,
          chapter99Code: addition.chapter99Code,
        })),
      ],
      NOW,
      'UTC'
    )
    const list3 = after.components.filter((component) => component.chapter99Code === '9903.88.03')
    expect(list3).toHaveLength(1)
    expect(list3[0]?.rate).toBe(30)
    // base 3 + List 3 30 + IEEPA 20. A second group would have made it 55.
    expect(after.rate).toBe(53)
    expect(b.after).toBe(53)
    expect(b.before).toBe(48)
  })

  it('gives a code with no row for the heading the full step history, in OUR spelling', async () => {
    // The membership case: seven of the dev org's twelve codes look like this.
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', [
      rate(null, 4, '1995-01-01', null),
      rate('IEEPA fentanyl', 10, '2025-02-04', '9903.01.24'),
      rate('IEEPA fentanyl', 20, '2025-03-04', '9903.01.24'),
    ])

    const result = await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })
    const entry = codeOf(result._unsafeUnwrap(), '301-3', 'code_a')

    expect(entry.additions.map((addition) => [addition.effectiveFrom, addition.rate])).toEqual([
      ['2018-09-24', 10],
      ['2019-05-10', 25],
    ])
    for (const addition of entry.additions) {
      expect(addition.authority).toBe('Section 301 List 3')
      expect(addition.spellingFromOrg).toBe(false)
      expect(addition.chapter99Code).toBe('9903.88.03')
    }
    // 24% understated by exactly the list rate, which is the complaint 35 §0.1
    // is about.
    expect(entry.before).toBe(24)
    expect(entry.after).toBe(49)
  })

  it('plans a terminating 0 step and drops that authority contribution (§3.3)', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4))

    const result = await planTariffResync(db, ORG, undefined, {
      actions: ACTIONS_WITH_EXPIRY,
      now: NOW,
    })
    const entry = codeOf(result._unsafeUnwrap(), 'ieepa-fentanyl-cn', 'code_a')

    expect(entry.additions).toEqual([
      expect.objectContaining({
        effectiveFrom: '2026-02-24',
        rate: 0,
        authority: 'IEEPA fentanyl',
      }),
    ])
    expect(entry.before).toBe(49)
    expect(entry.after).toBe(29)
    expect(entry.before - entry.after).toBe(20)
  })

  it('plans nothing, and does not error, for a code the catalogue does not carry', async () => {
    h.codeRows = [{ instanceId: 'code_x', code: '0000.00.00.00', country: 'CN' }]
    h.schedule.set('code_x', [rate(null, 5, '2020-01-01', null)])

    const result = await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })

    expect(result.isOk()).toBe(true)
    expect(result._unsafeUnwrap().actions).toEqual([])
    expect(result._unsafeUnwrap().diverged).toEqual([])
  })

  it('reads live codes only - archived ones are excluded in SQL', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4))

    await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })

    expect(h.isNullColumns).toContain('archivedAt')
  })

  it('reports a stored row whose rate differs at the same day, and adds nothing for it', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    const rows = adoptedCnRows(4)
    // The org set List 3 to 30% themselves. The catalogue says 25%.
    ;(rows[2] as TariffRateRow).rate = 30
    h.schedule.set('code_a', rows)

    const plan = (
      await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })
    )._unsafeUnwrap()

    expect(plan.actions).toEqual([])
    expect(plan.diverged).toEqual([
      {
        codeInstanceId: 'code_a',
        code: '8501.40.40.20',
        rateId: rows[2]?.id,
        chapter99Code: '9903.88.03',
        effectiveFrom: '2019-05-10',
        ours: 30,
        theirs: 25,
      },
    ])
  })

  it('offers the missing MFN base row as its own pseudo-action', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4).slice(1)) // every action row, no base

    const plan = (
      await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })
    )._unsafeUnwrap()
    const entry = codeOf(plan, MFN_ACTION_KEY, 'code_a')

    expect(entry.additions).toEqual([
      expect.objectContaining({ effectiveFrom: '1995-01-01', rate: 4, authority: null }),
    ])
    expect(entry.before).toBe(45)
    expect(entry.after).toBe(49)
  })

  it('narrows to the codes named, for the per-row button', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4))
    h.schedule.set('code_b', adoptedCnRows(3))

    const plan = (
      await planTariffResync(db, ORG, ['code_a'], { actions: ACTIONS_WITH_NEW_STEP, now: NOW })
    )._unsafeUnwrap()

    expect(actionOf(plan, '301-3').codes.map((entry) => entry.codeInstanceId)).toEqual(['code_a'])
  })

  it('returns NotFoundError when the org has no tariff_code / tariff_rate definitions', async () => {
    h.tariffCodeDefId = undefined
    const result = await planTariffResync(db, ORG, undefined, { actions: ACTIONS, now: NOW })

    expect(result.isErr()).toBe(true)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
  })
})

describe('applyTariffResync', () => {
  const deps = { actions: ACTIONS_WITH_NEW_STEP, now: NOW }

  it('writes the action across the codes named and re-deriving finds nothing left', async () => {
    h.codeRows = [
      { instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' },
      { instanceId: 'code_b', code: '8503.00.95.20', country: 'CN' },
    ]
    h.schedule.set('code_a', adoptedCnRows(4))
    h.schedule.set('code_b', adoptedCnRows(3, '301'))

    const first = await applyTariffResync(
      db,
      ORG,
      USER,
      { actionKey: '301-3', codeInstanceIds: ['code_a', 'code_b'] },
      deps
    )
    const result = first._unsafeUnwrap()
    expect(result.applied).toEqual([
      { codeInstanceId: 'code_a', code: '8501.40.40.20', rows: 1 },
      { codeInstanceId: 'code_b', code: '8503.00.95.20', rows: 1 },
    ])
    expect(result.failed).toEqual([])
    expect(result.remaining).toEqual([])
    expect(h.createCalls).toHaveLength(2)

    // Each code got ITS OWN spelling written, not one resolved for the action.
    expect(h.createCalls[0]?.values.tariff_rate_authority).toBe('Section 301 List 3')
    expect(h.createCalls[1]?.values.tariff_rate_authority).toBe('301')
    expect(h.createCalls[0]?.values.tariff_rate_effective_from).toBe('2026-06-10T00:00:00.000Z')

    // 🛑 The plan is re-derived inside the call, so a second press inserts
    // nothing rather than doubling the step.
    const second = await applyTariffResync(
      db,
      ORG,
      USER,
      { actionKey: '301-3', codeInstanceIds: ['code_a', 'code_b'] },
      deps
    )
    expect(second._unsafeUnwrap().applied).toEqual([])
    expect(h.createCalls).toHaveLength(2)
  })

  it('stops at the code that fails, keeps what committed, and names what is left', async () => {
    h.codeRows = [
      { instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' },
      { instanceId: 'code_b', code: '8503.00.95.20', country: 'CN' },
      { instanceId: 'code_c', code: '8501.40.40.20', country: 'CN' },
    ]
    h.schedule.set('code_a', adoptedCnRows(4))
    h.schedule.set('code_b', adoptedCnRows(3))
    h.schedule.set('code_c', adoptedCnRows(4))
    h.failOnCode.add('code_b')

    const result = (
      await applyTariffResync(
        db,
        ORG,
        USER,
        { actionKey: '301-3', codeInstanceIds: ['code_a', 'code_b', 'code_c'] },
        deps
      )
    )._unsafeUnwrap()

    expect(result.applied).toEqual([{ codeInstanceId: 'code_a', code: '8501.40.40.20', rows: 1 }])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]?.codeInstanceId).toBe('code_b')
    expect(result.remaining).toEqual([{ codeInstanceId: 'code_c', code: '8501.40.40.20' }])

    // The first code's row is committed; the failed code's is rolled back and
    // the third was never attempted.
    expect(h.createCalls).toHaveLength(1)
    expect(h.schedule.get('code_a')).toHaveLength(6)
    expect(h.schedule.get('code_b')).toHaveLength(5)
    expect(h.schedule.get('code_c')).toHaveLength(5)
  })

  it('refuses an empty code list', async () => {
    const result = await applyTariffResync(
      db,
      ORG,
      USER,
      { actionKey: '301-3', codeInstanceIds: [] },
      deps
    )
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(BadRequestError)
  })

  it('is a no-op for an action the re-derived plan does not carry', async () => {
    h.codeRows = [{ instanceId: 'code_a', code: '8501.40.40.20', country: 'CN' }]
    h.schedule.set('code_a', adoptedCnRows(4))

    const result = await applyTariffResync(
      db,
      ORG,
      USER,
      { actionKey: 'ieepa-fentanyl-cn', codeInstanceIds: ['code_a'] },
      deps
    )

    expect(result._unsafeUnwrap()).toEqual({
      actionKey: 'ieepa-fentanyl-cn',
      applied: [],
      failed: [],
      remaining: [],
    })
    expect(h.createCalls).toEqual([])
  })
})
