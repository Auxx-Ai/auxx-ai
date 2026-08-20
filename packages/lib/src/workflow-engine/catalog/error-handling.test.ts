// packages/lib/src/workflow-engine/catalog/error-handling.test.ts

import { describe, expect, it } from 'vitest'
import { BaseType } from '../core/types'
import type { UnifiedVariable } from '../types/unified-variable'
import {
  DEFAULT_ERROR_STRATEGY,
  ErrorStrategy,
  errorHandlingBranches,
  hasFailBranch,
  type NodeErrorHandling,
  normalizeErrorStrategy,
  scopeOutputsToHandle,
} from './error-handling'
import { aiManifest } from './nodes/ai'
import { answerManifest } from './nodes/answer'
import { chunkerManifest } from './nodes/chunker'
import { crudManifest } from './nodes/crud'
import { datasetManifest } from './nodes/dataset'
import { documentExtractorManifest } from './nodes/document-extractor'
import { formatManifest } from './nodes/format'
import { httpManifest } from './nodes/http'
import { knowledgeRetrievalManifest } from './nodes/knowledge-retrieval'
import { listManifest } from './nodes/list'
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

describe('scopeOutputsToHandle', () => {
  const N = 'node1'
  const v = (id: string): UnifiedVariable => ({
    id: `${N}.${id}`,
    label: id,
    type: BaseType.STRING,
    category: 'node',
  })
  const DECLARED = [v('record'), v('id'), v('success'), v('error'), v('errorDetails')]
  const ids = (vars: UnifiedVariable[]) => vars.map((x) => x.id.slice(`${N}.`.length))

  const EH: NodeErrorHandling = {
    strategies: [ErrorStrategy.fail, ErrorStrategy.default],
    defaultStrategy: ErrorStrategy.fail,
    failOutputs: ['success', 'error', 'errorDetails'],
    failureOnlyOutputs: ['error', 'errorDetails'],
  }
  const scope = (handle: string, strategy = 'fail', eh: NodeErrorHandling | undefined = EH) =>
    ids(scopeOutputsToHandle(eh, { error_strategy: strategy }, N, handle, DECLARED))

  it('keeps only failOutputs on the failure door', () => {
    expect(scope('fail')).toEqual(['success', 'error', 'errorDetails'])
  })

  it('treats the legacy `onError` handle as the same door', () => {
    // `ERROR_LIKE_HANDLES`, not a fourth literal `'fail'`.
    expect(scope('onError')).toEqual(['success', 'error', 'errorDetails'])
  })

  it('subtracts failureOnlyOutputs from `source` under strategy fail', () => {
    expect(scope('source')).toEqual(['record', 'id', 'success'])
  })

  it('subtracts NOTHING from `source` under continue or default', () => {
    // The failure lands on this handle under those policies, so the error keys
    // are the point rather than provably-null noise.
    expect(scope('source', 'default')).toEqual(ids(DECLARED))
    expect(scope('source', 'continue')).toEqual(ids(DECLARED))
  })

  it('falls back to the manifest default when the strategy is unset', () => {
    expect(ids(scopeOutputsToHandle(EH, {}, N, 'source', DECLARED))).toEqual([
      'record',
      'id',
      'success',
    ])
  })

  it('reads the legacy `none` as continue', () => {
    expect(scope('source', 'none')).toEqual(ids(DECLARED))
  })

  it('is a no-op without a declaration, or without the lists', () => {
    // Called directly: `scope`'s default parameter would swallow an explicit
    // `undefined` and hand back `EH`.
    expect(
      ids(scopeOutputsToHandle(undefined, { error_strategy: 'fail' }, N, 'fail', DECLARED))
    ).toEqual(ids(DECLARED))
    const bare: NodeErrorHandling = {
      strategies: [ErrorStrategy.fail],
      defaultStrategy: ErrorStrategy.fail,
    }
    // ABSENT `failOutputs` means "the fail branch carries everything" — the
    // opt-in discipline. Distinct from an EMPTY array.
    expect(scope('fail', 'fail', bare)).toEqual(ids(DECLARED))
    expect(scope('source', 'fail', bare)).toEqual(ids(DECLARED))
  })

  it('treats an EMPTY failOutputs as "writes nothing", not as absent', () => {
    const empty: NodeErrorHandling = {
      strategies: [ErrorStrategy.fail],
      defaultStrategy: ErrorStrategy.fail,
      failOutputs: [],
    }
    expect(scope('fail', 'fail', empty)).toEqual([])
  })

  it('matches on the un-prefixed key, leaving nested ids alone', () => {
    const nested: UnifiedVariable[] = [
      { id: `${N}.error`, label: 'error', type: BaseType.STRING, category: 'node' },
      { id: `${N}.record.error`, label: 'error', type: BaseType.STRING, category: 'node' },
    ]
    // Only the TOP-LEVEL `error` is failure-exclusive; `record.error` is a
    // different path that happens to end in the same segment.
    const kept = scopeOutputsToHandle(EH, { error_strategy: 'fail' }, N, 'source', nested)
    expect(kept.map((x) => x.id)).toEqual([`${N}.record.error`])
  })
})

describe('manifest declarations', () => {
  it('names exactly the types that opted in (plan 21 §16.3 + §18.1)', () => {
    // An exact-set assertion, not a superset: opting a type in is a product
    // decision, so a new entry here has to be a deliberate edit. `format` stays
    // out because a format failure IS a config bug and routing around it hides
    // the fix; `answer`, `information-extractor` and `text-classifier` are
    // AI-backed but were never decided, so only `ai` itself is in.
    const declaring = listManifests()
      .filter((manifest) => manifest.errorHandling)
      .map((manifest) => manifest.id)
      .sort()
    expect(declaring).toEqual([
      'ai',
      'chunker',
      'crud',
      'dataset',
      'document-extractor',
      'http',
      'knowledge-retrieval',
      'list',
    ])
  })

  it.each([
    ['document-extractor', documentExtractorManifest],
    ['chunker', chunkerManifest],
    ['dataset', datasetManifest],
    ['knowledge-retrieval', knowledgeRetrievalManifest],
    ['list', listManifest],
  ])('%s offers fail ALONE', (_id, manifest) => {
    // No `default`: none of these has an output shape worth substituting —
    // there is no meaningful "default chunks" or default set of retrieved
    // documents (plan 21 §15.4).
    //
    // No `continue` either, as of plan 24 §6.5: for all five the outputs ARE
    // the reason the node exists, and `continue` collapses success and failure
    // onto one handle, so `source` stops meaning "it worked" and no amount of
    // handle scoping can make the picker honest about it.
    expect(manifest.errorHandling).toEqual({
      strategies: [ErrorStrategy.fail],
      defaultStrategy: ErrorStrategy.fail,
    })
  })

  it('ai offers fail + default — it has a substitutable output shape', () => {
    // `continue` retired (§6.5): the generated text is the point of the node.
    // `default` stays, because a declared stand-in is the honest way to say
    // "carry on without it".
    expect(aiManifest.errorHandling).toEqual({
      strategies: [ErrorStrategy.fail, ErrorStrategy.default],
      defaultStrategy: ErrorStrategy.fail,
    })
  })

  it('crud offers fail + default — it writes data others read', () => {
    expect(crudManifest.errorHandling).toEqual({
      strategies: [ErrorStrategy.fail, ErrorStrategy.default],
      defaultStrategy: ErrorStrategy.fail,
      failOutputs: ['success', 'error', 'errorDetails', 'operation', 'resourceType'],
      failureOnlyOutputs: ['error', 'errorDetails'],
      // Same five as `failOutputs`, different reason — `handleCrudError`
      // writes the status block BEFORE the strategy switch, so substituting
      // one is either overwritten or a lie (plan 24 §10.2). Do not collapse
      // the two lists: http's `failOutputs` contains `status`, which is
      // precisely the substitute its editor exists to set.
      defaultValueExclude: ['success', 'error', 'errorDetails', 'operation', 'resourceType'],
    })
  })

  it('http is the ONE type that keeps continue', () => {
    // A fire-and-forget outbound call is a real pattern and this node is
    // usually terminal — nothing downstream depends on what it produces, which
    // is exactly the §6.5 test for offering `continue` at all.
    expect(httpManifest.errorHandling).toEqual({
      strategies: [ErrorStrategy.fail, ErrorStrategy.continue, ErrorStrategy.default],
      defaultStrategy: ErrorStrategy.fail,
      failOutputs: ['status', 'error', 'success'],
      failureOnlyOutputs: ['error'],
    })
  })

  it('no type offers continue except http', () => {
    // The guard on §6.5 drifting back. `continue` stays in the ENUM and in
    // `normalizeErrorStrategy` — the vocabulary is unified and persisted rows
    // must keep parsing — but the per-type MENU is where the policy lives.
    const offering = listManifests()
      .filter((m) => m.errorHandling?.strategies.includes(ErrorStrategy.continue))
      .map((m) => m.id)
    expect(offering).toEqual(['http'])
  })

  it('every failureOnlyOutputs is a subset of its failOutputs', () => {
    // The two lists encode a three-way partition (plan 24 §6.1a): `failOutputs`
    // is `always ∪ fail-only`, so a key that is failure-EXCLUSIVE must also be
    // one the failure path writes. A `failureOnlyOutputs` entry missing from
    // `failOutputs` would subtract a variable from `source` that the fail
    // branch does not offer either — leaving it readable nowhere.
    for (const manifest of listManifests()) {
      const eh = manifest.errorHandling
      if (!eh?.failureOnlyOutputs?.length) continue
      expect(eh.failOutputs, `${manifest.id} declares failureOnlyOutputs`).toBeDefined()
      for (const key of eh.failureOnlyOutputs) {
        expect(eh.failOutputs, `${manifest.id}.${key}`).toContain(key)
      }
    }
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
    // ABSENT means "a failure is fatal". `format` failing IS a config bug, so
    // it stays out deliberately; `answer` is AI-backed and simply was not part
    // of the §16.3 decision, so it stays out until it is.
    for (const manifest of [formatManifest, answerManifest]) {
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

/**
 * The step-4 acceptance criterion (plan 21, PR B): an EXISTING persisted node
 * of a newly opted-in type — one with no `error_strategy` key, because no such
 * row could have one — must keep behaving exactly as it did before the opt-in.
 * On failure the run dies.
 *
 * The canvas half of that proof lives here: without the key the manifest
 * exposes no `fail` branch, so no `node.tsx` renders the handle and no edge can
 * ever address it. The engine half (the processor emits `'fail'`, which
 * `findFailureEdge` cannot match, so `workflow-engine.ts` throws) is pinned per
 * processor — `dataset/dataset-node-config.test.ts`,
 * `transform-nodes/__tests__/list-processor.test.ts`,
 * `action-nodes/__tests__/ai-v2.test.ts`.
 */
describe('step-4 opt-ins — behaviour preservation for existing rows', () => {
  const OPTED_IN: Array<[string, { connection: { branches?: (config: never) => unknown } }]> = [
    ['document-extractor', documentExtractorManifest],
    ['chunker', chunkerManifest],
    ['dataset', datasetManifest],
    ['knowledge-retrieval', knowledgeRetrievalManifest],
    ['list', listManifest],
    ['ai', aiManifest],
  ]

  it.each(OPTED_IN)('%s exposes source alone for a config with no error_strategy', (_id, m) => {
    // A legacy row carries no key at all. `hasFailBranch` reads the STORED
    // value only (never the manifest's `defaultStrategy`), which is what keeps
    // the branch off graphs that never had one.
    expect(m.connection.branches?.({ title: 'legacy' } as never)).toEqual([
      { id: 'source', name: '', kind: 'default' },
    ])
    expect(hasFailBranch({ title: 'legacy' })).toBe(false)
  })

  it.each(OPTED_IN)('%s exposes the fail branch once the key says fail', (_id, m) => {
    expect(m.connection.branches?.({ error_strategy: 'fail' } as never)).toEqual([
      { id: 'source', name: '', kind: 'default' },
      { id: 'fail', name: 'Fail', kind: 'fail' },
    ])
  })

  it.each(OPTED_IN)('%s writes error_strategy: fail on newly created nodes', (id, _m) => {
    // Deliberately DIFFERENT from the legacy-row case above. `fail` is what an
    // unset node already resolves to, so the processor emits `outputHandle:
    // 'fail'` either way — persisting it on create is the node telling the
    // truth about the handle it emits, instead of leaving new nodes in the
    // undeclared-handle state this whole PR exists to remove (plan 21 §14.4).
    const manifest = listManifests().find((entry) => entry.id === id)
    const defaults = manifest?.defaultData() as { error_strategy?: string }
    expect(defaults.error_strategy).toBe(ErrorStrategy.fail)
  })
})
