// apps/web/src/components/dashboard/hooks/use-unsaved-changes-guard.ts
'use client'

// Warn before a tab close / hard reload drops an unsaved edit session. The
// client-only draft model's safety net (plan 06) — paired with the localStorage
// mirror, which lets a reload actually restore the draft. The in-app nav guard
// and the "Discard changes?" confirm on Cancel live with the page header (plan
// 08); this hook owns only the browser-level `beforeunload`.

import { useEffect } from 'react'
import { selectIsDirty, useDashboardStore } from '../stores/dashboard-draft-store'

export function useUnsavedChangesGuard() {
  const isDirty = useDashboardStore(selectIsDirty)

  useEffect(() => {
    if (!isDirty) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [isDirty])
}
