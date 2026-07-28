// apps/web/src/components/data-connectors/ui/connector-breadcrumb-switcher.tsx
'use client'

import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo } from 'react'
import { VisualIcon } from '~/components/icons/ui/visual-icon'
import { EntityBreadcrumbSwitcher, type EntitySwitcherItem } from '~/components/pickers'
import { api } from '~/trpc/react'
import { asConnectorStatus, ConnectorStatusDot } from './connector-status'

/** Default icon id for connectors without a brand (generic-rest, unknown types). */
const DEFAULT_CONNECTOR_ICON_ID = 'plug'

/** Derive a display icon id from the connector type (`app:<slug>` → brand). */
function iconIdForType(type: string): string {
  if (type.startsWith('app:')) return `brand:${type.slice('app:'.length)}`
  return DEFAULT_CONNECTOR_ICON_ID
}

/** The brand glyph for a connector type, sized for a breadcrumb / switcher row. */
function ConnectorGlyph({ type }: { type: string }) {
  return (
    <VisualIcon
      value={iconIdForType(type)}
      fallbackIconId={DEFAULT_CONNECTOR_ICON_ID}
      fit='contain'
      size='xs'
    />
  )
}

interface ConnectorBreadcrumbSwitcherProps {
  /** The connector currently open — highlighted in the list. */
  activeConnectorId: string
  /** Trigger label — the active connector's name. */
  activeLabel: React.ReactNode
  /** The active connector's `type`, used for the trigger's brand glyph. */
  activeType: string
}

/**
 * The connector switcher mounted in the connector detail breadcrumb — search
 * and jump across every connector in the organization, each row carrying its
 * sync status.
 *
 * Navigation only. There is no `onEdit` because a connector's settings surface
 * *is* this detail page (Connection / Streams / Schedule tabs), so a pencil
 * would just repeat the row click; and no `onDelete` because deleting a
 * connector requires choosing what happens to its synced records
 * (keep / archive / delete), which the switcher's single-confirm contract
 * cannot express — that choice stays on the card menu and the header split
 * button.
 */
export function ConnectorBreadcrumbSwitcher({
  activeConnectorId,
  activeLabel,
  activeType,
}: ConnectorBreadcrumbSwitcherProps) {
  const router = useRouter()
  const { data, isLoading } = api.dataConnector.list.useQuery(undefined, { staleTime: 30_000 })

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      (data ?? []).map((connector) => ({
        id: connector.id,
        label: connector.name,
        href: `/app/connectors/${connector.id}`,
        icon: <ConnectorGlyph type={connector.type} />,
        secondary: <ConnectorStatusDot status={asConnectorStatus(connector.status)} />,
      })),
    [data]
  )

  return (
    <EntityBreadcrumbSwitcher
      activeLabel={activeLabel}
      activeIcon={<ConnectorGlyph type={activeType} />}
      items={items}
      activeId={activeConnectorId}
      isLoading={isLoading}
      searchPlaceholder='Search connectors...'
      emptyText='No connectors'
      onSelect={(item) => router.push(item.href ?? '/app/connectors')}
    />
  )
}
