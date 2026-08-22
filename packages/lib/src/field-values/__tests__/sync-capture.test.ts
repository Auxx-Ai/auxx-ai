// packages/lib/src/field-values/__tests__/sync-capture.test.ts
//
// Tier-1 + tier-2 sync capture at the field-value seams (plan 07 §4, PR 1+2):
// a write under a sync-session origin records touched membership on the
// session's manifest collector — but ONLY when the write actually changed
// something. Guard short-circuits (D-6), delete-of-absent (B-14), and
// fully-deduped adds record NOTHING (membership honesty, §4 property 1).
// Interactive, automation and seed sessions never capture, and the inline
// lane's own doors are untouched by capture.
//
// Tier-2 (PR 2): rule-subscribed fields additionally capture `{o, n}` deltas
// at the same seams — `o` from the step-3.55 guard rows (or the targeted AI
// read / the add-dedupe rows / the widened remove RETURNING), `n` from the
// values actually stored. Created-this-run records emit `{n}` with NO `o`
// (the F6 o-absence contract), unsubscribed fields stay membership-only, and
// the double-capture window with the producer helpers folds to one entry.

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
    // SELECT statements issued, observable per test — the "no extra read when
    // nothing is subscribed" invariants compare counts across runs.
    __selectCount: 0,
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
    select: () => {
      chain.__selectCount += 1
      return chain
    },
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

// =============================================================================
// Tier-2 delta capture (PR 2) — subscribed fields get {o, n}, others stay tier-1
// =============================================================================

/** Collector whose rules subscribe to `fieldIds` on the `widget` def. */
function subscribedCollector(fieldIds: string[], defId = 'widget'): ManifestCollector {
  return createManifestCollector({
    [defId]: { fieldIds: new Set(fieldIds), lifecycle: { created: false, deleted: false } },
  })
}

describe('tier-2 delta capture — forward set', () => {
  it('a subscribed set captures {o, n} in the flattened stored value space', async () => {
    const collector = subscribedCollector(['field-text'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    const manifest = collector.toJson()
    expect(manifest?.deltas).toEqual({
      [recordId]: { 'field-text': { o: 'hello', n: 'world' } },
    })
    // A delta implies touched — membership carries the same output key.
    expect(manifest?.touched).toEqual({ [recordId]: ['field-text'] })
  })

  it('o is null (present, honest) when the field was empty pre-write', async () => {
    const collector = subscribedCollector(['field-text'])
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    const entry = collector.toJson()?.deltas[recordId]?.['field-text']
    expect(entry).toEqual({ o: null, n: 'world' })
    expect(entry && 'o' in entry).toBe(true)
  })

  it('an UNSUBSCRIBED field gets touched membership but NO delta', async () => {
    const collector = subscribedCollector(['some-other-field'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    const manifest = collector.toJson()
    expect(manifest?.touched).toEqual({ [recordId]: ['field-text'] })
    expect(manifest?.deltas).toEqual({})
  })

  it('the delta key is systemAttribute when the field carries one (subscription stays by row id)', async () => {
    const collector = subscribedCollector(['field-email'])
    const ctx = makeCtx(makeFakeDb([]), [FIELD_EMAIL], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-email',
      value: 'a@b.co',
      publishEvents: false,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { primary_email: { o: null, n: 'a@b.co' } },
    })
  })

  it('a subscribed REAL clear captures {o, n: null}', async () => {
    const collector = subscribedCollector(['field-text'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: null,
      publishEvents: false,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { 'field-text': { o: 'hello', n: null } },
    })
  })

  it('a subscribed set costs NO extra query — o rides the step-3.55 guard rows', async () => {
    const rows = () => [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const subDb = makeFakeDb(rows())
    const unsubDb = makeFakeDb(rows())

    await setValueWithBuiltIn(
      makeCtx(subDb, [FIELD_TEXT], syncSession(subscribedCollector(['field-text']))),
      { recordId, fieldId: 'field-text', value: 'world', publishEvents: false }
    )
    await setValueWithBuiltIn(
      makeCtx(unsubDb, [FIELD_TEXT], syncSession(subscribedCollector(['other']))),
      { recordId, fieldId: 'field-text', value: 'world', publishEvents: false }
    )

    expect(subDb.__selectCount).toBe(unsubDb.__selectCount)
  })
})

// =============================================================================
// Tier-2 — o-absence for created-this-run records (the F6 contract)
// =============================================================================

describe('tier-2 delta capture — created-this-run o-absence', () => {
  it('a field write on a record created this run emits {n} with NO o', async () => {
    const collector = subscribedCollector(['field-text'])
    // The lifecycle seam (createEntity) registers the create BEFORE field writes.
    collector.recordCreated(recordId)
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    const entry = collector.toJson()?.deltas[recordId]?.['field-text']
    expect(entry).toEqual({ n: 'world' })
    expect(entry && 'o' in entry).toBe(false)
  })

  it('create-then-update within one run folds to {n: latest} with NO o', async () => {
    const collector = subscribedCollector(['field-text'])
    collector.recordCreated(recordId)
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'first',
      publishEvents: false,
    })
    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'latest',
      publishEvents: false,
    })

    const entry = collector.toJson()?.deltas[recordId]?.['field-text']
    expect(entry).toEqual({ n: 'latest' })
    expect(entry && 'o' in entry).toBe(false)
  })

  it('the created probe dedupes on the instance id across RecordId forms', async () => {
    const collector = subscribedCollector(['field-text'])
    // Created under an alias-form RecordId; the field write uses the def form.
    collector.recordCreated(toRecordId('contact', 'inst-1'))
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    const entry = collector.toJson()?.deltas[recordId]?.['field-text']
    expect(entry).toEqual({ n: 'world' })
  })
})

// =============================================================================
// Tier-2 — the both-capturing window (engine + producer, PR-1→PR-2)
// =============================================================================

describe('tier-2 delta capture — double-capture window', () => {
  // What the retired producer capture (capture-field-changes.ts, deleted in plan 07
  // PR 2) recorded for the same write: pre-read `o` + input `n` normalized into the
  // same flattened stored space. Kept as a fold-contract fixture.
  const producerEntry = { 'field-text': { o: 'hello', n: 'world' } }

  it('engine capture + producer capture fold to ONE entry equal to either alone', async () => {
    const collector = subscribedCollector(['field-text'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    // Engine seam fires inside the write; the producer's recordChange lands after
    // (entity-sink/import ordering: capture-read → write → recordChange).
    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })
    const engineOnly = collector.toJson()
    collector.recordChange(recordId, producerEntry)
    const both = collector.toJson()

    expect(both?.deltas).toEqual({ [recordId]: producerEntry })
    expect(both).toEqual(engineOnly)
    expect(both?.touched).toEqual({ [recordId]: ['field-text'] })
  })

  it('producer-first ordering yields the same fold (first-o-wins is stable when o agrees)', async () => {
    const collector = subscribedCollector(['field-text'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    collector.recordChange(recordId, producerEntry)
    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
    })

    expect(collector.toJson()?.deltas).toEqual({ [recordId]: producerEntry })
  })
})

// =============================================================================
// Tier-2 — aiGeneration (guard bypassed): targeted read for an honest o
// =============================================================================

describe('tier-2 delta capture — aiGeneration writes', () => {
  const aiMeta = { model: 'test-model' } as never

  it('a subscribed AI commit captures a REAL o via the targeted read', async () => {
    const collector = subscribedCollector(['field-text'])
    const rows = [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TEXT], syncSession(collector))

    await setValueWithBuiltIn(ctx, {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
      aiGeneration: aiMeta,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { 'field-text': { o: 'hello', n: 'world' } },
    })
  })

  it('an unsubscribed AI commit does NOT pay the targeted read (touched only)', async () => {
    const rows = () => [existingRow('fv-1', 'field-text', 'a0', { valueText: 'hello' })]
    const subDb = makeFakeDb(rows())
    const unsubDb = makeFakeDb(rows())
    const unsubCollector = subscribedCollector(['other'])

    await setValueWithBuiltIn(
      makeCtx(subDb, [FIELD_TEXT], syncSession(subscribedCollector(['field-text']))),
      {
        recordId,
        fieldId: 'field-text',
        value: 'world',
        publishEvents: false,
        aiGeneration: aiMeta,
      }
    )
    await setValueWithBuiltIn(makeCtx(unsubDb, [FIELD_TEXT], syncSession(unsubCollector)), {
      recordId,
      fieldId: 'field-text',
      value: 'world',
      publishEvents: false,
      aiGeneration: aiMeta,
    })

    // Exactly the one targeted read separates the two runs.
    expect(subDb.__selectCount).toBe(unsubDb.__selectCount + 1)
    const manifest = unsubCollector.toJson()
    expect(manifest?.touched).toEqual({ [recordId]: ['field-text'] })
    expect(manifest?.deltas).toEqual({})
  })
})

// =============================================================================
// Tier-2 — add / remove deltas from state already in hand
// =============================================================================

describe('tier-2 delta capture — addValues / removeValues', () => {
  it('addValues captures o = pre-op list, n = post-op list', async () => {
    const collector = subscribedCollector(['field-tags'])
    const rows = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const ctx = makeCtx(makeFakeDb(rows), [FIELD_TAGS], syncSession(collector))

    await addValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-b'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { 'field-tags': { o: ['opt-a'], n: ['opt-a', 'opt-b'] } },
    })
  })

  it('addValues on an empty field captures o = null', async () => {
    const collector = subscribedCollector(['field-tags'])
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TAGS], syncSession(collector))

    await addValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-a'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { 'field-tags': { o: null, n: ['opt-a'] } },
    })
  })

  it('addValues on an unsubscribed field stays tier-1 only', async () => {
    const collector = subscribedCollector(['other'])
    const ctx = makeCtx(makeFakeDb([]), [FIELD_TAGS], syncSession(collector))

    await addValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-a'],
      skipPublishEvents: true,
    })

    const manifest = collector.toJson()
    expect(manifest?.touched).toEqual({ [recordId]: ['field-tags'] })
    expect(manifest?.deltas).toEqual({})
  })

  it('removeValues reconstructs o from the widened RETURNING + surviving values', async () => {
    const collector = subscribedCollector(['field-tags'])
    // Post-delete read returns the surviving row; the DELETE's RETURNING carries
    // the full removed row so the pre-op list is reconstructable in order.
    const surviving = [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]
    const removed = [existingRow('fv-b', 'field-tags', 'a1', { optionId: 'opt-b' })]
    const ctx = makeCtx(makeFakeDb(surviving, removed), [FIELD_TAGS], syncSession(collector))

    await removeValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-b'],
      skipPublishEvents: true,
    })

    expect(collector.toJson()?.deltas).toEqual({
      [recordId]: { 'field-tags': { o: ['opt-a', 'opt-b'], n: ['opt-a'] } },
    })
  })

  it('removeValues on an unsubscribed field stays tier-1 only', async () => {
    const collector = subscribedCollector(['other'])
    const ctx = makeCtx(
      makeFakeDb([], [existingRow('fv-a', 'field-tags', 'a0', { optionId: 'opt-a' })]),
      [FIELD_TAGS],
      syncSession(collector)
    )

    await removeValues(ctx, {
      recordId,
      fieldId: 'field-tags',
      values: ['opt-a'],
      skipPublishEvents: true,
    })

    const manifest = collector.toJson()
    expect(manifest?.touched).toEqual({ [recordId]: ['field-tags'] })
    expect(manifest?.deltas).toEqual({})
  })
})
