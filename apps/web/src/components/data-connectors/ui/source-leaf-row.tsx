// apps/web/src/components/data-connectors/ui/source-leaf-row.tsx
'use client'

import type { ResourceField } from '@auxx/lib/resources/client'
import type { FieldReference } from '@auxx/types/field'
import { Popover, PopoverContent, PopoverTrigger } from '@auxx/ui/components/popover'
import { SimpleTooltip } from '@auxx/ui/components/tooltip'
import { GridTreeRow, TreeRowButton } from '@auxx/ui/components/tree-row'
import { cn } from '@auxx/ui/lib/utils'
import { ArrowRight, Brackets, Check, Hash, KeyRound, Trash2 } from 'lucide-react'
import { lastSegment, type SourcePath } from '../hooks/use-source-paths'
import { MAPPING_COLS } from './mapping-columns'
import { MappingFieldPicker } from './mapping-field-picker'
import { MergeStrategyToggle } from './merge-strategy-toggle'

/** The identity role a leaf currently plays (relationship-linking v3 §9.4). */
export type LeafIdentityRole = 'externalId' | 'match' | null

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

/** Only scalars the runtime can `String()`-coerce can be an identifier (§9.4). */
function isCoercibleScalar(node: SourcePath): boolean {
  return node.type === 'string' || node.type === 'number' || node.type === 'integer'
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
  /** The identity role this leaf plays (external-id anchor / secondary match / none). */
  identityRole: LeafIdentityRole
  /** Relationship linking — the picker is the entry point; the link renders on a sub-row. */
  allowRelationships?: boolean
  syncedDefIds?: Set<string>
  /** The currently-linked relationship field's ref, for the picker's selected check. */
  linkedFieldRef?: string
  onAssign: (targetKey: string) => void
  onClear: () => void
  onMergeChange: (value: string) => void
  /** Set / clear this leaf's identity role (External ID anchor or secondary Match). */
  onSetIdentityRole: (role: LeafIdentityRole) => void
  onLinkRelationship?: (field: ResourceField, ref: FieldReference) => void
}

/**
 * A source-schema leaf (plan §3.1). The label is the source field; the
 * {@link MappingFieldPicker} "applies" a target field to it. The row title carries
 * the {@link IdentityRoleControl} key icon (External ID / Match), which renders even
 * on UNMAPPED rows — the external id is source-side and needs no target binding
 * (§9.4). Once a target is bound, the merge picker + clear appear.
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
  identityRole,
  allowRelationships,
  syncedDefIds,
  linkedFieldRef,
  onAssign,
  onClear,
  onMergeChange,
  onSetIdentityRole,
  onLinkRelationship,
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
          {/* Identity role lives in the title (source-side) so it shows on unmapped
              rows too. Only for scalars the runtime can String()-coerce. */}
          {isCoercibleScalar(node) && (
            <IdentityRoleControl
              role={identityRole}
              canMatch={isMapped}
              onChange={onSetIdentityRole}
            />
          )}
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
          allowRelationships={allowRelationships}
          syncedDefIds={syncedDefIds}
          linkedFieldRef={linkedFieldRef}
          onAssign={onAssign}
          onClear={onClear}
          onLinkRelationship={onLinkRelationship}
        />,
        // Actions — a right-aligned badge cluster (merge → clear). The identity role
        // now lives in the title (§9.4), not here.
        <div key='actions' className='flex w-full items-center justify-end gap-1 pr-1'>
          {isMapped && (
            <>
              {/* Merge strategy only matters when the def is shared. An owned
                  mapping is the sole writer, so every field is an implicit
                  overwrite — no toggle. */}
              {!isOwned && (
                <MergeStrategyToggle value={mergeStrategy} onValueChange={onMergeChange} />
              )}
              <TreeRowButton
                variant='destructive'
                tooltipText="Don't map this field"
                onClick={onClear}>
                <Trash2 />
              </TreeRowButton>
            </>
          )}
        </div>,
      ]}
    />
  )
}

/**
 * The unified identity-role control (relationship-linking v3 §9.4) — one `KeyRound`
 * icon that replaces both the old silent external-id guess and the separate "Match"
 * badge. State is conveyed by visibility + color (the glyph never changes):
 *   • none → hover-reveal, muted;  • External ID → always-on, primary/blue;
 *   • Match → always-on, amber. Click opens a tiny context-aware popover.
 */
function IdentityRoleControl({
  role,
  canMatch,
  onChange,
}: {
  role: LeafIdentityRole
  canMatch: boolean
  onChange: (role: LeafIdentityRole) => void
}) {
  const tooltip =
    role === 'externalId'
      ? 'External ID — the upstream key that dedups this record and anchors its links.'
      : role === 'match'
        ? 'Match — a secondary key used to adopt an existing record (external id stays primary).'
        : 'Mark as an identifier (External ID or Match).'
  return (
    <Popover>
      <SimpleTooltip side='top' delayDuration={500} content={tooltip}>
        <PopoverTrigger asChild>
          <button
            type='button'
            className={cn(
              'inline-flex size-4 shrink-0 items-center justify-center rounded-sm transition-colors',
              role === 'externalId' && 'text-primary',
              role === 'match' && 'text-amber-500',
              !role &&
                'text-muted-foreground/0 group-hover/tree-row:text-muted-foreground/50 hover:text-muted-foreground'
            )}>
            <KeyRound className='size-3.5' />
          </button>
        </PopoverTrigger>
      </SimpleTooltip>
      <PopoverContent align='start' className='w-52 p-1'>
        <RoleOption label='Not an identifier' active={!role} onClick={() => onChange(null)} />
        <RoleOption
          label='External ID'
          hint='Primary upstream key'
          active={role === 'externalId'}
          onClick={() => onChange('externalId')}
        />
        {canMatch && (
          <RoleOption
            label='Match existing'
            hint='Secondary adoption key'
            active={role === 'match'}
            onClick={() => onChange('match')}
          />
        )}
      </PopoverContent>
    </Popover>
  )
}

function RoleOption({
  label,
  hint,
  active,
  onClick,
}: {
  label: string
  hint?: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type='button'
      onClick={onClick}
      className='flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-muted'>
      <Check className={cn('size-3.5 shrink-0', active ? 'opacity-100' : 'opacity-0')} />
      <span className='flex flex-col'>
        <span>{label}</span>
        {hint && <span className='text-[10px] text-muted-foreground'>{hint}</span>}
      </span>
    </button>
  )
}
