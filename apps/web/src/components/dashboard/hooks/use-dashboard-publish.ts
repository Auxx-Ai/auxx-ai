// apps/web/src/components/dashboard/hooks/use-dashboard-publish.ts
'use client'

// The publish + discard paths (agent versioning model). Auto-save keeps
// `Dashboard.draftLayout` current; these two explicit actions drive versions:
//   • publish() snapshots the draft into a new version (`dashboard.publish`).
//   • discard() reverts the draft to the active version (`dashboard.discardDraft`).
// Both re-seed the store (`markPublished` / `markDiscarded`) and invalidate the
// affected queries. Publish pre-gates with the STRICT layout schema so an
// unconfigured widget yields a readable toast instead of a raw server ZodError —
// and never fires the request. No success toast (house rule).

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
 * the draft widget and keep its title.
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

export function useDashboardPublish() {
  const utils = api.useUtils()
  const publishMutation = api.dashboard.publish.useMutation()
  const discardMutation = api.dashboard.discardDraft.useMutation()
  const setSaveState = useDashboardStore((s) => s.setSaveState)
  const markPublished = useDashboardStore((s) => s.markPublished)
  const markDiscarded = useDashboardStore((s) => s.markDiscarded)

  const invalidate = useCallback(
    (dashboardId: string) =>
      Promise.all([
        utils.dashboard.get.invalidate({ id: dashboardId }),
        utils.dashboard.list.invalidate(),
        utils.dashboard.listVersions.invalidate({ id: dashboardId }),
      ]),
    [utils]
  )

  const publish = useCallback(async () => {
    const { dashboardId, draft } = getDashboardDraftState()
    if (!dashboardId || !draft) return

    // Pre-publish gate: catch unconfigured widgets before the request. The
    // layout-doc schema is the same one the server parses on publish.
    const parsed = dashboardLayoutDocSchema.safeParse(draft)
    if (!parsed.success) {
      const titles = incompleteWidgetTitles(draft, parsed.error.issues)
      const description = titles.length
        ? `These widgets need to be configured before publishing: ${titles
            .map((t) => `"${t}"`)
            .join(', ')}. Add a data source and metric, or remove them.`
        : 'One or more widgets are not fully configured yet. Finish configuring them or remove them before publishing.'
      toastError({ title: 'Cannot publish dashboard', description })
      return
    }

    setSaveState('saving')
    try {
      const { dashboard } = await publishMutation.mutateAsync({ id: dashboardId })
      markPublished(dashboard.layout, dashboard.versionNumber)
      await invalidate(dashboardId)
    } catch (error) {
      setSaveState('error')
      toastError({
        title: 'Error publishing dashboard',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [publishMutation, invalidate, setSaveState, markPublished])

  const discard = useCallback(async () => {
    const { dashboardId } = getDashboardDraftState()
    if (!dashboardId) return
    try {
      const { dashboard } = await discardMutation.mutateAsync({ id: dashboardId })
      markDiscarded(dashboard.layout)
      await invalidate(dashboardId)
    } catch (error) {
      toastError({
        title: 'Error discarding changes',
        description: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  }, [discardMutation, invalidate, markDiscarded])

  return {
    publish,
    discard,
    isPublishing: publishMutation.isPending,
    isDiscarding: discardMutation.isPending,
  }
}
