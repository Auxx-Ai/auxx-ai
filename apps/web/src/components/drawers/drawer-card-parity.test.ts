// apps/web/src/components/drawers/drawer-card-parity.test.ts

// Pins the silent-failure trap plans/purchasing/02-handoff.md §6 names twice: a card
// declared in `drawer-config.ts` / `detail-view-config.ts` with no component in
// `DRAWER_TAB_CARD_COMPONENTS` renders NOTHING — `base-entity-drawer.tsx` is
// `if (!componentLoader) return null`, with no error, no placeholder and no warning.
// Six cards were declared ahead of their components during the purchasing build and
// had to be trimmed back out; this is that review step, automated.
//
// Key-set only: the registry's values are dynamic `import()`s of .tsx modules and
// this never calls them, so the assertion costs nothing and pulls in no components.

import { DETAIL_VIEW_CONFIG_REGISTRY, DRAWER_CONFIG_REGISTRY } from '@auxx/lib/resources/client'
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
