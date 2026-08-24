// packages/lib/src/custom-fields/__tests__/ownership.test.ts

import { describe, expect, it } from 'vitest'
import { canGrowFieldOptions, fieldAllowsNewOptions, isProtectedField } from '../ownership'

/** A field owned outright by the user — neither ownership marker set. */
const custom = { systemAttribute: null, appInstallationId: null, dataConnectorId: null }
/** A platform field, e.g. `part.category` (`systemAttribute: 'category'`). */
const system = { ...custom, systemAttribute: 'category' }

describe('canGrowFieldOptions — authority', () => {
  it('allows every option type on a field the user owns outright', () => {
    for (const type of ['SINGLE_SELECT', 'MULTI_SELECT', 'TAGS']) {
      expect(canGrowFieldOptions({ ...custom, type })).toBe(true)
    }
  })

  it('allows a system TAGS field — tags are user-grown data, not configuration', () => {
    // This is `part.category`, and it is the whole reason the carve-out in
    // `updateCustomField` exists.
    expect(canGrowFieldOptions({ ...system, type: 'TAGS' })).toBe(true)
  })

  it('refuses a system SELECT — its option set IS configuration', () => {
    // Nothing should be able to invent a ticket status or a part kind from a CSV.
    expect(canGrowFieldOptions({ ...system, type: 'SINGLE_SELECT' })).toBe(false)
    expect(canGrowFieldOptions({ ...system, type: 'MULTI_SELECT' })).toBe(false)
  })

  it('refuses an app-owned field of any type', () => {
    expect(canGrowFieldOptions({ ...custom, type: 'TAGS', appInstallationId: 'app-1' })).toBe(false)
  })

  it('refuses a connector-owned field of any type', () => {
    // Narrower than `updateCustomField`'s own guard, deliberately: the connector
    // DECLARES `provision.options` and re-provisions on deploy, so the taxonomy
    // already has a designated writer. Widening this to match the writer would
    // let an import mint options a redeploy then cascade-deletes.
    expect(canGrowFieldOptions({ ...custom, type: 'TAGS', dataConnectorId: 'dc-1' })).toBe(false)
    expect(canGrowFieldOptions({ ...custom, type: 'SINGLE_SELECT', dataConnectorId: 'dc-1' })).toBe(
      false
    )
  })

  it('refuses a field that carries no option list at all', () => {
    expect(canGrowFieldOptions({ ...custom, type: 'TEXT' })).toBe(false)
    expect(canGrowFieldOptions({ ...custom, type: 'RELATIONSHIP' })).toBe(false)
  })

  it('is narrower than isProtectedField for connectors, and wider for system TAGS', () => {
    const connectorTags = { ...custom, type: 'TAGS', dataConnectorId: 'dc-1' }
    expect(isProtectedField(connectorTags)).toBe(false)
    expect(canGrowFieldOptions(connectorTags)).toBe(false)

    const systemTags = { ...system, type: 'TAGS' }
    expect(isProtectedField(systemTags)).toBe(true)
    expect(canGrowFieldOptions(systemTags)).toBe(true)
  })
})

describe('fieldAllowsNewOptions — preference', () => {
  it('defaults TAGS open, so part.category grows with no row touched', () => {
    // This is what makes the setting need no backfill.
    expect(fieldAllowsNewOptions({ type: 'TAGS' })).toBe(true)
    expect(fieldAllowsNewOptions({ type: 'TAGS', options: {} })).toBe(true)
  })

  it('defaults a SELECT set closed — a curated taxonomy is configuration', () => {
    expect(fieldAllowsNewOptions({ type: 'SINGLE_SELECT' })).toBe(false)
    expect(fieldAllowsNewOptions({ type: 'MULTI_SELECT', options: {} })).toBe(false)
  })

  it('lets an explicit choice win over the type default, in both directions', () => {
    expect(fieldAllowsNewOptions({ type: 'TAGS', options: { allowNewOptions: false } })).toBe(false)
    expect(
      fieldAllowsNewOptions({ type: 'SINGLE_SELECT', options: { allowNewOptions: true } })
    ).toBe(true)
  })

  it('treats a null options envelope as absent, not as a decision', () => {
    expect(fieldAllowsNewOptions({ type: 'TAGS', options: null })).toBe(true)
  })
})
