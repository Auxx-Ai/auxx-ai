// packages/lib/src/import/__tests__/analyze-row.test.ts

import { describe, expect, it, vi } from 'vitest'
import { hashValue } from '../hashing/hash-value'
import { analyzeRow } from '../planning/analyze-row'
import type { FindExistingRecordResult } from '../planning/find-existing-record'
import type { ImportMappingProperty } from '../types/mapping'
import type { ValueResolution } from '../types/resolution'

function mapping(overrides: Partial<ImportMappingProperty>): ImportMappingProperty {
  return {
    id: 'prop-1',
    importMappingId: 'mapping-1',
    sourceColumnIndex: 0,
    sourceColumnName: 'Email',
    targetType: 'particle',
    targetFieldKey: 'primary_email',
    customFieldId: null,
    resolutionType: 'email:split',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }
}

function resolution(rawValue: string, resolved: ValueResolution['resolvedValues'][number]) {
  const res: ValueResolution = {
    id: 'res-1',
    importJobPropertyId: 'jobprop-1',
    hashedValue: hashValue(rawValue),
    rawValue,
    cellCount: 1,
    resolvedValues: [resolved],
    isValid: resolved.type !== 'error',
  }
  return res
}

/** Adapt the old single-value fake to the tuple-shaped `FindExistingRecord`. */
function byEmail(lookup: (value: string) => string | null) {
  return async (values: Record<string, string>): Promise<FindExistingRecordResult> => {
    const matched = lookup(values.primary_email!)
    return matched ? { kind: 'one', recordId: matched } : { kind: 'none' }
  }
}

describe('analyzeRow — multi-value identifier (match-ANY)', () => {
  const baseCtx = {
    mappings: [mapping({})],
    identifierFieldKeys: ['primary_email'],
  }

  it('matches ANY element and plans an update when exactly one record matches', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: byEmail((v) => (v === 'b@y.com' ? 'rec-1' : null)),
      }
    )
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('rec-1')
  })

  it('errors the row when two elements match DIFFERENT records (ambiguous)', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: byEmail((v) => (v === 'a@x.com' ? 'rec-1' : 'rec-2')),
      }
    )
    expect(result.strategy).toBe('skip')
    expect(result.errors.some((e) => e.includes('multiple different records'))).toBe(true)
    expect(result.existingRecordId).toBeUndefined()
  })

  it('plans a create with the full array when nothing matches', async () => {
    const raw = 'a@x.com, b@y.com'
    const resolutions = new Map([
      [hashValue(raw), resolution(raw, { type: 'value', value: ['a@x.com', 'b@y.com'] })],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions,
        findExistingRecord: byEmail(() => null),
      }
    )
    expect(result.strategy).toBe('create')
    expect(result.resolvedData.primary_email).toEqual(['a@x.com', 'b@y.com'])
  })

  it('still matches a scalar identifier by the raw trimmed cell', async () => {
    const raw = 'a@x.com'
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        ...baseCtx,
        resolutions: new Map(),
        findExistingRecord: byEmail((v) => (v === 'a@x.com' ? 'rec-9' : null)),
      }
    )
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('rec-9')
  })
})

describe('analyzeRow — warnings', () => {
  it('propagates a warning-typed resolution as a row warning and uses the valid subset', async () => {
    const raw = 'a@x.com, broken'
    const resolutions = new Map([
      [
        hashValue(raw),
        resolution(raw, {
          type: 'warning',
          value: ['a@x.com'],
          warning: 'Dropped invalid value: broken',
        }),
      ],
    ])
    const result = await analyzeRow(
      0,
      { 0: raw },
      {
        mappings: [mapping({})],
        resolutions,
      }
    )
    expect(result.strategy).toBe('create')
    expect(result.resolvedData.primary_email).toEqual(['a@x.com'])
    expect(result.warnings).toEqual(['Column "Email": Dropped invalid value: broken'])
    expect(result.errors).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Modes
// ─────────────────────────────────────────────────────────────────────────

const skuMapping = mapping({
  sourceColumnIndex: 0,
  sourceColumnName: 'SKU',
  targetFieldKey: 'part_sku',
  resolutionType: 'text:value',
})

describe('analyzeRow, modes', () => {
  it('create mode never consults the identifier, even when one is set', async () => {
    const findExistingRecord = vi.fn(
      async (): Promise<FindExistingRecordResult> => ({
        kind: 'one',
        recordId: 'rec-1',
      })
    )
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        mode: 'create',
        findExistingRecord,
      }
    )
    expect(result.strategy).toBe('create')
    expect(result.existingRecordId).toBeUndefined()
    expect(findExistingRecord).not.toHaveBeenCalled()
  })

  // `unmatched` is NOT `skip` and NOT an error, a preview that shows both
  // under one badge hides a whole class of unimported rows.
  it('update mode sends an unmatched row to `unmatched`, with no error', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        mode: 'update',
        findExistingRecord: async () => ({ kind: 'none' }),
      }
    )
    expect(result.strategy).toBe('unmatched')
    expect(result.errors).toEqual([])
  })

  it('update mode sends a row with a BLANK identifier to `unmatched`, not `create`', async () => {
    const result = await analyzeRow(
      0,
      { 0: '   ' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        mode: 'update',
        findExistingRecord: async () => ({ kind: 'none' }),
      }
    )
    expect(result.strategy).toBe('unmatched')
  })

  it('create-or-update creates an unmatched row and updates a matched one', async () => {
    const ctx = {
      mappings: [skuMapping],
      resolutions: new Map(),
      identifierFieldKeys: ['part_sku'],
      mode: 'create-or-update' as const,
      findExistingRecord: async (v: Record<string, string>): Promise<FindExistingRecordResult> =>
        v.part_sku === 'M400L' ? { kind: 'one', recordId: 'rec-1' } : { kind: 'none' },
    }
    await expect(analyzeRow(0, { 0: 'M400L' }, ctx)).resolves.toMatchObject({
      strategy: 'update',
      existingRecordId: 'rec-1',
    })
    await expect(analyzeRow(1, { 0: 'NEW-1' }, ctx)).resolves.toMatchObject({
      strategy: 'create',
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Ambiguity and lookup failure
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRow, ambiguity is a row error', () => {
  it('names the count and never picks a record', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        findExistingRecord: async () => ({ kind: 'ambiguous', count: 2 }),
      }
    )
    expect(result.strategy).toBe('skip')
    expect(result.existingRecordId).toBeUndefined()
    expect(result.errors[0]).toContain('2 records share this value')
  })
})

describe('analyzeRow, a failed lookup is an ERROR, never a silent create', () => {
  // This used to be a bare `catch {}` commented "If lookup fails, default to
  // create", a transient DB error silently produced a DUPLICATE record.
  it('errors the row (⇒ skip) instead of falling through to create', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        findExistingRecord: async () => {
          throw new Error('connection terminated')
        },
      }
    )
    expect(result.strategy).toBe('skip')
    expect(result.strategy).not.toBe('create')
    expect(result.errors[0]).toContain('connection terminated')
  })
})

// ─────────────────────────────────────────────────────────────────────────
// In-file duplicate identifiers
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRow, in-file duplicate identifiers', () => {
  const baseCtx = () => ({
    mappings: [skuMapping],
    resolutions: new Map(),
    identifierFieldKeys: ['part_sku'],
    findExistingRecord: async (): Promise<FindExistingRecordResult> => ({ kind: 'none' }),
    seenIdentifiers: new Map<string, number>(),
  })

  it('errors the LATER row and names BOTH row numbers', async () => {
    const ctx = baseCtx()
    const first = await analyzeRow(0, { 0: 'M400L' }, ctx)
    const second = await analyzeRow(4, { 0: 'M400L' }, ctx)

    expect(first.strategy).toBe('create')
    expect(first.errors).toEqual([])

    expect(second.strategy).toBe('skip')
    // Row numbers are 1-based, matching how the preview renders them.
    expect(second.errors[0]).toContain('row 5')
    expect(second.errors[0]).toContain('row 1')
  })

  // Identifier matching is case-insensitive for TEXT, so the guard must be too,
  // otherwise `M400L` and `m400l` in one file look like two different parts.
  it('is case-insensitive, matching the identifier comparison', async () => {
    const ctx = baseCtx()
    await analyzeRow(0, { 0: 'M400L' }, ctx)
    const second = await analyzeRow(1, { 0: 'm400l' }, ctx)
    expect(second.strategy).toBe('skip')
  })

  it('does not fire in create mode, duplicate rows are what the user asked for', async () => {
    const ctx = { ...baseCtx(), mode: 'create' as const }
    await analyzeRow(0, { 0: 'M400L' }, ctx)
    const second = await analyzeRow(1, { 0: 'M400L' }, ctx)
    expect(second.strategy).toBe('create')
    expect(second.errors).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────
// Composite keys
// ─────────────────────────────────────────────────────────────────────────

describe('analyzeRow, composite identifier', () => {
  const mappings = [
    mapping({
      id: 'p-part',
      sourceColumnIndex: 0,
      sourceColumnName: 'Part',
      targetFieldKey: 'part',
      resolutionType: 'text:value',
    }),
    mapping({
      id: 'p-supplier',
      sourceColumnIndex: 1,
      sourceColumnName: 'Supplier',
      targetFieldKey: 'supplier',
      resolutionType: 'text:value',
    }),
  ]

  const ctx = (findExistingRecord: (v: Record<string, string>) => FindExistingRecordResult) => ({
    mappings,
    resolutions: new Map(),
    identifierFieldKeys: ['part', 'supplier'],
    findExistingRecord: async (v: Record<string, string>) => findExistingRecord(v),
  })

  it('passes the whole tuple to the lookup', async () => {
    const seen: Array<Record<string, string>> = []
    const result = await analyzeRow(
      0,
      { 0: 'M400L', 1: 'ACME' },
      ctx((v) => {
        seen.push(v)
        return { kind: 'one', recordId: 'vp-1' }
      })
    )
    expect(seen).toEqual([{ part: 'M400L', supplier: 'ACME' }])
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('vp-1')
  })

  // A missing component must never partially match, falling back to the
  // components present would silently widen the key.
  it('never partially matches when a component is missing', async () => {
    const findExistingRecord = vi.fn(
      (): FindExistingRecordResult => ({ kind: 'one', recordId: 'vp-1' })
    )
    const result = await analyzeRow(0, { 0: 'M400L', 1: '' }, ctx(findExistingRecord))
    expect(findExistingRecord).not.toHaveBeenCalled()
    expect(result.strategy).toBe('create')
  })

  it('classifies an incomplete tuple as `unmatched` in update mode', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L', 1: '' },
      {
        ...ctx(() => ({ kind: 'none' })),
        mode: 'update',
      }
    )
    expect(result.strategy).toBe('unmatched')
  })

  it('keys the in-file duplicate guard on the whole tuple', async () => {
    const shared = {
      ...ctx(() => ({ kind: 'none' })),
      seenIdentifiers: new Map<string, number>(),
    }
    await analyzeRow(0, { 0: 'M400L', 1: 'ACME' }, shared)
    // Same part, DIFFERENT supplier, a distinct composite key, not a duplicate.
    const other = await analyzeRow(1, { 0: 'M400L', 1: 'GLOBEX' }, shared)
    expect(other.errors).toEqual([])
    // Same tuple, a duplicate.
    const dup = await analyzeRow(2, { 0: 'M400L', 1: 'ACME' }, shared)
    expect(dup.strategy).toBe('skip')
  })
})

describe('analyzeRow, update mode never creates', () => {
  // A stale identifier key whose column was unmapped leaves `identifierKeys`
  // empty. Falling through to `create` there would produce a FULL duplicate set
  // behind a wizard that says "update existing".
  it('lands on `unmatched` when there is no identifier at all', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: [],
        mode: 'update',
      }
    )
    expect(result.strategy).toBe('unmatched')
  })

  it('lands on `unmatched` when no matcher could be built', async () => {
    const result = await analyzeRow(
      0,
      { 0: 'M400L' },
      {
        mappings: [skuMapping],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        mode: 'update',
        // no findExistingRecord, e.g. the resource has no lookup method
      }
    )
    expect(result.strategy).toBe('unmatched')
  })
})

// ─────────────────────────────────────────────────────────────────────────

/**
 * A relation identifier leg must be matched on its RESOLVED record id, never on
 * the raw cell.
 *
 * `(part, supplier)` on `vendor_part` is two relation legs, so this is the whole
 * natural key, not an edge of it. The raw cell says `Acme Corp`; the resolver
 * turns it into a record id; the stored value is a `relatedEntityId`. Passing
 * the cell text compares a company NAME against an id column, which can never
 * match — and the miss is silent, classifying the row `create` and writing the
 * duplicate the key exists to prevent.
 */
describe('analyzeRow, relation identifier legs use the resolved id', () => {
  const relationMappings = [
    mapping({
      id: 'p-part',
      sourceColumnIndex: 0,
      sourceColumnName: 'Part',
      targetFieldKey: 'part',
      resolutionType: 'relation:match',
    }),
    mapping({
      id: 'p-supplier',
      sourceColumnIndex: 1,
      sourceColumnName: 'Supplier',
      targetFieldKey: 'supplier',
      resolutionType: 'relation:match',
    }),
  ]

  const resolutionsFor = (
    partCell: string,
    partId: string | null,
    supplierCell: string,
    supplierId: string | null
  ) =>
    new Map([
      [hashValue(partCell), resolution(partCell, { type: 'value', value: partId })],
      [hashValue(supplierCell), resolution(supplierCell, { type: 'value', value: supplierId })],
    ])

  it('passes resolved record ids, not the raw cells', async () => {
    const seen: Array<Record<string, string>> = []
    const result = await analyzeRow(
      0,
      { 0: 'M400L', 1: 'Acme Corp' },
      {
        mappings: relationMappings,
        resolutions: resolutionsFor('M400L', 'part-1', 'Acme Corp', 'company-1'),
        identifierFieldKeys: ['part', 'supplier'],
        findExistingRecord: async (v) => {
          seen.push(v)
          return { kind: 'one', recordId: 'vp-1' }
        },
      }
    )

    expect(seen).toEqual([{ part: 'part-1', supplier: 'company-1' }])
    expect(result.strategy).toBe('update')
    expect(result.existingRecordId).toBe('vp-1')
  })

  // `onNoMatch: 'blank'` and `relation:create` both resolve to null. The leg is
  // genuinely absent, so the tuple is incomplete and no lookup is issued — the
  // raw cell must NOT be substituted back in to make it look complete.
  it('treats a leg that resolved to null as absent, not as the raw cell', async () => {
    const findExistingRecord = vi.fn(
      (_values: Record<string, string>): FindExistingRecordResult => ({
        kind: 'one',
        recordId: 'vp-1',
      })
    )
    const result = await analyzeRow(
      0,
      { 0: 'M400L', 1: 'Unknown Supplier' },
      {
        mappings: relationMappings,
        resolutions: resolutionsFor('M400L', 'part-1', 'Unknown Supplier', null),
        identifierFieldKeys: ['part', 'supplier'],
        findExistingRecord: async (v) => findExistingRecord(v),
      }
    )

    expect(findExistingRecord).not.toHaveBeenCalled()
    expect(result.strategy).toBe('create')
  })

  // The in-file duplicate guard has to key on the resolved ids too, or two
  // spellings of one supplier read as two different suppliers.
  it('keys the in-file duplicate guard on the resolved ids', async () => {
    const shared = {
      mappings: relationMappings,
      resolutions: new Map([
        ...resolutionsFor('M400L', 'part-1', 'Acme Corp', 'company-1'),
        ...resolutionsFor('M400L', 'part-1', 'ACME CORP.', 'company-1'),
      ]),
      identifierFieldKeys: ['part', 'supplier'],
      findExistingRecord: async (): Promise<FindExistingRecordResult> => ({ kind: 'none' }),
      seenIdentifiers: new Map<string, number>(),
    }

    const first = await analyzeRow(0, { 0: 'M400L', 1: 'Acme Corp' }, shared)
    const second = await analyzeRow(1, { 0: 'M400L', 1: 'ACME CORP.' }, shared)

    expect(first.errors).toEqual([])
    expect(second.errors.join(' ')).toContain('repeats row 1')
  })

  // A scalar leg keeps reading the raw cell. Pinned so the relation branch can
  // never quietly capture the path `part_sku` has always taken.
  it('leaves a non-relation leg on the raw cell', async () => {
    const seen: Array<Record<string, string>> = []
    await analyzeRow(
      0,
      { 0: '  M400L  ' },
      {
        mappings: [
          mapping({
            id: 'p-sku',
            sourceColumnIndex: 0,
            sourceColumnName: 'SKU',
            targetFieldKey: 'part_sku',
            resolutionType: 'text:value',
          }),
        ],
        resolutions: new Map(),
        identifierFieldKeys: ['part_sku'],
        findExistingRecord: async (v) => {
          seen.push(v)
          return { kind: 'none' }
        },
      }
    )

    expect(seen).toEqual([{ part_sku: 'M400L' }])
  })
})
