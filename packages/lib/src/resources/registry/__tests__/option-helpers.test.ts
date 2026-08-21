// packages/lib/src/resources/registry/__tests__/option-helpers.test.ts

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildOptionIndex,
  type FieldOptionItem,
  findOptionKey,
  optionKey,
  optionMatchKey,
  resolveOptionId,
  resolveOptionIds,
} from '../option-helpers'

/**
 * Covers both keyspaces:
 * - `app_opt_enterprise` — an app/connector-provisioned option with an explicit `id`
 * - `Starter` — a field-form option whose key IS its value
 * - `V1StGXR8_Z5jdHi6Bmy0` — a picker-minted option where `id` and `value` agree
 */
const OPTIONS: FieldOptionItem[] = [
  { id: 'app_opt_enterprise', value: 'val_enterprise', label: 'Enterprise', color: 'blue' },
  { value: 'Starter', label: 'Starter' },
  { id: 'V1StGXR8_Z5jdHi6Bmy0', value: 'V1StGXR8_Z5jdHi6Bmy0', label: 'Pro' },
]

describe('optionKey', () => {
  it('prefers an explicit id', () => {
    const option: FieldOptionItem = {
      id: 'app_opt_enterprise',
      value: 'val_enterprise',
      label: 'Enterprise',
    }
    expect(optionKey(option)).toBe('app_opt_enterprise')
  })

  it('falls back to value when there is no id', () => {
    expect(optionKey({ value: 'Starter', label: 'Starter' })).toBe('Starter')
  })

  it('returns undefined for a keyless row', () => {
    expect(optionKey({ value: '', label: 'Blank' })).toBeUndefined()
    expect(optionKey(undefined)).toBeUndefined()
  })
})

describe('resolveOptionId', () => {
  it('resolves an option carrying an explicit id', () => {
    expect(resolveOptionId('app_opt_enterprise', OPTIONS)).toEqual({
      status: 'known',
      optionId: 'app_opt_enterprise',
      label: 'Enterprise',
      color: 'blue',
    })
  })

  it('resolves a row still holding the value of an option that later gained an id', () => {
    expect(resolveOptionId('val_enterprise', OPTIONS)).toMatchObject({
      status: 'known',
      label: 'Enterprise',
    })
  })

  it('resolves an option carrying only a value', () => {
    expect(resolveOptionId('Starter', OPTIONS)).toMatchObject({
      status: 'known',
      optionId: 'Starter',
      label: 'Starter',
    })
  })

  it('does NOT resolve a stored id that merely matches another option label', () => {
    // Label tolerance is a WRITE-path affordance (findOptionKey). A read that
    // matched labels would resolve orphans onto whichever option happens to be
    // named the same today.
    expect(resolveOptionId('Enterprise', OPTIONS)).toEqual({
      status: 'unknown',
      optionId: 'Enterprise',
      raw: 'Enterprise',
    })
  })

  it('returns unknown with the raw value preserved', () => {
    expect(resolveOptionId('V1StGXR8_Z5jdHi6Bmy', OPTIONS)).toEqual({
      status: 'unknown',
      optionId: 'V1StGXR8_Z5jdHi6Bmy',
      raw: 'V1StGXR8_Z5jdHi6Bmy',
    })
  })

  it('accepts a prebuilt index', () => {
    const index = buildOptionIndex(OPTIONS)
    expect(resolveOptionId('Starter', index)).toMatchObject({ status: 'known', label: 'Starter' })
  })

  it('treats an empty option list as resolving nothing', () => {
    expect(resolveOptionId('Starter', [])).toEqual({
      status: 'unknown',
      optionId: 'Starter',
      raw: 'Starter',
    })
  })
})

describe('resolveOptionIds', () => {
  it('preserves order and mixes known with unknown', () => {
    expect(
      resolveOptionIds(['Starter', 'gone_id', 'app_opt_enterprise'], OPTIONS).map((r) =>
        r.status === 'known' ? r.label : `?${r.raw}`
      )
    ).toEqual(['Starter', '?gone_id', 'Enterprise'])
  })
})

describe('buildOptionIndex', () => {
  it('indexes both keyspaces', () => {
    const index = buildOptionIndex(OPTIONS)
    expect(index.get('app_opt_enterprise')?.label).toBe('Enterprise')
    expect(index.get('val_enterprise')?.label).toBe('Enterprise')
    expect(index.get('Starter')?.label).toBe('Starter')
    expect(index.get('Enterprise')).toBeUndefined()
  })

  it('resolves a cross-option collision to the first writer, deterministically', () => {
    const colliding: FieldOptionItem[] = [
      { id: 'shared', value: 'first_value', label: 'First' },
      { value: 'shared', label: 'Second' },
    ]
    expect(buildOptionIndex(colliding).get('shared')?.label).toBe('First')
    expect(buildOptionIndex([...colliding].reverse()).get('shared')?.label).toBe('Second')
  })
})

describe('findOptionKey', () => {
  it('matches a label case- and whitespace-insensitively (write-side tolerance)', () => {
    expect(findOptionKey('enterprise', OPTIONS)).toBe('app_opt_enterprise')
    expect(findOptionKey('  ENTERPRISE  ', OPTIONS)).toBe('app_opt_enterprise')
    // Collapsing whitespace must not also delete it: 'En terprise' is a different word.
    expect(findOptionKey('En terprise', OPTIONS)).toBeUndefined()
  })

  it('matches either keyspace exactly and returns the storage key', () => {
    expect(findOptionKey('val_enterprise', OPTIONS)).toBe('app_opt_enterprise')
    expect(findOptionKey('app_opt_enterprise', OPTIONS)).toBe('app_opt_enterprise')
    expect(findOptionKey('Starter', OPTIONS)).toBe('Starter')
  })

  it('returns undefined when nothing matches', () => {
    expect(findOptionKey('Nope', OPTIONS)).toBeUndefined()
    expect(findOptionKey('', OPTIONS)).toBeUndefined()
    expect(findOptionKey('Starter', [])).toBeUndefined()
  })
})

describe('optionMatchKey', () => {
  it('folds case and collapses whitespace', () => {
    expect(optionMatchKey('  Enterprise   Plan ')).toBe('enterprise plan')
    expect(optionMatchKey('ENTERPRISE')).toBe(optionMatchKey('enterprise'))
  })
})

/**
 * `search-text.ts` resolves the same lookup in SQL and cannot share this code, so
 * a test is what keeps the two rules honest. If the SQL predicate changes, the
 * literal assertion below fails and points here.
 */
describe('parity with the search-text SQL rule', () => {
  const SEARCH_TEXT_PREDICATE = `WHERE o->>'value' = fv."optionId" OR o->>'id' = fv."optionId"`

  /** JS mirror of the SQL: first array element matching EITHER key, else the raw id. */
  function sqlResolveLabel(options: FieldOptionItem[], optionId: string): string {
    for (const o of options) {
      if (o.value === optionId || o.id === optionId) return o.label
    }
    return optionId
  }

  it('the SQL still matches both keyspaces', () => {
    const source = readFileSync(
      new URL('../../../field-values/search-text.ts', import.meta.url),
      'utf8'
    )
    expect(source).toContain(SEARCH_TEXT_PREDICATE)
  })

  it('resolveOptionId agrees with the SQL rule across both keyspaces', () => {
    const candidates = [
      'app_opt_enterprise',
      'val_enterprise',
      'Starter',
      'V1StGXR8_Z5jdHi6Bmy0',
      'Enterprise',
      'gone_id',
    ]
    for (const candidate of candidates) {
      const resolved = resolveOptionId(candidate, OPTIONS)
      const viaSql = sqlResolveLabel(OPTIONS, candidate)
      const viaHelper = resolved.status === 'known' ? resolved.label : resolved.raw
      expect(viaHelper, `disagreement on '${candidate}'`).toBe(viaSql)
    }
  })

  it('every optionKey round-trips through the SQL rule to its own label', () => {
    for (const option of OPTIONS) {
      const key = optionKey(option)
      expect(key).toBeDefined()
      expect(sqlResolveLabel(OPTIONS, key as string)).toBe(option.label)
    }
  })

  it('agrees with the SQL rule on a collision, including array order', () => {
    const colliding: FieldOptionItem[] = [
      { id: 'shared', value: 'first_value', label: 'First' },
      { value: 'shared', label: 'Second' },
    ]
    for (const list of [colliding, [...colliding].reverse()]) {
      const resolved = resolveOptionId('shared', list)
      expect(resolved.status === 'known' && resolved.label).toBe(sqlResolveLabel(list, 'shared'))
    }
  })
})
