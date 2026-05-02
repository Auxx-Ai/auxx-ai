// apps/web/src/components/editor/kb-article/editor-context.tsx
'use client'

import { createContext, type ReactNode, useContext, useMemo } from 'react'

interface KBEditorContextValue {
  /** Knowledge base id for any nested pickers (article-link, cards). */
  knowledgeBaseId?: string
}

const Ctx = createContext<KBEditorContextValue>({})

export function KBEditorContextProvider({
  knowledgeBaseId,
  children,
}: {
  knowledgeBaseId?: string
  children: ReactNode
}) {
  const value = useMemo(() => ({ knowledgeBaseId }), [knowledgeBaseId])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useKBEditorContext(): KBEditorContextValue {
  return useContext(Ctx)
}
