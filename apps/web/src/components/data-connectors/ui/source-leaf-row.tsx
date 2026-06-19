// apps/web/src/components/data-connectors/ui/source-leaf-row.tsx
'use client'

import { Badge } from '@auxx/ui/components/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@auxx/ui/components/select'
import TreeRow, { TreeRowButton } from '@auxx/ui/components/tree-row'
import { Brackets, FunctionSquare, Hash, X } from 'lucide-react'
import { lastSegment, type SourcePath } from '../hooks/use-source-paths'
import { MappingFieldPicker } from './mapping-field-picker'

/** Per-field merge strategies offered once a leaf is bound. */
export const MERGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'overwrite', label: 'overwrite' },
  { value: 'fill_blank', label: 'fill-blank' },
  { value: 'connector_owned_only', label: 'owned-only' },
  { value: 'manual_review', label: 'review' },
  { value: 'ignore', label: 'ignore' },
]

interface SourceLeafRowProps {
  depth: number
  node: SourcePath
  /** The enclosing mapping's def — the binding target. Null until a def is picked. */
  entityDefinitionId: string | null
  /** Resolved label for the bound key (for the chip). */
  assignedLabel: string | undefined
  assignedTargetKey: string | undefined
  mergeStrategy: string
  /** Owned defs allow inline quick-create (plan decision 3). */
  canCreate: boolean
  /** This bound field is a secondary identity-match key (external id stays primary). */
  isMatch: boolean
  onAssign: (targetKey: string) => void
  onClear: () => void
  onMergeChange: (value: string) => void
  onToggleMatch: () => void
  onPromote: () => void
}

/**
 * A source-schema leaf (plan §3.1). The label is the source field; the
 * {@link MappingFieldPicker} "applies" a target field to it. Once bound, the
 * merge picker + `ƒ` (calc) promote + clear appear. A source value maps to at
 * most one target field. Array-of-scalars leaves get the multi-value icon.
 */
export function SourceLeafRow({
  depth,
  node,
  entityDefinitionId,
  assignedLabel,
  assignedTargetKey,
  mergeStrategy,
  canCreate,
  isMatch,
  onAssign,
  onClear,
  onMergeChange,
  onToggleMatch,
  onPromote,
}: SourceLeafRowProps) {
  const isMapped = !!assignedTargetKey
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Hash
  return (
    <TreeRow
      depth={depth}
      icon={<Icon className={isMapped ? 'size-3.5' : 'size-3.5 text-muted-foreground/50'} />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className={`font-mono text-sm ${isMapped ? '' : 'text-muted-foreground'}`}>
            {lastSegment(node.path)}
          </span>
          <span className='text-[10px] uppercase text-muted-foreground/60'>{node.type}</span>
        </span>
      }
      // The target picker reads inline right after the source field name.
      secondary={
        <MappingFieldPicker
          entityDefinitionId={entityDefinitionId}
          sourceType={node.type}
          sourcePath={node.path}
          assignedKey={assignedTargetKey}
          assignedLabel={assignedLabel}
          canCreate={canCreate}
          onAssign={onAssign}
        />
      }
      trailing={
        isMapped ? (
          <div className='flex items-center gap-1'>
            {/* Secondary identity-match toggle: subtle text → filled blue badge. */}
            <button
              type='button'
              onClick={onToggleMatch}
              title={
                isMatch
                  ? 'Used as a secondary identity match. Click to stop matching on this field.'
                  : 'Also match existing records by this field (external id stays the primary key).'
              }>
              {isMatch ? (
                <Badge variant='blue' className='h-5 px-1.5 text-[10px]'>
                  Match
                </Badge>
              ) : (
                <span className='px-1 text-[10px] font-medium text-primary-400 hover:text-primary-600'>
                  Match
                </span>
              )}
            </button>
            <Select value={mergeStrategy} onValueChange={onMergeChange}>
              <SelectTrigger size='sm' className='h-6 min-w-[96px] text-xs'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MERGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <TreeRowButton tooltipText='Edit as a formula' onClick={onPromote}>
              <FunctionSquare />
            </TreeRowButton>
            <TreeRowButton tooltipText='Clear mapping' onClick={onClear}>
              <X />
            </TreeRowButton>
          </div>
        ) : undefined
      }
    />
  )
}
