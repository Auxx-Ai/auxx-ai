// apps/web/src/components/dashboard/hooks/use-dashboard-save.ts
'use client'

// The save path: publish the current draft as a new version (`dashboard.save`),
// swap `persisted` + exit edit mode (`markSaved`), and invalidate the affected
// queries. An unchanged save is a server no-op that returns the active version —
// same flow. No success toast (house rule); errors surface via `toastError` and
// leave the draft intact so the user can fix + retry (e.g. an unconfigured chart
// that fails layout validation).

import type { DashboardLayoutDoc } from '@auxx/lib/dashboards/client'
import { dashboardLayoutDocSchema } from '@auxx/lib/dashboards/config-schemas'
import { toastError } from '@auxx/ui/components/toast'
import { useCallback } from 'react'
import type { ZodIssue } from 'zod'
import { api } from '~/trpc/react'
import { getDashboardDraftState, useDashboardStore } from '../stores/dashboard-draft-store'

/**
 * Names the widgets a failed layout parse points at, deduped by widget id. Each
 * Zod issue path is `['tabs', ti, 'widgets', wi, ...]`; map `(ti, wi)` back to
 * the draft widget and keep its title. Empty ⇒ caller falls back to a generic
 * message (issue paths didn't resolve to a widget).
 */
function incompleteWidgetTitles(doc: DashboardLayoutDoc, issues: ZodIssue[]): string[] {
  const byId = new Map<string, string>()
  for (const issue of issues) {
    const [tabsKey, ti, widgetsKey, wi] = issue.path
    if (tabsKey !== 'tabs' || widgetsKey !== 'widgets') continue
    const widget = doc.tabs[ti as number]?.widgets[wi as number]
    if (widget) byId.set(widget.id, widget.title || 'Untitled widget')
  }
  return [...byId.values()]
}

export function useDashboardSave() {
  const utils = api.useUtils()
  const save = api.dashboard.save.useMutation()
  const setSaveState = useDashboardStore((s) => s.setSaveState)
  const markSaved = useDashboardStore((s) => s.markSaved)

  const commit = useCallback(async () => {
    const { dashboardId, draft } = getDashboardDraftState()
    if (!dashboardId || !draft) return

    // Pre-save validity gate: catch unconfigured widgets before the mutation so
    // the user gets a readable toast instead of a raw ZodError dump — and never
    // fire the network request. The layout-doc schema is the same one the server
    // parses, so this mirrors what would be rejected.
    const parsed = dashboardLayoutDocSchema.safeParse(draft)
    if (!parsed.success) {
      const titles = incompleteWidgetTitles(draft, parsed.error.issues)
      const description = titles.length
        ? `These widgets need to be configured before saving: ${titles
            .map((t) => `"${t}"`)
            .join(', ')}. Add a data source and metric, or remove them.`
        : 'One or more widgets are not fully configured yet. Finish configuring them or remove them before saving.'
      setSaveState('error')
      toastError({ title: 'Cannot save dashboard', description })
      return
    }

    setSaveState('saving')
    try {
      const { dashboard } = await save.mutateAsync({ id: dashboardId, doc: draft })
      markSaved(dashboard.layout, dashboard.versionNumber)
      await Promise.all([
        utils.dashboard.get.invalidate({ id: dashboardId }),
        utils.dashboard.list.invalidate(),
        utils.dashboard.listVersions.invalidate({ id: dashboardId }),
      ])
    } catch (error) {
      setSaveState('error')
      toastError({
        title: 'Error saving dashboard',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [save, utils, setSaveState, markSaved])

  return { commit, isSaving: save.isPending }
}
