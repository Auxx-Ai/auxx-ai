// packages/lib/src/postings/__tests__/close-month.test.ts
//
// `close-month.ts` is a seam, not a computation: its whole job is that three
// error idioms meet in one place and none of them escapes as a throw. So these
// tests are almost entirely refusal tests, and every one of them asserts the
// same second thing - **that the original message survived**. A status with a
// summarised message is the failure mode this file exists to prevent: the
// gather refusal names the exact uncosted movement, missing setting or unpriced
// row to fix, and a screen that renders "could not close the month" instead has
// thrown away the only useful thing the subsystem produced.
//
// The three collaborators are mocked and the BUILDER IS REAL. That split is
// deliberate: the builder's own throw (the empty month) is the thing being
// classified, so faking it would test the fake. `build-month-end-inventory.ts`
// is pure, so it costs nothing to run for real.

import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What `previewEntry` and `postEntry` are handed. Declared here rather than
 * imported so the mocks are TYPED: a bare `vi.fn()` records its calls as an
 * empty tuple, and every `const [, options] = mock.calls[0]` in this file would
 * be a type error rather than the assertion it is supposed to be.
 */
interface PosterCall {
  organizationId: string
  entry: BuiltEntry
  lock: PeriodLock
  assertions?: PostingAssertions
  actorUserId?: string
  memo?: string
}

const h = vi.hoisted(() => ({
  gather: vi.fn<(db: unknown, organizationId: string, periodKey: string) => Promise<unknown>>(),
  resolvePeriodLock: vi.fn<(organizationId: string) => Promise<unknown>>(),
  previewEntry: vi.fn<(db: unknown, options: PosterCall) => Promise<unknown>>(),
  postEntry: vi.fn<(db: unknown, options: PosterCall) => Promise<unknown>>(),
  loggerError: vi.fn<(message: string, meta?: unknown) => void>(),
}))

vi.mock('../gather-month-end-inventory', () => ({
  gatherMonthEndInventoryInputs: h.gather,
}))
vi.mock('../period-lock', () => ({
  PERIOD_LOCK_SETTING_KEY: 'ledger.lockedThroughMonth',
  resolvePeriodLock: h.resolvePeriodLock,
}))
vi.mock('../post-entry', () => ({
  previewEntry: h.previewEntry,
  postEntry: h.postEntry,
}))
vi.mock('@auxx/logger', () => ({
  createScopedLogger: () => ({
    error: h.loggerError,
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  }),
}))

import type { Database } from '@auxx/database'
import { err, ok } from 'neverthrow'
import { BadRequestError, UnprocessableEntityError } from '../../errors'
import type { MonthEndInventoryInputs } from '../build-month-end-inventory'
import { postMonthEnd, previewMonthEnd } from '../close-month'
import type { MonthEndInventorySnapshot, PostingAssertions } from '../draft'
import type { PeriodLock } from '../periods'
import type { BuiltEntry, EntryPreview, PostResult } from '../types'

const ORG = 'org_1'
const PERIOD = '2026-08'
const TXN_DATE = '2026-08-31'

// `db` is never touched by this file - every read is inside a mocked
// collaborator - so a sentinel is both sufficient and the honest double.
const db = {} as Database

/**
 * The options one recorded call was made with.
 *
 * `noUncheckedIndexedAccess` types `calls[0]` as possibly `undefined`, and the
 * failure a missing call produces there ("cannot destructure") names nothing
 * useful. Failing here names the mock instead.
 */
function callOptions(calls: Array<[unknown, PosterCall]>, index = 0): PosterCall {
  const call = calls[index]
  if (!call) throw new Error(`expected a recorded call at index ${index}, found none`)
  return call[1]
}

function snapshot(
  overrides: Partial<MonthEndInventorySnapshot['balances']> = {},
  activity: Partial<MonthEndInventorySnapshot['activityTotals']> = {}
): MonthEndInventorySnapshot {
  return {
    balances: {
      inventory_raw_materials: 0,
      inventory_wip: 0,
      inventory_finished_goods: 0,
      ...overrides,
    },
    activityTotals: {
      absorbedLabor: 0,
      absorbedOverhead: 0,
      inventoryAdjustments: 0,
      ...activity,
    },
  }
}

/** A month in which raw materials rose by $250. Builds a real, balanced entry. */
function movingInputs(): MonthEndInventoryInputs {
  return {
    periodKey: PERIOD,
    txnDate: TXN_DATE,
    prior: snapshot(),
    current: snapshot({ inventory_raw_materials: 25000 }),
  }
}

/** A month in which every one of the six lanes is unchanged. */
function emptyInputs(): MonthEndInventoryInputs {
  return {
    periodKey: PERIOD,
    txnDate: TXN_DATE,
    prior: snapshot({ inventory_wip: 900 }, { absorbedLabor: 400 }),
    current: snapshot({ inventory_wip: 900 }, { absorbedLabor: 400 }),
  }
}

const PREVIEW_OK: EntryPreview = {
  postingType: 'month_end_inventory',
  periodKey: PERIOD,
  txnDate: TXN_DATE,
  docNumber: 'GL-MEI-2026-08-0',
  lines: [],
  totalMinor: 25000,
}

const POST_OK: PostResult = {
  status: 'posted',
  glPostingId: 'gl_1',
  docNumber: 'GL-MEI-2026-08-0',
  providerId: 'none',
}

beforeEach(() => {
  vi.clearAllMocks()
  h.resolvePeriodLock.mockResolvedValue({ lockedThroughMonth: null })
  h.previewEntry.mockResolvedValue(PREVIEW_OK)
  h.postEntry.mockResolvedValue(POST_OK)
})

// ── The happy path, so the refusal tests mean something ────────────────────

describe('the composed close', () => {
  it('gathers, builds, resolves the lock, and previews the built entry', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    // Every field the poster's preview produced, plus the assertions this
    // composer attaches. Spread rather than identity: the preview is widened
    // here on purpose, and `toBe` would only pin that it was NOT.
    expect(preview).toMatchObject(PREVIEW_OK)
    expect(h.gather).toHaveBeenCalledWith(db, ORG, PERIOD)
    const options = callOptions(h.previewEntry.mock.calls)
    expect(options.organizationId).toBe(ORG)
    expect(options.lock).toEqual({ lockedThroughMonth: null })
    expect(options.entry.postingType).toBe('month_end_inventory')
    expect(options.entry.periodKey).toBe(PERIOD)
    expect(options.entry.txnDate).toBe(TXN_DATE)
    expect(options.entry.totalDebit).toBe(options.entry.totalCredit)
  })

  it('carries the assertions on the preview, so an OPEN month has a roll-forward', async () => {
    // 13-accounting-ui.md section 5.2 wants the before/after panel beside the
    // entry being PREVIEWED. `EntryPreview` carried no assertions, so it could
    // only render after posting, which is the wrong way round.
    const inputs = movingInputs()
    h.gather.mockResolvedValue(ok(inputs))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.assertions?.kind).toBe('month_end_inventory')
    // The gathered snapshots verbatim - not a second derivation, so a preview
    // and the post that follows it cannot disagree about what they asserted.
    expect(preview.assertions?.before).toEqual(inputs.prior)
    expect(preview.assertions?.after).toEqual(inputs.current)
  })

  it('carries no assertions on a refused preview', async () => {
    h.gather.mockResolvedValue(
      err(new UnprocessableEntityError('nope', { organizationId: ORG, missing: ['x'] }))
    )

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toBeDefined()
    expect(preview.assertions).toBeUndefined()
  })

  it('passes the actor and memo through to the poster', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))

    await postMonthEnd(db, {
      organizationId: ORG,
      periodKey: PERIOD,
      actorUserId: 'usr_1',
      memo: 'August close',
    })

    const options = callOptions(h.postEntry.mock.calls)
    expect(options.actorUserId).toBe('usr_1')
    expect(options.memo).toBe('August close')
  })
})

// ── 🛑 The contract task 09 exists for ─────────────────────────────────────

describe('assertions', () => {
  it('threads the builder assertions into postEntry', async () => {
    const inputs = movingInputs()
    h.gather.mockResolvedValue(ok(inputs))

    await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(h.postEntry).toHaveBeenCalledTimes(1)
    const options = callOptions(h.postEntry.mock.calls)
    // `requiresAssertions` names `month_end_inventory`. Omitting these is a
    // refusal, not a silent partial write - a claimed row with no assertions
    // holds the period and leaves the NEXT close nothing to subtract from.
    expect(options.assertions).toEqual({
      kind: 'month_end_inventory',
      before: inputs.prior,
      after: inputs.current,
    })
  })

  it('asserts the gathered snapshots verbatim, not a re-derived pair', async () => {
    const inputs = movingInputs()
    h.gather.mockResolvedValue(ok(inputs))

    await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    const options = callOptions(h.postEntry.mock.calls)
    expect(options.assertions?.before).toBe(inputs.prior)
    expect(options.assertions?.after).toBe(inputs.current)
  })
})

// ── Idiom 1: the gather `Result` ───────────────────────────────────────────

describe('a gather refusal', () => {
  const UNCOSTED =
    'Cannot close 2026-08: 2 post-cutoff stock movements carry no frozen cost. ' +
    'Movement ids: mv_abc123, mv_def456. Cost them before closing.'

  it('becomes blockedBy with the message intact', async () => {
    h.gather.mockResolvedValue(err(new UnprocessableEntityError(UNCOSTED, { organizationId: ORG })))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toEqual({ status: 'error', error: UNCOSTED })
    // The exact movement ids are the whole product. Assert the text, not a shape.
    expect(preview.blockedBy?.error).toContain('mv_abc123')
    expect(preview.blockedBy?.error).toContain('mv_def456')
  })

  it('becomes a PostResult carrying the same message, and writes nothing', async () => {
    h.gather.mockResolvedValue(err(new UnprocessableEntityError(UNCOSTED, { organizationId: ORG })))

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toBe(UNCOSTED)
    expect(result.glPostingId).toBeUndefined()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('projects nothing rather than inventing a number', async () => {
    h.gather.mockResolvedValue(err(new UnprocessableEntityError(UNCOSTED)))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.lines).toEqual([])
    expect(preview.totalMinor).toBe(0)
    expect(preview.docNumber).toBe('')
    expect(preview.postingType).toBe('month_end_inventory')
    expect(preview.periodKey).toBe(PERIOD)
  })

  it('maps the draft-setup gate to setup_incomplete on both doors', async () => {
    const message =
      'Accounting setup for this organization is not finalized (accounting.setupState is ' +
      '"draft", expected "finalized"). Complete the accounting setup before posting. ' +
      'Posting is refused until it is finalized.'
    // The shape `readOpeningBaseline` actually returns: the ONLY refusal in the
    // subsystem that names `accounting.setupState` in its details.
    const refusal = new UnprocessableEntityError(message, {
      organizationId: ORG,
      setting: 'accounting.setupState',
      value: '"draft"',
    })
    h.gather.mockResolvedValue(err(refusal))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })
    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toEqual({ status: 'setup_incomplete', error: message })
    expect(result.status).toBe('setup_incomplete')
    expect(result.error).toBe(message)
    // A refusal every org hits on day one is not a channel-worthy event.
    expect(h.loggerError).not.toHaveBeenCalled()
  })

  it('does not mistake another missing-setting refusal for setup_incomplete', async () => {
    const message =
      'The accounting cutoff period for this organization is not a month: unset. ' +
      'Set accounting.cutoffPeriod to a YYYY-MM month.'
    h.gather.mockResolvedValue(
      err(
        new UnprocessableEntityError(message, {
          organizationId: ORG,
          setting: 'accounting.cutoffPeriod',
          value: 'unset',
        })
      )
    )

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toBe(message)
  })

  it('maps an incomplete-but-finalized baseline to setup_incomplete, not error', async () => {
    // Coordinator decision 2026-08-28: `setupState` says finalized while required
    // keys are blank. An anomaly, since finalize is supposed to gate on
    // completeness - but the remedy is the same wizard, so it must not read as an
    // internal failure. The named keys have to survive into the message.
    const message =
      'The accounting opening baseline for this organization is incomplete. Missing: ' +
      'accounting.bookTimeZone, accounting.openingWip. Set these in accounting setup.'
    h.gather.mockResolvedValue(
      err(
        new UnprocessableEntityError(message, {
          organizationId: ORG,
          missing: ['accounting.bookTimeZone', 'accounting.openingWip'],
        })
      )
    )

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('setup_incomplete')
    expect(result.error).toBe(message)
    expect(result.error).toContain('accounting.openingWip')
  })

  it('shows the same incomplete baseline on the preview door', async () => {
    h.gather.mockResolvedValue(
      err(
        new UnprocessableEntityError('incomplete baseline', {
          organizationId: ORG,
          missing: ['accounting.cutoffPeriod'],
        })
      )
    )

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy?.status).toBe('setup_incomplete')
  })

  it('maps the pre-cutoff refusal to period_closed', async () => {
    const message =
      'Cannot close 2025-11: the accounting cutoff is 2025-12, so 2025-11 is covered by the ' +
      'frozen opening balances rather than by the subledger. Close a month after the cutoff.'
    h.gather.mockResolvedValue(
      err(
        new UnprocessableEntityError(message, {
          organizationId: ORG,
          periodKey: '2025-11',
          cutoffPeriod: '2025-12',
        })
      )
    )

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: '2025-11' })

    expect(preview.blockedBy).toEqual({ status: 'period_closed', error: message })
  })

  it('surfaces a day key as a refusal rather than a throw', async () => {
    const message =
      'The month-end inventory entry closes a month, not a day - "2026-08-18" is a date. ' +
      'Pass a YYYY-MM period key.'
    h.gather.mockResolvedValue(err(new BadRequestError(message, { periodKey: '2026-08-18' })))

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: '2026-08-18' })

    expect(result.status).toBe('error')
    expect(result.error).toBe(message)
  })
})

// ── Idiom 2: the builder's throw ───────────────────────────────────────────

describe('an empty month', () => {
  it('becomes nothing_to_close on preview, not an error', async () => {
    h.gather.mockResolvedValue(ok(emptyInputs()))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy?.status).toBe('nothing_to_close')
    expect(preview.blockedBy?.error).toContain(`Nothing moved in ${PERIOD}`)
    expect(preview.txnDate).toBe(TXN_DATE)
    expect(h.previewEntry).not.toHaveBeenCalled()
  })

  it('becomes nothing_to_close on post, and claims no period', async () => {
    h.gather.mockResolvedValue(ok(emptyInputs()))

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('nothing_to_close')
    expect(result.error).toContain(`Nothing moved in ${PERIOD}`)
    expect(result.glPostingId).toBeUndefined()
    expect(result.failureClass).toBeUndefined()
    expect(h.postEntry).not.toHaveBeenCalled()
  })

  it('is not logged as an error - it is a skip state', async () => {
    h.gather.mockResolvedValue(ok(emptyInputs()))

    await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(h.loggerError).not.toHaveBeenCalled()
  })

  it('is decided by the inputs, so one moving lane is enough to build', async () => {
    h.gather.mockResolvedValue(
      ok({
        periodKey: PERIOD,
        txnDate: TXN_DATE,
        prior: snapshot({}, { inventoryAdjustments: 0 }),
        current: snapshot({}, { inventoryAdjustments: -1 }),
      })
    )

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toBeUndefined()
    expect(h.previewEntry).toHaveBeenCalledTimes(1)
  })

  it('does not classify a malformed month as nothing_to_close', async () => {
    // A non-integer input throws from the same builder with the same error
    // class. It is a data fault, not an empty month, and the discriminator has
    // to tell them apart without reading the message.
    h.gather.mockResolvedValue(
      ok({
        periodKey: PERIOD,
        txnDate: TXN_DATE,
        prior: snapshot(),
        current: snapshot({ inventory_wip: 12.5 }),
      })
    )

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toContain('current.balances.inventory_wip')
    expect(result.failureClass).toBe('data')
  })

  it('does not classify a missing snapshot half as nothing_to_close', async () => {
    h.gather.mockResolvedValue(
      ok({
        periodKey: PERIOD,
        txnDate: TXN_DATE,
        prior: snapshot(),
        current: { balances: undefined, activityTotals: undefined },
      } as unknown as MonthEndInventoryInputs)
    )

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toContain('current.balances is missing')
  })
})

// ── Idiom 3: the lock, and the downstream doors ────────────────────────────

describe('a broken period lock', () => {
  const message =
    'The accounting period lock for this organization is not a valid month: "2026-13". ' +
    'Set ledger.lockedThroughMonth to a YYYY-MM month, or clear it if nothing is closed.'

  it('is an error naming the setting, not period_closed and not setup_incomplete', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))
    h.resolvePeriodLock.mockRejectedValue(
      new UnprocessableEntityError(message, {
        organizationId: ORG,
        setting: 'ledger.lockedThroughMonth',
        value: '2026-13',
      })
    )

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })
    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toEqual({ status: 'error', error: message })
    expect(preview.txnDate).toBe(TXN_DATE)
    expect(result.status).toBe('error')
    expect(result.error).toBe(message)
    expect(result.failureClass).toBe('configuration')
    expect(h.previewEntry).not.toHaveBeenCalled()
    expect(h.postEntry).not.toHaveBeenCalled()
  })
})

describe('the downstream doors', () => {
  it('returns previewEntry`s own blockedBy unchanged', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))
    h.previewEntry.mockResolvedValue({
      ...PREVIEW_OK,
      blockedBy: { status: 'account_unmapped', error: "Role 'grni' resolved to nothing." },
    })

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toEqual({
      status: 'account_unmapped',
      error: "Role 'grni' resolved to nothing.",
    })
  })

  it('returns postEntry`s own status unchanged', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))
    h.postEntry.mockResolvedValue({ status: 'already_posted', glPostingId: 'gl_9' })

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result).toEqual({ status: 'already_posted', glPostingId: 'gl_9' })
  })

  it('converts an unexpected previewEntry throw into blockedBy', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))
    h.previewEntry.mockRejectedValue(new Error('connection terminated'))

    const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(preview.blockedBy).toEqual({ status: 'error', error: 'connection terminated' })
    expect(preview.txnDate).toBe(TXN_DATE)
    // THIS one is worth a log line - it is the channel that should fire.
    expect(h.loggerError).toHaveBeenCalledTimes(1)
  })

  it('converts an unexpected postEntry throw into a status', async () => {
    h.gather.mockResolvedValue(ok(movingInputs()))
    h.postEntry.mockRejectedValue(new Error('connection terminated'))

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toBe('connection terminated')
    expect(h.loggerError).toHaveBeenCalledTimes(1)
  })

  it('converts an unexpected gather throw into a status', async () => {
    h.gather.mockRejectedValue(new Error('pool exhausted'))

    const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

    expect(result.status).toBe('error')
    expect(result.error).toBe('pool exhausted')
  })
})

// ── The one property that holds across every path ──────────────────────────

describe('neither function ever throws', () => {
  const paths: Array<[string, () => void]> = [
    ['a gather Result error', () => h.gather.mockResolvedValue(err(new Error('gather refused')))],
    ['a gather throw', () => h.gather.mockRejectedValue(new Error('gather exploded'))],
    [
      'a gather resolving to a non-Result',
      () => h.gather.mockResolvedValue(undefined as unknown as never),
    ],
    ['an empty month', () => h.gather.mockResolvedValue(ok(emptyInputs()))],
    [
      'a malformed month',
      () =>
        h.gather.mockResolvedValue(
          ok({ periodKey: PERIOD, txnDate: TXN_DATE, prior: null, current: null })
        ),
    ],
    [
      'a lock throw',
      () => {
        h.gather.mockResolvedValue(ok(movingInputs()))
        h.resolvePeriodLock.mockRejectedValue(new Error('lock unreadable'))
      },
    ],
    [
      'a preview throw',
      () => {
        h.gather.mockResolvedValue(ok(movingInputs()))
        h.previewEntry.mockRejectedValue(new Error('preview exploded'))
      },
    ],
    [
      'a post throw',
      () => {
        h.gather.mockResolvedValue(ok(movingInputs()))
        h.postEntry.mockRejectedValue(new Error('post exploded'))
      },
    ],
    [
      'a thrown non-Error',
      () => {
        h.gather.mockResolvedValue(ok(movingInputs()))
        h.postEntry.mockRejectedValue('a string')
      },
    ],
  ]

  for (const [label, arrange] of paths) {
    it(`resolves rather than rejecting on ${label}`, async () => {
      arrange()

      const preview = await previewMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })
      const result = await postMonthEnd(db, { organizationId: ORG, periodKey: PERIOD })

      expect(typeof preview.periodKey).toBe('string')
      expect(typeof result.status).toBe('string')
      // A refusal must always say something. An empty string on a screen is
      // the same as no error boundary at all.
      if (preview.blockedBy) expect(preview.blockedBy.error.length).toBeGreaterThan(0)
      if (result.status !== 'posted') expect((result.error ?? '').length).toBeGreaterThan(0)
    })
  }
})
