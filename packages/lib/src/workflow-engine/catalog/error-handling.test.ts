// packages/lib/src/workflow-engine/catalog/error-handling.test.ts

import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ERROR_STRATEGY,
  ErrorStrategy,
  errorHandlingBranches,
  hasFailBranch,
  normalizeErrorStrategy,
} from './error-handling'
import { aiManifest } from './nodes/ai'
import { crudManifest } from './nodes/crud'
import { formatManifest } from './nodes/format'
import { httpManifest } from './nodes/http'
import { getManifest, listManifests } from './registry'

/**
 * The unified failure policy (plan 21 §15). There used to be two enums for one
 * concern — http's `none | fail | default` (defaulting to `default`) and
 * crud's `fail | continue | default` (defaulting to `fail`) — where http's
 * `none` and crud's `continue` named the same behaviour and the defaults
 * disagreed. These tests pin the three things that unification has to get
 * right: the legacy alias still reads, the default is `fail` everywhere, and
 * the branch comes from ONE helper driven by a manifest declaration.
 */
describe('normalizeErrorStrategy', () => {
  it("reads http's legacy 'none' as `continue`", () => {
    // Persisted http configs carry 'none'; it is accepted on read and never
    // written again, which is the whole migration for this refactor.
    expect(normalizeErrorStrategy('none')).toBe(ErrorStrategy.continue)
  })

  it('passes the three real policies through unchanged', () => {
    expect(normalizeErrorStrategy('fail')).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy('continue')).toBe(ErrorStrategy.continue)
    expect(normalizeErrorStrategy('default')).toBe(ErrorStrategy.default)
  })

  it('resolves an absent or unrecognised value to the unified default, `fail`', () => {
    expect(DEFAULT_ERROR_STRATEGY).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy(undefined)).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy(null)).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy('')).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy('swallow')).toBe(ErrorStrategy.fail)
    expect(normalizeErrorStrategy(42)).toBe(ErrorStrategy.fail)
  })

  it('honours a per-type fallback when one is given', () => {
    // A type whose manifest declares `defaultStrategy: continue` reads an
    // unconfigured node as `continue`, not as the catalog-wide `fail`.
    expect(normalizeErrorStrategy(undefined, ErrorStrategy.continue)).toBe(ErrorStrategy.continue)
  })

  it("has no member named 'none' any more", () => {
    expect(Object.values(ErrorStrategy)).toEqual(['fail', 'continue', 'default'])
  })
})

describe('errorHandlingBranches — the one site that turns a policy into a handle', () => {
  const failBranch = { id: 'fail', name: 'Fail', kind: 'fail' }

  it('contributes the fail branch for `fail`', () => {
    expect(errorHandlingBranches({ error_strategy: 'fail' })).toEqual([failBranch])
    expect(hasFailBranch({ error_strategy: 'fail' })).toBe(true)
  })

  it('contributes nothing for `continue` / legacy `none` / `default`', () => {
    // These change the node's OUTPUT, not its ROUTING — they never touch the
    // branch machinery at all (plan 21 §15.3).
    expect(errorHandlingBranches({ error_strategy: 'continue' })).toEqual([])
    expect(errorHandlingBranches({ error_strategy: 'none' })).toEqual([])
    expect(errorHandlingBranches({ error_strategy: 'default' })).toEqual([])
  })

  it('contributes nothing when `error_strategy` is absent', () => {
    // Deliberately NOT the `DEFAULT_ERROR_STRATEGY` fallback: every node.tsx
    // renders its fail handle off the stored value, so synthesising a branch
    // here would break the handle contract the parity suite asserts.
    expect(errorHandlingBranches({})).toEqual([])
    expect(errorHandlingBranches(undefined)).toEqual([])
    expect(hasFailBranch(null)).toBe(false)
  })
})

describe('manifest declarations', () => {
  it('http and crud are the only types that declare errorHandling (step 4 opts in more)', () => {
    const declaring = listManifests()
      .filter((manifest) => manifest.errorHandling)
      .map((manifest) => manifest.id)
      .sort()
    expect(declaring).toEqual(['crud', 'http'])
  })

  it.each([
    ['http', httpManifest],
    ['crud', crudManifest],
  ])('%s declares all three strategies and defaults to fail', (_id, manifest) => {
    expect(manifest.errorHandling).toEqual({
      strategies: [ErrorStrategy.fail, ErrorStrategy.continue, ErrorStrategy.default],
      defaultStrategy: ErrorStrategy.fail,
    })
  })

  it.each([
    ['http', httpManifest],
    ['crud', crudManifest],
  ])('%s derives its fail branch from the shared helper', (_id, manifest) => {
    const branches = (config: Record<string, unknown>) =>
      manifest.connection.branches?.(config as never) ?? []

    expect(branches({ error_strategy: 'fail' })).toEqual([
      { id: 'source', name: '', kind: 'default' },
      { id: 'fail', name: 'Fail', kind: 'fail' },
    ])
    // Same source handle in every other case — only `fail` adds a branch.
    for (const strategy of ['continue', 'none', 'default']) {
      expect(branches({ error_strategy: strategy })).toEqual([
        { id: 'source', name: '', kind: 'default' },
      ])
    }
  })

  it.each([
    ['http', httpManifest],
    ['crud', crudManifest],
  ])('%s defaults an unconfigured node to fail', (_id, manifest) => {
    // http used to ship `error_strategy: 'default'` with an empty
    // `default_value`, which the processor's `default` arm rejects and so fell
    // straight through to the fail return — the stored value disagreed with
    // the behaviour, and `connection.branches` hid the handle the node already
    // emitted (plan 21 §16.4).
    const defaults = manifest.defaultData() as { error_strategy?: string }
    expect(defaults.error_strategy).toBe(ErrorStrategy.fail)
    expect(manifest.connection.branches?.(defaults as never)).toEqual([
      { id: 'source', name: '', kind: 'default' },
      { id: 'fail', name: 'Fail', kind: 'fail' },
    ])
  })

  it('a type that does not declare errorHandling exposes no fail branch', () => {
    // ABSENT means "a failure is fatal", which is the state every type but
    // http and crud is in today. `format` failing IS a config bug; the ai node
    // is the strongest step-4 candidate and still opted out here.
    for (const manifest of [formatManifest, aiManifest]) {
      expect(manifest.errorHandling).toBeUndefined()
      // Even a config that carries the key gets nothing — the declaration is
      // what grants the branch, not the presence of the field.
      const branches = manifest.connection.branches?.({ error_strategy: 'fail' } as never)
      expect(branches?.some((branch) => branch.id === 'fail') ?? false).toBe(false)
    }
  })

  it('every declared defaultStrategy is one of the declared strategies', () => {
    for (const manifest of listManifests()) {
      const declaration = manifest.errorHandling
      if (!declaration) continue
      expect(declaration.strategies).toContain(declaration.defaultStrategy)
    }
  })

  it('is reachable by type id, which is how the graph builder reads it', () => {
    expect(getManifest('crud')?.errorHandling?.defaultStrategy).toBe(ErrorStrategy.fail)
    expect(getManifest('wait')?.errorHandling).toBeUndefined()
  })
})
