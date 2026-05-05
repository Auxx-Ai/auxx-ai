// apps/web/src/components/editor/kb-article/accordion-context.tsx
'use client'

import { createContext, useContext } from 'react'

export interface AccordionPanelContext {
  containerPos: number | null
  isCollapsed: (panelId: string) => boolean
  toggleCollapsed: (panelId: string) => void
}

const Ctx = createContext<AccordionPanelContext | null>(null)

export function AccordionPanelProvider({
  value,
  children,
}: {
  value: AccordionPanelContext
  children: React.ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useAccordionPanelContext(): AccordionPanelContext | null {
  return useContext(Ctx)
}
