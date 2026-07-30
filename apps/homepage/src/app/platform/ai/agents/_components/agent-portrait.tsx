// apps/homepage/src/app/platform/ai/agents/_components/agent-portrait.tsx

import Image from 'next/image'
import { cn } from '~/lib/utils'
import type { AgentCastMember } from './agent-cast'

interface AgentPortraitProps {
  agent: AgentCastMember
  /** Rendered diameter in px. Also drives the `sizes` hint. */
  size: number
  /** Draw the accent ring (used for the active chip and reply avatars). */
  ring?: boolean
  className?: string
}

/**
 * The shared cropped-circle avatar.
 *
 * The sources are waist-up watercolour portraits on transparent backgrounds, so
 * a square container plus `object-cover` and a per-agent `object-position`
 * (see `headOffset` in `agent-cast.ts`) is what lands the head in the circle.
 * Decorative everywhere it is used: the adjacent text always carries the name.
 */
export function AgentPortrait({ agent, size, ring = false, className }: AgentPortraitProps) {
  return (
    <span
      aria-hidden
      style={{ width: size, height: size }}
      className={cn(
        'relative inline-block shrink-0 overflow-hidden rounded-full bg-muted/70',
        ring && cn('ring-2', agent.accent.ring),
        className
      )}>
      <Image
        src={agent.src}
        alt=''
        fill
        sizes={`${size}px`}
        style={{ objectFit: 'cover', objectPosition: agent.headOffset }}
      />
    </span>
  )
}

/**
 * The roster-card portrait: a taller head-and-shoulders crop with a blurred
 * accent wash behind it, so the cut-out reads as placed rather than floating.
 */
export function AgentPortraitCard({
  agent,
  className,
}: {
  agent: AgentCastMember
  className?: string
}) {
  return (
    <div className={cn('relative mx-auto aspect-[4/5] w-full max-w-[168px]', className)}>
      <div
        aria-hidden
        className={cn(
          'absolute left-1/2 top-[18%] size-[76%] -translate-x-1/2 rounded-full blur-2xl',
          agent.accent.wash
        )}
      />
      <Image
        src={agent.src}
        alt={agent.alt}
        fill
        sizes='(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 168px'
        style={{ objectFit: 'cover', objectPosition: '50% 8%' }}
        className='relative [mask-image:linear-gradient(to_bottom,black_78%,transparent_100%)]'
      />
    </div>
  )
}
