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
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { GridTreeRow } from '@auxx/ui/components/tree-row'
import { ArrowRight, Brackets, Hash } from 'lucide-react'
import { lastSegment, type SourcePath } from '../hooks/use-source-paths'
import { MAPPING_COLS } from './mapping-columns'
import { MappingFieldPicker } from './mapping-field-picker'

/**
 * Per-field merge strategies offered once a leaf is bound. `manual_review` and
 * `ignore` stay in the schema/runtime (`FieldMergeStrategy`) but are not yet
 * surfaced — `manual_review` has no conflict-review queue and `ignore` has no
 * use until then. Re-add here when those land.
 */
export const MERGE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'overwrite', label: 'overwrite' },
  { value: 'fill_blank', label: 'fill-blank' },
  { value: 'connector_owned_only', label: 'owned-only' },
]

/**
 * Short type token for the leaf badge. Prefers a detected string `format`
 * (`uri`/`email`/`date`/…) over the bare JSON type, so the badge matches what
 * quick-create seeds — a `url`-valued string reads `URL`, not `STRING`. The
 * badge's `uppercase` class handles casing.
 */
function sourceTypeLabel(node: SourcePath): string {
  switch (node.format) {
    case 'uri':
      return 'url'
    case 'email':
      return 'email'
    case 'date-time':
      return 'datetime'
    case 'date':
      return 'date'
    case 'time':
      return 'time'
    default:
      return node.type
  }
}

interface SourceLeafRowProps {
  depth: number
  node: SourcePath
  /** The enclosing mapping's def — the binding target. Null until a def is picked. */
  entityDefinitionId: string | null
  /** Resolved label for the bound key (for the chip). */
  assignedLabel: string | undefined
  assignedTargetKey: string | undefined
  /** Target keys bound by other entries — excluded from this leaf's picker. */
  excludeKeys?: Set<string>
  mergeStrategy: string
  /** A target def is set, so inline quick-create can mint a new field. */
  canCreate: boolean
  /** Owned mapping (the connector is the sole writer) — hides the merge picker. */
  isOwned: boolean
  /** This bound field is a secondary identity-match key (external id stays primary). */
  isMatch: boolean
  onAssign: (targetKey: string) => void
  onClear: () => void
  onMergeChange: (value: string) => void
  onToggleMatch: () => void
}

/**
 * A source-schema leaf (plan §3.1). The label is the source field; the
 * {@link MappingFieldPicker} "applies" a target field to it. Once bound, the
 * merge picker + clear appear. A source value maps to at most one target field
 * (a strict bare-token bind); computed/multi-source values live on their own
 * formula rows, not here. Array-of-scalars leaves get the multi-value icon.
 */
export function SourceLeafRow({
  depth,
  node,
  entityDefinitionId,
  assignedLabel,
  assignedTargetKey,
  excludeKeys,
  mergeStrategy,
  canCreate,
  isOwned,
  isMatch,
  onAssign,
  onClear,
  onMergeChange,
  onToggleMatch,
}: SourceLeafRowProps) {
  const isMapped = !!assignedTargetKey
  const isArray = node.type === 'array'
  const Icon = isArray ? Brackets : Hash
  return (
    <GridTreeRow
      columns={MAPPING_COLS}
      depth={depth}
      icon={<Icon className={isMapped ? 'size-3.5' : 'size-3.5 text-muted-foreground/50'} />}
      title={
        <span className='flex items-center gap-1.5'>
          <span className={`font-mono text-sm ${isMapped ? '' : 'text-muted-foreground'}`}>
            {lastSegment(node.path)}
          </span>
          <span className='text-[10px] uppercase text-muted-foreground/60'>
            {sourceTypeLabel(node)}
          </span>
        </span>
      }
      cells={[
        // The arrow always shows (the field picker is always present, even when
        // unbound) — dimmed until a target field is bound.
        <span
          key='arrow'
          className={`flex w-full justify-center ${
            isMapped ? 'text-muted-foreground' : 'text-muted-foreground/40'
          }`}>
          <ArrowRight className='size-3.5' />
        </span>,
        // Target column — the field picker fills the cell and blends into the row.
        <MappingFieldPicker
          key='target'
          entityDefinitionId={entityDefinitionId}
          sourceType={node.type}
          sourcePath={node.path}
          sourceFormat={node.format}
          assignedKey={assignedTargetKey}
          assignedLabel={assignedLabel}
          excludeKeys={excludeKeys}
          canCreate={canCreate}
          onAssign={onAssign}
          onClear={onClear}
        />,
        // Actions — match toggle + merge picker, available once the leaf is bound.
        <div key='actions' className='flex w-full items-center gap-2 px-2'>
          {/* Secondary identifier toggle: subtle text → filled blue badge.
              Reserves its slot whether shown or not, so the merge picker stays at
              a fixed location across rows. */}
          <div className='flex w-20 shrink-0 items-center'>
            {isMapped && (
              <SimpleTooltip
                side='left'
                delayDuration={500}
                content={
                  isMatch
                    ? 'Used as a secondary identifier to match existing records. Click to stop matching on this field.'
                    : 'Also match existing records by this field (external id stays the primary key).'
                }>
                <button
                  type='button'
                  onClick={onToggleMatch}
                  className='inline-flex shrink-0 items-center'>
                  {isMatch ? (
                    <Badge variant='blue' size='xs'>
                      Identifier
                    </Badge>
                  ) : (
                    <span className='px-1 text-[10px] font-medium text-primary-400 hover:text-primary-600'>
                      Identifier
                    </span>
                  )}
                </button>
              </SimpleTooltip>
            )}
          </div>
          {/* Merge strategy only matters when the def is shared. An owned mapping
              is the sole writer, so every field is an implicit overwrite — no
              picker. Fixed width so it sits at a consistent x. */}
          {isMapped && !isOwned && (
            <Select value={mergeStrategy} onValueChange={onMergeChange}>
              <SelectTrigger variant='transparent' size='sm' className='h-9 w-28 text-xs'>
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
          )}
        </div>,
      ]}
    />
  )
}
