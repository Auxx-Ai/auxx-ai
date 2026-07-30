// packages/lib/src/permissions/capabilities/instance-access.test.ts

import { describe, expect, it } from 'vitest'
import type { OrgSharedInstanceAccessKey, PrivateInstanceAccessKey } from './entity-access'
import {
  INSTANCE_ACCESS_KEYS,
  INSTANCE_ACCESS_READ_KEYS,
  INSTANCE_ACCESS_RESOURCES,
  type InstanceAccessKey,
  isInstanceAccessKey,
  RECORD_DEF_RUNGS,
} from './instance-access'
import { Area } from './registry'
import { RUNG_ORDER, type Rung } from './rung'

/**
 * The nine BLOB-LANE keys, hand-listed on purpose. Every derivation in this file
 * is generic over the registry, so a hand-written list is the only thing that
 * catches a key silently joining or leaving the lane.
 */
const BLOB_LANE_KEYS = [
  'dataset',
  'kb',
  'dashboard',
  'workflow',
  'agent',
  'signature',
  'snippet',
  'inbox',
  'personal_inbox',
] as const

const QUERY_LANE_KEYS = ['thread', 'sequence'] as const

describe('isInstanceAccessKey — the blob-lane gate', () => {
  /**
   * The single most important assertion in this file. `isInstanceAccessKey` is
   * the switch on six behaviours (share authorization routing, the `none`
   * rejection, instance-changed realtime emission, the `governingInstanceIds`
   * SQL filter, `deriveInstanceReadKeys`, and the `OrgSharedInstanceAccessKey`
   * compile-error property). A query-lane declaration must never flip it.
   *
   * Plan v3/03 P4 raised the stakes on the fifth: the capability composer's
   * instance query no longer filters by def in SQL, so `thread` and record-def
   * rows now REACH the composer and are dropped by `isInstanceAccessKey` in
   * `flattenBlobLane` / `deriveInstanceReadKeys` instead. The predicate went from
   * a second line of defence to the only one — see
   * `resource-access/instance-grants.test.ts`.
   */
  it.each(QUERY_LANE_KEYS)('rejects the query-lane key %s', (key) => {
    expect(isInstanceAccessKey(key)).toBe(false)
    expect(INSTANCE_ACCESS_KEYS).not.toContain(key)
  })

  it.each(BLOB_LANE_KEYS)('accepts the blob-lane key %s', (key) => {
    expect(isInstanceAccessKey(key)).toBe(true)
    expect(INSTANCE_ACCESS_KEYS).toContain(key)
  })

  it('rejects a record-def CUID and any unknown string', () => {
    expect(isInstanceAccessKey('clx0000000000000000000000')).toBe(false)
    expect(isInstanceAccessKey('')).toBe(false)
    expect(isInstanceAccessKey('ticket')).toBe(false)
  })

  it('does not answer for inherited Object properties', () => {
    expect(isInstanceAccessKey('toString')).toBe(false)
    expect(isInstanceAccessKey('constructor')).toBe(false)
  })
})

describe('INSTANCE_ACCESS_KEYS', () => {
  it('is exactly the nine blob-lane keys', () => {
    expect(INSTANCE_ACCESS_KEYS.length).toBe(9)
    expect([...INSTANCE_ACCESS_KEYS].sort()).toEqual([...BLOB_LANE_KEYS].sort())
  })

  it('derives a read-key entry for every blob-lane key and nothing else', () => {
    expect(Object.keys(INSTANCE_ACCESS_READ_KEYS).sort()).toEqual([...BLOB_LANE_KEYS].sort())
  })
})

describe('per-domain rung declarations', () => {
  /**
   * The invariant that lets a future rung be inserted between two existing ones
   * without a data migration: the persisted value is the NAME, and every
   * declaration is an ascending, duplicate-free subset of the one ladder.
   */
  it.each(
    Object.keys(INSTANCE_ACCESS_RESOURCES) as Array<keyof typeof INSTANCE_ACCESS_RESOURCES>
  )('%s declares rungs ascending by RUNG_ORDER with no duplicates', (key) => {
    const rungs = INSTANCE_ACCESS_RESOURCES[key].rungs as readonly Rung[]
    expect(rungs.length).toBeGreaterThan(0)
    expect(new Set(rungs).size).toBe(rungs.length)
    for (let i = 1; i < rungs.length; i++) {
      const lower = rungs[i - 1] as Rung
      const higher = rungs[i] as Rung
      expect(RUNG_ORDER[lower], `${key}: ${lower} before ${higher}`).toBeLessThan(
        RUNG_ORDER[higher]
      )
    }
  })

  it('keeps the config-scale vocabulary at none/read/edit/admin', () => {
    for (const key of ['dataset', 'kb', 'dashboard', 'workflow', 'agent', 'signature', 'snippet']) {
      expect(INSTANCE_ACCESS_RESOURCES[key as InstanceAccessKey].rungs, `${key} rungs`).toEqual([
        'none',
        'read',
        'edit',
        'admin',
      ])
    }
    expect(RECORD_DEF_RUNGS).toEqual(['none', 'read', 'edit', 'admin'])
  })

  it('gives both inbox keys the mail vocabulary — metadata/identity, no edit', () => {
    for (const key of ['inbox', 'personal_inbox'] as const) {
      expect(INSTANCE_ACCESS_RESOURCES[key].rungs).toEqual([
        'none',
        'metadata',
        'identity',
        'read',
        'admin',
      ])
    }
  })

  it('declares thread with actAt: read — mail read confers reply/assign', () => {
    expect(INSTANCE_ACCESS_RESOURCES.thread.rungs).toEqual(['none', 'metadata', 'identity', 'read'])
    expect(INSTANCE_ACCESS_RESOURCES.thread.actAt).toBe('read')
    // `edit` is absent from the vocabulary, so "acting starts at edit" cannot be
    // the default reading for this domain — hence the explicit `actAt`.
    expect(INSTANCE_ACCESS_RESOURCES.thread.rungs).not.toContain('edit')
  })

  it('declares sequence on the query lane with the config-scale vocabulary', () => {
    expect(INSTANCE_ACCESS_RESOURCES.sequence.lane).toBe('query')
    expect(INSTANCE_ACCESS_RESOURCES.sequence.rungs).toEqual(['none', 'read', 'edit', 'admin'])
  })
})

describe('blob-lane posture is unchanged by the lane split', () => {
  const EXPECTED: Record<InstanceAccessKey, { baselineAtCreate: boolean; area: Area }> = {
    dataset: { baselineAtCreate: false, area: Area.datasets },
    kb: { baselineAtCreate: false, area: Area.knowledgeBase },
    dashboard: { baselineAtCreate: true, area: Area.dashboards },
    workflow: { baselineAtCreate: false, area: Area.workflows },
    agent: { baselineAtCreate: false, area: Area.agents },
    signature: { baselineAtCreate: true, area: Area.signatures },
    snippet: { baselineAtCreate: true, area: Area.snippets },
    inbox: { baselineAtCreate: false, area: Area.inboxes },
    personal_inbox: { baselineAtCreate: true, area: Area.inboxes },
  }

  it.each(BLOB_LANE_KEYS)('%s keeps its baselineAtCreate and area verbatim', (key) => {
    const cfg = INSTANCE_ACCESS_RESOURCES[key]
    expect(cfg.lane).toBe('blob')
    expect(cfg.baselineAtCreate).toBe(EXPECTED[key].baselineAtCreate)
    expect(cfg.area).toBe(EXPECTED[key].area)
  })
})

/**
 * Compile-time assertions. These are checked by `tsc`, not by the runtime
 * expectations — an `@ts-expect-error` that stops erroring is itself a build
 * failure, which is exactly the safety property `instance-access.ts` documents
 * for `personal_inbox`.
 */
describe('derived key unions stay narrow (type-level)', () => {
  it('admits org-shared keys and rejects private ones', () => {
    const orgShared: OrgSharedInstanceAccessKey = 'dataset'
    // @ts-expect-error `personal_inbox` is baselineAtCreate: true — a list query
    // over it would leak other people's mailboxes, so it must fail the build.
    const leaked: OrgSharedInstanceAccessKey = 'personal_inbox'
    expect(orgShared).toBe('dataset')
    expect(leaked).toBe('personal_inbox')
  })

  it('admits private keys and rejects org-shared ones', () => {
    const priv: PrivateInstanceAccessKey = 'personal_inbox'
    // @ts-expect-error `dataset` falls back to the area level, not to no-access.
    const wrongScope: PrivateInstanceAccessKey = 'dataset'
    expect(priv).toBe('personal_inbox')
    expect(wrongScope).toBe('dataset')
  })

  it('keeps query-lane keys out of InstanceAccessKey entirely', () => {
    // @ts-expect-error `thread` is query-lane; it is not an instance-access key.
    const thread: InstanceAccessKey = 'thread'
    // @ts-expect-error `sequence` is query-lane; it is not an instance-access key.
    const sequence: InstanceAccessKey = 'sequence'
    expect(thread).toBe('thread')
    expect(sequence).toBe('sequence')
  })
})
