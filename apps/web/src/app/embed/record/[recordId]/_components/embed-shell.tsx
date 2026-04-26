// apps/web/src/app/embed/record/[recordId]/_components/embed-shell.tsx

import { cn } from '@auxx/ui/lib/utils'
import type { ReactNode } from 'react'

/**
 * Minimum chrome for the embed iframe. Surface paint matches the regular
 * web app so the extension's wrapper doesn't have to redo theme / typography.
 *
 * `theme` is propagated from the extension via `?theme=` so the iframe
 * matches the parent's colour scheme without depending on the iframe's
 * own `prefers-color-scheme` (which reads the OS setting, not the parent's
 * effective theme). The class flips Tailwind's `dark` variant via the
 * `@custom-variant dark (&:is(.dark *))` rule in the shared global stylesheet.
 */
export function EmbedShell({
  theme = 'light',
  children,
}: {
  theme?: 'light' | 'dark'
  children: ReactNode
}) {
  return (
    <div
      className={cn(
        'h-screen overflow-y-auto bg-background text-foreground',
        theme === 'dark' && 'dark'
      )}>
      {children}
    </div>
  )
}
