// packages/lib/src/seed/entity-migrations/migrations/111-order-build-drift.test.ts
//
// Migration 111 adds two `CustomField` rows, so what can silently go wrong is
// the wiring rather than the write:
//
//  - the id must be unique across a space shared with `data-migrations/`, which
//    has already collided once at 103;
//  - it must run after 109, which creates the `build` def it hangs a field on;
//  - the registry keys it names must exist, or it quietly creates one field
//    fewer than it claims to;
//  - both fields must reach the migration as system fields the reconciler can
//    find by `systemAttribute`.

import { describe, expect, it } from 'vitest'
import { BUILD_FIELDS } from '../../../resources/registry/resources/build-fields'
import { ORDER_FIELDS } from '../../../resources/registry/resources/order-fields'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { migration111OrderBuildDrift } from './111-order-build-drift'

describe('migration 111 registration', () => {
  it('is registered exactly once, with a unique id, after 109', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '111-order-build-drift')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('111-order-build-drift')).toBeGreaterThan(
      ids.indexOf('109-build-and-standard-cost')
    )
    expect(migration111OrderBuildDrift.id).toBe('111-order-build-drift')
  })

  it('is last — a later migration must take 112, not reuse this number', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.at(-1)).toBe('111-order-build-drift')
  })
})

describe('the fields it names exist and are shaped for the reconciler', () => {
  it('order carries `buildRevision` as a system field on `order_build_revision`', () => {
    const field = ORDER_FIELDS.buildRevision
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('order_build_revision')
    expect(field?.isSystem).toBe(true)
    expect(field?.nullable).toBe(true)
  })

  it('build carries `orderRevision` as a system field on `build_order_revision`', () => {
    const field = BUILD_FIELDS.orderRevision
    expect(field).toBeDefined()
    expect(field?.systemAttribute).toBe('build_order_revision')
    expect(field?.isSystem).toBe(true)
    expect(field?.nullable).toBe(true)
  })

  it('neither is hand-writable — the stamp is the only writer of each', () => {
    // A typed-in value would silence the drift signal on exactly the order
    // somebody was looking at, which is worse than having no signal.
    expect(ORDER_FIELDS.buildRevision?.capabilities.updatable).toBe(false)
    expect(ORDER_FIELDS.buildRevision?.capabilities.creatable).toBe(false)
    expect(BUILD_FIELDS.orderRevision?.capabilities.updatable).toBe(false)
    // `creatable` on the build side only, because `createBuild` sets it on the
    // insert rather than following up with a second write.
    expect(BUILD_FIELDS.orderRevision?.capabilities.creatable).toBe(true)
  })

  it('keeps both out of the panel, the table and the dialog', () => {
    // An opaque SHA-256. Nobody reads a hash off a screen, and a column of them
    // would push a real one out of view.
    for (const field of [ORDER_FIELDS.buildRevision, BUILD_FIELDS.orderRevision]) {
      expect(field?.showInPanel).toBe(false)
      expect(field?.showInTable).toBe(false)
      expect(field?.showInDialogs).toBe(false)
    }
  })

  it('does not collide with an existing sort order on either def', () => {
    const collisions = (fields: Record<string, { systemSortOrder?: string }>, key: string) =>
      Object.entries(fields).filter(
        ([name, f]) => name !== key && f.systemSortOrder === fields[key]?.systemSortOrder
      )
    expect(collisions(ORDER_FIELDS, 'buildRevision')).toEqual([])
    expect(collisions(BUILD_FIELDS, 'orderRevision')).toEqual([])
  })
})
