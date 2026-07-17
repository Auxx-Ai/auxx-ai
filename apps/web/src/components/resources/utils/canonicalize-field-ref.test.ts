// apps/web/src/components/resources/utils/canonicalize-field-ref.test.ts
// Hardening-plan Part 7 + system-field-id resolution: BOTH key halves become
// canonical — def prefix (entityType/apiSlug → def id) AND field id
// (static key / systemAttribute → CustomField row id).

import type { FieldPath, FieldReference } from '@auxx/types/field'
import { beforeEach, describe, expect, it } from 'vitest'
import { getResourceStoreState } from '../store/resource-store'
import { buildCanonicalFieldValueKey, canonicalizeFieldRef } from './canonicalize-field-ref'

const WORK_ORDER_DEF = 'cmworkorderdef12345678'
const STATUS_ROW_ID = 'cfstatus1'

const statusField = {
  id: STATUS_ROW_ID,
  key: 'status',
  label: 'Status',
  type: 'string',
  fieldType: 'SINGLE_SELECT',
  systemAttribute: 'work_order_status',
  capabilities: {},
} as any

const workOrderResource = {
  id: WORK_ORDER_DEF,
  type: 'custom',
  apiSlug: 'work_orders',
  entityType: 'work_order',
  entityDefinitionId: WORK_ORDER_DEF,
  organizationId: 'org_1',
  label: 'Work Order',
  plural: 'Work Orders',
  icon: 'wrench',
  color: 'blue',
  isVisible: true,
  fields: [statusField],
  display: {
    primaryDisplayField: null,
    secondaryDisplayField: null,
    avatarField: null,
    defaultSortField: 'updatedAt',
    defaultSortDirection: 'desc',
    orgScopingStrategy: 'direct',
  },
} as any

beforeEach(() => {
  getResourceStoreState().reset()
  getResourceStoreState().setResources([workOrderResource])
})

describe('canonicalizeFieldRef', () => {
  it('canonicalizes the definition half (entityType/apiSlug → def id)', () => {
    expect(canonicalizeFieldRef(`work_order:${STATUS_ROW_ID}` as FieldReference)).toBe(
      `${WORK_ORDER_DEF}:${STATUS_ROW_ID}`
    )
    expect(canonicalizeFieldRef(`work_orders:${STATUS_ROW_ID}` as FieldReference)).toBe(
      `${WORK_ORDER_DEF}:${STATUS_ROW_ID}`
    )
  })

  it('canonicalizes the field half: static key form → row-id form', () => {
    expect(canonicalizeFieldRef('work_order:status' as FieldReference)).toBe(
      `${WORK_ORDER_DEF}:${STATUS_ROW_ID}`
    )
    expect(canonicalizeFieldRef(`${WORK_ORDER_DEF}:status` as FieldReference)).toBe(
      `${WORK_ORDER_DEF}:${STATUS_ROW_ID}`
    )
  })

  it('leaves canonical refs untouched (same string identity)', () => {
    const canonical = `${WORK_ORDER_DEF}:${STATUS_ROW_ID}` as FieldReference
    expect(canonicalizeFieldRef(canonical)).toBe(canonical)
  })

  it('preserves late-bound @app: encoding while fixing the def half', () => {
    expect(canonicalizeFieldRef('work_orders:@app:shopify:ext_id' as FieldReference)).toBe(
      `${WORK_ORDER_DEF}:@app:shopify:ext_id`
    )
  })

  it('canonicalizes every segment of a drill-down FieldPath', () => {
    const path = ['work_order:cfrel1', 'work_order:status'] as FieldPath
    expect(canonicalizeFieldRef(path)).toEqual([
      `${WORK_ORDER_DEF}:cfrel1`,
      `${WORK_ORDER_DEF}:${STATUS_ROW_ID}`,
    ])
  })

  it('is a no-op for unknown prefixes (pre-hydration)', () => {
    getResourceStoreState().reset()
    expect(canonicalizeFieldRef('work_order:status' as FieldReference)).toBe('work_order:status')
  })
})

describe('buildCanonicalFieldValueKey', () => {
  it('resolves bare systemAttribute field ids (e.g. work_order_status)', () => {
    const { key } = buildCanonicalFieldValueKey(
      'work_order:r1',
      'work_order_status' as FieldReference
    )
    expect(key).toBe(`${WORK_ORDER_DEF}:r1:${WORK_ORDER_DEF}:${STATUS_ROW_ID}`)
  })

  it('all alias spellings of the same cell land on ONE key', () => {
    const spellings: Array<[string, FieldReference]> = [
      ['work_order:r1', 'work_order:status' as FieldReference],
      ['work_orders:r1', `${WORK_ORDER_DEF}:${STATUS_ROW_ID}` as FieldReference],
      [`${WORK_ORDER_DEF}:r1`, 'status' as FieldReference],
      [`${WORK_ORDER_DEF}:r1`, 'work_order_status' as FieldReference],
    ]
    const keys = new Set(
      spellings.map(([rid, ref]) => buildCanonicalFieldValueKey(rid as never, ref).key)
    )
    expect(keys.size).toBe(1)
    expect([...keys][0]).toBe(`${WORK_ORDER_DEF}:r1:${WORK_ORDER_DEF}:${STATUS_ROW_ID}`)
  })
})
