// packages/lib/src/resources/crud/__tests__/field-write-guard.test.ts
//
// Phase 3 of plans/apps/app-fields-and-entities-plan.md §5: the server-side
// read-only guard, wired into createEntity/updateEntity right after the
// entity's resolved fields are known. An `interactive` write to a
// connector-owned column with `updatable: false` (or `creatable: false` on a
// create) is refused; the identical `sync`-origin write succeeds, because the
// guard only ever looks at `WriteOrigin.kind`.
//
// @auxx/database is globally mocked in src/test/setup.ts; the mutation-seam
// mocks mirror create-required-field-failure.test.ts / sync-lifecycle-capture.test.ts.

import { ok } from 'neverthrow'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  createEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  publish: vi.fn(async () => {}),
  publishLater: vi.fn(() => {}),
  findCachedResource: vi.fn(),
}))

vi.mock('../../../dedup/pairs', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deleteOpenPairsForRecord: vi.fn(async () => ok(0)),
}))
vi.mock('../../../dedup/enqueue-scan', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  enqueueDuplicateScan: vi.fn(async () => 'job_1'),
}))
vi.mock('../../../entity-instances', () => ({
  getEntityInstance: vi.fn(async () => ok({ id: 'inst_1', archivedAt: null })),
  getEntityInstanceRow: vi.fn(async () => ({ id: 'inst_1', archivedAt: null })),
  updateEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
  createEntityInstance: h.createEntityInstance,
  deleteEntityInstance: vi.fn(async () => ok({ id: 'inst_1' })),
}))
vi.mock('../../../realtime', () => ({
  getRealtimeService: () => ({ publish: h.publish }),
  publishRecordsChanged: vi.fn(async () => {}),
  rooms: { orgRecords: () => 'room' },
}))
vi.mock('../../../events/publisher', () => ({
  publisher: { publishLater: h.publishLater, publish: h.publishLater },
}))
vi.mock('../../../cache', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  findCachedResource: h.findCachedResource,
}))
vi.mock('../../../comments', () => ({
  CommentService: class {
    deleteCommentsByRecordId = vi.fn(async () => {})
  },
}))

import { ForbiddenError } from '../../../errors'
import { createManifestCollector } from '../../../record-rules/sync-manifest-collector'
import type { ResourceField } from '../../registry/field-types'
import { createEntity, type MutationContext, updateEntity } from '../unified-handler-mutations'
import { interactiveSession, seedSession, type WriteSession } from '../write-origin'

function syncSession(): WriteSession {
  return {
    origin: {
      kind: 'sync',
      source: 'connector',
      ref: 'run_1',
      collector: createManifestCollector({}),
    },
    depth: 0,
  }
}

/** A connector-owned column: not creatable, not updatable — the case the flag exists for. */
function connectorOwnedField(): ResourceField {
  return {
    id: 'f_connector',
    label: 'External Id',
    key: 'external_ref',
    type: 'string',
    dataConnectorId: 'dc_1',
    capabilities: {
      filterable: true,
      sortable: true,
      creatable: false,
      updatable: false,
      configurable: false,
    },
  } as ResourceField
}

function ctx(session: WriteSession): MutationContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    userId: 'user_1',
    session,
    fieldValueService: {} as never,
    resolveEntityDefinition: async () => ({
      id: 'def_1',
      entityType: 'contact',
      apiSlug: 'contacts',
    }),
    getFields: async () => [],
    runPreHooks: async (_o, _d, values) => values,
    validateUniqueFields: async () => {},
    setFieldValues: async () => ({ failures: [], changed: true, changes: [], instance: null }),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.findCachedResource.mockResolvedValue({ fields: [connectorOwnedField()] })
})

describe('assertOriginMayWriteFields wired into createEntity/updateEntity', () => {
  it('refuses an interactive create that sets a connector-owned non-creatable column', async () => {
    await expect(
      createEntity(ctx(interactiveSession('user_1')), 'def_1', { f_connector: 'ext_1' })
    ).rejects.toThrow(ForbiddenError)

    expect(h.createEntityInstance).not.toHaveBeenCalled()
  })

  it('refuses an interactive update of the same connector-owned column', async () => {
    await expect(
      updateEntity(ctx(interactiveSession('user_1')), 'def_1:inst_1' as never, {
        f_connector: 'ext_2',
      })
    ).rejects.toThrow(ForbiddenError)
  })

  it('allows a sync create of the same connector-owned column', async () => {
    const result = await createEntity(ctx(syncSession()), 'def_1', { f_connector: 'ext_1' })
    expect(result.instance.id).toBe('inst_1')
    expect(h.createEntityInstance).toHaveBeenCalledTimes(1)
  })

  it('allows a sync update of the same connector-owned column', async () => {
    const result = await updateEntity(ctx(syncSession()), 'def_1:inst_1' as never, {
      f_connector: 'ext_2',
    })
    expect(result.id).toBe('inst_1')
  })

  it('allows a seed write of the same connector-owned column', async () => {
    await expect(
      createEntity(ctx(seedSession('reshape')), 'def_1', { f_connector: 'ext_1' })
    ).resolves.toBeDefined()
  })

  it('never guards a plain user field on an interactive write', async () => {
    h.findCachedResource.mockResolvedValue({
      fields: [
        {
          id: 'f_plain',
          label: 'Notes',
          key: 'notes',
          type: 'string',
          capabilities: {
            filterable: true,
            sortable: true,
            creatable: true,
            updatable: true,
            configurable: true,
          },
        } as ResourceField,
      ],
    })

    const result = await createEntity(ctx(interactiveSession('user_1')), 'def_1', {
      f_plain: 'hello',
    })
    expect(result.instance.id).toBe('inst_1')
  })
})
