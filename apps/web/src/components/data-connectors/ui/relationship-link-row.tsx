// apps/web/src/components/data-connectors/ui/relationship-link-row.tsx
'use client'

import { EntityIcon } from '@auxx/ui/components/icons'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { ArrowRight, Link2, Trash2 } from 'lucide-react'
import { useResourceProperty } from '~/components/resources'
import { MAPPING_COLS } from './mapping-columns'

interface RelationshipLinkRowProps {
  depth: number
  /** The relationship field on THIS def the edge writes into. */
  fieldLabel: string
  /** The related def the link resolves to (for its icon + label). */
  targetDefinitionId: string | null
  /** The FK source path that anchors the edge — shown as a `via` caption. */
  viaPath: string
  onClear: () => void
}

/**
 * An id-only relationship link (relationship-linking v3 §9.6a), rendered as its own
 * sub-row beneath the FK leaf so a link and a scalar binding coexist on the same
 * source value. The leaf still owns the scalar; this row owns the edge (relationship
 * field → related def). Resolution is DEF-KEYED + lazy — there is no frozen pointer
 * to dangle, so the old "no stream" unresolved badge is gone.
 */
export function RelationshipLinkRow({
  depth,
  fieldLabel,
  targetDefinitionId,
  viaPath,
  onClear,
}: RelationshipLinkRowProps) {
  const target = useResourceProperty(targetDefinitionId, ['label', 'icon'])
  return (
    <GridTreeRow
      columns={MAPPING_COLS}
      depth={depth}
      icon={<Link2 className='size-3.5 text-muted-foreground' />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className='text-sm'>{fieldLabel}</span>
          <span className='text-[10px] text-muted-foreground/60'>via {viaPath}</span>
        </span>
      }
      cells={[
        <span key='arrow' className='flex w-full justify-center text-muted-foreground'>
          <ArrowRight className='size-3.5' />
        </span>,
        // Target column — the related def (implied by the relationship field).
        <span key='target' className='flex h-9 w-full items-center gap-1.5 px-2 text-xs'>
          {target && <EntityIcon iconId={target.icon ?? 'table'} size='xs' />}
          <span className='truncate'>{target?.label ?? 'record'}</span>
        </span>,
        <div key='actions' className='flex w-full items-center justify-end gap-1 pr-1'>
          <TreeRowButton variant='destructive' tooltipText='Remove link' onClick={onClear}>
            <Trash2 />
          </TreeRowButton>
        </div>,
      ]}
    />
  )
}
