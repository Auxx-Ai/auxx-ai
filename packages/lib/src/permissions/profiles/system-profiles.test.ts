// packages/lib/src/permissions/profiles/system-profiles.test.ts
//
// Pins the `accountant` and `bookkeeper` system profiles (task 12 §4.2): with
// the seven ledger-artifact defs routed through `Area.ledger` via
// `ENTITY_BASE_AREAS` (task 12 §4.1), neither profile needs `Area.records` to
// reach the general ledger, so both OMIT it entirely: an accountant or
// bookkeeper sees the ledger and nothing else in the workspace, not every
// contact, company, ticket, quote or work order. `accountant` is read-only
// (`ledger: Read`); `bookkeeper` posts and reverses (`ledger: Edit`) but
// cannot touch the chart, the opening balance or the period lock, all of
// which sit at `ledger: Full`.

import { describe, expect, it } from 'vitest'
import { Area, Level } from '../capabilities/registry'
import { SYSTEM_PROFILE_SEEDS, systemProfileSeed } from './system-profiles'
import { SYSTEM_PROFILE_SLUGS } from './types'

const ORG_ADMIN_AREAS = [
  Area.settings,
  Area.members,
  Area.billing,
  Area.permissions,
  Area.channels,
  Area.inboxes,
] as const

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

  it('carries no Area.records entry, the seven ledger defs arrive through ENTITY_BASE_AREAS', () => {
    const seed = systemProfileSeed('accountant')
    expect(seed?.levels?.[Area.records]).toBeUndefined()
  })

  it('reads the ledger and never writes it', () => {
    const seed = systemProfileSeed('accountant')
    expect(seed?.levels?.[Area.ledger]).toBe(Level.Read)
    expect(seed?.levels?.[Area.ledger]).not.toBe(Level.Edit)
    expect(seed?.levels?.[Area.ledger]).not.toBe(Level.Full)
  })

  it('carries no org-administration access', () => {
    const seed = systemProfileSeed('accountant')
    for (const area of ORG_ADMIN_AREAS) {
      expect(seed?.levels?.[area]).toBeUndefined()
    }
  })
})

describe('the bookkeeper system profile', () => {
  it('is registered in the slug enum exactly once', () => {
    expect(SYSTEM_PROFILE_SLUGS.filter((slug) => slug === 'bookkeeper')).toHaveLength(1)
  })

  it('is seeded exactly once, for members, at USER rank', () => {
    const matches = SYSTEM_PROFILE_SEEDS.filter((seed) => seed.slug === 'bookkeeper')
    expect(matches).toHaveLength(1)
    const seed = matches[0]!
    expect(seed.appliesTo).toBe('member')
    expect(seed.role).toBe('USER')
    expect(seed.agentPolicy).toBeNull()
  })

  it('carries no Area.records entry', () => {
    const seed = systemProfileSeed('bookkeeper')
    expect(seed?.levels?.[Area.records]).toBeUndefined()
  })

  it('posts and reverses (ledger: Edit) but never controls the chart or the period lock', () => {
    const seed = systemProfileSeed('bookkeeper')
    expect(seed?.levels?.[Area.ledger]).toBe(Level.Edit)
    expect(seed?.levels?.[Area.ledger]).not.toBe(Level.Full)
  })

  it('carries no org-administration access', () => {
    const seed = systemProfileSeed('bookkeeper')
    for (const area of ORG_ADMIN_AREAS) {
      expect(seed?.levels?.[area]).toBeUndefined()
    }
  })
})
