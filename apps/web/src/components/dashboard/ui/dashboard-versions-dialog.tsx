// apps/web/src/components/dashboard/ui/dashboard-versions-dialog.tsx
'use client'

// Thin adapter over the shared VersionHistoryDialog: maps
// `dashboard.listVersions` → rows and wires restore + label-rename. Unlike
// agents, restore is IMMEDIATE (a new active version copied from the old one),
// so it passes its own confirm copy instead of the shared "restore as draft"
// wording.

import {
  VersionHistoryDialog,
  type VersionRowData,
} from '~/components/versioning/ui/version-history-dialog'
import { api } from '~/trpc/react'
import { useDashboardMutations } from '../hooks/use-dashboard-mutations'

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
          'A new version is created as a copy of this one and immediately becomes the live dashboard.',
        confirmText: 'Restore',
      })}
      onRestore={async (v) => {
        if (v.versionNumber == null) return false
        return restoreVersion(dashboardId, v.versionNumber)
      }}
      onRenameLabel={async (versionId, label) => {
        const v = versionsQuery.data?.find((x) => x.id === versionId)
        if (!v) return
        await renameVersion(dashboardId, v.versionNumber, label)
      }}
    />
  )
}
