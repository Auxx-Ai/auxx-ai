// apps/web/src/components/agents/procedures/hooks/use-delete-building-block.ts
'use client'

import { toastError } from '@auxx/ui/components/toast'
import { useConfirm } from '~/hooks/use-confirm'
import { useProcedureDraft } from '../ui/procedure-draft-provider'
import { countReferences } from '../ui/reference-usage'

export type BuildingBlockKind = 'code' | 'sub'

/**
 * Shared delete flow for procedure building blocks (code blocks + sub-procedures),
 * used by both the Building blocks popover and the drill-header `⋯` menu so both surfaces
 * behave identically: refuse while the block is still referenced in the prose (naming
 * where), otherwise confirm (destructive) and delete via the draft owner.
 *
 * Render the returned `ConfirmDialog` once in the consumer — OUTSIDE any element that
 * unmounts on the action (e.g. a closing Popover), so the dialog survives the close.
 */
export function useDeleteBuildingBlock() {
  const draft = useProcedureDraft()
  const [confirm, ConfirmDialog] = useConfirm()

  const requestDelete = async (kind: BuildingBlockKind, id: string, name: string) => {
    if (!draft) return
    const label = name.trim() || (kind === 'code' ? 'Code' : 'Sub-procedure')
    const refId = kind === 'code' ? `code:${id}` : `subprocedure:${id}`

    const usage = countReferences(refId, {
      mainContent: draft.getMainContent(),
      subProcedures: draft.subProcedures.map((s) => ({
        id: s.id,
        name: s.name,
        content: draft.getSubContent(s.id),
      })),
      excludeSubId: kind === 'sub' ? id : undefined,
    })

    if (usage.count > 0) {
      toastError({
        title: `Can’t delete “${label}”`,
        description: `Still referenced in ${formatLocations(usage.locations)}. Remove those references first.`,
      })
      return
    }

    const ok = await confirm({
      title: `Delete “${label}”?`,
      description: 'This permanently removes it from the procedure and can’t be undone.',
      confirmText: 'Delete',
      cancelText: 'Cancel',
      destructive: true,
    })
    if (!ok) return

    if (kind === 'code') draft.deleteCodeBlock(id)
    else draft.deleteSubProcedure(id)
  }

  return { requestDelete, ConfirmDialog }
}

/** Join locations into a readable phrase: "A", "A and B", "A, B and C". */
function formatLocations(locations: string[]): string {
  if (locations.length <= 1) return locations[0] ?? 'the procedure'
  return `${locations.slice(0, -1).join(', ')} and ${locations[locations.length - 1]}`
}
