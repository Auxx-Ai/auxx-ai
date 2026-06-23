// apps/web/src/components/fields/connector-lock-badge.tsx

'use client'

import { cn } from '@auxx/ui/lib/utils'
import { Lock, RefreshCw } from 'lucide-react'
import { Tooltip } from '~/components/global/tooltip'
import { useConnectorName } from '~/components/resources/hooks/use-connector-name'

interface ConnectorLockBadgeProps {
  /** Owning / contributing DataConnector id. */
  connectorId: string
  /**
   * `owned` → the field/column is hard read-only (managed by the connector).
   * `contributing` → the cell is still editable but synced; it may be
   * overwritten on the next sync.
   */
  mode: 'owned' | 'contributing'
  className?: string
}

/**
 * Inline ownership indicator for data-connector-managed fields/cells.
 *
 * - `owned`: a small lock icon with "Managed by <connector>" — the column is
 *   read-only (provisioning already set `isUpdatable=false`).
 * - `contributing`: a small sync icon with "Synced by <connector> — may be
 *   overwritten on the next sync" — the cell stays editable (badge only, no gate).
 *
 * The connector name resolves from the org-scoped connector list (deduped).
 * Renders a generic label until the name loads / if it can't be resolved.
 */
export function ConnectorLockBadge({ connectorId, mode, className }: ConnectorLockBadgeProps) {
  const name = useConnectorName(connectorId)
  const who = name ?? 'a data connector'

  const Icon = mode === 'owned' ? Lock : RefreshCw
  const content =
    mode === 'owned'
      ? `Managed by ${who}`
      : `Synced by ${who} — may be overwritten on the next sync`

  return (
    <Tooltip content={content} side='top'>
      <Icon
        className={cn(
          'size-3 shrink-0',
          mode === 'owned' ? 'text-neutral-400' : 'text-blue-400',
          className
        )}
        aria-label={content}
      />
    </Tooltip>
  )
}
