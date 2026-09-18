// packages/lib/src/resources/crud/__tests__/whole-record-read.test.ts

import type { CustomFieldEntity } from '@auxx/database/types'
import type { RelationshipConfig } from '@auxx/types/custom-field'
import type { RecordId } from '@auxx/types/resource'
import { describe, expect, it, vi } from 'vitest'
import type {
  BatchFieldValueResult,
  BatchGetValuesInput,
  TypedFieldValueResult,
} from '../../../field-values/types'
import type { RecordPickerItem } from '../../picker/types'
import { type RecordReadContext, readRecords } from '../whole-record-read'

// @auxx/database is globally mocked in src/test/setup.ts; `readRecords` takes a
// plain `RecordReadContext` so these tests never touch it — every collaborator
// is a hand-rolled fake.

function pickerItem(recordId: RecordId, displayName: string): RecordPickerItem {
  return {
    id: recordId.split(':')[1]!,
    recordId,
    displayName,
    data: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

function fieldValueResult(
  recordId: RecordId,
  fieldRef: string,
  value: TypedFieldValueResult['value']
): TypedFieldValueResult {
  return { recordId, fieldRef: fieldRef as never, value, fieldType: 'TEXT' as never }
}

function relationshipField(
  id: string,
  systemAttribute: string,
  relationship:
    | (Omit<RelationshipConfig, 'inverseResourceFieldId'> & {
        inverseResourceFieldId: string | null
      })
    | null
): CustomFieldEntity {
  return {
    id,
    systemAttribute,
    type: 'RELATIONSHIP',
    options: relationship ? { relationship } : null,
  } as unknown as CustomFieldEntity
}

/** A `ctx.db` fake that resolves canned rows per call and records each `.select()` projection's keys. */
function fakeDb(rowsPerCall: Array<Record<string, unknown>[]>) {
  let call = 0
  const selectedKeys: string[][] = []
  const builder = {
    select: vi.fn((cols: Record<string, unknown>) => {
      selectedKeys.push(Object.keys(cols))
      return builder
    }),
    from: vi.fn(() => builder),
    where: vi.fn(() => builder),
    orderBy: vi.fn(() => Promise.resolve(rowsPerCall[call++] ?? [])),
  }
  return { db: builder as never, selectedKeys }
}

function baseCtx(overrides: Partial<RecordReadContext> = {}): RecordReadContext {
  return {
    db: {} as never,
    organizationId: 'org_1',
    getByIds: vi.fn(async (ids: RecordId[]) =>
      Object.fromEntries(ids.map((id) => [id, pickerItem(id, id)]))
    ),
    batchGetValues: vi.fn(async () => ({ values: [] }) satisfies BatchFieldValueResult),
    getCustomFields: vi.fn(async () => []),
    ...overrides,
  }
}

describe('readRecords — absent when hidden', () => {
  it('a record getByIds drops is absent from the result, never null', async () => {
    const ctx = baseCtx({
      getByIds: vi.fn(async () => ({
        'contact:visible': pickerItem('contact:visible' as RecordId, 'Ann'),
      })),
    })

    const result = await readRecords(ctx, ['contact:visible', 'contact:hidden'] as RecordId[], {})

    expect(Object.keys(result)).toEqual(['contact:visible'])
    expect(result['contact:hidden' as RecordId]).toBeUndefined()
  })

  it('empty input short-circuits without calling getByIds', async () => {
    const ctx = baseCtx()
    const result = await readRecords(ctx, [], {})
    expect(result).toEqual({})
    expect(ctx.getByIds).not.toHaveBeenCalled()
  })
})

describe('readRecords — direct fields (step 2)', () => {
  it('projects requested fields under systemAttribute keys, mixed defs in one call', async () => {
    const fieldsByDef: Record<string, CustomFieldEntity[]> = {
      contact: [{ id: 'fld_email', systemAttribute: 'primary_email', type: 'TEXT' } as never],
      company: [{ id: 'fld_name', systemAttribute: 'company_name', type: 'TEXT' } as never],
    }
    const ctx = baseCtx({
      getCustomFields: vi.fn(async (defId: string) => fieldsByDef[defId] ?? []),
      batchGetValues: vi.fn(async ({ recordIds }: BatchGetValuesInput) => ({
        values: recordIds.map((id) =>
          fieldValueResult(
            id,
            id.startsWith('contact:') ? 'contact:fld_email' : 'company:fld_name',
            { type: 'text', value: `value-for-${id}` } as never
          )
        ),
      })),
    })

    const result = await readRecords(ctx, ['contact:c1', 'company:co1'] as RecordId[], {
      fields: ['primary_email', 'company_name'] as never,
    })

    expect(result['contact:c1' as RecordId]!.values.primary_email).toEqual({
      type: 'text',
      value: 'value-for-contact:c1',
    })
    expect(result['company:co1' as RecordId]!.values.company_name).toEqual({
      type: 'text',
      value: 'value-for-company:co1',
    })
    // One batchGetValues call per distinct def, not per record.
    expect(ctx.batchGetValues).toHaveBeenCalledTimes(2)
  })

  it('a field key the def does not have is silently absent, not an error', async () => {
    const ctx = baseCtx({
      getCustomFields: vi.fn(async () => [
        { id: 'fld_email', systemAttribute: 'primary_email', type: 'TEXT' } as never,
      ]),
    })

    const result = await readRecords(ctx, ['contact:c1'] as RecordId[], {
      fields: ['does_not_exist'] as never,
    })

    expect(result['contact:c1' as RecordId]!.values).toEqual({})
    expect(ctx.batchGetValues).not.toHaveBeenCalled()
  })

  it('marks a field key redacted when the relationship value carries a redaction marker', async () => {
    const ctx = baseCtx({
      getCustomFields: vi.fn(async () => [
        { id: 'fld_owner', systemAttribute: 'owner', type: 'RELATIONSHIP' } as never,
      ]),
      batchGetValues: vi.fn(async () => ({
        values: [
          fieldValueResult('contact:c1' as RecordId, 'contact:fld_owner', {
            type: 'relationship',
            recordId: '' as RecordId,
            redactedCount: 1,
          } as never),
        ],
      })),
    })

    const result = await readRecords(ctx, ['contact:c1'] as RecordId[], {
      fields: ['owner'] as never,
    })

    expect(result['contact:c1' as RecordId]!.redacted).toEqual(['owner'])
  })
})

describe('readRecords — include (steps 3-6)', () => {
  it('has_many: resolves all parents in one query, groups children per parent', async () => {
    const { db, selectedKeys } = fakeDb([
      [
        { entityId: 'order1', relatedEntityId: 'li1', relatedEntityDefinitionId: 'line_item' },
        { entityId: 'order1', relatedEntityId: 'li2', relatedEntityDefinitionId: 'line_item' },
        { entityId: 'order2', relatedEntityId: 'li3', relatedEntityDefinitionId: 'line_item' },
      ],
    ])
    const orderField = relationshipField('fld_lines', 'order_line_items', {
      relationshipType: 'has_many',
      isInverse: false,
      inverseResourceFieldId: null,
    })
    const ctx = baseCtx({
      db,
      getByIds: vi.fn(async (ids: RecordId[]) =>
        Object.fromEntries(ids.map((id) => [id, pickerItem(id, id)]))
      ),
      getCustomFields: vi.fn(async (defId: string) => (defId === 'order' ? [orderField] : [])),
    })

    const result = await readRecords(ctx, ['order:order1', 'order:order2'] as RecordId[], {
      include: { order_line_items: {} },
    })

    expect(result['order:order1' as RecordId]!.included.order_line_items).toEqual([
      expect.objectContaining({ recordId: 'line_item:li1' }),
      expect.objectContaining({ recordId: 'line_item:li2' }),
    ])
    expect(result['order:order2' as RecordId]!.included.order_line_items).toEqual([
      expect.objectContaining({ recordId: 'line_item:li3' }),
    ])
    // ONE query resolved the children for BOTH parents.
    expect(selectedKeys.length).toBe(1)
  })

  it('belongs_to/has_one: a single child, not wrapped in an array', async () => {
    const { db } = fakeDb([
      [{ entityId: 'li1', relatedEntityId: 'order1', relatedEntityDefinitionId: 'order' }],
    ])
    const lineItemField = relationshipField('fld_order', 'line_item_order', {
      relationshipType: 'belongs_to',
      isInverse: false,
      inverseResourceFieldId: 'order:fld_lines',
    })
    const ctx = baseCtx({
      db,
      getCustomFields: vi.fn(async (defId: string) =>
        defId === 'line_item' ? [lineItemField] : []
      ),
    })

    const result = await readRecords(ctx, ['line_item:li1'] as RecordId[], {
      include: { line_item_order: {} },
    })

    expect(result['line_item:li1' as RecordId]!.included.line_item_order).toEqual(
      expect.objectContaining({ recordId: 'order:order1' })
    )
    expect(Array.isArray(result['line_item:li1' as RecordId]!.included.line_item_order)).toBe(false)
  })

  it('an include key absent on the def is silently skipped, not an error', async () => {
    const ctx = baseCtx({ getCustomFields: vi.fn(async () => []) })

    const result = await readRecords(ctx, ['contact:c1'] as RecordId[], {
      include: { nonexistent: {} },
    })

    expect(result['contact:c1' as RecordId]!.included).toEqual({})
    expect(result['contact:c1' as RecordId]!.redacted).toEqual([])
  })

  it('reports redacted on the include key when the recursive getByIds drops a child', async () => {
    const { db } = fakeDb([
      [
        { entityId: 'order1', relatedEntityId: 'li1', relatedEntityDefinitionId: 'line_item' },
        { entityId: 'order1', relatedEntityId: 'li2', relatedEntityDefinitionId: 'line_item' },
      ],
    ])
    const orderField = relationshipField('fld_lines', 'order_line_items', {
      relationshipType: 'has_many',
      isInverse: false,
      inverseResourceFieldId: null,
    })
    const ctx = baseCtx({
      db,
      // Step 1 admits the order; step 4 (the recursive getByIds on the union
      // of child ids) admits only li1 — li2 is hidden from this principal.
      getByIds: vi.fn(async (ids: RecordId[]) => {
        const visible = ids.filter((id) => id !== 'line_item:li2')
        return Object.fromEntries(visible.map((id) => [id, pickerItem(id, id)]))
      }),
      getCustomFields: vi.fn(async (defId: string) => (defId === 'order' ? [orderField] : [])),
    })

    const result = await readRecords(ctx, ['order:order1'] as RecordId[], {
      include: { order_line_items: {} },
    })

    const node = result['order:order1' as RecordId]!
    expect(node.included.order_line_items).toEqual([
      expect.objectContaining({ recordId: 'line_item:li1' }),
    ])
    expect(node.redacted).toEqual(['order_line_items'])
  })

  it('resolves the reliable belongs_to side when the parent field is the isInverse mirror', async () => {
    const { db, selectedKeys } = fakeDb([
      [{ entityId: 'li1', entityDefinitionId: 'line_item', relatedEntityId: 'order1' }],
    ])
    // isInverse:true — this field's OWN rows are documented-unreliable; the
    // inverse (belongs_to, on line_item) must be queried instead.
    const orderField = relationshipField('fld_lines', 'order_line_items', {
      relationshipType: 'has_many',
      isInverse: true,
      inverseResourceFieldId: 'line_item:fld_order',
    })
    const ctx = baseCtx({
      db,
      getCustomFields: vi.fn(async (defId: string) => (defId === 'order' ? [orderField] : [])),
    })

    const result = await readRecords(ctx, ['order:order1'] as RecordId[], {
      include: { order_line_items: {} },
    })

    expect(result['order:order1' as RecordId]!.included.order_line_items).toEqual([
      expect.objectContaining({ recordId: 'line_item:li1' }),
    ])
    // The inverse-direction projection (entityId, entityDefinitionId, relatedEntityId),
    // not the field's own (entityId, relatedEntityId, relatedEntityDefinitionId).
    expect(selectedKeys[0]?.sort()).toEqual(
      ['entityDefinitionId', 'entityId', 'relatedEntityId'].sort()
    )
  })

  it('uses the field’s own rows when it is NOT the isInverse mirror, even if an inverse resolves', async () => {
    const { db, selectedKeys } = fakeDb([
      [{ entityId: 'li1', relatedEntityId: 'order1', relatedEntityDefinitionId: 'order' }],
    ])
    // isInverse:false — this field IS the primary/belongs_to side. Its own
    // rows are authoritative regardless of whether an inverse resolves.
    const lineItemField = relationshipField('fld_order', 'line_item_order', {
      relationshipType: 'belongs_to',
      isInverse: false,
      inverseResourceFieldId: 'order:fld_lines',
    })
    const ctx = baseCtx({
      db,
      getCustomFields: vi.fn(async (defId: string) =>
        defId === 'line_item' ? [lineItemField] : []
      ),
    })

    const result = await readRecords(ctx, ['line_item:li1'] as RecordId[], {
      include: { line_item_order: {} },
    })

    expect(result['line_item:li1' as RecordId]!.included.line_item_order).toEqual(
      expect.objectContaining({ recordId: 'order:order1' })
    )
    expect(selectedKeys[0]?.sort()).toEqual(
      ['entityId', 'relatedEntityId', 'relatedEntityDefinitionId'].sort()
    )
  })

  it('nests one level deeper only when the caller asks explicitly', async () => {
    const { db } = fakeDb([
      [{ entityId: 'order1', relatedEntityId: 'li1', relatedEntityDefinitionId: 'line_item' }],
    ])
    const orderField = relationshipField('fld_lines', 'order_line_items', {
      relationshipType: 'has_many',
      isInverse: false,
      inverseResourceFieldId: null,
    })
    const skuField = { id: 'fld_sku', systemAttribute: 'sku', type: 'TEXT' } as never
    const fieldsByDef: Record<string, CustomFieldEntity[]> = {
      order: [orderField],
      line_item: [skuField],
    }
    const ctx = baseCtx({
      db,
      getCustomFields: vi.fn(async (defId: string) => fieldsByDef[defId] ?? []),
      batchGetValues: vi.fn(async ({ recordIds, fieldReferences }: BatchGetValuesInput) => ({
        values: recordIds.flatMap((id) =>
          fieldReferences.map((ref) =>
            fieldValueResult(id, ref as string, { type: 'text', value: 'SKU-1' } as never)
          )
        ),
      })),
    })

    const result = await readRecords(ctx, ['order:order1'] as RecordId[], {
      include: { order_line_items: { fields: ['sku'] as never } },
    })

    const child = result['order:order1' as RecordId]!.included.order_line_items as never as Array<{
      values: Record<string, unknown>
    }>
    expect(child[0]!.values.sku).toEqual({ type: 'text', value: 'SKU-1' })
  })
})
