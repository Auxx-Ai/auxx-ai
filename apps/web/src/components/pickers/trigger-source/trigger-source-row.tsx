// apps/web/src/components/pickers/trigger-source/trigger-source-row.tsx
// The "selected trigger source" row — an icon + name + (truncated) secondary, with
// hover-revealed Edit (Pencil) and Remove (Trash2) actions. A thin TreeRow so every
// surface that shows a chosen app trigger / webhook endpoint (agent trigger dialog,
// data-connector binding) renders it identically. Pass only the handlers that apply —
// each button renders only when its handler is supplied.

'use client'

import { TreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { Pencil, Trash2 } from 'lucide-react'
import type { ReactNode } from 'react'

interface TriggerSourceRowProps {
  icon: ReactNode
  title: ReactNode
  /** Secondary text shown after the title (e.g. the endpoint URL or trigger description). */
  secondary?: ReactNode
  /** Edit — re-open the picker to re-pick the source. Pencil hidden when omitted. */
  onEdit?: () => void
  /** Remove — clear the selection / delete the trigger. Trash2 hidden when omitted. */
  onDelete?: () => void
}

export function TriggerSourceRow({
  icon,
  title,
  secondary,
  onEdit,
  onDelete,
}: TriggerSourceRowProps) {
  return (
    <TreeRow
      icon={icon}
      title={title}
      secondary={secondary}
      secondaryFill
      // Clicking anywhere on the row re-opens the picker (edit). The actions slot
      // stops propagation, so the hover Edit/Remove buttons still act on their own.
      onToggleOpen={onEdit}
      actions={
        onEdit || onDelete ? (
          <>
            {onEdit && (
              <TreeRowButton tooltipText='Edit' aria-label='Edit' onClick={onEdit}>
                <Pencil />
              </TreeRowButton>
            )}
            {onDelete && (
              <TreeRowButton
                variant='destructive'
                tooltipText='Remove'
                aria-label='Remove'
                onClick={onDelete}>
                <Trash2 />
              </TreeRowButton>
            )}
          </>
        ) : undefined
      }
    />
  )
}
