// apps/web/src/components/webhooks/ui/webhook-placeholder-card.tsx
'use client'

import type { ReactNode } from 'react'

/**
 * Empty-state card matching the `AppListCard` shape, dashed to read as a placeholder +
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
    <button
      type='button'
      onClick={onClick}
      className='rounded-2xl border border-dashed bg-primary-50 hover:bg-primary-50/50 hover:outline-5 hover:outline-primary-50 flex flex-col p-3 gap-2 text-left'>
      <div className='flex flex-row items-start gap-2'>
        <div className='size-8 rounded-xl border border-dashed flex items-center justify-center'>
          {icon}
        </div>
        <div className='flex flex-col'>
          <div className='text-sm font-semibold'>{title}</div>
          <div className='text-xs text-muted-foreground'>{subtitle}</div>
        </div>
      </div>
      <div className='text-sm text-muted-foreground line-clamp-2'>{description}</div>
    </button>
  )
}
