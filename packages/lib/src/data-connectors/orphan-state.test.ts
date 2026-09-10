// packages/lib/src/data-connectors/orphan-state.test.ts
// The archive-cap keys live on the SHARED `DataConnector.state` jsonb, next to the sync
// cursor and the backfill latch. These tests pin the shape of every write: one key
// merged with `jsonb_set(coalesce(state, '{}'))` or removed with `state - 'key'`,
// never a replaced column. The default vitest config mocks `@auxx/database` (columns
// are `{}`), so the SQL cannot be rendered here; the string chunks of the expression
// and the WHERE are what is asserted. `orphan-state.int.test.ts` runs the same
// functions against a real database and proves the unrelated key survives.

import { is, Param, SQL, StringChunk } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearArchiveCapTripped,
  listMintedInstanceIds,
  setArchiveCapTripped,
  takeArchiveCapOverride,
} from './orphan-state'

/**
 * The literal SQL text of an expression, with `?` where a bound parameter sits and
 * `<col>` where a (mocked, undefined) column reference sits. A raw string or boolean
 * interpolated into a `sql` template is a parameter, not SQL text.
 */
function text(chunk: unknown): string {
  if (is(chunk, SQL)) return chunk.queryChunks.map(text).join('')
  if (is(chunk, StringChunk)) return chunk.value.join('')
  if (is(chunk, Param)) return '?'
  if (Array.isArray(chunk)) return chunk.map(text).join('')
  if (chunk === undefined) return '<col>'
  if (typeof chunk === 'string' || typeof chunk === 'boolean' || typeof chunk === 'number') {
    return '?'
  }
  return '<table>'
}

/** Every bound parameter value in an expression, in order. */
function params(chunk: unknown): unknown[] {
  const out: unknown[] = []
  const walk = (c: unknown) => {
    if (is(c, SQL)) for (const q of c.queryChunks) walk(q)
    else if (is(c, Param)) out.push(c.value)
    else if (Array.isArray(c)) for (const q of c) walk(q)
    else if (typeof c === 'string' || typeof c === 'boolean') out.push(c)
  }
  walk(chunk)
  return out
}

const calls = {
  updates: [] as Array<{ patch: Record<string, unknown>; where: unknown; returning?: unknown }>,
  selects: [] as Array<{ projection: Record<string, unknown>; where: unknown }>,
}
let returningRows: unknown[] = []
let selectRows: unknown[] = []

const db = {
  update: () => ({
    set: (patch: Record<string, unknown>) => ({
      where: (where: unknown) => {
        const entry = { patch, where } as (typeof calls.updates)[number]
        calls.updates.push(entry)
        // A write without RETURNING awaits this (non-thenable) object directly.
        return {
          returning: async (projection: unknown) => {
            entry.returning = projection
            return returningRows
          },
        }
      },
    }),
  }),
  select: (projection: Record<string, unknown>) => ({
    from: () => ({
      where: async (where: unknown) => {
        calls.selects.push({ projection, where })
        return selectRows
      },
    }),
  }),
}
const DB = db as never

beforeEach(() => {
  calls.updates = []
  calls.selects = []
  returningRows = []
  selectRows = []
})

describe('setArchiveCapTripped', () => {
  it('merges the one key with jsonb_set over a coalesced state, never replacing the column', async () => {
    const stamp = {
      at: '2026-09-09T01:02:03.000Z',
      runId: 'run-1',
      orphans: 30,
      bound: 100,
      reason: '30 of 100 bound records (30%) vanished from the crawl',
    }
    await setArchiveCapTripped(DB, 'dc1', stamp)
    expect(calls.updates).toHaveLength(1)
    const { patch, where } = calls.updates[0]!
    expect(is(patch.state, SQL)).toBe(true)
    expect(text(patch.state)).toBe(
      "jsonb_set(coalesce(<col>, '{}'::jsonb), '{archiveCapTripped}', ?::jsonb, true)"
    )
    expect(params(patch.state)).toEqual([JSON.stringify(stamp)])
    expect(patch.updatedAt).toBeInstanceOf(Date)
    expect(params(where)).toEqual(['dc1'])
  })
})

describe('clearArchiveCapTripped', () => {
  it('removes only that key, and only from a row that carries it', async () => {
    await clearArchiveCapTripped(DB, 'dc1')
    const { patch, where } = calls.updates[0]!
    expect(text(patch.state)).toBe("coalesce(<col>, '{}'::jsonb) - 'archiveCapTripped'")
    expect(text(where)).toContain("jsonb_exists(<col>, 'archiveCapTripped')")
    expect(params(where)).toEqual(['dc1'])
  })
})

describe('takeArchiveCapOverride', () => {
  it('reads and removes the key in ONE guarded UPDATE ... RETURNING the pre-update value', async () => {
    returningRows = [{ override: { at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' } }]
    const taken = await takeArchiveCapOverride(DB, 'dc1')
    expect(taken).toEqual({ at: '2026-09-09T00:00:00.000Z', byUserId: 'u1' })
    expect(calls.updates).toHaveLength(1)
    const { patch, where, returning } = calls.updates[0]!
    expect(text(patch.state)).toBe("coalesce(<col>, '{}'::jsonb) - 'archiveCapOverride'")
    expect(text(where)).toContain("jsonb_exists(<col>, 'archiveCapOverride')")
    expect(params(where)).toEqual(['dc1'])
    // The old value comes from a sub-select on the same row, which sees the
    // statement's own snapshot (pre-update), not the row it just rewrote.
    expect(text((returning as { override: unknown }).override)).toContain(
      "select o.state -> 'archiveCapOverride' from"
    )
  })

  it('returns null when the WHERE matched nothing (already consumed, or never set)', async () => {
    returningRows = []
    expect(await takeArchiveCapOverride(DB, 'dc1')).toBeNull()
  })
})

describe('listMintedInstanceIds', () => {
  it('skips the query for an empty candidate set', async () => {
    expect(await listMintedInstanceIds(DB, 'dc1', [])).toEqual(new Set())
    expect(calls.selects).toHaveLength(0)
  })

  it('scopes to the connector and matches on either the live minted binding or the sticky mint', async () => {
    selectRows = [
      { bound: 'i-1', boundMinted: true, minted: null },
      // Matched on the sticky column alone: its CURRENT binding is not minted.
      { bound: 'i-2', boundMinted: false, minted: 'i-3' },
      // A sticky value outside the candidate set never leaks in.
      { bound: null, boundMinted: false, minted: 'i-elsewhere' },
    ]
    const minted = await listMintedInstanceIds(DB, 'dc1', ['i-1', 'i-2', 'i-3'])
    expect(minted).toEqual(new Set(['i-1', 'i-3']))
    expect(calls.selects).toHaveLength(1)
    const where = calls.selects[0]!.where
    expect(params(where)).toEqual(['dc1', true, 'i-1', 'i-2', 'i-3', 'i-1', 'i-2', 'i-3'])
  })
})
