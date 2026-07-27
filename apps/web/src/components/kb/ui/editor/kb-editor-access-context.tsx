// apps/web/src/components/kb/ui/editor/kb-editor-access-context.tsx
'use client'

import { toRecordId } from '@auxx/types/resource'
import type React from 'react'
import { createContext, useContext, useMemo } from 'react'
import { useAccess } from '~/providers/capabilities-provider'

/** Per-instance capability booleans for the KB currently open in the editor. */
interface KBEditorAccess {
  /** Edit-instance on this KB — gates article create/rename/move/delete/import/crawl. */
  canEdit: boolean
  /** Admin-instance (Full) on this KB — gates settings tabs, layout tab, publish cluster. */
  canAdmin: boolean
}

const KBEditorAccessContext = createContext<KBEditorAccess | undefined>(undefined)

/**
 * Derives the current member's Edit/Full capability on this KB instance ONCE
 * at the top of the editor tree (`KBEditorFrame`) and hands it to every
 * descendant via context instead of threading `canEdit`/`canAdmin` props
 * through a dozen components (doc 24 §A.2.4).
 */
export function KBEditorAccessProvider({
  knowledgeBaseId,
  children,
}: {
  knowledgeBaseId: string
  children: React.ReactNode
}) {
  const { canEditInstance, canAdminInstance } = useAccess()

  const value = useMemo<KBEditorAccess>(() => {
    const recordId = toRecordId('kb', knowledgeBaseId)
    return {
      canEdit: canEditInstance(recordId),
      canAdmin: canAdminInstance(recordId),
    }
  }, [knowledgeBaseId, canEditInstance, canAdminInstance])

  return <KBEditorAccessContext.Provider value={value}>{children}</KBEditorAccessContext.Provider>
}

/** Consume the KB editor's capability context. Must render under `KBEditorAccessProvider`. */
export function useKBEditorAccess(): KBEditorAccess {
  const context = useContext(KBEditorAccessContext)
  if (context === undefined) {
    throw new Error('useKBEditorAccess must be used within a KBEditorAccessProvider')
  }
  return context
}
