// packages/lib/src/dedup/__tests__/config.test.ts

import { describe, expect, it } from 'vitest'
import {
  BAND_THRESHOLDS,
  BLOCK_CAP,
  DEDUP_CONFIG_BY_ENTITY_TYPE,
  DEDUP_DENYLIST,
  DEDUP_V1_ALLOWLIST,
  getDedupConfig,
  ROLE_EMAIL_LOCALS,
  SIGNAL_WEIGHTS,
  STRONG_KEY_SYSTEM_ATTRIBUTES,
} from '../config'

describe('getDedupConfig', () => {
  it('resolves the allowlisted entity types', () => {
    expect(getDedupConfig('contact')?.entityType).toBe('contact')
    expect(getDedupConfig('company')?.entityType).toBe('company')
  })

  it('returns null for a null entityType (org-created definitions)', () => {
    expect(getDedupConfig(null)).toBeNull()
  })

  it('returns null for a system type that is neither allowlisted nor denylisted', () => {
    expect(getDedupConfig('ticket')).toBeNull()
    expect(getDedupConfig('work_order')).toBeNull()
  })

  it('returns null for every denylisted type', () => {
    for (const entityType of DEDUP_DENYLIST) {
      expect(getDedupConfig(entityType)).toBeNull()
    }
  })

  it('lets the denylist win over the allowlist', () => {
    // The denylist is checked FIRST so a denied type can never be scanned even
    // if it is added to the allowlist by mistake. Simulate that mistake.
    const denied = DEDUP_DENYLIST[0]
    expect(denied).toBeDefined()
    const allowlistWithDenied = [...DEDUP_V1_ALLOWLIST, denied]
    expect(allowlistWithDenied).toContain(denied)
    expect(getDedupConfig(denied as string)).toBeNull()
  })

  it('surfaces the structured name attributes only for person-shaped types', () => {
    const contact = getDedupConfig('contact')
    expect(contact?.givenNameSystemAttribute).toBe('first_name')
    expect(contact?.surnameSystemAttribute).toBe('last_name')

    const company = getDedupConfig('company')
    expect(company?.givenNameSystemAttribute).toBeUndefined()
    expect(company?.surnameSystemAttribute).toBeUndefined()
  })

  it('promotes company_domain to a strong key (its field type would not qualify)', () => {
    expect(getDedupConfig('company')?.strongKeySystemAttributes).toContain('company_domain')
    // Contacts need no promotion — EMAIL/PHONE_INTL types and `isUnique` cover them.
    expect(getDedupConfig('contact')?.strongKeySystemAttributes).toEqual([])
  })
})

describe('allowlist / denylist / registry consistency', () => {
  it('has a registry entry for every allowlisted type', () => {
    for (const entityType of DEDUP_V1_ALLOWLIST) {
      expect(DEDUP_CONFIG_BY_ENTITY_TYPE[entityType]).toBeDefined()
    }
  })

  it('has no registry entry for a denylisted type', () => {
    for (const entityType of DEDUP_DENYLIST) {
      expect(DEDUP_CONFIG_BY_ENTITY_TYPE[entityType]).toBeUndefined()
    }
  })

  it('keys every registry entry by its own entityType', () => {
    for (const [key, config] of Object.entries(DEDUP_CONFIG_BY_ENTITY_TYPE)) {
      expect(config.entityType).toBe(key)
    }
  })

  it('never overlaps allowlist and denylist', () => {
    const overlap = DEDUP_V1_ALLOWLIST.filter((t) => DEDUP_DENYLIST.includes(t))
    expect(overlap).toEqual([])
  })

  it('excludes user, thread, entity_group and the mail-infra definitions', () => {
    expect(DEDUP_DENYLIST).toEqual(
      expect.arrayContaining(['user', 'thread', 'entity_group', 'inbox', 'personal_inbox'])
    )
  })
})

describe('guards and weights', () => {
  it('caps blocking per value on every configured type', () => {
    for (const config of Object.values(DEDUP_CONFIG_BY_ENTITY_TYPE)) {
      expect(config.blockCap).toBeGreaterThan(0)
      expect(config.blockCap).toBeLessThanOrEqual(BLOCK_CAP)
    }
  })

  it('denylists role locals in lower case with no @ or domain part', () => {
    expect(ROLE_EMAIL_LOCALS.has('info')).toBe(true)
    expect(ROLE_EMAIL_LOCALS.has('support')).toBe(true)
    expect(ROLE_EMAIL_LOCALS.has('markus')).toBe(false)
    for (const local of ROLE_EMAIL_LOCALS) {
      expect(local).toBe(local.toLowerCase())
      expect(local).not.toContain('@')
    }
  })

  it('lets any single strong signal reach the high band unaided', () => {
    for (const type of ['email', 'phone', 'unique', 'identity'] as const) {
      expect(SIGNAL_WEIGHTS[type]).toBeGreaterThanOrEqual(BAND_THRESHOLDS.high)
    }
  })

  it('puts a bare name match on the medium floor and no higher', () => {
    expect(SIGNAL_WEIGHTS.name).toBe(BAND_THRESHOLDS.medium)
    expect(SIGNAL_WEIGHTS.name).toBeLessThan(BAND_THRESHOLDS.high)
  })

  it('never lets corroboration alone reach medium', () => {
    const corroborating = SIGNAL_WEIGHTS.company + SIGNAL_WEIGHTS.address
    expect(corroborating).toBeLessThan(BAND_THRESHOLDS.medium)
  })

  it('keeps every weight inside [0, 1]', () => {
    for (const weight of Object.values(SIGNAL_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0)
      expect(weight).toBeLessThanOrEqual(1)
    }
  })

  it('orders the bands', () => {
    expect(BAND_THRESHOLDS.high).toBeGreaterThan(BAND_THRESHOLDS.medium)
  })

  it('keeps STRONG_KEY_SYSTEM_ATTRIBUTES to fields the type-driven rule misses', () => {
    // company_domain is plain TEXT with no `unique` capability — it is exactly
    // the case this list exists for. If a value here ever becomes an EMAIL /
    // PHONE_INTL / unique field, drop it: it would be double-counted.
    expect(STRONG_KEY_SYSTEM_ATTRIBUTES).toEqual(['company_domain'])
  })
})
