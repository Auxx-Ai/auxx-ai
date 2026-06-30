// apps/web/src/components/data-connectors/ui/entity-icon-with-connector.tsx
'use client'

import { EntityIcon, type EntityIconProps } from '@auxx/ui/components/icons'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { RefreshCw } from 'lucide-react'

interface EntityIconWithConnectorProps extends EntityIconProps {
  /**
   * Set when the entity definition is *owned* by a data connector (mirrors
   * `CustomResource.dataConnectorId`). When present, a small sync badge is
   * overlaid on the icon to signal the record type is connector-managed.
   * Contributing-only connectors tag individual fields, not the def, so they
   * intentionally don't surface here.
   */
  dataConnectorId?: string
  /** Tooltip copy for the badge. Defaults to a generic sync message. */
  tooltip?: string
}

/**
 * `EntityIcon` with an optional connector-sync badge — the entity-level analog
 * of `AppWithStatusIcon`. Renders a bare `EntityIcon` when not connector-owned.
 */
export function EntityIconWithConnector({
  dataConnectorId,
  tooltip,
  ...iconProps
}: EntityIconWithConnectorProps) {
  if (!dataConnectorId) return <EntityIcon {...iconProps} />

  return (
    <SimpleTooltip content={tooltip ?? 'Synced by a data connector'} side='right'>
      <span className='relative inline-flex shrink-0'>
        <EntityIcon {...iconProps} />
        <span className='absolute -right-0.5 -bottom-0.5 inline-flex size-2.5 items-center justify-center rounded-full bg-background ring-1 ring-background'>
          <RefreshCw className='size-2! text-muted-foreground' />
        </span>
      </span>
    </SimpleTooltip>
  )
}
