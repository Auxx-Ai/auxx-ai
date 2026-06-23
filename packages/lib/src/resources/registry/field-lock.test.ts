// packages/lib/src/resources/registry/field-lock.test.ts
// Truth table for fieldLockReason() — the shared lock-reason resolver used by the
// field-lock/provenance badges. Ownership signals are read in priority order;
// `connector` wins so a connector-provisioned field never mis-labels as system.

import { describe, expect, it } from 'vitest'
import { fieldLockReason } from './field-types'

const SYS = 'contact_id' as never

describe('fieldLockReason', () => {
  it('returns "connector" when dataConnectorId is set (owned-mode field)', () => {
    expect(fieldLockReason({ dataConnectorId: 'dc1' })).toBe('connector')
  })

  it('returns "computed" for a computed field with no connector', () => {
    expect(fieldLockReason({ isComputed: true })).toBe('computed')
  })

  it('returns "system" for a system-attribute field', () => {
    expect(fieldLockReason({ systemAttribute: SYS })).toBe('system')
  })

  it('returns "app" for an app-owned field', () => {
    expect(fieldLockReason({ appInstallationId: 'inst1' })).toBe('app')
  })

  it('returns "none" for a plain user field', () => {
    expect(fieldLockReason({})).toBe('none')
  })

  it('prioritizes connector over every other signal', () => {
    expect(
      fieldLockReason({
        dataConnectorId: 'dc1',
        isComputed: true,
        systemAttribute: SYS,
        appInstallationId: 'inst1',
      })
    ).toBe('connector')
  })

  it('prioritizes computed over system/app', () => {
    expect(
      fieldLockReason({ isComputed: true, systemAttribute: SYS, appInstallationId: 'inst1' })
    ).toBe('computed')
  })

  it('prioritizes system over app', () => {
    expect(fieldLockReason({ systemAttribute: SYS, appInstallationId: 'inst1' })).toBe('system')
  })
})
