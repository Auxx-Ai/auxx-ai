// apps/web/src/components/kb/hooks/use-body-class.ts
'use client'

import { useEffect } from 'react'

/**
 * Temporarily mutate `document.body.classList` for the lifetime of a component.
 * Use to opt a single route out of global body classes set in `app/layout.tsx`
 * (e.g. dropping `overflow-hidden` for a page that wants natural document scroll).
 */
export function useBodyClass({ add, remove }: { add?: string; remove?: string }) {
  useEffect(() => {
    const cls = document.body.classList
    const toAdd = (add ?? '').split(' ').filter((c) => c && !cls.contains(c))
    const toRemove = (remove ?? '').split(' ').filter((c) => c && cls.contains(c))
    for (const c of toAdd) cls.add(c)
    for (const c of toRemove) cls.remove(c)
    return () => {
      for (const c of toAdd) cls.remove(c)
      for (const c of toRemove) cls.add(c)
    }
  }, [add, remove])
}
