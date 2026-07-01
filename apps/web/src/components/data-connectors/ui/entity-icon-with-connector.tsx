// apps/web/src/components/data-connectors/ui/entity-icon-with-connector.tsx
'use client'

import { EntityIcon, type EntityIconProps } from '@auxx/ui/components/icons'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { RefreshCw } from 'lucide-react'
import { useRouter } from 'next/navigation'

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
  /**
   * When set, the badge becomes a clickable target that routes to the connector
   * (e.g. `/app/connectors/{id}`). Rendered as a `<button>` — not a `<Link>` —
   * because the badge sits inside the sidebar row's `<Link>`, and nesting an
   * anchor inside an anchor is invalid HTML. The handler stops propagation so
   * the row's own navigation doesn't also fire. Omit to keep the badge a plain
   * indicator (e.g. in sidebar edit mode).
   */
  connectorHref?: string
}

/**
 * `EntityIcon` with an optional connector-sync badge — the entity-level analog
 * of `AppWithStatusIcon`. Renders a bare `EntityIcon` when not connector-owned.
 * When `connectorHref` is provided the badge is clickable and routes there.
 */
export function EntityIconWithConnector({
  dataConnectorId,
  tooltip,
  connectorHref,
  ...iconProps
}: EntityIconWithConnectorProps) {
  const router = useRouter()
  if (!dataConnectorId) return <EntityIcon {...iconProps} />

  const badgeClassName =
    'absolute -right-0.5 -bottom-0.5 inline-flex size-2.5 items-center justify-center rounded-full bg-background ring-1 ring-background'

  return (
    <SimpleTooltip content={tooltip ?? 'Synced by a data connector'} side='right'>
      <span className='relative inline-flex shrink-0'>
        <EntityIcon {...iconProps} />
        {connectorHref ? (
          <button
            type='button'
            aria-label='Open data connector'
            onClick={(e) => {
              e.stopPropagation()
              e.preventDefault()
              router.push(connectorHref)
            }}
            className={`${badgeClassName} hover:text-foreground`}>
            <RefreshCw className='size-2! text-muted-foreground' />
          </button>
        ) : (
          <span className={badgeClassName}>
            <RefreshCw className='size-2! text-muted-foreground' />
          </span>
        )}
      </span>
    </SimpleTooltip>
  )
}
