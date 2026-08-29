// packages/lib/src/postings/__tests__/opening-baseline.test.ts
//
// The opening baseline is the one number in this system that must never be
// guessed. It is what the FIRST month-end entry is measured against, and once
// that entry is posted there is no un-post: a baseline that was wrong by any
// amount produces a journal entry that balances, claims cleanly, and ties to
// nothing.
//
// So there are exactly two behaviours defended here, and every test is a face of
// one of them:
//
//   1. **It reads through the CACHED settings path.** Every key goes through
//      `getOrganizationSetting` with NO `db` argument, which is the only way it
//      answers from `getOrgCache().get(orgId, 'orgSettings')`
//      (`settings-service.ts:171-174`); pass a `db` and it silently becomes a
//      direct table query instead (`settings-service.ts:156-169`). The absence
//      of that argument is load-bearing and invisible, so it is asserted. The
//      cached value is dropped by the wizard that writes it —
//      `routers/setting.ts:134` and `:221` fire `org.settings.changed`, which
//      `invalidation-graph.ts:250` maps to `org: ['orgSettings']`.
//   2. **It fails closed, naming the row to fix.** Never a default, never `0`,
//      never UTC. And the mirror of that: `0` is a LEGITIMATE opening balance —
//      an organization with no work in process at cutover has exactly zero WIP
//      — so a `?? 0` anywhere in the read path is a bug that makes "unset" and
//      "zero" indistinguishable. `zero is a real balance, not a missing one`
//      below is the test that catches it.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  /** The org's settings, as the cache would hand them back, keyed by setting key. */
  settings: {} as Record<string, unknown>,
  /**
   * Every `getOrganizationSetting` call's params verbatim — so a test can prove
   * no `db` was passed, which is what keeps the read on the cached path.
   */
  calls: [] as Record<string, unknown>[],
}))

vi.mock('../../settings/settings-service', () => ({
  getOrganizationSetting: async (params: { organizationId: string; key: string; db?: unknown }) => {
    h.calls.push({ ...params })
    return params.key in h.settings ? h.settings[params.key] : null
  },
  // Present only so that reaching for it is a loud failure. It always queries
  // the table (`settings-service.ts:187`), so it is NOT the cached path and this
  // module must not use it.
  getAllOrganizationSettings: async () => {
    throw new Error('getAllOrganizationSettings is not the cached path — do not use it here')
  },
}))

import { UnprocessableEntityError } from '../../errors'
import { isSettingKey } from '../../settings/catalog'
import { OPENING_BASELINE_SETTING_KEYS, readOpeningBaseline } from '../opening-baseline'

const ORG = 'org_1'
const K = OPENING_BASELINE_SETTING_KEYS

/** A finalized, complete, valid baseline. Every test starts here and breaks one thing. */
function validSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    [K.setupState]: 'finalized',
    [K.cutoffPeriod]: '2026-12',
    [K.bookTimeZone]: 'America/New_York',
    [K.inventory_raw_materials]: 125_000,
    [K.inventory_wip]: 0,
    [K.inventory_finished_goods]: 480_050,
    // Catalog siblings the reader must ignore: provenance and audit metadata,
    // not inputs to the arithmetic.
    'accounting.qboOpeningRawMaterials': 999_999,
    'accounting.qboOpeningWip': 999_999,
    'accounting.qboOpeningFinishedGoods': 999_999,
    'accounting.qboOpeningJournalRef': 'JE-1042',
    'accounting.setupFinalizedAt': '2026-12-31T23:59:00.000Z',
    'accounting.setupFinalizedByUserId': 'usr_1',
    ...overrides,
  }
}

/** The refusal's message, or a failure if the call unexpectedly succeeded. */
async function refusalMessage(settings: Record<string, unknown>): Promise<string> {
  h.settings = settings
  const result = await readOpeningBaseline(ORG)
  if (result.isOk()) {
    throw new Error(`Expected a refusal, got ${JSON.stringify(result.value)}`)
  }
  expect(result.error).toBeInstanceOf(UnprocessableEntityError)
  return result.error.message
}

beforeEach(() => {
  h.settings = validSettings()
  h.calls = []
})

describe('readOpeningBaseline', () => {
  describe('the happy path', () => {
    it('returns the cutoff, the zone and the three balances', async () => {
      const result = await readOpeningBaseline(ORG)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap()).toEqual({
        cutoffPeriod: '2026-12',
        bookTimeZone: 'America/New_York',
        balances: {
          inventory_raw_materials: 125_000,
          inventory_wip: 0,
          inventory_finished_goods: 480_050,
        },
      })
    })

    it('ignores the provider snapshot and the audit metadata', async () => {
      // The provider's figures are provenance and a finalize-time gate, not a
      // second source for the same number. If they ever leaked into the result
      // the balances below would read 999_999.
      const baseline = (await readOpeningBaseline(ORG))._unsafeUnwrap()
      expect(Object.keys(baseline).sort()).toEqual(['balances', 'bookTimeZone', 'cutoffPeriod'])
      expect(baseline.balances.inventory_raw_materials).toBe(125_000)
    })

    it('trims a hand-typed cutoff and zone rather than refusing them', async () => {
      h.settings = validSettings({
        [K.cutoffPeriod]: '  2026-12 ',
        [K.bookTimeZone]: ' America/New_York  ',
      })
      const baseline = (await readOpeningBaseline(ORG))._unsafeUnwrap()
      expect(baseline.cutoffPeriod).toBe('2026-12')
      expect(baseline.bookTimeZone).toBe('America/New_York')
    })
  })

  describe('it reads through the org settings cache', () => {
    it('passes NO db argument, which is the only thing that keeps it cached', async () => {
      // 🛑 THE CACHED-PATH TEST. `getOrganizationSetting` answers from
      // `getOrgCache().get(orgId, 'orgSettings')` only when `db` is omitted
      // (`settings-service.ts:171-174`). Hand it a `Database` or a
      // `Transaction` and it quietly switches to a direct `OrganizationSetting`
      // query (`settings-service.ts:156-169`) — same signature, same return
      // type, no error. The absence of the argument IS the mechanism, so it is
      // the thing asserted.
      await readOpeningBaseline(ORG)

      expect(h.calls.length).toBeGreaterThan(0)
      for (const call of h.calls) {
        expect(Object.keys(call).sort()).toEqual(['key', 'organizationId'])
        expect('db' in call).toBe(false)
        expect(call.organizationId).toBe(ORG)
      }
    })

    it('reads exactly the six declared keys, one cached lookup each', async () => {
      await readOpeningBaseline(ORG)

      expect(h.calls.map((call) => call.key).sort()).toEqual(Object.values(K).sort())
    })

    it('still reads through the cache when the baseline is refused', async () => {
      // A refusal must not become a shortcut that reaches for a different reader.
      h.settings = validSettings({ [K.setupState]: 'draft' })
      await readOpeningBaseline(ORG)

      expect(h.calls.length).toBeGreaterThan(0)
      for (const call of h.calls) expect('db' in call).toBe(false)
    })
  })

  describe('the setup gate', () => {
    it.each([
      ['draft', 'draft'],
      ['unset', null],
      ['some other value', 'in_progress'],
    ])('refuses when setupState is %s, and says so', async (_label, state) => {
      const message = await refusalMessage(validSettings({ [K.setupState]: state }))
      expect(message).toContain(K.setupState)
      expect(message).toContain('not finalized')
    })

    it('refuses draft BEFORE complaining about missing rows', async () => {
      // A half-filled wizard is missing rows AND in draft. Reporting the missing
      // rows first tells the person to fill in fields they are already looking
      // at; reporting the state tells them the step they have not finished.
      const message = await refusalMessage({ [K.setupState]: 'draft' })
      expect(message).toContain('not finalized')
      expect(message).not.toContain('incomplete')
    })
  })

  describe('a missing key fails closed and names itself', () => {
    it.each([
      [K.cutoffPeriod],
      [K.bookTimeZone],
      [K.inventory_raw_materials],
      [K.inventory_wip],
      [K.inventory_finished_goods],
    ])('refuses when %s is null', async (key) => {
      const message = await refusalMessage(validSettings({ [key]: null }))
      expect(message).toContain(key)
      expect(message).toContain('incomplete')
    })

    it.each([
      [K.cutoffPeriod],
      [K.bookTimeZone],
    ])('treats an empty %s as unset, because a cleared text input writes ""', async (key) => {
      const message = await refusalMessage(validSettings({ [key]: '   ' }))
      expect(message).toContain(key)
    })

    it('names every missing key in one message, not one refusal per blank field', async () => {
      const message = await refusalMessage(
        validSettings({ [K.bookTimeZone]: null, [K.inventory_wip]: null })
      )
      expect(message).toContain(K.bookTimeZone)
      expect(message).toContain(K.inventory_wip)
      expect(message).not.toContain(K.inventory_raw_materials)
    })
  })

  describe('the cutoff period', () => {
    it('refuses a malformed month', async () => {
      const message = await refusalMessage(validSettings({ [K.cutoffPeriod]: '2026-13' }))
      expect(message).toContain(K.cutoffPeriod)
      expect(message).toContain('2026-13')
    })

    it('refuses a DAY key — the cutoff divides accounting months', async () => {
      // `parsePeriodKey` accepts `'2026-12-31'` happily. Silently picking one
      // edge of a day key is the fail-open reading in a different costume.
      const message = await refusalMessage(validSettings({ [K.cutoffPeriod]: '2026-12-31' }))
      expect(message).toContain('not a month')
    })

    it('refuses a non-string', async () => {
      const message = await refusalMessage(validSettings({ [K.cutoffPeriod]: 202_612 }))
      expect(message).toContain(K.cutoffPeriod)
    })
  })

  describe('the book timezone', () => {
    it('refuses an invalid IANA zone rather than falling back to UTC', async () => {
      const message = await refusalMessage(validSettings({ [K.bookTimeZone]: 'Mars/Olympus' }))
      expect(message).toContain(K.bookTimeZone)
      expect(message).toContain('Mars/Olympus')
      expect(message).toContain('IANA')
    })

    it('refuses an abbreviation that is not a zone name', async () => {
      const message = await refusalMessage(validSettings({ [K.bookTimeZone]: 'EST5EDT-nope' }))
      expect(message).toContain(K.bookTimeZone)
    })

    it('accepts UTC when it is actually configured, and only then', async () => {
      h.settings = validSettings({ [K.bookTimeZone]: 'UTC' })
      const baseline = (await readOpeningBaseline(ORG))._unsafeUnwrap()
      expect(baseline.bookTimeZone).toBe('UTC')
    })

    it('validates with the same call periodKeyForDate will make', async () => {
      // If this passes here it cannot throw there. The zone below is real but
      // uncommon, which is the case a hand-written allowlist would have missed.
      h.settings = validSettings({ [K.bookTimeZone]: 'Pacific/Chatham' })
      expect((await readOpeningBaseline(ORG)).isOk()).toBe(true)
      expect(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Pacific/Chatham' })).not.toThrow()
    })
  })

  describe('the balances are integer minor units', () => {
    it.each([
      [K.inventory_raw_materials],
      [K.inventory_wip],
      [K.inventory_finished_goods],
    ])('refuses a fractional %s, with the value in the message', async (key) => {
      // The catalog cannot catch this: `normalizeSettingValue` routes CURRENCY
      // through `fieldValueSchemas.number`, which rejects only a non-finite
      // number, so `12.5` reaches storage.
      const message = await refusalMessage(validSettings({ [key]: 1250.5 }))
      expect(message).toContain(key)
      expect(message).toContain('1250.5')
      expect(message).toContain('minor units')
    })

    it('refuses a string that looks like a number', async () => {
      const message = await refusalMessage(validSettings({ [K.inventory_wip]: '1250' }))
      expect(message).toContain(K.inventory_wip)
      expect(message).toContain('not a number')
    })

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY]])('refuses %s', async (value) => {
      const message = await refusalMessage(validSettings({ [K.inventory_wip]: value }))
      expect(message).toContain('not a number')
    })

    it('accepts a negative balance — a credit inventory balance is wrong, not unreadable', async () => {
      // Refusing it here would hide a real accounting problem behind a settings
      // error. The close is where a negative inventory balance gets argued about.
      h.settings = validSettings({ [K.inventory_wip]: -500 })
      const baseline = (await readOpeningBaseline(ORG))._unsafeUnwrap()
      expect(baseline.balances.inventory_wip).toBe(-500)
    })

    it('zero is a real balance, not a missing one', async () => {
      // 🛑 THE `?? 0` TEST. An organization with nothing in process at cutover
      // has exactly zero WIP, and a business that makes to order has zero
      // finished goods. If any of these collapsed `0` into "unset" the reader
      // would refuse a correctly configured organization; if the inverse ever
      // ships — "unset" collapsing to `0` — the first entry values itself
      // against a baseline nobody supplied and nothing downstream can tell.
      h.settings = validSettings({
        [K.inventory_raw_materials]: 0,
        [K.inventory_wip]: 0,
        [K.inventory_finished_goods]: 0,
      })

      const result = await readOpeningBaseline(ORG)

      expect(result.isOk()).toBe(true)
      expect(result._unsafeUnwrap().balances).toEqual({
        inventory_raw_materials: 0,
        inventory_wip: 0,
        inventory_finished_goods: 0,
      })
    })

    it('a null balance and a zero balance take different paths', async () => {
      const zero = await readOpeningBaseline(ORG)
      expect(zero.isOk()).toBe(true) // the fixture already has WIP at 0

      h.settings = validSettings({ [K.inventory_wip]: null })
      const missing = await readOpeningBaseline(ORG)
      expect(missing.isErr()).toBe(true)
    })
  })

  describe('the refusal is an AuxxError carrying the row to fix', () => {
    it('is a 422 with the organization and the setting in its details', async () => {
      h.settings = validSettings({ [K.bookTimeZone]: 'Mars/Olympus' })
      const result = await readOpeningBaseline(ORG)

      const error = result._unsafeUnwrapErr()
      expect(error).toBeInstanceOf(UnprocessableEntityError)
      expect((error as UnprocessableEntityError).statusCode).toBe(422)
      expect((error as UnprocessableEntityError).details).toMatchObject({
        organizationId: ORG,
        setting: K.bookTimeZone,
      })
    })

    it('returns a Result rather than throwing, so the poster can map it to a status', async () => {
      h.settings = {}
      await expect(readOpeningBaseline(ORG)).resolves.toBeDefined()
    })
  })

  describe('the declared keys', () => {
    it('names the catalog keys it reads, and only those', async () => {
      expect(OPENING_BASELINE_SETTING_KEYS).toEqual({
        setupState: 'accounting.setupState',
        cutoffPeriod: 'accounting.cutoffPeriod',
        bookTimeZone: 'accounting.bookTimeZone',
        inventory_raw_materials: 'accounting.openingRawMaterials',
        inventory_wip: 'accounting.openingWip',
        inventory_finished_goods: 'accounting.openingFinishedGoods',
      })
    })

    it('every key it names exists in the settings catalog', () => {
      // The reader and the catalog are two files. A typo in either one produces
      // a key that reads as permanently unset, which fails closed — loudly, but
      // for a reason nobody can act on, because the row the error names does not
      // exist to be filled in.
      for (const key of Object.values(OPENING_BASELINE_SETTING_KEYS)) {
        expect(isSettingKey(key), `${key} is not a catalog key`).toBe(true)
      }
    })
  })
})
