// apps/homepage/src/app/platform/ai/agents/_mocks/mock-agent-card.tsx

import { MessageCircle } from 'lucide-react'
import Image from 'next/image'
import { cn } from '~/lib/utils'
import type { AgentCastMember } from '../_components/agent-cast'

/**
 * Visual port of `packages/ui/src/components/list-card.tsx` in its default
 * (vertical tile) layout, as `apps/web/src/components/agents/ui/list/agent-card.tsx`
 * composes it: avatar media with a status dot, title + `LastUpdated` subtitle,
 * a one-line description, and a footer of model / kind badges.
 *
 * The app's `primary-*` scale is a zinc ramp (`packages/ui/src/styles/global.css`)
 * and the homepage has no such tokens, so the equivalent zinc values are written
 * out here rather than imported.
 */
export function MockAgentCard({ agent }: { agent: AgentCastMember }) {
  return (
    <div className='group relative flex w-full flex-col gap-2 rounded-2xl border bg-mock-window p-3 text-left'>
      {/* Header: media + heading */}
      <div className='flex w-full flex-row items-start gap-2'>
        <div className='relative shrink-0'>
          <span className='relative flex size-8 items-center justify-center overflow-hidden rounded-xl border'>
            <Image
              src={agent.src}
              alt=''
              fill
              sizes='32px'
              style={{ objectFit: 'cover', objectPosition: agent.headOffset }}
            />
          </span>
          {/* ListCard status dot: `-right-0.5 -top-0.5 size-2.5 border-2`. */}
          <div className='absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-mock-window bg-emerald-500' />
        </div>

        <div className='flex min-w-0 flex-1 flex-col'>
          <p className='line-clamp-1 text-sm font-semibold text-mock-window-foreground'>
            {agent.name}
          </p>
          <div className='text-xs text-mock-window-muted'>{agent.updated}</div>
        </div>
      </div>

      <p className='line-clamp-1 min-h-4 text-sm text-mock-window-muted'>{agent.description}</p>

      {/* Footer badges: model pill + Chat badge, mirroring `agent-card.tsx`. */}
      <div className='mt-auto flex min-h-6 items-center gap-1'>
        <MockBadge variant='pill'>{agent.model}</MockBadge>
        {agent.kind === 'chat' && (
          <MockBadge variant='outline'>
            <MessageCircle className='size-3' />
            Chat
          </MockBadge>
        )}
      </div>
    </div>
  )
}

/** `packages/ui/src/components/badge.tsx`, `size='sm'`, pill + outline variants. */
function MockBadge({
  variant,
  children,
}: {
  variant: 'pill' | 'outline'
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-[1px] text-xs font-normal',
        variant === 'pill'
          ? 'bg-neutral-100 text-neutral-600 ring-1 ring-neutral-300 dark:bg-mock-bubble dark:text-neutral-100 dark:ring-transparent'
          : 'text-mock-window-foreground ring-1 ring-mock-window-border'
      )}>
      {children}
    </span>
  )
}
