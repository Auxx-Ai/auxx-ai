// packages/lib/src/import/resolution/__tests__/value-display.test.ts

import { describe, expect, it } from 'vitest'
import { deriveEffectiveStatus, effectiveOptionKeys } from '../effective-status'
import { isOptionResolutionType, resolveOptionLabel } from '../option-labels'

const OPTIONS = [
  { value: 'nano_steel', label: 'Steel' },
  { value: 'nano_alu', label: 'Alu' },
  // App/connector-provisioned rows carry an explicit `id`; the stored key is
  // the `id`, not the `value`.
  { id: 'opt_wood', value: 'wood', label: 'Wood' },
]

describe('deriveEffectiveStatus', () => {
  it('passes the resolver verdict through when nothing was overridden', () => {
    expect(deriveEffectiveStatus('error', false, null)).toBe('error')
    expect(deriveEffectiveStatus('create', false, undefined)).toBe('create')
  })

  it('treats an empty override array as no override', () => {
    // The review row writes `isOverridden: true` before its payload exists in
    // one flow; reading that as "valid" would clear an error nobody fixed.
    expect(deriveEffectiveStatus('error', true, [])).toBe('error')
  })

  it('reads a leading skip marker as skip', () => {
    expect(deriveEffectiveStatus('valid', true, [{ type: 'skip', value: '' }])).toBe('skip')
  })

  it('reads any other override as valid, whatever the resolver said', () => {
    expect(deriveEffectiveStatus('error', true, [{ type: 'value', value: 'nano_steel' }])).toBe(
      'valid'
    )
  })
})

describe('effectiveOptionKeys', () => {
  it('splits the resolver answer when there is no override', () => {
    expect(effectiveOptionKeys('nano_steel,nano_alu', false, null)).toEqual([
      'nano_steel',
      'nano_alu',
    ])
  })

  it('prefers the override over the resolver answer', () => {
    expect(
      effectiveOptionKeys('nano_steel', true, [
        { type: 'value', value: 'nano_alu' },
        { type: 'value', value: 'opt_wood' },
      ])
    ).toEqual(['nano_alu', 'opt_wood'])
  })

  it('yields nothing for a skip — the row imports nothing, stale chip or not', () => {
    expect(effectiveOptionKeys('nano_steel', true, [{ type: 'skip', value: '' }])).toEqual([])
  })

  it('is empty for an unresolved value', () => {
    expect(effectiveOptionKeys(null, false, null)).toEqual([])
    expect(effectiveOptionKeys('', false, null)).toEqual([])
  })
})

describe('resolveOptionLabel', () => {
  it('renders labels for both option keyspaces', () => {
    expect(resolveOptionLabel(['nano_steel', 'opt_wood'], OPTIONS)).toBe('Steel, Wood')
  })

  it('returns null when nothing matches, so a create shows its raw label', () => {
    // A pending option CREATE carries the label to be minted, not a key.
    expect(resolveOptionLabel(['Plastic'], OPTIONS)).toBeNull()
  })

  it('keeps the raw key for the unmatched half of a mixed multi value', () => {
    expect(resolveOptionLabel(['nano_steel', 'gone'], OPTIONS)).toBe('Steel, gone')
  })

  it('returns null with no keys or no option list', () => {
    expect(resolveOptionLabel([], OPTIONS)).toBeNull()
    expect(resolveOptionLabel(['nano_steel'], null)).toBeNull()
    expect(resolveOptionLabel(['nano_steel'], [])).toBeNull()
  })
})

describe('isOptionResolutionType', () => {
  it('covers both option families and nothing else', () => {
    expect(isOptionResolutionType('select:value')).toBe(true)
    expect(isOptionResolutionType('select:create')).toBe(true)
    expect(isOptionResolutionType('multiselect:split')).toBe(true)
    expect(isOptionResolutionType('array:split')).toBe(false)
    expect(isOptionResolutionType('relation:match')).toBe(false)
    expect(isOptionResolutionType(null)).toBe(false)
  })
})
