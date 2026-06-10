// apps/web/src/components/agents/procedures/ui/procedure-versions-dialog.tsx
'use client'

import {
  VersionHistoryDialog,
  type VersionRowData,
} from '~/components/versioning/ui/version-history-dialog'
import { api } from '~/trpc/react'
import { useProcedure } from '../hooks/use-procedure'
import { useProcedureMutations } from '../hooks/use-procedure-mutations'

interface ProcedureVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  procedureId: string
  /** Bumped after a restore so the editor canvas remounts onto the new draft doc. */
  onReload?: () => void
}

/**
 * Thin adapter over the shared {@link VersionHistoryDialog} — gains label rename
 * and editor names over the previous bespoke copy. Restore is restore-as-draft
 * (loads the snapshot into the draft + reloads the canvas via `onReload`); live
 * behavior is unchanged until publish. See plans/agents/agent-versions/ui-plan.md §3.1.
 */
export function ProcedureVersionsDialog({
  open,
  onOpenChange,
  procedureId,
  onReload,
}: ProcedureVersionsDialogProps) {
  const versionsQuery = api.procedure.listVersions.useQuery({ id: procedureId }, { enabled: open })
  const { meta } = useProcedure(procedureId)
  const { restoreVersion, renameVersion } = useProcedureMutations()

  const versions: VersionRowData[] | undefined = versionsQuery.data?.map((v) => ({
    id: v.id,
    versionNumber: v.versionNumber,
    label: v.label,
    editorName: v.editorName,
    createdAt: v.createdAt,
  }))

  return (
    <VersionHistoryDialog
      open={open}
      onOpenChange={onOpenChange}
      versions={versions}
      isLoading={versionsQuery.isLoading}
      currentVersionId={meta?.activeVersionId ?? null}
      onRestore={async (version) => {
        const success = await restoreVersion(procedureId, version.id)
        if (success) onReload?.()
        return success
      }}
      onRenameLabel={(versionId, label) => renameVersion(procedureId, versionId, label)}
    />
  )
}
