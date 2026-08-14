// packages/lib/src/workflows/graph-edit/__tests__/ref-check.test.ts

/**
 * Dangling-ref and non-upstream-ref errors naming candidates
 * (`03-graph-edit-service.md` §9), including the collection-shape correction:
 * `{{X.attachments[*]}}` comes back WITH the suggested `.values[*]` form.
 * Upstream reachability comes from the catalog's `buildUpstreamMap`.
 */

import { describe, expect, it, vi } from 'vitest'
import { BaseType } from '../../../workflow-engine/core/types'
import type { UnifiedVariable } from '../../../workflow-engine/types/unified-variable'
import type { NodeMeta, WorkflowOutputGraph } from '../types'

// ref-check statically imports the catalog's server-side resolve-outputs, whose
// cache read must not hit a real backend if the composed helper is ever used.
const getCachedResources = vi.fn().mockResolvedValue([])
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../cache')>()),
  getCachedResources: (...args: unknown[]) => getCachedResources(...args),
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
    const { issues } = checkVariableRefsAgainstOutputs({ graph, outputs: new Map() })
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
    const { issues } = checkVariableRefsAgainstOutputs({ graph, outputs: new Map() })
    expect(issues).toEqual([])
  })
})
