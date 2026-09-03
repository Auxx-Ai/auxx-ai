// apps/web/src/components/data-connectors/stores/connector-draft-store.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import {
  type ConnectorDraft,
  type ConnectorMeta,
  descendantIds,
  getConnectorDraftState,
  isTempId,
  selectCanCommit,
  selectIsDirty,
  selectRecordFilterChanged,
  useConnectorDraftStore,
  visibleMappings,
} from './connector-draft-store'

const META: ConnectorMeta = { definitionKind: 'builtin', credentialId: 'cred_1', status: 'live' }

function makeDraft(overrides: Partial<ConnectorDraft> = {}): ConnectorDraft {
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
        recordFilter: null,
        mappings: [
          {
            id: 'map_1',
            parentMappingId: null,
            rootPath: '',
            relationshipFieldKey: null,
            linkMode: 'upsert',
            targetMode: 'owned',
            entityDefinitionId: 'def_order',
            orphanBehavior: 'archive',
            fieldMappings: [],
          },
        ],
      },
    ],
    ...overrides,
  }
}

function seed(draft = makeDraft()) {
  getConnectorDraftState().seed('conn_1', META, draft)
}

beforeEach(() => {
  getConnectorDraftState().reset()
})

describe('seed / reset', () => {
  it('seeds draft + snapshot as independent clones', () => {
    seed()
    const s = getConnectorDraftState()
    expect(s.connectorId).toBe('conn_1')
    expect(s.meta).toEqual(META)
    expect(selectIsDirty(s)).toBe(false)
    // Mutating the draft must not touch the snapshot (no aliasing).
    s.setName('Renamed')
    expect(getConnectorDraftState().snapshot?.name).toBe('Conn')
  })

  it('reset clears everything', () => {
    seed()
    getConnectorDraftState().reset()
    const s = getConnectorDraftState()
    expect(s.connectorId).toBeNull()
    expect(s.snapshot).toBeNull()
    expect(selectIsDirty(s)).toBe(false)
  })
})

describe('isDirty derivation', () => {
  it('is false right after seed and true after an edit', () => {
    seed()
    expect(selectIsDirty(getConnectorDraftState())).toBe(false)
    getConnectorDraftState().setSyncBehavior('scheduled')
    expect(selectIsDirty(getConnectorDraftState())).toBe(true)
  })

  it('clears when an edit is reverted to the server value', () => {
    seed()
    getConnectorDraftState().setName('X')
    expect(selectIsDirty(getConnectorDraftState())).toBe(true)
    getConnectorDraftState().setName('Conn')
    expect(selectIsDirty(getConnectorDraftState())).toBe(false)
  })

  it('is never dirty before a seed', () => {
    expect(selectIsDirty(getConnectorDraftState())).toBe(false)
  })
})

describe('connector-level setters', () => {
  it('setBackfillWindowSpan merges into config without dropping endpoint', () => {
    seed()
    getConnectorDraftState().setBackfillWindowSpan('last_90_days')
    const config = getConnectorDraftState().draft.config as {
      endpoint?: unknown
      backfillWindowSpan?: string
    }
    expect(config.backfillWindowSpan).toBe('last_90_days')
    expect(config.endpoint).toEqual({ baseUrl: 'https://api.test/v1' })
  })

  it('setScheduleConfig + setSyncBehavior dirty the draft', () => {
    seed()
    getConnectorDraftState().setSyncBehavior('scheduled')
    getConnectorDraftState().setScheduleConfig({ triggerInterval: 'hours' })
    expect(getConnectorDraftState().draft.syncBehavior).toBe('scheduled')
    expect(getConnectorDraftState().draft.scheduleConfig).toEqual({ triggerInterval: 'hours' })
  })
})

describe('stream setters', () => {
  it('renameStream / setSyncMode / setRequestConfig target the right stream', () => {
    seed()
    const st = getConnectorDraftState()
    st.renameStream('stream_1', 'invoices')
    st.setSyncMode('stream_1', 'incremental')
    st.setRequestConfig('stream_1', { path: '/invoices', method: 'GET' })
    const s = getConnectorDraftState().draft.streams[0]!
    expect(s.streamKey).toBe('invoices')
    expect(s.syncMode).toBe('incremental')
    expect(s.requestConfig).toEqual({ path: '/invoices', method: 'GET' })
  })

  it('setWebhookSteering writes requestConfig.webhookTrigger', () => {
    seed()
    getConnectorDraftState().setWebhookSteering('stream_1', { paths: ['resourceId'] })
    const rc = getConnectorDraftState().draft.streams[0]!.requestConfig as {
      path?: string
      webhookTrigger?: unknown
    }
    expect(rc.webhookTrigger).toEqual({ paths: ['resourceId'] })
    expect(rc.path).toBe('/orders')
  })

  it('setRecordFilter writes the filter and flips selectRecordFilterChanged', () => {
    seed()
    expect(selectRecordFilterChanged(getConnectorDraftState())).toBe(false)
    getConnectorDraftState().setRecordFilter('stream_1', [
      {
        id: 'g1',
        logicalOperator: 'AND',
        conditions: [{ id: 'c1', fieldId: 'orders_count', operator: 'greater than', value: 0 }],
      },
    ])
    const s = getConnectorDraftState().draft.streams[0]!
    expect(s.recordFilter?.[0]?.conditions).toHaveLength(1)
    expect(selectRecordFilterChanged(getConnectorDraftState())).toBe(true)
    // Back to the seeded value ⇒ the save bar's backfill warning goes away again.
    getConnectorDraftState().setRecordFilter('stream_1', null)
    expect(selectRecordFilterChanged(getConnectorDraftState())).toBe(false)
  })

  it('setStreamSchema sets schema + source', () => {
    seed()
    getConnectorDraftState().setStreamSchema('stream_1', { a: 1 }, 'manual')
    const s = getConnectorDraftState().draft.streams[0]!
    expect(s.sourceSchema).toEqual({ a: 1 })
    expect(s.schemaSource).toBe('manual')
  })
})

describe('mapping setters — temp id / tombstone', () => {
  it('addMapping mints a temp id and appends a draft row', () => {
    seed()
    const tempId = getConnectorDraftState().addMapping('stream_1', {
      parentMappingId: 'map_1',
      rootPath: 'customer',
      linkMode: 'reference',
      targetMode: 'contributing',
      entityDefinitionId: 'def_contact',
      relationshipFieldKey: 'customer',
    })
    expect(isTempId(tempId)).toBe(true)
    const mappings = getConnectorDraftState().draft.streams[0]!.mappings
    expect(mappings).toHaveLength(2)
    expect(mappings[1]!.id).toBe(tempId)
    expect(mappings[1]!.parentMappingId).toBe('map_1')
    expect(selectIsDirty(getConnectorDraftState())).toBe(true)
  })

  it('updateMapping patches only the named row', () => {
    seed()
    getConnectorDraftState().updateMapping('stream_1', 'map_1', { rootPath: 'data' })
    expect(getConnectorDraftState().draft.streams[0]!.mappings[0]!.rootPath).toBe('data')
  })

  it('removeMapping tombstones a real row (kept for the diff, hidden from render)', () => {
    seed()
    getConnectorDraftState().removeMapping('stream_1', 'map_1')
    const s = getConnectorDraftState().draft.streams[0]!
    expect(s.mappings).toHaveLength(1)
    expect(s.mappings[0]!._deleted).toBe(true)
    expect(visibleMappings(s)).toHaveLength(0)
    expect(selectIsDirty(getConnectorDraftState())).toBe(true)
  })

  it('removeMapping drops a temp row outright (no tombstone)', () => {
    seed()
    const tempId = getConnectorDraftState().addMapping('stream_1', {
      parentMappingId: 'map_1',
      rootPath: 'customer',
      linkMode: 'reference',
      targetMode: 'contributing',
      entityDefinitionId: 'def_contact',
    })
    getConnectorDraftState().removeMapping('stream_1', tempId)
    const mappings = getConnectorDraftState().draft.streams[0]!.mappings
    expect(mappings.find((m) => m.id === tempId)).toBeUndefined()
    expect(mappings).toHaveLength(1)
  })

  it('add-then-remove a temp row is a no-op (draft clean again)', () => {
    seed()
    const tempId = getConnectorDraftState().addMapping('stream_1', {
      parentMappingId: null,
      rootPath: 'x',
      linkMode: 'upsert',
      targetMode: 'owned',
      entityDefinitionId: 'def_x',
    })
    getConnectorDraftState().removeMapping('stream_1', tempId)
    expect(selectIsDirty(getConnectorDraftState())).toBe(false)
  })

  it('removeMapping cascades to descendants (tombstone subtree)', () => {
    const draft = makeDraft()
    draft.streams[0]!.mappings.push(
      {
        id: 'map_2',
        parentMappingId: 'map_1',
        rootPath: 'customer',
        relationshipFieldKey: 'customer',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_contact',
        orphanBehavior: 'ignore',
        fieldMappings: [],
      },
      {
        id: 'map_3',
        parentMappingId: 'map_2',
        rootPath: 'address',
        relationshipFieldKey: 'address',
        linkMode: 'reference',
        targetMode: 'contributing',
        entityDefinitionId: 'def_address',
        orphanBehavior: 'ignore',
        fieldMappings: [],
      }
    )
    seed(draft)
    getConnectorDraftState().removeMapping('stream_1', 'map_1')
    const s = getConnectorDraftState().draft.streams[0]!
    expect(s.mappings.every((m) => m._deleted)).toBe(true)
    expect(visibleMappings(s)).toHaveLength(0)
  })
})

describe('descendantIds', () => {
  it('collects the full parent chain', () => {
    const rows = [
      { id: 'a', parentMappingId: null },
      { id: 'b', parentMappingId: 'a' },
      { id: 'c', parentMappingId: 'b' },
      { id: 'd', parentMappingId: null },
    ] as Parameters<typeof descendantIds>[0]
    expect([...descendantIds(rows, 'a')].sort()).toEqual(['a', 'b', 'c'])
    expect([...descendantIds(rows, 'd')]).toEqual(['d'])
  })
})

describe('selectCanCommit', () => {
  it('blocks commit while a stream is flagged invalid, even when dirty', () => {
    seed()
    getConnectorDraftState().setName('X')
    expect(selectCanCommit(getConnectorDraftState())).toBe(true)
    getConnectorDraftState().setStreamValidity('stream_1', false)
    expect(selectCanCommit(getConnectorDraftState())).toBe(false)
    getConnectorDraftState().setStreamValidity('stream_1', true)
    expect(selectCanCommit(getConnectorDraftState())).toBe(true)
  })

  it('is false when not dirty regardless of validity', () => {
    seed()
    expect(selectCanCommit(getConnectorDraftState())).toBe(false)
  })
})

describe('subscribeWithSelector', () => {
  it('exposes a selector subscription that fires on the watched slice', () => {
    seed()
    let fires = 0
    const unsub = useConnectorDraftStore.subscribe(selectIsDirty, () => {
      fires++
    })
    getConnectorDraftState().setName('Y')
    expect(fires).toBe(1)
    unsub()
  })
})
