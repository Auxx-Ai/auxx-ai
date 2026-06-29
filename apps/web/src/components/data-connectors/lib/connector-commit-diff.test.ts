// apps/web/src/components/data-connectors/lib/connector-commit-diff.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type ConnectorDraft,
  type ConnectorMeta,
  getConnectorDraftState,
} from '../stores/connector-draft-store'
import { diffConnectorDraft, isEmptyPlan } from './connector-commit-diff'

const META: ConnectorMeta = { definitionKind: 'builtin', credentialId: 'cred_1', status: 'live' }

function baseDraft(): ConnectorDraft {
  return {
    name: 'Conn',
    syncBehavior: 'manual',
    scheduleConfig: null,
    config: { endpoint: { baseUrl: 'https://api.test/v1' } },
    streams: [
      {
        id: 'stream_1',
        streamKey: 'orders',
        enabled: true,
        syncMode: 'snapshot',
        requestConfig: { path: '/orders' },
        sourceSchema: { id: { type: 'string' } },
        schemaSource: 'inferred',
        mappings: [
          {
            id: 'map_root',
            parentMappingId: null,
            rootPath: '',
            relationshipFieldKey: null,
            linkMode: 'upsert',
            targetMode: 'owned',
            entityDefinitionId: 'def_order',
            orphanBehavior: 'archive',
            fieldMappings: [
              {
                id: 'fm_1',
                targetFieldRef: 'def_order:f_id',
                expression: '{{id}}',
                sourceFields: { id: 'id' },
              },
            ],
          },
        ],
      },
    ],
  }
}

/** Seed the store with a clone of `baseDraft`, run `edits`, return [snapshot, draft]. */
function withEdits(edits: () => void): [ConnectorDraft, ConnectorDraft] {
  getConnectorDraftState().reset()
  getConnectorDraftState().seed('conn_1', META, baseDraft())
  edits()
  const { snapshot, draft } = getConnectorDraftState()
  return [snapshot!, draft]
}

beforeEach(() => getConnectorDraftState().reset())

describe('empty / clean', () => {
  it('a clean draft yields an empty plan (no network)', () => {
    const [snap, draft] = withEdits(() => {})
    const plan = diffConnectorDraft(snap, draft)
    expect(isEmptyPlan(plan)).toBe(true)
    expect(plan.structural).toBe(false)
  })
})

describe('connector-level', () => {
  it('schedule change → one connectorUpdate, structural', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().setSyncBehavior('scheduled')
      getConnectorDraftState().setScheduleConfig({ triggerInterval: 'hours' })
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.connectorUpdate).toEqual({
      syncBehavior: 'scheduled',
      scheduleConfig: { triggerInterval: 'hours' },
    })
    expect(plan.structural).toBe(true)
  })

  it('config edit (base url) → connectorUpdate sends the whole config blob', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().setConfig({ endpoint: { baseUrl: 'https://api.test/v2' } })
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.connectorUpdate?.config).toEqual({ endpoint: { baseUrl: 'https://api.test/v2' } })
  })
})

describe('field-only mapping update', () => {
  it('a binding-only edit → one update, NOT structural', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().updateMapping('stream_1', 'map_root', {
        fieldMappings: [
          {
            id: 'fm_1',
            targetFieldRef: 'def_order:f_id',
            expression: '{{id}}',
            sourceFields: { id: 'id' },
          },
          {
            id: 'fm_2',
            targetFieldRef: 'def_order:f_total',
            expression: '{{total}}',
            sourceFields: { total: 'total' },
          },
        ],
      })
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.mappingUpdates).toHaveLength(1)
    expect(plan.mappingUpdates[0]!.mappingId).toBe('map_root')
    expect(plan.mappingUpdates[0]!.patch.fieldMappings).toHaveLength(2)
    expect(plan.structural).toBe(false)
  })

  it('a rootPath edit IS structural', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().updateMapping('stream_1', 'map_root', { rootPath: 'data' })
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.mappingUpdates[0]!.patch).toEqual({ rootPath: 'data' })
    expect(plan.structural).toBe(true)
  })
})

describe('fan-out → bind → save', () => {
  it('one create + one update, temp parentMappingId is real (root not temp)', () => {
    let tempId = ''
    const [snap, draft] = withEdits(() => {
      tempId = getConnectorDraftState().addMapping('stream_1', {
        parentMappingId: 'map_root',
        rootPath: 'customer',
        relationshipFieldKey: 'customer',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_contact',
        fieldMappings: [
          {
            id: 'fm_c',
            targetFieldRef: 'def_contact:f_ext',
            expression: '{{customer.id}}',
            sourceFields: { id: 'customer.id' },
            identityRole: { kind: 'externalId' },
          },
        ],
      })
      // bind another field on the root after fan-out
      getConnectorDraftState().updateMapping('stream_1', 'map_root', {
        rootPath: 'orders[]',
      })
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.mappingCreates).toHaveLength(1)
    expect(plan.mappingCreates[0]!.tempId).toBe(tempId)
    expect(plan.mappingCreates[0]!.parentMappingId).toBe('map_root')
    expect(plan.mappingCreates[0]!.entityDefinitionId).toBe('def_contact')
    expect(plan.mappingUpdates).toHaveLength(1)
    expect(plan.structural).toBe(true)
  })

  it('nested fan-out orders parents before children (temp parent first)', () => {
    let parentTemp = ''
    let childTemp = ''
    const [snap, draft] = withEdits(() => {
      parentTemp = getConnectorDraftState().addMapping('stream_1', {
        parentMappingId: 'map_root',
        rootPath: 'customer',
        relationshipFieldKey: 'customer',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_contact',
      })
      childTemp = getConnectorDraftState().addMapping('stream_1', {
        parentMappingId: parentTemp,
        rootPath: 'address',
        relationshipFieldKey: 'address',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_address',
      })
    })
    const plan = diffConnectorDraft(snap, draft)
    const order = plan.mappingCreates.map((c) => c.tempId)
    expect(order.indexOf(parentTemp)).toBeLessThan(order.indexOf(childTemp))
    expect(plan.mappingCreates.find((c) => c.tempId === childTemp)!.parentMappingId).toBe(
      parentTemp
    )
  })
})

describe('fan-out → remove before save', () => {
  it('a temp row added then removed is a no-op (no create, no delete)', () => {
    const [snap, draft] = withEdits(() => {
      const t = getConnectorDraftState().addMapping('stream_1', {
        parentMappingId: 'map_root',
        rootPath: 'customer',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_contact',
      })
      getConnectorDraftState().removeMapping('stream_1', t)
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(isEmptyPlan(plan)).toBe(true)
  })
})

describe('subtree delete', () => {
  it('removing an existing subtree root → one removeMapping (cascade covers children)', () => {
    const draftWithChildren = baseDraft()
    draftWithChildren.streams[0]!.mappings.push(
      {
        id: 'map_child',
        parentMappingId: 'map_root',
        rootPath: 'customer',
        relationshipFieldKey: 'customer',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_contact',
        orphanBehavior: 'ignore',
        fieldMappings: [],
      },
      {
        id: 'map_grand',
        parentMappingId: 'map_child',
        rootPath: 'address',
        relationshipFieldKey: 'address',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_address',
        orphanBehavior: 'ignore',
        fieldMappings: [],
      }
    )
    getConnectorDraftState().reset()
    getConnectorDraftState().seed('conn_1', META, draftWithChildren)
    getConnectorDraftState().removeMapping('stream_1', 'map_child')
    const { snapshot, draft } = getConnectorDraftState()
    const plan = diffConnectorDraft(snapshot!, draft)
    expect(plan.mappingDeletes).toEqual([{ mappingId: 'map_child' }])
    expect(plan.structural).toBe(true)
  })
})

describe('stream config', () => {
  it('requestConfig + syncMode change → one setStreamRequestConfig with syncMode', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().setRequestConfig('stream_1', { path: '/orders', method: 'POST' })
      getConnectorDraftState().setSyncMode('stream_1', 'incremental')
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.streamRequestConfigs).toHaveLength(1)
    expect(plan.streamRequestConfigs[0]).toEqual({
      streamId: 'stream_1',
      requestConfig: { path: '/orders', method: 'POST' },
      syncMode: 'incremental',
    })
    expect(plan.structural).toBe(true)
  })

  it('schema change → setStreamSchema', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().setStreamSchema('stream_1', { id: { type: 'number' } }, 'manual')
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.streamSchemas).toEqual([
      { streamId: 'stream_1', sourceSchema: { id: { type: 'number' } }, schemaSource: 'manual' },
    ])
  })

  it('rename stream → updateStream', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().renameStream('stream_1', 'invoices')
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.streamRenames).toEqual([{ streamId: 'stream_1', streamKey: 'invoices' }])
  })

  it('enabled-only toggle → one streamRenames entry with { enabled }, NOT structural', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().setStreamEnabled('stream_1', false)
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.streamRenames).toEqual([{ streamId: 'stream_1', enabled: false }])
    expect(plan.structural).toBe(false)
  })

  it('streamKey + enabled change merge into one entry', () => {
    const [snap, draft] = withEdits(() => {
      getConnectorDraftState().renameStream('stream_1', 'invoices')
      getConnectorDraftState().setStreamEnabled('stream_1', false)
    })
    const plan = diffConnectorDraft(snap, draft)
    expect(plan.streamRenames).toEqual([
      { streamId: 'stream_1', streamKey: 'invoices', enabled: false },
    ])
    expect(plan.structural).toBe(false)
  })
})

describe('mixed commit ordering', () => {
  it('connector + stream + mapping create + delete in one plan', () => {
    const draftWithChild = baseDraft()
    draftWithChild.streams[0]!.mappings.push({
      id: 'map_old',
      parentMappingId: 'map_root',
      rootPath: 'old',
      relationshipFieldKey: 'old',
      linkMode: 'reference',
      targetMode: 'contributing',
      entityDefinitionId: 'def_old',
      orphanBehavior: 'ignore',
      fieldMappings: [],
    })
    getConnectorDraftState().reset()
    getConnectorDraftState().seed('conn_1', META, draftWithChild)
    getConnectorDraftState().setSyncBehavior('scheduled')
    getConnectorDraftState().renameStream('stream_1', 'orders2')
    getConnectorDraftState().addMapping('stream_1', {
      parentMappingId: 'map_root',
      rootPath: 'new',
      linkMode: 'reference',
      targetMode: 'contributing',
      entityDefinitionId: 'def_new',
    })
    getConnectorDraftState().removeMapping('stream_1', 'map_old')
    const { snapshot, draft } = getConnectorDraftState()
    const plan = diffConnectorDraft(snapshot!, draft)
    expect(plan.connectorUpdate?.syncBehavior).toBe('scheduled')
    expect(plan.streamRenames).toHaveLength(1)
    expect(plan.mappingCreates).toHaveLength(1)
    expect(plan.mappingDeletes).toEqual([{ mappingId: 'map_old' }])
    expect(plan.structural).toBe(true)
  })
})
