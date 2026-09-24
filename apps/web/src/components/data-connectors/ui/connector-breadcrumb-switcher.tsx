// apps/web/src/components/data-connectors/ui/connector-breadcrumb-switcher.tsx
'use client'

import { useRouter } from 'next/navigation'
import type React from 'react'
import { useMemo } from 'react'
import { EntityBreadcrumbSwitcher, type EntitySwitcherItem } from '~/components/pickers'
import { api } from '~/trpc/react'
import { selectIsDirty, useConnectorDraftStore } from '../stores/connector-draft-store'
import { ConnectorGlyph } from './connector-card'
import { asConnectorStatus, ConnectorStatusDot } from './connector-status'

interface ConnectorBreadcrumbSwitcherProps {
  /** The connector currently open — highlighted in the list. */
  activeConnectorId: string
  /** Trigger label — the active connector's name. */
  activeLabel: React.ReactNode
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
}: ConnectorBreadcrumbSwitcherProps) {
  const router = useRouter()
  const { data, isLoading } = api.dataConnector.list.useQuery(undefined, { staleTime: 30_000 })

  // Only guard edits that a navigation would actually lose: the draft must be
  // seeded for THIS connector, and autosave must be off — the same condition
  // that gates the `beforeunload` listener in `use-connector-draft-sync.ts`.
  const draftSeeded = useConnectorDraftStore((s) => s.connectorId === activeConnectorId)
  const draftDirty = useConnectorDraftStore(selectIsDirty)
  const autoSave = useConnectorDraftStore((s) => s.autoSave)
  const isDirty = draftSeeded && draftDirty && !autoSave

  const items = useMemo<EntitySwitcherItem[]>(
    () =>
      (data ?? []).map((connector) => ({
        id: connector.id,
        label: connector.name,
        href: `/app/connectors/${connector.id}`,
        icon: <ConnectorGlyph icon={connector.icon} size='xs' />,
        secondary: <ConnectorStatusDot status={asConnectorStatus(connector.status)} />,
      })),
    [data]
  )

  return (
    <EntityBreadcrumbSwitcher
      activeLabel={activeLabel}
      activeIcon={
        <ConnectorGlyph icon={data?.find((c) => c.id === activeConnectorId)?.icon} size='xs' />
      }
      items={items}
      activeId={activeConnectorId}
      isLoading={isLoading}
      nav={{
        isDirty,
        orphanLabel: 'Connectors',
        confirmOptions: {
          description: 'This connector has unsaved changes. Leaving now will discard them.',
        },
      }}
      searchPlaceholder='Search connectors...'
      emptyText='No connectors'
      onSelect={(item) => router.push(item.href ?? '/app/connectors')}
    />
  )
}
