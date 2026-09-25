// packages/lib/src/field-hooks/__tests__/system-rules-relationship-guard.test.ts
// Connector relationship passes write edges on the silent sync lane; a system field rule on a
// relationship field then fires only from the finalize manifest. See
// plans/realtime/sync-record-event-flood.md §3 P3.

import { FieldType } from '@auxx/database/enums'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetAutoBuildRulesLatch,
  registerAutoBuildRules,
} from '../../inventory/builds/auto-build-rule'
import { __clearNativeRuleHandlers } from '../../record-rules/actions'
import { __clearSystemRules, getSystemRuleDeclarations } from '../../record-rules/system-rules'
import { RESOURCE_FIELD_REGISTRY } from '../../resources/registry/field-registry'
import { __resetFieldSystemRulesLatch, registerFieldSystemRules } from '../system-record-rules'

/**
 * Reviewed exceptions. `vendor_part_tariff_code` is not bound by any connector catalog, and a
 * sync write to it still fires the rule through `handleSyncRecordRules` (system rules are unioned
 * into `getCachedRecordRules`, so the field is manifest-subscribed with real old/new values).
 */
const REVIEWED_RELATIONSHIP_RULE_FIELDS = ['vendor_part_tariff_code']

function relationshipSystemAttributes(): Set<string> {
  const attrs = new Set<string>()
  for (const fields of Object.values(RESOURCE_FIELD_REGISTRY)) {
    for (const field of Object.values(fields ?? {})) {
      if (field.fieldType === FieldType.RELATIONSHIP && field.systemAttribute) {
        attrs.add(field.systemAttribute)
      }
    }
  }
  return attrs
}

function reset(): void {
  __clearSystemRules()
  __clearNativeRuleHandlers()
  __resetFieldSystemRulesLatch()
  __resetAutoBuildRulesLatch()
}

beforeEach(() => {
  reset()
  registerFieldSystemRules()
  registerAutoBuildRules()
})

afterEach(reset)

describe('system field rules vs connector relationship writes', () => {
  it('the relationship registry is populated, so the guard is not vacuous', () => {
    const attrs = relationshipSystemAttributes()
    expect(attrs.has('line_item_order')).toBe(true)
    expect(attrs.has('fulfillment_line_fulfillment')).toBe(true)
  })

  it('watches no relationship field outside the reviewed list', () => {
    const relationshipAttrs = relationshipSystemAttributes()
    const watched = getSystemRuleDeclarations()
      .map((d) => d.fieldRef?.systemAttribute)
      .filter((attr): attr is string => !!attr && relationshipAttrs.has(attr))

    expect([...new Set(watched)].sort()).toEqual(REVIEWED_RELATIONSHIP_RULE_FIELDS)
  })
})
