// apps/web/src/components/connections/ui/connection-stack-card.tsx
'use client'

import { ListCard, renderBadgeChips } from '@auxx/ui/components/list-card'
import { TriangleAlert } from 'lucide-react'
import { AppIcon } from '~/components/apps/ui/app-icon'
import type { ConnectionGroup } from './group-connections'

interface ConnectionStackCardProps {
  group: ConnectionGroup
  onToggle: () => void
}

/**
 * The collapsed face of a multi-connection group — an iPhone-wallet style stack. Built on the
 * shared {@link ListCard} so it matches every other tile, with 1–2 dimmer cards offset behind
 * the face (peeking at the bottom-right) to signal depth. The whole face toggles the section's
 * expanded panel; per-connection actions live on the expanded {@link ConnectionCard}s, not here.
 */
export function ConnectionStackCard({ group, onToggle }: ConnectionStackCardProps) {
  const hasExpired = group.expiredCount > 0
  // A second deck layer once there are 3+ connections; the exact count lives in the badge.
  const deepDeck = group.rows.length > 2

  return (
    <div className='relative'>
      {/* Deck: dimmer cards offset behind the face, peeking bottom-right. Decorative only. */}
      {deepDeck && (
        <div
          aria-hidden
          className='absolute inset-0 translate-x-[6px] translate-y-[6px] rounded-2xl border bg-primary-100/50'
        />
      )}
      <div
        aria-hidden
        className='absolute inset-0 translate-x-[3px] translate-y-[3px] rounded-2xl border bg-primary-100/70'
      />

      {/* The real face sits above the deck (ListCard is `w-full`, so it fills the column). */}
      <div className='relative'>
        <ListCard
          title={group.label}
          subtitle={`${group.rows.length} connections`}
          description={group.rows.map((r) => r.label ?? r.name).join(', ')}
          icon={<AppIcon iconId={group.iconId} size='sm' />}
          headerEnd={renderBadgeChips([
            ...(hasExpired
              ? [
                  {
                    label: 'Needs attention',
                    icon: <TriangleAlert className='size-3 text-amber-600' />,
                  },
                ]
              : []),
            { label: String(group.rows.length) },
          ])}
          onClick={onToggle}
        />
      </div>
    </div>
  )
}
