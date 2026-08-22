// packages/lib/src/field-values/__tests__/sync-capture.test.ts
//
// Tier-1 sync capture at the field-value seams (plan 07 §4, PR 1): a write
// under a sync-session origin records touched membership on the session's
// manifest collector — but ONLY when the write actually changed something.
// Guard short-circuits (D-6), delete-of-absent (B-14), and fully-deduped adds
// record NOTHING (membership honesty, §4 property 1). Interactive, automation
// and seed sessions never capture, and the inline lane's own doors are
// untouched by capture.

import { toRecordId } from '@auxx/types/resource'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ⚠️ Mock '../../realtime/publish-helpers' directly — NOT the '../../realtime'
// barrel (see batched-realtime-publish.test.ts for the import-cycle rationale).
vi.mock('../../realtime/publish-helpers', () => ({
  publishFieldValueUpdates: vi.fn(),
}))

// '../../cache' is a large barrel with real DB/Redis-backed providers — mock it
// wholesale, same entry points as the sibling set-idempotency suite.
vi.mock('../../cache', () => ({
  getCachedFieldMap: vi.fn(),
  getCachedResource: vi.fn(),
  getOrgCache: vi.fn(),
  getAllCachedCustomFields: vi.fn(async () => []),
  getCachedRecordRules: vi.fn(async () => []),
}))

// The field-hooks registry is imported (in the loaded graph) only by
// field-value-mutations.ts — full replacement is safe here. Entity hooks are
// "registered" so the inline lane's post-hook door is observable.
vi.mock('../../field-hooks/registry', () => ({
  hasEntityFieldChangeHooks: vi.fn(() => true),
  hasFieldTypeChangeHooks: vi.fn(() => false),
  hasFieldPreHooks: vi.fn(() => false),
  getEntityFieldChangeHooks: vi.fn(() => []),
  getFieldTypeChangeHooks: vi.fn(() => []),
  getFieldPreHooks: vi.fn(() => []),
}))

vi.mock('../../field-hooks/collect-triggers', () => ({
  collectTriggeredFields: vi.fn(async () => []),
  deduplicateBySystemAttribute: vi.fn((fields: unknown[]) => fields),
}))
vi.mock('../../field-hooks/publish', () => ({
  publishFieldTriggerEvents: vi.fn(async () => {}),
  publishBatchFieldTriggerEvents: vi.fn(async () => {}),
}))

vi.mock('../timeline-snapshot', () => ({
  preloadSnapshotCache: vi.fn(),
  resolveFieldChangeSnapshotPair: vi.fn(async () => ({ oldDisplay: null, newDisplay: null })),
  resolveFieldChangeSnapshotsBulk: vi.fn(async () => new Map()),
}))

// The production registry is empty (all models are EntityInstance-backed), so
// the built-in branch is only reachable with a mocked registry.
vi.mock('../../custom-fields/built-in-fields', () => ({
  isBuiltInField: vi.fn(() => false),
  getBuiltInFieldHandler: vi.fn(() => null),
  getBuiltInFieldType: vi.fn(() => null),
}))

import { getCachedResource, getOrgCache } from '../../cache'
import { getBuiltInFieldHandler, isBuiltInField } from '../../custom-fields/built-in-fields'
import { getEntityFieldChangeHooks } from '../../field-hooks/registry'
import { publishFieldValueUpdates } from '../../realtime/publish-helpers'
import {
  createManifestCollector,
  type ManifestCollector,
} from '../../record-rules/sync-manifest-collector'
import {
  interactiveSession,
  seedSession,
  type WriteSession,
} from '../../resources/crud/write-origin'
import { runWithWriteSession } from '../../resources/crud/write-session-als'
import { createFieldValueContext, type FieldValueContext } from '../field-value-helpers'
import { addValues, removeValues, setValueWithBuiltIn } from '../field-value-mutations'

const mockedGetCachedResource = getCachedResource as unknown as ReturnType<typeof vi.fn>
const mockedGetOrgCache = getOrgCache as unknown as ReturnType<typeof vi.fn>
const mockedGetEntityHooks = getEntityFieldChangeHooks as unknown as ReturnType<typeof vi.fn>
const mockedIsBuiltIn = vi.mocked(isBuiltInField)
const mockedGetBuiltInHandler = vi.mocked(getBuiltInFieldHandler)
const mockedPublish = vi.mocked(publishFieldValueUpdates)

// =============================================================================
// Fixtures
// =============================================================================

const recordId = toRecordId('widget', 'inst-1')

function syncSession(collector: ManifestCollector): WriteSession {
  return { origin: { kind: 'sync', source: 'connector', ref: 'run_1', collector }, depth: 0 }
}

/** Minimal CustomField-shaped fixture (same shape as the sibling suites). */
function fieldFixture(id: string, type: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    type,
    options: {},
    entityDefinitionId: null,
    entityDefinition: null,
    entityType: null,
    isUnique: false,
    systemAttribute: null,
    ...overrides,
  }
}

const FIELD_TEXT = fieldFixture('field-text', 'TEXT')
const FIELD_EMAIL = fieldFixture('field-email', 'EMAIL', { systemAttribute: 'primary_email' })
const FIELD_TAGS = fieldFixture('field-tags', 'TAGS', { options: [] })

/** A stored FieldValue row for (inst-1, fieldId) with payload overrides. */
function existingRow(
  id: string,
  fieldId: string,
  sortKey: string,
  payload: Record<string, unknown>
) {
  return {
    id,
    entityId: 'inst-1',
    entityDefinitionId: 'widget',
    fieldId,
    organizationId: 'org-1',
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    optionId: null,
    relatedEntityId: null,
    relatedEntityDefinitionId: null,
    actorId: null,
    aiStatus: null,
    sortKey,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...payload,
  }
}

/**
 * Chainable `ctx.db` fake (see the sibling set-idempotency suite): reads
 * resolve to `existingRows`; inserts echo their rows; a DELETE chain's
 * `.returning()` resolves the seeded `deleteReturning` rows so removeValues'
 * "did anything actually go" check is drivable per test.
 */
function makeFakeDb(existingRows: any[] = [], deleteReturning: any[] = []) {
  let idSeq = 0
  let pendingValues: any[] = []
  let lastOp: 'insert' | 'delete' | null = null
  const chain: any = {}
  Object.assign(chain, {
    transaction: async (fn: (tx: any) => Promise<any>) => fn(chain),
    execute: async () => undefined, // pg_advisory_xact_lock
    delete: () => {
      lastOp = 'delete'
      return chain
    },
    where: () => chain,
    insert: () => {
      lastOp = 'insert'
      return chain
    },
    values: (rows: any) => {
      pendingValues = Array.isArray(rows) ? rows : [rows]
      return chain
    },
    onConflictDoUpdate: () => chain,
    returning: () =>
      Promise.resolve(
        lastOp === 'delete'
          ? deleteReturning
          : pendingValues.map((row) => ({
              id: `fv-new-${idSeq++}`,
              createdAt: '2026-02-01T00:00:00.000Z',
              updatedAt: '2026-02-01T00:00:00.000Z',
              ...row,
            }))
      ),
    select: () => chain,
    from: () => chain,
    orderBy: () => Promise.resolve(existingRows),
    update: () => chain,
    set: () => chain,
  })
  return chain
}

function makeCtx(
  db: any,
  fields: ReturnType<typeof fieldFixture>[],
  session?: WriteSession
): FieldValueContext {
  const ctx = createFieldValueContext('org-1', 'user-1', db, 'socket-abc', { session })
  for (const f of fields) ctx.fieldCache.set(f.id, f as any)
  return ctx
}

const hookSpy = vi.fn(async (_event: unknown) => {})

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetCachedResource.mockResolvedValue(undefined)
  mockedPublish.mockResolvedValue(undefined)
  mockedGetEntityHooks.mockReturnValue([hookSpy])
  mockedIsBuiltIn.mockReturnValue(false)
  mockedGetBuiltInHandler.mockReturnValue(null)
  mockedGetOrgCache.mockReturnValue({
    from: () => ({ all: async () => ({}), byId: async () => undefined }),
  })
})

// =============================================================================
// Forward `set` — post-guard capture
// =============================================================================

describe('tier-1 capture — forward set', () => {
  it('a real set on the silent lane captures the field output key and stays silent', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false, // the handler-derived silent lane for sync sessions
    })

    const manifest = collector.toJson()
    expect(manifest?.touched).toEqual({ [recordId]: ['field-text'] })
    expect(manifest?.createdRecordIds).toEqual([])
    // Capture is orthogonal to the fan-out — the silent lane stays silent.
    expect(mockedPublish).not.toHaveBeenCalled()
    expect(hookSpy).not.toHaveBeenCalled()
  })

  it('the output key is systemAttribute when the field carries one', async () => {
    const collector = createManifestCollector({})
    const ctx = makeCtx(makeFakeDb([]), [FIELD_EMAIL], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-email',
      value: 'a@b.co',
      publishEvents: false,
    })

    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['primary_email'] })
  })

  it('a guard-short-circuited identical set records NOTHING', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'hello',
      publishEvents: false,
    })

    expect(result.changed).toBe(false)
    expect(collector.toJson()).toBeNull()
  })

  it('a delete-of-absent clear records NOTHING', async () => {
    const collector = createManifestCollector({})
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], syncSession(collector))

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: null,
      publishEvents: false,
    })

    expect(result.changed).toBe(false)
    expect(collector.toJson()).toBeNull()
  })

  it('a REAL clear captures', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: null,
      publishEvents: false,
    })

    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['field-text'] })
  })
})

// =============================================================================
// Session narrowing — only the sync origin captures
// =============================================================================

describe('tier-1 capture — session narrowing', () => {
  it('falls back to the ambient ALS session when the ctx carries none', async () => {
    const collector = createManifestCollector({})
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT]) // no ctx.session

    await runWithWriteSession(syncSession(collector), () =>
      setValueWithBuiltIn(ctx, {
        recordId,
        fieldId: 'field-text',
        value: 'world',
        publishEvents: false,
      })
    )

    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['field-text'] })
  })

  it('the ctx-carried session WINS over an ambient sync session (S1 order)', async () => {
    const collector = createManifestCollector({})
    for (const session of [interactiveSession('user-1'), seedSession('reshape')]) {
      const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], session)
      await runWithWriteSession(syncSession(collector), () =>
        setValueWithBuiltIn(ctx, {
          recordId,
          fieldId: 'field-text',
          value: 'world',
          publishEvents: false,
        })
      )
    }
    expect(collector.toJson()).toBeNull()
  })

  it('the inline lane is untouched: an interactive real change still fires its doors', async () => {
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], interactiveSession('user-1'))

    const result = await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
    })

    expect(result.changed).toBe(true)
    expect(hookSpy).toHaveBeenCalledTimes(1)
    expect(mockedPublish).toHaveBeenCalledTimes(1)
  })
})

// =============================================================================
// Built-in branch — no guard, capture on every sync write
// =============================================================================

describe('tier-1 capture — built-in fields', () => {
  it('captures the built-in key on a sync-session write (no no-op detection)', async () => {
    const collector = createManifestCollector({})
    const handler = vi.fn(async () => {})
    mockedIsBuiltIn.mockImplementation((fieldId: string) => fieldId === 'builtin-status')
    mockedGetBuiltInHandler.mockReturnValue(handler)
    const ctx = makeCtx(makeFakeDb([]), [], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'builtin-status',
      value: 'open',
      publishEvents: false,
    })

    expect(handler).toHaveBeenCalledTimes(1)
    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['builtin-status'] })
  })
})

// =============================================================================
// add / remove — capture only on actual change
// =============================================================================

describe('tier-1 capture — addValues / removeValues', () => {
  it('addValues that actually inserts captures once', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TAGS], syncSession(collector))

    await addValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-b'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['field-tags'] })
  })

  it('addValues fully deduped against existing rows records NOTHING', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TAGS], syncSession(collector))

    await addValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-a'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()).toBeNull()
  })

  it('removeValues that actually deletes captures once', async () => {
    const collector = createManifestCollector({})
    const rows = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const ctx = makeCtx(makeFakeDb(rows, [{ id: 'fv-a' }]), [FIELD_TAGS], syncSession(collector))

    await removeValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-a'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()?.touched).toEqual({ [recordId]: ['field-tags'] })
  })

  it('removeValues that matches no row records NOTHING', async () => {
    const collector = createManifestCollector({})
    const ctx = makeCtx(makeFakeDb([], []), [FIELD_TAGS], syncSession(collector))

    await removeValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-x'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()).toBeNull()
  })
})
