// packages/lib/src/seed/entity-migrations/migrations/110-build-visible.test.ts
//
// Migration 110 is a one-column UPDATE, so what can silently go wrong is the
// wiring around it rather than the write:
//
//  - the migration must run AFTER 109, which creates the row it flips;
//  - `SYSTEM_ENTITIES` must carry the same `isVisible` the migration writes, or
//    an org signed up before the deploy and one signed up after it disagree
//    about whether builds appear in the sidebar;
//  - the sidebar builds a system entity's href as `/app/${apiSlug}`, so the
//    apiSlug must stay `builds` — the route folder is `app/builds`, and there is
//    no catch-all for system entities, so a drifted slug is a 404 in the nav.
//
// These pin all three.

import { ModelTypeMeta } from '@auxx/database/enums'
import { describe, expect, it } from 'vitest'
import { ALL_ENTITY_MIGRATIONS } from '../../entity-migrations'
import { SYSTEM_ENTITIES } from '../../entity-seeder/constants'
import {
  BUILD_ENTITY_TYPE,
  migration110BuildVisible,
  resolveBuildVisibility,
} from './110-build-visible'

describe('migration 110 registration', () => {
  it('is registered exactly once, after 109, with a unique id', () => {
    const ids = ALL_ENTITY_MIGRATIONS.map((m) => m.id)
    expect(ids.filter((id) => id === '110-build-visible')).toHaveLength(1)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.indexOf('110-build-visible')).toBe(ids.indexOf('109-build-and-standard-cost') + 1)
    expect(migration110BuildVisible.id).toBe('110-build-visible')
  })
})

describe('the seeder agrees with the migration', () => {
  const build = SYSTEM_ENTITIES.find((e) => e.entityType === BUILD_ENTITY_TYPE)

  it('SYSTEM_ENTITIES seeds a fresh org with the visibility this migration writes', () => {
    // 🛑 The migration reaches EXISTING orgs and this constant reaches fresh
    // ones — `ensureEntityDefinitions` reads `isVisible` at creation time only.
    // Flipping one without the other is exactly the half-migration this pair
    // exists to prevent.
    expect(build, 'build missing from SYSTEM_ENTITIES').toBeDefined()
    expect(build?.isVisible).toBe(true)
  })

  it('keeps the apiSlug the sidebar href and the route folder both assume', () => {
    expect(build?.apiSlug).toBe('builds')
    expect(ModelTypeMeta.build.apiSlug).toBe('builds')
  })

  it('keeps the detail page the [buildId] route provides', () => {
    expect(ModelTypeMeta.build.hasDetailPage).toBe(true)
  })
})

describe('resolveBuildVisibility', () => {
  it('flips a def still carrying the seeded false', () => {
    expect(resolveBuildVisibility(false)).toBe('update')
  })

  it('is a no-op on a def that is already visible', () => {
    // Both a re-run and a fresh org seeded after the SYSTEM_ENTITIES flip.
    expect(resolveBuildVisibility(true)).toBe('up-to-date')
  })
})
