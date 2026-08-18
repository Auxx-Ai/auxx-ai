// packages/lib/src/workflows/graph-edit/__tests__/ref-check.test.ts

/**
 * Dangling-ref and non-upstream-ref errors naming candidates
 * (`03-graph-edit-service.md` §9), including the collection-shape correction:
 * `{{X.attachments[*]}}` comes back WITH the suggested `.values[*]` form.
 * Upstream reachability comes from the catalog's `buildUpstreamMap`.
 */

import { describe, expect, it, vi } from 'vitest'
import { getManifest } from '../../../workflow-engine/catalog/registry'
import { BaseType } from '../../../workflow-engine/core/types'
import type { UnifiedVariable } from '../../../workflow-engine/types/unified-variable'
import type { NodeMeta, WorkflowOutputGraph } from '../types'

/** The core registry alone — no app installed in these fixtures. */
const coreLookup = getManifest

// ref-check statically imports the catalog's server-side resolve-outputs, whose
// cache read must not hit a real backend if the composed helper is ever used.
const getCachedResources = vi.fn().mockResolvedValue([])
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
  // No installed apps: these suites exercise CORE node types, so the manifest
  // lookup `loadDraftContext` builds must resolve to the registry alone.
  getCachedInstalledApps: async () => [],
}))

const { checkVariableRefsAgainstOutputs } = await import('../normalize/ref-check')

const TICKET_ID = 'i5aezsg4bc6n8gof2uan3wcf'
const FIND = 'find1aaaaaaaaaaaaaaaaa'
const CONSUMER = 'ai1aaaaaaaaaaaaaaaaaaa'
const STRAY = 'strayaaaaaaaaaaaaaaaaa'

const variable = (
  id: string,
  type: BaseType,
  extra: Partial<UnifiedVariable> = {}
): UnifiedVariable => ({
  id,
  label: id.split('.').pop() ?? id,
  type,
  category: 'node',
  ...extra,
})

/** Declared find outputs: scalar, entity object with fields, a has-many wrapper, an open object. */
const FIND_OUTPUTS: UnifiedVariable[] = [
  variable(`${FIND}.count`, BaseType.NUMBER),
  variable(`${FIND}.${TICKET_ID}`, BaseType.OBJECT, {
    properties: {
      subject: variable(`${FIND}.${TICKET_ID}.subject`, BaseType.STRING),
      email: variable(`${FIND}.${TICKET_ID}.email`, BaseType.EMAIL),
      record: variable(`${FIND}.${TICKET_ID}.record`, BaseType.OBJECT),
      attachments: variable(`${FIND}.${TICKET_ID}.attachments`, BaseType.OBJECT, {
        properties: {
          values: variable(`${FIND}.${TICKET_ID}.attachments.values`, BaseType.ARRAY, {
            items: variable(`${FIND}.${TICKET_ID}.attachments.values[*]`, BaseType.OBJECT, {
              properties: {
                name: variable(`${FIND}.${TICKET_ID}.attachments.values[*].name`, BaseType.STRING),
              },
            }),
          }),
          count: variable(`${FIND}.${TICKET_ID}.attachments.count`, BaseType.NUMBER),
          isEmpty: variable(`${FIND}.${TICKET_ID}.attachments.isEmpty`, BaseType.BOOLEAN),
          first: variable(`${FIND}.${TICKET_ID}.attachments.first`, BaseType.OBJECT),
          last: variable(`${FIND}.${TICKET_ID}.attachments.last`, BaseType.OBJECT),
        },
      }),
    },
  }),
]

/** A consumer with no catalog manifest, so the generic {{…}} walk extracts its refs. */
const consumerNode = (refs: string[]): NodeMeta => ({
  id: CONSUMER,
  type: 'standard',
  data: { id: CONSUMER, type: 'custom-consumer', title: 'Draft Reply', text: refs.join(' ') },
})

const graphWith = (consumer: NodeMeta): WorkflowOutputGraph => ({
  nodes: [
    { id: FIND, type: 'standard', data: { id: FIND, type: 'custom-find', title: 'Find Contact' } },
    consumer,
    { id: STRAY, type: 'standard', data: { id: STRAY, type: 'custom-x', title: 'Stray Step' } },
  ],
  edges: [{ id: 'e1', source: FIND, target: CONSUMER }],
})

const check = (refs: string[]) =>
  checkVariableRefsAgainstOutputs({
    graph: graphWith(consumerNode(refs.map((r) => `{{${r}}}`))),
    outputs: new Map([[FIND, FIND_OUTPUTS]]),
    lookup: coreLookup,
  })

describe('checkVariableRefsAgainstOutputs', () => {
  it('accepts declared paths, numeric accessors, open-object depth, env/sys refs', () => {
    const { issues } = check([
      `${FIND}.count`,
      `${FIND}.${TICKET_ID}.subject`,
      `${FIND}.${TICKET_ID}.attachments.values[0].name`,
      `${FIND}.${TICKET_ID}.attachments.first`,
      `${FIND}.${TICKET_ID}.record.arbitrary.deep.path`,
      'env.THRESHOLD',
      'sys.userId',
    ])
    expect(issues).toEqual([])
  })

  it('reports a typo with did-you-mean candidates from the declared siblings', () => {
    const { issues } = check([`${FIND}.${TICKET_ID}.emial`])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      nodeRef: 'Draft Reply',
      ref: `${FIND}.${TICKET_ID}.emial`,
      suggestion: `${FIND}.${TICKET_ID}.email`,
    })
    expect(issues[0]!.message).toContain('No output "emial" on node Find Contact')
    expect(issues[0]!.message).toContain('did you mean "email"')
  })

  it('corrects a bare-array collection ref with the .values[*] form instead of rejecting it', () => {
    const { issues, corrections } = check([`${FIND}.${TICKET_ID}.attachments[*].name`])
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({
      severity: 'error',
      suggestion: `${FIND}.${TICKET_ID}.attachments.values[*].name`,
    })
    expect(issues[0]!.message).toContain('.count')
    expect(corrections).toEqual([
      {
        nodeId: CONSUMER,
        from: `${FIND}.${TICKET_ID}.attachments[*].name`,
        to: `${FIND}.${TICKET_ID}.attachments.values[*].name`,
      },
    ])
  })

  it('preserves the original numeric accessor in a collection correction', () => {
    const { corrections } = check([`${FIND}.${TICKET_ID}.attachments[0].name`])
    expect(corrections[0]?.to).toBe(`${FIND}.${TICKET_ID}.attachments.values[0].name`)
  })

  it('reports a ref to an unknown node with candidates', () => {
    const { issues } = check(['ghostnode.total'])
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toContain('unknown node "ghostnode"')
  })

  it('reports a ref to a node that exists but is not upstream, naming both nodes', () => {
    const { issues } = check([`${STRAY}.result`])
    expect(issues).toHaveLength(1)
    expect(issues[0]!.severity).toBe('error')
    expect(issues[0]!.message).toContain('Stray Step')
    expect(issues[0]!.message).toContain('not upstream')
    expect(issues[0]!.message).toContain('Draft Reply')
  })

  it('reports a self-reference', () => {
    const { issues } = check([`${CONSUMER}.text`])
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('own output')
  })

  it('skips path validation for nodes with no declared outputs (not-yet-migrated)', () => {
    const graph = graphWith(consumerNode([`{{${FIND}.anything.at.all}}`]))
    const { issues } = checkVariableRefsAgainstOutputs({
      graph,
      outputs: new Map(),
      lookup: coreLookup,
    })
    expect(issues).toEqual([])
  })

  it('allows loop children to read their container via parentId ancestry', () => {
    const loopId = 'loop1aaaaaaaaaaaaaaaaa'
    const child: NodeMeta = {
      id: CONSUMER,
      type: 'standard',
      parentId: loopId,
      data: { id: CONSUMER, type: 'custom-consumer', title: 'Child', text: `{{${loopId}.item}}` },
    }
    const graph: WorkflowOutputGraph = {
      nodes: [
        { id: loopId, type: 'loop', data: { id: loopId, type: 'loop', title: 'For Each' } },
        child,
      ],
      edges: [],
    }
    const { issues } = checkVariableRefsAgainstOutputs({
      graph,
      outputs: new Map(),
      lookup: coreLookup,
    })
    expect(issues).toEqual([])
  })
})

/**
 * Live regression from plan-17 §9.1: a `{{ref}}` the AGENT wrote into a
 * picker-bound field.
 *
 * The canvas writes those fields bare (`nodeId.path`); `update_node` patches
 * write the braced `{{nodeId.path}}` form. `isNodeVariable` only tests for a
 * dot, so every extractor that trusted it recorded the braced string verbatim
 * — and ref-check then read `{{nodeId` as the node name. In dev that turned a
 * perfectly valid `{{FedEx.trackingNumber}}` on a crud `resourceId` into
 * `points at unknown node "{{z3prn…:fedex-DmJu…"`, suggesting the same id
 * un-braced: an error the agent could not act on, and one that hid the real
 * path error underneath it.
 */
describe('braced refs in picker-bound fields (crud.resourceId)', () => {
  const crudConsumer = (resourceId: string): NodeMeta => ({
    id: CONSUMER,
    type: 'standard',
    data: {
      id: CONSUMER,
      type: 'crud',
      title: 'Update Record',
      mode: 'update',
      resourceType: 'contact',
      resourceId,
      data: {},
    },
  })

  const checkResourceId = (resourceId: string) =>
    checkVariableRefsAgainstOutputs({
      graph: graphWith(crudConsumer(resourceId)),
      outputs: new Map([[FIND, FIND_OUTPUTS]]),
      lookup: coreLookup,
    })

  it('accepts a valid braced ref instead of calling the node unknown', () => {
    expect(checkResourceId(`{{${FIND}.count}}`).issues).toEqual([])
  })

  it('still accepts the bare picker-written form', () => {
    expect(checkResourceId(`${FIND}.count`).issues).toEqual([])
  })

  it('reports the PATH error with candidates, not a bogus unknown-node error', () => {
    const { issues } = checkResourceId(`{{${FIND}.${TICKET_ID}.emial}}`)
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).not.toContain('unknown node')
    expect(issues[0]!.message).toContain('No output "emial" on node Find Contact')
    expect(issues[0]!.suggestion).toBe(`${FIND}.${TICKET_ID}.email`)
  })

  it('never emits a doubly-braced message for a genuinely unknown node', () => {
    const { issues } = checkResourceId('{{ghostaaaaaaaaaaaaaaaa.id}}')
    expect(issues).toHaveLength(1)
    expect(issues[0]!.message).toContain('points at unknown node "ghostaaaaaaaaaaaaaaaa"')
    expect(issues[0]!.message).not.toContain('{{{{')
  })
})
