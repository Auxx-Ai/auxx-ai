// packages/lib/src/dashboards/draft-edit/__tests__/revert.test.ts
//
// Whole-turn Undo. It is OFFERED, never automatic, so it can be taken minutes
// after the turn ended on a dashboard that has moved on. That gives it two
// distinct refusals, and the user-facing sentence differs between them:
// "nothing to undo" and "the dashboard changed since that turn, undoing now
// would also discard the newer changes" must never share one message.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const redisStore = new Map<string, unknown>()
vi.mock('@auxx/redis', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@auxx/redis')>()),
  getRedisData: vi.fn(async (key: string) => redisStore.get(key) ?? null),
  setRedisData: vi.fn(async (key: string, data: unknown) => {
    redisStore.set(key, data)
    return 'OK'
  }),
  deleteRedisData: vi.fn(async (key: string) => (redisStore.delete(key) ? 1 : 0)),
}))

// Lazy-imported inside publishDraftUpdatedSignal, so the whole barrel is
// replaced here and none of its module graph loads at collection.
const publishDashboardDraftUpdated = vi.fn(async (..._a: unknown[]) => {})
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ tag: 'realtime' }),
  publishDashboardDraftUpdated: (...a: unknown[]) => publishDashboardDraftUpdated(...a),
}))

import { ConflictError, NotFoundError } from '../../../errors'
import { hashLayoutDoc } from '../../config-hash'
import {
  captureDashboardTurnSnapshot,
  readDashboardTurnSnapshot,
  recordDashboardTurnPostHash,
  revertDashboardTurn,
} from '../turn-snapshot'
import { configuredBarChart, doc, makeDb, tab, widget } from './support/fixtures'

const SCOPE = { dashboardId: 'dash_1', organizationId: 'org_1' }
const TURN = 'turn_a'
const KEY = `dashboard:layout:${SCOPE.dashboardId}:preturn`

/** What the draft looked like before the turn. */
const preTurn = doc([tab('tab_1', 'Overview', [widget('w1', 'Note')])])
/** What the turn left behind. */
const postTurn = doc([
  tab('tab_1', 'Overview', [widget('w1', 'Note'), widget('w2', 'Revenue', configuredBarChart())]),
])
/** What someone else did afterwards. */
const movedOn = doc([tab('tab_1', 'Overview', [widget('w3', 'Something else')])])

beforeEach(() => {
  redisStore.clear()
  publishDashboardDraftUpdated.mockClear()
})

describe('revertDashboardTurn', () => {
  it('restores the exact pre-turn doc, discards the snapshot and signals', async () => {
    const { db, row } = makeDb({ draftLayout: postTurn })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, TURN, preTurn)
    await recordDashboardTurnPostHash(SCOPE.dashboardId, TURN, hashLayoutDoc(postTurn))

    const result = await revertDashboardTurn(db, SCOPE, TURN)
    expect(result.isOk()).toBe(true)
    expect(row.draftLayout).toEqual(preTurn)
    expect(redisStore.has(KEY)).toBe(false)
    expect(publishDashboardDraftUpdated).toHaveBeenCalledWith(expect.anything(), 'org_1', {
      dashboardId: 'dash_1',
      reason: 'system',
    })
  })

  // Refusal 1: nothing to undo, and nothing touched.
  it('404s when there is no snapshot under this turn id', async () => {
    const { db, row } = makeDb({ draftLayout: postTurn })
    const result = await revertDashboardTurn(db, SCOPE, TURN)
    expect(result._unsafeUnwrapErr()).toBeInstanceOf(NotFoundError)
    expect(row.draftLayout).toEqual(postTurn)
    expect(publishDashboardDraftUpdated).not.toHaveBeenCalled()
  })

  it('404s for a turn that was superseded by a later one', async () => {
    const { db } = makeDb({ draftLayout: postTurn })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, 'turn_b', preTurn)
    expect((await revertDashboardTurn(db, SCOPE, TURN))._unsafeUnwrapErr()).toBeInstanceOf(
      NotFoundError
    )
  })

  // Refusal 2, and the snapshot MUST survive it: the user may still want the
  // Undo after undoing the newer change by hand.
  it('409s when the dashboard moved on, and LEAVES THE SNAPSHOT IN PLACE', async () => {
    const { db, row } = makeDb({ draftLayout: movedOn })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, TURN, preTurn)
    await recordDashboardTurnPostHash(SCOPE.dashboardId, TURN, hashLayoutDoc(postTurn))

    const result = await revertDashboardTurn(db, SCOPE, TURN)
    const error = result._unsafeUnwrapErr()
    expect(error).toBeInstanceOf(ConflictError)
    expect(error.details.reason).toBe('canvas-changed-since-turn')
    expect(row.draftLayout).toEqual(movedOn)
    expect(await readDashboardTurnSnapshot(SCOPE.dashboardId, TURN)).not.toBeNull()
    expect(publishDashboardDraftUpdated).not.toHaveBeenCalled()
  })

  // Unknown must not turn a legitimate Undo into a hard refusal: a turn that
  // died before any stamp landed is exactly the turn most worth undoing.
  it('fails OPEN when the post-turn hash was never stamped', async () => {
    const { db, row } = makeDb({ draftLayout: movedOn })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, TURN, preTurn)
    expect((await revertDashboardTurn(db, SCOPE, TURN)).isOk()).toBe(true)
    expect(row.draftLayout).toEqual(preTurn)
  })

  it('fails OPEN when the live draft has no hash at all', async () => {
    const { db, row } = makeDb({ draftLayout: null })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, TURN, preTurn)
    await recordDashboardTurnPostHash(SCOPE.dashboardId, TURN, hashLayoutDoc(postTurn))
    expect((await revertDashboardTurn(db, SCOPE, TURN)).isOk()).toBe(true)
    expect(row.draftLayout).toEqual(preTurn)
  })

  it('leaves the snapshot in place when the restore itself fails', async () => {
    const { db } = makeDb({ draftLayout: postTurn, archivedAt: new Date() })
    await captureDashboardTurnSnapshot(SCOPE.dashboardId, TURN, preTurn)
    await recordDashboardTurnPostHash(SCOPE.dashboardId, TURN, hashLayoutDoc(postTurn))
    expect((await revertDashboardTurn(db, SCOPE, TURN)).isErr()).toBe(true)
    expect(await readDashboardTurnSnapshot(SCOPE.dashboardId, TURN)).not.toBeNull()
  })
})
