// packages/lib/src/data-connectors/sinks/entity-sink-identity.test.ts
// Write-ownership rule for identity-flagged fields (identityRole.kind === 'externalId'):
// fill-blank (never overwrite a chat-verified value), drift-exempt (never re-clobber),
// no provenance stamp — plus the RecordIdentity mirror write.
// plans/data-connectors/v7/option-3-multi-source-identity-store-plan.md Phase 2/3.

import { toResourceFieldId } from '@auxx/types/field'
import { stableHash } from '@auxx/utils/hash'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecodedMapping } from '../service'
import type { ProjectedRecord, SyncCtx } from './types'

const findItem = vi.fn()
const findItemByDef = vi.fn()
const touchItem = vi.fn()
const upsertItem = vi.fn()
vi.mock('../service', () => ({
  findItem: (...a: unknown[]) => findItem(...a),
  findItemByDef: (...a: unknown[]) => findItemByDef(...a),
  touchItem: (...a: unknown[]) => touchItem(...a),
  upsertItem: (...a: unknown[]) => upsertItem(...a),
  listItemsForMapping: vi.fn(),
  markItemArchived: vi.fn(),
  setItemPendingRelations: vi.fn(),
}))

const resolveConnectorFieldRef = vi.fn()
vi.mock('../../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: (...a: unknown[]) => resolveConnectorFieldRef(...a),
}))
const buildWriteKeyToFieldId = vi.fn()
vi.mock('../field-id-resolver', () => ({
  buildWriteKeyToFieldId: (...a: unknown[]) => buildWriteKeyToFieldId(...a),
}))

const getCachedFieldMap = vi.fn()
vi.mock('../../cache', () => ({ getCachedFieldMap: (...a: unknown[]) => getCachedFieldMap(...a) }))

const upsertRecordIdentity = vi.fn()
vi.mock('../../identity', () => ({
  upsertRecordIdentity: (...a: unknown[]) => upsertRecordIdentity(...a),
}))

import { entitySink } from './entity-sink'

const FIELD_ID = 'field_customerId'
const RAW_REF = 'contact:@app:shopify:customerId'
const DEF_ID = 'def_contact'

function mapping(over: Partial<DecodedMapping> = {}): DecodedMapping {
  return {
    row: { id: 'm1' },
    rootPath: '',
    linkMode: 'upsert',
    targetMode: 'contributing',
    entityDefinitionId: DEF_ID,
    parentMappingId: null,
    relationshipFieldKey: null,
    orphanBehavior: 'ignore',
    fieldMappings: [
      {
        id: 'fm1',
        targetFieldRef: RAW_REF,
        expression: '{shopify_id}',
        sourceFields: { shopify_id: 'shopify_id' },
        identityRole: { kind: 'externalId' },
      },
    ],
    ...over,
  } as unknown as DecodedMapping
}

function record(over: Partial<ProjectedRecord> = {}): ProjectedRecord {
  return {
    externalId: '207119551',
    displayName: 'Jane',
    fields: { [RAW_REF]: '207119551' },
    identityCandidates: [],
    pendingRelations: [],
    ...over,
  }
}

const create = vi.fn()
const update = vi.fn().mockResolvedValue(undefined)
const getFieldValues = vi.fn()

function makeCtx(): SyncCtx {
  return {
    db: {} as never,
    orgId: 'org1',
    connector: { id: 'dc1', credentialId: 'cred1' } as SyncCtx['connector'],
    runId: 'run1',
    crud: { update, create, getFieldValues } as never,
    ownedCrud: { update, create, getFieldValues } as never,
    counters: {
      fetched: 0,
      created: 0,
      updated: 0,
      skipped: 0,
      archived: 0,
      deleted: 0,
      failed: 0,
      relationshipWarnings: 0,
      errorSample: [],
    } as SyncCtx['counters'],
    touchedDefs: new Set<string>(),
  }
}

beforeEach(() => {
  findItem.mockReset()
  findItemByDef.mockReset()
  findItemByDef.mockResolvedValue(null)
  touchItem.mockReset()
  upsertItem.mockReset()
  update.mockClear()
  create.mockReset()
  getFieldValues.mockReset()
  resolveConnectorFieldRef.mockReset()
  resolveConnectorFieldRef.mockImplementation(async (ref: string) =>
    ref === RAW_REF ? toResourceFieldId(DEF_ID, FIELD_ID) : null
  )
  buildWriteKeyToFieldId.mockReset()
  buildWriteKeyToFieldId.mockResolvedValue(new Map([[FIELD_ID, FIELD_ID]]))
  getCachedFieldMap.mockReset()
  getCachedFieldMap.mockResolvedValue(
    new Map([
      [
        FIELD_ID,
        {
          id: FIELD_ID,
          appSlug: 'shopify',
          appInstallationId: 'install1',
          connectionId: 'conn1',
          appFieldKey: 'customerId',
        },
      ],
    ])
  )
  upsertRecordIdentity.mockReset()
  upsertRecordIdentity.mockResolvedValue({ ok: true, value: { id: 'ri1' } })
})

describe('entitySink identity write-ownership rule', () => {
  it('writes the identity field on create (cell is new)', async () => {
    findItem.mockResolvedValue(null)
    create.mockResolvedValue({ instance: { id: 'inst1' } })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[1]).toMatchObject({ [FIELD_ID]: '207119551' })
  })

  it('fill-blank: does NOT overwrite an existing (chat-verified) identity value on update', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      contentHash: 'stale',
      pendingRelations: [],
    })
    getFieldValues.mockResolvedValue(
      new Map([[FIELD_ID, { value: 'already-verified-id' } as never]])
    )
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(update).toHaveBeenCalledTimes(1)
    // The identity field is absent from the write set — fill-blank skipped it.
    expect(update.mock.calls[0]?.[1]).not.toHaveProperty(FIELD_ID)
  })

  it('fill-blank: writes when the existing cell is blank', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      contentHash: 'stale',
      pendingRelations: [],
    })
    getFieldValues.mockResolvedValue(new Map())
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(update).toHaveBeenCalledTimes(1)
    expect(update.mock.calls[0]?.[1]).toMatchObject({ [FIELD_ID]: '207119551' })
  })

  it('mirrors the identity write into RecordIdentity on create', async () => {
    findItem.mockResolvedValue(null)
    create.mockResolvedValue({ instance: { id: 'inst1' } })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(upsertRecordIdentity).toHaveBeenCalledTimes(1)
    expect(upsertRecordIdentity.mock.calls[0]?.[0]).toMatchObject({
      organizationId: 'org1',
      entityInstanceId: 'inst1',
      entityDefinitionId: DEF_ID,
      source: 'shopify',
      appInstallationId: 'install1',
      connectionId: 'conn1',
      appFieldKey: 'customerId',
      fieldId: FIELD_ID,
      externalId: '207119551',
    })
  })

  it('mirrors even when fill-blank skipped the write (mirror stays in sync with the established value)', async () => {
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      contentHash: 'stale',
      pendingRelations: [],
    })
    getFieldValues.mockResolvedValue(
      new Map([[FIELD_ID, { value: 'already-verified-id' } as never]])
    )
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    expect(upsertRecordIdentity).toHaveBeenCalledTimes(1)
  })

  it('does not stamp contributing provenance on the identity field', async () => {
    // A mapping whose only written field is identity-flagged means
    // stampContributingProvenance's stampable-key list is empty — it returns
    // before ever calling buildWriteKeyToFieldId (no false "synced by
    // connector" badge over a value that may be chat-verified).
    findItem.mockResolvedValue(null)
    create.mockResolvedValue({ instance: { id: 'inst1' } })
    const ctx = makeCtx()

    await entitySink.upsertRecord(ctx, mapping(), record())

    // buildWriteKeyToFieldId is called once by mirrorIdentityWrites's sibling
    // resolution path is getCachedFieldMap, not this — so any call here would
    // only come from stampContributingProvenance, which must not fire.
    expect(buildWriteKeyToFieldId).not.toHaveBeenCalled()
  })

  it('excludes the identity ref from drift detection (drift-exempt)', async () => {
    // A mapping with ONLY an identity-flagged overwrite-default field should
    // short-circuit computeDriftedInstances before any query runs.
    findItem.mockResolvedValue({
      id: 'item1',
      entityInstanceId: 'inst1',
      contentHash: stableHash({ fields: record().fields, displayName: record().displayName }),
      pendingRelations: [],
    })
    const ctx = makeCtx()
    const selectDistinct = vi.fn()
    ctx.db = { selectDistinct } as never

    await entitySink.upsertRecord(ctx, mapping(), record())

    // Content-hash matched ⇒ would normally check drift; drift-exempt means the
    // identity-only mapping has zero overwrite refs, so no drift query ever runs.
    expect(selectDistinct).not.toHaveBeenCalled()
    expect(buildWriteKeyToFieldId).not.toHaveBeenCalled()
    expect(ctx.counters.skipped).toBe(1)
  })
})
