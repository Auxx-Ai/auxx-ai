// packages/lib/src/data-migrations/migrations/088-phone-geo-backfill.test.ts

import { describe, expect, it } from 'vitest'
import { CONTACT_FIELDS } from '../../resources/registry/resources/contact-fields'
import { ALL_DATA_MIGRATIONS } from '../registry'
import { migration088PhoneGeoBackfill } from './088-phone-geo-backfill'

/**
 * The backfill's row-level behaviour needs a database; what is worth pinning without one is the
 * set of assumptions it would silently violate if the registry moved underneath it.
 */
describe('migration088PhoneGeoBackfill', () => {
  it('is registered with the id its filename claims', () => {
    expect(migration088PhoneGeoBackfill.id).toBe('088-phone-geo-backfill')
  })

  it('is registered exactly once', () => {
    const matches = ALL_DATA_MIGRATIONS.filter((m) => m.id === migration088PhoneGeoBackfill.id)
    expect(matches).toHaveLength(1)
  })

  it('targets system attributes that actually exist on the contact registry', () => {
    // The four fields it fills, plus the one it reads. A rename on either side would turn the
    // backfill into a silent no-op — it matches on `systemAttribute` strings.
    for (const key of ['phone', 'city', 'region', 'country', 'timezone'] as const) {
      expect(CONTACT_FIELDS[key]?.systemAttribute).toBe(key)
    }
  })

  /**
   * Load-bearing, for the same reason migration 086 needed it: `phone` is a generic attribute
   * name that ORG-CREATED defs reuse (the dev DB carries it on `leads` and `vendors`). Without
   * the `entityType` join the backfill would walk records on defs that have no geo fields to
   * fill.
   */
  it('is scoped to the seeded contact def', () => {
    const source = migration088PhoneGeoBackfill.run.toString()
    expect(source).toContain('EntityDefinition')
    expect(source).toContain("entityType\" = 'contact'")
  })

  /**
   * The fill-if-blank rule is the whole safety story: area-code geo is the weakest of the three
   * producers (chat visitor-IP geo and human input both outrank it), so the backfill must skip
   * any contact that already holds a value rather than overwrite it.
   */
  it('skips values that are already filled', () => {
    const source = migration088PhoneGeoBackfill.run.toString()
    expect(source).toContain('filledKeys')
    expect(source).toContain('valueText" IS NOT NULL')
  })
})
