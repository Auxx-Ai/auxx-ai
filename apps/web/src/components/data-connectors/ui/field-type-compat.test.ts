// apps/web/src/components/data-connectors/ui/field-type-compat.test.ts

import type { ResourceField } from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { isSourceTargetCompatible, isWritableTarget } from './field-type-compat'

/** Minimal ResourceField with just the bits isWritableTarget reads. */
function field(
  caps: Partial<ResourceField['capabilities']>,
  ownership: Partial<Pick<ResourceField, 'dataConnectorId' | 'isAppOwned'>> = {}
): ResourceField {
  return {
    capabilities: { creatable: true, updatable: true, computed: false, ...caps },
    ...ownership,
  } as ResourceField
}

describe('isWritableTarget', () => {
  it('accepts a normal creatable + updatable field', () => {
    expect(isWritableTarget(field({}))).toBe(true)
  })

  it('rejects a computed field even with ownedWrite', () => {
    expect(isWritableTarget(field({ computed: true }), { ownedWrite: true })).toBe(false)
  })

  it('rejects a read-only field in contributing mode (no ownedWrite)', () => {
    const ro = field({ creatable: false, updatable: false }, { dataConnectorId: 'dc1' })
    expect(isWritableTarget(ro)).toBe(false)
  })

  it('accepts a connector-managed read-only field when ownedWrite', () => {
    // The v6 owned-def column: user-read-only, but the owned sink populates it.
    const ownedCol = field({ creatable: false, updatable: false }, { dataConnectorId: 'dc1' })
    expect(isWritableTarget(ownedCol, { ownedWrite: true })).toBe(true)
  })

  it('accepts an app-owned read-only field when ownedWrite', () => {
    const appCol = field({ creatable: false, updatable: false }, { isAppOwned: true })
    expect(isWritableTarget(appCol, { ownedWrite: true })).toBe(true)
  })

  it('still hides a pure system read-only field under ownedWrite (no ownership signal)', () => {
    // e.g. Created By on an owned def — not connector/app-managed, so it stays out.
    const sysCol = field({ creatable: false, updatable: false })
    expect(isWritableTarget(sysCol, { ownedWrite: true })).toBe(false)
  })
})

describe('isSourceTargetCompatible', () => {
  it('null target is always compatible', () => {
    expect(isSourceTargetCompatible(null, 'object')).toBe(true)
  })

  it('reduces an object source to JSON when no declared field type', () => {
    // object → JSON; ADDRESS_STRUCT accepts JSON, TEXT does not.
    expect(isSourceTargetCompatible('ADDRESS_STRUCT', 'object')).toBe(true)
    expect(isSourceTargetCompatible('TEXT', 'object')).toBe(false)
  })

  it('uses the declared struct type directly, constraining to its accepting sinks', () => {
    // An ADDRESS_STRUCT source binds to ADDRESS_STRUCT (self), ADDRESS, and JSON only.
    expect(isSourceTargetCompatible('ADDRESS_STRUCT', 'object', 'ADDRESS_STRUCT')).toBe(true)
    expect(isSourceTargetCompatible('ADDRESS', 'object', 'ADDRESS_STRUCT')).toBe(true)
    expect(isSourceTargetCompatible('JSON', 'object', 'ADDRESS_STRUCT')).toBe(true)
    expect(isSourceTargetCompatible('TEXT', 'object', 'ADDRESS_STRUCT')).toBe(false)
    expect(isSourceTargetCompatible('NUMBER', 'object', 'ADDRESS_STRUCT')).toBe(false)
  })
})
