// packages/services/src/app-settings/__tests__/merge-with-defaults.test.ts
//
// One installation's settings are reinterpreted under every deployment it is
// repointed at — an ordinary production roll-forward, and now also a
// `pnpm sync-dev` switch, since an org holds ONE installation per app. What is
// pinned here is which of those reinterpretations are safe round trips and which
// one is not:
//
//  - a key the new schema does not mention is not returned, and its saved value
//    is left alone so it reappears when the key does (add/remove/rename are safe
//    in both directions);
//  - a key whose TYPE or `select` options changed is NOT a safe round trip: the
//    default is substituted, and that is reported rather than passing silently.

import { describe, expect, it, vi } from 'vitest'
import { mergeSettingsWithDefaults, type SettingsTypeMismatch } from '../merge-with-defaults'

const bool = (defaultValue?: boolean) => ({
  type: 'boolean' as const,
  _metadata: defaultValue === undefined ? undefined : { defaultValue },
})
const num = { type: 'number' as const }
const str = { type: 'string' as const }

describe('keys the current schema does not mention', () => {
  it('are not returned', () => {
    const merged = mergeSettingsWithDefaults({ allowWrites: true }, { allowMutations: bool() })
    expect(merged).toEqual({ allowMutations: false })
    expect('allowWrites' in merged).toBe(false)
  })

  it('reappear intact when the key comes back — the round trip that matters', () => {
    // A dev build renames the key, the admin sets the new one, then the
    // installation is repointed back at the published deployment. The original
    // value was never touched, because the merge only projects; the caller's
    // upsert-per-key save never prunes.
    const stored = { allowWrites: true, allowMutations: true }
    const backOnOldSchema = mergeSettingsWithDefaults(stored, { allowWrites: bool() })
    expect(backOnOldSchema.allowWrites).toBe(true)
  })

  it('are not reported as mismatches — absence is not an error', () => {
    const onMismatch = vi.fn()
    mergeSettingsWithDefaults({ gone: 'x' }, { kept: str }, onMismatch)
    expect(onMismatch).not.toHaveBeenCalled()
  })
})

describe('a key whose type changed between deployments', () => {
  it('falls back to the default rather than returning an unreadable value', () => {
    const merged = mergeSettingsWithDefaults({ retries: 'three' }, { retries: num })
    expect(merged.retries).toBeUndefined()
  })

  it('reports the mismatch instead of warning to a console nobody reads', () => {
    const mismatches: SettingsTypeMismatch[] = []
    mergeSettingsWithDefaults({ retries: 'three' }, { retries: num }, (m) => mismatches.push(m))
    expect(mismatches).toEqual([{ path: 'retries', expected: 'number', received: 'string' }])
  })

  it('keeps a value whose type still matches', () => {
    const onMismatch = vi.fn()
    const merged = mergeSettingsWithDefaults({ retries: 3 }, { retries: num }, onMismatch)
    expect(merged.retries).toBe(3)
    expect(onMismatch).not.toHaveBeenCalled()
  })
})

describe('a select whose options narrowed', () => {
  it('reports the stored value and the options it is not among', () => {
    const mismatches: SettingsTypeMismatch[] = []
    mergeSettingsWithDefaults(
      { mode: 'turbo' },
      { mode: { type: 'select', _metadata: { options: ['fast', 'slow'], defaultValue: 'slow' } } },
      (m) => mismatches.push(m)
    )
    expect(mismatches).toHaveLength(1)
    expect(mismatches[0]?.path).toBe('mode')
    expect(mismatches[0]?.received).toContain('turbo')
    expect(mismatches[0]?.options).toEqual(['fast', 'slow'])
  })
})

describe('nested structs', () => {
  it('reports the dotted path, so the offending inner field is identifiable', () => {
    const mismatches: SettingsTypeMismatch[] = []
    mergeSettingsWithDefaults(
      { limits: { maxRetries: 'lots' } },
      { limits: { type: 'struct', fields: { maxRetries: num } } },
      (m) => mismatches.push(m)
    )
    expect(mismatches.map((m) => m.path)).toEqual(['limits.maxRetries'])
  })

  it("merges a struct's readable fields normally", () => {
    const merged = mergeSettingsWithDefaults(
      { limits: { maxRetries: 5 } },
      { limits: { type: 'struct', fields: { maxRetries: num, verbose: bool(true) } } }
    )
    expect(merged.limits).toEqual({ maxRetries: 5, verbose: true })
  })
})

describe('defaults', () => {
  it('fills a key that has never been saved', () => {
    expect(mergeSettingsWithDefaults({}, { allowWrites: bool() })).toEqual({ allowWrites: false })
  })

  it('honours an explicit default over the type default', () => {
    expect(mergeSettingsWithDefaults({}, { allowWrites: bool(true) })).toEqual({
      allowWrites: true,
    })
  })

  it('lets a saved false win over a default of true', () => {
    expect(mergeSettingsWithDefaults({ allowWrites: false }, { allowWrites: bool(true) })).toEqual({
      allowWrites: false,
    })
  })
})
