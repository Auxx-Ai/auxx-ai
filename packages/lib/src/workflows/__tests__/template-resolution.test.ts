// packages/lib/src/workflows/__tests__/template-resolution.test.ts
// Covers `@entity:` / `@field:` placeholder resolution in a workflow graph —
// both the CRUD/Find config keys and the variable references (`{{…}}` spans and
// bare Tiptap `variable-node` ids) that make CUID-keyed engine variables
// expressible from a template.

import { describe, expect, it } from 'vitest'
import { TemplateGraphTransformer, type WorkflowGraph } from '../template-graph-transformer'
import {
  extractRequiredEntities,
  type RequiredEntity,
  resolveEntityRefsInGraph,
} from '../template-resolution'

const ORDER_DEF_ID = 'ent_orders_cuid'
const ORDER_NUMBER_FIELD_ID = 'fld_order_number_cuid'
const CONTACT_EMAIL_FIELD_ID = 'fld_primary_email_cuid'

/** `order` is a real built-in entity template (apiSlug `orders`). */
const REQUIRED_ENTITIES: RequiredEntity[] = [
  {
    entityTemplateId: 'order',
    name: 'Order',
    apiSlug: 'orders',
    fieldMapping: { orderNumber: 'orderNumber' },
    requiredFields: ['orderNumber'],
    required: true,
  },
  {
    entityTemplateId: '__system:contact',
    name: 'Contact',
    apiSlug: 'contact',
    fieldMapping: { primary_email: 'primary_email' },
    requiredFields: ['primary_email'],
    required: true,
  },
]

const ENTITY_ID_MAP: Record<string, string> = {
  order: ORDER_DEF_ID,
  '__system:contact': 'ent_contact_cuid',
}

const FIELD_ID_MAP: Record<string, Record<string, string>> = {
  order: { orderNumber: ORDER_NUMBER_FIELD_ID },
  '__system:contact': { primary_email: CONTACT_EMAIL_FIELD_ID },
}

function resolve(graph: WorkflowGraph) {
  return resolveEntityRefsInGraph(graph, REQUIRED_ENTITIES, ENTITY_ID_MAP, FIELD_ID_MAP)
}

/** Minimal node wrapper — position/type are irrelevant to resolution. */
function node(id: string, data: Record<string, any>): WorkflowGraph['nodes'][number] {
  return { id, type: 'standard', position: { x: 0, y: 0 }, data: { id, ...data } }
}

/** A find node on the `orders` entity, used as the referenced node in variable paths. */
function findOrderNode(id = 'find-order') {
  return node(id, { type: 'find', resourceType: '@entity:orders', findMode: 'findOne' })
}

describe('resolveEntityRefsInGraph — config pass (existing behaviour)', () => {
  it('rewrites resourceType for custom and system entities', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', { type: 'crud', resourceType: '@entity:orders', mode: 'create' }),
        node('crud-2', { type: 'crud', resourceType: '@entity:contact', mode: 'create' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[0]?.data.resourceType).toBe(ORDER_DEF_ID)
    expect(graph.nodes[1]?.data.resourceType).toBe('contact')
    expect(unresolvedNodes).toEqual([])
  })

  it('rewrites @field: dictionary keys and leaves values alone', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:orders',
          mode: 'create',
          data: { '@field:orderNumber': '{{extractor-1.extracted_data.orderNumber}}' },
          fieldModes: { '@field:orderNumber': false },
          fieldUpdateModes: { '@field:orderNumber': 'replace' },
          fieldUpdateModeVars: { '@field:orderNumber': '{{env.MODE}}' },
        }),
      ],
      edges: [],
    }

    resolve(graph)
    const data = graph.nodes[0]?.data as Record<string, any>

    expect(data.data).toEqual({
      [ORDER_NUMBER_FIELD_ID]: '{{extractor-1.extracted_data.orderNumber}}',
    })
    expect(data.fieldModes).toEqual({ [ORDER_NUMBER_FIELD_ID]: false })
    expect(data.fieldUpdateModes).toEqual({ [ORDER_NUMBER_FIELD_ID]: 'replace' })
    expect(data.fieldUpdateModeVars).toEqual({ [ORDER_NUMBER_FIELD_ID]: '{{env.MODE}}' })
  })

  it('rewrites find conditionGroups fieldId to the compound entityDefId:fieldId form', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-1', {
          type: 'find',
          resourceType: '@entity:orders',
          findMode: 'findOne',
          conditionGroups: [
            {
              id: 'g1',
              conditions: [{ id: 'c1', fieldId: '@field:orderNumber', operator: 'is', value: 'x' }],
            },
          ],
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[0]?.data.conditionGroups[0].conditions[0].fieldId).toBe(
      `${ORDER_DEF_ID}:${ORDER_NUMBER_FIELD_ID}`
    )
  })

  it('blanks resourceType and reports the node when the entity is not installed', () => {
    const graph: WorkflowGraph = {
      nodes: [node('crud-1', { type: 'crud', resourceType: '@entity:orders', mode: 'create' })],
      edges: [],
    }

    const { unresolvedNodes } = resolveEntityRefsInGraph(graph, REQUIRED_ENTITIES, {}, {})

    expect(graph.nodes[0]?.data.resourceType).toBe('')
    expect(unresolvedNodes).toEqual(['crud-1'])
  })
})

describe('resolveEntityRefsInGraph — @entity: inside {{…}}', () => {
  it('resolves the CUID a findOne on a custom entity keys its output by', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:orders',
          mode: 'update',
          resourceId: '{{find-order.@entity:orders}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.resourceId).toBe(`{{find-order.${ORDER_DEF_ID}}}`)
    expect(unresolvedNodes).toEqual([])
  })

  it('resolves a system entity to its type string', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-contact', {
          type: 'find',
          resourceType: '@entity:contact',
          findMode: 'findOne',
        }),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:contact',
          mode: 'update',
          resourceId: '{{find-contact.@entity:contact}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.resourceId).toBe('{{find-contact.contact}}')
  })

  it.each([
    ['answer.text', 'answer', (v: string) => ({ type: 'answer', text: `Order: ${v} — thanks!` })],
    ['answer.subject', 'answer', (v: string) => ({ type: 'answer', subject: v })],
    ['end.message', 'end', (v: string) => ({ type: 'end', message: v })],
    ['format.input', 'format', (v: string) => ({ type: 'format', input: v })],
    ['http.url', 'http', (v: string) => ({ type: 'http', url: v })],
    ['date-time.inputDate', 'date-time', (v: string) => ({ type: 'date-time', inputDate: v })],
    [
      'knowledge-retrieval.query',
      'knowledge-retrieval',
      (v: string) => ({ type: 'knowledge-retrieval', query: v }),
    ],
    [
      'human-confirmation.message',
      'human-confirmation',
      (v: string) => ({ type: 'human-confirmation', message: v }),
    ],
    [
      'information-extractor.text',
      'information-extractor',
      (v: string) => ({ type: 'information-extractor', text: v }),
    ],
    [
      'text-classifier.text',
      'text-classifier',
      (v: string) => ({ type: 'text-classifier', text: v }),
    ],
    [
      'app node data (@shopify:shopify)',
      '@shopify:shopify',
      (v: string) => ({ type: '@shopify:shopify', appSlug: 'shopify', getOrderId: v }),
    ],
    [
      'if-else.cases[].conditions[].value',
      'if-else',
      (v: string) => ({
        type: 'if-else',
        cases: [
          { id: 'c', conditions: [{ id: 'x', variableId: 'a.b', operator: 'is', value: v }] },
        ],
      }),
    ],
    [
      'find.conditionGroups[].conditions[].value',
      'find',
      (v: string) => ({
        type: 'find',
        resourceType: '@entity:contact',
        findMode: 'findOne',
        conditionGroups: [
          { id: 'g', conditions: [{ id: 'c', fieldId: 'x', operator: 'is', value: v }] },
        ],
      }),
    ],
    [
      'var-assign.variables[].value',
      'var-assign',
      (v: string) => ({ type: 'var-assign', variables: [{ id: 'v1', name: 'a', value: v }] }),
    ],
    [
      'http.body.data[].value',
      'http',
      (v: string) => ({ type: 'http', body: { data: [{ key: 'orderRef', value: v }] } }),
    ],
    [
      'crud.data value',
      'crud',
      (v: string) => ({
        type: 'crud',
        resourceType: '@entity:contact',
        mode: 'create',
        data: { '@field:primary_email': v },
      }),
    ],
  ])('resolves inside %s', (_label, _type, build) => {
    const graph: WorkflowGraph = {
      nodes: [findOrderNode(), node('target', build('{{find-order.@entity:orders}}'))],
      edges: [],
    }

    resolve(graph)

    expect(JSON.stringify(graph.nodes[1]?.data)).toContain(`{{find-order.${ORDER_DEF_ID}}}`)
    expect(JSON.stringify(graph.nodes[1]?.data)).not.toContain('@entity:orders')
  })

  it('resolves a bare Tiptap variable-node id inside an ai prompt', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('ai-1', {
          type: 'ai',
          prompt_template: [
            {
              role: 'system',
              json: {
                type: 'doc',
                content: [
                  {
                    type: 'paragraph',
                    content: [
                      { type: 'text', text: 'Order record: ' },
                      {
                        type: 'variable-node',
                        attrs: { variableId: 'find-order.@entity:orders.@field:orderNumber' },
                      },
                    ],
                  },
                ],
              },
            },
          ],
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)
    const chip = graph.nodes[1]?.data.prompt_template[0].json.content[0].content[1]

    expect(chip.attrs.variableId).toBe(`find-order.${ORDER_DEF_ID}.${ORDER_NUMBER_FIELD_ID}`)
    expect(unresolvedNodes).toEqual([])
  })

  it('resolves several placeholders in one string', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('find-contact', {
          type: 'find',
          resourceType: '@entity:contact',
          findMode: 'findOne',
        }),
        node('answer-1', {
          type: 'answer',
          text: 'Order {{find-order.@entity:orders}} for {{find-contact.@entity:contact}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[2]?.data.text).toBe(
      `Order {{find-order.${ORDER_DEF_ID}}} for {{find-contact.contact}}`
    )
  })
})

describe('resolveEntityRefsInGraph — @field: inside {{…}}', () => {
  it('resolves against the preceding @entity: token in the same path', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('answer-1', {
          type: 'answer',
          text: '{{find-order.@entity:orders.@field:orderNumber}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(
      `{{find-order.${ORDER_DEF_ID}.${ORDER_NUMBER_FIELD_ID}}}`
    )
  })

  it('falls back to the entity of the node the path starts at (findMany plural form)', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-order', { type: 'find', resourceType: '@entity:orders', findMode: 'findMany' }),
        node('answer-1', {
          type: 'answer',
          text: '{{find-order.orders[0].@field:orderNumber}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(`{{find-order.orders[0].${ORDER_NUMBER_FIELD_ID}}}`)
    expect(unresolvedNodes).toEqual([])
  })

  it('leaves a @field: with no entity context alone and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('extractor-1', { type: 'information-extractor', text: 'x' }),
        node('answer-1', { type: 'answer', text: '{{extractor-1.@field:orderNumber}}' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe('{{extractor-1.@field:orderNumber}}')
    expect(unresolvedNodes).toEqual(['answer-1'])
  })
})

describe('resolveEntityRefsInGraph — unresolvable refs', () => {
  it('leaves an unknown entity slug verbatim and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:contact',
          mode: 'update',
          resourceId: '{{find-order.@entity:widgets}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.resourceId).toBe('{{find-order.@entity:widgets}}')
    expect(unresolvedNodes).toEqual(['crud-1'])
  })

  it('leaves an unknown field ref verbatim and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('answer-1', { type: 'answer', text: '{{find-order.@entity:orders.@field:nope}}' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(`{{find-order.${ORDER_DEF_ID}.@field:nope}}`)
    expect(unresolvedNodes).toEqual(['answer-1'])
  })

  it('reports each node at most once', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:widgets',
          mode: 'update',
          resourceId: '{{crud-1.@entity:widgets}} {{crud-1.@entity:gadgets}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(unresolvedNodes).toEqual(['crud-1'])
  })
})

describe('resolveEntityRefsInGraph — leaves ordinary text alone', () => {
  it('does not touch an @ that is not a placeholder', () => {
    const text =
      'Reply to support@auxx.ai, cc @markus. Costs are @ $5. Email: {{trigger-1.message.from.email}}'
    const graph: WorkflowGraph = {
      nodes: [
        node('trigger-1', { type: 'message-received' }),
        node('answer-1', { type: 'answer', text }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(text)
  })

  it('does not touch a placeholder written outside a variable reference', () => {
    const prose = 'Use the @entity:orders placeholder and the @field:orderNumber ref in CRUD nodes.'
    const graph: WorkflowGraph = {
      nodes: [findOrderNode(), node('answer-1', { type: 'answer', text: prose })],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(prose)
    expect(unresolvedNodes).toEqual([])
  })

  it('does not touch $comment authoring prose', () => {
    const comment = 'TECHNIQUE 3: {{find-order.@entity:orders}} resolves to the entity id'
    const graph: WorkflowGraph = {
      nodes: [findOrderNode(), node('answer-1', { type: 'answer', $comment: comment, text: 'hi' })],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.$comment).toBe(comment)
  })

  it('is idempotent — a second pass finds nothing left to rewrite', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findOrderNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:orders',
          mode: 'update',
          resourceId: '{{find-order.@entity:orders}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)
    const afterFirst = JSON.stringify(graph)
    resolve(graph)

    expect(JSON.stringify(graph)).toBe(afterFirst)
  })
})

describe('resolveEntityRefsInGraph — composes with node-id remapping', () => {
  it('resolves placeholders against the cloned node ids', () => {
    const template: WorkflowGraph = {
      nodes: [
        {
          id: 'find-order-009',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: {
            id: 'find-order-009',
            type: 'find',
            resourceType: '@entity:orders',
            findMode: 'findOne',
          },
        },
        {
          id: 'update-order-012',
          type: 'standard',
          position: { x: 100, y: 0 },
          data: {
            id: 'update-order-012',
            type: 'crud',
            resourceType: '@entity:orders',
            mode: 'update',
            resourceId: '{{find-order-009.@entity:orders}}',
            data: {
              '@field:orderNumber': '{{find-order-009.@entity:orders.@field:orderNumber}}',
            },
            prompt: [
              {
                type: 'variable-node',
                attrs: { variableId: 'find-order-009.@entity:orders.@field:orderNumber' },
              },
            ],
          },
        },
      ],
      edges: [{ id: 'e1', source: 'find-order-009', target: 'update-order-012' }],
    }

    const transformer = new TemplateGraphTransformer()
    const { graph, idMapping } = transformer.cloneGraph(template)
    const newFindId = idMapping.get('find-order-009')!

    const { unresolvedNodes } = resolve(graph)
    const crud = graph.nodes[1]?.data as Record<string, any>

    expect(newFindId).not.toBe('find-order-009')
    expect(crud.resourceId).toBe(`{{${newFindId}.${ORDER_DEF_ID}}}`)
    expect(crud.data[ORDER_NUMBER_FIELD_ID]).toBe(
      `{{${newFindId}.${ORDER_DEF_ID}.${ORDER_NUMBER_FIELD_ID}}}`
    )
    expect(crud.prompt[0].attrs.variableId).toBe(
      `${newFindId}.${ORDER_DEF_ID}.${ORDER_NUMBER_FIELD_ID}`
    )
    expect(unresolvedNodes).toEqual([])
  })
})

describe('extractRequiredEntities', () => {
  it('collects refs from resourceType and dictionary keys', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:orders',
          data: { '@field:orderNumber': 'x' },
        }),
      ],
      edges: [],
    }

    const extracted = extractRequiredEntities(graph)

    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.requiredFields).toEqual(['orderNumber'])
  })

  it('also collects refs that only appear inside variable references', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-order', { type: 'find', resourceType: '@entity:orders', findMode: 'findMany' }),
        node('answer-1', { type: 'answer', text: '{{find-order.orders[0].@field:trackingUrl}}' }),
      ],
      edges: [],
    }

    const extracted = extractRequiredEntities(graph)

    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.apiSlug).toBe('orders')
    expect(extracted[0]?.requiredFields).toEqual(['trackingUrl'])
  })
})
