// apps/web/src/components/data-connectors/ui/mapping-connector-context.tsx
'use client'

import { createContext, type ReactNode, useContext } from 'react'
import type { DraftMapping } from '../stores/connector-draft-store'

/**
 * Cross-cutting, read-only display facts the mapping tree needs but shouldn't drill
 * through every recursive `SourceNode`: whether the connector is app-backed and the
 * app's display label. Consumed by `MappingNode` (the app-managed External ID
 * indicator) and, transitively, the per-leaf/per-formula identity controls.
 */
export interface MappingConnectorContextValue {
  /** The connector is app-backed (`definitionKind === 'app'`). */
  isAppConnector: boolean
  /** The app's display title (e.g. "Shopify"); null when unresolved. */
  appLabel: string | null
}

const MappingConnectorContext = createContext<MappingConnectorContextValue>({
  isAppConnector: false,
  appLabel: null,
})

export function MappingConnectorProvider({
  value,
  children,
}: {
  value: MappingConnectorContextValue
  children: ReactNode
}) {
  return (
    <MappingConnectorContext.Provider value={value}>{children}</MappingConnectorContext.Provider>
  )
}

export function useMappingConnector(): MappingConnectorContextValue {
  return useContext(MappingConnectorContext)
}

/**
 * Every OWNED mapping of an app connector carries a connector-declared External ID: the
 * app supplies each owned record's stable id as a real column (e.g. Shopify's `id` →
 * "Shopify Order ID"), and the seeder stamps `identityRole: externalId` on that field's
 * mapping. So — at ANY depth (order root, line-item child) — the editor marks that leaf's
 * External ID as connector-managed (blue, locked) and suppresses the "External ID" option
 * on every other owned leaf, so the user can't designate a competing one that would
 * silently override the app's record identity. Contributing branches (customer → contact,
 * whose id is multi-source) are NOT managed here — Phase 2 (v7) handles those.
 */
export function isAppOwnedManaged(
  isAppConnector: boolean,
  mapping: Pick<DraftMapping, 'targetMode'>
): boolean {
  return isAppConnector && mapping.targetMode === 'owned'
}
