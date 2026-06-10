// apps/web/src/components/agents/ui/detail/agent-versions-dialog.tsx
'use client'

import {
  VersionHistoryDialog,
  type VersionRowData,
} from '~/components/versioning/ui/version-history-dialog'
import { api } from '~/trpc/react'
import { useAgentMutations } from '../../hooks/use-agent-mutations'

interface AgentVersionsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  agentId: string
}

/**
 * Thin adapter over the shared {@link VersionHistoryDialog}: maps
 * `agent.listVersions` → rows, wires restore + label-rename through
 * `use-agent-mutations`. No per-row extra actions in v1 (a config diff is a
 * designed later slot). See plans/agents/agent-versions/ui-plan.md §2.
 */
export function AgentVersionsDialog({ open, onOpenChange, agentId }: AgentVersionsDialogProps) {
  const versionsQuery = api.agent.listVersions.useQuery({ agentId }, { enabled: open })
  const detail = api.agent.getById.useQuery({ agentId }, { enabled: open })
  const { restoreVersion, renameVersion } = useAgentMutations()

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
      currentVersionId={detail.data?.activeVersionId ?? null}
      onRestore={(version) => restoreVersion(agentId, version.id)}
      onRenameLabel={(versionId, label) => renameVersion(agentId, versionId, label)}
    />
  )
}
