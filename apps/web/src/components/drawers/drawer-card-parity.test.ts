// apps/web/src/components/drawers/drawer-card-parity.test.ts

// Pins the silent-failure trap plans/purchasing/02-handoff.md §6 names twice: a card
// declared in `drawer-config.ts` / `detail-view-config.ts` with no component in
// `DRAWER_TAB_CARD_COMPONENTS` renders NOTHING — `base-entity-drawer.tsx` is
// `if (!componentLoader) return null`, with no error, no placeholder and no warning.
// Six cards were declared ahead of their components during the purchasing build and
// had to be trimmed back out; this is that review step, automated.
//
// A `records` block has the same failure mode with a different resolver: it names no
// component at all, so what has to resolve is its TARGET: the definition it lists,
// the forward field pointing back at the host, its sort column and its status
// attribute. Every one of those is a plain string in the registry, and every one of
// them fails silently: an unknown `hostFieldId` is DROPPED by the condition compiler
// and the section then lists the whole definition, and an unknown `statusAttr`
// simply renders no badge. Those checks are the second half of this file.
//
// Key-set only for cards: the registry's values are dynamic `import()`s of .tsx
// modules and this never calls them, so the assertion costs nothing and pulls in no
// components.

import { RESOURCE_FIELD_REGISTRY } from '@auxx/lib/resources'
import {
  DETAIL_VIEW_CONFIG_REGISTRY,
  DRAWER_CONFIG_REGISTRY,
  type LayoutBlock,
  type RecordsBlock,
} from '@auxx/lib/resources/client'
import { describe, expect, it } from 'vitest'
import { DRAWER_TAB_CARD_COMPONENTS, DRAWER_TAB_COMPONENTS } from './drawer-tab-registry'

/** Every `entityType:cardValue` a drawer's tabCards declare. */
function declaredDrawerCardKeys(): string[] {
  const keys: string[] = []
  for (const config of Object.values(DRAWER_CONFIG_REGISTRY)) {
    for (const [, cards] of Object.entries(config.tabCards ?? {})) {
      for (const card of cards ?? []) keys.push(`${config.entityType}:${card.value}`)
    }
  }
  return keys
}

/** Every `entityType:cardValue` a detail view's sidebar declares. */
function declaredSidebarCardKeys(): string[] {
  const keys: string[] = []
  for (const config of Object.values(DETAIL_VIEW_CONFIG_REGISTRY)) {
    for (const card of config.sidebarCards ?? []) keys.push(`${config.entityType}:${card.value}`)
  }
  return keys
}

/** One declared block, with the host entity type and tab it was declared on. */
interface DeclaredBlock {
  surface: 'drawer' | 'detail'
  entityType: string
  tabId: string
  block: LayoutBlock
}

/** Every block both registries declare through `tabBlocks`. */
function declaredBlocks(): DeclaredBlock[] {
  const declared: DeclaredBlock[] = []
  for (const config of Object.values(DRAWER_CONFIG_REGISTRY)) {
    for (const [tabId, blocks] of Object.entries(config.tabBlocks ?? {})) {
      for (const block of blocks ?? [])
        declared.push({ surface: 'drawer', entityType: config.entityType, tabId, block })
    }
  }
  for (const config of Object.values(DETAIL_VIEW_CONFIG_REGISTRY)) {
    for (const [tabId, blocks] of Object.entries(config.tabBlocks ?? {})) {
      for (const block of blocks ?? [])
        declared.push({ surface: 'detail', entityType: config.entityType, tabId, block })
    }
  }
  return declared
}

/** The `records` blocks among them, which are the ones with targets to resolve. */
function declaredRecordsBlocks(): Array<DeclaredBlock & { block: RecordsBlock }> {
  return declaredBlocks().filter(
    (d): d is DeclaredBlock & { block: RecordsBlock } => d.block.kind === 'records'
  )
}

/** Registry fields of a system definition, or `undefined` for an unknown slug. */
function fieldsOf(definition: string) {
  return (RESOURCE_FIELD_REGISTRY as Record<string, Record<string, ResourceFieldLike>>)[definition]
}

/** The bits of a registry field this file reads. */
interface ResourceFieldLike {
  key: string
  systemAttribute?: string
  capabilities: { filterable?: boolean; sortable?: boolean }
}

/** Every `systemAttribute` declared anywhere in the registry. */
const ALL_SYSTEM_ATTRIBUTES = new Set(
  Object.values(RESOURCE_FIELD_REGISTRY as Record<string, Record<string, ResourceFieldLike>>)
    .flatMap((fields) => Object.values(fields))
    .map((field) => field.systemAttribute)
    .filter((attr): attr is string => typeof attr === 'string')
)

describe('drawer card declarations', () => {
  // Non-vacuity guard: both walks read a nested config shape, so a shape change that
  // silently yielded zero keys would make every assertion below pass while checking
  // nothing. These floors are well under the current counts, not a snapshot.
  it('actually walks the configs', () => {
    expect(declaredDrawerCardKeys().length).toBeGreaterThan(10)
    expect(declaredSidebarCardKeys().length).toBeGreaterThan(5)
  })

  it('every drawer tabCard has a registered component', () => {
    const missing = declaredDrawerCardKeys().filter((key) => !DRAWER_TAB_CARD_COMPONENTS[key])
    expect(missing).toEqual([])
  })

  it('every detail-view sidebarCard has a registered component', () => {
    // The sidebar reads the SAME card registry as the drawer (detail-view-sidebar.tsx),
    // so a card declared for a detail page resolves against these keys too.
    const missing = declaredSidebarCardKeys().filter((key) => !DRAWER_TAB_CARD_COMPONENTS[key])
    expect(missing).toEqual([])
  })

  it('every drawer additionalTab has a registered component', () => {
    const missing: string[] = []
    for (const config of Object.values(DRAWER_CONFIG_REGISTRY)) {
      for (const tab of config.additionalTabs ?? []) {
        // A tab that IS its blocks (`hasOwnComponent: false`) has no component
        // to register, by design, and `base-entity-drawer.tsx` never calls
        // `getTabComponent` for it. Its blocks are checked below instead.
        if (tab.hasOwnComponent === false) continue
        const key = `${config.entityType}:${tab.value}`
        if (!DRAWER_TAB_COMPONENTS[key]) missing.push(key)
      }
    }
    expect(missing).toEqual([])
  })

  it('declares the purchasing cards that close the unreachable-field gaps', () => {
    // `purchase_order_bills` and the quantityReceived roll-up are both
    // `showInPanel: false` / computed, so these cards are their only surface.
    for (const key of [
      'purchase_order:vendor',
      'purchase_order:receiving',
      'purchase_order:bills',
      'vendor_bill:vendor',
      'vendor_bill:payment',
    ]) {
      expect(DRAWER_TAB_CARD_COMPONENTS[key], key).toBeDefined()
    }
  })
})

describe('registry layout blocks', () => {
  it('actually walks the configs', () => {
    // Purchasing (3 sections) + Billing (4), on two surfaces each.
    expect(declaredRecordsBlocks().length).toBeGreaterThanOrEqual(14)
  })

  it('every declared block carries a unique id per tab', () => {
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const { surface, entityType, tabId, block } of declaredBlocks()) {
      const key = `${surface}:${entityType}:${tabId}:${block.id}`
      if (seen.has(key)) duplicates.push(key)
      seen.add(key)
    }
    expect(duplicates).toEqual([])
  })

  it('every records block gates on the definition it lists', () => {
    // §7: a block that is purely another definition's records gates on that
    // definition's read level, or it leaks counts to a viewer who cannot open a
    // single row.
    const ungated = declaredRecordsBlocks()
      .filter(({ block }) => !block.recordResource)
      .map(({ entityType, block }) => `${entityType}:${block.id}`)
    expect(ungated).toEqual([])
  })

  it('every records block resolves its source', () => {
    const unresolved: string[] = []
    for (const { entityType, block } of declaredRecordsBlocks()) {
      const where = `${entityType}:${block.id}`
      const { source } = block.config

      if (source.kind === 'relation') {
        // The mirror is read off the HOST record, so the attribute has to be a
        // real system attribute, because a typo reads an absent value and the section
        // renders permanently empty.
        if (!ALL_SYSTEM_ATTRIBUTES.has(source.relationAttr)) {
          unresolved.push(`${where}: unknown relationAttr ${source.relationAttr}`)
        }
        continue
      }

      const fields = fieldsOf(source.definition)
      if (!fields) {
        unresolved.push(`${where}: unknown definition ${source.definition}`)
        continue
      }

      // `hostFieldId` is the filter's left-hand side in `def:field` form. A
      // condition naming a field the compiler cannot resolve is DROPPED, not
      // rejected, so a wrong value here lists the entire definition rather than
      // this record's rows.
      const [definitionSlug, fieldKey] = source.hostFieldId.split(':')
      if (definitionSlug !== source.definition) {
        unresolved.push(
          `${where}: hostFieldId ${source.hostFieldId} is not on ${source.definition}`
        )
      }
      const hostField = fieldKey ? fields[fieldKey] : undefined
      if (!hostField) {
        unresolved.push(`${where}: unknown hostFieldId ${source.hostFieldId}`)
      } else if (!hostField.capabilities.filterable) {
        unresolved.push(`${where}: hostFieldId ${source.hostFieldId} is not filterable`)
      }

      // An unsortable sort column falls back to `createdAt DESC` silently, which
      // is precisely the "the list shuffled itself" symptom.
      const sortField = source.sort ? fields[source.sort.fieldId] : undefined
      if (source.sort && !sortField) {
        unresolved.push(`${where}: unknown sort field ${source.sort.fieldId}`)
      } else if (sortField && !sortField.capabilities.sortable) {
        unresolved.push(`${where}: sort field ${source.sort?.fieldId} is not sortable`)
      }

      // The badge attribute belongs to the TARGET, not the host.
      if (block.config.statusAttr) {
        const hasStatus = Object.values(fields).some(
          (field) => field.systemAttribute === block.config.statusAttr
        )
        if (!hasStatus) {
          unresolved.push(
            `${where}: statusAttr ${block.config.statusAttr} is not on ${source.definition}`
          )
        }
      }
    }
    expect(unresolved).toEqual([])
  })

  it('a records block bounds its own fan-out', () => {
    // Every rendered row fires its own record/resource/value/field queries and a
    // `query` page size is not a render cap, so an unbounded section is four
    // figures of queries from one drawer open (§10).
    const unbounded = declaredRecordsBlocks()
      .filter(({ block }) => !block.config.visibleLimit)
      .map(({ entityType, block }) => `${entityType}:${block.id}`)
    expect(unbounded).toEqual([])
  })

  it('the drawer and the detail view declare the same blocks', () => {
    // §10's top risk. A block shipped on one surface only is exactly how
    // `DRAWER_CONFIG_REGISTRY` and `DETAIL_VIEW_CONFIG_REGISTRY` drift, and it
    // is invisible until somebody opens the other surface.
    const byEntityType = (surface: 'drawer' | 'detail') => {
      const map = new Map<string, LayoutBlock[]>()
      for (const { surface: s, entityType, tabId, block } of declaredBlocks()) {
        if (s !== surface) continue
        const key = `${entityType}:${tabId}`
        map.set(key, [...(map.get(key) ?? []), block])
      }
      return map
    }

    const drawer = byEntityType('drawer')
    const detail = byEntityType('detail')

    // Only entity types the detail registry actually knows about are compared:
    // a drawer-only entity (invoice, vendor_bill) has no page to keep in step.
    const detailEntityTypes = new Set(
      Object.values(DETAIL_VIEW_CONFIG_REGISTRY).map((config) => config.entityType)
    )

    const mismatched: string[] = []
    for (const [key, blocks] of drawer) {
      const entityType = key.split(':')[0] as string
      if (!detailEntityTypes.has(entityType)) continue
      expect(detail.get(key), `${key} is missing from the detail view`).toBeDefined()
      if (JSON.stringify(detail.get(key)) !== JSON.stringify(blocks)) mismatched.push(key)
    }
    for (const key of detail.keys()) {
      if (!drawer.has(key)) mismatched.push(`${key} is missing from the drawer`)
    }
    expect(mismatched).toEqual([])
  })

  it('declares Purchasing on company and Billing on contact', () => {
    // The forcing function (§4). Different labels because they are opposite
    // ledgers: a company is accounts payable, a contact accounts receivable.
    const drawerTab = (entityType: 'company' | 'contact', value: string) =>
      DRAWER_CONFIG_REGISTRY[entityType]?.additionalTabs.find((tab) => tab.value === value)

    expect(drawerTab('company', 'purchasing')?.label).toBe('Purchasing')
    expect(drawerTab('contact', 'billing')?.label).toBe('Billing')

    const sectionLabels = (entityType: string, tabId: string) =>
      declaredBlocks()
        .filter((d) => d.surface === 'drawer' && d.entityType === entityType && d.tabId === tabId)
        .map((d) => d.block.label)

    expect(sectionLabels('company', 'purchasing')).toEqual([
      'Purchase orders',
      'Vendor bills',
      'Work orders',
    ])
    expect(sectionLabels('contact', 'billing')).toEqual([
      'Quotes',
      'Invoices',
      'Work orders',
      'Purchase orders',
    ])
  })
})
