// apps/web/src/components/resources/store/record-store-access-refresh.test.ts
//
// `requestAccessRefresh` — the recovery path for a STALE `_access` stamp.
//
// `_access` is the only field on a cached row that goes stale without the row
// changing: it is the viewer's row-effective rung, folded server-side per query,
// and this store is the only cache of that fold anywhere. Three dedupes made it
// permanent for a session (`useRecordList` skips loaded ids, `requestRecord`
// returns early for the same reason, `record.getByIds` is `staleTime: Infinity`),
// so a member granted `edit` on a row stayed read-only in the drawer and the grid
// until a full page reload.

import { beforeEach, describe, expect, it } from 'vitest'
import { getRecordStoreState } from './record-store'
import { getRelationshipStoreState } from './relationship-store'
import { getResourceStoreState } from './resource-store'

const DEF = 'cmticketdef1234567890a'

beforeEach(() => {
  getResourceStoreState().reset()
  getRecordStoreState().clearAll()
  getRelationshipStoreState().reset()
})

/** A stamped row as `use-record-batch-fetcher` writes it. */
const row = (id: string, access: string) => ({ id, _access: access }) as never

describe('recordStore.requestAccessRefresh', () => {
  it('re-queues rows that requestRecord refuses to re-fetch', () => {
    const store = getRecordStoreState()
    store.setRecords(DEF, [row('a', 'read'), row('b', 'read')])

    // The dedupe this exists to defeat: the rows are present, so the ordinary
    // request path is a no-op and the stale stamps would live forever.
    store.requestRecord(`${DEF}:a`)
    store.requestRecord(`${DEF}:b`)
    expect(getRecordStoreState().pendingFetchIds.size).toBe(0)

    getRecordStoreState().requestAccessRefresh()

    expect([...getRecordStoreState().pendingFetchIds].sort()).toEqual([`${DEF}:a`, `${DEF}:b`])
  })

  it('leaves the existing rows in place, so nothing blanks mid-refresh', () => {
    // An implementation that removed the rows to force a re-fetch would drop
    // `_access` to `undefined` for the duration, which `useRecordAccessAt` reads
    // as the DEF rung — flashing the wrong affordances on every loaded row.
    const store = getRecordStoreState()
    store.setRecords(DEF, [row('a', 'read')])

    getRecordStoreState().requestAccessRefresh()

    const kept = getRecordStoreState().records[DEF]?.get('a') as { _access?: string } | undefined
    expect(kept?._access).toBe('read')
  })

  it('does not re-queue a row whose refresh is already in flight', () => {
    // Two `capabilities:changed` events in quick succession — a share plus the
    // role change that motivated it — must not stack a second copy of the same
    // id, and must not re-queue one the drain has already taken.
    const store = getRecordStoreState()
    store.setRecords(DEF, [row('a', 'read')])

    getRecordStoreState().requestAccessRefresh()
    getRecordStoreState().requestAccessRefresh() // still PENDING
    expect([...getRecordStoreState().pendingFetchIds]).toEqual([`${DEF}:a`])

    getRecordStoreState().startBatch() // pending → LOADING
    expect(getRecordStoreState().loadingIds.has(`${DEF}:a`)).toBe(true)

    getRecordStoreState().requestAccessRefresh()
    expect(getRecordStoreState().pendingFetchIds.size).toBe(0)
  })

  it('is a no-op when nothing is loaded', () => {
    getRecordStoreState().requestAccessRefresh()
    expect(getRecordStoreState().pendingFetchIds.size).toBe(0)
  })

  it('refreshed rows carry the NEW stamp once the batch lands', () => {
    // End-to-end through the real drain: queue → startBatch → setRecords, which
    // is exactly what `use-record-batch-fetcher` does with the `getByIds`
    // response. The point is that `setRecords` replaces the row, so the new
    // rung wins rather than being merged away.
    const store = getRecordStoreState()
    store.setRecords(DEF, [row('a', 'read')])

    getRecordStoreState().requestAccessRefresh()
    const batch = getRecordStoreState().startBatch()
    expect(batch).toEqual([`${DEF}:a`])

    getRecordStoreState().setRecords(DEF, [row('a', 'edit')])

    const refreshed = getRecordStoreState().records[DEF]?.get('a') as
      | { _access?: string }
      | undefined
    expect(refreshed?._access).toBe('edit')
  })
})
