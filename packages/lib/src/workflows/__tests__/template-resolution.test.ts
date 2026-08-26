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

const DEAL_DEF_ID = 'ent_deals_cuid'
const DEAL_NAME_FIELD_ID = 'fld_deal_name_cuid'
const ORDER_DEF_ID = 'ent_order_cuid'
const ORDER_NUMBER_FIELD_ID = 'fld_order_number_cuid'
const CONTACT_EMAIL_FIELD_ID = 'fld_primary_email_cuid'

/**
 * Two resolution branches, deliberately both represented.
 *
 * `deal` is a real built-in entity template (apiSlug `deals`) and carries the
 * **custom** branch: `getEntityTemplateById` → `entity.apiSlug` builds the ref
 * key, and the ref resolves to the entity-definition **CUID**.
 *
 * `contact` and `order` are **system** entities. `template-resolution.ts:393`
 * resolves those to the bare entityType string, never a CUID — so a system
 * entity cannot stand in for the custom branch. `order` used to be a custom
 * template here (`templates/order.json`, apiSlug `orders`); that template was
 * retired when the native order shipped
 * (plans/products/08-order-build.md §3.5), so it moved to `__system:order`
 * and `deal` took over the CUID coverage.
 */
const REQUIRED_ENTITIES: RequiredEntity[] = [
  {
    entityTemplateId: 'deal',
    name: 'Deal',
    apiSlug: 'deals',
    fieldMapping: { dealName: 'dealName' },
    requiredFields: ['dealName'],
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
  {
    entityTemplateId: '__system:order',
    name: 'Order',
    apiSlug: 'order',
    fieldMapping: { order_number: 'order_number' },
    requiredFields: ['order_number'],
    required: true,
  },
]

const ENTITY_ID_MAP: Record<string, string> = {
  deal: DEAL_DEF_ID,
  '__system:contact': 'ent_contact_cuid',
  '__system:order': ORDER_DEF_ID,
}

const FIELD_ID_MAP: Record<string, Record<string, string>> = {
  deal: { dealName: DEAL_NAME_FIELD_ID },
  '__system:contact': { primary_email: CONTACT_EMAIL_FIELD_ID },
  '__system:order': { order_number: ORDER_NUMBER_FIELD_ID },
}

function resolve(graph: WorkflowGraph) {
  return resolveEntityRefsInGraph(graph, REQUIRED_ENTITIES, ENTITY_ID_MAP, FIELD_ID_MAP)
}

/** Minimal node wrapper — position/type are irrelevant to resolution. */
function node(id: string, data: Record<string, any>): WorkflowGraph['nodes'][number] {
  return { id, type: 'standard', position: { x: 0, y: 0 }, data: { id, ...data } }
}

/** A find node on the `deals` entity, used as the referenced node in variable paths. */
function findDealNode(id = 'find-deal') {
  return node(id, { type: 'find', resourceType: '@entity:deals', findMode: 'findOne' })
}

describe('resolveEntityRefsInGraph — config pass (existing behaviour)', () => {
  it('rewrites resourceType for custom and system entities', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', { type: 'crud', resourceType: '@entity:deals', mode: 'create' }),
        node('crud-2', { type: 'crud', resourceType: '@entity:contact', mode: 'create' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[0]?.data.resourceType).toBe(DEAL_DEF_ID)
    expect(graph.nodes[1]?.data.resourceType).toBe('contact')
    expect(unresolvedNodes).toEqual([])
  })

  // The binding `order-issue-triage.template.json` uses since the native order
  // shipped. It is NOT the custom-entity path above: `template-resolution.ts:393`
  // sends a `__system:` templateId to the bare entityType string, so an order node
  // resolves to `'order'` and never to `ORDER_DEF_ID`. Pinned because the template
  // previously bound to a retired entity template at apiSlug `orders`, which
  // silently resolved to nothing and left `@entity:orders` in the installed graph.
  it('sends a system order to its entityType, not to an entity-definition CUID', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-order-009', {
          type: 'find',
          resourceType: '@entity:order',
          findMode: 'findOne',
          conditionGroups: [
            {
              id: 'g1',
              conditions: [
                { id: 'c1', fieldId: '@field:order_number', operator: 'is', value: 'x' },
              ],
            },
          ],
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[0]?.data.resourceType).toBe('order')
    expect(graph.nodes[0]?.data.resourceType).not.toBe(ORDER_DEF_ID)
    expect(graph.nodes[0]?.data.conditionGroups[0].conditions[0].fieldId).toBe(
      `${ORDER_DEF_ID}:${ORDER_NUMBER_FIELD_ID}`
    )
    expect(unresolvedNodes).toEqual([])
  })

  it('rewrites a system order @field: dictionary key to the field id', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('create-order-011', {
          type: 'crud',
          resourceType: '@entity:order',
          mode: 'create',
          data: { '@field:order_number': 'x', '@field:order_contact': '{{find-contact.contact}}' },
        }),
      ],
      edges: [],
    }

    resolve(graph)

    const data = graph.nodes[0]?.data.data
    // order_number is in the fixture's fieldMapping; order_contact is not, so it
    // stays verbatim — an unmapped @field: is left alone rather than dropped.
    expect(data[ORDER_NUMBER_FIELD_ID]).toBe('x')
    expect(data['@field:order_contact']).toBe('{{find-contact.contact}}')
  })

  it('rewrites @field: dictionary keys and leaves values alone', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:deals',
          mode: 'create',
          data: { '@field:dealName': '{{extractor-1.extracted_data.orderNumber}}' },
          fieldModes: { '@field:dealName': false },
          fieldUpdateModes: { '@field:dealName': 'replace' },
          fieldUpdateModeVars: { '@field:dealName': '{{env.MODE}}' },
        }),
      ],
      edges: [],
    }

    resolve(graph)
    const data = graph.nodes[0]?.data as Record<string, any>

    expect(data.data).toEqual({
      [DEAL_NAME_FIELD_ID]: '{{extractor-1.extracted_data.orderNumber}}',
    })
    expect(data.fieldModes).toEqual({ [DEAL_NAME_FIELD_ID]: false })
    expect(data.fieldUpdateModes).toEqual({ [DEAL_NAME_FIELD_ID]: 'replace' })
    expect(data.fieldUpdateModeVars).toEqual({ [DEAL_NAME_FIELD_ID]: '{{env.MODE}}' })
  })

  it('rewrites find conditionGroups fieldId to the compound entityDefId:fieldId form', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-1', {
          type: 'find',
          resourceType: '@entity:deals',
          findMode: 'findOne',
          conditionGroups: [
            {
              id: 'g1',
              conditions: [{ id: 'c1', fieldId: '@field:dealName', operator: 'is', value: 'x' }],
            },
          ],
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[0]?.data.conditionGroups[0].conditions[0].fieldId).toBe(
      `${DEAL_DEF_ID}:${DEAL_NAME_FIELD_ID}`
    )
  })

  it('blanks resourceType and reports the node when the entity is not installed', () => {
    const graph: WorkflowGraph = {
      nodes: [node('crud-1', { type: 'crud', resourceType: '@entity:deals', mode: 'create' })],
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
        findDealNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:deals',
          mode: 'update',
          resourceId: '{{find-deal.@entity:deals}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.resourceId).toBe(`{{find-deal.${DEAL_DEF_ID}}}`)
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
      nodes: [findDealNode(), node('target', build('{{find-deal.@entity:deals}}'))],
      edges: [],
    }

    resolve(graph)

    expect(JSON.stringify(graph.nodes[1]?.data)).toContain(`{{find-deal.${DEAL_DEF_ID}}}`)
    expect(JSON.stringify(graph.nodes[1]?.data)).not.toContain('@entity:deals')
  })

  it('resolves a bare Tiptap variable-node id inside an ai prompt', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
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
                        attrs: { variableId: 'find-deal.@entity:deals.@field:dealName' },
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

    expect(chip.attrs.variableId).toBe(`find-deal.${DEAL_DEF_ID}.${DEAL_NAME_FIELD_ID}`)
    expect(unresolvedNodes).toEqual([])
  })

  it('resolves several placeholders in one string', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
        node('find-contact', {
          type: 'find',
          resourceType: '@entity:contact',
          findMode: 'findOne',
        }),
        node('answer-1', {
          type: 'answer',
          text: 'Deal {{find-deal.@entity:deals}} for {{find-contact.@entity:contact}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[2]?.data.text).toBe(
      `Deal {{find-deal.${DEAL_DEF_ID}}} for {{find-contact.contact}}`
    )
  })
})

describe('resolveEntityRefsInGraph — @field: inside {{…}}', () => {
  it('resolves against the preceding @entity: token in the same path', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
        node('answer-1', {
          type: 'answer',
          text: '{{find-deal.@entity:deals.@field:dealName}}',
        }),
      ],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(`{{find-deal.${DEAL_DEF_ID}.${DEAL_NAME_FIELD_ID}}}`)
  })

  it('falls back to the entity of the node the path starts at (findMany plural form)', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-deal', { type: 'find', resourceType: '@entity:deals', findMode: 'findMany' }),
        node('answer-1', {
          type: 'answer',
          text: '{{find-deal.deals[0].@field:dealName}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(`{{find-deal.deals[0].${DEAL_NAME_FIELD_ID}}}`)
    expect(unresolvedNodes).toEqual([])
  })

  it('leaves a @field: with no entity context alone and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('extractor-1', { type: 'information-extractor', text: 'x' }),
        node('answer-1', { type: 'answer', text: '{{extractor-1.@field:dealName}}' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe('{{extractor-1.@field:dealName}}')
    expect(unresolvedNodes).toEqual(['answer-1'])
  })
})

describe('resolveEntityRefsInGraph — unresolvable refs', () => {
  it('leaves an unknown entity slug verbatim and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:contact',
          mode: 'update',
          resourceId: '{{find-deal.@entity:widgets}}',
        }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.resourceId).toBe('{{find-deal.@entity:widgets}}')
    expect(unresolvedNodes).toEqual(['crud-1'])
  })

  it('leaves an unknown field ref verbatim and reports the node', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
        node('answer-1', { type: 'answer', text: '{{find-deal.@entity:deals.@field:nope}}' }),
      ],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(`{{find-deal.${DEAL_DEF_ID}.@field:nope}}`)
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
    const prose = 'Use the @entity:deals placeholder and the @field:dealName ref in CRUD nodes.'
    const graph: WorkflowGraph = {
      nodes: [findDealNode(), node('answer-1', { type: 'answer', text: prose })],
      edges: [],
    }

    const { unresolvedNodes } = resolve(graph)

    expect(graph.nodes[1]?.data.text).toBe(prose)
    expect(unresolvedNodes).toEqual([])
  })

  it('does not touch $comment authoring prose', () => {
    const comment = 'TECHNIQUE 3: {{find-deal.@entity:deals}} resolves to the entity id'
    const graph: WorkflowGraph = {
      nodes: [findDealNode(), node('answer-1', { type: 'answer', $comment: comment, text: 'hi' })],
      edges: [],
    }

    resolve(graph)

    expect(graph.nodes[1]?.data.$comment).toBe(comment)
  })

  it('is idempotent — a second pass finds nothing left to rewrite', () => {
    const graph: WorkflowGraph = {
      nodes: [
        findDealNode(),
        node('crud-1', {
          type: 'crud',
          resourceType: '@entity:deals',
          mode: 'update',
          resourceId: '{{find-deal.@entity:deals}}',
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
          id: 'find-deal-009',
          type: 'standard',
          position: { x: 0, y: 0 },
          data: {
            id: 'find-deal-009',
            type: 'find',
            resourceType: '@entity:deals',
            findMode: 'findOne',
          },
        },
        {
          id: 'update-deal-012',
          type: 'standard',
          position: { x: 100, y: 0 },
          data: {
            id: 'update-deal-012',
            type: 'crud',
            resourceType: '@entity:deals',
            mode: 'update',
            resourceId: '{{find-deal-009.@entity:deals}}',
            data: {
              '@field:dealName': '{{find-deal-009.@entity:deals.@field:dealName}}',
            },
            prompt: [
              {
                type: 'variable-node',
                attrs: { variableId: 'find-deal-009.@entity:deals.@field:dealName' },
              },
            ],
          },
        },
      ],
      edges: [{ id: 'e1', source: 'find-deal-009', target: 'update-deal-012' }],
    }

    const transformer = new TemplateGraphTransformer()
    const { graph, idMapping } = transformer.cloneGraph(template)
    const newFindId = idMapping.get('find-deal-009')!

    const { unresolvedNodes } = resolve(graph)
    const crud = graph.nodes[1]?.data as Record<string, any>

    expect(newFindId).not.toBe('find-deal-009')
    expect(crud.resourceId).toBe(`{{${newFindId}.${DEAL_DEF_ID}}}`)
    expect(crud.data[DEAL_NAME_FIELD_ID]).toBe(
      `{{${newFindId}.${DEAL_DEF_ID}.${DEAL_NAME_FIELD_ID}}}`
    )
    expect(crud.prompt[0].attrs.variableId).toBe(
      `${newFindId}.${DEAL_DEF_ID}.${DEAL_NAME_FIELD_ID}`
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
          resourceType: '@entity:deals',
          data: { '@field:dealName': 'x' },
        }),
      ],
      edges: [],
    }

    const extracted = extractRequiredEntities(graph)

    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.requiredFields).toEqual(['dealName'])
  })

  it('also collects refs that only appear inside variable references', () => {
    const graph: WorkflowGraph = {
      nodes: [
        node('find-deal', { type: 'find', resourceType: '@entity:deals', findMode: 'findMany' }),
        node('answer-1', { type: 'answer', text: '{{find-deal.deals[0].@field:stage}}' }),
      ],
      edges: [],
    }

    const extracted = extractRequiredEntities(graph)

    expect(extracted).toHaveLength(1)
    expect(extracted[0]?.apiSlug).toBe('deals')
    expect(extracted[0]?.requiredFields).toEqual(['stage'])
  })
})
