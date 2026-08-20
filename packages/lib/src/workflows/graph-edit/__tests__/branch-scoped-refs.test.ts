// packages/lib/src/workflows/graph-edit/__tests__/branch-scoped-refs.test.ts

/**
 * Branch-scoped output availability in the ref checker (plan 24 §4, §8.2).
 *
 * Until now `ref-check` asked "is this node upstream?" and never "upstream on
 * WHICH branch?", so a node on a crud node's `fail` branch was told the whole
 * record was readable — on a path that never wrote it.
 *
 * The three outcomes asserted here:
 * - reachable only on handles that DON'T write it → `warning`;
 * - reachable on several handles, only some of which write it → `info`;
 * - reachable on handles that all write it → nothing.
 *
 * Never `error`. Over-offering degrades to an empty string at run time;
 * refusing the edit would make a legitimate fan-in unauthorable.
 */

import { describe, expect, it, vi } from 'vitest'
import { getManifest } from '../../../workflow-engine/catalog/registry'
import { BaseType } from '../../../workflow-engine/core/types'
import type { UnifiedVariable } from '../../../workflow-engine/types/unified-variable'
import type { EdgeMeta, NodeMeta, WorkflowOutputGraph } from '../types'

const coreLookup = getManifest

const getCachedResources = vi.fn().mockResolvedValue([])
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  getCachedInstalledApps: async () => [],
}))

const { checkVariableRefsAgainstOutputs } = await import('../normalize/ref-check')

const CRUD = 'crud1aaaaaaaaaaaaaaaa'
const ENTITY = 'i5aezsg4bc6n8gof2uan3wcf'

const variable = (
  id: string,
  type: BaseType,
  extra: Partial<UnifiedVariable> = {}
): UnifiedVariable => ({ id, label: id.split('.').pop() ?? id, type, category: 'node', ...extra })

/**
 * What crud's resolver declares — the UNION across handles, which is what
 * `resolveOutputs` returns and what the scoper narrows. The record tree and
 * `record`/`id` are source-only; the five-key status block is written on both
 * paths; `error`/`errorDetails` are the failure-exclusive pair.
 */
const CRUD_OUTPUTS: UnifiedVariable[] = [
  variable(`${CRUD}.${ENTITY}`, BaseType.OBJECT, {
    properties: { email: variable(`${CRUD}.${ENTITY}.email`, BaseType.EMAIL) },
  }),
  variable(`${CRUD}.record`, BaseType.OBJECT),
  variable(`${CRUD}.id`, BaseType.STRING),
  variable(`${CRUD}.success`, BaseType.BOOLEAN),
  variable(`${CRUD}.operation`, BaseType.STRING),
  variable(`${CRUD}.resourceType`, BaseType.STRING),
  variable(`${CRUD}.error`, BaseType.STRING),
  variable(`${CRUD}.errorDetails`, BaseType.OBJECT),
]

const crudNode = (errorStrategy = 'fail'): NodeMeta => ({
  id: CRUD,
  type: 'standard',
  data: {
    id: CRUD,
    type: 'crud',
    title: 'Create Contact',
    mode: 'create',
    resourceType: ENTITY,
    error_strategy: errorStrategy,
  },
})

/** A manifest-less consumer, so the generic `{{…}}` walk finds its refs. */
const consumer = (id: string, title: string, refs: string[]): NodeMeta => ({
  id,
  type: 'standard',
  data: { id, type: 'custom-consumer', title, text: refs.join(' ') },
})

const edge = (source: string, target: string, sourceHandle: string): EdgeMeta => ({
  id: `${source}->${target}:${sourceHandle}`,
  source,
  target,
  sourceHandle,
})

const check = (graph: WorkflowOutputGraph) =>
  checkVariableRefsAgainstOutputs({
    graph,
    outputs: new Map([[CRUD, CRUD_OUTPUTS]]),
    lookup: coreLookup,
  })

const LOG = 'log1aaaaaaaaaaaaaaaaaa'
const WELCOME = 'welc1aaaaaaaaaaaaaaaa'
const NOTIFY = 'noti1aaaaaaaaaaaaaaaa'

describe('a consumer on the fail branch alone', () => {
  const graphWith = (refs: string[]): WorkflowOutputGraph => ({
    nodes: [crudNode(), consumer(LOG, 'Log Failure', refs)],
    edges: [edge(CRUD, LOG, 'fail')],
  })

  it('warns for a source-only output, without blocking', () => {
    const { issues } = check(graphWith([`{{${CRUD}.${ENTITY}.email}}`]))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('warning')
    expect(issues[0]?.message).toContain('does not produce on the branch')
    // The tier that refuses a write only reads `error`.
    expect(issues.some((i) => i.severity === 'error')).toBe(false)
  })

  it('warns for `record`, the reported symptom', () => {
    const { issues } = check(graphWith([`{{${CRUD}.record}}`]))
    expect(issues.map((i) => i.severity)).toEqual(['warning'])
  })

  it('stays silent for the status block the fail path writes', () => {
    const refs = ['error', 'errorDetails', 'success', 'operation', 'resourceType'].map(
      (k) => `{{${CRUD}.${k}}}`
    )
    expect(check(graphWith(refs)).issues).toEqual([])
  })
})

describe('a consumer on the source branch alone', () => {
  const graphWith = (refs: string[], strategy = 'fail'): WorkflowOutputGraph => ({
    nodes: [crudNode(strategy), consumer(WELCOME, 'Send Welcome', refs)],
    edges: [edge(CRUD, WELCOME, 'source')],
  })

  it('stays silent for the record tree — unchanged from before scoping', () => {
    expect(check(graphWith([`{{${CRUD}.${ENTITY}.email}}`, `{{${CRUD}.record}}`])).issues).toEqual(
      []
    )
  })

  it('warns for `error` under strategy `fail`, which writes it as null there', () => {
    // The mirror of the fail-branch bug: the failure left by another door, so
    // `error` on `source` can only ever be null — and a null interpolates to
    // an empty string with a WARN, exactly like an absent variable.
    const { issues } = check(graphWith([`{{${CRUD}.error}}`]))

    expect(issues.map((i) => i.severity)).toEqual(['warning'])
  })

  it('stays silent for `error` under `default`, where the failure lands here', () => {
    expect(check(graphWith([`{{${CRUD}.error}}`], 'default')).issues).toEqual([])
  })

  it('keeps `success` readable under every strategy', () => {
    // `success` is deliberately NOT in `failureOnlyOutputs`: a real boolean,
    // and the discriminator under `default`.
    expect(check(graphWith([`{{${CRUD}.success}}`])).issues).toEqual([])
    expect(check(graphWith([`{{${CRUD}.success}}`], 'default')).issues).toEqual([])
  })
})

describe('a consumer reachable from BOTH branches', () => {
  // create --source--> welcome --\
  //        --fail-----> log ------+--> notify
  const graphWith = (refs: string[]): WorkflowOutputGraph => ({
    nodes: [
      crudNode(),
      consumer(WELCOME, 'Send Welcome', []),
      consumer(LOG, 'Log Failure', []),
      consumer(NOTIFY, 'Notify Ops', refs),
    ],
    edges: [
      edge(CRUD, WELCOME, 'source'),
      edge(CRUD, LOG, 'fail'),
      edge(WELCOME, NOTIFY, 'source'),
      edge(LOG, NOTIFY, 'source'),
    ],
  })

  it('offers the union — a source-only output is `info`, not `warning`', () => {
    const { issues } = check(graphWith([`{{${CRUD}.${ENTITY}.email}}`]))

    expect(issues).toHaveLength(1)
    expect(issues[0]?.severity).toBe('info')
    expect(issues[0]?.message).toContain('path-conditional')
  })

  it('reports the same for a failure-only output, from the other side', () => {
    // `error` is absent on `source` under strategy `fail` and present on
    // `fail`. Union offers it; intersection would refuse both this and the
    // record — which is why the rule is union.
    expect(check(graphWith([`{{${CRUD}.error}}`])).issues.map((i) => i.severity)).toEqual(['info'])
  })

  it('stays silent for what BOTH branches write', () => {
    expect(check(graphWith([`{{${CRUD}.success}}`, `{{${CRUD}.operation}}`])).issues).toEqual([])
  })

  it('lets one node read the record AND the error — the motivating pattern', () => {
    // "Created {{…record.email}} — error: {{…error}}" is a normal thing to
    // build. Both are offered; both are flagged path-conditional; neither
    // blocks.
    const { issues } = check(graphWith([`{{${CRUD}.${ENTITY}.email}}`, `{{${CRUD}.error}}`]))

    expect(issues).toHaveLength(2)
    expect(issues.every((i) => i.severity === 'info')).toBe(true)
  })
})

describe('the guards', () => {
  it('does not swallow the check when the SCOPED map is empty', () => {
    // THE TRAP (§8.2): a node whose `failOutputs` is `[]` produces an empty
    // scoped map, and guarding on that instead of the unscoped map would skip
    // every check on the fail branch. An unknown path must still be an error.
    const graph: WorkflowOutputGraph = {
      nodes: [crudNode(), consumer(LOG, 'Log Failure', [`{{${CRUD}.nonsense}}`])],
      edges: [edge(CRUD, LOG, 'fail')],
    }

    const { issues } = check(graph)
    expect(issues.map((i) => i.severity)).toEqual(['error'])
    expect(issues[0]?.message).toContain('No output "nonsense"')
  })

  it('suggests from the UNSCOPED tree, so a correction is never mis-aimed', () => {
    // On the fail branch `errorDetail` is a typo for `errorDetails`, which IS
    // in scope. A suggestion computed from a scoped sibling set could just as
    // easily rewrite a source-only typo into an unrelated failure key.
    const graph: WorkflowOutputGraph = {
      nodes: [crudNode(), consumer(LOG, 'Log Failure', [`{{${CRUD}.errorDetail}}`])],
      edges: [edge(CRUD, LOG, 'fail')],
    }

    expect(check(graph).issues[0]?.suggestion).toBe(`${CRUD}.errorDetails`)
  })

  it('reports non-upstream as an error, ahead of any scope question', () => {
    const graph: WorkflowOutputGraph = {
      nodes: [crudNode(), consumer(LOG, 'Log Failure', [`{{${CRUD}.record}}`])],
      edges: [],
    }

    const { issues } = check(graph)
    expect(issues.map((i) => i.severity)).toEqual(['error'])
    expect(issues[0]?.message).toContain('not upstream')
  })

  it('leaves a node with no declared outputs unverifiable', () => {
    const graph: WorkflowOutputGraph = {
      nodes: [crudNode(), consumer(LOG, 'Log Failure', [`{{${CRUD}.record}}`])],
      edges: [edge(CRUD, LOG, 'fail')],
    }

    const result = checkVariableRefsAgainstOutputs({
      graph,
      outputs: new Map([[CRUD, []]]),
      lookup: coreLookup,
    })
    expect(result.issues).toEqual([])
  })

  it('does not scope a `default`-strategy node, which renders no fail branch', () => {
    // §6.4: `hasFailBranch` is false for `default`, so no `fail` handle exists
    // to wire — an edge claiming one is a graph that could not be authored, and
    // the source-side narrowing must not fire either.
    const graph: WorkflowOutputGraph = {
      nodes: [crudNode('default'), consumer(WELCOME, 'Send Welcome', [`{{${CRUD}.error}}`])],
      edges: [edge(CRUD, WELCOME, 'source')],
    }

    expect(check(graph).issues).toEqual([])
  })
})
