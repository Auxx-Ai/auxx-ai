// apps/web/src/components/permissions/ui/record-share-copy.test.ts
//
// Plan v3/03 §6.2/§6.3 (P5) — **the share dialog reaches records**.
//
// `InstanceShareBody` / `Card` narrowed on `key in INSTANCE_SHARE_COPY`, and a
// record definition's key is a per-org CUID — so the test could never be true
// and a record row rendered NOTHING. The fix is a def-singular-name fallback,
// not a per-def copy table.
//
// These tests pin the RESOLUTION (which lane a target takes, and what it says),
// which is the part that decides whether anything renders at all. The React
// wiring on top of it is two `if (!copy) return null` guards.

import { describe, expect, it } from 'vitest'
import { INSTANCE_SHARE_COPY, type InstanceShareCopy, recordShareCopy } from './instance-share-copy'

/** A per-org record definition CUID — never a key of the registry. */
const CUSTOM_DEF = 'edf_workorder00000000000000'

/**
 * The resolver's decision, spelled out. Mirrors `useInstanceShareCopy`'s
 * `useMemo` body minus the two React reads (`useResource` for the label), so
 * this file needs no renderer.
 */
function resolve(key: string, label?: string): InstanceShareCopy | null {
  if (key in INSTANCE_SHARE_COPY) {
    return INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY]
  }
  // Mail sharing defs have their own family and, for `contact`, a live keyspace
  // hazard (§10.1) — they never take the record lane.
  if (key === 'thread' || key === 'contact') return null
  if (!label) return null
  return recordShareCopy(label)
}

describe('a RECORD def now resolves copy — the narrowing that returned null', () => {
  it('a custom def CUID is NOT a registry key, and used to render nothing', () => {
    expect(CUSTOM_DEF in INSTANCE_SHARE_COPY).toBe(false)
  })

  it('…and now resolves a record-lane entry keyed off the def SINGULAR name', () => {
    const copy = resolve(CUSTOM_DEF, 'Work order')
    expect(copy).not.toBeNull()
    expect(copy?.noun).toBe('work order')
    expect(copy?.lane).toBe('record')
  })

  it('the level labels are the RECORD lane verbs, including re-share at Full', () => {
    const copy = recordShareCopy('Deal')
    expect(copy.levels.read).toBe('View this deal')
    expect(copy.levels.write).toBe('Edit this deal')
    expect(copy.levels.full).toContain('re-share')
  })

  it('the inherited-access footer names the DEF level, not a workspace baseline', () => {
    // §6.3: "same slot, per-domain content". A record's non-local source is its
    // definition level; there is no per-instance baseline row to describe.
    const copy = recordShareCopy('Deal')
    expect(copy.baselineHint).toContain('deals')
    expect(copy.baselineReachNote).toBeUndefined()
  })

  it('declares NO workspace baseline — the record lane is raise-only (D7)', () => {
    // The write path rejects `rung: 'none'` for record defs, so a "Restricted"
    // control would offer a state the server refuses to store. `lane: 'record'`
    // is what suppresses that row.
    expect(recordShareCopy('Deal').lane).toBe('record')
    expect(INSTANCE_SHARE_COPY.dataset.lane).not.toBe('record')
  })

  it('degrades to "record" rather than an empty noun', () => {
    expect(recordShareCopy('   ').noun).toBe('record')
  })
})

describe('the instance lane is untouched', () => {
  it('every registry key still resolves its own hand-authored entry', () => {
    for (const key of Object.keys(INSTANCE_SHARE_COPY)) {
      expect(resolve(key)).toBe(INSTANCE_SHARE_COPY[key as keyof typeof INSTANCE_SHARE_COPY])
    }
  })

  it('a registry key is never re-shaped by the record fallback', () => {
    expect(resolve('dataset', 'Dataset')?.lane).not.toBe('record')
  })
})

describe('the two exclusions are deliberate', () => {
  it('`thread` and `contact` stay OUT — they have their own share family', () => {
    // `contact` matters most: a CUID-keyed contact grant canonicalizes into the
    // MAIL keyspace and fans a lens across that contact's whole conversation
    // history (§10.1 / `project_contact_keyspace_collision`).
    expect(resolve('thread', 'Thread')).toBeNull()
    expect(resolve('contact', 'Contact')).toBeNull()
  })

  it('an unhydrated def renders nothing rather than a dialog titled "Share item"', () => {
    expect(resolve(CUSTOM_DEF, undefined)).toBeNull()
  })
})
