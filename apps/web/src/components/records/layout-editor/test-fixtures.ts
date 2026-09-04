// apps/web/src/components/records/layout-editor/test-fixtures.ts

import { buildRegistryLayout, type ResolvedLayout } from '@auxx/lib/record-layout/client'

/**
 * A realistic registry default to diff against.
 *
 * Built with the real `buildRegistryLayout` rather than hand-written, so a
 * change to the registry layer's shape breaks these tests instead of letting
 * them keep asserting against a fossil.
 *
 * Yields: Overview (`card:customer`, `core:details`, `card:relationships`),
 * Billing (`card:invoices`), then Timeline / Comments / Tasks.
 */
export function testRegistry(): ResolvedLayout {
  return buildRegistryLayout({
    surface: 'drawer',
    entityType: 'contact',
    drawerConfig: {
      entityType: 'contact',
      additionalTabs: [{ value: 'billing', label: 'Billing', icon: 'credit-card' }],
      tabCards: {
        overview: [
          { value: 'customer', label: 'Customer', icon: 'user', position: 'before' },
          { value: 'relationships', label: 'Related', icon: 'ticket' },
        ],
        billing: [
          {
            value: 'invoices',
            label: 'Invoices',
            icon: 'receipt',
            permissionKey: 'billing.view',
          },
        ],
      },
    },
  })
}
