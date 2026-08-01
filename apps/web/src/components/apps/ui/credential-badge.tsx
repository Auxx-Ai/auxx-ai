// apps/web/src/components/apps/ui/credential-badge.tsx
'use client'

import { cn } from '@auxx/ui/lib/utils'
import {
  type BoundCredentialStatus,
  useBoundCredential,
} from '~/components/apps/hooks/use-bound-credential'
import { Tooltip } from '~/components/global/tooltip'
import { appConnectionStatusOptions } from './app-with-status-icon'

interface CredentialBadgeProps {
  credId: string | undefined | null
  /** Optional handler — when the badge is in a clickable state we route to it (re-pick / connect). */
  onPick?: () => void
}

/**
 * Inline summary of the credential an agent is bound to for one app.
 * Rendered in the catalog row's `secondary` slot next to the tool count.
 *
 * Status mapping mirrors `useBoundCredential` — connected (green +
 * label), expired (amber + label), unbound/gone/not_connected (amber/red +
 * "Not set"/"Disconnected"). See
 * plans/kopilot/apps/agent-credentials.md §5.2.
 */
export function CredentialBadge({ credId, onPick }: CredentialBadgeProps) {
  const bound = useBoundCredential(credId)
  const { status } = bound
  const textColor = appConnectionStatusOptions[status].textColor ?? 'text-muted-foreground'

  const label = renderLabel(bound.status, bound.label)
  const tooltip = renderTooltip(bound)

  const interactive = status !== 'connected' && onPick
  const node = (
    <span
      className={cn(
        'inline-flex items-center gap-1 text-[11px]',
        interactive && 'cursor-pointer hover:text-foreground'
      )}
      onClick={
        interactive
          ? (e) => {
              e.stopPropagation()
              onPick()
            }
          : undefined
      }>
      {/* <span className={cn('inline-block size-1.5 rounded-full', dotColor)} /> */}
      <span
        className={cn(
          'text-sm  truncate max-w-[160px]',
          textColor,
          interactive && 'hover:underline'
        )}>
        {label}
      </span>
    </span>
  )

  if (!tooltip) return node
  return (
    <Tooltip content={tooltip} side='top' allowInteraction={Boolean(interactive)}>
      {node}
    </Tooltip>
  )
}

function renderLabel(status: BoundCredentialStatus, label: string | null): string {
  switch (status) {
    case 'connected':
      return label ?? 'Connected'
    case 'expired':
      return 'Expired'
    case 'gone':
    case 'not_connected':
      return 'Disconnected'
    case 'unbound':
      return 'Make connection'
  }
}

function renderTooltip(bound: ReturnType<typeof useBoundCredential>): string | null {
  const { status, label, scope, connectedBy, connection } = bound
  if (status === 'unbound') return 'No account picked yet — click to choose one.'
  if (status === 'gone') return 'The selected account was removed. Pick a new one.'
  if (!label) return null
  const parts: string[] = [label]
  if (scope) parts.push(scope === 'workspace' ? 'Workspace' : 'Personal')
  if (scope === 'personal' && connectedBy) parts.push(`Connected by ${connectedBy}`)
  if (status === 'expired' && connection?.expiresAt) {
    parts.push(`Expired ${new Date(connection.expiresAt).toLocaleDateString()}`)
  }
  return parts.join(' · ')
}
