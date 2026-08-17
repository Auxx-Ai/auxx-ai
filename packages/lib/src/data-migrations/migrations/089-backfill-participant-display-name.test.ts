// packages/lib/src/data-migrations/migrations/089-backfill-participant-display-name.test.ts

import { describe, expect, it } from 'vitest'
import { calculateDisplayName } from '../../ingest/participants/display'
import { ALL_DATA_MIGRATIONS } from '../registry'
import {
  DISPLAY_NAME_SQL,
  migration089BackfillParticipantDisplayName as migration,
} from './089-backfill-participant-display-name'

/**
 * Row-level behaviour is pinned against a real database in
 * `089-backfill-participant-display-name.int.test.ts`. What is worth pinning
 * WITHOUT one is the id/registry contract and the one property of the SQL that a
 * well-meaning simplification would destroy.
 */
describe('migration089BackfillParticipantDisplayName', () => {
  it('is registered with the id its filename claims', () => {
    expect(migration.id).toBe('089-backfill-participant-display-name')
  })

  it('is registered exactly once', () => {
    expect(ALL_DATA_MIGRATIONS.filter((m) => m.id === migration.id)).toHaveLength(1)
  })

  /**
   * 🔴 The plan that owed this migration wrote it as
   * `SET "displayName" = identifier WHERE "displayName" IS NULL`. That is wrong for
   * 316 of the 403 NULL rows on the dev database, which carry a real name — and
   * wrong in the direction that defeats the migration's purpose, since the fuzzy
   * arm would then match an address rather than a name.
   *
   * Pinned on the rendered SQL because the ordering IS the correctness property:
   * `name` must be consulted first, exactly as `calculateDisplayName` does.
   */
  it('prefers `name` over `identifier`, like the write path', () => {
    const namePosition = DISPLAY_NAME_SQL.indexOf('p."name"')
    const identifierPosition = DISPLAY_NAME_SQL.indexOf('p."identifier"')
    expect(namePosition).toBeGreaterThan(-1)
    expect(identifierPosition).toBeGreaterThan(-1)
    expect(namePosition).toBeLessThan(identifierPosition)

    // …and the function it mirrors agrees, so this is not a claim about a
    // hand-remembered ordering.
    expect(calculateDisplayName('Daniel Jackson', 'daniel@example.com')).toBe('Daniel Jackson')
    expect(calculateDisplayName(null, 'daniel@example.com')).toBe('daniel@example.com')
  })

  /**
   * The both-blank case is why this is a backfill and NOT a `SET NOT NULL`:
   * `calculateDisplayName` genuinely returns `undefined` there, ingest must never
   * throw, and so a row can legitimately stay NULL after this runs.
   */
  it('leaves the both-blank case NULL rather than writing an empty string', () => {
    expect(calculateDisplayName(null, null)).toBeUndefined()
    expect(calculateDisplayName('   ', '   ')).toBeUndefined()
    expect(migration.run.toString()).toContain('IS NOT NULL')
  })

  /** Idempotence rests entirely on this predicate — the runner restarts from the top. */
  it('only ever matches rows that are still NULL', () => {
    expect(migration.run.toString()).toContain('p."displayName" IS NULL')
  })
})
