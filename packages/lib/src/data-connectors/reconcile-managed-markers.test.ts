// packages/lib/src/data-connectors/reconcile-managed-markers.test.ts
// Phase 2.6 — un-manage stale contributing markers. The pass clears
// FieldValue.managedByConnectorId for fields the connector no longer maps
// (the FK set-null only covers connector deletion). Owned mappings are skipped;
// the keep-set is the union of currently-mapped concrete CustomField.ids per def.

import { getFieldId, type ResourceFieldId, toResourceFieldId } from '@auxx/types/field'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DecodedMapping } from './service'
import type { SyncCtx } from './sinks/types'
import type { FieldMapping } from './types'

// Capture the keep-set passed to notInArray while keeping real drizzle behavior.
const notInArrayIds: string[][] = []
vi.mock('drizzle-orm', async (orig) => {
  const actual = await orig<typeof import('drizzle-orm')>()
  return {
    ...actual,
    notInArray: (col: unknown, ids: string[]) => {
      notInArrayIds.push(ids)
      return actual.notInArray(col as never, ids)
    },
  }
})

// reconcileManagedMarkers doesn't use the sink, but reconciliation imports it.
vi.mock('./sinks/entity-sink', () => ({ entitySink: {} }))

const getCachedCustomFields = vi.fn()
vi.mock('../cache', () => ({
  getCachedCustomFields: (...a: unknown[]) => getCachedCustomFields(...a),
}))

const resolveConnectorFieldRef = vi.fn()
vi.mock('../agents/bindings/resolve', () => ({
  resolveConnectorFieldRef: (...a: unknown[]) => resolveConnectorFieldRef(...a),
}))

import { reconcileManagedMarkers } from './reconciliation'

interface UpdateCall {
  payload: Record<string, unknown>
}
const updateCalls: UpdateCall[] = []

function makeCtx(): SyncCtx {
  return {
    orgId: 'org1',
    connector: { id: 'dc1', credentialId: 'cred1' },
    db: {
      update: () => ({
        set: (payload: Record<string, unknown>) => ({
          where: () => {
            updateCalls.push({ payload })
            return Promise.resolve()
          },
        }),
      }),
    },
  } as unknown as SyncCtx
}

/**
 * One bound field. `expression`/`sourceFields` mirror the degenerate single-token
 * form the mapping UI writes for a plain field→field binding; this pass reads only
 * `targetFieldRef`, but the row it stands in for always carries all three.
 */
function binding(targetFieldRef: ResourceFieldId, sourcePath = 'src'): FieldMapping {
  return {
    id: `fm_${getFieldId(targetFieldRef)}`,
    targetFieldRef,
    expression: `{${sourcePath}}`,
    sourceFields: { [sourcePath]: sourcePath },
  }
}

function mapping(over: Partial<DecodedMapping>): DecodedMapping {
  return {
    row: { id: 'm1' },
    targetMode: 'contributing',
    linkMode: 'upsert',
    entityDefinitionId: 'def1',
    orphanBehavior: 'archive',
    fieldMappings: [],
    ...over,
  } as unknown as DecodedMapping
}

beforeEach(() => {
  notInArrayIds.length = 0
  updateCalls.length = 0
  getCachedCustomFields.mockReset()
  resolveConnectorFieldRef.mockReset()
  // Two fields exist on def1; fieldB is the one still mapped.
  getCachedCustomFields.mockResolvedValue([
    { id: 'fieldA', systemAttribute: null },
    { id: 'fieldB', systemAttribute: null },
  ])
})

describe('reconcileManagedMarkers', () => {
  it('clears markers and keeps only currently-mapped fields (drops fieldA)', async () => {
    // Mapping now only writes fieldB → keep-set = [fieldB]; fieldA's marker clears.
    resolveConnectorFieldRef.mockResolvedValue(toResourceFieldId('def1', 'fieldB'))
    const m = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldB'))] })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'incremental', mappings: [m] }])

    expect(updateCalls).toHaveLength(1)
    expect(updateCalls[0]!.payload).toEqual({ managedByConnectorId: null })
    expect(notInArrayIds).toEqual([['fieldB']])
  })

  it('skips owned mappings entirely (no UPDATE)', async () => {
    const m = mapping({
      targetMode: 'owned',
      fieldMappings: [binding(toResourceFieldId('def1', 'fieldB'))],
    })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'snapshot', mappings: [m] }])

    expect(updateCalls).toHaveLength(0)
    expect(getCachedCustomFields).not.toHaveBeenCalled()
  })

  it('skips the def (no UPDATE) when a mapped ref fails to resolve — no destructive clear', async () => {
    // A currently-mapped ref that can't resolve (e.g. unbound @app: connection)
    // must NOT wipe the def's markers — the keep-set view is incomplete.
    resolveConnectorFieldRef.mockResolvedValue(null)
    const m = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldB'))] })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'incremental', mappings: [m] }])

    expect(updateCalls).toHaveLength(0)
  })

  it('marks the whole def incomplete if ANY of its mappings has an unresolved ref', async () => {
    // m1 resolves, m2 does not → the union is incomplete → skip clearing the def.
    resolveConnectorFieldRef
      .mockResolvedValueOnce(toResourceFieldId('def1', 'fieldA'))
      .mockResolvedValueOnce(null)
    const m1 = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldA'))] })
    const m2 = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldB'))] })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'incremental', mappings: [m1, m2] }])

    expect(updateCalls).toHaveLength(0)
  })

  it('clears EVERY marker when the connector maps nothing (no keep-set, no notInArray)', async () => {
    const m = mapping({ fieldMappings: [] })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'incremental', mappings: [m] }])

    expect(updateCalls).toHaveLength(1)
    expect(notInArrayIds).toHaveLength(0) // unbounded clear — no field exclusion
  })

  it('unions mapped fields across multiple contributing mappings on the same def', async () => {
    resolveConnectorFieldRef
      .mockResolvedValueOnce(toResourceFieldId('def1', 'fieldA'))
      .mockResolvedValueOnce(toResourceFieldId('def1', 'fieldB'))
    const m1 = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldA'))] })
    const m2 = mapping({ fieldMappings: [binding(toResourceFieldId('def1', 'fieldB'))] })

    await reconcileManagedMarkers(makeCtx(), [{ syncMode: 'incremental', mappings: [m1, m2] }])

    // One UPDATE for the single def; keep-set is the union of both mappings' fields.
    expect(updateCalls).toHaveLength(1)
    expect(notInArrayIds).toHaveLength(1)
    expect(new Set(notInArrayIds[0]!)).toEqual(new Set(['fieldA', 'fieldB']))
  })
})
