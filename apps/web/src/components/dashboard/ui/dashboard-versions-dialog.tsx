// apps/web/src/components/dashboard/ui/dashboard-versions-dialog.tsx
'use client'

// Thin adapter over the shared VersionHistoryDialog: maps
// `dashboard.listVersions` → rows and wires restore + label-rename. Restore is
// restore-AS-DRAFT (agent semantics): it loads the version onto the editable
// draft (pill → "unsaved") and drops into edit mode; nothing goes live until the
// user Publishes. The restored draft is adopted into the store directly so it
// takes effect even mid-edit.

import {
  VersionHistoryDialog,
  type VersionRowData,
} from '~/components/versioning/ui/version-history-dialog'
import { api } from '~/trpc/react'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'
import { useDashboardStore } from '../stores/dashboard-draft-store'

export function DashboardVersionsDialog({
  open,
  onOpenChange,
  dashboardId,
  activeVersionNumber,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  dashboardId: string
  activeVersionNumber: number | null
}) {
  const versionsQuery = api.dashboard.listVersions.useQuery({ id: dashboardId }, { enabled: open })
  const { restoreVersion, renameVersion } = useDashboardMutations()
  const adoptDraft = useDashboardStore((s) => s.adoptDraft)

  const versions: VersionRowData[] | undefined = versionsQuery.data?.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    label: v.label,
    createdAt: v.createdAt,
  }))

  const currentVersionId =
    versionsQuery.data?.find((v) => v.versionNumber === activeVersionNumber)?.id ?? null

  return (
    <VersionHistoryDialog
      open={open}
      onOpenChange={onOpenChange}
      versions={versions}
      isLoading={versionsQuery.isLoading}
      currentVersionId={currentVersionId}
      restoreConfirm={(v) => ({
        title: `Restore v${v.versionNumber}?`,
        description:
          'This version is loaded as an editable draft. Review it, then Publish to make it the live dashboard.',
        confirmText: 'Restore to draft',
      })}
      onRestore={async (v) => {
        if (v.versionNumber == null) return false
        const dashboard = await restoreVersion(dashboardId, v.versionNumber)
        if (!dashboard) return false
        adoptDraft(dashboard.draftLayout ?? dashboard.layout, dashboard.hasUnpublishedChanges)
        return true
      }}
      onRenameLabel={async (versionId, label) => {
        const v = versionsQuery.data?.find((x) => x.id === versionId)
        if (!v) return
        await renameVersion(dashboardId, v.versionNumber, label)
      }}
    />
  )
}
