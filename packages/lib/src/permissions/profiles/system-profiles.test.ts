// packages/lib/src/permissions/profiles/system-profiles.test.ts
//
// Pins the `accountant` system profile (plans/accounting/HANDOFF.md slot 2K):
// its slug is registered, it carries `ledger: Read` and a BROAD `records: Read`
// (see the departure note on the seed itself for why it is broad rather than
// scoped to the seven named entity types), and it never carries `Full` on
// either area — an accountant profile that can post to the ledger or edit
// records is not the profile the brief asked for.

import { describe, expect, it } from 'vitest'
import { Area, Level } from '../capabilities/registry'
import { SYSTEM_PROFILE_SEEDS, systemProfileSeed } from './system-profiles'
import { SYSTEM_PROFILE_SLUGS } from './types'

describe('the accountant system profile', () => {
  it('is registered in the slug enum exactly once', () => {
    expect(SYSTEM_PROFILE_SLUGS.filter((slug) => slug === 'accountant')).toHaveLength(1)
  })

  it('is seeded exactly once, for members, at USER rank', () => {
    const matches = SYSTEM_PROFILE_SEEDS.filter((seed) => seed.slug === 'accountant')
    expect(matches).toHaveLength(1)
    const seed = matches[0]!
    expect(seed.appliesTo).toBe('member')
    expect(seed.role).toBe('USER')
    expect(seed.agentPolicy).toBeNull()
  })

  it('reads the ledger and reads records, and writes neither', () => {
    const seed = systemProfileSeed('accountant')
    expect(seed?.levels?.[Area.ledger]).toBe(Level.Read)
    expect(seed?.levels?.[Area.records]).toBe(Level.Read)
    expect(seed?.levels?.[Area.ledger]).not.toBe(Level.Full)
    expect(seed?.levels?.[Area.records]).not.toBe(Level.Full)
  })

  it('carries no org-administration access', () => {
    const seed = systemProfileSeed('accountant')
    for (const area of [Area.settings, Area.billing, Area.members, Area.permissions] as const) {
      expect(seed?.levels?.[area]).toBeUndefined()
    }
  })
})
