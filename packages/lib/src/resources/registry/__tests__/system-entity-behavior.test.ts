// packages/lib/src/resources/registry/__tests__/system-entity-behavior.test.ts
//
// Phase 1 tests (plans/entity/system-entity-behavior-map.md §9, tests 1-4). Tests
// 5-9 (the mail-lens block, the tier composition order, the no-direct-read
// guard, the catalog-shrink assertion, and the `??` sidebar-toggle semantics)
// belong to the Phase 2/3 changes and live elsewhere.

import { describe, expect, it } from 'vitest'
import { SYSTEM_ENTITIES } from '../../../seed/entity-seeder/constants'
import {
  DEFAULTS,
  resolveSystemEntityBehavior,
  resolveTableBackedBehavior,
  SYSTEM_ENTITY_BEHAVIOR,
} from '../system-entity-behavior'

/**
 * The 14 system defs that carry no override and resolve to pure `DEFAULTS`
 * (plan §5.4): `contact`, `ticket`, `part`, `company`, `product`, `order`,
 * `quote`, `invoice`, `credit_memo`, `purchase_order`, `vendor_bill`,
 * `work_order`, `service_request`, `build`.
 */
const PURE_DEFAULT_ENTITY_TYPES = [
  'contact',
  'ticket',
  'part',
  'company',
  'product',
  'order',
  'quote',
  'invoice',
  'credit_memo',
  'purchase_order',
  'vendor_bill',
  'work_order',
  'service_request',
  'build',
  'return',
] as const

describe('the shipped behavior map is exactly the curated set', () => {
  // One settled array, no provisional half — forces every new def to be an
  // explicit decision in review. Modeled on
  // ai-entity-visibility.test.ts:236.
  it('SYSTEM_ENTITY_BEHAVIOR keys are exactly the 36 defs that differ from DEFAULTS', () => {
    expect(Object.keys(SYSTEM_ENTITY_BEHAVIOR).sort()).toEqual([
      'article',
      'bank_account',
      'bank_deposit',
      'bank_rule',
      'bank_transaction',
      'catalog_group',
      'catalog_item',
      'credit_memo_application',
      'credit_memo_line',
      'entity_group',
      'fulfillment',
      'fulfillment_line',
      'gl_account',
      'inbox',
      'journal_entry',
      'line_item',
      'meeting',
      'parcel',
      'payment',
      'payment_gateway',
      'payout',
      'personal_inbox',
      'purchase_order_line',
      'return_line',
      'return_part_line',
      'shipment',
      'signature',
      'stock_movement',
      'subpart',
      'tag',
      'tariff_code',
      'tariff_rate',
      'tax_line',
      'thread',
      'vendor_bill_line',
      'vendor_part',
      'vendor_payment',
      'vendor_payment_allocation',
    ])
  })
})

describe('coverage: every SYSTEM_ENTITIES type is an explicit decision', () => {
  const systemTypes = SYSTEM_ENTITIES.map((entity) => entity.entityType)

  it.each(
    systemTypes
  )('%s either has a SYSTEM_ENTITY_BEHAVIOR entry or is a documented pure-default def', (entityType) => {
    const hasOverride = entityType in SYSTEM_ENTITY_BEHAVIOR
    const isPureDefault = (PURE_DEFAULT_ENTITY_TYPES as readonly string[]).includes(entityType)
    expect(
      hasOverride || isPureDefault,
      `${entityType} is neither in SYSTEM_ENTITY_BEHAVIOR nor in the documented pure-default list`
    ).toBe(true)
  })

  it('has no SYSTEM_ENTITY_BEHAVIOR entry for a type that is not a system entity', () => {
    const orphans = Object.keys(SYSTEM_ENTITY_BEHAVIOR).filter(
      (type) => !systemTypes.includes(type)
    )
    expect(orphans).toEqual([])
  })

  it('the pure-default list itself carries no override — it would be redundant', () => {
    for (const entityType of PURE_DEFAULT_ENTITY_TYPES) {
      expect(SYSTEM_ENTITY_BEHAVIOR[entityType], entityType).toBeUndefined()
    }
  })
})

describe('phase 1 is provably a no-op', () => {
  /**
   * `build` is the one documented exception (migration 110): its
   * `SYSTEM_ENTITIES` seed value is already `isVisible: true` and it carries no
   * override here, so this exception is not currently exercised — it exists so
   * a future edit to either side fails loudly here rather than silently.
   */
  const DOCUMENTED_EXCEPTIONS = new Set([
    'build',
    // The two defs this change deliberately surfaces. Safe only because
    // `apps/web/src/app/(protected)/app/{shipments,parcels}/` now exist -
    // migration 110 warns a visible def with no route folder 404s its nav
    // entry. See plans/entity/system-entity-behavior-map.md §5.3.
    'shipment',
    'parcel',
  ])

  it.each(
    SYSTEM_ENTITIES.map((e) => e.entityType)
  )('%s: sidebar !== "never" matches today\'s isVisible', (entityType) => {
    const entity = SYSTEM_ENTITIES.find((e) => e.entityType === entityType)!
    const todaysIsVisible = entity.isVisible ?? true
    const newSidebarVisible = resolveSystemEntityBehavior(entityType).sidebar !== 'never'

    if (DOCUMENTED_EXCEPTIONS.has(entityType)) {
      // Exception acknowledged — no assertion either way.
      return
    }
    expect(newSidebarVisible, entityType).toBe(todaysIsVisible)
  })
})

describe('custom (user-authored) defs take pure DEFAULTS', () => {
  /** `creatable` is not in DEFAULTS: it derives from `sidebar`, which is 'on'. */
  const CUSTOM_DEF_BEHAVIOR = { ...DEFAULTS, creatable: true }

  it('resolves undefined to DEFAULTS', () => {
    expect(resolveSystemEntityBehavior(undefined)).toEqual(CUSTOM_DEF_BEHAVIOR)
  })

  it('resolves null to DEFAULTS', () => {
    expect(resolveSystemEntityBehavior(null)).toEqual(CUSTOM_DEF_BEHAVIOR)
  })
})

describe('creatable derives from sidebar, and an override wins', () => {
  it('is false for a structural def, matching what isVisible gated before', () => {
    expect(resolveSystemEntityBehavior('gl_account').creatable).toBe(false)
    expect(resolveSystemEntityBehavior('line_item').creatable).toBe(false)
  })

  it('is true for a sidebar def', () => {
    expect(resolveSystemEntityBehavior('contact').creatable).toBe(true)
    expect(resolveSystemEntityBehavior('shipment').creatable).toBe(true)
  })

  it('honours an explicit override against the derivation', () => {
    // `parcel` is sidebar 'off' (would derive true) but is carrier-minted.
    // plans/entity/system-entity-behavior-map.md §6b.
    expect(resolveSystemEntityBehavior('parcel').sidebar).toBe('off')
    expect(resolveSystemEntityBehavior('parcel').creatable).toBe(false)
  })
})

describe('fieldsSettings reproduces HIDDEN_ENTITY_TYPES', () => {
  it('is false for exactly the seven defs that list hid', () => {
    const hidden = Object.entries(SYSTEM_ENTITY_BEHAVIOR)
      .filter(([, b]) => b.fieldsSettings === false)
      .map(([k]) => k)
      .sort()
    expect(hidden).toEqual([
      'entity_group',
      'inbox',
      'parcel',
      'personal_inbox',
      'shipment',
      'signature',
      'tag',
    ])
  })
})

describe('table-backed resources default restrictive', () => {
  /**
   * Regression guard. These are `NON_RECORD_DEF_SLUGS`: `canViewEntity` is an
   * unconditional pass-through for every one, so there is no def-level gate
   * underneath. They were AI-invisible before this change only because
   * `toSystemResourceBase` hardcoded `isVisible: false`; resolving them through
   * the permissive DEFAULTS would have newly advertised them to the model.
   * See plans/entity/system-entity-behavior-map.md §4.3.
   */
  it.each([
    'dataset',
    'dashboard',
    'workflow',
    'kb',
    'sequence',
    'message',
    'user',
  ])('%s is not AI-reachable, searchable or creatable', (tableId) => {
    const b = resolveTableBackedBehavior(tableId)
    expect(b.aiVisible, tableId).toBe(false)
    expect(b.searchable, tableId).toBe(false)
    expect(b.creatable, tableId).toBe(false)
    expect(b.sidebar, tableId).toBe('never')
  })

  it('an entry in the map still opts a table-backed resource in', () => {
    // `thread` has an entry; it stays off, but via its own row rather than the
    // base, and `isAiBlockedResource` enforces it independently regardless.
    expect(resolveTableBackedBehavior('thread').aiVisible).toBe(false)
  })

  it('the def-backed resolver stays permissive for a custom def', () => {
    // The two resolvers must not be confused: a user-authored def is reachable.
    expect(resolveSystemEntityBehavior(undefined).aiVisible).toBe(true)
  })
})
