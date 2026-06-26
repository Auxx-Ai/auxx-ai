// apps/web/src/components/webhooks/ui/webhook-placeholder-card.tsx
'use client'

import { ListCard } from '@auxx/ui/components/list-card'
import type { ReactNode } from 'react'

/**
 * Empty-state card matching the `ListCard` shape, dashed to read as a placeholder +
 * add affordance. Mirrors the MCP section's `ConnectPlaceholderCard`
 * (`~/components/mcp/ui/mcp-apps-section`) so the webhooks grid reads the same when empty.
 */
export function WebhookPlaceholderCard({
  icon,
  title,
  subtitle,
  description,
  onClick,
}: {
  icon: ReactNode
  title: ReactNode
  subtitle: string
  description: string
  onClick: () => void
}) {
  return (
    <ListCard
      variant='placeholder'
      classNames={{ icon: 'border-dashed' }}
      icon={icon}
      title={title}
      subtitle={subtitle}
      description={description}
      onClick={onClick}
    />
  )
}
