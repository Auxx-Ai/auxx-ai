// apps/chat-widget/src/ui/icon.tsx
//
// Light wrapper over `lucide-react` so call sites don't repeat sizing/stroke
// boilerplate and tree-shake picks up only the icons we actually use.

import type { LucideIcon, LucideProps } from 'lucide-react'
import { cn } from '~/lib/cn'

export interface IconProps extends LucideProps {
  icon: LucideIcon
}

export function Icon({ icon: LucideComponent, className, ...props }: IconProps) {
  return <LucideComponent className={cn('size-4 shrink-0', className)} {...props} />
}
